-- Phase 1 — Jobs and ingestion.
--
-- Implements docs/PHASE1.md, which is the design, against docs/README.md §3.3 (companies),
-- §3.4 (jobs, raw and canonical) and §4 (the ingestion pipeline). Interactions,
-- applications, impressions, comments and resumes belong to later phases and are
-- deliberately absent.
--
-- Two documented deviations from README §3.4, both argued in PHASE1.md §2.6 and §2.9:
--   * no `embedding vector(1536)` column or HNSW index — phase 4 adds both; near-miss
--     dedup uses pg_trgm here instead, which is a better signal on short job titles.
--   * a `crawl_runs` table that §3 does not list — §4.3's "disable after N failures" and
--     §14's observability both need a record of what each run did.

create extension if not exists pg_trgm with schema extensions;
-- For digest(). The built-in sha256() takes bytea and the only text→bytea route is
-- convert_to(), which is STABLE rather than IMMUTABLE because it reads the server
-- encoding — so it cannot appear in the generated dedup_key below. pgcrypto's
-- digest(text, text) is immutable and computes the same hash.
create extension if not exists pgcrypto with schema extensions;

-- ── enums ──────────────────────────────────────────────────────────────────────

create type public.ats_kind as enum
  ('greenhouse', 'lever', 'ashby', 'workday', 'smartrecruiters', 'company_site', 'feed');

create type public.location_type as enum ('Onsite', 'Hybrid', 'Remote');
create type public.salary_period as enum ('hour', 'year');
create type public.job_status    as enum ('open', 'closed', 'expired', 'removed', 'suppressed');

/*
 * §4.4: "extract intern / new grad / senior from the title. This is the single
 * highest-leverage field for your audience."
 *
 * `staff_plus` is not in §3.4's list of four. It is here because the point of the field
 * is filtering *out*, and folding a VP of Engineering into `senior` throws away the
 * strongest signal the title carries. Note that the value is never used to suppress a
 * posting at write time — a student who searches for "staff engineer" should find one.
 */
create type public.seniority_level as enum ('intern', 'new_grad', 'mid', 'senior', 'staff_plus');

-- public.employment_type already exists: phase 0 created it for user_preferences.

-- ── companies ──────────────────────────────────────────────────────────────────

create table public.companies (
  id                uuid primary key default gen_random_uuid(),
  -- 'nvidia' — the current mock ids, so every existing /company/[id] deep link resolves.
  slug              extensions.citext unique not null,
  name              text not null,
  legal_name        text,
  -- §3.3: THE cross-crawler dedup key. Two crawlers both find NVIDIA, one via
  -- boards.greenhouse.io/nvidia and one via a career site; the registrable domain is the
  -- only identifier that collapses them. Name matching does not: Meta / Meta Platforms /
  -- Facebook are the same employer and three different strings.
  domain            extensions.citext unique,
  logo_url          text,
  logo_monogram     text,                      -- 'NV' — the CompanyLogo fallback
  logo_color        text,
  industry          text,
  hq_location       text,
  employee_range    text,
  description       text,
  follower_count    integer not null default 0,   -- denormalized; phase 2 maintains it
  -- Not in §3.3. Added because the company card and suggested_companies() both want it,
  -- and it is the difference between listing 12 companies in 1 query and in 13.
  -- Maintained by refresh_open_job_counts() at the end of an ingest run, not by a
  -- per-row trigger: a 10k-posting crawl would otherwise serialize on one row per board.
  open_job_count    integer not null default 0,
  is_active         boolean not null default true,
  -- §3.3: a deliberate stub. One nullable column now is the difference between employer
  -- accounts being a feature and being a migration.
  claimed_by_org_id uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint companies_logo_color_check
    check (logo_color is null or logo_color ~ '^#[0-9A-Fa-f]{6}$')
);

-- Company search has to tolerate "nvida" and "goolge" — PHASE1.md §6.
create index companies_name_trgm_idx on public.companies
  using gin (name extensions.gin_trgm_ops);
create index companies_active_idx on public.companies (open_job_count desc) where is_active;

create trigger companies_set_updated_at
  before update on public.companies
  for each row execute function public.set_updated_at();

-- ── job_sources ────────────────────────────────────────────────────────────────

create table public.job_sources (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid references public.companies (id) on delete cascade,
  kind                 public.ats_kind not null,
  board_url            text not null,
  board_token          text,                   -- the Greenhouse board slug, Lever handle, …
  crawl_interval       interval not null default '6 hours',
  -- Also the takedown kill-switch §4.3 requires. Flipping this to false plus a line in
  -- `notes` is the entire response to "please stop crawling us", and the pair is the
  -- record that we did.
  enabled              boolean not null default true,
  last_crawled_at      timestamptz,
  last_success_at      timestamptz,
  consecutive_failures smallint not null default 0,
  etag                 text,
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (kind, board_url)
);

create index job_sources_due_idx on public.job_sources (last_crawled_at nulls first)
  where enabled;

create trigger job_sources_set_updated_at
  before update on public.job_sources
  for each row execute function public.set_updated_at();

-- ── crawl_runs ─────────────────────────────────────────────────────────────────

