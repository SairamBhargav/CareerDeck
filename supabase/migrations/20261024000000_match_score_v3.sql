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
 *  7. **Required skills count double a nice-to-have.** job_signals.preferred_skills names the
 *     posting's skills that appear only under its "nice to have" heading; those weigh half.
 *  8. **Skills from roles and projects count.** The parser now reads them (parser v2,
 *     20261023000000_match_signals.sql), and the score unions them with the skills list.
 *  9. **Eligibility.** A posting that won't sponsor, or is for citizens only, against a reader
 *     who has said they need sponsorship or are not a citizen, is capped hard: the reader can't
 *     take the job, however well the resume fits. Unanswered questions apply no cap.
 * 10. **Graduation window.** "Graduating between December 2026 and June 2027" against the
 *     reader's graduation date (Profile's answer, else their graduation year, else the resume).
 *
 *   skills      0.40   coverage of the posting's core skills, nice-to-haves at half weight, 60% = full
 *   experience  0.25   1 − Π(1 − strengthᵢ) over relevant roles, strength = relevance × length
 *   field       0.20   max(degree affinity, 0.85 × best role relevance)
 *   seniority   0.15   unchanged formula
 *
 * The caps are v2's, plus the eligibility caps listed above compute_match_v3.
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

-- ── skills: required counts double what nice-to-have does ──────────────────────

/*
 * skill_fit with two more facts: which of the posting's skills it named only as nice to have
 * (job_signals.preferred_skills), and which of the resume's skills came from its skills list
 * rather than from a role or a project.
 *
 * `earned / weight` is coverage with a nice-to-have skill counting half: missing three of
 * five "bonus points" skills no longer reads like missing three of five requirements. Missing
 * skills are listed required first, since those are the ones worth acting on.
 */
create or replace function public.skill_fit_weighted(
  p_resume    text[],
  p_listed    text[],
  p_job       text[],
  p_preferred text[]
)
returns jsonb
language sql
stable
set search_path = ''
as $fn$
  with r as (
    select distinct public.skill_key(s) as k from unnest(coalesce(p_resume, '{}')) s where btrim(s) <> ''
  ), listed as (
    select distinct public.skill_key(s) as k from unnest(coalesce(p_listed, '{}')) s where btrim(s) <> ''
  ), pref as (
    select distinct public.skill_key(s) as k from unnest(coalesce(p_preferred, '{}')) s where btrim(s) <> ''
  ), j as (
    select distinct on (k) k, label,
           coalesce((select sk.category from public.skills sk
                      join public.skill_terms t on t.slug = lower(sk.slug::text)
                     where t.term = k), '') = 'practice'
             as generic
      from (select public.skill_key(s) as k, btrim(s) as label
              from unnest(coalesce(p_job, '{}')) s where btrim(s) <> '') keyed
     order by k, label
  ), core as materialized (
    select j.k, j.label,
           j.k in (select k from pref)   as nice,
           j.k in (select k from r)      as have,
           j.k in (select k from listed) as on_list
      from j
     where not j.generic
  )
  select jsonb_build_object(
    'core',      (select count(*) from core),
    'resume',    (select count(*) from r),
    'weight',    (select coalesce(sum(case when nice then 0.5 else 1 end), 0) from core),
    'earned',    (select coalesce(sum(case when nice then 0.5 else 1 end), 0) from core where have),
    'matched',   coalesce((select jsonb_agg(label order by nice, label) from core where have), '[]'::jsonb),
    'missing',   coalesce((select jsonb_agg(label order by nice, label) from core where not have), '[]'::jsonb),
    'preferred', coalesce((select jsonb_agg(label order by label) from core where nice), '[]'::jsonb),
    'fromWork',  coalesce((select jsonb_agg(label order by label) from core where have and not on_list), '[]'::jsonb)
  );
$fn$;

-- ── when the reader graduates ──────────────────────────────────────────────────

/*
 * A graduation answer as typed into Profile ("May 2028", "Spring 2027", "05/2028", "2028-05",
 * "2028"), as {year, month}. Month is absent when the text names only a year. Seasons are as
 * universities mean them: spring is May, fall and winter December.
 */
