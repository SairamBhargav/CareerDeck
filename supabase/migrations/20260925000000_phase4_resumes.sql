-- Phase 4 — Resumes and matching.
--
-- Implements docs/README.md §3.9 (resumes, parsed profiles, the PII access log) and §3.10
-- (match scores). Design and deviations: docs/PHASE4.md.
--
-- Phase 3 was the phase where a user says something. This is the phase where they hand us
-- the document that has their home address on it, and everything here follows from that.
--
-- One property to state before the first table: **a resume is the most sensitive object
-- this product will ever hold, and the only reason to hold it is to answer one question —
-- does this person fit this posting.** Every decision below is a consequence:
--
--  * **Contact fields are encrypted with a key the database does not have.** `full_name`,
--    `email` and `phone` land as `bytea` from the API service and come back only through
--    it. A `select *` by anybody — a support engineer, a leaked service key, a future
--    migration written in a hurry — yields ciphertext. §3.9 asks for "a key held outside
--    the DB"; this is what that costs and what it buys.
--  * **Every read of the file is logged, so the file is not directly readable.** §3.9 says
--    "every signed URL issued and every parse read writes a row". A log with a hole in it
--    where the app's own reads should be is not an audit log, so `storage.objects` grants
--    the owner *insert* and nothing else, and reads go through the service. PHASE4.md §4.2.
--  * **The score is explainable or it is not shipped.** `job_match_scores.components`
--    carries the ingredients of every number, because §13.3's point stands: ranking a
--    person's employment opportunities is automated decision-making, and "why is this 43%"
--    has to have an answer. That is also the entire difference between this phase and the
--    hash function it deletes.
--
-- Phases 1–3 are untouched. `jobs` gains one nullable column and one index, which phase 1
-- named in advance ("no `jobs.embedding` yet — phase 4 adds the column and the index"), and
-- nothing populates it in this phase. PHASE4.md §3 argues that at length.

-- pgvector, for the column phase 1 promised. Supabase ships it; this is here so a bare
-- Postgres running these migrations in order does not fail at the last one.
create extension if not exists vector with schema extensions;

-- ── enums ──────────────────────────────────────────────────────────────────────

/*
 * §3.9 has `parse_status text`. An enum instead, for the reason phase 1 gave for
 * `job_status` and phase 3 for `moderation_status`: a typo in a text status is a row that
 * silently never matches a filter, and every one of these values is read by a client that
 * branches on it.
 *
 * `parsing` exists because the parse is an HTTP round trip to a model and a user who
 * backgrounds the app mid-parse must come back to a screen that knows the difference
 * between "not started" and "in flight".
 */
create type public.resume_parse_status as enum ('pending', 'parsing', 'parsed', 'failed');

/*
 * §3.9's `resource` and `purpose`, as types rather than free text.
 *
 * This log exists to be queried under time pressure during an incident. A `purpose` column
 * holding 'autoapply', 'auto_apply' and 'auto-apply' because three call sites disagreed is
 * a log that cannot answer the question it was built for.
 *
 * `autoapply` is declared now and written by nothing until phase 6, for the same reason
 * phase 3 declared every `notification_kind` up front: adding a value to an enum later is a
 * migration that cannot run in a transaction alongside anything reading the type.
 */
create type public.pii_resource as enum ('resume_pdf', 'resume_profile');
create type public.pii_purpose  as enum ('parse', 'match', 'user_download', 'autoapply', 'support', 'export');

-- ── resumes ────────────────────────────────────────────────────────────────────

create table public.resumes (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles (id) on delete cascade,
  name           text not null,
  -- The subtitle the shelf already shows ("Software Engineering"). User-supplied at upload
  -- and overwritten by the parse if the user never typed one.
  focus          text,

  /*
   * The object key inside the private `resumes` bucket, always `{user_id}/{uuid}.pdf`.
   *
   * The user id is the first path segment because that is what the storage policies below
   * match on — Supabase storage has no column to put an owner in, so the owner has to be in
   * the key. The constraint makes that structural rather than a convention the next writer
   * has to know about.
   */
  storage_path   text not null unique,
  thumbnail_path text,
  file_size      integer check (file_size is null or file_size > 0),
  page_count     smallint check (page_count is null or page_count > 0),

  /*
   * sha-256 of the file. §3.9: "skip re-parsing an identical re-upload".
   *
   * Not unique, and deliberately not. Two users may legitimately upload the same PDF — a
   * shared template, a lab's CV format — and a unique index would make the second upload
   * fail with a constraint error that tells the second user something true about the first
   * one's data.
   */
  content_hash   text,

  is_default     boolean not null default false,
  parse_status   public.resume_parse_status not null default 'pending',
  -- Why a parse failed, in words the review screen can show. Cleared on a successful retry.
  parse_error    text,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,

  constraint resumes_storage_path_is_owned
    check (storage_path like (user_id::text || '/%')),
  constraint resumes_name_length check (length(btrim(name)) between 1 and 120)
);

/*
 * §3.9 verbatim: "replaces `defaultResumeId` in the context and makes 'exactly one default'
 * a database invariant rather than a convention".
 *
 * `CareerDeckContext` has held that id in a `useState` since the first fixture, which means
 * it has been exactly as true as the last render. Here it is a constraint, and
 * `set_default_resume()` below is the only thing that can satisfy it.
 */
create unique index resumes_one_default_per_user
  on public.resumes (user_id) where is_default and deleted_at is null;

create index resumes_user_idx on public.resumes (user_id, created_at desc)
  where deleted_at is null;

-- The re-upload check: "has this user already got this exact file".
create index resumes_user_hash_idx on public.resumes (user_id, content_hash)
  where content_hash is not null and deleted_at is null;

-- §13.2's purge sweep reads this and nothing else reads it. Partial, so it costs nothing
-- on the 99.9% of rows that are not waiting to be destroyed.
create index resumes_deleted_idx on public.resumes (deleted_at) where deleted_at is not null;

-- ── resume_profiles ────────────────────────────────────────────────────────────

/*
 * What the parser read, which is the only part of a resume this product actually uses.
 *
 * The split from `resumes` is not normalization for its own sake: `resumes` is a file and
 * some metadata, and `resume_profiles` is P0 data under §13.2. They have different
 * retention, different grants and different reasons to exist, and a deletion job that
 * purges one and keeps the other needs them to be two tables.
 */
