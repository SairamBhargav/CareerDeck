/*
 * The resume match score, v3 (2026-10-08): experience replaces location, and nothing is 100.
 *
 * ── what changed and why ───────────────────────────────────────────────────────────
 *
 *  1. **Location is gone.** It was a preference, not a qualification: an onsite role in a city
 *     the reader never named said nothing about whether they could do the job. The Deck's
 *     ranking still reads location on its own; only the match score stops.
 *  2. **Experience takes its weight, and more.** A software internship is the strongest evidence
 *     there is that someone can do the next software internship, and v2 could not see it: the
 *     parser has stored every role's title and dates since phase 4, and nothing read them. Each
 *     role's title is put in a family by the same rules the crawler uses for postings
 *     (`server/src/ingest/normalize/family.ts`), so a role and a posting are judged the same way.
 *  3. **Work counts toward the field.** v2 took the field from the degree alone, so a math
 *     major with two software internships was "outside their field" on every software role and
 *     capped at 35. A relevant role now lifts the field to 0.85 of its own relevance.
 *  4. **Seniority drops from 0.20 to 0.15.** Level is mostly decided before a card is ever
 *     shown (the candidate pool filters by stage), so on screen it rarely tells cards apart.
 *  5. **Never 100.** No resume is a perfect match for a posting. Above 85, each point counts
 *     0.8, so the ceiling is 97 and two strong matches still sort apart instead of both
 *     pinning to the ceiling.
 *  6. **The binding cap and its reason are stored**, with the pre-cap score, so the app can
 *     say "capped at 35 because this role is outside your field" instead of showing a 35 next
 *     to eight of nine skills and no explanation.
 *
 *   skills      0.40   unchanged formula (coverage of the posting's core skills, 60% = full)
 *   experience  0.25   1 − Π(1 − strengthᵢ) over relevant roles, strength = relevance × length
 *   field       0.20   max(degree affinity, 0.85 × best role relevance)
 *   seniority   0.15   unchanged formula
 *
 * The caps are v2's, unchanged.
 */

-- ── a role's field ─────────────────────────────────────────────────────────────

/*
 * A job title's family, by family.ts's TITLE_RULES in the same order: the role head first
 * ("Account Executive" in "Account Executive, AI Platform"), then the whole title. The
 * patterns are the TypeScript ones with `\b` written as Postgres's `\y`; `\b` in a Postgres
 * regex is a backspace, and every pattern would silently stop matching.
 *
 * family.ts also breaks ties on skills when the title names no field. A resume role carries no
 * skills of its own, so that half has nothing to read here and an unclassified role is simply
 * not counted.
 */
create or replace function public.title_family(p_title text)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select r.family
    from (values
           (1, nullif(btrim((regexp_split_to_array(coalesce(p_title, ''), ',|\s[-–—|]\s|\(|:'))[1]), '')),
           (2, nullif(btrim(p_title), ''))
         ) as pass(n, txt)
    join (values
      (1,  'hardware',        '\ydata ?cent(er|re)\y'),
      (2,  'hardware',        '\y(fpga|asic|analog|ic|rfic|integrated circuit|pcb|silicon|chip|logic(al)?|physical design|circuit|packaging|verification engineer|turbomachinery|optic(s|al)|photonics|controls? (engineer\w*|system\w*)|mechatronics|materials|power electronics)\y'),
      (3,  'design',          '\y(designer|design (intern|lead|manager)|ux|ui/ux|user experience|user interface|graphic|visual design|brand design|motion design|illustrator)\y'),
      (4,  'product',         '\y(product manag\w*|product owner|product lead|program manag\w*|project manag\w*|tpm|apm|product management|product operations|product intern)\y'),
      (5,  'data_ml',         '\y(data|machine learning|ml|ai|artificial intelligence|deep learning|analytics|scientist|research (engineer|scientist)|quant\w*|statistic\w*|nlp|computer vision|llm|applied scientist)\y'),
      (6,  'hardware',        '\y(hardware|electrical|mechanical|manufacturing|firmware|embedded|asic|fpga|rf|robotics|avionics|propulsion|test engineer|test technician|technician|production (associate|planner|engineer)|quality (inspector|engineer)|systems integration|packaging|thermal|structural|aerospace|silicon|chip|gnc|controls engineer|electronics|wire harness|machinist|assembler|welder)\y'),
      (7,  'sales_marketing', '\y(sales|account executive|account (development|manager)|ae|sdr|bdr|business development|partnerships?|marketing|growth|brand|communications|comms|content|social media|public relations|pr|customer success|solutions (consultant|engineer)|sales engineer|go[- ]to[- ]market|gtm|demand gen\w*|events?)\y'),
      (8,  'software',        '\y(software|swe|developer|computer science|full[- ]?stack|front[- ]?end|back[- ]?end|mobile|ios|android|web|platform|infrastructure|devops|sre|site reliability|cloud|security|cyber\w*|it|systems administrator|network engineer|forward deployed|solutions architect|technical support engineer|qa|test automation)\y'),
      (9,  'business',        '\y(financ\w*|accounting|accountant|analyst|strategy|strategic|business operations|biz ?ops|consult\w*|investment|treasury|tax|audit\w*|fp&a|controller|revenue|pricing|economist|actuar\w*|risk|compliance|aml|payroll)\y'),
      (10, 'operations',      '\y(operations|ops|supply chain|logistics|procurement|buyer|sourcing|planner|support|customer (service|experience)|recruit\w*|talent|people|human resources|hr|legal|counsel|paralegal|policy|office|executive assistant|workplace|facilities|trust (and|&) safety|community)\y')
    ) as r(ord, family, pattern)
      on pass.txt ~* r.pattern
   where pass.txt is not null
   order by pass.n, r.ord
   limit 1;
