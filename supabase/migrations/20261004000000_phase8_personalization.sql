/*
 * Phase 8 — a deck that knows what the student is studying. docs/PHASE8.md.
 *
 * Onboarding already asked for a student's stage and fields, sign-up for their school and
 * graduation year, and the resume parser extracted their field of study. The ranker read none
 * of it, and jobs carried no field to match against. This migration connects the two.
 */

set lock_timeout = '10s';

-- ── jobs: a field ──────────────────────────────────────────────────────────────

/*
 * PHASE8.md §2. Classified at ingest by server/src/ingest/normalize/family.ts, and once for the
 * existing corpus by scripts/backfill-job-family.mjs. Text with a check rather than an enum, so
 * adding a family later is a constraint swap rather than an ALTER TYPE in a transaction.
 *
 * Nullable, and a null is never filtered out: a title that names no field ("Engineering
 * Intern", "Associate") is still a job somebody might want.
 */
alter table public.jobs add column job_family text
  check (job_family in ('software', 'data_ml', 'hardware', 'product', 'design',
                        'business', 'sales_marketing', 'operations'));

-- The fit arm's scan: newest first within a family, open postings only.
create index jobs_family_recent_idx on public.jobs (job_family, posted_at desc) where status = 'open';

-- ── what a student's answers mean in job families ─────────────────────────────

/*
 * Onboarding step 2's sector keys (constants/industries.ts) → families. A sector can map to
 * several ("technology" is software, data and hardware). A sector with no row — "hospitality",
 * "agriculture" — contributes nothing, which leaves the student's other signals to decide.
 */
create table public.sector_families (
  sector_key text not null,
  family     text not null,
  primary key (sector_key, family)
);

insert into public.sector_families (sector_key, family) values
  ('technology', 'software'), ('technology', 'data_ml'), ('technology', 'hardware'),
  ('software-development', 'software'),
  ('data-science', 'data_ml'),
  ('artificial-intelligence', 'data_ml'), ('artificial-intelligence', 'software'),
  ('cybersecurity', 'software'),
  ('information-technology', 'software'), ('information-technology', 'operations'),
  ('engineering', 'hardware'), ('engineering', 'software'),
  ('business-management', 'business'), ('business-management', 'product'),
  ('business-operations', 'business'), ('business-operations', 'operations'),
  ('finance', 'business'), ('banking', 'business'), ('accounting', 'business'),
  ('marketing', 'sales_marketing'), ('advertising', 'sales_marketing'), ('sales', 'sales_marketing'),
  ('communications', 'sales_marketing'), ('journalism', 'sales_marketing'),
  ('media-production', 'sales_marketing'), ('media-production', 'design'),
  ('arts', 'design'), ('design', 'design'), ('architecture', 'design'),
  ('law', 'operations'), ('public-policy', 'operations'), ('government', 'operations'),
  ('international-affairs', 'operations'), ('human-resources', 'operations'),
  ('psychology', 'operations'), ('social-work', 'operations'),
  ('scientific-research', 'data_ml'), ('biotechnology', 'data_ml'),
  ('manufacturing', 'hardware'), ('construction-management', 'hardware'),
  ('supply-chain', 'operations'), ('logistics', 'operations'),
  ('sustainability', 'operations'), ('environmental-science', 'data_ml');

/*
 * A major, or a resume's field of study, → families. Case-insensitive regex over free text,
 * because both are free text ("B.S. Computer Science", "Comp Sci & Econ", "EECS"). Several
 * patterns can match one major, and all of their families count: "Computer Science and
 * Economics" is software, data and business.
 */
create table public.major_families (
  pattern text not null,
  family  text not null,
  primary key (pattern, family)
);

