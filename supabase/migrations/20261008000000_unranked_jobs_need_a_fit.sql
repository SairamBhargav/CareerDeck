/*
 * Unranked jobs stop reaching students' decks (2026-09-30).
 *
 * PHASE8.md §3.2 let a job with no detected seniority through every stage filter, on the
 * theory that an unranked posting should sort on its other merits. In practice unranked meant
 * "the title said nothing", and a sophomore's candidate pool (target: intern) was
 * 407 unranked full-time roles to 193 internships, many asking for 5-10 years.
 *
 * Two halves. The crawler now reads the years a description asks for (normalize/seniority.ts),
 * so far fewer jobs are unranked at all. And here, a reader whose stage allows only internships
 * gets an unranked job only when it is an internship: a full-time role with a silent title is
 * no more an internship than one that says "Senior". Readers who target new_grad or mid keep
 * seeing unranked jobs, since for them a silent title is usually exactly their level.
 */

create or replace function public.seniority_fits(
  p_seniority   public.seniority_level,
  p_employment  public.employment_type,
  p_targets     public.seniority_level[]
)
returns boolean
language sql
immutable
set search_path = ''
as $fn$
  select p_targets is null
      or p_seniority = any (p_targets)
      or (p_seniority is null
          and (p_employment = 'Internship'
               or 'new_grad' = any (p_targets)
               or 'mid' = any (p_targets)));
$fn$;

create or replace function public.personal_candidate_pool(
  p_user_id uuid,
  p_limit   integer default 600
)
returns table (job_id uuid, source text)
language plpgsql
stable
set search_path = ''
as $fn$
declare
  families    text[] := public.user_job_families(p_user_id);
  seniorities public.seniority_level[] := public.target_seniorities(p_user_id);
  types       public.employment_type[];
  since       timestamptz := now() - interval '30 days';
  fitting     integer;
begin
  select coalesce(up.preferred_employment_types, '{}') into types
    from public.user_preferences up where up.user_id = p_user_id;
  types := coalesce(types, '{}');

  /*
   * Decision D: 30 days, widened to 60 when fewer than 150 jobs fit. Counted with the same
   * filters the fit arm uses, capped so a large corpus does not count past the question.
   */
  select count(*) into fitting from (
    select 1 from public.jobs j
     where j.status = 'open' and j.quality_score > 0.3 and j.posted_at > since
       and (families is null or j.job_family = any (families))
       and public.seniority_fits(j.seniority, j.employment_type, seniorities)
       and (cardinality(types) = 0 or j.employment_type = any (types))
     limit 150) c;
  if fitting < 150 then
    since := now() - interval '60 days';
  end if;

  return query
  with excluded as (
    select ji.job_id from public.job_interactions ji
     where ji.user_id = p_user_id and ji.kind in ('hide', 'not_interested')
    union
    select a.job_id from public.applications a where a.user_id = p_user_id
  ),
  eligible as (
    select j.id, j.company_id, j.posted_at, j.quality_score, j.job_family
      from public.jobs j
     where j.status = 'open'
       and j.quality_score > 0.3
       and not exists (select 1 from excluded e where e.job_id = j.id)
       and (cardinality(types) = 0 or j.employment_type = any (types))
       and public.seniority_fits(j.seniority, j.employment_type, seniorities)
  ),
  fit_pool as (
    select e.id, 'fit'::text as source
      from eligible e
     where e.posted_at > since
       and (families is null or e.job_family = any (families))
     order by e.posted_at desc
     limit 400
  ),
  follow_pool as (
    select e.id, 'follow'::text
      from eligible e
      join public.company_follows f on f.company_id = e.company_id and f.user_id = p_user_id
     limit 200
  ),
  industry_pool as (
    select e.id, 'industry'::text
      from eligible e
      join public.companies c on c.id = e.company_id
     where c.industry is not null
       and c.industry in (
         select c2.industry
           from public.job_interactions ji
           join public.jobs j2 on j2.id = ji.job_id
           join public.companies c2 on c2.id = j2.company_id
          where ji.user_id = p_user_id and ji.kind in ('like', 'save') and c2.industry is not null)
     order by e.quality_score desc, e.posted_at desc
     limit 200
  ),
  -- Only when there is an "outside" to explore: with no families, the fit arm is already everything.
  explore_pool as (
    select e.id, 'explore'::text
      from eligible e
     where families is not null
       and e.posted_at > since
       and (e.job_family is null or not (e.job_family = any (families)))
     order by e.posted_at desc
     limit 60
  )
  select u.id, min(u.source)
    from (
      select * from fit_pool
      union all select * from follow_pool
      union all select * from industry_pool
      union all select * from explore_pool
    ) u(id, source)
   group by u.id
   limit greatest(coalesce(p_limit, 600), 50);
end;
$fn$;

revoke all on function public.personal_candidate_pool(uuid, integer) from public, anon, authenticated;
grant execute on function public.personal_candidate_pool(uuid, integer) to service_role;