$fn$;

-- ── how long a role lasted ─────────────────────────────────────────────────────

/*
 * The first of the month a resume date names. The parser asks for `YYYY-MM` and sometimes gets
 * a bare year, which reads as June: the middle of the year, wrong by at most six months.
 * Anything else, or a year outside 1950–2100, is null rather than a guess.
 */
create or replace function public.resume_month(p_value text)
returns date
language sql
immutable
set search_path = ''
as $fn$
  select case
           when p_value ~ '^\d{4}-\d{2}' then
             case
               when substr(p_value, 1, 4)::int between 1950 and 2100
                and substr(p_value, 6, 2)::int between 1 and 12
               then make_date(substr(p_value, 1, 4)::int, substr(p_value, 6, 2)::int, 1)
             end
           when p_value ~ '^\d{4}$' then
             case when p_value::int between 1950 and 2100 then make_date(p_value::int, 6, 1) end
         end;
$fn$;

/* Months a role ran, counting both ends: June to August is 3. Null when the dates do not say. */
create or replace function public.role_months(p_entry jsonb)
returns integer
language sql
stable
set search_path = ''
as $fn$
  with d as (
    select public.resume_month(p_entry ->> 'startDate') as s,
           case when p_entry -> 'isCurrent' = 'true'::jsonb then date_trunc('month', now())::date
                else public.resume_month(p_entry ->> 'endDate') end as e
  )
  select case
           when s is null or e is null or e < s then null
           else least(600, (extract(year from age(e, s)) * 12 + extract(month from age(e, s)))::int + 1)
         end
    from d;
$fn$;

-- ── experience against a posting ───────────────────────────────────────────────

/*
 * How much the resume's past roles say about this posting, 0–1, and which roles said it.
 *
 * Each role's relevance is field_affinity between its family and the posting's: 1 for the same
 * field, the adjacency table's value for a neighbour, 0.05 otherwise. Roles under 0.3 do not
 * count at all, so a barista job neither helps nor hurts a software application.
 *
 * Length scales it: 0.75 for an unknown or very short role, 0.81 for a three-month internship,
 * full strength at a year. The roles combine as independent evidence, 1 − Π(1 − strength), so
 * one software internship is 0.81, a second makes it 0.96, and no number of roles passes 1.
 *
 * `roles` holds each counted role's index into `resume_profiles.experience`, not its title or
 * company: the app already holds the resume, and copying text into every score row would cost
 * storage on a table with a row per reader per posting.
 *
 * Null when the posting has no family, since there is then nothing to be relevant to.
 */
