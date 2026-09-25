# CareerDeck — Backend & Data Architecture Plan

**Status:** Draft for build. Supersedes the "Roadmap" section of the root README.
**Written for:** the engineers building CareerDeck's backend (small team, some of whom
have not worked in `app/` and need the domain explained, not just the tables).
**Covers:** schema, ingestion, ranking, Auto Apply, moderation, billing, compliance,
infra, and the order to build it in.

---

## 0. Decisions already made

These were settled before this document and are treated as fixed. Everything below
follows from them. If one of these changes, re-read the sections it touches.

| # | Decision | Chosen | Main consequence |
|---|---|---|---|
| 1 | Job supply | **Crawl / aggregate** ATS boards | You own an ingestion pipeline, dedup, and staleness detection. No employer sales. |
| 2 | Auto Apply ceiling | **Pre-fill + mandatory human review** | No headless submission. You never POST to an ATS. Tracking stays self-reported. |
| 3 | Social identity | **Anonymous, but verified** | Comments show `CS @ Purdue '27`, never a name. You need moderation infra. |
| 4 | Verification paths | **`.edu` email _or_ government-ID personhood** | Two verification flows, one tier ladder. Signup itself is open to any email. |
| 5 | Platform | **Supabase (Postgres) + own services** | RLS for most authz, real SQL for ranking, pgvector for phase 2. |
| 6 | Ranking | **Heuristic → embeddings → learned**, phased | Ship explainable scoring first; log impressions from day one to afford phase 3 later. |
| 7 | Resume handling | **Parse to structured profile** | Highest-value data and highest-risk data. Encrypted, audited, purgeable. |
| 8 | News | **RSS / news API ingestion** | Editorial pipeline + a copyright constraint (see §9). |
| 9 | Scale target | **Small team, 50k+ users** | Real queues, cache tier, separate ranking path, observability from day one. |
| 10 | Geography | **US-only first**, GDPR-ready schema | CCPA/CPRA now. Consent + deletion + export designed in, not bolted on. |
| 11 | Moderation | **Automated pre-screen + human post-hoc** | Classifier in the write path; review queue; strikes bound to verified identity. |
| 12 | Money | **Subscription at launch** | RevenueCat + server-side entitlements. Credits become an append-only ledger. |

---

## 1. What already exists, and what that means

The client is further along than the README admits. Before designing anything, this is
the actual surface the backend has to serve.

### 1.1 Domain objects the UI already renders

| Type | File | Backend implication |
|---|---|---|
| `Job` | [types/job.ts](../types/job.ts) | Core content entity. 20 fields, two of which are per-user. |
| `Company` | [types/company.ts](../types/company.ts) | Has a denormalized `followerCount` and a per-user `isFollowing`. |
| `User` | [types/user.ts](../types/user.ts) | Identity + preferences mixed into one record. Should split. |
| `Application` | [types/application.ts](../types/application.ts) | Self-reported pipeline, 4 statuses, 5 sources. |
| `JobComment` | [types/comment.ts](../types/comment.ts) | Single-level threads, GIF reactions, like counts. |
| `CommentActivity` | [types/comment.ts](../types/comment.ts) | Notification feed, already has aggregation (`likeCount`) and `read`. |
| `NewsItem` | [types/news.ts](../types/news.ts) | Company + industry news with **full article bodies**. See §9 — this is a problem. |
| `StoryGroup` | [types/story.ts](../types/story.ts) | Derived, not stored. Stays derived. |
| `Resume` | [types/resume.ts](../types/resume.ts) | Currently a bundled local PDF + thumbnail. |

### 1.2 Logic currently running on the client that must move or change

| Client logic | File | Verdict |
|---|---|---|
| For You feed ordering | [hooks/useJobFeeds.ts](../hooks/useJobFeeds.ts) | **Moves to server.** It's `sort by postedAt` today; it becomes the ranking engine. |
| Search | [hooks/useSearch.ts](../hooks/useSearch.ts) | **Moves to server.** Scans every job on every keystroke — fine at 30 fixtures, not at 300k. |
| Resume match score | [utils/resumeMatch.ts](../utils/resumeMatch.ts) | **Deleted.** It's a hash function pretending to be a model. Server sends a real score on the job payload. |
| Weekly goal + streak | [hooks/useWeeklyGoal.ts](../hooks/useWeeklyGoal.ts) | **Stays client-side.** It derives from `applications`, and the comment in that file is right: derived beats stored. Server only needs to serve applications and pay the bonus. |
| Application pipeline sort | [hooks/useApplications.ts](../hooks/useApplications.ts) | **Stays.** Small list, client-side sort is correct. |
| News relevance ordering | [hooks/useNewsFeed.ts](../hooks/useNewsFeed.ts) | **Hybrid.** Server ranks; client keeps the followed-first grouping. |
| Story grouping | [hooks/useStoryGroups.ts](../hooks/useStoryGroups.ts) | **Stays.** Pure derivation from the news feed. |
| Credit economy | [context/CareerDeckContext.tsx](../context/CareerDeckContext.tsx) | **Moves to server.** A client-held balance is a client-editable balance. |

### 1.3 Three modelling problems baked into the current types

Worth naming now, because each one costs a migration if it's discovered later.

**(a) Per-user state is embedded in shared entities.**
`Job.isSaved`, `Job.isLiked`, and `Company.isFollowing` are viewer-specific fields living
on records that are otherwise identical for everyone. That's convenient in a mock store and
actively harmful with a real one: it means a job row can never be cached or shared across
users, and every feed response has to be assembled per-viewer.

*Resolution:* the API returns the shared entity plus a small `viewer` object.
The client merges them — exactly the merge `CareerDeckContext` already does in its `useMemo`,
so the component tree never notices.

```ts
// wire format
{ job: { id, title, ... },           // cacheable, shared
  viewer: { liked: true, saved: false, applied: false, matchScore: 82 } }
```

**(b) `comment.likeCount` has the viewer's own like folded in.**
The context adds 1 to the fixture count when you've liked something. Server-side that
double-counts the moment the count is real. Store the true count; send `viewerHasLiked`
separately; let the client add the +1 optimistically only while a mutation is in flight.

