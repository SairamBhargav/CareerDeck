/*
 * A third refresh brought back the first deck.
 *
 * ── What was wrong ────────────────────────────────────────────────────────────
 *
 * The previous migration demoted the last session's postings, which made consecutive
 * refreshes genuinely different and stopped there. Demoting only the *immediately*
 * previous session frees the one before it, and since the ranking is deterministic it
 * comes back in precisely the order it had. Measured on the account with the most history,
 * six builds in a row:
 *
 *   refresh   shares with the one before   shares with the first
 *      2            0 of 20                      0 of 20
 *      3            0 of 20                     20 of 20   <- deck one, entire
 *      4            0 of 20                      0 of 20
 *      5            0 of 20                     20 of 20
 *
 *   distinct postings across six top-twenties: 40 of a possible 120
 *
 * Two decks, alternating forever.
 *
 * ── Why it could not simply remember more sessions ────────────────────────────
 *
 * Because the unit was wrong. A session holds two hundred postings and the reader sees
 * about twenty of them before pulling again, so demoting whole sessions spends the
 * candidate pool three times faster than anyone consumes it: that account has 688
 * candidates, which is three sessions and change. Remembering more sessions would have run
 * the pool dry instead of cycling.
 *
 * ── What it does now ──────────────────────────────────────────────────────────
 *
 * Demotes the top twenty of each of the last ten sessions — what was actually on screen,
 * rather than what was queued behind it. That is at most two hundred postings held back
 * out of 688, so there is room for roughly ten distinct decks before anything repeats,
 * against two before.
 *
 * Still demotion rather than exclusion, for the same reason as before: a reader with a
 * narrow profile has a small pool, and sorting degrades where filtering empties.
 *
 * ── Unverified ────────────────────────────────────────────────────────────────
 *
 * No local Postgres, so this has not been run. The behaviour it replaces was measured;
 * this SQL is not. The check after pushing is the same six-build comparison — "shares with
 * the first" should stay near zero across all of them rather than flipping to 20.
 */

