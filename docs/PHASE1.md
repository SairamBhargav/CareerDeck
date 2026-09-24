# Phase 1 — Jobs and ingestion

Companion to [README.md](./README.md) §15, which says what phase 1 is in five lines. This
is the design: every table, every module, every client file that changes, and the reasons
for each deviation from the plan.

**Written for:** whoever builds or reviews this phase, including someone who did not build
phase 0.

**Exit condition (from §15):** *10k+ real postings from 100+ companies, feed and search
work, dedup rate < 2%.*

---

## Decisions taken for this phase

Four questions were open when this document was first written. They are settled, and the
rest of the document reflects the answers rather than the alternatives.

| # | Question | Chosen | Consequence |
|---|---|---|---|
| A | Crawl live, or build against recorded payloads? | **Full live crawl, 120 boards** | The exit metrics are measured, not asserted. `verify:phase1` splits into deterministic offline pipeline checks and snapshot corpus checks. |
| B | Client reads jobs from the Hono service, or from Supabase? | **Supabase direct — SQL functions over RPC, RLS for authz** | No service in the local loop, no Fly deploy this phase, no second auth hop. `lib/api.ts` is the seam, so phase 5 changes one file's implementation rather than every hook. §7. |
| C | How is ingestion scheduled? | **CLI now, plus a committed GitHub Actions nightly** | $0. The workflow ships disabled-by-default on secrets you supply; the corpus stays fresh through phases 2–3 instead of rotting. §9. |
| D | Mock fixtures point at mock job ids that stop existing | **Activity goes empty until phase 2** | No deterministic-id repointing, no client-side mock job pool. Smaller diff, one source of truth for what a `Job` is. §8.6. |

Decision B is the load-bearing one. §11 of the plan specifies these reads as service
endpoints, and phase 5's ranker genuinely cannot live in Postgres alone. What makes
deferring safe is that phase 1's feed and search *are* clean SQL — recency ordering,
`ts_rank_cd`, trigram similarity — and that every screen calls `lib/api.ts` rather than
calling Supabase itself. When phase 5 needs a process, `lib/api.ts` starts issuing
`fetch` instead of `supabase.rpc` and no hook or component notices.

---

## 0. What phase 1 is, in one paragraph

Today the app renders 30 jobs from `data/mockJobs.ts`, sorts them in
[useJobFeeds.ts](../hooks/useJobFeeds.ts), and searches them by scanning every array on
every keystroke. Phase 1 replaces the fixture with a real corpus: a crawler that reads
three public ATS APIs, a landing table that keeps every payload it ever saw, a normalizer
that turns messy posting text into typed columns, a dedup rule that stops the same NVIDIA
internship appearing four times, a staleness sweep that closes postings nobody can apply
to any more, and a paginated feed + full-text search served from Postgres. The client
stops holding the corpus and starts paging through it.

Nothing about *who the user is* changes — that was phase 0. Nothing about *what the user
did* is persisted yet — that is phase 2. Likes, saves and follows stay in memory for one
more phase, deliberately (§9.4).

---

## 1. Scope

### In

| # | Deliverable | §  |
|---|---|---|
| 1 | `companies`, `job_sources`, `raw_postings`, `jobs`, plus `skills`, `job_dedup_review`, `crawl_runs` | 2 |
| 2 | RLS and grants: jobs and companies are world-readable, nobody but the service writes them | 3 |
| 3 | Greenhouse, Lever and Ashby source adapters behind one interface | 4 |
| 4 | Normalization: location, salary, employment type, seniority, skills, quality score | 5 |
| 5 | Dedup (`dedup_key`, multi-location fan-out, near-miss review queue) and staleness closure | 6 |
| 6 | Full-text job search and trigram company search, as SQL functions | 7 |
| 7 | `feed_jobs`, `search_jobs`, `search_companies`, `suggested_companies` as SQL functions, reached through `lib/api.ts` | 7 |
| 8 | Client: `useJobFeeds` becomes an infinite query, `useSearch` becomes debounced and async, `CareerDeckContext` stops owning the corpus | 8 |
| 9 | A curated board list (120+ companies) and an `npm run ingest` runner | 10 |
| 10 | `npm run verify:phase1`, in the shape of `verify-phase0` | 11 |

### Out, and where it goes instead

| Not in phase 1 | Where | Why not now |
|---|---|---|
| `job_interactions`, `company_follows`, `applications` | Phase 2 | The feed has to exist before there is anything to interact with. |
| `job_impressions` | Phase 2 | Same. |
| `jobs.embedding`, pgvector, HNSW index | Phase 4 | Adding a nullable column and an index later is a two-line migration; standing up an embedding budget now buys nothing the feed can use. See §2.6. |
| `job_match_scores`, the ranked feed of §5.1 | Phase 4–5 | Phase 1's feed is `order by posted_at desc` with the three sorts `FeedSortBar` already offers. The *shape* (cursor, envelope) is phase 5's, so phase 5 changes one SQL function. |
| Workday, SmartRecruiters, company career sites | Later, time-boxed | §4.2: "Workday is where a quarter disappears." |
| News, comments, resumes | Phases 3–7 | Untouched; they keep their fixtures. |
| Redis | Phase 5 | §2.1 puts Redis behind the candidate pool, which does not exist yet. A cache in front of a correct query is a correctness bug waiting to be written. |

---

## 2. Schema

One migration: `supabase/migrations/20260922000000_phase1_jobs.sql`. It follows §3's
conventions — `uuid` keys except on the append-only landing table, `updated_at` by
trigger (the `set_updated_at()` function phase 0 already created), `timestamptz`
throughout.

### 2.1 Extensions

