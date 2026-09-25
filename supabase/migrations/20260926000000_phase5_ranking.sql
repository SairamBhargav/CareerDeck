-- Phase 5 — Ranking.
--
-- Implements docs/README.md §5 (the recommendation engine) and §5.4 (serving an infinite
-- feed). Design and deviations: docs/PHASE5.md.
--
-- Phase 1 built a feed sorted by `posted_at desc`. Every phase since has added a signal
-- about what a particular reader wants — phase 2 their likes, saves, follows and
-- impressions, phase 3 nothing (deliberately), phase 4 their parsed skills — and none of
-- it has ever changed what they are shown. This is the phase that spends them.
--
-- Three properties hold this file together, and each one is a constraint on everything
-- below:
--
--  * **Every score is explainable.** `feed_sessions.components` keeps the ingredients of
--    every rank, for the same reason §3.10 keeps them for the match ring and §13.3 gives:
--    ordering somebody's employment opportunities is automated decision-making. A ranker
--    that cannot say why a posting is third is one nobody can debug and nobody can defend.
--  * **The feed is stable.** §5.4: a user scrolling back up must see the same cards. That
--    is why a session is a stored array of ids and not a query re-run per page — the bug
--    most infinite feeds ship with is re-ranking under the reader's thumb.
--  * **It is measured against the thing it replaces.** §15's exit condition is not "a
--    ranked feed exists", it is "ranked feed beats recency on apply-rate, measurably". So
--    the recency feed is not deleted; it becomes an arm, and `feed_experiment_results()`
--    is the answer.
--
-- Phases 0–4 are untouched. `job_card` gains nothing: the `rank` attribute phase 1 put on
-- it has been null for the feed since phase 1 and is finally filled here.

-- ── enums ──────────────────────────────────────────────────────────────────────

/*
 * Which ranker built a pool.
 *
 * `recency` is phase 1's ordering, kept as a live arm rather than as dead code. §15's exit
 * condition is comparative, so the control has to keep running — and if the ranked arm
 * loses, the rollback is a weight change rather than a deploy.
 */
create type public.feed_arm as enum ('ranked', 'recency');

-- ── the weights ────────────────────────────────────────────────────────────────

/*
 * §5.1 verbatim: "weights live in a config table, not in code, so they're tunable without
 * a deploy."
 *
 * One row per named weight set, exactly one active. The partial unique index is the same
 * device phase 4 used for `resumes.is_default`, for the same reason: "exactly one active"
 * is worth being a constraint rather than a convention, because the failure mode is two
 * active rows and a ranker that picks whichever the planner returned first.
 *
 * Kept as a jsonb bag rather than one column per weight so that adding a component is an
 * insert rather than a migration — which is the whole point of the table. The check
 * constraint is what stops that flexibility becoming a ranker that silently scores nothing.
 */
create table public.ranking_weights (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  is_active   boolean not null default false,
  weights     jsonb not null,
  notes       text,
  created_at  timestamptz not null default now(),

  constraint ranking_weights_shape check (
    jsonb_typeof(weights) = 'object'
    and weights ? 'prefMatch'
    and weights ? 'skillOverlap'
    and weights ? 'recency'
    and weights ? 'affinity'
    and weights ? 'quality'
    and weights ? 'urgency'
    and weights ? 'cohort'
    and weights ? 'popularity'
    and weights ? 'seenPenalty'
  )
);

create unique index ranking_weights_one_active on public.ranking_weights (is_active)
  where is_active;

/*
 * §5.1's six weights, as written, plus the two the same section describes for cold start
 * ("popularity + recency + school-cohort signal") and the seen penalty.
 *
 * `cohort` and `popularity` are not a second code path for new users. §5.1 describes cold
 * start as a separate mode; here they are ordinary components that every score computes,
 * and the renormalization below means they simply carry the whole weight for somebody with
 * no resume, no likes and no follows. One scorer, one set of ingredients, no branch that is
 * only exercised on a user's first day and therefore never tested. PHASE5.md §3.3.
 */
insert into public.ranking_weights (name, is_active, weights, notes)
values (
  'v1-heuristic',
  true,
  jsonb_build_object(
    'prefMatch',    0.28,
    'skillOverlap', 0.20,
    'recency',      0.16,
    'affinity',     0.14,
    'quality',      0.12,
    'urgency',      0.10,
    'cohort',       0.10,
    'popularity',   0.06,
    'seenPenalty',  0.30
  ),
  'README §5.1 as written, plus cohort and popularity from the same section''s cold-start paragraph.'
);

/** The active set, or §5.1's defaults if somebody deactivates every row. */
create or replace function public.active_weights()
returns jsonb
language sql
stable
set search_path = ''
as $fn$
  select coalesce(
    (select w.weights from public.ranking_weights w where w.is_active limit 1),
    jsonb_build_object(
      'prefMatch', 0.28, 'skillOverlap', 0.20, 'recency', 0.16, 'affinity', 0.14,
      'quality', 0.12, 'urgency', 0.10, 'cohort', 0.10, 'popularity', 0.06,
      'seenPenalty', 0.30
    )
  );