create or replace function public.graduation_of(p_text text)
returns jsonb
language sql
immutable
set search_path = ''
as $fn$
  select case
           when y is null then null
           else jsonb_strip_nulls(jsonb_build_object('year', y, 'month', mo))
         end
    from (
      select (regexp_match(t, '(20[2-3][0-9])'))[1]::int as y,
             coalesce(
               case (regexp_match(t, '\y(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)'))[1]
                 when 'jan' then 1 when 'feb' then 2 when 'mar' then 3 when 'apr' then 4
                 when 'may' then 5 when 'jun' then 6 when 'jul' then 7 when 'aug' then 8
                 when 'sep' then 9 when 'oct' then 10 when 'nov' then 11 when 'dec' then 12
               end,
               case (regexp_match(t, '\y(spring|summer|fall|autumn|winter)\y'))[1]
                 when 'spring' then 5 when 'summer' then 8
                 when 'fall' then 12 when 'autumn' then 12 when 'winter' then 12
               end,
               ((regexp_match(t, '^\s*(0?[1-9]|1[0-2])\s*/\s*20[2-3][0-9]'))[1])::int,
               ((regexp_match(t, '20[2-3][0-9]-(0[1-9]|1[0-2])'))[1])::int
             ) as mo
        from (select lower(coalesce(p_text, '')) as t) s
    ) parsed;
$fn$;

/*
 * What the reader has told us that a posting's eligibility rules can be checked against, from
 * Profile's application answers (phase 8, and 20261007000000's autofill columns), the profile's
 * graduation year, and the default resume's education, in that order for graduation.
 *
 * Every field is optional. An unanswered question applies no cap: the sheet asks for the answer
 * instead of guessing it.
 */