create table public.crawl_runs (
  id            uuid primary key default gen_random_uuid(),
  source_id     uuid references public.job_sources (id) on delete cascade,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  status        text not null default 'running'
                  check (status in ('running', 'success', 'failed', 'skipped', 'not_modified')),
  http_status   smallint,
  postings_seen integer not null default 0,
  -- The ratio raw_inserted / postings_seen is the cheapest health metric in the system.
  -- It should sit near zero on a steady board. When it jumps to 1.0 overnight the ATS
  -- started stamping a volatile field and canonical_payload() needs to strip it.
  raw_inserted  integer not null default 0,
  jobs_created  integer not null default 0,
  jobs_updated  integer not null default 0,
  jobs_closed   integer not null default 0,
  -- Two different things, deliberately counted apart. `duplicates` is the number §3.4
  -- cares about: the same job reached by two different sources, which is the risk that
  -- comes with crawling overlapping boards. `collapsed` is an employer posting one role
  -- under several requisition ids, which is their behaviour rather than our defect and
  -- which the dedup key is supposed to absorb silently.
  duplicates    integer not null default 0,
  collapsed     integer not null default 0,
  error         text
);

create index crawl_runs_source_idx on public.crawl_runs (source_id, started_at desc);

-- ── raw_postings ───────────────────────────────────────────────────────────────

/*
 * Immutable. Never updated, only inserted — §3.4.
 *
 * This is the audit trail and the reprocessing input. When the normalizer has a bug (it
 * will), the fix replays from here rather than re-crawling 300k postings and annoying
 * every ATS we touch.
 *
 * `unique (source_id, external_id, content_hash)` is the whole re-crawl strategy: an
 * unchanged posting conflicts on insert and no downstream work fires. That only holds if
 * `content_hash` is computed over a canonicalized payload with volatile fields stripped —
 * see canonicalPayload() in server/src/ingest/pipeline.ts.
 */
create table public.raw_postings (
  id            bigint generated always as identity primary key,
  source_id     uuid not null references public.job_sources (id) on delete cascade,
  run_id        uuid references public.crawl_runs (id) on delete set null,
  external_id   text not null,
  content_hash  text not null,
  payload       jsonb not null,
  fetched_at    timestamptz not null default now(),
  processed_at  timestamptz,
  process_error text,
  unique (source_id, external_id, content_hash)
);

create index raw_postings_unprocessed_idx on public.raw_postings (processed_at)
  where processed_at is null;

-- ── skills ─────────────────────────────────────────────────────────────────────

/*
 * §4.4: "dictionary-based extraction against a curated skills table, not free-form LLM
 * output. Free-form gives you React, ReactJS, React.js and react as four skills and your
 * filters quietly stop working."
 *
 * A lookup table rather than an enum because the set grows — §3's convention.
 * `jobs.skills` stores `label`, never the raw string from the posting, so the dictionary
 * is the only thing that decides what a skill is called.
 */
create table public.skills (
  id         uuid primary key default gen_random_uuid(),
  slug       extensions.citext unique not null,   -- 'react'
  label      text not null,                       -- 'React'
  aliases    extensions.citext[] not null default '{}',
  category   text,
  created_at timestamptz not null default now()
);

create index skills_aliases_idx on public.skills using gin (aliases);

/*
 * array_to_string() is STABLE, not IMMUTABLE — it calls each element's output function
 * and the planner cannot know those are immutable in general. That makes §3.4's
 * `search_vector` expression illegal in a generated column exactly as written.
 *
 * For text[] the concern does not apply: text's output function is the identity. This
 * wrapper asserts that, and is the only reason it exists.
 */
create or replace function public.text_array_to_string(p_values text[], p_sep text)
returns text
language sql
immutable
parallel safe
as $$
  select array_to_string(p_values, p_sep);
$$;

/*
 * The dedup key: sha256(company_id || title_normalized || city-or-star || seniority).
 *
 * A named function rather than an inline expression because two places need it — the
 * generated column below, and the lookup in ingest_upsert_job() that has to find the row
 * that column produced. Written twice, they drift, and the day they do the partial unique
 * index stops firing and every posting arrives twice.
 *
 * **Seniority is a deviation from §3.4**, which keys on company + title + city alone.
 * The first full crawl is what argued for it: Anduril's board lost 523 of 2,356 real
 * requisitions, because "2026 Early Career Manufacturing Engineer", "Senior Manufacturing
 * Engineer" and "Winter 2027 Manufacturing Engineer Co-op" all normalize to
 * "manufacturing engineer" in the same city. Those are three different jobs, and §5.1
 * names exactly this failure: "too aggressive and two genuinely different roles collapse".
 *
 * Seniority is stripped out of `title_normalized` on purpose — it belongs in its own
 * column — so putting it back into the key is not redundancy, it is restoring the
 * distinction the normalizer deliberately moved.
 */
create or replace function public.job_dedup_key(
  p_company_id       uuid,
  p_title_normalized text,
  p_location_city    text,
  p_seniority        public.seniority_level
)
returns text
language sql
immutable
parallel safe
as $$
  select encode(
    extensions.digest(
      p_company_id::text || '|' || p_title_normalized || '|' ||
        coalesce(p_location_city, '*') || '|' || coalesce(p_seniority::text, '*'),
      'sha256'),
    'hex');
$$;

-- ── jobs ───────────────────────────────────────────────────────────────────────

