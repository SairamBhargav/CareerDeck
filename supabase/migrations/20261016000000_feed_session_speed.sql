/*
 * Make building a Deck session fast enough that opening the app doesn't stall on it.
 *
 * Measured on hosted 2026-10-07: every app reload starts a new Explore session, and
 * ranked_feed's first page took 2.9 s, nearly all of it build_feed_session (2.5 s). Two causes:
 *
 * 1. The ranking lateral was flattened into the outer query, which reads `s.result` in its
 *    filter, its select list and its ORDER BY. So rank_score and every input to it, skill_jaccard
 *    included, ran three or four times per posting in a 600-posting pool. The same planner
 *    behaviour 20261014000000 fixed in match_scores. `offset 0` keeps the subquery whole.
 *    Alone this took the build from 2.5 s to 0.9 s, with the same order and components.
 *
 * 2. skill_jaccard keyed the resume's skills (one dictionary probe each) for every posting:
 *    24 skills across 600 postings is 14,400 probes for one answer. The resume is now keyed
 *    once, and skill_jaccard_keys takes the keys directly.
 *
 * skill_jaccard keeps its signature for match v1 and anything else that calls it.
 */

/*
 * skill_jaccard with the left side already keyed: `p_left_keys` is the distinct output of
 * skill_key() over the resume's non-blank skills. Same result as skill_jaccard(skills, p_right).
 */
create or replace function public.skill_jaccard_keys(p_left_keys text[], p_right text[])
returns numeric
language sql
stable
set search_path = ''
as $fn$
  with l as (select distinct k from unnest(coalesce(p_left_keys, '{}')) k),
       r as (select distinct public.skill_key(s) as k from unnest(coalesce(p_right, '{}')) s
              where btrim(s) <> '')
  select case
           when (select count(*) from r) = 0 then null
           when (select count(*) from l) = 0 then 0::numeric
           else round(
             (select count(*) from l join r on l.k = r.k)::numeric
             / nullif((select count(*) from (select k from l union select k from r) u), 0),
             4)
         end;
$fn$;

revoke all on function public.skill_jaccard_keys(text[], text[]) from public, anon, authenticated;

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
begin
  if p_user_id is null then
    raise exception 'no user' using errcode = 'CD401';
  end if;

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
     order by (s.result ->> 'score')::int desc, j.posted_at desc
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
