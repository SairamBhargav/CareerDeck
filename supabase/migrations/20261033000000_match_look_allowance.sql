/*
 * A weekly look allowance per account (2026-10-10).
 *
 * Free readers get three looks a week at the match breakdown (20261025000000). This lets one
 * account have a different number, for testing the free view without running out. A row here
 * replaces the weekly limit for that account; no row means the usual three.
 *
 * Written only by hand, as the service role: readers cannot see or change their own row.
 */

create table public.match_look_allowances (
  user_id      uuid primary key references public.profiles (id) on delete cascade,
  weekly_limit integer not null check (weekly_limit between 0 and 10000),
  created_at   timestamptz not null default now()
);

alter table public.match_look_allowances enable row level security;
revoke all on public.match_look_allowances from anon, authenticated;

/* The reader's weekly limit: their own allowance if they have one, otherwise the free one. */
create or replace function public.match_look_limit_for(p_user_id uuid)
returns integer
language sql
stable
set search_path = ''
as $fn$
  select coalesce(
    (select weekly_limit from public.match_look_allowances where user_id = p_user_id),
    public.match_look_limit()
  )
$fn$;

/* As in 20261025000000, with the reader's own limit in place of the fixed one. */
create or replace function public.match_look_state(p_job_id uuid, p_week date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  uid   uuid := (select auth.uid());
  week  date := public.match_look_week(p_week);
  used  integer;
begin
  if uid is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  if (public.viewer_plan(uid)).id <> 'free' then
    return jsonb_build_object('open', true, 'pro', true);
  end if;

  select count(*) into used from public.match_looks where user_id = uid and week_start = week;
  return jsonb_build_object(
    'open',  exists (select 1 from public.match_looks
                      where user_id = uid and week_start = week and job_id = p_job_id),
    'pro',   false,
    'used',  used,
    'limit', public.match_look_limit_for(uid)
  );
end;
$fn$;

create or replace function public.claim_match_look(p_job_id uuid, p_week date)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  uid   uuid := (select auth.uid());
  week  date := public.match_look_week(p_week);
  lim   integer;
  used  integer;
begin
  if uid is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  if (public.viewer_plan(uid)).id <> 'free' then
    return jsonb_build_object('open', true, 'pro', true);
  end if;
  if not exists (select 1 from public.jobs where id = p_job_id) then
    raise exception 'no such job' using errcode = '23503';
  end if;

  -- Two taps racing must not both take the last look.
  perform pg_advisory_xact_lock(hashtextextended('match_looks:' || uid::text, 0));
  lim := public.match_look_limit_for(uid);

  if exists (select 1 from public.match_looks where user_id = uid and week_start = week and job_id = p_job_id) then
    select count(*) into used from public.match_looks where user_id = uid and week_start = week;
    return jsonb_build_object('open', true, 'pro', false, 'used', used, 'limit', lim);
  end if;

  select count(*) into used from public.match_looks where user_id = uid and week_start = week;
  if used >= lim then
    return jsonb_build_object('open', false, 'pro', false, 'used', used, 'limit', lim);
  end if;

  insert into public.match_looks (user_id, week_start, job_id) values (uid, week, p_job_id);
  -- Old weeks answer nothing; the reader's own rows are the only ones this ever touches.
  delete from public.match_looks where user_id = uid and week_start < week - 28;

  return jsonb_build_object('open', true, 'pro', false, 'used', used + 1, 'limit', lim);
end;
$fn$;

revoke all on function public.match_look_limit_for(uuid) from public, anon, authenticated;
