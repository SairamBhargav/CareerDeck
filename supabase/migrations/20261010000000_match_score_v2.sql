/*
 * The resume match score, rebuilt (2026-10-06).
 *
 * Measured on the account with the most scores before this migration: 113 of 395 scores were
 * 90–100 and 262 were 30–39, and neither number meant what it said.
 *
 * ── what was wrong ─────────────────────────────────────────────────────────────────
 *
 *  1. **The two sides never spoke the same skill language.** The resume parser stores slugs
 *     (`machine-learning`, `c-plus-plus`, `google-cloud`); the crawler stores dictionary labels
 *     (`Machine Learning`, `C++`, `Google Cloud`). skill_jaccard() only case-folded, so a skill
 *     matched only when its slug happened to equal its lower-cased label — python, java, sql.
 *     "Machine Learning Intern" scored 0 skill overlap against a resume listing machine learning.
 *     The deck's ranking (build_feed_session) calls the same function, so it had the same blind
 *     spot; fixing the function here fixes both.
 *  2. **Jaccard punished a full resume.** Overlap ÷ union: 3 shared skills between a 24-skill
 *     resume and a 9-skill posting is 3/30 = 10%. Listing more of what you know lowered the score.
 *  3. **Nothing asked whether the job was in your field.** A CS resume and an analog-IC
 *     internship were indistinguishable once both said "intern".
 *  4. **A missing input became a perfect score.** Weights renormalized over whatever was
 *     answerable, so a posting with no skills, for a reader with no stated cities, was scored on
 *     seniority alone: intern = intern, 100%.
 *  5. **Cached scores were never recomputed** when the formula or the posting changed.
 *
 * ── what replaces it ───────────────────────────────────────────────────────────────
 *
 *   skills     0.45   share of the posting's core skills the resume has, with 60% counting as
 *                     full marks — a resume never lists everything. "Practice" skills
 *                     (Communication, Testing, Technical Writing) are not core: they are on half
 *                     of all postings and on almost no resumes.
 *   field      0.25   the posting's job_family against the reader's own fields, taken from the
 *                     resume's degree and the profile's major before onboarding's sectors —
 *                     "Technology" maps to hardware as well as software, which is how a CS
 *                     student's analog-IC internship read as theirs.
 *   seniority  0.20   unchanged.
 *   location   0.10   unchanged; a preference, not a qualification.
 *
 * Renormalizing over what is known stays — a missing location should not read as a bad one — but
 * caps now stop a thin or wrong-field score from looking confident:
 *
 *   wrong field (≤ 0.1)       → at most 35
 *   adjacent field (≤ 0.35)   → at most 60
 *   two or more rungs off     → at most 40
 *   no core skills to compare → at most 70, and `limited`
 *   …in an adjacent field     → at most 45
 *   …and no field either      → at most 55
 *
 * `components` carries the matched and missing skills, so the app can say why.
 */

-- ── one key per skill, whichever side wrote it ─────────────────────────────────

/*
 * Every spelling the dictionary knows, mapped to its slug: the slug, the label, each alias, and
 * each of those with spaces turned to hyphens (the resume parser hyphenates: `c-plus-plus` is the
 * alias "c plus plus"). A table rather than a lookup over `skills`, because build_feed_session
 * keys a whole candidate pool's skills per call and this makes each key one index probe.
 */
create table public.skill_terms (
  term text primary key check (term = lower(term)),   -- lower-cased, so lookups are plain text
  slug text not null
);

alter table public.skill_terms enable row level security;
revoke all on public.skill_terms from anon, authenticated;

create or replace function public.rebuild_skill_terms()
returns void
language sql
security definer
set search_path = ''
as $fn$
  delete from public.skill_terms;
  insert into public.skill_terms (term, slug)
  select distinct on (lower(term)) lower(term), lower(slug::text)
    from (
      select s.slug, v.term, v.rank
        from public.skills s
        cross join lateral (
          select s.slug::text as term, 0 as rank
          union all select s.label, 1
          union all select a::text, 2 from unnest(s.aliases) a
        ) v
      union all
      select s.slug, replace(v.term, ' ', '-'), v.rank + 3
        from public.skills s
        cross join lateral (
          select s.label as term, 1 as rank
          union all select a::text, 2 from unnest(s.aliases) a
        ) v
       where v.term like '% %'
    ) spellings(slug, term, rank)
   where btrim(term) <> ''
   -- A spelling two skills claim goes to the one whose own slug or label it is.
   order by lower(term), rank;
$fn$;

create or replace function public.skills_rebuild_terms()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  perform public.rebuild_skill_terms();
  return null;
end;
$fn$;

create trigger skills_rebuild_terms
  after insert or update or delete on public.skills
  for each statement execute function public.skills_rebuild_terms();

select public.rebuild_skill_terms();

/*
 * A skill as the dictionary's slug when the dictionary knows it, and as a normalized form of
 * itself when it does not (`netsuite-suitescript` still matches `NetSuite SuiteScript`).
 */
create or replace function public.skill_key(p_skill text)
returns text
language sql
stable
set search_path = ''
as $fn$
  select coalesce(
    (select t.slug from public.skill_terms t where t.term = lower(btrim(p_skill))),
    nullif(btrim(regexp_replace(lower(btrim(p_skill)), '[^a-z0-9+#]+', '-', 'g'), '-'), '')
  );
$fn$;

/*
 * Same contract as phase 4's (0–1, null when the posting lists no skills, 0 when the resume
 * lists none), but over canonical keys. Still Jaccard, because the deck's ranking blends it with
 * five other signals under weights tuned against it; only the resume match moves to coverage.
 * Stable rather than immutable now that it reads the dictionary.
 */
