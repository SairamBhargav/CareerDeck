/*
 * Three free looks a week at the match breakdown (2026-10-08).
 *
 * The breakdown is a Pro feature. A free reader sees the score and how it adds up, and can open
 * the rest (skills, experience, eligibility, what would raise it) on three postings a week.
 * Opening a posting already opened this week costs nothing.
 *
 * Counted here rather than on the device, so reinstalling or a second phone does not reset it.
 *
 * The week is the reader's own, Monday to Sunday in their time zone, as everywhere else in the
 * app (utils/week.ts). The app sends its Monday; the server accepts only a Monday within a day of
 * its own idea of the date, which is as much room as time zones need and no more.
 *
 * Note what this does not protect: the components behind the blur reach the device either way,
 * since they ride on the feed page with the score. This counts looks honestly; it does not hide
 * data from someone reading their own network traffic, and nothing in the breakdown is anyone
 * else's.
 */

create table public.match_looks (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  week_start date not null check (extract(isodow from week_start) = 1),
  job_id     uuid not null references public.jobs (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, week_start, job_id)
);

-- The prunes delete jobs; without this each deleted job scans the table (20261020000000).
create index match_looks_job_idx on public.match_looks (job_id);

alter table public.match_looks enable row level security;
revoke all on public.match_looks from anon, authenticated;

/* The free allowance. One place, so the app's copy and the check cannot disagree. */
create or replace function public.match_look_limit()
returns integer
language sql
immutable
set search_path = ''
as $fn$ select 3 $fn$;

/*
 * The week the app named, or an error if it is not a plausible one: a Monday no more than eight
 * days before today and no later than tomorrow (UTC), which covers every time zone.
 */
create or replace function public.match_look_week(p_week date)
returns date
language plpgsql
stable
set search_path = ''
as $fn$
begin
  if p_week is null
     or extract(isodow from p_week) <> 1
     or p_week < (now() at time zone 'utc')::date - 8
     or p_week > (now() at time zone 'utc')::date + 1 then
    raise exception 'not this week' using errcode = '22023';
  end if;
  return p_week;
end;
$fn$;

/*
 * Where the reader stands for one posting: whether its breakdown is open to them, and how many
 * looks this week has left. Pro readers are always open and are never counted.
 */
create or replace function public.match_look_state(p_job_id uuid, p_week date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  uid  uuid := (select auth.uid());
  week date := public.match_look_week(p_week);
  used integer;
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
    'limit', public.match_look_limit()
  );
end;
$fn$;

/*
 * Spends one of the week's looks on a posting, or confirms one already spent. Refuses with
 * `open: false` when the week's looks are gone; never raises for that, since it is an ordinary
 * answer the sheet shows.
 */
create or replace function public.claim_match_look(p_job_id uuid, p_week date)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  uid  uuid := (select auth.uid());
  week date := public.match_look_week(p_week);
  used integer;
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

  -- Two taps racing must not both take the third look.
  perform pg_advisory_xact_lock(hashtextextended('match_looks:' || uid::text, 0));

  if exists (select 1 from public.match_looks where user_id = uid and week_start = week and job_id = p_job_id) then
    select count(*) into used from public.match_looks where user_id = uid and week_start = week;
    return jsonb_build_object('open', true, 'pro', false, 'used', used, 'limit', public.match_look_limit());
  end if;

  select count(*) into used from public.match_looks where user_id = uid and week_start = week;
  if used >= public.match_look_limit() then
    return jsonb_build_object('open', false, 'pro', false, 'used', used, 'limit', public.match_look_limit());
  end if;

  insert into public.match_looks (user_id, week_start, job_id) values (uid, week, p_job_id);
  -- Old weeks answer nothing; the reader's own rows are the only ones this ever touches.
  delete from public.match_looks where user_id = uid and week_start < week - 28;

  return jsonb_build_object('open', true, 'pro', false, 'used', used + 1, 'limit', public.match_look_limit());
end;
$fn$;

revoke all on function public.match_look_limit()              from public, anon, authenticated;
revoke all on function public.match_look_week(date)           from public, anon, authenticated;
revoke all on function public.match_look_state(uuid, date)    from public, anon;
revoke all on function public.claim_match_look(uuid, date)    from public, anon;
grant execute on function public.match_look_state(uuid, date) to authenticated;
grant execute on function public.claim_match_look(uuid, date) to authenticated;