create table public.jobs (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies (id) on delete cascade,
  source_id           uuid references public.job_sources (id) on delete set null,
  run_id              uuid references public.crawl_runs (id) on delete set null,
  external_id         text,

  title               text not null,
  -- Lowercased, punctuation-stripped, seniority-stripped, requisition noise removed.
  -- Feeds both dedup and search; getting it wrong in either direction is the whole game.
  title_normalized    text not null,
  seniority           public.seniority_level,

  -- Denormalized from companies purely so `sort=company` has something indexable to sort
  -- on. Ordering a 300k-row feed by a column on the other side of a join is a full sort.
  -- Kept honest by companies_propagate_name below.
  company_name        text not null,

  location_raw        text,
  location_city       text,
  location_region     text,
  location_country    char(2),
  location_type       public.location_type not null,
  employment_type     public.employment_type not null,

  salary_min          numeric(12,2),
  salary_max          numeric(12,2),
  salary_period       public.salary_period,
  salary_currency     char(3) not null default 'USD',
  -- Always false in phase 1: nothing infers a salary. README §16 question 5 is open, and
  -- shipping an inference before it is answered is how a guess ends up reading as a
  -- disclosure. Several US states require *posted* ranges; that line does not get blurred.
  salary_is_estimated boolean not null default false,

  description_text    text not null,
  description_html    text,
  requirements        text[] not null default '{}',
  skills              text[] not null default '{}',   -- §3.4: denormalized for the card

  apply_url           text not null,
  apply_host          text,                   -- 'greenhouse' — feeds ApplicationSource

  /*
   * NOT NULL, where §3.4 leaves it nullable. This is the recency sort's keyset key, and
   * a row comparison against NULL yields NULL — a posting with no date would be dropped
   * from every page after the first rather than merely sorting oddly. The pipeline falls
   * back to the first time we saw it, which is the honest answer to "when was this
   * posted" for an ATS that does not say.
   */
  posted_at           timestamptz not null default now(),
  first_seen_at       timestamptz not null default now(),
  -- The only closure signal a crawler gets, and what lets a card say "verified 2h ago".
  last_seen_at        timestamptz not null default now(),
  closes_at           timestamptz,
  status              public.job_status not null default 'open',

  -- §4.4's multi-location fan-out. "SF / NYC / Remote" becomes three rows so the location
  -- filter does not lie; they share a group id so the UI can say "also in 2 other
  -- locations" and so a later merge has something to merge on.
  dedup_group_id      uuid not null default gen_random_uuid(),

  -- §3.4's junk filter, set once at ingest rather than evaluated on every feed read.
  quality_score       real not null default 0.5 check (quality_score between 0 and 1),

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  /*
   * §3.4's dedup key, computed by the database rather than by the writer.
   *
   * The pipeline could compute this — it computes everything else — but then two writers
   * that disagree about the formula produce two rows for one posting and the partial
   * unique index below never fires. A generated column makes disagreement impossible.
   */
  dedup_key text generated always as (
    public.job_dedup_key(company_id, title_normalized, location_city, seniority)
  ) stored,

  /*
   * One comparable number for pay, so `sort=salary` can use an index.
   *
   * Hourly is annualized at 2080 h/yr — exactly payFloor() in hooks/useJobFeeds.ts — so
   * an internship at $60/hr sorts against a new-grad salary instead of below every one
   * of them. Postings with no stated pay are null and sort last rather than reading as $0.
   */
  salary_annual_max numeric(14,2) generated always as (
    case
      when coalesce(salary_max, salary_min) is null then null
      when salary_period = 'hour' then coalesce(salary_max, salary_min) * 2080
      else coalesce(salary_max, salary_min)
    end
  ) stored,

  -- §3.4 verbatim. Company name is deliberately absent: a generated column cannot reach
  -- across a join, and PHASE1.md §6 handles company matching with a separate trigram
  -- search, which is also what makes SearchScopeTabs work.
  search_vector tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(public.text_array_to_string(skills, ' '), '')), 'B') ||
    setweight(to_tsvector('english', coalesce(description_text, '')), 'D')
  ) stored,

  constraint jobs_salary_order_check
    check (salary_min is null or salary_max is null or salary_min <= salary_max),
  constraint jobs_salary_period_check
    check ((salary_min is null and salary_max is null) or salary_period is not null)
);

create index jobs_search_idx on public.jobs using gin (search_vector);
create index jobs_skills_idx on public.jobs using gin (skills);
create index jobs_title_trgm_idx on public.jobs using gin (title_normalized extensions.gin_trgm_ops);

-- The three feed sorts, each as a keyset-friendly composite ending in the tiebreak key.
create index jobs_feed_recent_idx  on public.jobs (posted_at desc, id desc) where status = 'open';
create index jobs_feed_salary_idx  on public.jobs (salary_annual_max desc nulls last, id desc) where status = 'open';
create index jobs_feed_company_idx on public.jobs (company_name asc, id asc) where status = 'open';

create index jobs_company_posted_idx on public.jobs (company_id, posted_at desc) where status = 'open';
create index jobs_stale_idx on public.jobs (last_seen_at) where status = 'open';
create index jobs_source_idx on public.jobs (source_id);
create index jobs_dedup_group_idx on public.jobs (dedup_group_id);

-- §3.4: only one *open* posting per key. Closed history is allowed to hold duplicates,
-- because it is history.
create unique index jobs_dedup_key_open_idx on public.jobs (dedup_key) where status = 'open';

create trigger jobs_set_updated_at
  before update on public.jobs
  for each row execute function public.set_updated_at();

-- ── job_dedup_review ───────────────────────────────────────────────────────────

/*
 * §3.4: "Don't auto-merge on fuzzy signals; a wrong merge silently deletes a real job and
 * nobody notices."
 *
 * A near-miss lands here AND the job is created. A wrong non-merge shows a duplicate,
 * which someone notices and which this queue exists to fix. A wrong merge shows nothing.
 * Nothing in phase 1 has a UI for this; the rows are the point.
 */