create or replace function public.match_reader_facts(p_user_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $fn$
  with a as (
    select needs_sponsorship, us_citizen, has_clearance, graduation_date
      from public.application_answers where user_id = p_user_id
  ), grad as (
    select coalesce(
             (select public.graduation_of(graduation_date) from a),
             (select jsonb_build_object('year', p.graduation_year)
                from public.profiles p where p.id = p_user_id and p.graduation_year is not null),
             (select jsonb_build_object('year', max((e.entry ->> 'graduationYear')::int))
                from public.resumes r
                join public.resume_profiles rp on rp.resume_id = r.id
                cross join lateral jsonb_array_elements(rp.education) as e(entry)
               where r.user_id = p_user_id and r.is_default and r.deleted_at is null
                 and r.parse_status = 'parsed'
                 and jsonb_typeof(e.entry -> 'graduationYear') = 'number'
              having max((e.entry ->> 'graduationYear')::int) is not null)
           ) as g
  )
  select jsonb_strip_nulls(jsonb_build_object(
    'needsSponsorship', (select needs_sponsorship from a),
    'usCitizen',        (select us_citizen from a),
    'hasClearance',     (select has_clearance from a),
    'grad',             (select g from grad)
  ));
$fn$;

-- ── the score ──────────────────────────────────────────────────────────────────

/*
 * `p_signals` is the posting's job_signals row as {sponsorship, citizenship, gradFrom, gradTo};
 * `p_reader` is match_reader_facts(). Both may be empty, and an empty one changes nothing.
 *
 * The eligibility caps, on top of v2's:
 *
 *   needs sponsorship, posting won't sponsor now or in the future   → at most 15
 *   needs sponsorship, posting won't sponsor (said plainly)         → at most 15, or 50 for an
 *                                                                     internship, which a student
 *                                                                     on CPT can often still take
 *   posting is for citizens (clearance), reader is not              → at most 10
 *   posting is for US persons (ITAR), reader needs sponsorship      → at most 10
 *   reader graduates outside the posting's window                   → at most 25
 */
create or replace function public.compute_match_v3(
  p_resume_skills    text[],
  p_listed_skills    text[],
  p_resume_seniority public.seniority_level,
  p_families         text[],
  p_experience       jsonb,
  p_job_skills       text[],
  p_job_preferred    text[],
  p_job_seniority    public.seniority_level,
  p_job_family       text,
  p_signals          jsonb,
  p_reader           jsonb
)
returns jsonb
language sql
stable
set search_path = ''
as $fn$
  -- `materialized` on the CTEs that call functions: inlined, each reference re-runs them
  -- (20261014000000 measured skill_fit at dozens of runs per posting without it).
  with fit as materialized (
    select public.skill_fit_weighted(p_resume_skills, p_listed_skills, p_job_skills, p_job_preferred) as f,
           public.experience_fit(p_experience, p_job_family) as x
  ), parts as materialized (
    select f, x,
           case
             when (f ->> 'core')::int = 0 or (f ->> 'resume')::int = 0 then null
             else least(1.0, (f ->> 'earned')::numeric / nullif((f ->> 'weight')::numeric, 0) / 0.6)
           end                                                              as skill,
           case when (f ->> 'core')::int = 0 then 'posting'
                when (f ->> 'resume')::int = 0 then 'resume' end            as limited_reason,
           public.field_affinity(p_job_family, p_families)                  as degree_field,
           (x ->> 'score')::numeric                                         as exp,
           (x ->> 'best')::numeric                                          as exp_best,
           public.seniority_affinity(p_resume_seniority, p_job_seniority)  as sen
      from fit
  ), eligible as (
    select *,
           case
             when (p_reader ->> 'needsSponsorship')::boolean is not true then null
             when p_signals ->> 'sponsorship' = 'none_ever' then 15
             when p_signals ->> 'sponsorship' = 'none' then case when p_job_seniority = 'intern' then 50 else 15 end
           end                                                              as sponsor_cap,
           case
             when p_signals ->> 'citizenship' = 'citizen'
              and (p_reader ->> 'usCitizen')::boolean is false
              and (p_reader ->> 'hasClearance')::boolean is not true then 10
             when p_signals ->> 'citizenship' = 'us_person'
              and (p_reader ->> 'usCitizen')::boolean is false
              and (p_reader ->> 'needsSponsorship')::boolean is true then 10
           end                                                              as citizen_cap,
           case
             when p_reader -> 'grad' is null
               or (p_signals ->> 'gradFrom' is null and p_signals ->> 'gradTo' is null) then null
             else
               (p_signals ->> 'gradFrom' is null or
                 case when p_reader -> 'grad' ? 'month'
                      then make_date((p_reader #>> '{grad,year}')::int, (p_reader #>> '{grad,month}')::int, 1)
                             >= (p_signals ->> 'gradFrom')::date
                      else (p_reader #>> '{grad,year}')::int >= extract(year from (p_signals ->> 'gradFrom')::date)
                 end)
               and
               (p_signals ->> 'gradTo' is null or
                 case when p_reader -> 'grad' ? 'month'
                      then make_date((p_reader #>> '{grad,year}')::int, (p_reader #>> '{grad,month}')::int, 1)
                             <= (p_signals ->> 'gradTo')::date
                      else (p_reader #>> '{grad,year}')::int <= extract(year from (p_signals ->> 'gradTo')::date)
                 end)
           end                                                              as grad_fits
      from parts
  ), fielded as (
    select *,
           case
             when degree_field is null and exp_best is null then null
             else greatest(coalesce(degree_field, 0), coalesce(0.85 * exp_best, 0))
           end                                                              as field,
           case
             when exp_best is not null and 0.85 * exp_best > coalesce(degree_field, 0) then 'experience'
             when degree_field is not null then 'degree'
           end                                                              as field_source,
           least(sponsor_cap, citizen_cap, case when grad_fits is false then 25 end) as eligibility_cap
      from eligible
  ), weighted as (
    select *,
           coalesce(skill * 0.40, 0) + coalesce(exp * 0.25, 0)
             + coalesce(field * 0.20, 0) + coalesce(sen * 0.15, 0)          as total,
           case when skill is null then 0 else 0.40 end + case when exp is null then 0 else 0.25 end
             + case when field is null then 0 else 0.20 end + case when sen is null then 0 else 0.15 end
                                                                            as denom
      from fielded
  ), rawed as (
    select *,
           round(100 * total / nullif(denom, 0))::int as raw_score
      from weighted
  ), curved as (
    select *,
           -- Never 100: above 85 each point counts 0.8, so the top is 97.
           round(case when raw_score > 85 then 85 + (raw_score - 85) * 0.8 else raw_score end)::int as curved_score
      from rawed
  ), capped as (
    select w.*, cap.at as cap_at, cap.reason as cap_reason
      from curved w
      -- The tightest cap that actually binds; a cap above the score changed nothing.
      left join lateral (
        select c.at, c.reason
          from (values
                 (case when w.field is not null and w.field <= 0.1 then 35 end, 'off_field'),
                 (case when w.field is not null and w.field <= 0.35 then 60 end, 'adjacent_field'),
                 (case when w.sen is not null and w.sen <= 0.3 then 40 end, 'level'),
                 (case when w.skill is null and w.field is null then 55
                       when w.skill is null and w.field <= 0.35 then 45
                       when w.skill is null then 70 end, 'no_skills'),
                 (w.citizen_cap, 'citizenship'),
                 (case when w.sponsor_cap = 50 then 50 end, 'sponsorship_soft'),
                 (case when w.sponsor_cap = 15 then 15 end, 'sponsorship'),
                 (case when w.grad_fits is false then 25 end, 'graduation')
               ) as c(at, reason)
         where c.at is not null and c.at < w.curved_score
         order by c.at, c.reason
         limit 1
      ) cap on true
  )
  select case
           -- Without skills, experience or a field there is nothing to say about fit, only level.
           when denom is null or denom = 0 or (skill is null and field is null and exp is null) then null
           else jsonb_build_object(
             'score', greatest(0, least(curved_score, coalesce(cap_at, 100))),
             'components', jsonb_strip_nulls(jsonb_build_object(
               'skills',         round(skill, 2),
               'experience',     round(exp, 2),
               'field',          round(field, 2),
               'fieldSource',    field_source,
               'seniority',      round(sen, 2),
               'matched',        f -> 'matched',
               'missing',        f -> 'missing',
               'preferred',      f -> 'preferred',
               'fromWork',       f -> 'fromWork',
               'roles',          x -> 'roles',
               'jobFamily',      p_job_family,
               'limited',        skill is null,
               'limitedReason',  limited_reason,
               'raw',            raw_score,
               'cap',            case when cap_at is null then null
                                      else jsonb_build_object('at', cap_at, 'reason', cap_reason) end,
               'eligibilityCap', eligibility_cap,
               -- What the posting said and what the reader told us, so the sheet can show both
               -- sides of a cap, or ask for the answer that would decide one.
               'eligibility',    nullif(jsonb_strip_nulls(jsonb_build_object(
                                   'sponsorship',      p_signals ->> 'sponsorship',
                                   'citizenship',      p_signals ->> 'citizenship',
                                   'gradFrom',         p_signals ->> 'gradFrom',
                                   'gradTo',           p_signals ->> 'gradTo',
                                   'gradFits',         grad_fits,
                                   'needsSponsorship', (p_reader ->> 'needsSponsorship')::boolean,
                                   'usCitizen',        (p_reader ->> 'usCitizen')::boolean,
                                   'grad',             p_reader -> 'grad'
                                 )), '{}'::jsonb)
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
  -- Not `skills`: under use_column that name would resolve to jobs.skills inside the query.
  reader_skills text[];
  families  text[];
  reader    jsonb;
  ids       uuid[] := p_job_ids[1:200];
  version   constant smallint := 3;
begin
  if uid is null or ids is null or array_length(ids, 1) is null then
    return;
  end if;

  select r.id as resume_id, p.skills, p.seniority, p.experience, p.projects
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

  -- The skills list, and every skill a role or a project says it used.
  select coalesce(array_agg(distinct s), '{}') into reader_skills
    from (
      select unnest(resume.skills) as s
      union
      select jsonb_array_elements_text(e -> 'skills')
        from jsonb_array_elements(case when jsonb_typeof(resume.experience) = 'array'
                                       then resume.experience else '[]'::jsonb end) e
       where jsonb_typeof(e -> 'skills') = 'array'
      union
      select jsonb_array_elements_text(pr -> 'skills')
        from jsonb_array_elements(case when jsonb_typeof(resume.projects) = 'array'
                                       then resume.projects else '[]'::jsonb end) pr
       where jsonb_typeof(pr -> 'skills') = 'array'
    ) u
   where nullif(btrim(s), '') is not null;

  families := public.resume_job_families(uid);
  reader   := public.match_reader_facts(uid);

  insert into public.job_match_scores (user_id, job_id, resume_id, score, components, scorer_version)
  select uid,
         j.id,
         resume.resume_id,
         (m.result ->> 'score')::smallint,
         (m.result -> 'components') || jsonb_build_object('coverage', m.result -> 'coverage'),
         version
    -- Only the postings that need a score are scored: no current row, or one older than the
    -- posting or than its signals.
    from (
      select j.id, j.skills, j.seniority, j.job_family,
             sig.preferred_skills,
             jsonb_strip_nulls(jsonb_build_object(
               'sponsorship', sig.sponsorship,
               'citizenship', sig.citizenship,
               'gradFrom',    sig.grad_from,
               'gradTo',      sig.grad_to
             )) as signals
        from public.jobs j
        left join public.job_signals sig on sig.job_id = j.id
       where j.id = any (ids)
         and not exists (
           select 1 from public.job_match_scores s
            where s.user_id = uid and s.job_id = j.id and s.resume_id = resume.resume_id
              and s.scorer_version = version
              and s.computed_at >= j.updated_at
              and s.computed_at >= coalesce(sig.computed_at, '-infinity'::timestamptz)
         )
    ) j
    cross join lateral (
      select public.compute_match_v3(
               reader_skills, resume.skills, resume.seniority, families, resume.experience,
               j.skills, j.preferred_skills, j.seniority, j.job_family, j.signals, reader
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

-- ── what throws cached scores away ────────────────────────────────────────────

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

/* The profile's graduation year is a fallback for the graduation window, so it counts too. */
create or replace function public.profile_invalidate_matches()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if new.major is distinct from old.major
     or new.graduation_year is distinct from old.graduation_year then
    perform public.invalidate_match_scores(new.id);
  end if;
  return new;
end;
$fn$;

drop trigger profiles_invalidate_matches on public.profiles;
create trigger profiles_invalidate_matches
  after update of major, graduation_year on public.profiles
  for each row execute function public.profile_invalidate_matches();

/* The eligibility answers decide caps, so a changed answer is a changed score. */
create or replace function public.answers_invalidate_matches()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if tg_op = 'INSERT'
     or new.needs_sponsorship is distinct from old.needs_sponsorship
     or new.us_citizen is distinct from old.us_citizen
     or new.has_clearance is distinct from old.has_clearance
     or new.graduation_date is distinct from old.graduation_date then
    perform public.invalidate_match_scores(new.user_id);
  end if;
  return new;
end;
$fn$;

create trigger application_answers_invalidate_matches
  after insert or update on public.application_answers
  for each row execute function public.answers_invalidate_matches();

drop function public.compute_match_v2(text[], public.seniority_level, text[], text[],
  public.seniority_level, text, text, text, public.location_type, text[], boolean);

-- ── grants ─────────────────────────────────────────────────────────────────────

revoke all on function public.title_family(text)                     from public, anon, authenticated;
revoke all on function public.resume_month(text)                     from public, anon, authenticated;
revoke all on function public.role_months(jsonb)                     from public, anon, authenticated;
revoke all on function public.experience_fit(jsonb, text)            from public, anon, authenticated;
revoke all on function public.skill_fit_weighted(text[], text[], text[], text[])
  from public, anon, authenticated;
revoke all on function public.graduation_of(text)                    from public, anon, authenticated;
revoke all on function public.match_reader_facts(uuid)               from public, anon, authenticated;
revoke all on function public.answers_invalidate_matches()           from public, anon, authenticated;
revoke all on function public.compute_match_v3(text[], text[], public.seniority_level, text[], jsonb,
  text[], text[], public.seniority_level, text, jsonb, jsonb)
  from public, anon, authenticated;