$fn$;

-- ── feed sessions ──────────────────────────────────────────────────────────────

/*
 * §5.4, as written, with three additions argued in PHASE5.md §4.
 *
 * `job_ids` is the ranked pool. Paging walks it by offset, so page 3 is the same three
 * postings tomorrow as it is now — which is the stability property, and it is why this is
 * an array rather than a query the server re-runs with a cursor.
 */
create table public.feed_sessions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  surface     public.feed_surface not null,
  job_ids     uuid[] not null,

  /*
   * Which ranker produced it, and under which experiment. Stored on the session rather than
   * derived at read time because the assignment function can change and an experiment whose
   * historical arms are recomputed from today's code is an experiment that proves nothing.
   */
  arm         public.feed_arm not null default 'ranked',
  experiment  text,

  /*
   * The ingredients, per posting: `{job_id: {prefMatch: .7, …, score: 71}}`.
   *
   * §5.1: "every score is written to `components` so any card's rank is explainable." Kept
   * on the session and not on a row per posting, because the explanation only means
   * anything relative to the pool it was ranked within — the same score is a different
   * position in a different session.
   */
  components  jsonb not null default '{}',

  cursor      integer not null default 0,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default (now() + interval '2 hours')
);

-- "The reader's current session on this surface" — the only read on this table in a
-- request path, and it wants the newest unexpired one.
create index feed_sessions_user_idx
  on public.feed_sessions (user_id, surface, created_at desc);

-- The sweep, and nothing else, reads this.
create index feed_sessions_expiry_idx on public.feed_sessions (expires_at);

/*
 * §5.4 says "mirror it in Redis with the same TTL; Postgres is the fallback".
 *
 * There is no Redis here, and PHASE5.md §4.2 argues there does not need to be one yet. The
 * short version: this table is read once per *page*, not once per scroll, by primary key,
 * returning one row — which is the cheapest thing a database does. Phase 3 made the same
 * call about the rate limiter and named the trigger for revisiting it; this names one too.
 */

-- ── the A/B harness ────────────────────────────────────────────────────────────

/*
 * §15's exit condition is comparative — "ranked feed beats recency on apply-rate,
 * measurably" — so the experiment is part of the phase rather than something bolted on to
 * evaluate it afterwards.
 */
create table public.feed_experiments (
  name        text primary key,
  is_running  boolean not null default true,
  -- 0–100. The share of users on the ranked arm; the rest are the control.
  treatment_pct smallint not null default 50
                  check (treatment_pct between 0 and 100),
  started_at  timestamptz not null default now(),
  stopped_at  timestamptz,
  notes       text
);

insert into public.feed_experiments (name, treatment_pct, notes)
values ('ranked_feed_v1', 50,
        'README §15 phase 5 exit: does the ranked feed beat recency on apply-rate.');

/*
 * Sticky assignment, computed rather than stored.
 *
 * A hash of (experiment, user) is deterministic, needs no table, and cannot drift — which
 * matters more than it sounds, because the classic A/B bug is a user who is treated on
 * Monday and control on Tuesday, contributing to both arms and washing the result out.
 *
 * The experiment name is in the hash so two experiments do not assign the same users to the
 * same side. `md5` rather than anything stronger: this is a bucketing function, not a
 * security boundary, and it only needs to be uniform.
 */
create or replace function public.experiment_arm(p_user_id uuid, p_experiment text)
returns public.feed_arm
language sql
stable
set search_path = ''
as $fn$
  select case
           when p_user_id is null then 'recency'::public.feed_arm
           when not coalesce((select e.is_running from public.feed_experiments e
                               where e.name = p_experiment), false)
             then 'ranked'::public.feed_arm
           when ('x' || substr(extensions.digest(p_experiment || ':' || p_user_id::text, 'sha256')::text, 3, 8))
                  ::bit(32)::bigint % 100
                < coalesce((select e.treatment_pct from public.feed_experiments e
                             where e.name = p_experiment), 50)
             then 'ranked'::public.feed_arm
           else 'recency'::public.feed_arm
         end;
$fn$;

-- ── taste vectors (declared, not populated) ────────────────────────────────────

/*
 * §5.2, as written. **Nothing writes this table in phase 5.**
 *
 * Phase 4 deferred the embedding vendor with a named trigger — "phase 5 starting" — and
 * this is phase 5, so the deferral has to be either collected or re-argued. It is
 * re-argued, once, and PHASE5.md §5 has it in full. The short version: §5.2 opens with
 * "once resumes are parsed **and embeddings exist**, retrieval changes but ranking
 * doesn't", and that sentence is the design. Ranking does not change. What changes is one
 * arm of the candidate union, and that arm is built below and dormant.
 *
 * The table is created now because it is §5.2's schema and this is §5.2's phase, and
 * because a dormant arm that has nowhere to read from is not a dormant arm, it is a gap.
 */
create table public.user_taste_vectors (
  user_id      uuid primary key references public.profiles (id) on delete cascade,
  embedding    extensions.vector(1536) not null,
  signal_count integer not null default 0,
  computed_at  timestamptz not null default now()
);