create table public.job_dedup_review (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid not null references public.jobs (id) on delete cascade,
  other_job_id uuid not null references public.jobs (id) on delete cascade,
  similarity  real not null,
  signal      text not null,                 -- 'title_trigram'
  resolution  text not null default 'pending'
                check (resolution in ('pending', 'merged', 'distinct')),
  resolved_at timestamptz,
  created_at  timestamptz not null default now(),
  unique (job_id, other_job_id)
);

create index job_dedup_review_pending_idx on public.job_dedup_review (created_at desc)
  where resolution = 'pending';

-- ── keeping the denormalized name honest ───────────────────────────────────────

create or replace function public.propagate_company_name()
returns trigger
language plpgsql
as $$
begin
  update public.jobs set company_name = new.name where company_id = new.id;
  return new;
end;
$$;

-- Fires only on an actual rename, which is rare. The alternative — joining companies on
-- every feed page just to sort alphabetically — is not.
create trigger companies_propagate_name
  after update of name on public.companies
  for each row when (old.name is distinct from new.name)
  execute function public.propagate_company_name();

-- ── operational functions (service role only) ──────────────────────────────────

/*
 * Recount open postings per company. Called at the end of an ingest run and after the
 * staleness sweep rather than from a per-row trigger: a 10k-posting crawl through a
 * trigger would update one company row 10k times and serialize the whole board behind a
 * single lock.
 */
create or replace function public.refresh_open_job_counts()
returns integer
language plpgsql
as $$
declare
  changed integer;
begin
  with counts as (
    select c.id, count(j.id) filter (where j.status = 'open') as open_count
      from public.companies c
      left join public.jobs j on j.company_id = c.id
     group by c.id
  )
  update public.companies c
     set open_job_count = counts.open_count
    from counts
   where c.id = counts.id
     and c.open_job_count is distinct from counts.open_count;

  get diagnostics changed = row_count;
  return changed;
end;
$$;

/*
 * §3.4's staleness sweep. A crawler that stops seeing a posting is the only closure
 * signal there is.
 *
 * The guard is the important part: only jobs whose source *succeeded* recently and has no
 * consecutive failures are eligible. Without it, one broken crawler closes an employer's
 * entire board overnight and the user-visible symptom is a company vanishing from the app.
 *
 * Jobs with no source at all (the seeded fixtures) are never swept — nothing is crawling
 * them, so their absence from a crawl means nothing.
 */
create or replace function public.close_stale_jobs(p_unseen_hours integer default 48)
returns integer
language plpgsql
as $$
declare
  closed integer;
begin
  with swept as (
    update public.jobs j
       set status = 'closed'
      from public.job_sources s
     where j.source_id = s.id
       and j.status = 'open'
       and s.consecutive_failures = 0
       and s.last_success_at > now() - interval '24 hours'
       and j.last_seen_at < now() - make_interval(hours => p_unseen_hours)
    returning 1
  )
  select count(*) into closed from swept;

  -- Separate and unguarded: the employer told us when it closes, so no crawl evidence
  -- is needed.
  update public.jobs
     set status = 'expired'
   where status = 'open'
     and closes_at is not null
     and closes_at < now();

  return closed;
end;
$$;

-- ── read API (PHASE1.md §7) ────────────────────────────────────────────────────

/*
 * One row shape for every job the client reads — feed, company openings and search all
 * return this, so lib/api.ts has exactly one row→domain mapper.
 *
 * `page_cursor` is the opaque continuation token *for the row it sits on*: the client
 * takes the last row's cursor and passes it back. Encoding stays entirely in SQL, so the
 * client never learns what a cursor is made of and phase 5 can change it freely.
 *
 * `rank` is null outside search.
 */
create type public.job_card as (
  id                  uuid,
  company_id          uuid,
  company_slug        extensions.citext,
  company_name        text,
  company_logo_url    text,
  company_logo_color  text,
  company_monogram    text,
  title               text,
  seniority           public.seniority_level,
  location_raw        text,
  location_city       text,
  location_region     text,
  location_country    char(2),
  location_type       public.location_type,
  employment_type     public.employment_type,
  salary_min          numeric(12,2),
  salary_max          numeric(12,2),
  salary_period       public.salary_period,
  salary_is_estimated boolean,
  description_text    text,
  requirements        text[],
  skills              text[],
  apply_url           text,
  apply_host          text,
  posted_at           timestamptz,
  last_seen_at        timestamptz,
  closes_at           timestamptz,
  quality_score       real,
  dedup_group_id      uuid,
  page_cursor         text,
  rank                real
);

create type public.company_card as (
  id             uuid,
  slug           extensions.citext,
  name           text,
  domain         extensions.citext,
  logo_url       text,
  logo_monogram  text,
  logo_color     text,
  industry       text,
  hq_location    text,
  description    text,
  follower_count integer,
  open_job_count integer,
  rank           real
);

/*
 * The job half of job_card, joined to its company.
 *
 * security_invoker so the reader's RLS applies. Without it a view is evaluated as its
 * owner and silently becomes a hole straight through every policy underneath it.
 *
 * Column order matters: the functions below select `v.*` and append page_cursor and rank,
 * which only lines up with job_card because this list is in the same order.
 */
