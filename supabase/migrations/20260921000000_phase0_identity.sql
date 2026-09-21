-- Phase 0 — Foundations.
--
-- Implements docs/README.md §3.1 (identity) plus the `verification_tier` column §3.2
-- hangs the tier ladder off. Jobs, companies, interactions, comments and everything
-- downstream belong to later phases and are deliberately absent.

create schema if not exists extensions;
create extension if not exists citext with schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;

-- §3.4 defines employment_type for `jobs`. user_preferences needs it now and the set is
-- identical, so it lands here rather than being defined twice.
create type public.employment_type as enum ('Internship', 'Full-time', 'Part-time', 'Contract');

create type public.verification_tier as enum ('none', 'email', 'edu', 'identity');

-- §3 convention: `updated_at` is maintained by a trigger, never by application code.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ── schools ────────────────────────────────────────────────────────────────────

create table public.schools (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  short_name    text,
  -- The .edu verification key (§3.2). citext so 'Purdue.EDU' matches 'purdue.edu'.
  email_domains extensions.citext[] not null default '{}',
  country       char(2) not null default 'US',
  created_at    timestamptz not null default now()
);

create unique index schools_name_key on public.schools (name);
create index schools_email_domains_idx on public.schools using gin (email_domains);

-- ── profiles ───────────────────────────────────────────────────────────────────

create table public.profiles (
  id                      uuid primary key references auth.users (id) on delete cascade,
  handle                  extensions.citext unique,
  first_name              text,
  last_name               text,
  -- Derived, never edited directly, so there is only ever one spelling of who this is.
  display_name            text generated always as (
                            nullif(btrim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), '')
                          ) stored,
  avatar_color            text not null default '#111114',
  school_id               uuid references public.schools (id),
  -- What they typed at signup. Never feeds the badge — see set_comment_badge below.
  school_name_raw         text,
  major                   text,
  graduation_year         smallint,
  location                text,
  comment_badge           text,
  verification_tier       public.verification_tier not null default 'none',
  onboarding_completed_at timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  deleted_at              timestamptz,
  constraint profiles_graduation_year_check
    check (graduation_year is null or graduation_year between 1950 and 2100),
  constraint profiles_avatar_color_check
    check (avatar_color ~ '^#[0-9A-Fa-f]{6}$')
);

/*
 * §3.1: the string shown on comments — "CS @ Purdue '27".
 *
 * Composed here rather than accepted from the client, so a user cannot type a school
 * they have not verified into their own badge. It reads `school_id`, which only the
 * verification flow (§3.2) sets, and never `school_name_raw`, which is free text.
 *
 * Until a profile is verified, `school_id` is null and the badge is too — which is the
 * correct state for phase 0, where no verification path exists yet.
 *
 * `major` is used as stored. Abbreviating "Computer Science" to "CS" needs a curated
 * majors lookup that does not exist yet; adding one only changes this function.
 */
create or replace function public.set_comment_badge()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  school_label text;
  badge        text;
begin
  if new.school_id is null then
    new.comment_badge := null;
    return new;
  end if;

  select coalesce(nullif(btrim(s.short_name), ''), s.name)
    into school_label
    from public.schools s
   where s.id = new.school_id;

  badge := concat_ws(' @ ', nullif(btrim(coalesce(new.major, '')), ''), school_label);

  if new.graduation_year is not null then
    -- chr(39) rather than an escaped quote: the apostrophe in "'27" is easy to get
    -- wrong inside a quoted function body and impossible to get wrong this way.
    badge := badge || ' ' || chr(39) || lpad((new.graduation_year % 100)::text, 2, '0');
  end if;

  new.comment_badge := nullif(btrim(badge), '');
  return new;
end;
$$;

create trigger profiles_set_comment_badge
  before insert or update of school_id, major, graduation_year on public.profiles
  for each row execute function public.set_comment_badge();

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ── user_preferences ───────────────────────────────────────────────────────────