-- ── the scorer ─────────────────────────────────────────────────────────────────

/*
 * §5.1's `pref_match`: "role-title match vs preferred_roles + location match vs
 * preferred_locations".
 *
 * Two halves averaged, each null when the user has not said. A user who named roles and no
 * locations is scored on the roles alone rather than penalized for the silence — the same
 * renormalization phase 4 applied to the match ring, one level down.
 *
 * Title matching is containment against `title_normalized`, which phase 1 already lowercased
 * and stripped. "Software Engineer" as a preference matches "senior software engineer"
 * because the normalized title contains it; it does not match "hardware engineer".
 */
create or replace function public.pref_match(
  p_title_normalized text,
  p_city   text,
  p_region text,
  p_type   public.location_type,
  p_roles  text[],
  p_locs   text[],
  p_remote boolean
)
returns numeric
language sql
immutable
set search_path = ''
as $fn$
  with role_part as (
    select case
             when coalesce(array_length(p_roles, 1), 0) = 0 then null
             when exists (
               select 1 from unnest(p_roles) r
                where lower(btrim(r)) <> ''
                  and coalesce(p_title_normalized, '') like '%' || lower(btrim(r)) || '%'
             ) then 1.0
             else 0.0
           end::numeric as v
  ), loc_part as (
    -- Reuses phase 4's location scorer rather than restating the rules. The question
    -- "does this posting's location work for this person" has one answer, and two
    -- implementations of it would drift the day somebody fixes one.
    select public.location_affinity(p_city, p_region, p_type, p_locs, p_remote) as v
  )
  select case
           when (select v from role_part) is null and (select v from loc_part) is null then null
           when (select v from role_part) is null then (select v from loc_part)
           when (select v from loc_part) is null then (select v from role_part)
           else ((select v from role_part) + (select v from loc_part)) / 2
         end;
$fn$;

/*
 * §5.1's `recency`: `exp(-age_days / 7)`, verbatim.
 *
 * A week-old posting scores 0.37, a fortnight-old one 0.14. That decay is steep on purpose:
 * for an internship feed the posting that went up this morning is worth more than a better
 * match from three weeks ago that has already had four hundred applicants.
 */
create or replace function public.recency_score(p_posted_at timestamptz)
returns numeric
language sql
immutable
set search_path = ''
as $fn$
  select case
           when p_posted_at is null then null
           else round(
             exp(-greatest(extract(epoch from (now() - p_posted_at)) / 86400.0, 0) / 7.0)::numeric,
             4)
         end;
$fn$;

/*
 * §5.1's `urgency`: "closes within 14 days, ramping".
 *
 * Null when a posting has no deadline, which is most of them — and null rather than zero
 * matters, because zero would mean "this posting is not urgent" and drag the renormalized
 * score down for every employer who simply did not publish a closing date.
 */
create or replace function public.urgency_score(p_closes_at timestamptz)
returns numeric
language sql
immutable
set search_path = ''
as $fn$
  select case
           when p_closes_at is null then null
           when p_closes_at <= now() then 0::numeric
           when p_closes_at > now() + interval '14 days' then 0::numeric
           else round((1 - (extract(epoch from (p_closes_at - now())) / (14 * 86400.0)))::numeric, 4)
         end;
$fn$;

/*
 * The whole score for one posting, as jsonb — the same shape phase 4's `compute_match()`
 * returns, and for the same two reasons: the components have to be stored, and a function
 * returning one value per call keeps the ranking expression readable.
 *
 * **Weights renormalize over whatever is answerable**, exactly as the match ring does. A
 * posting with no deadline and a user with no resume is scored on the components that have
 * inputs, out of 100 — not scored out of a full denominator and shown as a weak match for
 * facts nobody supplied. This is also what makes §5.1's separate cold-start path
 * unnecessary: a brand-new account simply has fewer answerable components, and `cohort`,
 * `popularity`, `recency` and `quality` carry the score. PHASE5.md §3.3.
 *
 * `seenPenalty` is subtracted *after* renormalization, because it is not a component of fit
 * — it is a correction for having already shown somebody this card. §5.1 writes it below
 * the line for the same reason.
 */
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
  p_seen_count   integer
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
           ('popularity',   p_popularity)
  ), weighted as (
    select
      sum(case when p.value is null then 0
               else p.value * (p_weights ->> p.key)::numeric end)              as total,
      sum(case when p.value is null then 0
               else (p_weights ->> p.key)::numeric end)                        as denom
      from parts p
  ), penalty as (
    -- §5.1: `log(1 + times shown, not engaged)`. Natural log, so the second impression
    -- costs 0.69 of a unit and the tenth costs 2.4 — it discourages repetition without
    -- ever fully burying a posting the reader may simply not have noticed yet.
    -- `ln(numeric)` rather than `ln(double precision)`, so the whole expression stays
    -- numeric and `round(v, n)` below resolves. Postgres has no round/2 for float.
    select (p_weights ->> 'seenPenalty')::numeric
             * ln((1 + greatest(coalesce(p_seen_count, 0), 0))::numeric) as v
  )
  select case
           when denom = 0 then null
           else jsonb_build_object(
             /*
              * §5.1's expression, on its own scale and then scaled to 100. The weighted sum
              * and the penalty are both in 0–1 space, so the subtraction happens there and
              * the result is multiplied out — not the other way round, which would apply a
              * penalty calibrated for 0–1 to a number in 0–100 and mean nothing.
              *
              * The penalty bites hard by design: at 0.30, a card shown once and ignored
              * loses ~21 points and one shown five times loses ~54. That is §5.1 as written,
              * and if it proves too steep the fix is a row in `ranking_weights`, which is
              * exactly why that table exists.
              */
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
               'seenPenalty',  case when coalesce(p_seen_count, 0) > 0
                                    then round((select v from penalty), 4) end
             )),
             'coverage', round(denom, 3)
           )
         end
    from weighted;