create view public.job_cards with (security_invoker = true) as
  select
    j.id,
    j.company_id,
    c.slug            as company_slug,
    j.company_name,
    c.logo_url        as company_logo_url,
    c.logo_color      as company_logo_color,
    c.logo_monogram   as company_monogram,
    j.title,
    j.seniority,
    j.location_raw,
    j.location_city,
    j.location_region,
    j.location_country,
    j.location_type,
    j.employment_type,
    j.salary_min,
    j.salary_max,
    j.salary_period,
    j.salary_is_estimated,
    j.description_text,
    j.requirements,
    j.skills,
    j.apply_url,
    j.apply_host,
    j.posted_at,
    j.last_seen_at,
    j.closes_at,
    j.quality_score,
    j.dedup_group_id,
    -- not part of job_card; the functions filter and sort on these and never select them
    j.status,
    j.salary_annual_max,
    j.title_normalized,
    j.search_vector
  from public.jobs j
  join public.companies c on c.id = j.company_id;

create or replace function public.encode_cursor(p_value text, p_id uuid)
returns text
language sql
immutable
as $$
  select encode(convert_to(jsonb_build_object('v', p_value, 'i', p_id)::text, 'UTF8'), 'base64');
$$;

/* Returns null for anything that is not a cursor we issued, so a mangled token pages
 * from the start instead of raising. */
create or replace function public.decode_cursor(p_cursor text)
returns jsonb
language plpgsql
immutable
as $$
begin
  if p_cursor is null or btrim(p_cursor) = '' then
    return null;
  end if;
  return convert_from(decode(p_cursor, 'base64'), 'UTF8')::jsonb;
exception when others then
  return null;
end;
$$;

/*
 * The feed — PHASE1.md §7. Serves Home, Reels, Following and a company's openings,
 * because those differ only in filter and sort.
 *
 * Phase 1 ranking is recency. §5.1's scorer replaces the body of this function (or, when
 * it needs Redis and feed_sessions, the whole function with a service call behind
 * lib/api.ts) without the client noticing.
 *
 * Keyset pagination, never offset: this table gains thousands of rows a night, and offset
 * paging over it shows the reader the same job twice and skips another.
 *
 * Three explicit branches rather than one query with a CASE in its ORDER BY — a CASE
 * defeats every one of the partial indexes above and turns each page into a full sort.
 */
create or replace function public.feed_jobs(
  p_sort          text default 'recent',
  p_company_slugs text[] default null,
  p_cursor        text default null,
  p_limit         integer default 20,
  p_min_quality   real default 0.3
)
returns setof public.job_card
language plpgsql
stable
as $$
declare
  cur        jsonb   := public.decode_cursor(p_cursor);
  cur_id     uuid    := (cur ->> 'i')::uuid;
  cur_value  text    := cur ->> 'v';
  lim        integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  -- An empty array would filter everything out; "no filter" and "follows nobody" are
  -- different questions and only the caller knows which it is asking.
  slugs      extensions.citext[] :=
    case when p_company_slugs is null or cardinality(p_company_slugs) = 0
         then null
         else p_company_slugs::extensions.citext[] end;
begin
  if p_sort = 'salary' then
    return query
      select v.id, v.company_id, v.company_slug, v.company_name, v.company_logo_url,
             v.company_logo_color, v.company_monogram, v.title, v.seniority, v.location_raw,
             v.location_city, v.location_region, v.location_country, v.location_type,
             v.employment_type, v.salary_min, v.salary_max, v.salary_period,
             v.salary_is_estimated, v.description_text, v.requirements, v.skills,
             v.apply_url, v.apply_host, v.posted_at, v.last_seen_at, v.closes_at,
             v.quality_score, v.dedup_group_id,
             public.encode_cursor(v.salary_annual_max::text, v.id),
             null::real
        from public.job_cards v
       where v.status = 'open'
         and v.quality_score >= p_min_quality
         and (slugs is null or v.company_slug = any (slugs))
         -- NULLS LAST means "no cursor value" is the tail, so the comparison has to be
         -- spelled out rather than left to a row constructor.
         and (cur is null
              or (cur_value is null and v.salary_annual_max is null and v.id < cur_id)
              or (cur_value is not null
                  and (v.salary_annual_max is null
                       or v.salary_annual_max < cur_value::numeric
                       or (v.salary_annual_max = cur_value::numeric and v.id < cur_id))))
       order by v.salary_annual_max desc nulls last, v.id desc
       limit lim;

  elsif p_sort = 'company' then
    return query
      select v.id, v.company_id, v.company_slug, v.company_name, v.company_logo_url,
             v.company_logo_color, v.company_monogram, v.title, v.seniority, v.location_raw,
             v.location_city, v.location_region, v.location_country, v.location_type,
             v.employment_type, v.salary_min, v.salary_max, v.salary_period,
             v.salary_is_estimated, v.description_text, v.requirements, v.skills,
             v.apply_url, v.apply_host, v.posted_at, v.last_seen_at, v.closes_at,
             v.quality_score, v.dedup_group_id,
             public.encode_cursor(v.company_name, v.id),
             null::real
        from public.job_cards v
       where v.status = 'open'
         and v.quality_score >= p_min_quality
         and (slugs is null or v.company_slug = any (slugs))
         -- Both keys ascend so a single row comparison resumes the page. A mixed
         -- direction would need the comparison spelled out term by term, for no gain.
         and (cur is null or (v.company_name, v.id) > (cur_value, cur_id))
       order by v.company_name asc, v.id asc
       limit lim;

  else
    return query
      select v.id, v.company_id, v.company_slug, v.company_name, v.company_logo_url,
             v.company_logo_color, v.company_monogram, v.title, v.seniority, v.location_raw,
             v.location_city, v.location_region, v.location_country, v.location_type,
             v.employment_type, v.salary_min, v.salary_max, v.salary_period,
             v.salary_is_estimated, v.description_text, v.requirements, v.skills,
             v.apply_url, v.apply_host, v.posted_at, v.last_seen_at, v.closes_at,
             v.quality_score, v.dedup_group_id,
             public.encode_cursor(v.posted_at::text, v.id),
             null::real
        from public.job_cards v
       where v.status = 'open'
         and v.quality_score >= p_min_quality
         and (slugs is null or v.company_slug = any (slugs))
         and (cur is null or (v.posted_at, v.id) < (cur_value::timestamptz, cur_id))
       order by v.posted_at desc, v.id desc
       limit lim;
  end if;