```sql
create extension if not exists pg_trgm with schema extensions;
```

`pg_trgm` earns its place twice: company search has to tolerate "nvida", and near-miss
dedup (§6.2) needs a similarity measure before embeddings exist.

### 2.2 `companies`

Exactly §3.3, with `slug citext unique` carrying the current mock ids (`nvidia`,
`stripe`) so every deep link in `app/company/[id].tsx` keeps resolving, and
`domain citext unique` as the cross-crawler dedup key. Two crawlers will both find
NVIDIA — one at `boards.greenhouse.io/nvidia`, one at `jobs.lever.co/nvidia` — and the
registrable domain is the only identifier that collapses them. Name matching does not
(`Meta` / `Meta Platforms` / `Facebook`).

One addition to §3.3: `open_job_count integer not null default 0`, maintained by trigger.
The company card and `/v1/companies/suggested` both want it, and it is the difference
between a list of 12 companies costing 1 query and costing 13.

### 2.3 `job_sources`

Exactly §3.4. `unique (kind, board_url)`, `crawl_interval`, `etag`,
`consecutive_failures`, and `enabled` — which is also the takedown kill-switch §4.3
requires, paired with `notes` for the record of why.

### 2.4 `raw_postings`

Exactly §3.4, and the most important table in the phase. Immutable: insert only, never
update. `unique (source_id, external_id, content_hash)` is the entire re-crawl strategy —
an unchanged posting conflicts on insert and no downstream work fires. When the
normalizer has a bug (it will), the fix replays from here rather than re-crawling 300k
postings and annoying every ATS we touch.

`content_hash` is sha256 over a *canonical* serialization of the payload — keys sorted,
volatile fields stripped. Greenhouse stamps an `updated_at` on every response whether or
not anything changed; hashing it raw makes every crawl look like a change and defeats the
table's only purpose.

### 2.5 `jobs`

§3.4's table, minus `embedding` (§2.6), plus two columns:

- `dedup_group_id uuid not null default gen_random_uuid()` — §4.4's multi-location
  fan-out. "SF / NYC / Remote" becomes three rows so the location filter does not lie;
  they share a group id so the UI can say "also in 2 other locations" and so a later
  merge has something to merge on.
- `source_run_id uuid` — the `crawl_runs` row that last wrote this job. Makes "a bad
  deploy mangled 4,000 titles at 3am" a `where` clause instead of an investigation.

`search_vector` is the generated `tsvector` from §3.4 verbatim: title weighted `A`,
skills `B`, description `D`. Company name is *not* in it — it lives on another table and
a generated column cannot reach across a join. §7 handles company-name matching by
searching `companies` separately and unioning, which is also what makes
`SearchScopeTabs` work.

### 2.6 Deviation: no `embedding` column yet

§3.4 declares `embedding vector(1536)` and an HNSW index. Phase 1 omits both.

The column is only read by two things: phase 4's match score and §3.4's near-miss dedup.
The first is two phases away. The second needs *a* similarity measure, not specifically a
vector one, and `similarity(title_normalized, ...)` under `pg_trgm` is a better near-miss
signal for job titles than cosine distance on a 1536-dim embedding anyway — job titles are
short, and trigrams are unreasonably good at short strings.

Adding it later is `alter table jobs add column embedding vector(1536)` plus an index
build, both non-blocking with `concurrently`. Standing up pgvector now means an embedding
API key, a cost line, and a backfill job for a column nothing reads.

**This is a documented deviation, not an oversight.** §5.2 and phase 4 should expect to
add it.

### 2.7 `skills`

§3's convention says lookup table, not enum, for sets that grow. §4.4 says why it must be
a *dictionary* and not free-form LLM output: free-form gives you `React`, `ReactJS`,
`React.js` and `react` as four skills and the filters quietly stop working.

```sql
create table skills (
  id       uuid primary key default gen_random_uuid(),
  slug     citext unique not null,     -- 'react'
  label    text not null,              -- 'React'
  aliases  citext[] not null default '{}',  -- {'reactjs','react.js','react native'}
  category text,                       -- 'language' | 'framework' | 'tool' | 'domain'
  created_at timestamptz not null default now()
);
```

`jobs.skills text[]` stays denormalized for card rendering (§3.4 says so) and holds
`label`, never the raw string from the posting. The dictionary is the only thing that
decides what a skill is called.

### 2.8 `job_dedup_review`

§3.4: "Don't auto-merge on fuzzy signals; a wrong merge silently deletes a real job and
nobody notices." Near-misses land here with both job ids, the similarity score and the
signal that fired, and a `resolution` of `pending` / `merged` / `distinct`. Nothing in
phase 1 has a UI for it; the rows are the point, and `verify:phase1` asserts the queue is
not growing faster than the corpus.

That assertion earned its keep immediately. The first run filled the queue with 2,217
pairs, and none of them were near-misses: once seniority joined the dedup key (§5.1), an
intern posting and a senior posting with an *identical* normalized title live side by side
on purpose — and the detector flagged every one of them at similarity 1.0. The detector
now matches on seniority too, which makes similarity 1.0 unreachable: an identical title at
the same company, city and seniority would have collided on the key and never reached the
check. A queue that reports the key working as if it were failing is worse than no queue.

### 2.9 `crawl_runs`

Not in §3, added here. §14 wants observability and §4.3 wants "disable a source after N
consecutive failures and alert" — both need a record of what each run did.

```sql
create table crawl_runs (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references job_sources(id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',   -- running|success|failed|skipped
  http_status smallint,
  postings_seen integer not null default 0,
  raw_inserted integer not null default 0,  -- how many actually changed
  jobs_created integer not null default 0,
  jobs_updated integer not null default 0,
  jobs_closed integer not null default 0,
  duplicates integer not null default 0,    -- the dedup-rate numerator
  error text
);
```