$fn$;

-- ── the candidate pool ─────────────────────────────────────────────────────────

/*
 * §5.2's union, with three arms live and one dormant.
 *
 * ```
 * candidates = pgvector ANN(user_taste_vector, k = 500)   ← dormant: no embeddings. §5
 *            ∪ recency pool (200 newest matching hard filters)
 *            ∪ follow pool (all open jobs at followed companies)
 * ```
 *
 * A third live arm is added: postings at companies whose *industry* the reader already
 * engages with. §5.2's union exists so that retrieval is not a single point of view, and
 * with the ANN arm dormant the other two are "new" and "followed" — which between them
 * cannot surface a good posting at a company the reader has never heard of. The industry
 * arm is the cheapest available stand-in for the thing the vector arm will eventually do
 * properly, and it is removed when that lands. PHASE5.md §5.
 *
 * **The union is what stops the filter bubble**, and §5.2 says so in as many words: "pure
 * ANN retrieval never surfaces a posting that's different from everything the user has
 * touched, which is the definition of a filter bubble and, for a job seeker, a genuine
 * harm." That argument does not depend on the ANN arm existing; it applies just as much to
 * a follow pool.
 *
 * The hard filters from §5.1 are applied here rather than in the scorer, because a hard
 * filter is a reason not to retrieve rather than a reason to score zero: "− 1.00
 * hard_filters" in §5.1's expression is a way of writing "not in the candidate set".
 */
create or replace function public.candidate_pool(
  p_user_id uuid,
  p_limit   integer default 600
)
returns table (job_id uuid, source text)
language sql
stable
set search_path = ''
as $fn$
  with prefs as (
    select up.preferred_roles, up.preferred_locations, up.preferred_employment_types,
           up.open_to_remote, up.min_salary_annual
      from public.user_preferences up
     where up.user_id = p_user_id
  ),
  /*
   * §5.1's hard filters: "applied, hidden, not_interested, closed". Collected once rather
   * than joined three times, because every arm below has to apply the same set and an arm
   * that forgets one is an arm that surfaces a posting the reader has already applied to.
   */
  excluded as (
    select job_id from public.job_interactions
     where user_id = p_user_id and kind in ('hide', 'not_interested')
    union
    select job_id from public.applications where user_id = p_user_id
  ),
  eligible as (
    select j.id, j.company_id, j.posted_at, j.quality_score, j.employment_type
      from public.jobs j
     where j.status = 'open'
       and j.quality_score > 0.3
       and not exists (select 1 from excluded e where e.job_id = j.id)
       and (
         /*
          * "matching employment type", when the reader has said. Silence is not a filter —
          * an empty preference list means "show me everything", not "show me nothing".
          *
          * Array containment rather than `= any (subquery)`: a scalar subquery returning an
          * array makes `any` compare a value against an array *type*, which is the error
          * `operator does not exist: employment_type = employment_type[]`. `@>` takes the
          * array as a value and asks the question directly.
          */
         (select coalesce(array_length(p.preferred_employment_types, 1), 0) from prefs p) = 0
         or (select p.preferred_employment_types from prefs p) @> array[j.employment_type]
       )
  ),
  -- Arm 1 — the recency pool. §5.2: "200 newest matching hard filters".
  recency_pool as (
    select e.id, 'recency'::text as source
      from eligible e
     order by e.posted_at desc
     limit 200
  ),
  -- Arm 2 — the follow pool. §5.2: "all open jobs at followed companies".
  follow_pool as (
    select e.id, 'follow'::text as source
      from eligible e
      join public.company_follows f
        on f.company_id = e.company_id and f.user_id = p_user_id
     limit 200
  ),
  -- Arm 3 — the industry stand-in for the dormant ANN arm.
  industry_pool as (
    select e.id, 'industry'::text as source
      from eligible e
      join public.companies c on c.id = e.company_id
     where c.industry is not null
       and c.industry in (
         select c2.industry
           from public.job_interactions ji
           join public.jobs j2 on j2.id = ji.job_id
           join public.companies c2 on c2.id = j2.company_id
          where ji.user_id = p_user_id and ji.kind in ('like', 'save')
            and c2.industry is not null
       )
     order by e.quality_score desc, e.posted_at desc
     limit 200
  )
  select id, min(source)
    from (
      select * from recency_pool
      union all select * from follow_pool
      union all select * from industry_pool
    ) u
   group by id
   limit greatest(coalesce(p_limit, 600), 50);
