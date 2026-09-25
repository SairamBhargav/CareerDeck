# Phase 4 — Resumes and matching

Companion to [README.md](./README.md) §15, which says what phase 4 is in three lines. This is the
design: every table, every write path, every client file that changes, and the reasons for each
deviation from the plan.

**Written for:** whoever builds or reviews this phase, including someone who has read neither
[PHASE1.md](./PHASE1.md) nor [PHASE2.md](./PHASE2.md) nor [PHASE3.md](./PHASE3.md) nor the client.

**Exit condition (from §15):** *the match ring shows a real, explainable number.*

---

## Decisions taken for this phase

Four questions were open when this document was first written. They are settled, and the rest of
the document reflects the answers rather than the alternatives.

| # | Question | Chosen | Consequence |
|---|---|---|---|
| A | Where does the score get computed? | **In SQL, on read, for the candidate set only** | The rule stays in the database for the reason phase 3 kept comment rules there. `match_scores()` is a read that writes: it returns what it has and computes what it does not, so the corpus is never scored against every account. §3.1. |
| B | Are embeddings populated? | **No. The column and the index only** | §15 lists embeddings in this phase's scope, and this is where phase 4 declines that scope rather than deferring a detail of it. Nothing in phase 4 reads a vector; §5.2's ANN retrieval is what will, and Anthropic sells no embedding endpoint. §3. |
| C | How is a resume file read? | **Through the API service, so the read is logged** | §3.9 requires every read of a resume to be logged. A client that signs its own URL logs nothing, so the bucket grants the owner insert and delete and **no select**. The first read in four phases routed through the service for neither a secret nor performance. §4.2. |
| D | Does the confirmation screen show contact details? | **No. It says they were found** | Name, email and phone are sealed at parse time and never opened in this phase. Showing somebody their own phone number costs a decryption, an audit row and a plaintext P0 field on the wire, to confirm a fact they already know. §4.4. |

---

## 0. What phase 4 is, in one paragraph

Phase 0 established who a reader is, phase 1 what there is to look at, phase 2 what they did about
it, phase 3 what they say to each other. Phase 4 is where the user hands over the document with
their home address on it, and everything in this phase follows from that. It builds a private
storage bucket, an extractor that reads a PDF into structured fields, the `resume_profiles` those
fields land in, an audit log of every access to either, a real scorer over the parsed skills, and
the screen where the user corrects what the parser got wrong. The one property worth stating before
any schema: **a resume is the most sensitive object this product will ever hold, and the only
reason to hold it is to answer one question — does this person fit this posting.** Every decision
below is downstream of that sentence, including the two that make the phase more expensive than it
needed to be.

---

## 1. Scope

### In

- §3.9's `resumes`, `resume_profiles`, and the private bucket the files live in.
- §3.9's `pii_access_log`, and the routing change that makes it complete rather than decorative.
- §3.10's `job_match_scores`, with `components` on every row.
- A real scorer: skill overlap, seniority distance, location fit, renormalized over what is
  answerable.
- The parse-confirmation screen, and `user_confirmed_at` behind it.
- AES-256-GCM on the three contact fields, with the key outside the database.
- `jobs.embedding` and its HNSW index — the column [PHASE1.md](./PHASE1.md) promised this phase
  would add.
- Deleting `utils/resumeMatch.ts`, which §15 asks for by name.

### Out, and where it goes instead

| Not built | Why | Where it lands |
|---|---|---|
| Populating any embedding | Nothing in phase 4 reads a vector, and choosing a vendor a phase before the consumer exists is a decision made with less information than it will be made with later | Phase 5, which needs them for §5.2's retrieval. §3 |
| Decrypting a contact field | They are written and not read. §13.2 calls that data minimization; here it is also the cheapest possible implementation of it | Phase 6, when Auto Apply has to put a name on a form |
| Page-1 thumbnails | Rendering a page of an arbitrary user-supplied PDF is a native dependency and a decoder in the path of a hostile file, for a picture of a document the user recognises by name | The bucket exists. When the render pipeline is worth building |
| A parse queue | The client is sitting on a review screen waiting for this exact answer. A worker, a job table and a delivery path would be three moving parts for a call that takes a few seconds | When p95 says so. `parse_status` already carries the state, so the client does not change |
| Re-parse on a parser upgrade | `parser_version` is stamped on every row so the affected set is a `where`. Running the sweep is an operation, not a feature | When there is a parser bug worth sweeping for |
| Skipping a re-parse on an identical re-upload | `content_hash` is stored and nothing reads it. The saving is one model call on a rare action | Trivial to add. Deferred, §11 |
| A "why 43%" screen | `components` is stored and the ring's caption names the strongest ingredient. The full sentence §3.10 imagines needs room the badge does not have | When the job detail screen wants it |