`raw_inserted` vs `postings_seen` is the cheapest health metric in the system: when a
source's ratio jumps to 1.0 overnight, the ATS changed a volatile field and the
`content_hash` canonicalization needs a fix.

### 2.10 Authorization

Jobs and companies are public content. The grant is the narrowest thing that is true:

```sql
grant select on public.companies, public.jobs, public.skills to anon, authenticated;
-- read policies: companies.is_active, jobs.status = 'open'
-- no insert/update/delete grant to anyone but service_role
```

`raw_postings`, `job_sources`, `crawl_runs` and `job_dedup_review` get **no grant at
all** — they are operational tables and a `select` on `raw_postings` is a select on every
payload we ever fetched. RLS is enabled on all of them anyway, so a future accidental
grant still lands on a deny-by-default table.

`jobs` RLS filters `status = 'open'`, which means a closed posting 404s rather than
rendering as a dead apply button. The API service reads through the service role and so
can still resolve a closed job for a tracked application in phase 2.

---

## 3. Ingestion

### 3.1 Shape

§4.1, as discrete steps with their own retries:

```
tick (per job_source.crawl_interval)
  → fetch        conditional GET (ETag / If-Modified-Since), per-host concurrency cap
  → land         insert raw_postings; unchanged payloads conflict and stop here
  → normalize    title, location, salary, employment type, seniority
  → enrich       skill extraction, quality score
  → reconcile    upsert jobs by dedup_key; fan out multi-location
  → sweep        (nightly, separate) close postings no longer seen
```

Each step is a pure function over the previous step's output, with exactly one impure
edge: `fetch` and the two writes. That is what makes the normalizer testable against
recorded payloads and replayable over `raw_postings`.

### 3.2 Module layout

```
server/src/ingest/
  sources/
    types.ts        SourceAdapter — the one interface all three implement
    greenhouse.ts   boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true
    lever.ts        api.lever.co/v0/postings/{company}?mode=json
    ashby.ts        jobs.ashbyhq.com/api/non-user-graphql (public board query)
    index.ts        kind → adapter
  normalize/
    location.ts     "SF / NYC / Remote" → [{city, region, country, type}]
    salary.ts       "$120,000 - $150,000", "$58/hr", "120k-150k", compliance paragraphs
    seniority.ts    intern | new_grad | mid | senior | staff+  (title-first)
    employment.ts   Internship | Full-time | Part-time | Contract
    skills.ts       dictionary match against the skills table
    quality.ts      0..1 junk score
    html.ts         ATS description HTML → text, safely
  pipeline.ts       fetch → land → normalize → reconcile, per source
  dedup.ts          dedup_key, exact-hit merge, near-miss queueing
  staleness.ts      the nightly sweep
  http.ts           conditional GET, backoff, UA, per-host limiter
  run.ts            CLI entry: `npm run ingest -- [--source=slug] [--all] [--dry-run]`
```

### 3.3 The adapter interface

```ts
export interface SourceAdapter {
  kind: AtsKind;
  /** Where to fetch. Pure — takes the source row, returns a request. */
  request(source: JobSource): { url: string; headers: Record<string, string> };
  /** Split a board response into per-posting payloads with their ATS id. */
  extract(body: unknown): RawPosting[];
  /** One posting payload → the fields the normalizer works from. */
  parse(posting: RawPosting): ParsedPosting;
}
```

Three small, dumb adapters and one shared pipeline, rather than three pipelines. When
SmartRecruiters or Workday arrive they implement this and touch nothing else — which is
the actual test of whether the abstraction is right.

### 3.4 Crawl hygiene — §4.3, as code

| Rule | Where it lives |
|---|---|
| Identify in `User-Agent` with a contact URL | `http.ts`, one constant, no way to bypass |
| Conditional GET, store the `ETag` | `http.ts` + `job_sources.etag` |
| Per-host concurrency cap and a minimum gap between requests | `http.ts` limiter, keyed on hostname |
| Exponential backoff on 429/5xx, honour `Retry-After` | `http.ts` |
| Disable after N consecutive failures | `pipeline.ts` → `consecutive_failures`, `enabled = false` at 5 |
| Public unauthenticated endpoints only | No credential exists in `server/src/ingest` — there is nothing to log in with |
| Store the ATS's own apply URL | `jobs.apply_url`, never rewritten |
| Takedown path | `job_sources.enabled = false` + `notes`, one SQL statement, documented in SETUP |

The one rule that is a judgement call: **robots.txt.** Greenhouse, Lever and Ashby board
APIs are documented public JSON endpoints intended for exactly this, and none of them
disallow their board API paths. The fetcher still reads and caches `robots.txt` per host
and refuses a disallowed path, because the rule that only applies when convenient is not
a rule, and because source #4 will be a company career site where it genuinely bites.

---

## 4. Normalization

The part that decides whether the corpus is usable. Each rule below is a pure function
with a table of cases in its test fixture.

### 4.1 Location — §4.4

~40% of postings have a messy location string. The parser handles, in order:

1. **Split** on `/`, `;`, `|`, ` or `, and ` and ` when both sides look like places.
2. **Remote detection** — `Remote`, `Remote - US`, `Anywhere`, `Distributed`,
   `Work from home`. A remote posting with a city (`Remote - San Francisco`) keeps the
   city as a hint and sets `location_type = 'Remote'`; the city is where the team is, not
   where you must be.