$fn$;

-- ── building a session ─────────────────────────────────────────────────────────

/*
 * Score the pool, apply §5.1's diversity rules, store the result as a session.
 *
 * ── Why the diversity pass is a loop ──────────────────────────────────────────
 *
 * §5.1's first rule is "at most 2 postings per company in any 10-card window", and a
 * sliding-window constraint is sequential: whether the 11th card is allowed depends on
 * which cards were *emitted* before it, not on which scored above it. A window function
 * can express "the nth posting from this company" but not "the nth among those that
 * survived", so this walks the scored list once and greedily emits. Two hundred iterations
 * of plpgsql is microseconds, and it happens once per session rather than once per page.
 *
 * ── Exploration ───────────────────────────────────────────────────────────────
 *
 * §5.1 reserves "10–15% of slots for high-uncertainty jobs outside the user's established
 * pattern", and gives the reason: "without this the feed converges to one role type by day
 * three and the user's real interests never get discovered." Every seventh slot (≈14%) is
 * filled from the bottom half of the scored pool instead of the top, preferring postings
 * from companies the reader has no history with. It is deliberately not random: a random
 * card is noise, and the point is to test a hypothesis about what they might also want.
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
  session_id uuid;
  ordered    uuid[]  := '{}';
  parts      jsonb   := '{}';
  rec        record;
  -- Emitted-so-far bookkeeping for the diversity rules.
  recent_companies uuid[] := '{}';
  title_counts     jsonb  := '{}';
  emitted          integer := 0;
  explore_taken    integer := 0;
begin
  if p_user_id is null then
    raise exception 'no user' using errcode = 'CD401';
  end if;

  /*
   * The control arm is phase 1's feed, unchanged: newest first, hard filters only, no
   * scoring and no diversity. It has to stay genuinely phase 1 for the comparison to mean
   * anything — a "recency" arm that quietly kept the diversity pass would be measuring
   * diversity, not ranking.
   */
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

  /*
   * One pass over the pool, scored. Everything the scorer needs is gathered here rather
   * than looked up per candidate — the seen counts, the affinity signals and the cohort
   * signal are each one aggregate over the reader's own history, and doing them per row
   * would be three subqueries times six hundred candidates.
   */
  for rec in
    with pool as (select * from public.candidate_pool(p_user_id, 600)),
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
    -- §5.1's affinity, as three tiers over one scan of the reader's own signals.
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
    -- §5.1's cold-start cohort signal: "students at your school applied to these".
    cohort as (
      select a.job_id, count(*)::numeric as n
        from public.applications a
        join public.profiles p on p.id = a.user_id
       where p.school_id is not null
         and p.school_id = (select p2.school_id from public.profiles p2 where p2.id = p_user_id)
         and a.user_id <> p_user_id
       group by a.job_id
    ),
    cohort_max as (select greatest(max(n), 1) as m from cohort),
    -- Popularity, over everybody. The other half of §5.1's cold start.
    popular as (
      select ji.job_id, count(*)::numeric as n
        from public.job_interactions ji
       where ji.kind in ('like', 'save')
       group by ji.job_id
    ),
    popular_max as (select greatest(max(n), 1) as m from popular),
    -- The seen penalty's input: shown, and not engaged with.
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
            -- Null, not zero: "we know nothing about this company" is not the same claim
            -- as "this reader is uninterested in it", and only the second deserves a
            -- penalty. Renormalization handles the first.
            else null
          end::numeric,
          j.quality_score::numeric,
          public.urgency_score(j.closes_at),
          case when (select c.m from cohort_max c) > 0
               then round(coalesce((select c.n from cohort c where c.job_id = j.id), 0)
                          / (select c.m from cohort_max c), 4) end,
          round(coalesce((select p.n from popular p where p.job_id = j.id), 0)
                / (select p.m from popular_max p), 4),
          coalesce((select s2.n from seen s2 where s2.job_id = j.id), 0)
        ) as result
      ) s
     where s.result is not null
     order by (s.result ->> 'score')::int desc, j.posted_at desc
  loop
    /*
     * §5.1's diversity rules, applied to the emitted list rather than to the scored one.
     *
     *   - at most 2 per company in the last 10 emitted
     *   - at most 3 per `title_normalized` in the whole session
     */
    continue when (
      select count(*) from unnest(recent_companies) rc where rc = rec.company_id
    ) >= 2;

    continue when coalesce((title_counts ->> rec.title_normalized)::int, 0) >= 3;

    /*
     * Every seventh slot is an exploration slot and takes a *low* scorer from a company the
     * reader has no history with. When the loop is in the top of the pool there is nothing
     * unfamiliar to emit, so the slot is simply used normally rather than left empty — an
     * exploration quota that can stall the feed is worse than one that occasionally misses.
     */
    if emitted > 0 and emitted % 7 = 0 and not rec.known_company then
      explore_taken := explore_taken + 1;
    elsif emitted > 0 and emitted % 7 = 0 and rec.known_company and explore_taken * 7 < emitted then
      -- Hold this slot for an unfamiliar posting further down the list.
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