---

## 2. Schema

Four tables, one column on `jobs`, two buckets. Everything else in phases 0–3 is untouched.

### 2.1 `resumes`

A file and its metadata. The two constraints worth reading are `resumes_storage_path_is_owned`,
which makes "the object key starts with the owner's id" structural rather than a convention the
next writer has to know, and the partial unique index:

```sql
create unique index resumes_one_default_per_user
  on public.resumes (user_id) where is_default and deleted_at is null;
```

§3.9 asks for exactly this and says why: it "replaces `defaultResumeId` in the context and makes
'exactly one default' a database invariant rather than a convention". `CareerDeckContext` has held
that id in a `useState` since the first fixture, which made the invariant exactly as true as the
last render.

One thing the index cannot catch is *no* default, which satisfies a partial unique index perfectly.
That is what `delete_resume()`'s promotion is for, and it is where this phase's most embarrassing
bug lived — see §7.

### 2.2 `resume_profiles`

What the parser read. Split from `resumes` not for normalization but because they are different
data classes under §13.2 with different retention, and a deletion job that purges one and keeps the
other needs them to be two tables.

`full_name_enc`, `email_enc` and `phone_enc` are `bytea` holding AES-256-GCM ciphertext. §4.3 has
the layout and the argument against `pgp_sym_encrypt`.

`confirmed_fields` is §3.9's third reason for the confirmation screen, made literal: it records
*which* fields the user changed, so "how accurate is the extractor, per field" is a query.

### 2.3 `pii_access_log`

§3.9 verbatim: "the single cheapest thing you can build that turns a future security incident from
an unbounded question into a query."

The unbounded question is "whose resumes were exposed, and to what". Without this table the honest
answer is "every resume in the system, we cannot tell" — which is also what has to go in the breach
notification.

**No foreign keys, and here that is about evidence rather than write cost.** `subject_user_id
references profiles on delete cascade` would mean deleting an account destroys the record of who
read that account's resume, which is exactly the record an investigation needs after a deletion and
exactly what an attacker holding a delete would reach for. §13.2 purges the resume and keeps the
log; `verify:phase4` asserts it.

### 2.4 `job_match_scores`

§3.10, keyed `(user_id, job_id)` with `resume_id` as an attribute exactly as written there — so
switching default resume invalidates rather than accumulates.

`components` is not decoration. §13.3's point stands: ranking a person's employment opportunities
is automated decision-making, and "why is this 43%" has to have an answer. It is also what lets the
table be trusted after a weight change, because a bare score recomputed under new weights is
indistinguishable from a bug.

---

## 3. Embeddings: the column, the index, and nothing in them — decision B

[PHASE1.md](./PHASE1.md) committed to this: *"No `jobs.embedding` yet. Phase 4 adds the column and
the index; near-miss dedup uses pg_trgm until then."* The column and the index are here. Nothing
writes them.

§15 lists "embeddings" in phase 4's scope, so this is a declined scope rather than a deferred
detail, and it deserves the argument rather than a footnote.