end;
$$;

/*
 * Job search — PHASE1.md §6.
 *
 * websearch_to_tsquery over the generated search_vector, ranked by relevance, recency and
 * quality together. A pure ts_rank ordering puts a two-year-old posting that happens to
 * repeat the query word above this morning's exact-title match.
 *
 * Short queries take the prefix path instead: a 2–3 character tsquery matches almost
 * nothing useful, and useSearch.ts's current behaviour — a prefix match on the title beats
 * a match buried in a skills list — is the behaviour worth preserving.
 */
create or replace function public.search_jobs(
  p_query       text,
  p_limit       integer default 20,
  p_cursor      text default null,
  p_min_quality real default 0.3
)
returns setof public.job_card
language plpgsql
stable
as $$
declare
  q       text    := btrim(coalesce(p_query, ''));
  lim     integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  offs    integer := coalesce((public.decode_cursor(p_cursor) ->> 'v')::integer, 0);
  ts      tsquery;
begin
  -- MIN_QUERY_LENGTH in hooks/useSearch.ts. Enforced on both sides.
  if length(q) < 2 then
    return;
  end if;

  if length(q) <= 3 then
    return query
      select v.id, v.company_id, v.company_slug, v.company_name, v.company_logo_url,
             v.company_logo_color, v.company_monogram, v.title, v.seniority, v.location_raw,
             v.location_city, v.location_region, v.location_country, v.location_type,
             v.employment_type, v.salary_min, v.salary_max, v.salary_period,
             v.salary_is_estimated, v.description_text, v.requirements, v.skills,
             v.apply_url, v.apply_host, v.posted_at, v.last_seen_at, v.closes_at,
             v.quality_score, v.dedup_group_id,
             -- Offset, not keyset: search results are a ranked list the reader consumes
             -- in a few pages, not an endless feed, and a rank is not a stable key.
             public.encode_cursor((offs + lim)::text, v.id),
             1.0::real
        from public.job_cards v
       where v.status = 'open'
         and v.quality_score >= p_min_quality
         and v.title_normalized like lower(q) || '%'
       order by v.posted_at desc, v.id desc
       offset offs
       limit lim;
    return;
  end if;

  -- websearch_to_tsquery never raises on user input, unlike to_tsquery. That matters when
  -- the input is whatever someone typed into a search bar.
  ts := websearch_to_tsquery('english', q);

  return query
    select v.id, v.company_id, v.company_slug, v.company_name, v.company_logo_url,
           v.company_logo_color, v.company_monogram, v.title, v.seniority, v.location_raw,
           v.location_city, v.location_region, v.location_country, v.location_type,
           v.employment_type, v.salary_min, v.salary_max, v.salary_period,
           v.salary_is_estimated, v.description_text, v.requirements, v.skills,
           v.apply_url, v.apply_host, v.posted_at, v.last_seen_at, v.closes_at,
           v.quality_score, v.dedup_group_id,
           public.encode_cursor((offs + lim)::text, v.id),
           (0.60 * ts_rank_cd(v.search_vector, ts)
            + 0.20 * exp(-extract(epoch from (now() - coalesce(v.posted_at, now()))) / 1209600.0)
            + 0.20 * v.quality_score)::real
      from public.job_cards v
     where v.status = 'open'
       and v.quality_score >= p_min_quality
       and v.search_vector @@ ts
     order by 31 desc, v.posted_at desc, v.id desc
     offset offs
     limit lim;
end;
$$;

/*
 * Company search. Trigram similarity so "nvida" still finds NVIDIA, with an exact-prefix
 * boost so typing the real name does not lose to a fuzzy neighbour.
 *
 * A company with no open roles is still a valid result — the reader may want to follow
 * them — but it sorts last, because it is not the answer to a job search.
 */
create or replace function public.search_companies(
  p_query text,
  p_limit integer default 10
)
returns setof public.company_card
language plpgsql
stable
as $$
declare
  q   text    := btrim(coalesce(p_query, ''));
  lim integer := least(greatest(coalesce(p_limit, 10), 1), 50);
begin
  if length(q) < 2 then
    return;
  end if;

  return query
    select c.id, c.slug, c.name, c.domain, c.logo_url, c.logo_monogram, c.logo_color,
           c.industry, c.hq_location, c.description, c.follower_count, c.open_job_count,
           (extensions.similarity(c.name, q)
            + case when c.name ilike q || '%' then 0.5 else 0 end)::real
      from public.companies c
     where c.is_active
       and (c.name ilike q || '%' or extensions.similarity(c.name, q) > 0.2)
     order by 13 desc, (c.open_job_count > 0) desc, c.open_job_count desc, c.name
     limit lim;