create table public.resume_profiles (
  resume_id         uuid primary key references public.resumes (id) on delete cascade,

  /*
   * §3.9: "encrypted at rest with a key held outside the DB".
   *
   * AES-256-GCM, sealed and opened in the API service (`server/src/resumes/crypto.ts`).
   * Postgres holds bytes it cannot read and has no function that could — deliberately not
   * `pgp_sym_encrypt`, because passing the key in as a SQL argument puts it in
   * `pg_stat_statements`, in the log on an error, and in the reach of anyone who can read
   * either. PHASE4.md §4.3.
   *
   * Nothing in phase 4 decrypts these. They are written at parse time and first read in
   * phase 6, when Auto Apply has to put a name on a form. §13.2 calls that data
   * minimization; here it is also the cheapest possible implementation of it.
   */
  full_name_enc     bytea,
  email_enc         bytea,
  phone_enc         bytea,

  -- Coarse on purpose — §3.9: "used for matching, not identifying". A city, never a street.
  location          text,

  skills            text[] not null default '{}',
  education         jsonb not null default '[]',
  experience        jsonb not null default '[]',
  years_experience  numeric(4,1) check (years_experience is null or years_experience between 0 and 60),
  seniority         public.seniority_level,

  /*
   * Phase 1 promised this column and phase 5 is what needs it. Nothing writes it here.
   *
   * §15 lists "embeddings" in phase 4's scope and this is the one place phase 4 declines
   * that scope rather than deferring a detail of it. The argument is in PHASE4.md §3: the
   * match ring is a comparison of two skill lists and needs no vector, §5.2's ANN retrieval
   * is what does, and Anthropic sells no embedding endpoint — so filling this column means
   * a second AI vendor chosen for a consumer that does not exist yet.
   */
  embedding         extensions.vector(1536),

  /*
   * The model's unedited output, kept for three things: re-deriving a field the schema
   * does not have yet without re-reading the PDF, diffing against the user's corrections to
   * measure parser accuracy, and answering "why did it think that" when somebody complains.
   * Never client-visible — it is a verbatim copy of a document full of P0 data.
   */
  raw_parse         jsonb,

  -- Which extractor produced this, so a re-parse sweep can find everything older than a fix.
  parser_version    text not null,
  parsed_at         timestamptz not null default now(),

  /*
   * §3.9's third reason for the confirmation screen: labeled data on parser accuracy, free.
   *
   * Null until the user has looked at the parse and pressed the button. A profile that has
   * never been confirmed still scores — refusing to match until someone taps something
   * would make the feed worse to punish them for not tapping it — but the screen keeps
   * asking, and `confirmed_fields` records what they actually changed.
   */
  user_confirmed_at timestamptz,
  confirmed_fields  text[] not null default '{}'
);

create index resume_profiles_parser_idx on public.resume_profiles (parser_version, parsed_at desc);

-- ── pii_access_log ─────────────────────────────────────────────────────────────

/*
 * §3.9 verbatim: "the single cheapest thing you can build that turns a future security
 * incident from an unbounded question into a query".
 *
 * The unbounded question is "whose resumes were exposed, and to what". Without this table
 * the honest answer is "every resume in the system, we cannot tell" — which is also what
 * has to go in the breach notification. With it, it is a `where`.
 *
 * `bigint generated always as identity` and no uuid: nothing references a row here, the
 * table only ever grows, and it is read by timestamp and by subject. §3.6 took the same
 * shape for `job_impressions` for the same reason.
 */
create table public.pii_access_log (
  id              bigint generated always as identity primary key,
  actor_type      text not null check (actor_type in ('user', 'service', 'staff')),
  -- Null when actor_type is 'service' and the work was nobody's request — the nightly
  -- re-parse sweep, a retention job. A null here is a fact, not a missing value.
  actor_id        uuid,
  subject_user_id uuid not null,
  resource        public.pii_resource not null,
  resource_id     uuid,
  purpose         public.pii_purpose not null,
  -- Free-form, for the case the enum cannot carry: a support ticket id, the sweep's run id.
  detail          text,
  created_at      timestamptz not null default now()
);

/*
 * No foreign keys, on purpose, and this is the one place in the schema where that is about
 * evidence rather than about write cost.
 *
 * `subject_user_id references profiles on delete cascade` would mean that deleting an
 * account destroys the record of who read that account's resume — which is precisely the
 * record an investigation needs *after* a deletion, and precisely what an attacker with a
 * delete would reach for. §13.2 purges the resume and keeps the log.
 */
create index pii_access_log_subject_idx on public.pii_access_log (subject_user_id, created_at desc);
create index pii_access_log_actor_idx   on public.pii_access_log (actor_id, created_at desc)
  where actor_id is not null;

-- ── job_match_scores ───────────────────────────────────────────────────────────

/*
 * §3.10. The table that replaces `utils/resumeMatch.ts`, which is deleted in this phase.
 *
 * Worth being precise about what is being replaced, because the old file was not a bad
 * implementation of matching — it was a hash of the two ids, `base = 5 + (hash % 90)`, with
 * fifteen points added when a word from the resume's `focus` string appeared in the job
 * title. It was honest about it in a comment. It produced a number that was stable per pair
 * and meant nothing, and the ring around it said "MATCH".
 */
create table public.job_match_scores (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  job_id      uuid not null references public.jobs (id) on delete cascade,
  resume_id   uuid not null references public.resumes (id) on delete cascade,
  score       smallint not null check (score between 0 and 100),

  /*
   * §3.10: "not optional decoration". The ingredients, each 0–1, under the names the client
   * and PHASE4.md both use: `skillOverlap`, `seniority`, `location`.
   *
   * Two jobs it does: it is the answer to "why is this 43%", and it is what lets the UI
   * eventually say "strong skills match, but they want 3 years" instead of drawing a ring.
   * It is also the only reason this table can be trusted after the weights change — a bare
   * score recomputed under new weights is indistinguishable from a bug.
   */
  components  jsonb not null,

  computed_at timestamptz not null default now(),
  primary key (user_id, job_id)
);

/*
 * Keyed `(user_id, job_id)` with `resume_id` as an attribute, exactly as §3.10 writes it.
 *
 * That is a deliberate one-score-per-posting-per-person: switching default resume does not
 * accumulate a second row, it invalidates the first. The index below is what makes that
 * invalidation a single ranged delete rather than a scan.
 */
