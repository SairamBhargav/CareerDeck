/*
 * Make match_scores fit inside the 8 s statement timeout again.
 *
 * Measured on hosted 2026-10-07: the Deck's Explore feed asked for 20 unscored postings and
 * match_scores ran 19 s, hit 57014, and the app read the failure as "no scores", so the ring
 * stayed hidden. Following was unaffected because its postings were mostly scored already.
 *
 * The parts were cheap: skill_fit 76 ms, location 15 ms and seniority 3 ms for all 20 postings.
 * compute_match_v2 as a whole took 2.9 s, because the planner inlines single-use CTEs. `fit` was
 * pasted into every `f` reference, those references sit inside `skill`, and `skill` is pasted
 * into weighted, capped and the final select. So skill_fit, the one function that reads tables,
 * ran dozens of times per posting. On top of that, match_scores' lateral subquery was flattened,
 * so compute_match_v2 itself ran three times per row: once in the not-null filter, then once each
 * for score and components.
 *
 * Bodies are unchanged except `as materialized` on fit and parts, and `offset 0` on the lateral,
 * which together make each function run once per posting.
 */

create or replace function public.compute_match_v2(
  p_resume_skills    text[],
  p_resume_seniority public.seniority_level,
  p_families         text[],
  p_job_skills       text[],
  p_job_seniority    public.seniority_level,
  p_job_family       text,
  p_job_city         text,
  p_job_region       text,
  p_job_type         public.location_type,
  p_preferred_locs   text[],
  p_remote_ok        boolean
)
returns jsonb
language sql
stable
set search_path = ''
as $fn$
  with fit as materialized (
    select public.skill_fit(p_resume_skills, p_job_skills) as f
  ), parts as materialized (
    select f,
           case
             when (f ->> 'core')::int = 0 or (f ->> 'resume')::int = 0 then null
             else least(1.0, jsonb_array_length(f -> 'matched')::numeric / (f ->> 'core')::numeric / 0.6)
           end                                                                        as skill,
           public.field_affinity(p_job_family, p_families)                            as field,
           public.seniority_affinity(p_resume_seniority, p_job_seniority)            as sen,
           public.location_affinity(p_job_city, p_job_region, p_job_type,
                                    p_preferred_locs, p_remote_ok)                    as loc
      from fit
  ), weighted as (
    select *,
           coalesce(skill * 0.45, 0) + coalesce(field * 0.25, 0)
             + coalesce(sen * 0.20, 0) + coalesce(loc * 0.10, 0)                       as total,
           case when skill is null then 0 else 0.45 end + case when field is null then 0 else 0.25 end
             + case when sen is null then 0 else 0.20 end + case when loc is null then 0 else 0.10 end
                                                                                      as denom
      from parts
  ), capped as (
    select *,
           least(
             round(100 * total / nullif(denom, 0)),
             case when field is not null and field <= 0.1 then 35 else 100 end,
             case when field is not null and field <= 0.35 then 60 else 100 end,
             case when sen is not null and sen <= 0.3 then 40 else 100 end,
             case when skill is null and field is null then 55
                  when skill is null and field <= 0.35 then 45
                  when skill is null then 70 else 100 end
           ) as score
      from weighted
  )
  select case
           -- Without skills or a field there is nothing to say about fit, only about level.
           when denom = 0 or (skill is null and field is null and loc is null) then null
           else jsonb_build_object(
             'score', greatest(0, score)::int,
             'components', jsonb_strip_nulls(jsonb_build_object(
               'skills',    round(skill, 2),
               'field',     round(field, 2),
               'seniority', round(sen, 2),
               'location',  round(loc, 2),
               'matched',   f -> 'matched',
               'missing',   f -> 'missing',
               'jobFamily', p_job_family,
               'limited',   skill is null
             )),
             'coverage', round(denom, 2)
           )
         end
    from capped;
$fn$;

create or replace function public.match_scores(p_job_ids uuid[])
returns table (job_id uuid, score smallint, components jsonb, computed_at timestamptz)
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
#variable_conflict use_column
declare
  uid       uuid := (select auth.uid());
  resume    record;
  prefs     record;
  families  text[];
  ids       uuid[] := p_job_ids[1:200];
  version   constant smallint := 2;
begin
  if uid is null or ids is null or array_length(ids, 1) is null then
    return;
  end if;

  select r.id as resume_id, p.skills, p.seniority
    into resume
    from public.resumes r
    join public.resume_profiles p on p.resume_id = r.id
   where r.user_id = uid
     and r.is_default
     and r.deleted_at is null
     and r.parse_status = 'parsed';

  if resume.resume_id is null then
    return;
  end if;

  select up.preferred_locations, up.open_to_remote into prefs
    from public.user_preferences up where up.user_id = uid;
  families := public.resume_job_families(uid);

  insert into public.job_match_scores (user_id, job_id, resume_id, score, components, scorer_version)
  select uid,
         j.id,
         resume.resume_id,
         (m.result ->> 'score')::smallint,
         (m.result -> 'components') || jsonb_build_object('coverage', m.result -> 'coverage'),
         version
    from public.jobs j
    cross join lateral (
      select public.compute_match_v2(
               resume.skills, resume.seniority, families,
               j.skills, j.seniority, j.job_family,
               j.location_city, j.location_region, j.location_type,
               prefs.preferred_locations, prefs.open_to_remote
             ) as result
      offset 0  -- keeps the subquery from being flattened, which would run the function per reference
    ) m
   where j.id = any (ids)
     and m.result is not null
     and not exists (
       select 1 from public.job_match_scores s
        where s.user_id = uid and s.job_id = j.id and s.resume_id = resume.resume_id
          and s.scorer_version = version
          and s.computed_at >= j.updated_at
     )
  on conflict (user_id, job_id) do update
    set resume_id      = excluded.resume_id,
        score          = excluded.score,
        components     = excluded.components,
        scorer_version = excluded.scorer_version,
        computed_at    = now();

  return query
    select s.job_id, s.score, s.components, s.computed_at
      from public.job_match_scores s
     where s.user_id = uid
       and s.job_id = any (ids)
       and s.resume_id = resume.resume_id
       and s.scorer_version = version;
end;
$fn$;