end;
$$;

/*
 * Replaces the hardcoded `suggestedCompanyIds` array in data/mockCompanies.ts.
 *
 * Phase 1 ranks on what it has: companies actually hiring right now, with followers as
 * the tiebreak. Phase 5's affinity signal (§5.1) is what makes this personal; until then
 * "who has the most open roles" is an honest answer and a much better one than a constant.
 */
create or replace function public.suggested_companies(p_limit integer default 12)
returns setof public.company_card
language sql
stable
as $$
  select c.id, c.slug, c.name, c.domain, c.logo_url, c.logo_monogram, c.logo_color,
         c.industry, c.hq_location, c.description, c.follower_count, c.open_job_count,
         null::real
    from public.companies c
   where c.is_active
     and c.open_job_count > 0
   order by c.open_job_count desc, c.follower_count desc, c.name
   limit least(greatest(coalesce(p_limit, 12), 1), 50);
$$;

-- ── authorization ──────────────────────────────────────────────────────────────

/*
 * Jobs, companies and skills are public content. Everything else in this migration is
 * operational and gets no grant at all — a SELECT on raw_postings is a SELECT on every
 * payload we have ever fetched, and crawl_runs leaks which boards we watch and how often.
 *
 * As in phase 0, Supabase's default privileges grant everything on new public tables to
 * anon and authenticated, so each table is revoked first and granted back narrowly.
 * service_role is left alone: the ingestion pipeline runs as it.
 */

alter table public.companies        enable row level security;
alter table public.jobs             enable row level security;
alter table public.skills           enable row level security;
alter table public.job_sources      enable row level security;
alter table public.raw_postings     enable row level security;
alter table public.crawl_runs       enable row level security;
alter table public.job_dedup_review enable row level security;

revoke all on public.companies        from anon, authenticated;
revoke all on public.jobs             from anon, authenticated;
revoke all on public.skills           from anon, authenticated;
revoke all on public.job_sources      from anon, authenticated;
revoke all on public.raw_postings     from anon, authenticated;
revoke all on public.crawl_runs       from anon, authenticated;
revoke all on public.job_dedup_review from anon, authenticated;
revoke all on public.job_cards        from anon, authenticated;

grant select on public.companies to anon, authenticated;
grant select on public.jobs      to anon, authenticated;
grant select on public.skills    to anon, authenticated;
grant select on public.job_cards to anon, authenticated;

create policy companies_read_active on public.companies
  for select to anon, authenticated
  using (is_active);

-- A closed posting is invisible to a reader rather than rendering as a dead apply
-- button. The pipeline reads through service_role and so still sees its own history.
create policy jobs_read_open on public.jobs
  for select to anon, authenticated
  using (status = 'open');

create policy skills_read_all on public.skills
  for select to anon, authenticated
  using (true);

-- No insert/update/delete grant to anon or authenticated on any table here. There is no
-- policy to write either, so even a future accidental grant lands on deny-by-default.

revoke all on function public.refresh_open_job_counts() from anon, authenticated;
revoke all on function public.close_stale_jobs(integer)  from anon, authenticated;

grant execute on function public.feed_jobs(text, text[], text, integer, real) to anon, authenticated;
grant execute on function public.search_jobs(text, integer, text, real)       to anon, authenticated;
grant execute on function public.search_companies(text, integer)              to anon, authenticated;
grant execute on function public.suggested_companies(integer)                 to anon, authenticated;
grant execute on function public.encode_cursor(text, uuid)                    to anon, authenticated;
grant execute on function public.decode_cursor(text)                          to anon, authenticated;

-- ── ingest write path (service role only) ──────────────────────────────────────