insert into public.major_families (pattern, family) values
  ('comput|software|informatics|\mcs\M|eecs|information (science|systems|technology)|cyber', 'software'),
  ('comput|\mcs\M|eecs|data|statistic|mathemat|\mmath|machine learning|artificial intelligence|operations research|physics', 'data_ml'),
  ('electrical|\mece\M|\mee\M|eecs|mechanical|aerospace|aeronaut|civil|industrial|manufactur|materials|chemical engineering|biomedical engineering|robotic|mechatronic|nuclear', 'hardware'),
  ('econom|financ|accounting|business|commerce|management|actuar', 'business'),
  ('marketing|communication|journalism|advertising|public relations|media', 'sales_marketing'),
  ('design|\mart\M|fine arts|architecture|human[- ]computer|\mhci\M|graphic', 'design'),
  ('product management|entrepreneur', 'product'),
  ('psycholog|sociolog|political|public policy|\mlaw\M|legal|human resources|international|history|english|philosophy|supply chain|logistics', 'operations');

/*
 * PHASE8.md §3.1. The union of three sources, and null — not an empty array — when none of
 * them says anything, so the caller can tell "no fields known" (no filter) from "no fields".
 */
create or replace function public.user_job_families(p_user_id uuid)
returns text[]
language sql
stable
set search_path = ''
as $fn$
  with fields as (
    -- 1. onboarding's sectors
    select sf.family
      from public.user_preferences up
      cross join lateral unnest(up.preferred_industries) as s(key)
      join public.sector_families sf on sf.sector_key = s.key
     where up.user_id = p_user_id
    union
    -- 2. the major on the profile
    select mf.family
      from public.profiles p
      join public.major_families mf on p.major ~* mf.pattern
     where p.id = p_user_id and nullif(btrim(p.major), '') is not null
    union
    -- 3. every field of study on the default, parsed resume
    select mf.family
      from public.resumes r
      join public.resume_profiles rp on rp.resume_id = r.id
      cross join lateral jsonb_array_elements(rp.education) as e(entry)
      join public.major_families mf on (e.entry ->> 'field') ~* mf.pattern
     where r.user_id = p_user_id and r.is_default and r.deleted_at is null
       and r.parse_status = 'parsed'
  )
  select case when count(*) = 0 then null else array_agg(distinct family order by family) end
    from fields;
$fn$;

-- ── what stage the student is at ──────────────────────────────────────────────

/*
 * Onboarding step 1, stored. It was already computed on the client (context/OnboardingContext
 * .tsx) and thrown away after seeding the employment type; this keeps it.
 */
alter table public.user_preferences add column career_stage text
  check (career_stage in ('student_intern', 'graduating', 'recent_grad', 'early_career'));

grant update (career_stage) on public.user_preferences to authenticated;

/*
 * PHASE8.md §3.2. The stage when it is known; the graduation year otherwise; null when
 * neither, which means no seniority filter. A job with no detected seniority is always
 * allowed by the caller — this only lists the levels that are.
 */
create or replace function public.target_seniorities(p_user_id uuid)
returns public.seniority_level[]
language sql
stable
set search_path = ''
as $fn$
  with facts as (
    select up.career_stage,
           p.graduation_year - extract(year from now())::int as years_left
      from public.profiles p
      left join public.user_preferences up on up.user_id = p.id
     where p.id = p_user_id
  )
  select case
           when career_stage = 'student_intern' then array['intern']::public.seniority_level[]
           when career_stage = 'graduating'     then array['new_grad', 'intern']::public.seniority_level[]
           when career_stage = 'recent_grad'    then array['new_grad']::public.seniority_level[]
           when career_stage = 'early_career'   then array['new_grad', 'mid']::public.seniority_level[]
           when years_left is null              then null
           when years_left >= 2                 then array['intern']::public.seniority_level[]
           when years_left >= 0                 then array['new_grad', 'intern']::public.seniority_level[]
           when years_left = -1                 then array['new_grad']::public.seniority_level[]
           else array['new_grad', 'mid']::public.seniority_level[]
         end
    from facts;
$fn$;

/*
 * What the deck believes about the reader, for the reader. So a "why am I seeing this" screen
 * — or a student wondering why their feed is all marketing — has something true to show, and
 * so verify:phase8 can assert on it without service-role access.
 */