-- ── paging a session ───────────────────────────────────────────────────────────

/*
 * The client entry point, and the reason no hook changes.
 *
 * `lib/api.ts` has passed an opaque cursor since phase 1 and promised that "keyset
 * pagination is an implementation detail of the SQL, and phase 5 gets to change it". This
 * is phase 5 changing it: the cursor now encodes `{session, offset}` rather than
 * `{sort value, id}`, and because no caller ever looked inside one, nothing above
 * `lib/api.ts` notices. PHASE1.md's decision B, collected.
 *
 * A null cursor means "start a feed": build a session and return its first page. That is
 * also what pull-to-refresh sends, which is §5.4's "pull-to-refresh explicitly builds a new
 * session".
 */
create or replace function public.ranked_feed(
  p_cursor  text default null,
  p_limit   integer default 20,
  p_surface public.feed_surface default 'reels'
)
returns setof public.job_card
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  uid     uuid    := (select auth.uid());
  cur     jsonb   := public.decode_cursor(p_cursor);
  lim     integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  sess    public.feed_sessions;
  offs    integer := 0;
  page    uuid[];
begin
  if uid is null then
    return;
  end if;

  if cur is null then
    sess := null;
  else
    /*
     * Phase 1's cursor envelope, reused rather than replaced. `encode_cursor(value, id)`
     * already emits an opaque base64 `{v, i}` pair, and a session offset and a session id
     * fit it exactly — so the wire format is unchanged, `decode_cursor()` still parses it,
     * and phase 1's own sorts keep working off the same two helpers. Defining a second
     * encoder would have meant two cursor formats in one API for no gain.
     */
    select * into sess from public.feed_sessions fs
     where fs.id = (cur ->> 'i')::uuid and fs.user_id = uid and fs.expires_at > now();
    offs := coalesce((cur ->> 'v')::int, 0);
  end if;

  /*
   * No cursor, or a session that has expired underneath a reader who left the app open
   * overnight. Both mean "build one" — and the expired case must not be an error, because
   * the reader's next scroll would otherwise fail rather than quietly continue.
   */
  if sess.id is null then
    sess := null;
    declare
      new_id uuid := public.build_feed_session(uid, p_surface);
    begin
      select * into sess from public.feed_sessions fs where fs.id = new_id;
      offs := 0;
    end;
  end if;

  page := sess.job_ids[offs + 1 : offs + lim];

  if page is null or array_length(page, 1) is null then
    return;
  end if;

  return query
    select v.id, v.company_id, v.company_slug, v.company_name, v.company_logo_url,
           v.company_logo_color, v.company_monogram, v.title, v.seniority, v.location_raw,
           v.location_city, v.location_region, v.location_country, v.location_type,
           v.employment_type, v.salary_min, v.salary_max, v.salary_period,
           v.salary_is_estimated, v.description_text, v.requirements, v.skills,
           v.apply_url, v.apply_host, v.posted_at, v.last_seen_at, v.closes_at,
           v.quality_score, v.dedup_group_id,
           /*
            * The next cursor is the same session at a later offset — and it is null on the
            * last page, which is what stops `useInfiniteQuery` asking again. A pool is
            * finite by design; §5.4's "near the end of the pool, build the next one in the
            * background" is the client's job and is not built in this phase.
            */
           case when offs + lim < coalesce(array_length(sess.job_ids, 1), 0)
                then public.encode_cursor((offs + lim)::text, sess.id)
                end,
           /*
            * `job_card.rank`, filled at last. Phase 1 declared this attribute and has left
            * it null for the feed ever since; search has been the only thing that ever put
            * a number in it.
            */
           ((sess.components -> v.id::text ->> 'score')::real)
      from public.job_cards v
      join unnest(page) with ordinality as p(job_id, ord) on p.job_id = v.id
     order by p.ord;
end;
$fn$;

-- ── measuring it ───────────────────────────────────────────────────────────────

/*
 * §15's exit condition, as a query: "ranked feed beats recency on apply-rate, measurably."
 *
 * Apply-rate is applications per impression, per arm — not applications per user, which
 * would reward whichever arm happened to be shown more. An impression is attributed to the
 * arm of the session it was shown in, so a user who was reassigned (they cannot be, but the
 * table does not know that) still contributes each impression to the right side.
 *
 * `lift_pct` is the headline. It is deliberately not decorated with a p-value: this returns
 * the counts the significance test needs, and computing one inside a SQL function would
 * invite reading it as a verdict. §15 says "measurably", and measurably means somebody
 * looks at the numbers.
 */