/*
 * Reconciliation for one posting at one location — PHASE1.md §5.2.
 *
 * This is SQL rather than three round trips from the crawler because the find/merge/insert
 * has to be atomic. Two adapters crawling the same employer concurrently would otherwise
 * both look, both miss, and both insert, and only the unique index would notice — as an
 * error, after the work was done.
 *
 * Returns what happened, which is what crawl_runs counts:
 *   'created'   a new posting
 *   'updated'   the same posting from the same source, seen again
 *   'collapsed' the same source, a different requisition id, the same actual job — an
 *               employer posting one role several times, which the key absorbs
 *   'duplicate' a *different* source resolving to a job we already have, which is the
 *               overlap risk §3.4 is really about
 *
 * On a duplicate the existing apply_url is kept. §4.3 requires sending users to the
 * employer's own ATS, and the first source to find a posting is the one most likely to be
 * that ATS rather than a mirror of it.
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
  v_key          text := public.job_dedup_key(v_company_id, v_title_norm, v_city, v_seniority);
  v_existing     public.jobs%rowtype;
  v_new_id       uuid;
  v_near_id      uuid;
  v_near_score   real;
begin
  /*
   * Identity lookup, two tiers.
   *
   * (source_id, external_id, city) FIRST — the ATS's own identifier for this exact
   * fanned-out row, which does not move just because a normalizer got smarter.
   * `dedup_key` is derived from title_normalized/city/seniority, all three of which are
   * classifier output, not ATS fact. When a normalizer fix changes a posting's derived
   * seniority — exactly what happened when the intern/"Internal" word-boundary bug was
   * fixed — its dedup_key changes too, and a dedup_key-only lookup would find nothing,
   * insert a fresh row, and leave the old, wrongly-classified one sitting open next to
   * it. That is not hypothetical: it is what the first version of this function did,
   * confirmed by duplicate open rows sharing one external_id after a replay.
   *
   * dedup_key is still consulted, but only as the fallback for a posting this exact
   * source has genuinely never sent before — which is where it belongs: catching a
   * different source's posting that resolves to a job already stored (`duplicate`), or
   * the same source re-posting a role under a new requisition id (`collapsed`).
   */
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
    update public.jobs j
       set last_seen_at     = now(),
           -- Mutable content is refreshed: an employer that edits a description or adds a
           -- salary should not need the posting to close and reopen for us to notice.
           title            = p ->> 'title',
           description_text = p ->> 'description_text',
           description_html = p ->> 'description_html',
           requirements     = coalesce(array(select jsonb_array_elements_text(p -> 'requirements')), '{}'),
           skills           = coalesce(array(select jsonb_array_elements_text(p -> 'skills')), '{}'),
           salary_min       = (p ->> 'salary_min')::numeric,
           salary_max       = (p ->> 'salary_max')::numeric,
           salary_period    = nullif(p ->> 'salary_period', '')::public.salary_period,
           salary_currency  = coalesce(p ->> 'salary_currency', 'USD'),
           seniority        = nullif(p ->> 'seniority', '')::public.seniority_level,
           employment_type  = (p ->> 'employment_type')::public.employment_type,
           location_type    = (p ->> 'location_type')::public.location_type,
           quality_score    = (p ->> 'quality_score')::real,
           closes_at        = nullif(p ->> 'closes_at', '')::timestamptz,
           run_id           = nullif(p ->> 'run_id', '')::uuid,
           -- Only the source that owns this posting may repoint where it applies.
           apply_url        = case
                                when j.source_id is null or j.source_id = v_source_id
                                then p ->> 'apply_url' else j.apply_url end,
           source_id        = coalesce(j.source_id, v_source_id),
           external_id      = coalesce(j.external_id, v_external_id)
     where j.id = v_existing.id;

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
    description_text, description_html, requirements, skills, apply_url, apply_host,
    posted_at, closes_at, dedup_group_id, quality_score
  )
  values (
    v_company_id,
    v_source_id,
    nullif(p ->> 'run_id', '')::uuid,
    v_external_id,
    p ->> 'title',
    v_title_norm,
    nullif(p ->> 'seniority', '')::public.seniority_level,
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
    p ->> 'description_html',
    coalesce(array(select jsonb_array_elements_text(p -> 'requirements')), '{}'),
    coalesce(array(select jsonb_array_elements_text(p -> 'skills')), '{}'),
    p ->> 'apply_url',
    p ->> 'apply_host',
    coalesce(nullif(p ->> 'posted_at', '')::timestamptz, now()),
    nullif(p ->> 'closes_at', '')::timestamptz,
    coalesce(nullif(p ->> 'dedup_group_id', '')::uuid, gen_random_uuid()),
    (p ->> 'quality_score')::real
  )
  returning id into v_new_id;

  /*
   * Near-miss detection — §3.4: "Don't auto-merge on fuzzy signals; a wrong merge
   * silently deletes a real job and nobody notices."
   *
   * So the row is already inserted above, and this only files a review. A wrong
   * non-merge shows a duplicate, which someone sees. A wrong merge shows nothing.
   *
   * Same company, same city, same seniority, similar title, and NOT a sibling from the
   * same multi-location fan-out.
   *
   * The seniority match is load-bearing and was added after the first full crawl. Without
   * it the queue filled with 2,217 pairs that were not near-misses at all: an intern and a
   * senior posting with an *identical* normalized title now live side by side on purpose,
   * because seniority is part of the dedup key, and the detector was flagging every one of
   * them at similarity 1.0. A queue that reports the key working as if it were failing is
   * worse than no queue.
   *
   * With seniority matched, similarity 1.0 is unreachable here — an identical title at the
   * same company, city and seniority would have collided on the key above and never
   * reached this point. What is left is genuinely the interesting case: two titles that
   * differ slightly and might be the same job.
   */
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

revoke all on function public.ingest_upsert_job(jsonb) from anon, authenticated;

/*
 * The batched form, and the one the crawler actually calls.
 *
 * A full pass over 140 boards produces low six figures of rows after §4.4's location
 * fan-out. One round trip each — even at a few milliseconds — is half an hour of latency
 * doing nothing but waiting, and it makes the crawl's cost a function of network RTT
 * rather than of work. Batching turns that into one call per fifty rows.
 *
 * Reconciliation stays per row inside the loop: a batch is a transport optimisation, not
 * a transaction boundary, and one malformed posting must not roll back the other
 * forty-nine.
 */
create or replace function public.ingest_upsert_jobs(p_rows jsonb)
returns jsonb
language plpgsql
as $$
declare
  row_data  jsonb;
  outcome   text;
  created   integer := 0;
  updated   integer := 0;
  collapsed integer := 0;
  duplicate integer := 0;
begin
  for row_data in select value from jsonb_array_elements(p_rows) loop
    outcome := public.ingest_upsert_job(row_data);
    if outcome = 'created' then
      created := created + 1;
    elsif outcome = 'updated' then
      updated := updated + 1;
    elsif outcome = 'collapsed' then
      collapsed := collapsed + 1;
    else
      duplicate := duplicate + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'created', created, 'updated', updated, 'collapsed', collapsed, 'duplicate', duplicate);
end;
$$;

revoke all on function public.ingest_upsert_jobs(jsonb) from anon, authenticated;