create or replace function public.my_deck_profile()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $fn$
  select jsonb_build_object(
    'families',    public.user_job_families((select auth.uid())),
    'seniorities', public.target_seniorities((select auth.uid())),
    'stage',       (select up.career_stage from public.user_preferences up
                     where up.user_id = (select auth.uid()))
  );
$fn$;

-- ── retrieval ──────────────────────────────────────────────────────────────────

/*
 * PHASE8.md §4.1. Phase 5's `candidate_pool` stays exactly as it was, because the A/B
 * control arm reads it: the control has to stay genuinely phase 1's newest-first feed or the
 * experiment measures nothing. The ranked arm reads this one instead.
 *
 * The student's stage is a hard filter on every arm (a sophomore's followed company still
 * should not fill their deck with mid-level roles). Their fields shape the fit arm and are the
 * complement of the explore arm, so the one-in-seven exploration slot always has out-of-field
 * postings to draw on.
 */
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
       and (seniorities is null or j.seniority is null or j.seniority = any (seniorities))
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
       and (seniorities is null or j.seniority is null or j.seniority = any (seniorities))
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

-- ── scoring ────────────────────────────────────────────────────────────────────

/*
 * Phase 5's scorer plus `fieldMatch` (PHASE8.md §4.2). A new trailing parameter with a default
 * is a new signature, so the old one is dropped rather than left beside it as an overload the
 * resolver could pick by accident.
 */
drop function public.rank_score(jsonb, numeric, numeric, numeric, numeric, numeric,
                                numeric, numeric, numeric, integer);