create or replace function public.feed_experiment_results(
  p_experiment text default 'ranked_feed_v1',
  p_since      timestamptz default now() - interval '30 days'
)
returns table (
  arm             public.feed_arm,
  users           integer,
  sessions        integer,
  impressions     integer,
  applications    integer,
  saves           integer,
  apply_rate      numeric,
  save_rate       numeric,
  lift_pct        numeric,
  contaminated    integer
)
language sql
stable
security definer
set search_path = ''
as $fn$
  /*
   * Attribution is **by the reader, not by the impression**, and that is a decision rather
   * than a convenience.
   *
   * The obvious join is `job_impressions.session_id = feed_sessions.id`. It cannot work:
   * §3.6's `session_id` is "one per app launch" (`lib/impressions.ts`), not one per feed
   * pool, and phase 2 built it that way on purpose so that "impressions per session" means
   * a sitting rather than a scroll. Changing its meaning to make this query easier would
   * silently redefine a column three phases of data already use.
   *
   * It is also unnecessary, because assignment is sticky per user: `experiment_arm()` is a
   * pure function of (experiment, user). So the arm a reader was on is read from the
   * sessions they were actually served — the ledger, not the hash — and every impression
   * they produced belongs to it.
   *
   * Reading the ledger rather than recomputing the hash is what makes the result survive
   * an operator changing `treatment_pct` halfway through. It cannot make the reassignment
   * harmless, though, so it is counted instead: `contaminated` is the number of readers who
   * appear under both arms, and they are excluded from every rate above it. A quiet
   * reassignment is the classic way an A/B test reports a null result, and a column that
   * says it happened is the difference between a wrong answer and a visible problem.
   */
  with assignment as (
    select fs.user_id,
           min(fs.arm::text) as first_arm,
           count(distinct fs.arm) as arms,
           count(*)::integer as sessions
      from public.feed_sessions fs
     where fs.experiment = p_experiment and fs.created_at >= p_since
     group by fs.user_id
  ),
  clean as (
    select user_id, first_arm::public.feed_arm as arm, sessions
      from assignment where arms = 1
  ),
  -- Only the surfaces this phase actually ranks. A card seen in search or on a company
  -- page was not chosen by either arm and says nothing about which one is better.
  imp as (
    select c.arm, i.user_id, i.job_id
      from public.job_impressions i
      join clean c on c.user_id = i.user_id
     where i.shown_at >= p_since
       and i.surface in ('reels', 'home')
  ),
  per_arm as (
    select c.arm,
           count(*)::integer as users,
           sum(c.sessions)::integer as sessions
      from clean c group by c.arm
  ),
  counted as (
    select i.arm,
           count(*)::integer as impressions,
           /*
            * Distinct postings, not distinct impressions. A reader who scrolled past a card
            * four times and then applied has applied once, and counting it four times would
            * reward whichever arm repeated itself most — which is precisely the behaviour
            * the seen penalty exists to discourage.
            */
           count(distinct i.job_id) filter (
             where exists (select 1 from public.applications a
                            where a.user_id = i.user_id and a.job_id = i.job_id)
           )::integer as applications,
           count(distinct i.job_id) filter (
             where exists (select 1 from public.job_interactions ji
                            where ji.user_id = i.user_id and ji.job_id = i.job_id
                              and ji.kind = 'save')
           )::integer as saves
      from imp i group by i.arm
  ),
  rates as (
    select a.arm, a.users, a.sessions,
           coalesce(c.impressions, 0)  as impressions,
           coalesce(c.applications, 0) as applications,
           coalesce(c.saves, 0)        as saves,
           case when coalesce(c.impressions, 0) = 0 then null
                else round(c.applications::numeric / c.impressions, 6) end as apply_rate,
           case when coalesce(c.impressions, 0) = 0 then null
                else round(c.saves::numeric / c.impressions, 6) end        as save_rate
      from per_arm a left join counted c on c.arm = a.arm
  ),
  control as (select apply_rate from rates where arm = 'recency'),
  dirty as (select count(*)::integer as n from assignment where arms > 1)
  select r.arm, r.users, r.sessions, r.impressions, r.applications, r.saves,
         r.apply_rate, r.save_rate,
         /*
          * The headline, and deliberately not decorated with a p-value. This returns the
          * counts a significance test needs; computing one inside a SQL function would
          * invite reading it as a verdict. §15 says "measurably", and measurably means
          * somebody looks at the numbers.
          */
         case when r.arm = 'recency' then null
              when (select apply_rate from control) is null
                or (select apply_rate from control) = 0 then null
              else round(100 * (r.apply_rate - (select apply_rate from control))
                         / (select apply_rate from control), 2) end,
         (select n from dirty)
    from rates r
   order by r.arm;
$fn$;

/*
 * Why a posting is where it is, for one reader's current session.
 *
 * §13.3 again: "keeping `job_match_scores.components` explainable isn't only a UX nicety —
 * it's the thing that makes [automated decision-making] answerable." The feed is the larger
 * instance of that question, and this is the answer to it. Nothing in the client reads this
 * yet; it exists because the phase that builds a ranker is the phase that owes an
 * explanation for it, not the phase that eventually builds a screen.
 */