create or replace function public.skill_jaccard(p_left text[], p_right text[])
returns numeric
language sql
stable
set search_path = ''
as $fn$
  with l as (select distinct public.skill_key(s) as k from unnest(coalesce(p_left, '{}')) s
              where btrim(s) <> ''),
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

-- ── the three new ingredients ──────────────────────────────────────────────────

/*
 * Which of the posting's skills the resume has, by label as the posting wrote it.
 * `core` excludes the dictionary's "practice" category.
 */
create or replace function public.skill_fit(p_resume text[], p_job text[])
returns jsonb
language sql
stable
set search_path = ''
as $fn$
  with r as (
    select distinct public.skill_key(s) as k from unnest(coalesce(p_resume, '{}')) s where btrim(s) <> ''
  ),
  j as (
    select distinct on (k) k, label,
           coalesce((select sk.category from public.skills sk
                      join public.skill_terms t on t.slug = lower(sk.slug::text)
                     where t.term = k), '') = 'practice'
             as generic
      from (select public.skill_key(s) as k, btrim(s) as label
              from unnest(coalesce(p_job, '{}')) s where btrim(s) <> '') keyed
     order by k, label
  ),
  core as (select * from j where not generic)
  select jsonb_build_object(
    'core',     (select count(*) from core),
    'resume',   (select count(*) from r),
    'matched',  coalesce((select jsonb_agg(label order by label) from core where k in (select k from r)), '[]'::jsonb),
    'missing',  coalesce((select jsonb_agg(label order by label) from core where k not in (select k from r)), '[]'::jsonb)
  );
$fn$;

/*
 * The reader's own fields for scoring: the resume's degrees and the profile's major, which say
 * what the person studied. Onboarding's sectors only when neither exists — "Technology" is a
 * sector, not a discipline, and maps to three families.
 */
create or replace function public.resume_job_families(p_user_id uuid)
returns text[]
language sql
stable
set search_path = ''
as $fn$
  with studied as (
    select mf.family
      from public.profiles p
      join public.major_families mf on p.major ~* mf.pattern
     where p.id = p_user_id and nullif(btrim(p.major), '') is not null
    union
    select mf.family
      from public.resumes r
      join public.resume_profiles rp on rp.resume_id = r.id
      cross join lateral jsonb_array_elements(rp.education) as e(entry)
      join public.major_families mf on (e.entry ->> 'field') ~* mf.pattern
     where r.user_id = p_user_id and r.is_default and r.deleted_at is null
       and r.parse_status = 'parsed'
  )
  select case
           when exists (select 1 from studied) then (select array_agg(distinct family order by family) from studied)
           else public.user_job_families(p_user_id)
         end;
$fn$;

/*
 * How well a posting's family suits someone from these fields, 0–1. Adjacent families keep some
 * credit: a CS student can do a data internship, and a data student a software one.
 */
create or replace function public.field_affinity(p_job_family text, p_families text[])
returns numeric
language sql
immutable
set search_path = ''
as $fn$
  select case
           when p_job_family is null or coalesce(array_length(p_families, 1), 0) = 0 then null
           when p_job_family = any (p_families) then 1.0
           else coalesce((
             select max(a.affinity)
               from unnest(p_families) f(family)
               join (values
                 ('software', 'data_ml', 0.6), ('data_ml', 'software', 0.6),
                 ('software', 'hardware', 0.3), ('hardware', 'software', 0.3),
                 ('software', 'product', 0.3), ('data_ml', 'product', 0.3),
                 ('data_ml', 'business', 0.35), ('business', 'data_ml', 0.35),
                 ('product', 'software', 0.3), ('product', 'design', 0.35), ('design', 'product', 0.35),
                 ('product', 'business', 0.3), ('business', 'product', 0.3),
                 ('business', 'sales_marketing', 0.35), ('sales_marketing', 'business', 0.35),
                 ('business', 'operations', 0.35), ('operations', 'business', 0.35),
                 ('sales_marketing', 'operations', 0.3), ('operations', 'sales_marketing', 0.3)
               ) as a(from_family, to_family, affinity)
                 on a.from_family = f.family and a.to_family = p_job_family
           ), 0.05)
         end::numeric;
$fn$;

-- ── the score ──────────────────────────────────────────────────────────────────

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
  with fit as (
    select public.skill_fit(p_resume_skills, p_job_skills) as f
  ), parts as (
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

-- ── the cache ──────────────────────────────────────────────────────────────────

/*
 * Which formula wrote a row. match_scores() recomputes any row from an older one, and any row
 * computed before its posting last changed — a backfilled description brings new skills.
 */
alter table public.job_match_scores add column scorer_version smallint not null default 1;

-- Every existing row is formula 1; they rebuild lazily as postings come on screen.
delete from public.job_match_scores;

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

-- ── grants ─────────────────────────────────────────────────────────────────────

revoke all on function public.rebuild_skill_terms()                     from public, anon, authenticated;
revoke all on function public.skills_rebuild_terms()                    from public, anon, authenticated;
revoke all on function public.skill_key(text)                           from public, anon, authenticated;
revoke all on function public.skill_fit(text[], text[])                 from public, anon, authenticated;
revoke all on function public.resume_job_families(uuid)                 from public, anon, authenticated;
revoke all on function public.field_affinity(text, text[])              from public, anon, authenticated;
revoke all on function public.compute_match_v2(text[], public.seniority_level, text[], text[],
  public.seniority_level, text, text, text, public.location_type, text[], boolean)
  from public, anon, authenticated;