**(c) IDs are human slugs.**
`'job-nvidia-swe-intern'`, `'nvidia'`. Company slugs are worth keeping (they're good URLs).
Job slugs are not — real postings need generated IDs. Deep links (`app/job/[id].tsx`,
`app/company/[id].tsx`) keep working either way, but plan for `job.id` to become a UUID and
for `company.id` to become a UUID **with** a stable `slug` column for URLs.

---

## 2. System architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│  Expo / React Native client                                          │
│  screens → hooks → React Query → API client → optimistic outbox      │
└───────────────┬──────────────────────────────────┬───────────────────┘
                │ (reads/writes)                   │ (auth)
                ▼                                  ▼
       ┌─────────────────────┐            ┌──────────────────┐
       │  Edge / API layer   │            │ Supabase Auth    │
       │  Hono on Fly.io     │            │ (GoTrue)         │
       │  + Supabase RPC     │            └──────────────────┘
       └────┬──────────┬─────┘
            │          │
            ▼          ▼
   ┌────────────┐  ┌──────────────┐
   │   Redis    │  │  Postgres    │  ← Supabase, pgvector, RLS
   │ feed cache │  │  (primary)   │
   │ rate limit │  └──────┬───────┘
   └────────────┘         │
                          │ read replica (phase 3)
        ┌─────────────────┴────────────────────────────┐
        │          Durable job runner (Inngest)        │
        ├───────────────┬──────────────┬───────────────┤
        │ crawlers      │ enrichment   │ periodic      │
        │ ─ Greenhouse  │ ─ resume parse│ ─ daily grant│
        │ ─ Lever       │ ─ embeddings  │ ─ streak pay │
        │ ─ Ashby       │ ─ moderation  │ ─ staleness  │
        │ ─ Workday     │ ─ autoapply   │ ─ taste vec  │
        │ ─ RSS/news    │ ─ news summarize│ ─ digest   │
        └───────────────┴──────────────┴───────────────┘
                          │
                          ▼
              external: LLM API, embedding API,
              news API, ID-verify vendor, RevenueCat
```

### 2.1 Why this split

- **Supabase Postgres as the single source of truth.** The domain is relational
  (jobs↔companies↔applications↔comments↔users) and the ranking work is fundamentally
  SQL-shaped. RLS covers the large boring majority of authorization — a student reading
  their own applications, a user editing their own comment — without an endpoint per rule.
- **A real API service (Hono on Fly.io) alongside it**, not instead of it. Supabase's
  auto-generated REST is great for CRUD. It is the wrong tool for the ranked feed,
  Auto Apply orchestration, and anything needing a secret. Rule of thumb:
  *reads that RLS can express → Supabase client directly; everything else → your service.*
- **Inngest (or Trigger.dev) for background work.** At "small team, 50k users" the ops cost
  of self-managed workers is the thing that eats the team. Durable steps, automatic retries,
  backoff, and a visible run history matter more than the per-invocation price. No crawler
  needs a real browser yet — Workday, the reason this sentence originally named one, is
  plain JSON (§4.2). If a bespoke career site ever does, it runs as a container on Fly,
  triggered by the same runner.
- **Redis from the start**, for two things only: the per-user feed candidate pool and rate
  limiting. Not as a general cache — that's how caches become correctness bugs.

### 2.2 Environments

`local` (Supabase CLI, seeded from `data/mock*.ts`) → `preview` (per-PR branch DB) →
`staging` (real crawlers, synthetic users) → `production`.

The mock fixtures become the seed script. They're good fixtures — keep them working so
local dev never needs a crawler.

---

## 3. The data model

Conventions used throughout:

- `uuid` primary keys via `gen_random_uuid()`, except high-volume append-only tables
  which use `bigint identity` (impressions, credit ledger).
- Every table gets `created_at timestamptz not null default now()`.
  Mutable tables also get `updated_at`, maintained by a trigger, not by application code.
- **Soft delete** (`deleted_at`) on anything a user can author (comments, resumes, profiles).
  **Hard delete** on everything else. Soft deletes are always filtered by a view or an RLS
  policy, never by remembering to write `where deleted_at is null`.
- Enums as Postgres `enum` types where the set is genuinely closed and owned by us
  (`application_status`). Lookup tables where the set grows (`skills`, `schools`).
- All timestamps `timestamptz`, stored UTC. The one exception is `applications.applied_at`,
  which stays a `date` — the weekly goal is a human, local-calendar concept and the client
  already reasons about it in local dates ([utils/week.ts](../utils/week.ts)).

### 3.1 Identity

```sql
-- auth.users is managed by Supabase Auth. profiles is our extension of it.

create type verification_tier as enum ('none', 'email', 'edu', 'identity');

create table profiles (
  id                    uuid primary key references auth.users(id) on delete cascade,
  handle                citext unique,          -- pseudonym shown on comments
  first_name            text,
  last_name             text,
  display_name          text,                   -- derived, never edited directly
  avatar_color          text not null default '#111114',
  school_id             uuid references schools(id),
  school_name_raw       text,                   -- what they typed, pre-verification
  major                 text,
  graduation_year       smallint,
  location              text,
  -- The string shown on comments: "CS @ Purdue '27". Generated, never user-supplied,
  -- so a user cannot type a school they haven't verified into their own badge.
  comment_badge         text generated always as (...) stored,
  verification_tier     verification_tier not null default 'none',
  onboarding_completed_at timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz
);

create table user_preferences (
  user_id                   uuid primary key references profiles(id) on delete cascade,
  preferred_roles           text[] not null default '{}',
  preferred_locations       text[] not null default '{}',
  preferred_employment_types employment_type[] not null default '{}',
  min_salary_annual         integer,
  open_to_remote            boolean not null default true,
  weekly_goal               smallint not null default 7
                              check (weekly_goal between 3 and 30),
  notification_prefs        jsonb not null default '{}',
  updated_at                timestamptz not null default now()
);

create table schools (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  short_name    text,                            -- "Purdue"
  email_domains citext[] not null default '{}',  -- the .edu verification key
  country       char(2) not null default 'US',
  created_at    timestamptz not null default now()
);
create index on schools using gin (email_domains);
```

**Why `User` splits into two tables.** [types/user.ts](../types/user.ts) mixes identity
(name, school) with preferences (`preferredRoles`, `preferredLocations`). They have
completely different read patterns: identity is read on every comment render; preferences
are read by the ranking engine on every feed build. They also have different privacy
classes. Splitting them now costs nothing; splitting them later means touching both.

The client keeps a single `User` object — `updateIdentity` writes one table,
`setPreferredRoles` writes the other. No screen changes.

### 3.2 Verification (the two-path ladder)

Signup is open to any email. Verification is what unlocks commenting.

```sql
create type verification_kind   as enum ('edu_email', 'government_id');
create type verification_status as enum ('pending', 'verified', 'failed', 'expired');

create table verifications (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references profiles(id) on delete cascade,
  kind           verification_kind not null,
  status         verification_status not null default 'pending',

  -- edu_email path
  edu_email      citext,
  edu_domain     citext,
  school_id      uuid references schools(id),
  token_hash     text,                    -- hash of the magic-link token, never the token
  token_expires_at timestamptz,

  -- government_id path
  provider       text,                    -- 'persona' | 'stripe_identity'
  provider_ref   text,                    -- inquiry id. THE ONLY THING WE KEEP.
  provider_result jsonb,                  -- pass/fail + reason codes. NO document data.

  verified_at    timestamptz,
  expires_at     timestamptz,             -- edu addresses die after graduation
  created_at     timestamptz not null default now()
);

create unique index on verifications (user_id, kind) where status = 'verified';
```

**Non-negotiable:** the government-ID path stores a provider reference and a boolean
outcome. No images, no document numbers, no date of birth, no name from the document.
The vendor holds that and is contractually responsible for it. The moment you store an
ID image you have inherited a breach-notification obligation you do not want.

**Tier ladder and what each unlocks:**

| Tier | How you get it | Unlocks |
|---|---|---|
| `none` | — | Nothing; pre-signup only |
| `email` | Confirm any email | Full read access: feed, search, save, like, follow, apply handoff, tracking, subscription |
| `edu` | Magic link to an address matching `schools.email_domains` | Commenting + the `CS @ Purdue '27` badge |
| `identity` | Pass a vendor personhood check | Commenting + a generic "Verified" badge (no school claim) |

`edu` and `identity` are siblings, not a hierarchy — both grant comment-write. They differ
only in the badge. This matters for the bootcamp grad, the career switcher, and the student
whose university uses a `.ac.uk`-style domain: they get in via the ID path.

**Expiry is real.** A `.edu` address stops working after graduation. Run a quarterly job
that re-challenges `edu` verifications older than ~2 years. Do not silently revoke —
notify, give a grace period, offer the ID path, then downgrade the badge (not the account).

### 3.3 Companies

```sql
create table companies (
  id              uuid primary key default gen_random_uuid(),
  slug            citext unique not null,     -- 'nvidia' — the current mock id, kept for URLs
  name            text not null,
  legal_name      text,
  domain          citext unique,              -- PRIMARY DEDUP KEY across all crawlers
  logo_url        text,
  logo_monogram   text,                       -- 'NV' — the CompanyLogo fallback
  logo_color      text,
  industry        text,
  hq_location     text,
  employee_range  text,
  description     text,
  follower_count  integer not null default 0, -- denormalized, see §3.5
  is_active       boolean not null default true,
  claimed_by_org_id uuid,                     -- reserved: employer accounts, not built yet
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
```

`domain` is the dedup key that matters. Two crawlers will both find NVIDIA — one via
`boards.greenhouse.io/nvidia`, one via `nvidia.com/careers`. The registrable domain is the
only identifier that reliably collapses them. Name matching does not work
(`Meta` / `Meta Platforms` / `Facebook`).

`claimed_by_org_id` is a deliberate stub. It costs one nullable column now and is the
difference between "add employer accounts" being a feature and being a migration.

### 3.4 Jobs — raw and canonical

The single most important structural decision in this document: **ingestion writes to an
immutable landing table; a separate step produces the canonical row.**

```sql
create type ats_kind as enum
  ('greenhouse','lever','ashby','workday','smartrecruiters','company_site','feed');

create table job_sources (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid references companies(id) on delete cascade,
  kind                 ats_kind not null,
  board_url            text not null,
  board_token          text,                  -- e.g. the Greenhouse board slug
  crawl_interval       interval not null default '6 hours',
  enabled              boolean not null default true,
  last_crawled_at      timestamptz,
  last_success_at      timestamptz,
  consecutive_failures smallint not null default 0,
  etag                 text,
  notes                text,
  created_at           timestamptz not null default now(),
  unique (kind, board_url)
);

-- Immutable. Never updated, only inserted. This is your audit trail and your
-- reprocessing input: when the normalizer has a bug, you replay from here rather
-- than re-crawling 300k postings and annoying every ATS you touch.
create table raw_postings (
  id           bigint generated always as identity primary key,
  source_id    uuid not null references job_sources(id) on delete cascade,
  external_id  text not null,                 -- the ATS's own posting id
  content_hash text not null,                 -- sha256 of the normalized payload
  payload      jsonb not null,
  fetched_at   timestamptz not null default now(),
  processed_at timestamptz,
  process_error text,
  unique (source_id, external_id, content_hash)
);
create index on raw_postings (processed_at) where processed_at is null;
```

The `unique (source_id, external_id, content_hash)` constraint is the whole re-crawl
strategy: if nothing about a posting changed, the insert conflicts and is skipped, and
no downstream work (embedding, enrichment, notification) fires. Re-crawling becomes cheap.

```sql
create type location_type   as enum ('Onsite', 'Hybrid', 'Remote');
create type employment_type as enum ('Internship','Full-time','Part-time','Contract');
create type salary_period   as enum ('hour', 'year');
create type job_status      as enum ('open','closed','expired','removed','suppressed');

create table jobs (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references companies(id) on delete cascade,
  source_id          uuid references job_sources(id) on delete set null,
  external_id        text,

  title              text not null,
  title_normalized   text not null,        -- lowercased, seniority-stripped; dedup + search
  seniority          text,                 -- 'intern'|'new_grad'|'mid'|'senior' — extracted

  location_raw       text,
  location_city      text,
  location_region    text,
  location_country   char(2),
  location_type      location_type not null,
  employment_type    employment_type not null,

  salary_min         numeric(12,2),
  salary_max         numeric(12,2),
  salary_period      salary_period,
  salary_currency    char(3) not null default 'USD',
  salary_is_estimated boolean not null default false,

  description_text   text not null,
  description_html   text,
  requirements       text[] not null default '{}',
  skills             text[] not null default '{}',   -- denormalized for card rendering

  apply_url          text not null,
  apply_host         text,                 -- 'greenhouse' — feeds ApplicationSource

  posted_at          timestamptz,
  first_seen_at      timestamptz not null default now(),
  last_seen_at       timestamptz not null default now(),
  closes_at          timestamptz,
  status             job_status not null default 'open',

  dedup_key          text not null,        -- see below
  quality_score      real not null default 0.5,
  embedding          vector(1536),

  search_vector tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title,'')), 'A') ||
    setweight(to_tsvector('english', coalesce(array_to_string(skills,' '),'')), 'B') ||
    setweight(to_tsvector('english', coalesce(description_text,'')), 'D')
  ) stored,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index on jobs using gin (search_vector);
create index on jobs using hnsw (embedding vector_cosine_ops);
create index on jobs (company_id, posted_at desc) where status = 'open';
create index on jobs (posted_at desc) where status = 'open';
create index on jobs using gin (skills);
create unique index on jobs (dedup_key) where status = 'open';
```

**`salary_is_estimated`** exists because you will want to show a range on the ~50% of
postings that don't list one, and the UI must be able to say so. Never show an inferred
number as if the employer stated it — several US states now require posted pay ranges, and
blurring the line between "stated" and "our guess" is how you end up in a discussion you
don't want.

**`quality_score`** is set at ingest and is the junk filter. Staffing-agency spam,
postings with a 40-word description, "Work From Home $$$" — score them low once at write
time rather than filtering them on every feed read.

**Dedup.** `dedup_key = sha256(company_id || title_normalized || coalesce(location_city,'*'))`.
The partial unique index means only one *open* posting per key. When a duplicate arrives:

1. Exact `dedup_key` hit → update `last_seen_at`, keep the better `apply_url`
   (prefer the ATS's own URL over an aggregator's redirect), do not create a row.
2. Near-miss (same company, cosine similarity > 0.95 on embedding) → flag into
   `job_dedup_review` for a human. Don't auto-merge on fuzzy signals; a wrong merge
   silently deletes a real job and nobody notices.

**Staleness.** A crawler that stops seeing a posting is the only closure signal you get.
Nightly: any `open` job whose `source_id` was crawled successfully in the last 24h but whose
`last_seen_at` is older than 48h → `status = 'closed'`. Guard on the source having actually
succeeded, or one failing crawler closes a company's entire board.

### 3.5 The interaction graph

```sql
create table company_follows (
  user_id    uuid not null references profiles(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, company_id)
);
create index on company_follows (company_id);

create type interaction_kind as enum ('like','save','hide','not_interested');

create table job_interactions (
  user_id    uuid not null references profiles(id) on delete cascade,
  job_id     uuid not null references jobs(id) on delete cascade,
  kind       interaction_kind not null,
  created_at timestamptz not null default now(),
  primary key (user_id, job_id, kind)
);
create index on job_interactions (user_id, kind, created_at desc);
create index on job_interactions (job_id, kind);
```

One table with a `kind` discriminator rather than `likes` / `saves` / `hides` tables. They
have identical shape and identical access patterns, the ranking engine wants to read all of
them together, and `toggleLike` / `toggleSave` in the context are already the same function
with a different set. `hide` and `not_interested` don't exist in the UI yet; they are the
cheapest possible negative signal and the feed gets meaningfully better once they do.

`companies.follower_count` is denormalized because the suggested-companies rail renders it
on every card. Maintained by a trigger on `company_follows`, reconciled nightly. Don't
compute it live — it's a count over the largest join table in the system, for a number that
is decorative.

### 3.6 Impressions — the highest-volume table in the system

This is what buys you a phase-3 ranker. If you don't log from day one, you can't train later.

```sql
create type feed_surface as enum ('reels','home','search','company','collection','story');

create table job_impressions (
  id         bigint generated always as identity,
  user_id    uuid not null,
  job_id     uuid not null,
  surface    feed_surface not null,
  session_id uuid not null,
  position   smallint,             -- rank within the feed when shown
  dwell_ms   integer,              -- Reels: how long the card was the active page
  completed  boolean,              -- scrolled past vs. bounced back
  shown_at   timestamptz not null default now()
) partition by range (shown_at);

-- Monthly partitions, created ahead by a scheduled job. Drop at 13 months.
```

**Write path:** never one request per card. The client buffers impressions in memory,
flushes on a 10-second timer / 25-item batch / app backgrounding, to a single
`POST /v1/events` that does one multi-row insert. At 50k DAU and ~60 cards a session this is
~3M rows/day — entirely fine for partitioned Postgres, catastrophic as 3M HTTP requests.

`dwell_ms` is the strongest implicit signal you have and the reason a Reels-style UI is
worth the trouble. `reels.tsx` already knows which page is active; it just needs to time it.

### 3.7 Applications

```sql
create type application_status as enum ('applied','interview','offer','closed');
create type application_source as enum ('greenhouse','workday','lever','ashby','company');

create table applications (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references profiles(id) on delete cascade,
  job_id         uuid not null references jobs(id) on delete restrict,
  status         application_status not null default 'applied',
  source         application_source not null,
  applied_at     date not null,
  status_changed_at timestamptz not null default now(),
  self_reported  boolean not null default true,
  auto_apply_run_id uuid references auto_apply_runs(id),
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (user_id, job_id)
);

create table application_events (
  id             bigint generated always as identity primary key,
  application_id uuid not null references applications(id) on delete cascade,
  from_status    application_status,
  to_status      application_status not null,
  created_at     timestamptz not null default now()
);
```

`on delete restrict` on `job_id` is deliberate: a user's application history must not
evaporate because a crawler decided a posting was gone. Jobs are closed, never deleted.

`unique (user_id, job_id)` enforces at the database what `logApplication` currently does in
a `.some()` check — re-applying doesn't create a duplicate row.

`application_events` exists so the pipeline has history, so "how long until you heard back"
is answerable later, and so a disputed streak can be audited.

### 3.8 Comments and moderation

```sql
create type moderation_status as enum ('pending','approved','flagged','removed');

create table comments (
  id                uuid primary key default gen_random_uuid(),
  job_id            uuid not null references jobs(id) on delete cascade,
  parent_id         uuid references comments(id) on delete cascade,
  author_id         uuid not null references profiles(id) on delete cascade,
  body              text not null default '',
  gif_id            text,
  moderation_status moderation_status not null default 'pending',
  moderation_scores jsonb,
  like_count        integer not null default 0,
  reply_count       integer not null default 0,
  created_at        timestamptz not null default now(),
  edited_at         timestamptz,
  deleted_at        timestamptz,

  -- A comment is text, or a GIF, or both. Never neither.
  constraint comment_has_content check (length(trim(body)) > 0 or gif_id is not null)
);

-- Single-level threads, enforced in the database rather than hoped for in the client.
create or replace function enforce_flat_threads() returns trigger as $$
begin
  if new.parent_id is not null and
     (select parent_id from comments where id = new.parent_id) is not null then
    raise exception 'replies cannot be nested more than one level';
  end if;
  return new;
end $$ language plpgsql;

create table comment_likes (
  user_id    uuid not null references profiles(id) on delete cascade,
  comment_id uuid not null references comments(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, comment_id)
);

create table reports (
  id          uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references profiles(id) on delete cascade,
  target_type text not null check (target_type in ('comment','profile')),
  target_id   uuid not null,
  reason      text not null,
  detail      text,
  status      text not null default 'open',
  resolved_by uuid,
  resolved_at timestamptz,
  created_at  timestamptz not null default now(),
  unique (reporter_id, target_type, target_id)
);

create table blocks (
  blocker_id uuid not null references profiles(id) on delete cascade,
  blocked_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create table user_strikes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(id) on delete cascade,
  severity   smallint not null,          -- 1 warn, 2 mute, 3 ban
  reason     text not null,
  comment_id uuid references comments(id) on delete set null,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
```

**The anonymity contract, stated precisely:** users are anonymous *to each other* and fully
identified *to you*. `author_id` always points at a real, verified account. What the client
receives is a view:

```sql
create view comments_public as
select c.id, c.job_id, c.parent_id, c.body, c.gif_id,
       c.like_count, c.reply_count, c.created_at, c.edited_at,
       p.handle        as author_handle,
       p.comment_badge as author_badge,       -- "CS @ Purdue '27"
       p.avatar_color  as author_color
from comments c join profiles p on p.id = c.author_id
where c.deleted_at is null and c.moderation_status in ('approved','flagged');
```

`author_id` is never in a client response. This is the property that makes anonymity
survivable: a harasser is anonymous to their target and one `user_strikes` row away from
losing an account that cost them a verification to obtain.

**Activity / notifications** (`CommentActivity` in the client) is a derived, aggregated feed:

```sql
create table notifications (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references profiles(id) on delete cascade,
  kind         text not null,          -- 'comment_reply' | 'comment_like' | 'job_alert' | ...
  subject_type text, subject_id uuid,  -- the comment/job it concerns
  actor_id     uuid,                   -- internal only; never serialized to the client
  aggregate_count integer not null default 1,
  payload      jsonb not null,         -- denormalized display fields
  read_at      timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index on notifications (user_id, created_at desc) where read_at is null;
```

Like-notifications aggregate: the third person to like your comment updates
`aggregate_count` on the existing row rather than inserting a new one. The client type
already anticipates this (`likeCount?: number` → "Priya and 4 others").

### 3.9 Resumes

```sql
create table resumes (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references profiles(id) on delete cascade,
  name          text not null,
  focus         text,
  storage_path  text not null,          -- private bucket; signed URLs only
  thumbnail_path text,
  file_size     integer,
  page_count    smallint,
  content_hash  text,                   -- skip re-parsing an identical re-upload
  is_default    boolean not null default false,
  parse_status  text not null default 'pending',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create unique index on resumes (user_id) where is_default and deleted_at is null;

create table resume_profiles (
  resume_id        uuid primary key references resumes(id) on delete cascade,
  -- Contact fields are encrypted at rest with a key held outside the DB.
  full_name_enc    bytea,
  email_enc        bytea,
  phone_enc        bytea,
  location         text,                -- coarse; used for matching, not identifying
  skills           text[] not null default '{}',
  education        jsonb not null default '[]',
  experience       jsonb not null default '[]',
  years_experience numeric(4,1),
  seniority        text,
  embedding        vector(1536),
  raw_parse        jsonb,
  parser_version   text not null,
  parsed_at        timestamptz not null default now(),
  user_confirmed_at timestamptz
);
```

The `unique ... where is_default` index replaces `defaultResumeId` in the context and makes
"exactly one default" a database invariant rather than a convention.

`user_confirmed_at` is worth the extra onboarding screen. Letting the user correct the parse
does three things at once: it fixes the ~15% of fields the parser gets wrong, it produces a
consent moment you can point at, and it gives you labeled data on parser accuracy for free.

**Access to resume storage is audited:**

```sql
create table pii_access_log (
  id         bigint generated always as identity primary key,
  actor_type text not null,            -- 'user' | 'service' | 'staff'
  actor_id   uuid,
  subject_user_id uuid not null,
  resource   text not null,            -- 'resume_pdf' | 'resume_profile'
  resource_id uuid,
  purpose    text not null,            -- 'autoapply' | 'parse' | 'user_download' | 'support'
  created_at timestamptz not null default now()
);
```

Every signed URL issued and every parse read writes a row. This is the single cheapest thing
you can build that turns a future security incident from an unbounded question into a query.

### 3.10 Match scores

Replaces [utils/resumeMatch.ts](../utils/resumeMatch.ts) — the hash function currently
faking the number in `ResumeMatchRing`.

```sql
create table job_match_scores (
  user_id     uuid not null references profiles(id) on delete cascade,
  job_id      uuid not null references jobs(id) on delete cascade,
  resume_id   uuid not null references resumes(id) on delete cascade,
  score       smallint not null check (score between 0 and 100),
  components  jsonb not null,     -- {skillOverlap: .7, seniority: 1, location: .5}
  computed_at timestamptz not null default now(),
  primary key (user_id, job_id)
);
```

`components` is not optional decoration. The moment a user asks "why is this 43%", you
either have an answer or you have a magic number they stop trusting. It's also what lets the
UI eventually say *"strong skills match, but they want 3 years"* instead of showing a ring.

Invalidated when the default resume changes or preferences change; recomputed lazily on feed
build for the candidate set only — never for the whole corpus.

### 3.11 News

```sql
create table news_sources (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('rss','api')),
  url        text not null unique,
  company_id uuid references companies(id) on delete cascade,
  category   text not null check (category in ('company','industry')),
  enabled    boolean not null default true,
  etag       text,
  last_fetched_at timestamptz,
  created_at timestamptz not null default now()
);

create table news_items (
  id            uuid primary key default gen_random_uuid(),
  source_id     uuid references news_sources(id) on delete set null,
  company_id    uuid references companies(id) on delete cascade,
  category      text not null,
  canonical_url text not null,
  url_hash      text not null unique,     -- dedup across syndicated copies
  publisher     text not null,            -- attribution is mandatory
  tag           text not null,            -- "NVIDIA · Hiring"
  headline      text not null,
  subtext       text,
  summary       text[] not null default '{}',  -- OUR summary. Not their article.
  image_url     text,
  accent_color  text,
  published_at  timestamptz not null,
  ingested_at   timestamptz not null default now(),
  relevance_score real,
  status        text not null default 'published',
  created_at    timestamptz not null default now()
);

create table news_seen (
  user_id       uuid not null references profiles(id) on delete cascade,
  news_item_id  uuid not null references news_items(id) on delete cascade,
  seen_at       timestamptz not null default now(),
  primary key (user_id, news_item_id)
);
```

`news_seen` makes the story rings' "watched" state survive a restart, which is currently a
session-only `Set` in the context.

---

## 4. Ingestion pipeline

### 4.1 Shape

```
schedule (per job_source.crawl_interval)
   → fetch          (ETag / If-Modified-Since; respect robots.txt & rate limits)
   → insert raw_postings   (content_hash dedup — unchanged postings stop here)
   → normalize      (title, location, salary, employment type, seniority)
   → enrich         (skill extraction, quality score, embedding)
   → upsert jobs    (via dedup_key)
   → fan out        (job alerts to followers, story generation)
```

Each arrow is a durable step with its own retry policy. A failure in enrichment must not
lose the raw payload — that's the entire reason `raw_postings` exists.

### 4.2 Per-ATS reality

| Source | Method | Difficulty | Notes |
|---|---|---|---|
| Greenhouse | Public JSON board API | Easy | `boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true`. Clean, stable, generous. Start here. |
| Lever | Public JSON | Easy | `api.lever.co/v0/postings/{company}?mode=json`. |
| Ashby | Public JSON / GraphQL | Easy–medium | Well structured, less documented. |
| SmartRecruiters | Public API | Easy | Good coverage in mid-market. |
| Workday | Public JSON per tenant | Medium — **built** | `{tenant}.wd{n}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs`, the endpoint the tenant's own public career page calls. No headless browser: a POST for each page of 20, then one GET per posting for the description the list withholds. Per-tenant URLs and per-tenant robots.txt are real, the "aggressive rate limits" were not — at our pacing nothing pushed back. `server/src/ingest/sources/workday.ts`. |
| Company career sites | Bespoke | Hard, low yield | Only worth it for a specific high-value employer. |

**Sequencing recommendation:** Greenhouse + Lever + Ashby gets you a large majority of
startup/tech internship and new-grad postings — precisely your market — for a fraction of
the effort. Ship on those three first — which is what happened.

**Workday, in hindsight, was not the quarter this document budgeted for.** The
prediction above assumed a rendered SPA behind a headless browser. It is in fact plain
JSON on the tenant's own host, and the adapter is one file. What it did cost was two
things this document did not predict:

- the adapter contract had to grow. §4.2 claimed a new ATS "implements this interface and
  touches nothing else, which is the only real test of whether the abstraction is right";
  Workday paginates and withholds descriptions, and neither is expressible as a pure
  body → postings function, so `SourceAdapter` gained three optional hooks;
- its data shape broke two normalizer assumptions that the first three ATSs never
  exercised — display-text posting dates ("Posted Today", which made every posting look
  changed on every crawl until it joined `VOLATILE_KEYS`) and broadest-first location
  strings ("US, CA, Santa Clara", which fanned out into a city called "US").

The lesson worth keeping is that the cost of a new source is in what its data does to the
normalizer, not in how hard the endpoint is to reach.

### 4.3 Crawl hygiene (this is the legal posture, not politeness)

- Identify yourself in `User-Agent` with a contact URL.
- Respect `robots.txt` and `Crawl-delay`. Global per-host concurrency cap.
- Exponential backoff on 429/5xx; disable a source after N consecutive failures and alert.
- Only public, unauthenticated endpoints. Never log in, never bypass a paywall, never
  defeat a bot check. The line between "reading a public jobs board" and "circumventing an
  access control" is the line between a business and a CFAA problem.
- Store the ATS's own apply URL and send users there. You are driving traffic *to* employers,
  which is the argument that makes this defensible.
- Honor takedown requests fast and keep a record: `job_sources.enabled = false` plus a note.

### 4.4 Normalization notes

- **Location:** ~40% of postings have a messy location string (`"Remote - US"`,
  `"SF / NYC / Remote"`, `"Multiple Locations"`). Multi-location postings should fan out into
  multiple `jobs` rows sharing a `dedup_group_id`, or the location filter lies.
- **Salary:** parse `$120,000 - $150,000`, `$58/hr`, `120k-150k`, and the many postings
  where pay is buried in a compliance paragraph at the bottom of the description. Set
  `salary_is_estimated` when you inferred rather than read it.
- **Seniority:** extract `intern` / `new grad` / `senior` from the title. This is the single
  highest-leverage field for your audience — a student should essentially never see a
  Staff Engineer role, and title text alone handles that better than any model.
- **Skills:** dictionary-based extraction against a curated `skills` table, not free-form
  LLM output. Free-form gives you `React`, `ReactJS`, `React.js`, and `react` as four skills
  and your filters quietly stop working.

---

## 5. Recommendation engine

### 5.1 Phase 1 — heuristic, explainable, shipped first

Runs per user per feed-session build, over a pre-filtered candidate set (open, US, matching
employment type, not applied/hidden, `quality_score > 0.3`).

```
score(user, job) =
    0.28 · pref_match        role-title match vs preferred_roles
                             + location match vs preferred_locations
    0.20 · skill_overlap     Jaccard(resume.skills ∪ profile skills, job.skills)
    0.16 · recency           exp(-age_days / 7)
    0.14 · affinity          1.0 follows company
                             0.6 liked/saved another role at this company
                             0.4 company similar to one they engage with
    0.12 · quality_score     set at ingest
    0.10 · urgency           closes within 14 days, ramping

  − 0.30 · seen_penalty      log(1 + times shown, not engaged)
  − 1.00 · hard_filters      applied, hidden, not_interested, closed
```

Weights live in a config table, not in code, so they're tunable without a deploy.
Every score is written to `components` so any card's rank is explainable.

**Diversity, applied after scoring.** Raw score ordering produces eight NVIDIA postings in a
row, which reads as broken even when each one is individually the best pick. Rules:
- at most 2 postings per company in any 10-card window;
- at most 3 per `title_normalized` per session;
- 10–15% of slots reserved for exploration — high-uncertainty jobs outside the user's
  established pattern. Without this the feed converges to one role type by day three and
  the user's real interests never get discovered.

**Cold start.** A new user with no resume, no likes, no follows: onboarding preferences
(already collected by `PreferencesSheet`) + popularity + recency + school-cohort signal
("students at your school applied to these"). The cohort signal is unusually strong for this
audience and costs one join.

### 5.2 Phase 2 — vector retrieval

Once resumes are parsed and embeddings exist, retrieval changes but ranking doesn't:

```
candidates = pgvector ANN(user_taste_vector, k = 500)
             ∪ recency pool (200 newest matching hard filters)
             ∪ follow pool (all open jobs at followed companies)
ranked     = phase-1 heuristic over that union
```

```sql
create table user_taste_vectors (
  user_id     uuid primary key references profiles(id) on delete cascade,
  embedding   vector(1536) not null,
  signal_count integer not null default 0,
  computed_at timestamptz not null default now()
);
```

Taste vector = weighted mean of the embeddings of jobs the user applied to (3×), saved (2×),
liked (1×), and their resume embedding (2×), with exponential time decay. Recomputed nightly
and immediately after a strong signal (apply).

The union with a recency pool matters: pure ANN retrieval never surfaces a posting that's
different from everything the user has touched, which is the definition of a filter bubble
and, for a job seeker, a genuine harm.

### 5.3 Phase 3 — learned re-ranker

Needs roughly 100k+ labeled impressions, which is why §3.6 exists from day one.
Gradient-boosted model (LightGBM), features = the phase-1 components plus user/job/context
features, label = engagement weighted by depth (`dwell` < `save` < `apply`).
Serve as a re-rank over the top ~200 heuristic candidates, never over the whole corpus.
**Ship behind an A/B flag against phase 1 and be prepared for it to lose.**

### 5.4 Serving an infinite feed

Do not rank on every scroll. Build a candidate pool per session and page through it.

```sql
create table feed_sessions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles(id) on delete cascade,
  surface     feed_surface not null,
  job_ids     uuid[] not null,         -- ~200 ranked ids
  cursor      integer not null default 0,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default (now() + interval '2 hours')
);
```

Mirror it in Redis with the same TTL; Postgres is the fallback. This gives a **stable feed**
— a user scrolling back up sees the same cards, which is the bug most infinite feeds ship
with. Pull-to-refresh (`ReelsRefreshIndicator` already exists) explicitly builds a new
session. Near the end of the pool, build the next one in the background.

---

## 6. Auto Apply (pre-fill + review)

The credit economy already exists in [constants/goal.ts](../constants/goal.ts). What it
needs is a server-side thing to actually buy.

```
user taps Auto Apply
  → reserve a credit (atomic; fails closed if balance is 0)
  → create auto_apply_runs row (status: pending)
  → job: fetch the ATS form schema for this posting
  → job: LLM generates answers from resume_profile + profile + job
  → return a draft to the client
  → user reviews and edits EVERY field in a sheet
  → user taps through to the ATS with values ready to paste/autofill
  → user confirms they submitted → applications row + credit committed
  → user abandons → credit refunded (a ledger entry, not a decrement)
```

```sql
create table auto_apply_runs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles(id) on delete cascade,
  job_id      uuid not null references jobs(id) on delete cascade,
  resume_id   uuid not null references resumes(id),
  status      text not null default 'pending',   -- pending|ready|reviewed|used|abandoned|failed
  draft       jsonb,                             -- {field_key: {value, confidence, source}}
  model       text, prompt_version text,
  tokens_in integer, tokens_out integer, cost_usd numeric(8,4),
  created_at  timestamptz not null default now(),
  completed_at timestamptz
);
```

**Design constraints that are not negotiable:**

- The user reviews every generated field before anything leaves the app. The README promises
  this and it is also what keeps the feature on the right side of every ATS's terms.
- Never fabricate a fact. If the resume doesn't answer "years of Python experience", the
  draft returns `null` with a prompt, not a plausible guess. `confidence` and `source`
  exist on every field so the UI can mark what was inferred.
- Cost per run is logged. At scale this is your largest variable cost after infra, and you
  need per-user economics before you set the subscription price, not after.
- Credits are **reserved** then **committed or refunded** — never decremented optimistically.

---

## 7. The credit ledger

Direct replacement for `autoApplyCredits`, `creditsRef`, and the `paidWeeks` ref in
[context/CareerDeckContext.tsx](../context/CareerDeckContext.tsx).

```sql
create type credit_kind as enum
  ('daily_grant','streak_bonus','spend','refund','purchase','subscription_grant','adjustment');

create table credit_transactions (
  id              bigint generated always as identity primary key,
  user_id         uuid not null references profiles(id) on delete cascade,
  kind            credit_kind not null,
  amount          integer not null,        -- signed: grants positive, spends negative
  ref_type        text,
  ref_id          uuid,
  idempotency_key text not null unique,
  created_at      timestamptz not null default now()
);
create index on credit_transactions (user_id, created_at desc);
```

**Balance is `sum(amount)`, never a stored column.** Cached in Redis, authoritative in
Postgres, reconciled on every write.

`idempotency_key` is the whole design. It is the server-side, durable version of the
`paidWeeks` `useRef` the context uses today:

| Event | Key | Guarantees |
|---|---|---|
| Daily grant | `grant:{user_id}:{YYYY-MM-DD}` | Exactly one grant per day, however many times the job runs |
| Streak bonus | `streak:{user_id}:{week_key}` | A week can never be paid twice — same invariant, now durable |
| Spend | `spend:{auto_apply_run_id}` | A retried request can't double-charge |
| Refund | `refund:{auto_apply_run_id}` | A retried abandon can't double-credit |

Bank cap (`AUTO_APPLY_ECONOMY.bankCap`) is enforced inside the grant function: grant
`min(amount, cap - current_balance)`. That's exactly what `awardStreakBonus` does today,
including returning the amount actually awarded — keep that behavior, it drives
`lastStreakAward` and the receipt UI.

**The streak bonus must be paid server-side.** It's currently computed from client-held
applications, and applications are self-reported. Server-side it's still self-reported —
but `maxWeeklyBonus` already caps the value of lying at 3 credits, which is the correct
defense. Add light anomaly detection (20 applications logged in 90 seconds) and move on.

---

## 8. Subscriptions

```sql
create table subscriptions (
  user_id       uuid primary key references profiles(id) on delete cascade,
  provider      text not null check (provider in ('app_store','play_store')),
  product_id    text not null,
  tier          text not null,
  status        text not null,   -- active|grace|on_hold|paused|expired|refunded
  original_transaction_id text not null,
  period_end    timestamptz,
  auto_renew    boolean,
  revenuecat_id text,
  updated_at    timestamptz not null default now()
);

create table entitlements (
  user_id    uuid not null references profiles(id) on delete cascade,
  feature    text not null,       -- 'auto_apply_quota'|'advanced_filters'|'early_access'
  value      jsonb not null,
  source     text not null,       -- 'subscription'|'promo'|'grandfathered'
  expires_at timestamptz,
  primary key (user_id, feature)
);
```

Use **RevenueCat**. Writing StoreKit 2 + Play Billing + receipt validation + the grace-period
and billing-retry state machines yourself is roughly a month of work you will get subtly
wrong, and subtle billing bugs are the expensive kind.

Rules:
- Entitlements are derived from **webhooks**, never from a client claim.
- Every gate checks `entitlements`, not `subscriptions`. Promos, grandfathering, and support
  grants then need no special cases anywhere.
- A lapsed subscription downgrades entitlements but **never deletes data**. A student who
  can't afford a renewal during finals must not lose their application tracker.
- Free tier must remain genuinely useful — feed, save, follow, apply handoff, tracking,
  the daily Auto Apply credit. Paywalling job discovery for students is both bad business
  and a bad look.

---

## 9. News ingestion — and the copyright constraint

**Flag this before building:** [types/news.ts](../types/news.ts) has `body: string[]` —
full article paragraphs — and [data/mockNews.ts](../data/mockNews.ts) fills it with complete
articles. That's fine for fixtures you wrote. With real RSS/news-API content, storing and
displaying full article bodies is straightforward copyright infringement. Most RSS feeds
deliberately carry only a summary for this exact reason, and news API terms almost
universally prohibit full-text redisplay.

**What's safe:**
- headline + publisher attribution + your own short generated summary (2–3 sentences)
- a link that opens the publisher's page (the `StoryArticleSheet` becomes a "Read at
  Publisher" handoff, or an in-app browser)
- publisher logo/name displayed prominently

**What isn't:** storing the article text, showing it as your own pages, or stripping bylines.

This changes the shape of `NewsItem.body` → `summary` and turns the story detail into a
link-out. Worth doing before the UI hardens around full text.

Pipeline: `fetch feed (ETag) → dedup by url_hash → match to company by domain →
LLM summary (≤3 sentences, cached forever, never regenerated) → relevance score → publish`.

Industry news needs a relevance filter — most "tech news" is irrelevant to a student job
seeker. Score for hiring relevance (layoffs, hiring freezes, new offices, funding,
internship program news) and suppress the rest.

---

## 10. Moderation pipeline

```
POST /v1/jobs/{id}/comments
  → verify tier ∈ (edu, identity)        else 403
  → rate limit (Redis: 10/hour, 40/day)  else 429
  → moderation classifier (~50–200ms)
      block → 422 with a reason the user can act on
      flag  → insert approved + review_queue row
      pass  → insert approved
  → return; realtime broadcast to the thread
```

Use a hosted moderation endpoint for the first pass. Categories to block outright:
harassment, threats, sexual content, doxxing (a regex pass for emails/phones/addresses on
top of the classifier). Categories to flag rather than block: negative employer claims —
"this company rejected me for no reason" is exactly the speech the product exists for, and
over-blocking it makes the comment section worthless.

**Employer defamation is the specific risk this product carries.** A verified student
anonymously claiming a named company did something illegal is your highest-severity failure
mode. Mitigations: a clear content policy shown at first comment, a report path that reaches
a human within 24h, a documented notice-and-takedown process with a contact address, and
`user_strikes` escalation (warn → 7-day mute → ban) bound to the verification, so a banned
user needs a new `.edu` address or a new government ID to return.

Human review queue: a small internal web view over `reports` and flagged comments. Build it
before launch, not after the first incident. Target: 24h on reports, 1h on threats.

---

## 11. API surface

Mapped to the hooks that exist today, so the client work is a substitution rather than a
redesign.

### Reads

| Endpoint | Replaces | Notes |
|---|---|---|
| `GET /v1/feed?surface=reels&cursor=` | `useJobFeeds().forYouJobs` | Ranked, paginated, session-stable. Returns `{job, viewer}` pairs. |
| `GET /v1/feed?surface=home&sort=recent\|salary\|company` | `useSortedJobs` | Server-side sort; the three sorts already in `FeedSortBar`. |
| `GET /v1/feed?surface=following` | `useJobFeeds().followingJobs` | |
| `GET /v1/jobs/{id}` | `useJobById` | Full detail + viewer state + match score. |
| `GET /v1/companies/{slug}` | `app/company/[id].tsx` | |
| `GET /v1/companies/{slug}/jobs` | `useCompanyJobs` | |
| `GET /v1/companies/suggested` | `suggestedCompanyIds` | Currently a hardcoded array; becomes ranked. |
| `GET /v1/search?q=&scope=jobs\|companies` | `useSearch` | Postgres FTS + trigram. Debounce 250ms client-side. |
| `GET /v1/me` | `user`, `preferences` | |
| `GET /v1/me/applications` | `useTrackedApplications` | Full list; client sorts and derives the goal. |
| `GET /v1/me/collections/{saved\|liked\|following}` | `app/collection/[type].tsx` | |
| `GET /v1/me/credits` | `autoApplyCredits` | Balance + next grant time. |
| `GET /v1/me/notifications` | `commentActivity` | |
| `GET /v1/jobs/{id}/comments?cursor=` | `useComments` | Paginated, top-level + first 3 replies. |
| `GET /v1/news?cursor=` | `useNewsFeed` | Ranked; client groups into stories. |

### Writes

| Endpoint | Replaces |
|---|---|
| `PUT/DELETE /v1/jobs/{id}/interactions/{like\|save\|hide}` | `toggleLike`, `toggleSave` |
| `PUT/DELETE /v1/companies/{id}/follow` | `toggleFollow` |
| `POST /v1/applications` | `logApplication` |
| `PATCH /v1/applications/{id}` | `setApplicationStatus` |
| `POST /v1/jobs/{id}/comments` | `addComment` |
| `DELETE /v1/comments/{id}` | `deleteComment` |
| `PUT/DELETE /v1/comments/{id}/like` | `toggleCommentLike` |
| `PATCH /v1/me` / `PATCH /v1/me/preferences` | `updateIdentity`, `setPreferredRoles`, `setWeeklyGoal` |
| `POST /v1/resumes` (+ direct-to-storage upload) | — |
| `PUT /v1/resumes/{id}/default` | `setDefaultResume` |
| `POST /v1/auto-apply` / `POST /v1/auto-apply/{id}/complete` | `spendAutoApplyCredit` |
| `POST /v1/events` | — (impression batch) |
| `POST /v1/news/{id}/seen` | `markNewsSeen` (batched) |
| `POST /v1/notifications/read` | `markCommentActivityRead` |

Idempotency: every non-GET accepts an `Idempotency-Key` header. Toggles are `PUT`/`DELETE`
(idempotent by construction) rather than `POST /toggle`, so a retry on a flaky connection
can't invert the state — the failure mode where a user's save silently un-saves itself.

---

## 12. "What to do when" — event → write path

The table the rest of this document exists to support.

| When the user… | Client does | Server writes | Downstream |
|---|---|---|---|
| Opens the app | Restores cache, revalidates | — | Daily grant job may have run |
| Scrolls a Reels card into view | Starts a dwell timer; buffers impression | — | — |
| Scrolls past it | Buffers `{job, dwell_ms, completed}` | (batched) `job_impressions` | Feeds seen-penalty and phase-3 training |
| Double-taps to like | Optimistic heart + haptic | `job_interactions(like)` | Taste vector on next rebuild |
| Saves a job | Optimistic bookmark | `job_interactions(save)` | Stronger taste signal; appears in Saved collection |
| Follows a company | Optimistic button state | `company_follows` + counter trigger | Following feed, story rings, job alerts |
| Taps Apply | Opens ATS via `Linking` | `application_intents` (weak signal) | — |
| Returns and confirms | Optimistic tracker row | `applications` + `application_events` | Weekly goal count; strongest taste signal |
| Moves a stage | Optimistic chip change | `applications.status` + event row | Pipeline counts |
| Finishes a week at goal | Shows receipt | `credit_transactions(streak_bonus)` idempotent by week | Balance |
| Spends an Auto Apply | Optimistic decrement | Reserve → `auto_apply_runs` → LLM job | Draft returned for review |
| Abandons a draft | — | `credit_transactions(refund)` | Balance restored |
| Posts a comment (verified) | Optimistic row, "sending" | Rate limit → classifier → `comments` | Realtime to thread; `notifications` to parent author |
| Posts a comment (unverified) | Verification sheet | — | Blocked before any write |
| Reports a comment | Confirmation toast | `reports` | Review queue; auto-hide at N reports |
| Uploads a resume | Direct-to-storage, then notify | `resumes` → parse job → `resume_profiles` + embedding | Match scores invalidated and recomputed |
| Edits preferences | Optimistic | `user_preferences` | Feed session invalidated; match scores recomputed |
| Watches a story | Marks seen locally | (batched) `news_seen` | Ring goes quiet, durably |
| Subscribes | RevenueCat SDK | Webhook → `subscriptions` + `entitlements` | Quota raised |
| Deletes their account | Confirmation | `deletion_requests` | 30-day grace, then cascade purge (§13.2) |
| Goes offline | Queues mutations in an outbox | — | Flushed in order on reconnect |

---

## 13. Security, privacy, compliance

### 13.1 Authorization

RLS on every user-scoped table. The shape:

```sql
alter table applications enable row level security;
create policy own_applications on applications
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table comments enable row level security;
create policy read_approved on comments for select
  using (deleted_at is null
         and moderation_status in ('approved','flagged')
         and not exists (select 1 from blocks
                         where blocker_id = auth.uid() and blocked_id = author_id));
create policy write_own on comments for insert
  with check (author_id = auth.uid()
              and (select verification_tier from profiles where id = auth.uid())
                  in ('edu','identity'));
```

`jobs`, `companies`, `news_items` are world-readable to authenticated users and writable only
by the service role. Anything touching secrets, money, or other users' data goes through the
API service with the service key — never the anon key.

### 13.2 PII and deletion

Data classes: **P0** resume files and parsed contact fields (encrypted, audited, purged on
delete). **P1** identity, verification records, applications. **P2** interactions,
impressions. **P3** jobs, companies, news.

Deletion is a two-phase job:

1. `deletion_requests` row, account disabled immediately, 30-day grace (recoverable).
2. After 30 days: purge resume files from storage, `resume_profiles`, `verifications`,
   profile fields. Comments are anonymized rather than deleted (`author_id` → a tombstone
   account) so threads don't become incoherent — **and this is disclosed in the privacy
   policy before the fact, not after.** Applications, interactions and impressions are
   dissociated to a random research id or dropped.

Export: a job producing a JSON bundle of everything, delivered via a signed URL, ≤30 days.

Retention: impressions 13 months → aggregate. Raw postings 90 days after processing.
Moderation records 2 years. Verification records for the account's life + 1 year.

### 13.3 CCPA/CPRA now, GDPR later

Build now: notice at collection, delete, export, "do not sell/share" (you don't — record
that you don't), opt-out of targeted advertising, a documented subprocessor list.

Design in, don't build: a `lawful_basis` column on `consent_records`, a region column on
`profiles`, and a consent-versioning table. When you expand, GDPR becomes configuration plus
an EU-region deployment rather than a schema migration across every table you own.

One GDPR concept worth borrowing early: the ranking engine is arguably automated
decision-making about a person's employment opportunities. Keeping `job_match_scores.components`
explainable isn't only a UX nicety — it's the thing that makes that question answerable.

### 13.4 Abuse and rate limits

| Action | Limit |
|---|---|
| Comments | 10/hour, 40/day |
| Reports | 20/day |
| Auto Apply | Entitlement quota |
| Search | 60/min |
| Event batch | 120/min |
| Verification attempts | 5/day |
| Auth | Supabase defaults + per-IP |

Plus: device attestation on signup (App Attest / Play Integrity) to blunt bulk account
creation, since a verified account is a valuable thing to farm.

---

## 14. Observability and cost

**Instrument from day one:** Sentry (client + server, already RN-friendly), OpenTelemetry
traces from API → DB → job runner, and structured logs.

Dashboards that actually matter:
- *Ingestion:* postings/hour by source, crawler failure rate, dedup rate, staleness lag.
  **Alert on a source going quiet** — silent crawler death is the failure you won't notice.
- *Feed:* p50/p95 build latency, cache hit rate, impressions/session, dwell distribution,
  CTR and save-rate by position.
- *Quality:* apply-rate per 100 impressions, "not interested" rate, 7-day retention.
- *Money:* LLM spend per Auto Apply, per DAU, subscription conversion.
- *Safety:* comments blocked/flagged, report volume, time-to-resolution.

Rough monthly at 50k MAU / ~12k DAU (order of magnitude, verify before committing):
Supabase Pro + compute $200–600 · Fly.io API + crawlers $100–300 · Inngest $50–200 ·
Redis $50–100 · embeddings $50–150 · Auto Apply LLM $200–800 (volume-dependent, the one
that scales with success) · news API $0–500 · ID verification $1–2 per check (the one to
watch — gate it behind commenting intent, not signup) · Sentry/observability $50–200.
**Ballpark $700–2,800/mo**, dominated by LLM and ID-verification volume.

---

## 15. Build order

Each phase ends in something shippable. Don't build phase N+1's schema during phase N —
but don't contradict it either.

### Phase 0 — Foundations (2–3 weeks)
Supabase project, migration tooling, environments. Auth: Apple, Google, email OTP.
`profiles`, `user_preferences`, `schools`. Seed script from `data/mock*.ts`.
API service skeleton with auth middleware. Sentry wired. Client: replace
`CareerDeckContext`'s user/preference state with real reads.
**Exit:** sign in on a device, edit your profile, it survives a restart.

### Phase 1 — Jobs and ingestion (3–4 weeks) — **built**
`companies`, `job_sources`, `raw_postings`, `jobs`. Greenhouse + Lever + Ashby crawlers.
Normalization + dedup + staleness. FTS search. Client: feed and search are paginated reads.
**Exit:** 10k+ real postings from 100+ companies, feed and search work, dedup rate < 2%.

Design and outcome: [PHASE1.md](./PHASE1.md). Three decisions there depart from this
document and are argued at length in it:

- **Reads go to Postgres, not to the API service.** §11's URLs are not implemented; the
  contract behind them lives in `lib/api.ts` so phase 5 changes one file. §2.1's rule still
  holds — this is a deferral with a named trigger, not a rejection.
- **The dedup key includes seniority**, and `title_normalized` keeps years. §3.4's key cost
  523 of Anduril's 2,356 real requisitions in the first crawl.
- **No `jobs.embedding` yet.** Phase 4 adds the column and the index; near-miss dedup uses
  pg_trgm until then.

Measured: 30,800+ postings from 140 companies, 124 of 124 sources healthy, cross-source
dedup 0.00%. A separate 11% of reconcile attempts are employers posting one role under
several requisition ids — counted apart, because it is their data rather than our defect.

### Phase 2 — Interactions and tracking (2–3 weeks) — **built**
`company_follows`, `job_interactions`, `applications`, `application_events`,
`job_impressions`. Optimistic mutations + offline outbox. Collections screens.
Weekly goal reads real applications.
**Exit:** every existing UI interaction persists; impressions logging at volume.

Design and outcome: [PHASE2.md](./PHASE2.md). Three decisions there depart from this
document and are argued at length in it:

- **The server does not fill `viewer` per feed row.** §1.3(a) asks for the shared entity
  and the viewer's state to travel separately, and decorating every feed row is what makes
  a page per-viewer and uncacheable. `viewer_state()` returns the viewer's whole
  relationship graph as five arrays, once per session, and the client merges. §3.
- **Likes and follows have no table grants at all.** They are written only through
  `security definer` functions that set a state rather than flipping one, so `user_id`
  cannot be supplied and the outbox's replay cannot invert anything. §2.5, §4.1.
- **`job_impressions` has no foreign keys and no primary key.** §3.6's own sizing is ~3M
  rows/day; an FK check and a per-partition unique index are paid on every insert for
  properties nothing in a request path reads. One index, `(user_id, shown_at desc)`. §2.4.

Also deferred rather than built: `application_intents`, `auto_apply_run_id` on
`applications`, a `hide` / `not_interested` UI, and the join that would replace the
Following feed's slug filter.

### Phase 3 — Identity and social (3–4 weeks) — **built**
Verification (both paths), `comments`, likes, reports, blocks, strikes.
Moderation classifier in the write path. Internal review queue. `notifications`.
Realtime on threads.
**Exit:** verified users comment, moderation blocks the obvious, review queue staffed,
content policy published.

Design and outcome: [PHASE3.md](./PHASE3.md). The content policy itself is published at
[CONTENT-POLICY.md](./CONTENT-POLICY.md). Four decisions there depart from this document and
are argued at length in it:

- **The comment write path is the first route in the API service** — §10's classifier needs a
  secret — but every rule stays in SQL. `post_comment()` is `service_role`-only and enforces
  tier, strikes, rate, thread depth and policy acceptance itself, so a bug in the service can
  produce a wrongly *classified* comment and never an illegitimate one. §4.1.
- **The rate limit is Postgres, not Redis.** §10 specifies Redis. A partial index answers
  "10 in the last hour" in a millisecond and is transactional with the insert, which makes it
  exactly right rather than approximately right. The trigger for revisiting it is named. §4.2.
- **Realtime is a broadcast from the database, not `postgres_changes`.** A changefeed sends the
  row, and the row contains `author_id` — the one column this phase exists to withhold. A
  trigger sends the `comments_public` projection on a private per-posting topic instead. §3.2.
- **Comment counts do not ride on `job_card`.** A counter that changes every few seconds would
  make every feed page per-reader for a number nobody reads while scrolling, which is §1.3(a)'s
  actual point. They travel separately, like viewer state. `feed_jobs` is untouched. §3.1.

§1.3(b) is closed here, as phase 2 said it would be: `comments.like_count` is the true stored
total and the viewer's own like arrives in `viewer_state()`.

Also deferred rather than built: editing a comment, a blocked-accounts list so a block can be
undone from the UI, appeals as a flow, `moderation_actions` as a full audit log, and push
delivery for the notifications this phase writes.

### Phase 4 — Resumes and matching (2–3 weeks) — **built**
Storage bucket + RLS, upload, parse, `resume_profiles`, embeddings, `job_match_scores`,
`pii_access_log`. Parse-confirmation screen. Delete `utils/resumeMatch.ts`.
**Exit:** the match ring shows a real, explainable number.

Design and outcome: [PHASE4.md](./PHASE4.md). Four decisions there depart from this document and
are argued at length in it:

- **Embeddings are a column and an index with nothing in them.** This phase declines that part of
  the scope rather than deferring a detail of it. Nothing in phase 4 reads a vector — §3.10's own
  worked `components` names none — and the consumer is §5.2's ANN retrieval, which is phase 5.
  Filling the column means a second AI vendor chosen on behalf of something that does not exist
  yet, and it fixes a dimension that a different vendor would make wrong. PHASE1.md's promise
  ("phase 4 adds the column and the index") is kept in full. §3.
- **Every read of a resume goes through the API service**, which is the first read in four phases
  to break phase 1's decision B for neither a secret nor performance. §3.9 requires every access to
  be logged and a client that signs its own URL logs nothing, so the bucket grants the owner
  insert, update and delete and **no select**. An audit log with a hole in it where the app's own
  reads belong would answer "did anyone read this" with "no". §4.2.
- **Contact fields are sealed and never opened.** AES-256-GCM in the service, not
  `pgp_sym_encrypt` — a key passed as a SQL argument lands in `pg_stat_statements` and in the log
  on error, which is not "held outside the DB". Nothing in this phase decrypts them; phase 6 is
  the first reader. §4.3.
- **The confirmation screen confirms four fields, not the parse.** Skills, level, location and
  years — the ones the matcher reads. Showing somebody their own phone number back costs a
  decryption, an audit row and a plaintext P0 field on the wire to confirm a fact they already
  know. §4.4.

The scorer deliberately does **not** use §5.1's weights. That blend ranks a corpus, so recency and
affinity belong in it; this number answers "does my resume fit this job", which a posting's age has
nothing to do with. Three components, renormalized over whatever is answerable, with `coverage`
travelling alongside so a 90 on a third of the formula is distinguishable from a 90 on all of it.
§3.2.

Measured: `npm run verify:phase4` passes 68 checks. Three SQL bugs it caught that review had not are
recorded in PHASE4.md §7, along with the two things a local stack could not exercise.

### Phase 5 — Ranking (2–3 weeks)
Heuristic scorer, `feed_sessions`, Redis pool, diversity + exploration, tunable weights,
taste vectors, pgvector retrieval. A/B harness.
**Exit:** ranked feed beats recency on apply-rate, measurably.

### Phase 6 — Money and Auto Apply (3–4 weeks)
`credit_transactions` + grant/streak/spend/refund jobs. RevenueCat + entitlements.
`auto_apply_runs` + draft generation + review sheet.
**Exit:** a user subscribes, generates a draft, reviews it, applies, and the ledger balances.

### Phase 7 — News, notifications, polish (2–3 weeks)
`news_sources` + RSS ingestion + summarization + the link-out change from §9.
Push notifications (job alerts, deadlines, replies). Digest emails.
CCPA deletion and export jobs. Load testing.
**Exit:** launch-ready.

**~20–26 weeks.** The estimates assume the schema decisions in §3 hold; a change to §0
decision 1, 2, or 5 reshapes several phases.

---

## 16. Open questions and known risks

**Open — worth deciding before the phase that needs them:**

1. **Push notifications.** Not in the UI yet, but job alerts are the main re-engagement lever
   for a job-search app. Phase 7 or earlier? Expo Push vs a provider?
2. **GIF source.** [data/mockGifs.ts](../data/mockGifs.ts) ships bundled assets. Giphy/Tenor
   need API keys, content rating, attribution, and their own moderation surface. A curated
   bundled set is defensible and much cheaper — keep it?
3. **Employer accounts.** `claimed_by_org_id` is stubbed. Is the hybrid model still the
   eventual plan, or is the consumer app the whole product?
4. **International students at US schools.** `.edu` works. Non-US school domains don't.
   Is the ID path enough, or does `schools` need international coverage on day one?
5. **Salary estimation.** Show an inferred range, or show nothing? Affects perceived quality
   in both directions.
6. **Comment scope.** Per-posting today. Per-company threads would be far more active
   (a posting closes; a company doesn't) — but harder to moderate.

**Risks, most severe first:**

| Risk | Mitigation |
|---|---|
| An employer objects to being crawled | Strict hygiene (§4.3), fast takedown path, kill-switch per source, drive traffic to their ATS |
| Anonymous defamation of a named company | Pre-screen, 24h report SLA, notice-and-takedown, strikes tied to verification |
| Resume data breach | Encrypt P0, signed URLs only, audit every access, never store ID documents, minimize retention |
| ~~Workday coverage eats a quarter~~ — **did not happen** | Shipped on Greenhouse/Lever/Ashby first; Workday then turned out to be public per-tenant JSON, not an SPA. Residual cost is one detail request per posting per crawl (§4.2) |
| Auto Apply LLM cost outruns subscription revenue | Log `cost_usd` per run from run #1; entitlement quotas; price only after real data |
| Cold-start feed feels random | Onboarding preferences + school-cohort signal + a deliberately generous exploration rate |
| Stale postings destroy trust | Aggressive staleness detection; show `last_seen_at` as "verified 2h ago" |
| Impressions table swamps the DB | Partition monthly, batch writes, drop at 13 months, consider a warehouse by phase 6 |
| Solo-ish team, 26-week plan | Phases are independently shippable; cut phase 6 or 7 before cutting 1–3 |

---

## Appendix A — Client migration notes

The README claims `CareerDeckContext` is the only file that has to change. That's *nearly*
true, and the architecture deserves credit for it. The exceptions:

- **`useJobFeeds`** must become paginated and async. `forYouJobs: Job[]` becomes
  `{pages, fetchNextPage, isFetchingNextPage}`. `reels.tsx` and `HomeJobFeed` change.
- **`useSearch`** must become async and debounced. `SearchOverlay` needs a loading state.
- **`useComments`** must paginate per thread.
- **`utils/resumeMatch.ts`** is deleted; the score arrives on the job payload.
- Everything else — `useApplications`, `useWeeklyGoal`, `useStoryGroups`, `useNewsFeed`,
  and every component — keeps its current signature.

Recommended client stack: **TanStack Query** (server cache, optimistic mutations,
infinite queries) + **expo-sqlite** or MMKV for the offline outbox + the existing context,
slimmed to hold only session/viewer state. Keep the merge trick the context already
uses — shared entity + viewer state merged in a `useMemo` — because it's exactly the
right shape for the `{job, viewer}` wire format in §1.3.

Two client behaviors worth getting right early: **optimistic writes with rollback** on every
toggle (a like that flickers feels broken), and an **ordered outbox** so an offline
like-then-unlike doesn't replay out of order and leave the wrong final state.