-- §3.1: split from profiles because identity is read on every comment render while
-- preferences are read by the ranking engine on every feed build, and the two have
-- different privacy classes.
create table public.user_preferences (
  user_id                    uuid primary key references public.profiles (id) on delete cascade,
  preferred_roles            text[] not null default '{}',
  preferred_locations        text[] not null default '{}',
  preferred_employment_types public.employment_type[] not null default '{}',
  min_salary_annual          integer,
  open_to_remote             boolean not null default true,
  -- Bounds match MIN_WEEKLY_GOAL / MAX_WEEKLY_GOAL in constants/goal.ts.
  weekly_goal                smallint not null default 7
                               check (weekly_goal between 3 and 30),
  notification_prefs         jsonb not null default '{}',
  updated_at                 timestamptz not null default now()
);

create trigger user_preferences_set_updated_at
  before update on public.user_preferences
  for each row execute function public.set_updated_at();

-- ── provisioning ───────────────────────────────────────────────────────────────

/*
 * Gives every auth.users row its profile and preferences, and moves `none` → `email`
 * once any email is confirmed (§3.2's first rung).
 *
 * This runs inside the signup transaction: if it raises, signup fails with an opaque
 * "Database error saving new user". Every column it writes is nullable and every insert
 * is idempotent, so there is nothing here that can raise.
 *
 * Name metadata differs per provider — Google sends given_name/family_name, Apple sends
 * only what the client copies into user metadata on first sign-in, email OTP sends
 * nothing. All three are handled; none of them are required.
 */
create or replace function public.handle_auth_user_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  meta      jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  full_name text;
  given     text;
  family    text;
begin
  full_name := nullif(btrim(coalesce(meta ->> 'full_name', meta ->> 'name', '')), '');
  given     := nullif(btrim(coalesce(meta ->> 'given_name', '')), '');
  family    := nullif(btrim(coalesce(meta ->> 'family_name', '')), '');

  if given is null and full_name is not null then
    given := nullif(split_part(full_name, ' ', 1), '');
  end if;

  if family is null and full_name is not null then
    family := nullif(btrim(substr(full_name, length(split_part(full_name, ' ', 1)) + 1)), '');
  end if;

  insert into public.profiles (id, first_name, last_name)
  values (new.id, given, family)
  on conflict (id) do nothing;

  insert into public.user_preferences (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  if new.email_confirmed_at is not null then
    update public.profiles
       set verification_tier = 'email'
     where id = new.id
       and verification_tier = 'none';
  end if;

  return new;
end;
$$;

create trigger on_auth_user_change
  after insert or update of email_confirmed_at on auth.users
  for each row execute function public.handle_auth_user_change();

-- ── authorization ──────────────────────────────────────────────────────────────

alter table public.schools           enable row level security;
alter table public.profiles          enable row level security;
alter table public.user_preferences  enable row level security;

/*
 * RLS decides which *rows* a user reaches; column grants decide which *fields* they may
 * write. Both are needed here: without the column grant an authenticated user could
 * PATCH their own `verification_tier` to 'identity' and mint themselves a verified
 * badge, because RLS has no way to express "this row, but not that column".
 *
 * Supabase's default privileges grant everything on new public tables to anon and
 * authenticated, so each table is revoked first and then granted back narrowly.
 * service_role is left alone — the API service and background jobs run as it.
 */

revoke all on public.schools          from anon, authenticated;
revoke all on public.profiles         from anon, authenticated;
revoke all on public.user_preferences from anon, authenticated;

grant select on public.schools to authenticated;

create policy schools_read_all on public.schools
  for select to authenticated
  using (true);

grant select on public.profiles to authenticated;
grant update (
  handle, first_name, last_name, avatar_color,
  school_name_raw, major, graduation_year, location,
  onboarding_completed_at
) on public.profiles to authenticated;

create policy profiles_select_own on public.profiles
  for select to authenticated
  using ((select auth.uid()) = id and deleted_at is null);

create policy profiles_update_own on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id and deleted_at is null)
  with check ((select auth.uid()) = id);

-- No insert policy: profiles are provisioned by handle_auth_user_change, so a client
-- has no way to author a row for an id that is not its own.

grant select on public.user_preferences to authenticated;
grant update (
  preferred_roles, preferred_locations, preferred_employment_types,
  min_salary_annual, open_to_remote, weekly_goal, notification_prefs
) on public.user_preferences to authenticated;

create policy user_preferences_select_own on public.user_preferences
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy user_preferences_update_own on public.user_preferences
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