create or replace function public.rank_score(
  p_weights      jsonb,
  p_pref         numeric,
  p_skill        numeric,
  p_recency      numeric,
  p_affinity     numeric,
  p_quality      numeric,
  p_urgency      numeric,
  p_cohort       numeric,
  p_popularity   numeric,
  p_seen_count   integer,
  p_field        numeric default null
)
returns jsonb
language sql
immutable
set search_path = ''
as $fn$
  with parts(key, value) as (
    values ('prefMatch',    p_pref),
           ('skillOverlap', p_skill),
           ('recency',      p_recency),
           ('affinity',     p_affinity),
           ('quality',      p_quality),
           ('urgency',      p_urgency),
           ('cohort',       p_cohort),
           ('popularity',   p_popularity),
           ('fieldMatch',   p_field)
  ), weighted as (
    -- A weights row without a key (phase 5's v1 has no fieldMatch) weighs that part at null,
    -- which both sums skip: the component simply does not count, as if it were unanswerable.
    select
      sum(case when p.value is null then 0
               else p.value * (p_weights ->> p.key)::numeric end)              as total,
      sum(case when p.value is null then 0
               else (p_weights ->> p.key)::numeric end)                        as denom
      from parts p
  ), penalty as (
    select (p_weights ->> 'seenPenalty')::numeric
             * ln((1 + greatest(coalesce(p_seen_count, 0), 0))::numeric) as v
  )
  select case
           when coalesce(denom, 0) = 0 then null
           else jsonb_build_object(
             'score', greatest(0, least(100,
               round(100 * ((total / denom) - (select v from penalty)))))::int,
             'components', jsonb_strip_nulls(jsonb_build_object(
               'prefMatch',    p_pref,
               'skillOverlap', p_skill,
               'recency',      p_recency,
               'affinity',     p_affinity,
               'quality',      p_quality,
               'urgency',      p_urgency,
               'cohort',       p_cohort,
               'popularity',   p_popularity,
               'fieldMatch',   p_field,
               'seenPenalty',  case when coalesce(p_seen_count, 0) > 0
                                    then round((select v from penalty), 4) end
             )),
             'coverage', round(denom, 3)
           )
         end
    from weighted;
$fn$;

/*
 * The weights, as a row. fieldMatch at 0.25 makes it the second-heaviest component after
 * prefMatch: the field is the strongest thing we know about a student who has not yet liked
 * anything, and the weights renormalize, so the rest keep their relative order.
 */
alter table public.ranking_weights drop constraint ranking_weights_shape;
alter table public.ranking_weights add constraint ranking_weights_shape check (
  jsonb_typeof(weights) = 'object'
  and weights ? 'prefMatch' and weights ? 'skillOverlap' and weights ? 'recency'
  and weights ? 'affinity' and weights ? 'quality' and weights ? 'urgency'
  and weights ? 'cohort' and weights ? 'popularity' and weights ? 'seenPenalty'
);

update public.ranking_weights set is_active = false where is_active;

insert into public.ranking_weights (name, is_active, weights, notes)
values (
  'v2-fields',
  true,
  jsonb_build_object(
    'prefMatch',    0.28,
    'fieldMatch',   0.25,
    'skillOverlap', 0.20,
    'recency',      0.16,
    'affinity',     0.14,
    'quality',      0.12,
    'urgency',      0.10,
    'cohort',       0.10,
    'popularity',   0.06,
    'seenPenalty',  0.30
  ),
  'PHASE8.md §4.2: v1-heuristic plus fieldMatch, the job''s family against the student''s.'
);

-- ── building a session ─────────────────────────────────────────────────────────

/*
 * Phase 5's session builder with three changes, and nothing else:
 *   - the ranked arm reads personal_candidate_pool (the recency arm keeps candidate_pool)
 *   - every candidate is scored on fieldMatch
 *   - the cohort signal joins on the claimed school when there is no verified one
 *     (PHASE8.md §3.3; a feed is private, so a false claim only costs the claimant)
 * The diversity and exploration passes are phase 5's, unchanged: PHASE5.md explains them.
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

  for rec in
    with pool as (select * from public.personal_candidate_pool(p_user_id, 600)),
    prefs as (
      select up.preferred_roles, up.preferred_locations, up.open_to_remote
        from public.user_preferences up where up.user_id = p_user_id
    ),
    resume as (
      select rp.skills, rp.seniority
        from public.resumes r
        join public.resume_profiles rp on rp.resume_id = r.id
       where r.user_id = p_user_id and r.is_default and r.deleted_at is null
         and r.parse_status = 'parsed'
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
          public.skill_jaccard((select r.skills from resume r), j.skills),
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

-- ── application answers ────────────────────────────────────────────────────────

/*
 * PHASE8.md §5. What a student answers on every application, stated once.
 *
 * `sources` records which fields came from the resume, so Profile can say "from your resume"
 * and so a later resume fills only what the student has not touched. Work authorization and
 * sponsorship are never prefilled: they are the two answers nothing may infer.
 */
create table public.application_answers (
  user_id             uuid primary key references public.profiles (id) on delete cascade,
  degree              text,
  field_of_study      text,
  work_authorized_us  boolean,
  needs_sponsorship   boolean,
  linkedin_url        text,
  github_url          text,
  portfolio_url       text,
  earliest_start      text,
  willing_to_relocate boolean,
  sources             jsonb not null default '{}',
  updated_at          timestamptz not null default now(),

  constraint application_answers_links_check check (
    (linkedin_url  is null or linkedin_url  ~* '^https?://') and
    (github_url    is null or github_url    ~* '^https?://') and
    (portfolio_url is null or portfolio_url ~* '^https?://')
  )
);

create trigger application_answers_set_updated_at
  before update on public.application_answers
  for each row execute function public.set_updated_at();

alter table public.application_answers enable row level security;

revoke all on public.application_answers from anon, authenticated;
grant select, insert, update on public.application_answers to authenticated;

create policy application_answers_select_own on public.application_answers
  for select to authenticated using ((select auth.uid()) = user_id);
create policy application_answers_insert_own on public.application_answers
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy application_answers_update_own on public.application_answers
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- ── the resume fills what the student left blank ──────────────────────────────

/*
 * Phase 4's confirm, plus decision A: confirming a parse fills `profiles.major`,
 * `profiles.graduation_year` and the application answers' degree and field when they are
 * blank, from the most recent education entry. Confirm rather than parse, because confirm is
 * the consent moment — the student has seen what was read. Blank rather than always, because
 * the resume is evidence and the student's own statement wins.
 */
create or replace function public.confirm_resume_profile(
  p_resume_id  uuid,
  p_skills     text[] default null,
  p_seniority  public.seniority_level default null,
  p_years      numeric default null,
  p_location   text default null
)
returns public.resume_card
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  uid     uuid := (select auth.uid());
  changed text[] := '{}';
  before  record;
  card    public.resume_card;
  latest  jsonb;
begin
  select p.* into before
    from public.resume_profiles p
    join public.resumes r on r.id = p.resume_id
   where p.resume_id = p_resume_id and r.user_id = uid and r.deleted_at is null;

  if before.resume_id is null then
    raise exception 'no parsed profile for that resume' using errcode = '23503';
  end if;

  if p_skills is not null and p_skills is distinct from before.skills then
    changed := array_append(changed, 'skills');
  end if;
  if p_seniority is not null and p_seniority is distinct from before.seniority then
    changed := array_append(changed, 'seniority');
  end if;
  if p_years is not null and p_years is distinct from before.years_experience then
    changed := array_append(changed, 'years_experience');
  end if;
  if p_location is not null and p_location is distinct from before.location then
    changed := array_append(changed, 'location');
  end if;

  update public.resume_profiles
     set skills            = coalesce(p_skills, skills),
         seniority         = coalesce(p_seniority, seniority),
         years_experience  = coalesce(p_years, years_experience),
         location          = coalesce(nullif(btrim(coalesce(p_location, '')), ''), location),
         user_confirmed_at = now(),
         confirmed_fields  = changed
   where resume_id = p_resume_id;

  -- The most recent education entry that names a field: graduation year descending, a missing
  -- year last, and the parser's own order (most recent first on a resume) as the tiebreak.
  select e.entry into latest
    from jsonb_array_elements(before.education) with ordinality as e(entry, n)
   where nullif(btrim(e.entry ->> 'field'), '') is not null
      or nullif(btrim(e.entry ->> 'degree'), '') is not null
   order by (e.entry ->> 'graduationYear')::int desc nulls last, e.n
   limit 1;

  if latest is not null then
    update public.profiles p
       set major           = coalesce(nullif(btrim(p.major), ''), nullif(btrim(latest ->> 'field'), '')),
           graduation_year = coalesce(p.graduation_year, (latest ->> 'graduationYear')::int)
     where p.id = uid;

    insert into public.application_answers (user_id, degree, field_of_study, sources)
    values (uid, nullif(btrim(latest ->> 'degree'), ''), nullif(btrim(latest ->> 'field'), ''),
            jsonb_strip_nulls(jsonb_build_object(
              'degree',         case when nullif(btrim(latest ->> 'degree'), '') is not null then 'resume' end,
              'field_of_study', case when nullif(btrim(latest ->> 'field'), '') is not null then 'resume' end)))
    on conflict (user_id) do update
       set degree         = coalesce(public.application_answers.degree, excluded.degree),
           field_of_study = coalesce(public.application_answers.field_of_study, excluded.field_of_study),
           sources        = public.application_answers.sources || jsonb_strip_nulls(jsonb_build_object(
                              'degree', case when public.application_answers.degree is null
                                              and excluded.degree is not null then 'resume' end,
                              'field_of_study', case when public.application_answers.field_of_study is null
                                                      and excluded.field_of_study is not null then 'resume' end));
  end if;

  -- Fields changed what the deck shows, so cached match scores are stale too.
  if array_length(changed, 1) is not null or latest is not null then
    perform public.invalidate_match_scores(uid);
  end if;

  select * into card from public.my_resumes() c where c.id = p_resume_id;
  return card;
end;
$fn$;

-- ── ingest writes the family ───────────────────────────────────────────────────

/*
 * 20261002000000's ingest_upsert_job with `job_family` carried through: compared in the
 * no-change check, written on update and insert. Nothing else differs. A classifier change
 * that moves a posting's family counts as a change, so a replay reclassifies the corpus.
 */
create or replace function public.ingest_upsert_job(p jsonb)
returns text
language plpgsql
as $$
declare
  v_company_id   uuid := (p ->> 'company_id')::uuid;
  v_title_norm   text := p ->> 'title_normalized';
  v_city         text := p ->> 'location_city';
  v_source_id    uuid := nullif(p ->> 'source_id', '')::uuid;
  v_external_id  text := p ->> 'external_id';
  v_seniority    public.seniority_level := nullif(p ->> 'seniority', '')::public.seniority_level;
  v_family       text := nullif(p ->> 'job_family', '');
  v_key          text := public.job_dedup_key(v_company_id, v_title_norm, v_city, v_seniority);
  v_existing     public.jobs%rowtype;
  v_new_id       uuid;
  v_near_id      uuid;
  v_near_score   real;
  v_requirements text[] := coalesce(array(select jsonb_array_elements_text(p -> 'requirements')), '{}');
  v_skills       text[] := coalesce(array(select jsonb_array_elements_text(p -> 'skills')), '{}');
  v_apply_url    text;
begin
  if v_source_id is not null and v_external_id is not null then
    select * into v_existing
      from public.jobs
     where source_id = v_source_id
       and external_id = v_external_id
       and coalesce(location_city, '*') = coalesce(v_city, '*')
       and status = 'open'
     limit 1;
  end if;

  if not found then
    select * into v_existing
      from public.jobs
     where dedup_key = v_key and status = 'open'
     limit 1;
  end if;

  if found then
    v_apply_url := case
                     when v_existing.source_id is null or v_existing.source_id = v_source_id
                     then p ->> 'apply_url' else v_existing.apply_url end;

    if (v_existing.title, v_existing.description_text, v_existing.requirements, v_existing.skills,
        v_existing.salary_min, v_existing.salary_max, v_existing.salary_period, v_existing.salary_currency,
        v_existing.seniority, v_existing.employment_type, v_existing.location_type,
        v_existing.quality_score, v_existing.closes_at, v_existing.apply_url,
        v_existing.description_html, v_existing.source_id, v_existing.external_id, v_existing.job_family)
       is not distinct from
       (p ->> 'title', p ->> 'description_text', v_requirements, v_skills,
        (p ->> 'salary_min')::numeric(12,2), (p ->> 'salary_max')::numeric(12,2),
        nullif(p ->> 'salary_period', '')::public.salary_period,
        coalesce(p ->> 'salary_currency', 'USD')::char(3),
        v_seniority, (p ->> 'employment_type')::public.employment_type,
        (p ->> 'location_type')::public.location_type,
        (p ->> 'quality_score')::real, nullif(p ->> 'closes_at', '')::timestamptz, v_apply_url,
        null::text, coalesce(v_existing.source_id, v_source_id), coalesce(v_existing.external_id, v_external_id),
        v_family)
    then
      update public.jobs
         set last_seen_at = now(),
             run_id       = nullif(p ->> 'run_id', '')::uuid
       where id = v_existing.id;
    else
      update public.jobs j
         set last_seen_at     = now(),
             title            = p ->> 'title',
             description_text = p ->> 'description_text',
             description_html = null,
             requirements     = v_requirements,
             skills           = v_skills,
             salary_min       = (p ->> 'salary_min')::numeric,
             salary_max       = (p ->> 'salary_max')::numeric,
             salary_period    = nullif(p ->> 'salary_period', '')::public.salary_period,
             salary_currency  = coalesce(p ->> 'salary_currency', 'USD'),
             seniority        = v_seniority,
             employment_type  = (p ->> 'employment_type')::public.employment_type,
             location_type    = (p ->> 'location_type')::public.location_type,
             quality_score    = (p ->> 'quality_score')::real,
             closes_at        = nullif(p ->> 'closes_at', '')::timestamptz,
             run_id           = nullif(p ->> 'run_id', '')::uuid,
             apply_url        = v_apply_url,
             source_id        = coalesce(j.source_id, v_source_id),
             external_id      = coalesce(j.external_id, v_external_id),
             job_family       = v_family
       where j.id = v_existing.id;
    end if;

    if v_existing.source_id is not distinct from v_source_id then
      if v_existing.external_id is not distinct from v_external_id then
        return 'updated';
      end if;
      return 'collapsed';
    end if;
    return 'duplicate';
  end if;

  insert into public.jobs (
    company_id, source_id, run_id, external_id, title, title_normalized, seniority,
    company_name, location_raw, location_city, location_region, location_country,
    location_type, employment_type, salary_min, salary_max, salary_period, salary_currency,
    description_text, requirements, skills, apply_url, apply_host,
    posted_at, closes_at, dedup_group_id, quality_score, job_family
  )
  values (
    v_company_id,
    v_source_id,
    nullif(p ->> 'run_id', '')::uuid,
    v_external_id,
    p ->> 'title',
    v_title_norm,
    v_seniority,
    p ->> 'company_name',
    p ->> 'location_raw',
    v_city,
    p ->> 'location_region',
    nullif(p ->> 'location_country', ''),
    (p ->> 'location_type')::public.location_type,
    (p ->> 'employment_type')::public.employment_type,
    (p ->> 'salary_min')::numeric,
    (p ->> 'salary_max')::numeric,
    nullif(p ->> 'salary_period', '')::public.salary_period,
    coalesce(p ->> 'salary_currency', 'USD'),
    p ->> 'description_text',
    v_requirements,
    v_skills,
    p ->> 'apply_url',
    p ->> 'apply_host',
    coalesce(nullif(p ->> 'posted_at', '')::timestamptz, now()),
    nullif(p ->> 'closes_at', '')::timestamptz,
    coalesce(nullif(p ->> 'dedup_group_id', '')::uuid, gen_random_uuid()),
    (p ->> 'quality_score')::real,
    v_family
  )
  returning id into v_new_id;

  select o.id, extensions.similarity(o.title_normalized, v_title_norm)
    into v_near_id, v_near_score
    from public.jobs o
   where o.company_id = v_company_id
     and o.status = 'open'
     and o.id <> v_new_id
     and o.seniority is not distinct from v_seniority
     and o.dedup_group_id is distinct from (select dedup_group_id from public.jobs where id = v_new_id)
     and coalesce(o.location_city, '*') = coalesce(v_city, '*')
     and extensions.similarity(o.title_normalized, v_title_norm) > 0.85
   order by 2 desc
   limit 1;

  if v_near_id is not null then
    insert into public.job_dedup_review (job_id, other_job_id, similarity, signal)
    values (v_new_id, v_near_id, v_near_score, 'title_trigram')
    on conflict (job_id, other_job_id) do nothing;
  end if;

  return 'created';
end;
$$;

revoke all on function public.ingest_upsert_job(jsonb) from public, anon, authenticated;

-- ── grants ─────────────────────────────────────────────────────────────────────

revoke all on function public.user_job_families(uuid)             from public, anon, authenticated;
revoke all on function public.target_seniorities(uuid)            from public, anon, authenticated;
revoke all on function public.personal_candidate_pool(uuid, integer) from public, anon, authenticated;
revoke all on function public.rank_score(jsonb, numeric, numeric, numeric, numeric, numeric,
                                         numeric, numeric, numeric, integer, numeric)
  from public, anon, authenticated;
revoke all on function public.my_deck_profile()                   from public, anon;

grant execute on function public.my_deck_profile()                    to authenticated;
grant execute on function public.user_job_families(uuid)             to service_role;
grant execute on function public.target_seniorities(uuid)            to service_role;
grant execute on function public.personal_candidate_pool(uuid, integer) to service_role;

-- Lookup tables the functions above read as their owner. RLS on with no policy, so an API
-- client sees nothing even if a grant is ever added by mistake.
alter table public.sector_families enable row level security;
alter table public.major_families  enable row level security;
revoke all on public.sector_families, public.major_families from anon, authenticated;