create or replace function public.build_feed_session(
  p_user_id    uuid,
  p_surface    public.feed_surface default 'reels',
  p_size       integer default 200,
  p_experiment text default 'ranked_feed_v1'
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  weights    jsonb   := public.active_weights();
  arm        public.feed_arm := public.experiment_arm(p_user_id, p_experiment);
  size       integer := least(greatest(coalesce(p_size, 200), 20), 500);
  families   text[]  := public.user_job_families(p_user_id);
  resume_keys text[];
  my_school  uuid;
  session_id uuid;
  ordered    uuid[]  := '{}';
  parts      jsonb   := '{}';
  rec        record;
  recent_companies uuid[] := '{}';
  title_counts     jsonb  := '{}';
  emitted          integer := 0;
  explore_taken    integer := 0;
  /*
   * What the reader has actually had on screen lately: the top twenty of each of the last
   * ten sessions on this surface.
   *
   * The top twenty rather than the whole session, because a session holds two hundred and
   * nobody scrolls that far — demoting all of it spent the candidate pool three times
   * faster than the reader was consuming it.
   *
   * Sorted to the back rather than filtered out: a narrow profile can have barely more
   * candidates than one session, and excluding outright would hand back an empty deck.
   */
  previous         uuid[] := '{}';
begin
  if p_user_id is null then
    raise exception 'no user' using errcode = 'CD401';
  end if;

  select coalesce(array_agg(distinct id), '{}') into previous
    from (
      select unnest(fs.job_ids[1:20]) as id
        from public.feed_sessions fs
       where fs.user_id = p_user_id and fs.surface = p_surface
       order by fs.created_at desc
       limit 10
    ) recent;
  previous := coalesce(previous, '{}');

  -- The control arm: phase 1's feed, unchanged. See phase 5.
  if arm = 'recency' then
    select array_agg(c.job_id order by j.posted_at desc)
      into ordered
      from public.candidate_pool(p_user_id, size) c
      join public.jobs j on j.id = c.job_id;

    ordered := coalesce(ordered, '{}');

    insert into public.feed_sessions (user_id, surface, job_ids, arm, experiment, components)
    values (p_user_id, p_surface, ordered[1:size], 'recency', p_experiment, '{}')
    returning id into session_id;

    return session_id;
  end if;

  select coalesce(p.school_id, p.school_id_claimed) into my_school
    from public.profiles p where p.id = p_user_id;

  -- The resume's skills as dictionary keys, once. Keying them inside skill_jaccard repeated the
  -- same lookups for every posting in the pool.
  select array(select distinct public.skill_key(s)
                 from unnest(coalesce(rp.skills, '{}')) s
                where btrim(s) <> '')
    into resume_keys
    from public.resumes r
    join public.resume_profiles rp on rp.resume_id = r.id
   where r.user_id = p_user_id and r.is_default and r.deleted_at is null
     and r.parse_status = 'parsed';
  resume_keys := coalesce(resume_keys, '{}');

  for rec in
    with pool as (select * from public.personal_candidate_pool(p_user_id, 600)),
    prefs as (
      select up.preferred_roles, up.preferred_locations, up.open_to_remote
        from public.user_preferences up where up.user_id = p_user_id
    ),
    followed as (
      select company_id from public.company_follows where user_id = p_user_id
    ),
    engaged_companies as (
      select distinct j.company_id
        from public.job_interactions ji
        join public.jobs j on j.id = ji.job_id
       where ji.user_id = p_user_id and ji.kind in ('like', 'save')
    ),
    engaged_industries as (
      select distinct c.industry
        from engaged_companies ec
        join public.companies c on c.id = ec.company_id
       where c.industry is not null
    ),
    cohort as (
      select a.job_id, count(*)::numeric as n
        from public.applications a
        join public.profiles p on p.id = a.user_id
       where my_school is not null
         and coalesce(p.school_id, p.school_id_claimed) = my_school
         and a.user_id <> p_user_id
       group by a.job_id
    ),
    cohort_max as (select greatest(max(n), 1) as m from cohort),
    popular as (
      select ji.job_id, count(*)::numeric as n
        from public.job_interactions ji
       where ji.kind in ('like', 'save')
       group by ji.job_id
    ),
    popular_max as (select greatest(max(n), 1) as m from popular),
    seen as (
      select i.job_id, count(*)::integer as n
        from public.job_impressions i
       where i.user_id = p_user_id
         and i.shown_at > now() - interval '30 days'
         and not exists (
           select 1 from public.job_interactions ji
            where ji.user_id = p_user_id and ji.job_id = i.job_id
              and ji.kind in ('like', 'save')
         )
       group by i.job_id
    )
    select j.id,
           j.company_id,
           j.title_normalized,
           pool.source,
           s.result,
           (s.result ->> 'score')::int as score,
           (followed.company_id is not null
            or engaged.company_id is not null)          as known_company
      from pool
      join public.jobs j on j.id = pool.job_id
      join public.companies co on co.id = j.company_id
      left join followed on followed.company_id = j.company_id
      left join engaged_companies engaged on engaged.company_id = j.company_id
      cross join lateral (
        select public.rank_score(
          weights,
          public.pref_match(j.title_normalized, j.location_city, j.location_region,
                            j.location_type,
                            (select p.preferred_roles from prefs p),
                            (select p.preferred_locations from prefs p),
                            (select p.open_to_remote from prefs p)),
          public.skill_jaccard_keys(resume_keys, j.skills),
          public.recency_score(j.posted_at),
          case
            when followed.company_id is not null then 1.0
            when engaged.company_id is not null then 0.6
            when co.industry is not null
                 and co.industry in (select i.industry from engaged_industries i) then 0.4
            else null
          end::numeric,
          j.quality_score::numeric,
          public.urgency_score(j.closes_at),
          case when (select c.m from cohort_max c) > 0
               then round(coalesce((select c.n from cohort c where c.job_id = j.id), 0)
                          / (select c.m from cohort_max c), 4) end,
          round(coalesce((select p.n from popular p where p.job_id = j.id), 0)
                / (select p.m from popular_max p), 4),
          coalesce((select s2.n from seen s2 where s2.job_id = j.id), 0),
          -- fieldMatch: null when the reader has no fields, so renormalization drops it.
          case
            when families is null then null
            when j.job_family = any (families) then 1.0
            when j.job_family is null then 0.3
            else 0.0
          end::numeric
        ) as result
        -- Keeps the subquery from being flattened: flattened, rank_score and its inputs ran once
        -- per reference to `s.result` below, three or four times per posting.
        offset 0
      ) s
     where s.result is not null
     -- Anything from the last deck goes behind everything else, then the usual ranking
     -- decides the order within each group.
     order by (j.id = any (previous)),
              (s.result ->> 'score')::int desc,
              j.posted_at desc
  loop
    continue when (
      select count(*) from unnest(recent_companies) rc where rc = rec.company_id
    ) >= 2;

    continue when coalesce((title_counts ->> rec.title_normalized)::int, 0) >= 3;

    if emitted > 0 and emitted % 7 = 0 and not rec.known_company then
      explore_taken := explore_taken + 1;
    elsif emitted > 0 and emitted % 7 = 0 and rec.known_company and explore_taken * 7 < emitted then
      continue;
    end if;

    ordered := ordered || rec.id;
    parts := parts || jsonb_build_object(rec.id::text,
                        (rec.result -> 'components')
                          || jsonb_build_object('score', rec.score, 'source', rec.source));

    recent_companies := (array_append(recent_companies, rec.company_id));
    if array_length(recent_companies, 1) > 10 then
      recent_companies := recent_companies[2:];
    end if;

    title_counts := title_counts || jsonb_build_object(
      rec.title_normalized,
      coalesce((title_counts ->> rec.title_normalized)::int, 0) + 1);

    emitted := emitted + 1;
    exit when emitted >= size;
  end loop;

  insert into public.feed_sessions (user_id, surface, job_ids, arm, experiment, components)
  values (p_user_id, p_surface, ordered, 'ranked', p_experiment, parts)
  returning id into session_id;

  return session_id;
end;
$fn$;