create or replace function public.experience_fit(p_experience jsonb, p_job_family text)
returns jsonb
language sql
stable
set search_path = ''
as $fn$
  with roles as materialized (
    select (e.ord - 1)::int as i,
           public.title_family(e.entry ->> 'title') as family,
           public.role_months(e.entry) as months
      from jsonb_array_elements(
             case when jsonb_typeof(p_experience) = 'array' then p_experience else '[]'::jsonb end
           ) with ordinality as e(entry, ord)
  ), counted as materialized (
    select i, family, months, rel,
           rel * least(1.0, 0.75 + 0.25 * coalesce(months, 0) / 12.0) as strength
      from (select r.*, public.field_affinity(p_job_family, array[r.family]) as rel
              from roles r
             where r.family is not null) scored
     where rel >= 0.3
  )
  select case
           when p_job_family is null then null
           else jsonb_build_object(
             'score', round(1 - coalesce((select exp(sum(ln(1 - least(strength, 0.999)))) from counted), 1), 2),
             'best',  (select max(rel) from counted),
             'roles', coalesce((
               select jsonb_agg(jsonb_build_object('i', i, 'family', family, 'months', months, 'rel', round(rel, 2))
                                order by strength desc, i)
                 from (select * from counted order by strength desc, i limit 4) top
             ), '[]'::jsonb)
           )
         end;
$fn$;

-- ── the score ──────────────────────────────────────────────────────────────────

create or replace function public.compute_match_v3(
  p_resume_skills    text[],
  p_resume_seniority public.seniority_level,
  p_families         text[],
  p_experience       jsonb,
  p_job_skills       text[],
  p_job_seniority    public.seniority_level,
  p_job_family       text
)
returns jsonb
language sql
stable
set search_path = ''
as $fn$
  -- `materialized` on the CTEs that call functions: inlined, each reference re-runs them
  -- (20261014000000 measured skill_fit at dozens of runs per posting without it).
  with fit as materialized (
    select public.skill_fit(p_resume_skills, p_job_skills) as f,
           public.experience_fit(p_experience, p_job_family) as x
  ), parts as materialized (
    select f, x,
           case
             when (f ->> 'core')::int = 0 or (f ->> 'resume')::int = 0 then null
             else least(1.0, jsonb_array_length(f -> 'matched')::numeric / (f ->> 'core')::numeric / 0.6)
           end                                                              as skill,
           case when (f ->> 'core')::int = 0 then 'posting'
                when (f ->> 'resume')::int = 0 then 'resume' end            as limited_reason,
           public.field_affinity(p_job_family, p_families)                  as degree_field,
           (x ->> 'score')::numeric                                         as exp,
           (x ->> 'best')::numeric                                          as exp_best,
           public.seniority_affinity(p_resume_seniority, p_job_seniority)  as sen
      from fit
  ), fielded as (
    select *,
           case
             when degree_field is null and exp_best is null then null
             else greatest(coalesce(degree_field, 0), coalesce(0.85 * exp_best, 0))
           end                                                              as field,
           case
             when exp_best is not null and 0.85 * exp_best > coalesce(degree_field, 0) then 'experience'
             when degree_field is not null then 'degree'
           end                                                              as field_source
      from parts
  ), weighted as (
    select *,
           coalesce(skill * 0.40, 0) + coalesce(exp * 0.25, 0)
             + coalesce(field * 0.20, 0) + coalesce(sen * 0.15, 0)          as total,
           case when skill is null then 0 else 0.40 end + case when exp is null then 0 else 0.25 end
             + case when field is null then 0 else 0.20 end + case when sen is null then 0 else 0.15 end
                                                                            as denom
      from fielded
  ), rawed as (
    select *, round(100 * total / nullif(denom, 0))::int as raw_score from weighted
  ), capped as (
    select w.*, cap.at as cap_at, cap.reason as cap_reason,
           -- Never 100: above 85 each point counts 0.8, so the top is 97.
           round(case when w.raw_score > 85 then 85 + (w.raw_score - 85) * 0.8 else w.raw_score end)::int
             as curved
      from rawed w
      -- The tightest cap that actually binds; a cap above the score changed nothing.
      left join lateral (
        select c.at, c.reason
          from (values
                 (case when w.field is not null and w.field <= 0.1 then 35 end, 'off_field'),
                 (case when w.field is not null and w.field <= 0.35 then 60 end, 'adjacent_field'),
                 (case when w.sen is not null and w.sen <= 0.3 then 40 end, 'level'),
                 (case when w.skill is null and w.field is null then 55
                       when w.skill is null and w.field <= 0.35 then 45
                       when w.skill is null then 70 end, 'no_skills')
               ) as c(at, reason)
         where c.at is not null
           and c.at < round(case when w.raw_score > 85 then 85 + (w.raw_score - 85) * 0.8 else w.raw_score end)
         order by c.at
         limit 1
      ) cap on true
  )
  select case
           -- Without skills, experience or a field there is nothing to say about fit, only level.
           when denom is null or denom = 0 or (skill is null and field is null and exp is null) then null
           else jsonb_build_object(
             'score', greatest(0, least(curved, coalesce(cap_at, 100))),
             'components', jsonb_strip_nulls(jsonb_build_object(
               'skills',        round(skill, 2),
               'experience',    round(exp, 2),
               'field',         round(field, 2),
               'fieldSource',   field_source,
               'seniority',     round(sen, 2),
               'matched',       f -> 'matched',
               'missing',       f -> 'missing',
               'roles',         x -> 'roles',
               'jobFamily',     p_job_family,
               'limited',       skill is null,
               'limitedReason', limited_reason,
               'raw',           raw_score,
               'cap',           case when cap_at is null then null
                                     else jsonb_build_object('at', cap_at, 'reason', cap_reason) end
             )),
             'coverage', round(denom, 2)
           )
         end
    from capped;