**Nothing in this phase reads a vector.** The exit condition is the match ring. The ring's number is
skill overlap, seniority distance and location fit — three comparisons over values that are already
columns. §3.10's own worked example of `components` is `{skillOverlap: .7, seniority: 1, location:
.5}`, which names no embedding. The consumer of a vector is §5.2's ANN retrieval — *"candidates =
pgvector ANN(user_taste_vector, k = 500)"* — and §5.2 is phase 5.

**Filling the column means choosing a vendor.** Anthropic has no embedding endpoint, so populating
it means a second AI provider, a second key, a second capability flag, a second failure mode in the
parse path, and a backfill across the whole corpus. Every one of those is a commitment made on
behalf of a consumer that does not exist yet, and phase 5 will make the same choice with the
retrieval design in front of it.

**The dimension is a guess until something reads it.** `vector(1536)` is what §3.9 and §3.4 write,
and it is OpenAI's `text-embedding-3-small`. Voyage — Anthropic's recommended partner — is 1024.
Committing the column to 1536 and then populating it from a 1024-dimension model is a migration
across the largest table in the database. Leaving it empty means the first vendor decision can
still change the column for free.

**The index is built anyway**, rather than left to phase 5. An HNSW build over a corpus that is tens
of thousands of rows today is free; over the corpus phase 5 inherits it is a maintenance window. An
empty HNSW index costs nothing to keep, because there is nothing in it to maintain until the first
vector lands.

**The trigger for revisiting:** phase 5 starting. Not a metric — a phase. The column is ready and
`resume_profiles.embedding` is ready beside it.

---

### 3.1 The score is a read that writes — decision A

`match_scores(p_job_ids uuid[])` returns the cached score for each posting and computes, stores and
returns the ones it does not hold. §3.10 asks for exactly this: *"recomputed lazily on feed build
for the candidate set only — never for the whole corpus."*

The alternative is a background job scoring every user against every posting, which is the corpus
times every account, almost all of it for postings nobody will ever scroll past.

It is shaped exactly like phase 3's `comment_counts()`, and that is the same decision one phase
later — PHASE3.md's decision D. A score is per-reader and changes when the resume changes, so
folding it into `job_card` would make every feed page uncacheable for a number in one corner of one
card. **`feed_jobs` and `job_card` are untouched by this phase.**

Invalidation is a delete, not a recompute, in four places: a new default resume, a corrected
profile, a re-parse, and a preferences change. The last is a trigger on `user_preferences`, because
that table is written directly from the app under RLS and there is no handler to put a call in.

### 3.2 The weights, and why they are not §5.1's

§5.1's blend is `0.28 pref_match + 0.20 skill_overlap + 0.16 recency + 0.14 affinity + 0.12 quality
+ 0.10 urgency`. This phase does not use it, and the reason is that it answers a different question.

That blend **ranks a corpus**: it decides what to show you next, so how new a posting is and whether
you follow the company belong in it. This number answers **"does my resume fit this job"**, which a
posting's age has nothing to do with. A three-week-old posting that matches your skills exactly is a
90, and the ring should say 90.

So three components, the three §3.10 names in its own example:

```
0.55 · skillOverlap     what the resume is actually for
0.25 · seniority        the filter that decides whether applying is worth the hour
0.20 · location         the filter that decides whether the offer is takeable
```

**Weights renormalize over whatever is answerable.** A posting that lists no skills is scored on
seniority and location alone, out of 100 — not scored out of 45 and displayed as a 45, which is how
a missing input silently becomes a bad match. `coverage` travels in `components` so the client can
tell a confident 80 from a thin one, and the ring's caption reads `PARTIAL` below 0.6.

Seniority distance is asymmetric: reaching *up* costs 0.35 a rung, reaching *down* 0.15. A senior
engineer can do the mid-level job and for this audience "I will take it" is a real answer, whereas
the posting above your level will reject you.

`null` for every component means no ring at all. **A user with no parsed resume gets no score, not
a zero** — 0% reads as a judgement, and the truth is that nothing has been read yet.

---

## 4. The write path

### 4.1 Where the rules live

The same split phase 3 made, for the same reason. The API service owns the two things that need a
credential — the model and the encryption key — and **every rule stays in SQL**:

- `save_resume_profile()` is `service_role`-only, so a client cannot write plaintext into a column
  the schema promises is ciphertext.
- `register_resume()` enforces the path prefix and the ten-resume cap.
- `set_default_resume()` is the only thing that can satisfy the partial unique index.
- `log_pii_access()` is `service_role`-only, because an audit log anyone can forge is worse than
  none — it will be believed.

A bug in `server/src/resumes.ts` can produce a *wrong* profile. It cannot produce an illegitimate
one.

### 4.2 Reads go through the service, and this is new — decision C

Phase 1's decision B was "reads go to Postgres, not to the API service", and it has held for three
phases. This is the first read that breaks it, and it breaks it for neither of the usual reasons.

Supabase storage would happily sign a URL for the owner under an ordinary RLS policy. It is not
allowed to, because §3.9 says *"every signed URL issued and every parse read writes a row"*, and a
read the client performs by itself cannot write one. The app's own traffic is most of the traffic,
so a log that omits it would answer "did anyone read this resume" with "no" while the true answer is
"yes, four hundred times".

So the bucket policies are:

| Operation | Granted to the owner? | Why |
|---|---|---|
| insert | **yes** | A multi-megabyte body has no business travelling through a Postgres function |
| update | yes | Replacing your own file is the same act as uploading it |
| delete | **yes** | The one operation that must work at 2am with the API service in a crash loop. Nothing about it exposes data — it only removes some |
| select | **no** | This is the decision. Every read goes through `GET /v1/resumes/:id/url`, which writes the row and then signs |

The URL is good for five minutes. A signed storage URL carries its own authorization, so its
lifetime is the only control left over it.

The cost is real: opening a resume is a round trip and a spinner where it used to be a synchronous
`Asset.fromModule().uri`. That is what a complete audit log costs, and it is worth it.

### 4.3 AES-256-GCM in the service, not pgcrypto

Postgres can encrypt: `pgp_sym_encrypt(value, key)`. It is rejected because the key would then be an
argument to a SQL function, and a SQL function's arguments end up in `pg_stat_statements`, in
`log_min_duration_statement` output, and in the error text when the statement fails. §3.9 says the
key is held *outside* the database, and a key that travels into the database on every insert is not.

GCM rather than CBC for the auth tag. Without it, anyone with write access to the column can flip
bits and the decrypt still succeeds, returning a value nobody chose. For a field phase 6 will put on
a job application on the user's behalf, "this decrypted to something, probably right" is not good
enough.

**`RESUME_ENCRYPTION_KEY` has the same hazard as phase 3's `VERIFICATION_PEPPER`, and worse.**
Rotating it makes every previously sealed field permanently unreadable, and nothing detects it: the
rows are still there and still the right length. A lost pepper un-bans people; a lost key destroys
data. The layout carries a version byte so a future rotation can write `2` and keep reading `1` —
a real migration this format supports and the current code deliberately does not implement, because
building key-list machinery before there are two keys is guessing at the shape of a rotation nobody
has planned.

Without the key, a resume still parses and still matches; the three contact fields are dropped
rather than stored in the clear. `/health` reports `resumeEncryption` separately from
`resumeParsing` because they fail differently and the client shows different things.

### 4.4 The confirmation screen confirms four fields — decision D

§3.9 wants the user to correct the parse, and gives three reasons: it fixes the ~15% the parser gets
wrong, it is a consent moment you can point at, and it is free labeled data on parser accuracy.

The screen shows **skills, level, location and years** — the fields the matcher reads, which are
exactly the fields worth correcting. It does not show name, email or phone.

Showing them back would mean: decrypt three values, write a `pii_access_log` row, put three
plaintext P0 fields on the wire and into a device's memory, cache and crash reports — in exchange
for confirming three facts the user already knows, because they wrote them on the document they just
uploaded. The screen says the three were *found*, which is the only part the user cannot otherwise
tell, and `POST /v1/resumes/:id/contact` exists write-only for the case where one was missed.

This is a departure from §3.9's framing, which implies the whole parse is confirmed. The narrower
version is better data protection and loses nothing the matcher uses.

### 4.5 What the extractor is told not to do

The prompt guards two failure modes that would make a parsed profile worse than none:

**Inventing.** A model asked for `years_experience` will produce a number for a resume that does not
state one. §6's Auto Apply rule — *"never fabricate a fact"* — starts here, because this is the row
Auto Apply reads from. Every field is nullable and the prompt says absence is a valid answer.

**Free-form skills.** §4.5's warning arriving from the resume side: left alone the model returns
`React`, `ReactJS`, `React.js` and `react` for one fact, and the Jaccard then scores an exact match
as a partial one. The prompt pins the vocabulary to slugs, `normalize()` re-slugs whatever comes
back, and `skill_jaccard()` case-folds as a third line of defence.

The PDF goes up **whole**, as a `document` content block, rather than being text-extracted first.
Resumes are the worst case for text extraction — two-column layouts interleave into nonsense and
dates sit in a gutter fifty lines from the job title they belong to — and not having a PDF parser in
the dependency tree means not having a decoder for a hostile file format running in the same process
as the service-role key.

Unlike phase 3's classifier, the extractor **throws**. The two sit at opposite ends of one question:
a classifier guards a write the user is waiting on, so failing open and flagging is the only answer
wrong in neither direction. A parse guards nothing — the resume sits in `failed` with a reason on it
and the user retries. Inventing a profile because the model was unreachable would put fabricated
skills behind a match score and, in phase 6, onto a job application.

---

## 5. Configuration

| Variable | Required? | Without it |
|---|---|---|
| `ANTHROPIC_API_KEY` | no | No parsing. Upload works, the resume sits at `pending`, no score. Same key the classifier uses |
| `RESUME_ENCRYPTION_KEY` | no | Parsing works, matching works, the three contact fields are dropped rather than sealed |
| `RESUME_PARSER_MODEL` | no | Defaults to `claude-opus-5` |
| `RESUME_PARSE_TIMEOUT_MS` | no | Defaults to 90s |

The parser model defaults to the capable one and no cheaper alternative is recommended, which is the
opposite of `MODERATION_MODEL`'s treatment in PHASE3.md §6.2. The trade runs the other way: the
classifier sits in front of a user staring at a composer with a 2.5s budget, while a parse happens
once per uploaded document behind a progress state. Accuracy is worth more than latency here, and a
mis-read resume is wrong on every card the user sees afterwards.

---

## 6. Client migration

| File | Change |
|---|---|
| `utils/resumeMatch.ts` | **Deleted.** §15 asks for this by name |
| `data/mockResumes.ts` | **Deleted** |
| `components/activity/CommentActivityCard.tsx` | (phase 3) |
| `types/resume.ts` | Rewritten. No `pdf`, no `thumbnail` — **no file handle at all** |
| `context/CareerDeckContext.tsx` | `resumes`, `defaultResumeId`, `setDefaultResume` removed |
| `hooks/useResumes.ts` | New. `useResumes` and `useMatchScores` |
| `app/resume-review.tsx` | New. The parse-confirmation screen |
| `components/activity/ResumeShelf.tsx` | Gains the add tile — phase 4 is where uploading becomes possible |
| `components/activity/ResumeBubble.tsx` | Thumbnail → parse state |
| `components/activity/ResumeViewerModal.tsx` | `Asset.fromModule()` → a signed URL from the service |
| `components/reels/ResumeMatchRing.tsx` | Gains `explain`, and a caption that is no longer always "MATCH" |
| `constants/theme.ts` | Gains `danger`. Phase 4 is the first phase with a state that is neither working nor loading |

### 6.1 What went away

`resumeMatchScore()` was 45 lines and honest about itself in a comment: *"a stand-in for real
resume-to-job matching — there's no backend, no parsed resume content, and no scoring model yet."*
It hashed the two ids into `5 + (hash % 90)` and added fifteen points when a word from the resume's
`focus` string appeared in the job title. It was stable per pair, which is the only property it had,
and a ring around it said `MATCH`.

`defaultResumeId` was a `useState` seeded from a fixture. It is now a partial unique index.

### 6.2 Nothing goes through the outbox

Phase 2 put likes, saves and follows through `lib/outbox.ts`. Nothing in phase 4 uses it, for
PHASE3.md §5's reason one step further along: an upload is megabytes of body and a parse is a model
call that can refuse. Neither is a state-setting toggle that replays in any order, and a queued
upload firing four hours later against a resume the user has since deleted is worse than an upload
that failed while they were watching.

`setDefault` is the exception that proves the rule — it *is* a state-setting toggle — and it still
does not queue, because it only makes sense next to resumes the user can currently see.

---

## 7. Verification — `npm run verify:phase4`

68 checks. Four kinds, mixed on purpose: it works; it cannot be subverted; it does not leak; and the
number means something. It parses `assets/resumes/engineering.pdf` — one of the two documents that
used to be compiled into the app — because a real two-column resume is a better parser test than
anything that could be generated.

**Three bugs it caught that review had not**, all in the first run, all in SQL:

- **`match_scores()` failed with "column reference `job_id` is ambiguous".** The OUT parameters are
  named `job_id`, `score`, `components`, and plpgsql resolves a bare name to a variable before it
  looks at a table. `on conflict (user_id, job_id)` cannot be schema-qualified the way phase 3's
  `moderation_resolve` qualified its way out of the identical trap, so the body now declares
  `#variable_conflict use_column`. The phase 3 migration has a comment warning about this exact
  hazard; it was not enough.