create index job_match_scores_resume_idx on public.job_match_scores (resume_id);

-- ── jobs.embedding — phase 1's promise, kept and left empty ────────────────────

/*
 * PHASE1.md: "No `jobs.embedding` yet. Phase 4 adds the column and the index; near-miss
 * dedup uses pg_trgm until then."
 *
 * The column and the index are here. Nothing writes them, `ingest_upsert_jobs` is untouched,
 * and near-miss dedup still uses pg_trgm. PHASE4.md §3 is the argument; the short version is
 * that the consumer is §5.2's ANN retrieval, which is phase 5, and choosing an embedding
 * vendor a phase before anything reads the output is a decision made with less information
 * than it will be made with later.
 *
 * The index is created anyway rather than left to phase 5. An HNSW build over a corpus that
 * is 30,800 rows today is free; over the corpus phase 5 inherits it is a maintenance window.
 * An empty HNSW index costs nothing to keep — there is nothing in it to maintain until the
 * first vector lands.
 */
alter table public.jobs add column embedding extensions.vector(1536);

create index jobs_embedding_idx on public.jobs
  using hnsw (embedding extensions.vector_cosine_ops);

-- ── the storage bucket ─────────────────────────────────────────────────────────

/*
 * Private. §3.9: "private bucket; signed URLs only".
 *
 * `file_size_limit` is 10 MB against a product that wants a resume: the largest legitimate
 * one is a design portfolio at a few megabytes, and the limit is the cheapest defence
 * against somebody discovering that an authenticated account comes with free object storage.
 * `allowed_mime_types` is PDF alone — not because other formats are unparseable, but because
 * every additional accepted type is another decoder in the path of a hostile file.
 */
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('resumes', 'resumes', false, 10485760, array['application/pdf'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

/*
 * Thumbnails are a separate bucket and a separate decision.
 *
 * A page-1 render is not the document, but it is a picture of the document — it has the
 * name and the phone number on it, just smaller. So it is private too, and it is separate
 * only so that a future "show the shelf without touching the PDFs" read has somewhere to go
 * that is not the bucket holding the originals.
 */
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('resume-thumbnails', 'resume-thumbnails', false, 2097152, array['image/png', 'image/jpeg'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

/*
 * **Insert only, and no select.** PHASE4.md §4.2 — this is decision C and the least obvious
 * thing in the file.
 *
 * The obvious policy is "owner may read their own object", and it would work: a user would
 * fetch their resume straight from storage with their own JWT, exactly as phase 1 reads the
 * feed straight from Postgres. It is rejected because §3.9 asks for *every* read of a resume
 * to be logged, and a read the client performs by itself cannot be. The app's own traffic is
 * most of the traffic, so a log that omits it would be a log that answers "did anyone read
 * this" with "no" while the answer is "yes, four hundred times".
 *
 * So: the owner may put a file in their own folder, and nothing may take one out. Reads go
 * through `GET /v1/resumes/:id/url` in the API service, which writes the row and then signs.
 */
create policy resume_owner_can_upload on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'resumes'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy resume_owner_can_replace on storage.objects
  for update to authenticated
  using (
    bucket_id = 'resumes'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

/*
 * Delete is granted, and it is worth saying why when select is not.
 *
 * A user destroying their own resume is the one operation here that should never be
 * mediated by a service that might be down. §13.2's deletion job does the same thing from
 * the other side; this is the version that works at 2am with the API service in a crash
 * loop, and nothing about it exposes data — it only removes some.
 */
create policy resume_owner_can_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'resumes'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy resume_thumbnail_owner_can_upload on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'resume-thumbnails'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy resume_thumbnail_owner_can_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'resume-thumbnails'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- ── the scorer ─────────────────────────────────────────────────────────────────

/*
 * Jaccard over two skill arrays, case-folded, as §5.1 writes it:
 * `skill_overlap = Jaccard(resume.skills ∪ profile skills, job.skills)`.
 *
 * Case-folding matters more than it looks. Phase 1's skills dictionary normalizes the job
 * side to slugs; the resume side comes from a language model reading a PDF, and it will
 * produce `React`, `ReactJS` and `react` for the same fact — which is §4.5's warning about
 * free-form skills, arriving from the other direction. The extractor maps to the same
 * dictionary, and this fold is the second line of defence.
 *
 * Returns 0 rather than null for an empty intersection, and null only when the job lists no
 * skills at all — "we cannot tell" and "no overlap" are different numbers and the caller
 * weights them differently below.
 */
create or replace function public.skill_jaccard(p_left text[], p_right text[])
returns numeric
language sql
immutable
set search_path = ''
as $fn$
  with l as (select distinct lower(btrim(s)) as s from unnest(coalesce(p_left, '{}')) s
              where btrim(s) <> ''),
       r as (select distinct lower(btrim(s)) as s from unnest(coalesce(p_right, '{}')) s
              where btrim(s) <> '')
  select case
           when (select count(*) from r) = 0 then null
           when (select count(*) from l) = 0 then 0::numeric
           else round(
             (select count(*) from l join r on l.s = r.s)::numeric
             / nullif((select count(*) from (select s from l union select s from r) u), 0),
             4)
         end;
$fn$;

/*
 * How close two rungs of the seniority ladder are, 0–1.
 *
 * Not a match/no-match boolean, because the ladder is ordered and the distance means
 * something: a new grad reading a mid-level posting is a stretch, and reading a staff+
 * posting is a waste of their afternoon. One rung apart keeps most of the score; three rungs
 * apart keeps almost none.
 *
 * Asymmetric on purpose. Applying *below* your level is penalized less than applying above
 * it — a senior engineer can do the mid-level job, and for this audience "I will take it"
 * is a real answer, whereas the posting above your level will reject you.
 */
create or replace function public.seniority_affinity(
  p_resume public.seniority_level,
  p_job    public.seniority_level
)
returns numeric
language sql
immutable
set search_path = ''
as $fn$
  with ladder as (
    select case p_resume when 'intern' then 0 when 'new_grad' then 1 when 'mid' then 2
                         when 'senior' then 3 when 'staff_plus' then 4 end as r,
           case p_job    when 'intern' then 0 when 'new_grad' then 1 when 'mid' then 2
                         when 'senior' then 3 when 'staff_plus' then 4 end as j
  )
  select case
           when r is null or j is null then null
           when r = j then 1.0::numeric
           -- Reaching up: each rung costs 0.35, so two rungs is already nearly nothing.
           when j > r then greatest(0, 1.0 - 0.35 * (j - r))::numeric
           -- Reaching down: each rung costs 0.15.
           else greatest(0, 1.0 - 0.15 * (r - j))::numeric
         end
    from ladder;
$fn$;

/*
 * Does this posting's location work for this person, 0–1.
 *
 * Reads `user_preferences` rather than the resume, and that is the honest source: where
 * somebody has worked is not where they want to work, and the onboarding sheet asked them
 * directly. `PreferencesSheet` has been collecting this since before there was a database.
 *
 * Remote is 1.0 for anyone open to it, ahead of the city test, because a remote posting has
 * no location to disagree with. A user open to remote with no stated cities gets 1.0 for
 * everything — they said anywhere and this function does not argue.
 */
create or replace function public.location_affinity(
  p_city      text,
  p_region    text,
  p_type      public.location_type,
  p_preferred text[],
  p_remote_ok boolean
)
returns numeric
language sql
immutable
set search_path = ''
as $fn$
  select case
           when p_type = 'Remote' then case when coalesce(p_remote_ok, true) then 1.0 else 0.15 end
           when coalesce(array_length(p_preferred, 1), 0) = 0 then null
           when exists (
             select 1 from unnest(p_preferred) pref
              where lower(btrim(pref)) = lower(btrim(coalesce(p_city, '')))
                 or lower(btrim(pref)) = lower(btrim(coalesce(p_region, '')))
                 -- "San Francisco, CA" in preferences against "San Francisco" on the job.
                 or lower(btrim(pref)) like lower(btrim(coalesce(p_city, ''))) || ',%'
           ) then 1.0
           -- Hybrid in a city they did not name is worse than onsite in one, because hybrid
           -- means they have to actually be there some days and cannot quietly relocate.
           when p_type = 'Hybrid' then 0.1
           else 0.25
         end::numeric;
$fn$;

/*
 * The score itself, and the shape of the weights is the decision worth reading.
 *
 * §5.1's blend — 0.28 pref_match, 0.20 skill_overlap, 0.16 recency, 0.14 affinity, 0.12
 * quality, 0.10 urgency — is **not** used here, and the reason is that it answers a
 * different question. That blend ranks a corpus: it is trying to decide what to show you
 * next, so how new a posting is and whether you follow the company belong in it. This
 * number answers "does my resume fit this job", which a posting's age has nothing to do
 * with. A three-week-old posting that matches your skills exactly is a 90 and the ring
 * should say 90.
 *
 * So three components, the three §3.10 names in its own example:
 *
 *      0.55 · skillOverlap     what the resume is actually for
 *      0.25 · seniority        the filter that decides whether applying is worth the hour
 *      0.20 · location         the filter that decides whether the offer is takeable
 *
 * **Weights renormalize over whatever is answerable.** A posting with no skills listed and
 * a user with no stated locations is scored on seniority alone, out of 100 — not scored on
 * seniority out of 25 and shown as a 22, which is how a missing input silently becomes a
 * bad match. The count of components that contributed is in `components` so the client can
 * tell a confident 60 from a thin one.
 *
 * Returns null when nothing at all is answerable. Null means "no ring", not "0%".
 */
create or replace function public.compute_match(
  p_resume_skills    text[],
  p_resume_seniority public.seniority_level,
  p_job_skills       text[],
  p_job_seniority    public.seniority_level,
  p_job_city         text,
  p_job_region       text,
  p_job_type         public.location_type,
  p_preferred_locs   text[],
  p_remote_ok        boolean
)
returns jsonb
language sql
immutable
set search_path = ''
as $fn$
  with parts as (
    select public.skill_jaccard(p_resume_skills, p_job_skills)                    as skill,
           public.seniority_affinity(p_resume_seniority, p_job_seniority)         as sen,
           public.location_affinity(p_job_city, p_job_region, p_job_type,
                                    p_preferred_locs, p_remote_ok)                as loc
  ), weighted as (
    select skill, sen, loc,
           coalesce(skill * 0.55, 0) + coalesce(sen * 0.25, 0) + coalesce(loc * 0.20, 0) as total,
           case when skill is null then 0 else 0.55 end
             + case when sen is null then 0 else 0.25 end
             + case when loc is null then 0 else 0.20 end                          as denom
      from parts
  )
  select case
           when denom = 0 then null
           else jsonb_build_object(
             'score', least(100, greatest(0, round(100 * total / denom)))::int,
             'components', jsonb_strip_nulls(jsonb_build_object(
               'skillOverlap', skill,
               'seniority',    sen,
               'location',     loc
             )),
             -- How much of the formula had an input. The client uses it to decide whether
             -- the ring gets a caption; a 0.25 score is a seniority guess wearing a ring.
             'coverage', round(denom, 2)
           )
         end
    from weighted;
$fn$;

-- ── the read API ───────────────────────────────────────────────────────────────

/*
 * A resume as the client sees it. No `storage_path` — the client never addresses the object
 * directly (it cannot read it anyway, per the policies above) and a path it does not hold is
 * a path it cannot leak into a log or a crash report.
 */
create type public.resume_card as (
  id                uuid,
  name              text,
  focus             text,
  file_size         integer,
  page_count        smallint,
  is_default        boolean,
  parse_status      public.resume_parse_status,
  parse_error       text,
  skills            text[],
  education         jsonb,
  experience        jsonb,
  years_experience  numeric,
  location          text,
  seniority         public.seniority_level,
  parsed_at         timestamptz,
  user_confirmed_at timestamptz,
  created_at        timestamptz,
  updated_at        timestamptz
);

/*
 * This user's resumes, newest first, with the parsed profile flattened onto each.
 *
 * One call rather than two because there is no pagination here and never will be: §3.9's
 * shelf holds a handful of documents, and a user with fifty resumes has a different problem
 * than this query.
 *
 * `security definer` and scoped by `auth.uid()` internally. `resumes` grants the client
 * nothing, so this function is the entire read surface.
 */
create or replace function public.my_resumes()
returns setof public.resume_card
language sql
stable
security definer
set search_path = ''
as $fn$
  select r.id,
         r.name,
         r.focus,
         r.file_size,
         r.page_count,
         r.is_default,
         r.parse_status,
         r.parse_error,
         coalesce(p.skills, '{}'),
         coalesce(p.education, '[]'::jsonb),
         coalesce(p.experience, '[]'::jsonb),
         p.years_experience,
         p.location,
         p.seniority,
         p.parsed_at,
         p.user_confirmed_at,
         r.created_at,
         r.updated_at
    from public.resumes r
    left join public.resume_profiles p on p.resume_id = r.id
   where r.user_id = (select auth.uid())
     and r.deleted_at is null
   order by r.is_default desc, r.created_at desc;
$fn$;

/*
 * Match scores for the postings currently on screen — §3.10's "recomputed lazily on feed
 * build for the candidate set only, never for the whole corpus".
 *
 * **This is a read that writes**, which is why it is `volatile` and why it is worth
 * flagging: it returns the cached score where there is one and computes, stores and returns
 * it where there is not. The alternative is a background job that scores every user against
 * every posting, which is 30,800 rows times every account, almost all of it for postings
 * nobody will ever scroll past.
 *
 * Shaped exactly like phase 3's `comment_counts()`, and for the same reason — PHASE3.md's
 * decision D. A match score changes when the resume changes and is different for every
 * reader, so folding it into `job_card` would make every feed page per-viewer and
 * uncacheable for a number that belongs to one corner of one card. `feed_jobs` is untouched.
 *
 * Returns nothing at all for a user with no default resume. The ring is hidden rather than
 * zeroed: a 0% match reads as a judgement, and the truth is that we have not been told
 * anything yet.
 */
create or replace function public.match_scores(p_job_ids uuid[])
returns table (job_id uuid, score smallint, components jsonb, computed_at timestamptz)
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
/*
 * The OUT parameters are named `job_id`, `score`, `components` and `computed_at`, and plpgsql
 * resolves a bare name to a variable before it looks at a table. `on conflict (user_id, job_id)`
 * cannot be schema-qualified the way phase 3's `moderation_resolve` qualified its way out of the
 * same trap, so the resolution order is flipped for the whole body instead: columns win, and the
 * OUT parameters are only reachable through `return query`.
 */
#variable_conflict use_column
declare
  uid       uuid := (select auth.uid());
  resume    record;
  ids       uuid[] := p_job_ids[1:200];
begin
  if uid is null or ids is null or array_length(ids, 1) is null then
    return;
  end if;

  /*
   * The default resume and its parse, in one read. A resume whose parse has not landed
   * scores nothing — `parse_status = 'parsed'` rather than "a profile row exists", because a
   * failed parse can leave a half-filled profile and half a resume is worse than none.
   */
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

  /*
   * Compute the misses and store them, then return everything. `on conflict do update` and
   * not `do nothing`: two devices scrolling the same posting at the same moment race here,
   * and the loser writing the identical row is cheaper than the loser erroring.
   */
  insert into public.job_match_scores (user_id, job_id, resume_id, score, components)
  select uid,
         j.id,
         resume.resume_id,
         (m.result ->> 'score')::smallint,
         (m.result -> 'components') || jsonb_build_object('coverage', m.result -> 'coverage')
    from public.jobs j
    cross join lateral (
      select public.compute_match(
               resume.skills, resume.seniority,
               j.skills, j.seniority,
               j.location_city, j.location_region, j.location_type,
               (select up.preferred_locations from public.user_preferences up where up.user_id = uid),
               (select up.open_to_remote      from public.user_preferences up where up.user_id = uid)
             ) as result
    ) m
   where j.id = any (ids)
     and m.result is not null
     and not exists (
       select 1 from public.job_match_scores s
        where s.user_id = uid and s.job_id = j.id and s.resume_id = resume.resume_id
     )
  on conflict (user_id, job_id) do update
    set resume_id   = excluded.resume_id,
        score       = excluded.score,
        components  = excluded.components,
        computed_at = now();

  return query
    select s.job_id, s.score, s.components, s.computed_at
      from public.job_match_scores s
     where s.user_id = uid
       and s.job_id = any (ids)
       and s.resume_id = resume.resume_id;
end;
$fn$;

-- ── the write API (the reader's own actions) ───────────────────────────────────

/*
 * §3.10: "invalidated when the default resume changes or preferences change".
 *
 * A delete rather than a recompute. The next `match_scores()` call over whatever the user is
 * actually looking at will rebuild the twenty rows that matter, and rebuilding the rest
 * would be work for postings they may never see again — which is the same argument that
 * makes the read lazy in the first place.
 */
create or replace function public.invalidate_match_scores(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  removed integer;
begin
  delete from public.job_match_scores where user_id = p_user_id;
  get diagnostics removed = row_count;
  return removed;
end;
$fn$;

/*
 * Preferences feed two of the three components, so a preference edit invalidates the cache.
 *
 * A trigger rather than a call in the settings handler, because `user_preferences` is
 * written from the app directly under RLS and there is no handler to put it in. This is also
 * why the scorer reads preferences at compute time rather than snapshotting them: one place
 * to keep honest.
 */
create or replace function public.preferences_invalidate_matches()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if new.preferred_locations is distinct from old.preferred_locations
     or new.open_to_remote is distinct from old.open_to_remote then
    perform public.invalidate_match_scores(new.user_id);
  end if;
  return new;
end;
$fn$;

create trigger user_preferences_invalidate_matches
  after update on public.user_preferences
  for each row execute function public.preferences_invalidate_matches();

/*
 * Exactly one default, enforced by the index and satisfied by this function alone.
 *
 * Clearing before setting, in one statement each, inside one transaction — the unique index
 * is partial on `is_default`, so setting the new one first would collide with the old one
 * and fail. Order matters and the index is what makes getting it wrong loud.
 */
create or replace function public.set_default_resume(p_resume_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  uid     uuid := (select auth.uid());
  owned   boolean;
begin
  select true into owned
    from public.resumes
   where id = p_resume_id and user_id = uid and deleted_at is null;

  if not coalesce(owned, false) then
    return false;
  end if;

  update public.resumes set is_default = false, updated_at = now()
   where user_id = uid and is_default and id <> p_resume_id;

  update public.resumes set is_default = true, updated_at = now()
   where id = p_resume_id and not is_default;

  -- §3.10. Every cached score was computed against the resume that is no longer default.
  perform public.invalidate_match_scores(uid);
  return true;
end;
$fn$;

/*
 * Registering an uploaded file.
 *
 * The client puts the object in the bucket itself (the insert policy above) and then calls
 * this to create the row. Two steps rather than one because the upload is a multi-megabyte
 * body that should go straight to storage and never through a Postgres function, and because
 * a failed upload then leaves no row — a row pointing at an object that does not exist is
 * worse than an orphaned object, which the retention sweep collects anyway.
 *
 * `p_storage_path` is checked against the caller's own id here *and* by the table
 * constraint. The constraint is the wall; this check is the one that returns a sensible
 * error instead of a constraint violation.
 */
create or replace function public.register_resume(
  p_name         text,
  p_storage_path text,
  p_file_size    integer default null,
  p_content_hash text default null,
  p_focus        text default null
)
returns public.resume_card
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  uid      uuid := (select auth.uid());
  new_id   uuid;
  is_first boolean;
  card     public.resume_card;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = 'CD401';
  end if;

  if p_storage_path is null or p_storage_path not like (uid::text || '/%') then
    raise exception 'a resume must be stored under its owner' using errcode = 'CD010';
  end if;

  -- §11's abuse envelope, one line. Ten live resumes is far past what the shelf is for and
  -- far short of what an attacker would want out of free object storage.
  if (select count(*) from public.resumes
       where user_id = uid and deleted_at is null) >= 10 then
    raise exception 'too many resumes' using errcode = 'CD011';
  end if;

  -- The first resume is the default, because a shelf with one document and no default is a
  -- state where the ring is hidden and nobody can work out why.
  select not exists (
    select 1 from public.resumes where user_id = uid and deleted_at is null
  ) into is_first;

  insert into public.resumes (user_id, name, focus, storage_path, file_size, content_hash,
                              is_default, parse_status)
  values (uid, btrim(p_name), nullif(btrim(coalesce(p_focus, '')), ''), p_storage_path,
          p_file_size, p_content_hash, is_first, 'pending')
  returning id into new_id;

  if is_first then
    perform public.invalidate_match_scores(uid);
  end if;

  select * into card from public.my_resumes() c where c.id = new_id;
  return card;
end;
$fn$;

/*
 * §3.9's confirmation, and the field list is the decision — PHASE4.md §4.4, decision D.
 *
 * Skills, seniority, years and location, and **not** name, email or phone. The contact
 * fields are sealed at parse time and this phase never opens them: showing somebody their
 * own phone number back is a decryption, a log row and a plaintext P0 field on the wire, in
 * exchange for confirming a fact they already know. The fields that are worth correcting are
 * the ones the matcher reads, and those are exactly the ones here.
 *
 * `confirmed_fields` records what the user actually changed, which is §3.9's third reason
 * for this screen — labeled data on parser accuracy, for free, per field.
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
begin
  select p.* into before
    from public.resume_profiles p
    join public.resumes r on r.id = p.resume_id
   where p.resume_id = p_resume_id and r.user_id = uid and r.deleted_at is null;

  if before.resume_id is null then
    raise exception 'no parsed profile for that resume' using errcode = '23503';
  end if;

  /*
   * `array_append`, not `||`. With an untyped literal on the right, `text[] || 'skills'` resolves
   * to the array-concatenation operator and Postgres tries to read the word as an array literal:
   * `malformed array literal: "skills"`. The function form has no such ambiguity.
   */
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

  /*
   * Only when something actually moved. Confirming a parse that was already right should
   * not throw away every score computed from it — that is a cache flush charged to the user
   * for agreeing with us.
   */
  if array_length(changed, 1) is not null then
    perform public.invalidate_match_scores(uid);
  end if;

  select * into card from public.my_resumes() c where c.id = p_resume_id;
  return card;
end;
$fn$;

/*
 * Soft delete — §2's "soft delete on anything a user can author".
 *
 * The object stays in the bucket and `prune_deleted_resumes()` destroys it after the §13.2
 * grace period. Deleting the last default promotes the newest survivor rather than leaving
 * the user with resumes and no default, which is a state the ring cannot explain.
 */
create or replace function public.delete_resume(p_resume_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  uid         uuid := (select auth.uid());
  was_default boolean;
begin
  /*
   * Read the flag *before* the update, not with `returning`.
   *
   * `returning is_default` hands back the value the statement just wrote — which this statement
   * sets to false — so the promotion below never fired and deleting the default left the account
   * with resumes and no default. A state the ring cannot explain, and exactly what the unique
   * index cannot catch, because "no default" satisfies a partial unique index perfectly.
   */
  select r.is_default into was_default
    from public.resumes r
   where r.id = p_resume_id and r.user_id = uid and r.deleted_at is null;

  if was_default is null then
    return false;
  end if;

  update public.resumes
     set deleted_at = now(), is_default = false, updated_at = now()
   where id = p_resume_id;

  delete from public.job_match_scores where resume_id = p_resume_id;

  if coalesce(was_default, false) then
    update public.resumes
       set is_default = true, updated_at = now()
     where id = (
       select id from public.resumes
        where user_id = uid and deleted_at is null
        order by created_at desc limit 1
     );
    perform public.invalidate_match_scores(uid);
  end if;

  return true;
end;
$fn$;

-- ── the service-role surface ───────────────────────────────────────────────────

/*
 * Where the parse lands. `service_role` only — the same shape as phase 3's
 * `post_comment()`, and for the same reason.
 *
 * The rule being protected here is not "the client must not lie about its skills" (it may;
 * `confirm_resume_profile` exists precisely so it can correct them). It is that
 * `full_name_enc` and friends must only ever be written by something holding the encryption
 * key, and the encryption key is in the service. A client-writable profile row would be a
 * client that can put plaintext in a column the schema promises is ciphertext, and nothing
 * downstream would ever notice.
 */
create or replace function public.save_resume_profile(
  p_resume_id      uuid,
  p_parser_version text,
  p_full_name_enc  bytea default null,
  p_email_enc      bytea default null,
  p_phone_enc      bytea default null,
  p_location       text default null,
  p_skills         text[] default '{}',
  p_education      jsonb default '[]',
  p_experience     jsonb default '[]',
  p_years          numeric default null,
  p_seniority      public.seniority_level default null,
  p_page_count     smallint default null,
  p_raw_parse      jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  owner uuid;
begin
  select user_id into owner from public.resumes
   where id = p_resume_id and deleted_at is null;

  if owner is null then
    raise exception 'no such resume' using errcode = '23503';
  end if;

  insert into public.resume_profiles (
    resume_id, full_name_enc, email_enc, phone_enc, location, skills, education,
    experience, years_experience, seniority, raw_parse, parser_version, parsed_at
  ) values (
    p_resume_id, p_full_name_enc, p_email_enc, p_phone_enc,
    nullif(btrim(coalesce(p_location, '')), ''), coalesce(p_skills, '{}'),
    coalesce(p_education, '[]'::jsonb), coalesce(p_experience, '[]'::jsonb),
    p_years, p_seniority, p_raw_parse, p_parser_version, now()
  )
  on conflict (resume_id) do update
    set full_name_enc    = excluded.full_name_enc,
        email_enc        = excluded.email_enc,
        phone_enc        = excluded.phone_enc,
        location         = excluded.location,
        skills           = excluded.skills,
        education        = excluded.education,
        experience       = excluded.experience,
        years_experience = excluded.years_experience,
        seniority        = excluded.seniority,
        raw_parse        = excluded.raw_parse,
        parser_version   = excluded.parser_version,
        parsed_at        = now(),
        -- A re-parse is a new set of facts, so a previous confirmation no longer applies.
        user_confirmed_at = null,
        confirmed_fields  = '{}';

  update public.resumes
     set parse_status = 'parsed',
         parse_error  = null,
         page_count   = coalesce(p_page_count, page_count),
         -- The parse names the document if the user did not.
         focus        = coalesce(focus, p_seniority::text),
         updated_at   = now()
   where id = p_resume_id;

  -- Every score for this user was computed against an older reading of this document.
  perform public.invalidate_match_scores(owner);
  return owner;
end;
$fn$;

/** Moves a resume between parse states. Service role only; the client watches the result. */
create or replace function public.set_parse_status(
  p_resume_id uuid,
  p_status    public.resume_parse_status,
  p_error     text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  touched integer;
begin
  update public.resumes
     set parse_status = p_status,
         parse_error  = nullif(btrim(coalesce(p_error, '')), ''),
         updated_at   = now()
   where id = p_resume_id and deleted_at is null;

  get diagnostics touched = row_count;
  return touched > 0;
end;
$fn$;

/*
 * §3.9's log write. Service role only — a client that can write this table can write a row
 * saying somebody else read a resume, and an audit log anyone can forge is worse than none
 * because it will be believed.
 */
create or replace function public.log_pii_access(
  p_actor_type text,
  p_actor_id   uuid,
  p_subject    uuid,
  p_resource   public.pii_resource,
  p_resource_id uuid,
  p_purpose    public.pii_purpose,
  p_detail     text default null
)
returns bigint
language sql
volatile
security definer
set search_path = ''
as $fn$
  insert into public.pii_access_log (actor_type, actor_id, subject_user_id, resource,
                                     resource_id, purpose, detail)
  values (p_actor_type, p_actor_id, p_subject, p_resource, p_resource_id, p_purpose,
          nullif(btrim(coalesce(p_detail, '')), ''))
  returning id;
$fn$;

/*
 * The resume the service is about to parse, resolved from an id the user supplied.
 *
 * Returns the owner alongside the path so the handler can check that the caller owns it
 * without a second query and without trusting the caller's claim about whose resume it is.
 */
create or replace function public.resume_for_service(p_resume_id uuid)
returns table (resume_id uuid, user_id uuid, storage_path text, parse_status public.resume_parse_status,
               content_hash text)
language sql
stable
security definer
set search_path = ''
as $fn$
  select r.id, r.user_id, r.storage_path, r.parse_status, r.content_hash
    from public.resumes r
   where r.id = p_resume_id and r.deleted_at is null;
$fn$;

-- ── operations ─────────────────────────────────────────────────────────────────

/*
 * §13.2 phase two, for resumes: "after 30 days: purge resume files from storage,
 * `resume_profiles`".
 *
 * This deletes the rows and returns the storage paths it orphaned; the caller
 * (`scripts/maintain.mjs`) removes the objects, because SQL cannot reach the bucket. Doing it
 * in that order is deliberate — an object with no row is garbage the next sweep collects,
 * while a row pointing at a destroyed object is a resume the UI will offer to open.
 *
 * `pii_access_log` is untouched by design. The record of who read the file outlives the file.
 */
create or replace function public.prune_deleted_resumes(p_grace_days integer default 30)
returns table (resume_id uuid, storage_path text)
language sql
volatile
security definer
set search_path = ''
as $fn$
  with doomed as (
    select id, storage_path from public.resumes
     where deleted_at is not null
       and deleted_at < now() - make_interval(days => greatest(coalesce(p_grace_days, 30), 1))
  ), gone as (
    delete from public.resumes r using doomed d where r.id = d.id returning r.id, r.storage_path
  )
  select id, storage_path from gone;
$fn$;

/*
 * §13.2's retention on the log itself: two years, matching the moderation records phase 3
 * kept for the same span. Long enough to answer an investigation about last year, short
 * enough that a table nothing ever deletes from does not become the second-largest object in
 * the database after impressions.
 */
create or replace function public.prune_pii_access_log(p_keep_days integer default 730)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  removed integer;
begin
  delete from public.pii_access_log
   where created_at < now() - make_interval(days => greatest(coalesce(p_keep_days, 730), 90));
  get diagnostics removed = row_count;
  return removed;
end;
$fn$;

/*
 * Match scores go stale in a way nothing else notices: a posting's skills can be rewritten
 * by a re-crawl, and the cached score against it stays whatever it was. A fortnight is well
 * inside how long a posting stays open and well outside how often one materially changes.
 */
create or replace function public.prune_match_scores(p_keep_days integer default 14)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  removed integer;
begin
  delete from public.job_match_scores
   where computed_at < now() - make_interval(days => greatest(coalesce(p_keep_days, 14), 1));
  get diagnostics removed = row_count;
  return removed;
end;
$fn$;

-- ── authorization ──────────────────────────────────────────────────────────────

/*
 * Phase 0's discipline for the fourth time: **RLS decides which rows, column grants decide
 * which fields**, and neither substitutes for the other.
 *
 * | Table               | Read                          | Write                                |
 * |---------------------|-------------------------------|--------------------------------------|
 * | `resumes`           | **nobody** — `my_resumes()`   | none — `register_resume()` etc.      |
 * | `resume_profiles`   | **nobody** — `my_resumes()`   | none — `save_resume_profile()` only  |
 * | `job_match_scores`  | own rows                      | none — `match_scores()` only         |
 * | `pii_access_log`    | **nobody**                    | none — `log_pii_access()` only       |
 *
 * `resumes` is unreadable rather than own-rows-readable, which is one step stricter than
 * phase 2 took with `applications`. The difference is `storage_path`: a select grant with a
 * policy leaves the object key one `select *` away, and the key is the thing the whole
 * bucket policy above exists to keep out of a client's hands. `my_resumes()` returns every
 * field a screen needs and not that one.
 *
 * `resume_profiles` is unreadable for the harder version of the same reason — the encrypted
 * contact columns. Ciphertext is not plaintext, but it is P0 data in a client's memory, in
 * its cache, and in the crash report it uploads, in exchange for nothing any screen renders.
 *
 * `job_match_scores` *is* own-rows-readable, because there is nothing in it to withhold: a
 * user's score against a posting, and the ingredients, both of which §13.3 says they are
 * entitled to see. The grant is there so a future "why 43%" screen can read it without a new
 * function.
 */

alter table public.resumes          enable row level security;
alter table public.resume_profiles  enable row level security;
alter table public.job_match_scores enable row level security;
alter table public.pii_access_log   enable row level security;

revoke all on public.resumes          from anon, authenticated;
revoke all on public.resume_profiles  from anon, authenticated;
revoke all on public.job_match_scores from anon, authenticated;
revoke all on public.pii_access_log   from anon, authenticated;

grant select on public.job_match_scores to authenticated;

create policy job_match_scores_select_own on public.job_match_scores
  for select to authenticated
  using (user_id = (select auth.uid()));

/*
 * Defence in depth, the same arrangement phase 3 used: the revoke is the wall and the policy
 * is the second wall. A convenience grant added by somebody in six months still hits a
 * policy that says own-rows-only, and on the three tables with no policy at all it hits
 * nothing at all — RLS enabled with no policy denies everything.
 */

/*
 * Functions default to `execute` for `public`, so every one of them has to be revoked by
 * name and granted back deliberately. Two revokes per function, from `public` and from the
 * roles, because Supabase also grants execute to `anon, authenticated, service_role`
 * directly and neither revoke covers the other.
 */
revoke all on function public.skill_jaccard(text[], text[])                    from public, anon, authenticated;
revoke all on function public.seniority_affinity(public.seniority_level, public.seniority_level)
  from public, anon, authenticated;
revoke all on function public.location_affinity(text, text, public.location_type, text[], boolean)
  from public, anon, authenticated;
revoke all on function public.compute_match(text[], public.seniority_level, text[], public.seniority_level,
                                            text, text, public.location_type, text[], boolean)
  from public, anon, authenticated;
revoke all on function public.preferences_invalidate_matches()                 from public, anon, authenticated;
revoke all on function public.invalidate_match_scores(uuid)                    from public, anon, authenticated;
revoke all on function public.save_resume_profile(uuid, text, bytea, bytea, bytea, text, text[], jsonb,
                                                  jsonb, numeric, public.seniority_level, smallint, jsonb)
  from public, anon, authenticated;
revoke all on function public.set_parse_status(uuid, public.resume_parse_status, text)
  from public, anon, authenticated;
revoke all on function public.log_pii_access(text, uuid, uuid, public.pii_resource, uuid,
                                             public.pii_purpose, text)
  from public, anon, authenticated;
revoke all on function public.resume_for_service(uuid)                         from public, anon, authenticated;
revoke all on function public.prune_deleted_resumes(integer)                   from public, anon, authenticated;
revoke all on function public.prune_pii_access_log(integer)                    from public, anon, authenticated;
revoke all on function public.prune_match_scores(integer)                      from public, anon, authenticated;

revoke all on function public.my_resumes()                                     from public, anon;
revoke all on function public.match_scores(uuid[])                             from public, anon;
revoke all on function public.set_default_resume(uuid)                         from public, anon;
revoke all on function public.register_resume(text, text, integer, text, text) from public, anon;
revoke all on function public.confirm_resume_profile(uuid, text[], public.seniority_level, numeric, text)
  from public, anon;
revoke all on function public.delete_resume(uuid)                              from public, anon;

/*
 * What a signed-in reader may call. Everything here scopes itself to `auth.uid()` internally
 * — none of them takes a user id, which is the property that makes the list safe to read at
 * a glance. `match_scores` is the odd one: it writes, and it still takes no user id.
 */
grant execute on function public.my_resumes()                                     to authenticated;
grant execute on function public.match_scores(uuid[])                             to authenticated;
grant execute on function public.set_default_resume(uuid)                         to authenticated;
grant execute on function public.register_resume(text, text, integer, text, text) to authenticated;
grant execute on function public.confirm_resume_profile(uuid, text[], public.seniority_level, numeric, text)
  to authenticated;
grant execute on function public.delete_resume(uuid)                              to authenticated;

/* The parse path and the operational sweeps. Nothing below is reachable from the app. */
grant execute on function public.save_resume_profile(uuid, text, bytea, bytea, bytea, text, text[], jsonb,
                                                     jsonb, numeric, public.seniority_level, smallint, jsonb)
  to service_role;
grant execute on function public.set_parse_status(uuid, public.resume_parse_status, text) to service_role;
grant execute on function public.log_pii_access(text, uuid, uuid, public.pii_resource, uuid,
                                                public.pii_purpose, text)                 to service_role;
grant execute on function public.resume_for_service(uuid)                                 to service_role;
grant execute on function public.invalidate_match_scores(uuid)                            to service_role;
grant execute on function public.prune_deleted_resumes(integer)                           to service_role;
grant execute on function public.prune_pii_access_log(integer)                            to service_role;
grant execute on function public.prune_match_scores(integer)                              to service_role;
