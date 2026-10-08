/*
 * One way to say yes to a posting.
 *
 * ── What was wrong ────────────────────────────────────────────────────────────
 *
 * `like` and `save` were two words for one intent. In an app about photographs they are
 * genuinely different — you like a picture you will never look at again, and save one you
 * will. In an app about jobs they collapse: liking a posting *is* keeping it.
 *
 * The ranker had already decided this. Every scoring path reads `kind in ('like', 'save')`
 * — phase 5, phase 8, and the feed-session work — so for the purpose that matters the two
 * have always been one signal. What the split bought was a bookmark and a heart sitting
 * beside each other on the job page, and two collections holding the same kind of thing.
 *
 * ── What this changes ─────────────────────────────────────────────────────────
 *
 * Only the two places that read `save` alone, both of them notifications:
 * `generate_deadline_reminders`, and the closing-soon section of `claim_digest_batch`.
 *
 * That is not a like-for-like swap in effect. There has never been a single `save` row in
 * this database, so both have been selecting from an empty set since the day they were
 * written — neither has ever sent anything. Pointing them at `like` turns them on for the
 * first time, which is worth knowing before this is pushed: readers who have liked a
 * posting that closes within three days will start getting told so.
 *
 * ── What this does not change ─────────────────────────────────────────────────
 *
 * No backfill, because there is nothing to move. Zero `save` rows exist, so nobody loses a
 * list.
 *
 * The enum keeps `save`. Dropping a value from a Postgres enum means rebuilding the type
 * and every column using it — a real outage risk traded for tidiness — and an unused label
 * costs nothing. `viewer_state()` still returns `saved_job_ids`, now permanently empty and
 * no longer read by the client.
 *
 * ── How this file was written ─────────────────────────────────────────────────
 *
 * Both bodies were lifted verbatim from 20260930000000_phase7_launch.sql
 * and had exactly two substitutions applied: the `kind` predicate, and the sentence in the
 * payload that told the reader they had saved it. `create or replace` needs the whole body,
 * and retyping plpgsql to change one word is how a clause goes missing.
 */


create or replace function public.generate_deadline_reminders(p_within_days integer default 3)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  written integer;
begin
  insert into public.notifications (user_id, kind, subject_type, subject_id, payload)
  select i.user_id, 'deadline', 'job', j.id, jsonb_build_object(
           'job_id', j.id,
           'closes_at', j.closes_at,
           'headline', j.title || ' closes ' ||
             case when j.closes_at < now() + interval '1 day' then 'within a day'
                  else 'in ' || ceil(extract(epoch from j.closes_at - now()) / 86400)::int || ' days' end,
           'detail', j.company_name || ' — you liked this one.'
         )
    from public.job_interactions i
    join public.jobs j on j.id = i.job_id
    join public.profiles p on p.id = i.user_id and p.deleted_at is null
   where i.kind = 'like'
     and j.status = 'open'
     and j.closes_at between now() and now() + make_interval(days => p_within_days)
     and not exists (select 1 from public.applications a where a.user_id = i.user_id and a.job_id = j.id)
  on conflict (user_id, subject_id) where kind = 'deadline' do nothing;

  get diagnostics written = row_count;
  return written;
end;
$fn$;

create or replace function public.claim_digest_batch(p_week_start date, p_limit integer default 50)
returns setof public.digest_job
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  r        record;
  v_new    jsonb;
  v_closing jsonb;
  v_goal   jsonb;
  job      public.digest_job;
  claimed  integer := 0;
begin
  if extract(isodow from p_week_start) <> 1 then
    raise exception 'a week starts on a Monday' using errcode = '22023';
  end if;

  for r in
    select p.id, u.email, p.first_name, up.weekly_goal
      from public.profiles p
      join auth.users u on u.id = p.id
      join public.user_preferences up on up.user_id = p.id
     where p.deleted_at is null
       and u.email is not null and u.email_confirmed_at is not null
       and public.notification_pref(up.notification_prefs, 'email', 'digest')
       and not exists (select 1 from public.digest_sends d where d.user_id = p.id and d.week_start = p_week_start)
     order by p.id
     limit greatest(p_limit, 1) * 4
  loop
    exit when claimed >= p_limit;

    insert into public.digest_sends (user_id, week_start) values (r.id, p_week_start)
    on conflict do nothing;
    if not found then continue; end if;  -- another sender claimed this reader

    select coalesce(jsonb_agg(x order by x ->> 'posted_at' desc), '[]') into v_new from (
      select jsonb_build_object('id', j.id, 'title', j.title, 'company', j.company_name,
                                'location', j.location_raw, 'posted_at', j.posted_at) x
        from public.jobs j
        join public.company_follows f on f.company_id = j.company_id and f.user_id = r.id
       where j.status = 'open' and j.first_seen_at >= p_week_start - 7
       order by j.posted_at desc
       limit 5
    ) q;

    select coalesce(jsonb_agg(x order by x ->> 'closes_at'), '[]') into v_closing from (
      select jsonb_build_object('id', j.id, 'title', j.title, 'company', j.company_name,
                                'closes_at', j.closes_at) x
        from public.job_interactions i
        join public.jobs j on j.id = i.job_id
       where i.user_id = r.id and i.kind = 'like' and j.status = 'open'
         and j.closes_at between now() and now() + interval '7 days'
         and not exists (select 1 from public.applications a where a.user_id = r.id and a.job_id = j.id)
       limit 5
    ) q;

    if jsonb_array_length(v_new) = 0 and jsonb_array_length(v_closing) = 0 then
      update public.digest_sends set status = 'skipped' where user_id = r.id and week_start = p_week_start;
      continue;
    end if;

    v_goal := jsonb_build_object(
      'target', r.weekly_goal,
      'last_week', public.applications_in_week(r.id, p_week_start - 7)
    );

    claimed := claimed + 1;
    job.user_id    := r.id;
    job.email      := r.email;
    job.first_name := r.first_name;
    job.content    := jsonb_build_object('new_jobs', v_new, 'closing', v_closing, 'goal', v_goal,
                                         'credits', public.credit_balance(r.id));
    return next job;
  end loop;
end;
$fn$;

comment on function public.generate_deadline_reminders(integer) is
  'Warns a reader that a posting they liked is about to close. Read ''save'' until '
  '2026-10-08, when like became the only way to keep a posting.';