- **`confirm_resume_profile()` failed with "malformed array literal: `skills`".** `changed :=
  changed || 'skills'` resolves to array-concatenation with an untyped literal, so Postgres tries to
  read the word as an array. Now `array_append`.
- **Deleting the default resume left the account with no default.** `update ... returning is_default
  into was_default` hands back the value the statement just wrote, which that statement sets to
  `false`, so the promotion never fired. The partial unique index cannot catch this: *no* default
  satisfies it perfectly. The flag is now read before the update.

**A fourth bug, caught the moment a real key was configured** — not by `verify:phase4`, which had
no key to run against, but by calling `extractResume()` directly against a real PDF. The first call
came back `400 invalid_request_error`: *"Enum value 'intern' does not match declared type
'['string', 'null']'"*.

The `seniority` field's schema was `{ type: ['string', 'null'], enum: [...] }` — the same shape
every other nullable field on the tool uses, except none of the others also carry an `enum`. Under
`strict: true`, Anthropic's schema validator rejects an `enum` paired with an array `type`: it
cannot reconcile a five-value string enum against a type declaration that also allows null. The fix
is `anyOf`, splitting the two branches into their own subschemas — `{type: 'string', enum: [...]}`
and `{type: 'null'}` — which is what strict mode actually validates.

Once fixed, the extractor read a real two-column resume correctly on the first call: name, email,
phone and location found, skills properly slugged (`c-plus-plus`, `distributed-systems`), education
and experience dated, and — the check that matters most — `yearsExperience: null` rather than an
invented number, because the resume never states a total and the prompt says absence is a valid
answer.