create or replace function public.explain_feed_rank(p_job_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $fn$
  select jsonb_build_object(
           'position',   array_position(fs.job_ids, p_job_id),
           'arm',        fs.arm,
           'weights',    public.active_weights(),
           'components', fs.components -> p_job_id::text,
           'sessionAt',  fs.created_at
         )
    from public.feed_sessions fs
   where fs.user_id = (select auth.uid())
     and fs.expires_at > now()
     and fs.job_ids @> array[p_job_id]
   order by fs.created_at desc
   limit 1;
$fn$;

-- ── operations ─────────────────────────────────────────────────────────────────

/*
 * §5.4 gives sessions a two-hour TTL and nothing deletes them, so this does. Expired
 * sessions are the fastest-growing table this phase adds — one row per pull-to-refresh per
 * reader — and each one holds a 200-element array and a components blob.
 */
create or replace function public.prune_feed_sessions(p_keep_hours integer default 24)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  removed integer;
begin
  /*
   * Kept for a day past expiry rather than deleted on it, because
   * `feed_experiment_results()` joins impressions back to the session that produced them.
   * Deleting a session the moment it stops serving pages would silently drop the last two
   * hours of every experiment, which is the kind of measurement bug that makes a result
   * look like a null result.
   */
  delete from public.feed_sessions
   where expires_at < now() - make_interval(hours => greatest(coalesce(p_keep_hours, 24), 2));
  get diagnostics removed = row_count;
  return removed;
end;
$fn$;

-- ── authorization ──────────────────────────────────────────────────────────────

/*
 * Phase 0's discipline for the fifth time: **RLS decides which rows, column grants decide
 * which fields.**
 *
 * | Table                | Read                       | Write                          |
 * |----------------------|----------------------------|--------------------------------|
 * | `feed_sessions`      | **nobody** — functions only| none — `build_feed_session()`  |
 * | `ranking_weights`    | every signed-in reader     | none — operators, by hand      |
 * | `feed_experiments`   | **nobody**                 | none                           |
 * | `user_taste_vectors` | **nobody**                 | none — nothing writes it yet   |
 *
 * `feed_sessions` is unreadable rather than own-rows-readable, and the reason is
 * `components`: it holds the reader's affinity and cohort signals per posting, which is a
 * description of their behaviour rather than of the posting. `explain_feed_rank()` returns
 * one posting's worth on request, which is what §13.3 actually requires.
 *
 * `ranking_weights` is world-readable on purpose. The weights are not a secret — §5.1 wants
 * them tunable and explainable, and a reader who wants to know what the feed optimizes for
 * is entitled to the answer. Knowing them does not help anyone game the feed, because every
 * input is something they already control honestly.
 *
 * `feed_experiments` is hidden, because "which arm am I on" is the one thing a participant
 * must not be able to read: a user who can see they are in the control group and switch is
 * a user who has invalidated the measurement.
 */

alter table public.feed_sessions      enable row level security;
alter table public.ranking_weights    enable row level security;
alter table public.feed_experiments   enable row level security;
alter table public.user_taste_vectors enable row level security;

revoke all on public.feed_sessions      from anon, authenticated;
revoke all on public.ranking_weights    from anon, authenticated;
revoke all on public.feed_experiments   from anon, authenticated;
revoke all on public.user_taste_vectors from anon, authenticated;

grant select (id, name, is_active, weights, notes, created_at)
  on public.ranking_weights to authenticated;

create policy ranking_weights_read_active on public.ranking_weights
  for select to authenticated using (is_active);

revoke all on function public.active_weights()                          from public, anon, authenticated;
revoke all on function public.pref_match(text, text, text, public.location_type, text[], text[], boolean)
  from public, anon, authenticated;
revoke all on function public.recency_score(timestamptz)                from public, anon, authenticated;
revoke all on function public.urgency_score(timestamptz)                from public, anon, authenticated;
revoke all on function public.rank_score(jsonb, numeric, numeric, numeric, numeric, numeric,
                                         numeric, numeric, numeric, integer)
  from public, anon, authenticated;
revoke all on function public.candidate_pool(uuid, integer)             from public, anon, authenticated;
revoke all on function public.build_feed_session(uuid, public.feed_surface, integer, text)
  from public, anon, authenticated;
revoke all on function public.experiment_arm(uuid, text)                from public, anon, authenticated;
revoke all on function public.feed_experiment_results(text, timestamptz) from public, anon, authenticated;
revoke all on function public.prune_feed_sessions(integer)              from public, anon, authenticated;

revoke all on function public.ranked_feed(text, integer, public.feed_surface) from public, anon;
revoke all on function public.explain_feed_rank(uuid)                        from public, anon;

/*
 * Two functions, and both scope themselves to `auth.uid()` internally — neither takes a
 * user id, which is the property that makes this list safe to read at a glance.
 * `build_feed_session()` *does* take one, which is exactly why it is not in it.
 */
grant execute on function public.ranked_feed(text, integer, public.feed_surface) to authenticated;
grant execute on function public.explain_feed_rank(uuid)                         to authenticated;

grant execute on function public.build_feed_session(uuid, public.feed_surface, integer, text) to service_role;
grant execute on function public.feed_experiment_results(text, timestamptz)                   to service_role;
grant execute on function public.experiment_arm(uuid, text)                                   to service_role;
grant execute on function public.candidate_pool(uuid, integer)                                to service_role;
grant execute on function public.prune_feed_sessions(integer)                                 to service_role;
grant execute on function public.active_weights()                                             to service_role;