3. **Hybrid detection** — `Hybrid`, `X days in office`, `in-office N days`.
4. **City/region/country** — `"Austin, TX"` → city `Austin`, region `TX`, country `US`.
   A gazetteer of ~400 US metros plus the obvious international ones; an unmatched string
   keeps `location_raw` and leaves the structured columns null rather than guessing.
5. **`Multiple Locations` / `Various`** — one row, `location_city` null. Not fanned out;
   fanning out a posting into unknown cities is worse than not filtering it.

Multi-location postings fan out into one `jobs` row per location sharing a
`dedup_group_id`. **Cap at 6.** A posting listing 40 offices is a req, not 40 jobs, and 40
cards from one employer destroys the feed.

### 4.2 Salary — §4.4

Parsed from structured ATS fields first (Greenhouse and Ashby often provide them), then
from the description, in this order:

| Pattern | Reads as |
|---|---|
| `$120,000 - $150,000` / `$120,000–$150,000` | year, 120000–150000 |
| `120k - 150k` / `$120K–$150K` | year |
| `$58/hr`, `$58 per hour`, `$58 - $62 hourly` | hour |
| `$4,500/month` | converted to year ×12, `salary_is_estimated = false` (it was stated) |
| A single figure (`$140,000`) | min = max |

The compliance paragraph at the bottom of the description ("The base pay range for this
position is…") is the highest-yield source in US postings and is matched explicitly.

**Sanity bounds** reject the parse rather than store nonsense: annual outside
$15k–$1.2M, hourly outside $10–$400, or `min > max`. A posting that says "$500,000,000 in
funding" in its intro must not become a salary.

**`salary_is_estimated` stays `false` for every row in phase 1.** Nothing infers a
salary. §16 open question 5 ("show an inferred range or nothing?") is unresolved, and
shipping an inference before that is decided is how a guess ends up looking like a
disclosure — several US states require *posted* ranges and the line between "the employer
said this" and "we guessed" is not one to blur. The column exists so the day it is
decided, the UI already has somewhere to read the answer.

### 4.3 Seniority — §4.4

*"The single highest-leverage field for your audience — a student should essentially never
see a Staff Engineer role, and title text alone handles that better than any model."*

Title first, description only as a tie-break:

| Bucket | Title signals |
|---|---|
| `intern` | intern, internship, co-op, coop, summer 20xx, industrial placement |
| `new_grad` | new grad, new graduate, university grad, campus, entry level, associate (eng), I / 1 suffix |
| `mid` | II, III, engineer with no modifier, 2–5 years in the description |
| `senior` | senior, sr., lead, II+ with senior wording |
| `staff_plus` | staff, principal, distinguished, fellow, director, VP, head of |

`staff_plus` is not in §3.4's list of four; it is added because the whole point of the
field is filtering *out*, and lumping a VP of Engineering into `senior` wastes the signal.

Seniority also feeds quality: a `staff_plus` posting is not junk, it is just not for this
audience, so it scores normally and gets filtered at read time — never suppressed at
write time. A student who searches "staff engineer" should find one.

### 4.4 Skills

Dictionary match against `skills.label` + `skills.aliases`, tokenized, over title +
requirements + description. Matches emit `skills.label`, so the posting that says
`react.js` and the one that says `ReactJS` both land as `React`.

Seeded with ~156 entries covering languages, frameworks, infra, data, and the domain terms
this audience filters on. It grows; that is why it is a table.

**Two corrections the first crawl forced**, both of them the dictionary working exactly as
written and producing wrong answers:

- **The slug is not a search term.** Several slugs are truncations of their label —
  `embedded` for "Embedded Systems", `performance` for "Performance Optimization". Indexing
  them tagged every fintech posting that said "embedded finance" as embedded-systems work.
  Slugs are identifiers now; the label and the aliases are the vocabulary, and a short form
  that people genuinely write (`sre`, `oop`, `cpp`) is listed as an alias.
- **Ambiguous single words are title-and-requirements only.** A Ramp sales posting came
  back tagged `Go`, `Excel` and `.NET` from "go to market", "excel at outreach" and "net
  new revenue". Dropping those skills is not an option — students filter on Go and Rust —
  so they match where a word is overwhelmingly the technology and never in free prose.

### 4.5 Quality score — §3.4

*"Set at ingest and is the junk filter… score them low once at write time rather than
filtering them on every feed read."*

Starts at 0.5, bounded to [0, 1]:

| Signal | Δ |
|---|---|
| Description under 400 characters | −0.25 |
| Description under 150 characters | −0.20 further |
| Title matches staffing/agency patterns (`W2 only`, `Corp to Corp`, `C2C`, `Multiple positions`) | −0.30 |
| ALL CAPS title, or 3+ of `!$*` | −0.20 |
| "Work from home" + no company domain | −0.25 |
| Structured salary present | +0.10 |
| 3+ skills extracted | +0.10 |
| Requirements list parsed out | +0.05 |
| Company has 3+ other open postings (a real board, not a one-off) | +0.10 |

§5.1's candidate filter is `quality_score > 0.3`; phase 1's feed uses the same threshold
so the number is exercised and tuned before ranking depends on it.

---

## 5. Dedup and staleness

### 5.1 The key

`dedup_key = sha256(company_id || title_normalized || city-or-star || seniority-or-star)`,
with a **partial unique index where `status = 'open'`**. Only one open posting per key;
closed history is allowed to hold duplicates, because it is history.

`title_normalized` is lowercased, punctuation-stripped, seniority-stripped, and has
requisition noise removed (`(Req 12345)`, `| Remote`). Getting this wrong in either
direction is the whole game: too aggressive and two genuinely different roles collapse;
too loose and the dedup rate never gets under 2%.

**Two deviations from §3.4, both argued by the first full crawl rather than in advance.**

§3.4's key is company + title + city. On that key, Anduril's 2,356 postings produced
1,833 stored requisitions: **523 real jobs disappeared**. The titles say why —
"2026 Early Career Manufacturing Engineer", "Senior Manufacturing Engineer" and
"Winter 2027 Manufacturing Engineer Co-op" all normalize to `manufacturing engineer` in
the same city. §5.1 of the plan names this exact failure: *"too aggressive and two
genuinely different roles collapse."*

1. **Seniority joined the key.** It is stripped out of `title_normalized` deliberately,
   because it belongs in its own column — so putting it back into the key is not
   redundancy, it is restoring a distinction the normalizer moved rather than discarded.
2. **Years stay in `title_normalized`.** A 2026 cohort and a 2027 cohort are two
   requisitions, and stripping the year merged them. Requisition *numbers* are still
   removed; a year is signal and a req id is not.

### 5.2 On collision

1. **Exact `dedup_key` hit** → update `last_seen_at`, refresh mutable fields, and keep the
   better `apply_url` — the ATS's own URL beats an aggregator redirect. No new row. The
   run counts a `duplicate`.
2. **Near-miss** — same company, `similarity(title_normalized, other) > 0.85`, same city
   → insert into `job_dedup_review` and **create the row anyway**. A wrong auto-merge
   deletes a real job silently; a wrong non-merge shows a duplicate, which someone
   notices and which the queue is there to fix.

### 5.3 Measuring it honestly

§15's exit metric is "dedup rate < 2%". The first crawl reported 33%, which turned out to
be three separate problems wearing one number.

**The denominator.** A posting that fans out to four cities makes four independent
reconcile attempts, so the rate is over *attempts*, not over postings. Measuring against
postings made a 3-to-1 fan-out look like a 300% collision rate.

**Our own fan-out colliding with itself.** Two locations from one posting that resolve to
the same city — or to no city, which "Remote" and an unrecognised string both do — are the
same row by construction. The normalizer now collapses them before they are sent, which
removed every "collision" the pipeline was creating itself.

**Two different phenomena, counted apart.** What remained splits cleanly:

| Outcome | What it means | Counted as |
|---|---|---|
| `duplicate` | The same job reached by **two different sources** | The §15 metric |
| `collapsed` | **One employer**, one role, several requisition ids | Reported separately |

`collapsed` is the dedup key working on the employer's data, not two crawlers tripping
over each other. Brex posts "Credit Card Counsel" three times; Anduril posts one role per
region. Folding that into the dedup rate makes a working key look broken, and would push
someone to loosen the key until real duplicates start reaching the feed — the opposite of
what the metric exists to prevent.

Only `duplicate` is measured against the 2% target. With one source per company it is
near zero by construction, and it becomes a real number the moment a second source is
attached to a company that already has one — which is exactly the risk §3.4 raises.

### 5.3 Staleness — §3.4

*"A crawler that stops seeing a posting is the only closure signal you get."*

Nightly: `status = 'closed'` for any `open` job whose source succeeded within the last 24h
and whose `last_seen_at` is older than 48h. **Guarded on the source having actually
succeeded** — without that guard one failing crawler closes a company's entire board, and
the user-visible symptom is an employer vanishing from the app overnight.

A source with `consecutive_failures > 0` is skipped by the sweep entirely. `closes_at` in
the past is a separate, unguarded closure: the employer told us.

`last_seen_at` is surfaced to the client so the card can say "verified 2h ago" — §16 lists
stale postings as a trust risk, and showing the freshness is most of the mitigation.

---

## 6. Search

Two functions, because §1.2 says search moves to the server and `SearchScopeTabs` already
splits jobs from companies.

```sql
search_jobs(q text, lim int, off int) returns setof job_search_result
search_companies(q text, lim int) returns setof company_search_result
```

**Jobs** — `websearch_to_tsquery('english', q)` against the generated `search_vector`,
ranked by:

```
0.60 · ts_rank_cd(search_vector, query)
0.20 · exp(-age_days / 14)
0.20 · quality_score
```

with a prefix fallback: a query of 2–3 characters produces a `tsquery` that matches almost
nothing useful, so short queries route to `title_normalized ILIKE q || '%'` instead. This
preserves the behaviour `useSearch` has today, where a prefix match on the title beats a
match buried in a skills list.

**Companies** — `similarity(name, q)` under a `gin_trgm_ops` index, plus an exact-prefix
boost and `open_job_count` as the tie-break. A company with no open jobs sorts last; it is
still a valid result (the user may want to follow it) but it is not the answer to a job
search.

`MIN_QUERY_LENGTH = 2` from [useSearch.ts](../hooks/useSearch.ts) stays, enforced on both
sides. The client debounces 250ms per §11.

---

## 7. Data access

Per decision B, phase 1's reads go to Postgres through the Supabase client: SQL functions
over RPC where there is ranking or a cursor to express, plain PostgREST selects where a
row lookup is genuinely just a row lookup. §11's URLs are not implemented this phase; what
is implemented is the *contract* behind them, in `lib/api.ts`.

| `lib/api.ts` call | Implementation | Replaces | §11 endpoint it becomes |
|---|---|---|---|
| `fetchFeed({surface, sort, companySlugs, cursor})` | `rpc('feed_jobs', …)` | `useJobFeeds`, `useSortedJobs` | `GET /v1/feed` |
| `fetchJob(id)` | `from('jobs').select(…, company:companies(*))` | `useJobById` | `GET /v1/jobs/:id` |
| `fetchJobsByIds(ids)` | same, `.in('id', ids)`, ≤ 50 | — | `GET /v1/jobs?ids=` |
| `fetchCompany(slug)` | `from('companies').select().eq('slug', …)` | `app/company/[id].tsx` | `GET /v1/companies/:slug` |
| `fetchCompanyJobs(slug, cursor)` | `rpc('feed_jobs', {company_slugs:[slug]})` | `useCompanyJobs` | `GET /v1/companies/:slug/jobs` |
| `fetchSuggestedCompanies()` | `rpc('suggested_companies')` | `suggestedCompanyIds` | `GET /v1/companies/suggested` |
| `fetchCompanyDirectory()` | `from('companies').select()` ordered, capped | `companies` on the context | — (§8.7) |
| `searchJobs(q)` / `searchCompanies(q)` | `rpc('search_jobs')` / `rpc('search_companies')` | `useSearch` | `GET /v1/search` |

`feed_jobs` serves four surfaces — Home, Reels, Following and a company's openings —
because they differ only in their filter and their sort. One function, one cursor
implementation, one place for phase 5's scorer to land.

**What the service keeps.** `server/` is not idle: the entire ingestion pipeline lives
there and runs under the service role, which is exactly the work §2.1 says belongs off
the client. What it does not get this phase is a read route the app depends on.

### 7.1 The envelope — §1.3(a)

Every job `lib/api.ts` hands back is wrapped:

```ts
{ job:    { id, title, company: { slug: 'nvidia', … } },   // shared, cacheable
  viewer: { liked: false, saved: false, applied: false, matchScore: null } }
```

Postgres returns the `job` half. `lib/api.ts` attaches a default `viewer`, and the feed
hooks overlay the client's in-memory sets onto it — the same merge
`CareerDeckContext` does today in its `useMemo`. In phase 2 the `viewer` half starts
arriving from the database and the overlay is deleted; no component changes, because no
component ever saw anything but a merged `Job`.

§1.3 names embedding per-user state in shared entities as the modelling problem worth
fixing before it costs a migration. This is that fix, one phase early, for the price of
four literals.

### 7.2 Pagination

Keyset, never offset. The cursor is a base64 `{ sortValue, id }` — the value of whatever
column the surface sorts by plus the primary key as a tiebreak. Offset pagination over a
table that gains 5,000 rows a night shows the user the same job twice and skips another;
keyset does not.

`sort=salary` sorts on a computed annualized figure (hourly × 2080, exactly
`payFloor()` in [useJobFeeds.ts](../hooks/useJobFeeds.ts)), so the client's current
semantics survive the move to SQL. That expression becomes a stored generated column,
`salary_annual_max`, so it can be indexed — sorting 300k rows on an expression is not a
plan, it is a sequential scan.

### 7.3 `following` and the `companySlugs` shim

Follows are phase 2. Until `company_follows` exists the client passes the slugs it holds
in memory: `feed_jobs(p_company_slugs => ['nvidia','stripe'])`, capped at 200. Phase 2
drops the argument and reads the join instead. Written down here so it does not become
folklore — though the parameter is genuinely useful for filtered browse and may well
survive.

### 7.4 What this costs when phase 5 arrives

Being honest about the trade decision B makes. §5.1's ranker needs things Postgres alone
cannot do well: a Redis candidate pool, `feed_sessions` for session-stable pagination,
and the A/B harness that runs two rankers against each other. Those need a process.

What makes the deferral cheap rather than free:

- **Cheap:** `feed_jobs` is one function with one caller (`lib/api.ts`). Phase 5 replaces
  that function's body with a `fetch` to `/v1/feed` and changes nothing else. The cursor
  is already opaque, the envelope is already `{job, viewer}`, the hooks are already
  infinite queries.
- **Not free:** the SQL function's filter and sort logic gets written twice — once here,
  once in the service. It is perhaps 80 lines, and the second writing has the first as a
  spec plus real query plans to tune against, which is not the worst way to arrive at it.
- **The security note worth keeping:** going direct means RLS is enforcing authz, not a
  handler remembering to scope its query. The service role bypasses RLS entirely, so
  every service-side read is one forgotten `.eq()` from a leak. Phase 2's writes will
  need the service anyway — that is the moment to re-read this section.

---

## 8. Client migration

Appendix A predicted the exceptions to "only `CareerDeckContext` changes". They are
exactly right, and they are this phase's client work.

### 8.1 New: `lib/api.ts`

The seam. Every read in §7, as a typed async function returning domain types — `Job`,
`Company`, `{job, viewer}` — with the row→domain mapping in one place. It is the only
file in the client that knows how jobs are fetched, which is the entire point: decision
B is reversible for the cost of rewriting this one file.

### 8.2 `useJobFeeds` → infinite queries

`forYouJobs: Job[]` becomes `useInfiniteQuery`. The hook keeps its name and grows
`{ jobs, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading }`. Viewer state is
merged in the hook's `select`, using the same merge `CareerDeckContext` does today, so
`JobFeedCard` and `JobReelCard` do not change at all.

`useJobById` becomes a query with the feed cache as its initial data — opening a job you
just scrolled past must not show a spinner.

`useCompanyJobs` becomes an infinite query against `/v1/companies/:slug/jobs`.

`sortJobs` / `payFloor` are deleted from the client. The server sorts.

### 8.3 `useSearch` → debounced and async

250ms debounce, `keepPreviousData` so the list does not blank between keystrokes, and
`SearchOverlay` gains a loading state. `MIN_QUERY_LENGTH` and the `isActive` contract stay
so the overlay's recents behaviour is untouched.

### 8.4 `CareerDeckContext`

Stops owning `jobs` and `companies`. Keeps `likedIds` / `savedIds` / `followedIds` as
in-memory sets for one more phase, and exposes them so the feed hooks can merge them into
the `viewer` envelope. Everything else in the file is untouched.

The `jobs` and `companies` arrays are removed from the context value. Every consumer is
migrated to a hook. This is the largest mechanical change in the phase and the one most
likely to produce a missed call site, so §11 checks it with a typecheck gate, not by eye.

### 8.5 `HomeJobFeed` and Reels

`HomeJobFeed`'s comment already names its own limit: *"Not virtualized… that's fine at
the current fixture size but is the thing to revisit when the job list stops being a local
constant."* It stops being a local constant in this phase. Home's feed becomes a
`FlatList` with the header content as `ListHeaderComponent`, so there is one scroll
container rather than a list nested in a `ScrollView`.

`reels.tsx` gains `onEndReached` → `fetchNextPage`, with a prefetch margin of ~5 cards.

### 8.6 Applications and comments — deliberately empty (decision D)

`mockApplications` and `mockComments` reference mock job ids
(`job-nvidia-swe-intern`). Real postings have generated UUIDs, so those references
resolve to nothing.

`useTrackedApplications` already handles this correctly — its comment says *"applications
whose job has fallen out of the feed are dropped rather than rendered as an empty card"* —
so the Activity tab, the pipeline counters and the weekly goal ring read zero until phase
2 gives them a real `applications` table. A comment thread on a real posting is likewise
empty until phase 3 gives it a real `comments` table.

This is the accepted outcome, not a regression. The alternative — seeding the fixtures
with deterministic ids and repointing them — keeps two definitions of what a `Job` is
alive for another phase, which is the exact thing this phase exists to eliminate.

One change is still required: `useTrackedApplications` takes `jobs` off the context, so it
resolves its handful of job ids through `fetchJobsByIds` instead. That is the shape phase
2 needs anyway, and it means the tab is empty because there are no applications, not
because the join silently failed.

### 8.7 The company directory shim

Several screens need *a* company lookup without knowing which companies they will need:
`useStoryGroups` maps mock news `companyId`s to rings, `SearchOverlay` colours result
rows, `collection/following` lists followed companies from an in-memory id set.

Rather than thread a fetch through each, `useCompanyDirectory()` is a single cached query
returning the top ~200 companies by open-role count, keyed by slug. Companies are a few
hundred rows of small, shared, public data with no per-user component — the one place in
this phase where holding a client-side collection is still the right answer.

It is a shim in exactly one respect: once follows are persisted (phase 2) the followed
list comes from a join and stops needing the directory to resolve itself.

---

## 9. Seeds, board list, and running it

| Command | Does |
|---|---|
| `npm run seed:generate` | Extended: schools (phase 0) + skills dictionary + mock companies + mock jobs + the curated `job_sources` list |
| `npm run ingest -- --all` | Crawls every enabled source that is due |
| `npm run ingest -- --source=nvidia --dry-run` | One source, parses and prints, writes nothing |
| `npm run ingest:sweep` | The staleness pass |
| `npm run verify:phase1` | §11 |

The curated list is 124 Greenhouse / Lever / Ashby boards chosen for this audience:
companies that actually run internship and new-grad programs. It is a seeded table, not a
constant, so adding a company is an insert and removing one (takedown) is an update.

**Every token in it has answered.** The first pass listed 141 guessed tokens and 66 of them
404ed — companies that had moved to Workday, renamed their board, or never used the name
guessed for them. Guessing again would have been the same mistake twice, so the
replacements were probed against their board APIs first and are listed only because they
returned postings. The header of `scripts/board-list.ts` says this is how the file is
maintained; that is not aspirational, it is how it was built.

Notably absent are the household names that run Workday — NVIDIA, Apple, Amazon, Boeing,
Lockheed. They exist as `companies` rows seeded from the fixtures, with a logo and a brand
colour and no source attached, exactly as §4.2 intends.

**Scheduling (decision C).** The runner is the CLI, plus a committed GitHub Actions
workflow — `.github/workflows/ingest.yml` — that runs the crawl and the sweep nightly
against a hosted Supabase project.

It is committed but inert until you set two repository secrets (`SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`); with them missing the job exits early with a clear message
rather than failing red every night. The service-role key bypasses RLS on every table, so
putting it in a GitHub secret is a real decision and the workflow says so in its header.

Why nightly and not §4.1's per-source `crawl_interval`: at ~5 minutes a run, nightly costs
roughly 150 of a private repo's 2,000 free Actions minutes per month, and four-hourly
would cost 600. Nightly is enough to keep apply buttons alive through phases 2–3, which is
the actual reason to schedule anything before there are users. `crawl_interval` is still
honoured *within* a run — a source not yet due is skipped — so tightening the cadence
later is one line of cron.

§2's architecture puts this on Inngest. The pipeline is plain functions behind `run.ts`
specifically so Inngest, a Fly cron or Actions are interchangeable wrappers; Inngest's
free tier (~50k steps/month) would be exceeded by 120 sources × 4 runs/day × ~6 durable
steps, and ~$20/month is not worth paying before there is a user waiting on a posting.

---

## 10. Verification — `npm run verify:phase1`

Same shape as `verify-phase0.mjs`: drives the real local stack, prints PASS/FAIL, exits
non-zero. It checks the exit condition and the things that must be impossible.

**Schema and authz**
- `companies`, `jobs`, `skills` are readable by an authenticated client
- `raw_postings`, `job_sources`, `crawl_runs`, `job_dedup_review` are **not** readable
- a client cannot insert, update or delete a job or a company
- a `closed` job is invisible to a client and resolvable by the service

**Pipeline** (against recorded fixture payloads, no network)
- each adapter parses its fixture board into the expected posting count
- re-landing an identical payload inserts zero `raw_postings` rows
- a changed payload lands and updates the job
- the normalizer's case table: 30+ location strings, 20+ salary strings, seniority,
  employment type, skills
- multi-location fan-out produces N rows with one `dedup_group_id`, capped at 6
- a second posting with the same key updates `last_seen_at` and creates no row
- a near-miss queues a review row and *does* create the job
- the sweep closes a 72h-unseen job, and does **not** close anything when the source
  failed

**Feed and search**
- page 1 + page 2 of each surface contain no repeated ids and no gaps
- the three sorts are actually ordered
- salary sort annualizes hourly rates (an internship at $60/hr outranks a $90k salary)
- a known title is findable; a two-character prefix returns the prefix match
- company search tolerates one transposed character
- the `viewer` envelope is present and correctly shaped
- `quality_score <= 0.3` rows are absent from the feed and present in search

**Exit metrics**, against whatever the local corpus is:
- jobs from ≥ 100 distinct companies
- ≥ 10,000 open jobs
- dedup rate < 2% over the last run window

The last three fail on a freshly-seeded database and pass after `npm run ingest -- --all`,
which is the honest reading of the exit condition: the pipeline is verified any time, the
corpus claim is verified once it has run.

---

## 11. What the build order produced

Steps 1–9 were server-side and independently testable; step 10 was the only one that could
break the app, and it ran after everything it depends on was proven. Removing `jobs` and
`companies` from the context type turned every stale call site into a compile error, which
is how the client migration was found rather than looked for.

**Measured on the local corpus:**

| Exit metric (§15) | Target | Actual |
|---|---|---|
| Real postings | 10,000+ | **30,800+** |
| Companies with open roles | 100+ | **140** |
| Cross-source dedup rate | < 2% | **0.00%** (1 of 34,574 reconcile attempts) |
| Feed and search | work | 130+ checks in `verify:phase1` |

Also true of that run: 124 of 124 sources succeeded, a full crawl took **100 seconds**, and
a second crawl immediately after did nothing at all — every board answered `304 Not
Modified` against its stored ETag.

Separately reported, because it is not the same phenomenon (§5.3): **10.97%** of reconcile
attempts were employer re-posts collapsed by the dedup key. Brex posts "Credit Card
Counsel" under three requisition ids; Anduril posts one role per region. That is their
data, and absorbing it is what the key is for.

### What the live crawl found that fixtures could not

Every one of these was the code working exactly as specified and producing a wrong answer.
None would have surfaced against recorded payloads, because a fixture only contains the
cases someone thought of.

| Found | Fix |
|---|---|
| 66 of 141 guessed board tokens 404ed | Probe first, list only what answers (§9) |
| Anduril lost 523 of 2,356 requisitions to the dedup key | Seniority in the key, years kept in the title (§5.1) |
| A sales posting tagged `Go`, `Excel`, `.NET` from "go to market", "excel at outreach", "net new revenue" | Ambiguous single words match in the title and requirements only (§4.4) |
| Every Ramp posting tagged "Embedded Systems" from "embedded finance" | Slugs are identifiers, not search terms (§4.4) |
| `Seattle, San Francisco, New York City` became one city with that name | Comma splitting that rejoins state and country qualifiers (§4.1) |
| `SF NYC SEA CHI` became a city called "Sf Nyc Sea Chi" | Metro-code runs split on a known-abbreviation table (§4.1) |
| `San Francisco / New York` lost New York — it parsed as the *state* | A short list of state names that mean the city (§4.1) |
| Two Ashby boards failed with "URI too long" | 80 ids per `in` filter, not 300 — Ashby's are uuids |
| Two failures logged as `[object Object]` | A PostgrestError is not an `Error`; stringify it properly |
| The near-miss queue filled with 2,217 non-misses | Match seniority there too (§2.8) |

---

## 12. Risks specific to this phase

Two of these fired during the build, which is the point of writing them down.

| Risk | Mitigation |
|---|---|
| **`title_normalized` too aggressive → distinct roles collapse** — *this happened: 523 Anduril requisitions* | Seniority in the key, years kept; the case table in `verify:phase1` is now the spec |
| **Local dev needs a crawler to show anything** — *avoided* | 53 fixture postings are seeded as real rows; the app is fully usable after `db:reset` alone |
| An ATS changes a volatile field → every crawl looks like a change | `content_hash` over a canonicalized payload; `raw_inserted / postings_seen` is the alarm |
| One failing crawler closes an employer's whole board | Sweep is guarded on source success and skips sources with failures |
| The corpus is 10k jobs of which 6k are junk | `quality_score` at ingest, `> 0.3` filter, tuned in step 11 against real data |
| The client migration misses a `useCareerDeck().jobs` call site | Removing the field from the context type makes every one a compile error |
| An employer objects | `job_sources.enabled = false` + note; one statement, documented in SETUP.md, and a re-seed never re-enables it |

---

## 13. Deferred decisions this phase records rather than makes

- **`jobs.embedding`** — phase 4 (§2.6).
- **Salary estimation** — §16 q5 stays open; `salary_is_estimated` is always false until
  it is answered (§4.2).
- **Inngest** — deferred, not rejected. Actions is the nightly runner until the per-source
  retry visibility is worth $20/month (§9).
- **The read path moving to the service** — decision B is revisited when phase 2's writes
  need idempotency keys and an impression batch endpoint (§7.4).
- **International schools / locations** — §16 q4. The location parser handles non-US
  strings but the gazetteer is US-first, matching where the corpus is.
- **Comment scope** — §16 q6 is a phase 3 question, but note that per-*company* threads
  would survive a posting closing, and phase 1 is when `companies` becomes real enough to
  hang them off.