$fn$;

-- ── the cache ──────────────────────────────────────────────────────────────────

-- v2 rows would be recomputed lazily anyway; dropping them now returns the space today.
delete from public.job_match_scores where scorer_version < 3;

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
  families  text[];
  ids       uuid[] := p_job_ids[1:200];
  version   constant smallint := 3;
begin
  if uid is null or ids is null or array_length(ids, 1) is null then
    return;
  end if;

  select r.id as resume_id, p.skills, p.seniority, p.experience
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

  families := public.resume_job_families(uid);

  insert into public.job_match_scores (user_id, job_id, resume_id, score, components, scorer_version)
  select uid,
         j.id,
         resume.resume_id,
         (m.result ->> 'score')::smallint,
         (m.result -> 'components') || jsonb_build_object('coverage', m.result -> 'coverage'),
         version
    -- Only the postings that need a score are scored; v2 computed every requested one and
    -- then threw the cached ones away.
    from (
      select j.id, j.skills, j.seniority, j.job_family
        from public.jobs j
       where j.id = any (ids)
         and not exists (
           select 1 from public.job_match_scores s
            where s.user_id = uid and s.job_id = j.id and s.resume_id = resume.resume_id
              and s.scorer_version = version
              and s.computed_at >= j.updated_at
         )
    ) j
    cross join lateral (
      select public.compute_match_v3(
               resume.skills, resume.seniority, families, resume.experience,
               j.skills, j.seniority, j.job_family
             ) as result
      offset 0  -- keeps the subquery from being flattened, which would run the function per reference
    ) m
   where m.result is not null
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

/*
 * Location no longer reaches the score, so changing it no longer throws scores away. Sectors
 * still do: they are the field of last resort when there is no degree or major.
 */
create or replace function public.preferences_invalidate_matches()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if new.preferred_industries is distinct from old.preferred_industries then
    perform public.invalidate_match_scores(new.user_id);
  end if;
  return new;
end;
$fn$;

drop function public.compute_match_v2(text[], public.seniority_level, text[], text[],
  public.seniority_level, text, text, text, public.location_type, text[], boolean);

-- ── grants ─────────────────────────────────────────────────────────────────────

revoke all on function public.title_family(text)                     from public, anon, authenticated;
revoke all on function public.resume_month(text)                     from public, anon, authenticated;
revoke all on function public.role_months(jsonb)                     from public, anon, authenticated;
revoke all on function public.experience_fit(jsonb, text)            from public, anon, authenticated;
revoke all on function public.compute_match_v3(text[], public.seniority_level, text[], jsonb, text[],
  public.seniority_level, text)
  from public, anon, authenticated;