**Two things the local stack could not exercise until a key existed**, one of which is now proven:

- **The parse itself.** Was reported as a skip on every run with no `ANTHROPIC_API_KEY`, and the
  closing summary said so explicitly rather than claiming the phase proven — "a real resume
  parses" is this phase's central claim and SQL alone does not establish it. **Proven** as of the
  bug above, directly against `assets/resumes/engineering.pdf`; the full route is still blocked by
  the storage defect below until that stack issue clears.
- **The storage round trip.** Storage schema migration 72 (`drop-bucketid-objname-index`) replaced
  the plain unique index on `(bucket_id, name)` with one partial on `where not is_versioned`, and
  storage-api v1.72.1 still issues a bare `on conflict (name, bucket_id)`. A partial index cannot be
  an `on conflict` arbiter without the predicate, so **every upload to every bucket** fails with
  42P10 on that pairing. Nothing in this phase causes it or can fix it. The policies themselves were
  confirmed directly against `storage.objects` as an `authenticated` role — own-folder insert
  allowed, other-folder insert refused, own-object select returning zero rows — and the script reads
  the policy catalogue so that a `select` policy added later trips it even on a broken stack.

---

## 8. Risks specific to this phase

| Risk | Mitigation |
|---|---|
| `RESUME_ENCRYPTION_KEY` rotated or lost | Every sealed field becomes permanently unreadable and nothing detects it. Treat it as a data migration; the version byte exists so a real rotation can be built. §4.3 |
| The extractor invents a fact | Every field nullable, the prompt says absence is valid, `normalize()` clamps, and the user corrects it on a screen built for the purpose |
| A user never confirms the parse | They still get scores. Refusing to match until somebody taps something would make the feed worse to punish them for not tapping it. The screen keeps asking |
| Scores go stale against a re-crawled posting | `prune_match_scores()` at fourteen days — well inside how long a posting stays open, well outside how often one materially changes |
| The audit log becomes the largest table | `prune_pii_access_log()` at two years, matching phase 3's moderation retention |
| A hostile PDF | The bucket caps at 10 MB and accepts one MIME type; no PDF decoder runs in-process; the document is read by a model, not parsed by a library |
| Someone adds a `select` policy to the bucket "for convenience" | The audit log silently develops a hole exactly where the app's own reads are. `verify:phase4` reads the policy catalogue for this |

---

## 9. Deferred decisions this phase records rather than makes

- **Which embedding vendor.** Phase 5's, with the retrieval design in front of it. The column and
  index are ready and the dimension can still change for free. §3.
- **Decrypting contact fields.** Phase 6 needs them; phase 4 writes them and looks away.
- **Skipping a re-parse on an identical re-upload.** `content_hash` is stored and nothing reads it.
- **Page-1 thumbnails.** The bucket exists.
- **A parse queue.** `parse_status` already carries the state, so the client will not change.
- **The "why 43%" screen.** `components` is stored; the ring's caption is the one-word version.
- **Re-parse sweeps on a parser upgrade.** `parser_version` makes the affected set a `where`.
