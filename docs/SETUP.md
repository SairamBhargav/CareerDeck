# Running CareerDeck

Companion to [README.md](./README.md), which is the plan, and the per-phase designs
([PHASE1.md](./PHASE1.md), [PHASE2.md](./PHASE2.md), [PHASE3.md](./PHASE3.md)). This is the part you
operate.

**Phase 0** is §15's first milestone: Supabase, migration tooling, auth, `profiles` /
`user_preferences` / `schools`, a seed script, the API service skeleton, Sentry wiring,
and the client reading identity and preferences from Postgres instead of a fixture.
*Exit condition: sign in on a device, edit your profile, it survives a restart.*

**Phase 1** is the corpus: `companies`, `job_sources`, `raw_postings`, `jobs`, the
Greenhouse / Lever / Ashby crawlers, dedup, staleness, full-text search, and a paginated
feed. *Exit condition: 10k+ real postings from 100+ companies, feed and search work,
dedup rate < 2%.*

**Phase 2** is what the reader did: follows, likes, saves, the application tracker, impressions, an
offline outbox. *Exit condition: every existing UI interaction persists; impressions logging at
volume.*

**Phase 3** is what they say: both verification paths, comments, moderation in the write path, the
strike ladder, reports, blocks, notifications, realtime threads, and an internal review queue.
*Exit condition: verified users comment, moderation blocks the obvious, review queue staffed,
content policy published.*

**Phase 3 is the first phase where `npm run server:dev` is not optional** — posting a comment and
verifying an address both go through it, because a moderation classifier and an email provider each
need a secret. Everything else in the app still talks to Postgres directly.

---

## 1. Local, right now

Nothing below needs an account. Docker Desktop has to be running.

```bash
npm install
npm --prefix server install
npm run db:start          # first run pulls ~2GB of images
npm run db:reset          # migrations + seed: 156 skills, 143 companies, 53 postings
npm run verify:phase0
npm run verify:phase1
npx expo start
```

The app is usable at this point without ever running a crawler — the fixtures are seeded
as real rows (§2.2: *"keep them working so local dev never needs a crawler"*). For the
real corpus:

```bash
npm run ingest            # ~2 minutes, 124 public boards, no API keys, $0
npm run verify:phase1     # the corpus checks now pass too
```

`.env.local` already points at the local stack. `npm run db:status` prints the URLs —
Studio is on :54723 and the mail catcher, where sign-in codes land, is on :54724.

Ports are 547xx rather than the usual 543xx: on Windows, Hyper-V reserves shifting blocks
of the ephemeral range and the default 54320-54329 sits inside one. See the note at the
top of `supabase/config.toml`.

### What runs where

| Command | Does |
|---|---|
| `npm run db:start` / `db:stop` | The local Supabase stack |
| `npm run db:reset` | Drops it, re-applies migrations, re-seeds |
| `npm run db:push` | Applies migrations to the linked hosted project |
| `npm run seed:generate` | Rewrites `supabase/seed.sql` from the fixtures and the board list |
| `npm run types:generate` | Rewrites `types/database.ts` — **run after every migration** |
| `npm run verify:phase0` | Identity, preferences and the phase 0 authz rules |
| `npm run verify:phase1` | The pipeline, the read API, the authz rules, and the corpus metrics |
| `npm run verify:phase2` | Every interaction write path, the authz rules, and impression throughput |
| `npm run verify:phase3` | Verification, commenting, moderation, the leak checks — needs `server:dev` for half of it |
| `npm run db:maintain` | The nightly jobs: impression partitions, counter reconciles, verification expiry, notification retention |
| `npm run ingest` | Crawls every enabled source that is due, then sweeps |
| `npm run ingest:sweep` | The staleness pass on its own |
| `npm run server:dev` | The API service on :8787 — **required for commenting and verification from phase 3** |

### Crawling

| Command | Does |
|---|---|
| `npm run ingest` | Every source whose `crawl_interval` has elapsed |
| `npm run ingest -- --force` | Every enabled source, ignoring the interval and stored ETags |
| `npm run ingest -- --source=stripe` | One board, by company slug or board token |
| `npm run ingest -- --source=stripe --dry-run` | Parses and prints. Writes nothing, not even a run row |
| `npm run ingest -- --limit=10` | The ten most overdue sources |
| `npm run ingest -- --sweep` | Close postings nobody has seen for 48h |

A second run right after the first does almost nothing, and that is the system working:
boards answer `304 Not Modified` against the stored ETag, and any posting that did change
is compared by content hash before anything downstream fires.

**The service does not serve the app.** Phase 1 reads jobs straight from Postgres through
SQL functions, so `npm run server:dev` is not part of the loop — see PHASE1.md decision B.
What `server/` holds now is the whole ingestion pipeline, which runs under the service role
and is the half of the work that genuinely cannot live on a client.

### The one local caveat

`127.0.0.1` on a phone is the phone. Local Supabase works on web, the iOS simulator and
the Android emulator; a physical device needs either your machine's LAN address in
`.env.local` or — easier, and https, so neither iOS ATS nor Android cleartext blocking
gets in the way — a hosted project.

---

## 2. What needs you

### A. A Supabase project — required for the exit condition

Free tier. Everything else on this page is optional.

1. Create a project at [supabase.com/dashboard](https://supabase.com/dashboard).
2. **Project Settings → API.** Copy into `.env.local`:
   - `EXPO_PUBLIC_SUPABASE_URL` — `https://<ref>.supabase.co`
   - `EXPO_PUBLIC_SUPABASE_ANON_KEY` — the key labelled **anon public**, or
     **publishable** on newer projects. Not the service role key; that one never goes
     near the app.
3. Push the schema:
   ```bash
   npx supabase login
   npx supabase link --project-ref <ref>
   npx supabase db push --include-seed
   ```
4. **Authentication → Emails → Magic Link.** Replace the body with
   `supabase/templates/magic-link.html` and set the subject to
   "Your CareerDeck sign-in code".

   This one is not optional. The stock template sends a *link*; `app/sign-in.tsx` asks
   for a six-digit code. Skip it and sign-in fails with "that code is wrong".
5. Restart the dev server with `npx expo start --clear`. Expo bakes env vars into the
   bundle, so a plain restart keeps serving the old values.

> **Do not run `supabase config push`** against this project without running
> `supabase config diff` first. Our `config.toml` carries `supabase init`'s local
> defaults — including `site_url = "http://127.0.0.1:3000"` — and pushing it would
> overwrite the hosted settings with them.

Email sign-in works at this point, on any device, in Expo Go.

### B. Google sign-in — optional

1. **Google Cloud Console → APIs & Services → Credentials.** Create an OAuth client of
   type *Web application*. Under Authorized redirect URIs add:
   `https://<ref>.supabase.co/auth/v1/callback`
2. **Supabase → Authentication → Providers → Google.** Enable it, paste the client ID
   and secret.
3. **Supabase → Authentication → URL Configuration → Redirect URLs.** Add:
   - `careerdeck://*` — development and production builds
   - `exp://*` — Expo Go

   The app asks `expo-auth-session` for its own redirect URI, which is `careerdeck://` in
   a build and `exp://<lan-ip>:8081/--/` in Expo Go. A URI that isn't on this list is
   refused by Supabase, and the browser sheet closes with nothing having happened.

### C. Sign in with Apple — optional, and the expensive one

Needs a paid Apple Developer account ($99/year). iOS only; the button hides itself
everywhere else.

1. **developer.apple.com → Certificates, Identifiers & Profiles → Identifiers.** Create
   an App ID for `com.careerdeck.app` with the **Sign In with Apple** capability.
   (Change the bundle identifier in `app.json` first if you want a different one.)
2. **Supabase → Authentication → Providers → Apple.** Enable it, and under
   *Authorized Client IDs* add:
   - `com.careerdeck.app`
   - `host.exp.Exponent` — only if you want to test it inside Expo Go

Apple hands over the user's name exactly once, on first authorisation, and never again.
`AuthContext.signInWithApple` copies it into user metadata immediately for that reason —
if you wipe the test account, revoke the app under Settings → Apple ID → Sign in with
Apple too, or the second sign-in arrives nameless.

### D. Sentry — optional, and needs a development build

`@sentry/react-native` is a native module: it does not exist in Expo Go. Until it has a
DSN the SDK is never even loaded, so leaving this empty costs nothing (`lib/observability.ts`
falls back to `console.error`).

1. Create a React Native project at [sentry.io](https://sentry.io).
2. Put the DSN in `EXPO_PUBLIC_SENTRY_DSN` (app) and `SENTRY_DSN` (`server/.env`).
3. Make a development build — `npx expo run:ios` / `run:android`, or EAS.
4. For readable native stack traces, add the source-map plugin to `app.json` with your
   org and project:
   ```json
   ["@sentry/react-native/expo", { "url": "https://sentry.io/", "organization": "...", "project": "..." }]
   ```

### E. Scheduled crawling — optional, $0

`.github/workflows/ingest.yml` runs the crawl and the sweep nightly against a hosted
project. It ships inert: without two repository secrets it exits with a notice instead of
failing every night.

1. **Settings → Secrets and variables → Actions.** Add:
   - `SUPABASE_URL` — `https://<ref>.supabase.co`
   - `SUPABASE_SERVICE_ROLE_KEY` — Project Settings → API → **service_role**

**Read the workflow's header before you add the second one.** That key bypasses every RLS
policy in the project; storing it in a GitHub secret means trusting Actions, the workflow
file, and everyone who can push to it. It is a normal thing to do and it is also a real
decision, which is why nothing enables it for you.

Cost: about 150 of a private repository's 2,000 free Actions minutes per month, nothing on
a public one. Nightly rather than four-hourly because there are no users waiting on a
posting yet — `crawl_interval` is still honoured within a run, so tightening the cadence
later is one line of cron.

### F. The API service — now due

Phases 1 and 2 needed nothing deployed: the app read jobs and wrote interactions straight to
Postgres through RLS (PHASE1.md decision B), and `server/` held only the ingestion pipeline, which
runs as a command.

Phase 3 changed that. Two things now genuinely cannot live in the client:

- **`POST /v1/comments`** runs §10's moderation classifier, which needs a model credential.
- **`/v1/verify/*`** sends a code to a school address and starts an identity check, which need an
  email provider and a vendor's signing secret.

Locally that is just `npm run server:dev` plus `EXPO_PUBLIC_API_URL=http://127.0.0.1:8787` in
`.env.local`. On a physical device use your machine's LAN address, for the same reason the Supabase
URL needs one.

For a real deployment, `server/fly.toml` has the commands in its header comment. Secrets go through
`fly secrets`, never into the file. `GET /health` reports which capabilities are actually live, so a
deploy can be checked without reading the environment.

**Without any of it, the app still runs.** Feeds, search, saving, following, applying, the tracker
and every collection work exactly as before; the comment composer says commenting is unavailable
rather than failing a request nobody can diagnose. PHASE3.md §8 has the full degradation table.

### G. Moderation and verification credentials — needed before real users

All four are optional, all four are in [`server/.env.example`](../server/.env.example), and each one
degrades in a specific documented way rather than crashing.

| Variable | What it turns on | Without it |
|---|---|---|
| `ANTHROPIC_API_KEY` | The moderation classifier | Comments still post. The doxxing regex and threat lexicon still run; anything they miss is published as `flagged` and waits for a human. The server warns on every boot. |
| `RESEND_API_KEY` | Delivering `.edu` verification codes | In development the code comes back in the response so the flow is testable. In production the route returns 503. |
| `PERSONA_TEMPLATE_ID` + `PERSONA_WEBHOOK_SECRET` | The government-ID path | That path returns 503 and the webhook refuses every request. The `.edu` path is unaffected. |
| `VERIFICATION_PEPPER` | Makes a ban stick to the credential | Defaulted, and **must match the database**. Changing it un-bans everyone banned under the old value. |

Two of these are worth a warning rather than a row.

**Shipping without a classifier is a decision, not an oversight.** Every comment posts as `flagged`
and lands in the review queue, which is safe only if somebody is actually working the queue. It is
the right setup for local development and the wrong one for real users.

**`MODERATION_MODEL` is a real trade and the default is not obviously right.** §10 budgets 50–200ms
for the classifier call; `claude-opus-5` with adaptive thinking does not fit that at p95, and
`claude-haiku-4-5` does, for less money and some accuracy. Measure your own p95 before changing it —
PHASE3.md §4.3.

### H. A moderator account — before launch, not after the first incident

§10 asks for the review queue to exist before launch, so it does. Getting into it takes two steps,
and neither is self-service on purpose — granting yourself moderator is precisely the escalation the
allow-list guards against.

1. Create the account with a password (the Supabase dashboard, or `auth.admin.createUser`). The app
   itself uses email codes and OAuth; the review page signs in with a password because a browser has
   no app session.
2. Insert the row:

   ```sql
   insert into public.moderators (user_id, email, can_ban)
   values ('<uuid>', 'you@example.com', true);
   ```

   `can_ban` is separate because a ban burns the verification credential and cannot be walked back —
   a new reviewer can work reports on their first day without that power.

Then open `/moderation` on the service. A non-moderator gets a 404 there, not a 403: an endpoint that
admits to existing is an endpoint worth probing.

---

## 3. Expo Go vs a development build

| | Expo Go | Development build |
|---|---|---|
| Email code sign-in | ✅ | ✅ |
| Google sign-in | ✅ | ✅ |
| Apple sign-in | iOS, with `host.exp.Exponent` registered | ✅ |
| Sentry | ❌ | ✅ |

Expo Go is enough for the whole of phase 0. The dev build matters for Sentry and, later,
for anything with a native dependency.

---

## 4. What phase 0 actually built

### Database

`supabase/migrations/20260921000000_phase0_identity.sql` — §3.1's `profiles`,
`user_preferences` and `schools`, plus the `verification_tier` enum §3.2 hangs its ladder
on. Three pieces are worth knowing about:

- **Profiles are provisioned by a trigger**, not by the client. `handle_auth_user_change`
  runs inside the signup transaction and creates both rows, splitting a name out of
  whatever the provider sent. The client has no insert privilege on `profiles` at all, so
  it cannot author a row for an id that isn't its own.
- **Column grants, not just RLS.** RLS decides which rows you reach; it cannot say "this
  row but not that column". Without the narrow `GRANT UPDATE (...)`, an authenticated
  user could PATCH their own `verification_tier` to `identity` and mint themselves a
  verified badge. `verify:phase0` checks that they can't.
- **`comment_badge` is composed by the database** from the *verified* school
  (`school_id`), never from `school_name_raw`, which is free text the user typed. In
  phase 0 nothing sets `school_id`, so the badge is null — correct until §3.2's
  verification exists.

### Client

`CareerDeckContext` keeps its shape. `user`, `preferredRoles`, `preferredLocations` and
`weeklyGoal` are now Supabase reads and writes with optimistic updates; everything else is
still in-memory mock state for phases 1 and 2 to move. The one visible change to its
contract is that `user` is `User | null` — a brand-new account has an email and nothing
else, so the screens that show a name now have an answer for not having one.

Sessions are encrypted at rest: AES key in the Keychain / Keystore, ciphertext in
AsyncStorage, because a Supabase session is several times SecureStore's practical limit.

---

## 5. What phase 1 actually built

Design and reasoning: [PHASE1.md](./PHASE1.md). The operational summary:

### Database

`supabase/migrations/20260922000000_phase1_jobs.sql` — §3.3's `companies`, §3.4's
`job_sources` / `raw_postings` / `jobs`, plus `skills`, `job_dedup_review` and
`crawl_runs`. Worth knowing:

- **`raw_postings` is immutable.** Insert only. It is the audit trail and the reprocessing
  input: when the normalizer has a bug, the fix replays from here instead of re-crawling
  every board. `unique (source_id, external_id, content_hash)` is the whole re-crawl
  strategy — an unchanged posting conflicts and no downstream work fires.
- **Jobs and companies are world-readable; the operational tables are not.** A `select` on
  `raw_postings` is a select on every payload ever fetched, so it carries no grant at all.
  RLS filters `jobs` to `status = 'open'`, which is why a closed posting 404s rather than
  rendering a dead Apply button.
- **The dedup key is a generated column.** The pipeline computes everything else, but two
  writers that disagreed about this formula would produce two rows for one posting and the
  unique index would never fire.

### Crawling

Three adapters behind one interface, one pipeline, and hygiene enforced in `http.ts` rather
than left to each adapter: a `User-Agent` with a contact URL, robots.txt honoured per host,
a per-host concurrency cap and minimum gap, conditional GETs, backoff on 429/5xx, and
auto-disable after five consecutive failures. There is no credential anywhere in
`server/src/ingest` — §4.3's "only public, unauthenticated endpoints" is enforced by there
being nothing to log in with.

To stop crawling someone, one statement:

```sql
update job_sources set enabled = false, notes = 'Takedown request 2026-09-23'
 where board_url = 'https://boards.greenhouse.io/<token>';
```

Re-seeding never re-enables it — `generate-seed.ts` deliberately leaves `enabled` and
`notes` alone on conflict.

### Client

`jobs` and `companies` are gone from `CareerDeckContext`. Screens read
`hooks/useJobFeeds.ts` and `hooks/useCompanies.ts`, which page through the database via
`lib/api.ts` — the one file that knows how a job is fetched, and therefore the only file
phase 5 has to change. Home is a real `FlatList` now rather than a mapped array inside a
`ScrollView`, and Reels' pull-to-refresh performs an actual refetch instead of rotating
the array.

Likes, saves and follows stay in memory for one more phase. The feed hooks merge them onto
each posting as `isSaved` / `isLiked`, which is the same merge the context used to do and
the same shape the server will fill in phase 2 (§1.3a).

**The Activity tab reads empty, and that is expected.** `mockApplications` points at
fixture job ids that no longer exist — PHASE1.md §8.6. Phase 2's real `applications` table
is what fills it.

---

## 6. What phase 3 actually built

### Database

`20260924000000_phase3_social.sql` — one migration, applied by `npm run db:reset` alongside phases
0-2.

- **Pseudonyms.** `profiles.handle` has existed since phase 0 and was never filled. It is now
  generated at signup from `handle_words`, and a comment shows `quiet-otter-4821` plus the badge
  composed from the school the account *verified* — never the one they typed.
- **`verifications`** and **`verification_blocklist`**. Both §3.2 paths, and the peppered digest that
  makes a ban stick to the credential rather than to the account.
- **`comments`**, **`comment_likes`**, **`blocks`**, **`reports`**, **`user_strikes`**,
  **`notifications`**, **`moderators`**.
- **`comments_public`** and **`notifications_public`** — the projections that make the anonymity
  contract structural. The base `comments` table is readable by nobody: `author_id` is never one
  `select *` away.
- **`post_comment()`**, service-role only, which enforces tier, strikes, the rate limit, thread
  depth, policy acceptance and idempotency in SQL, so the service supplies only a classifier verdict.
- **Realtime on threads**, as a broadcast of the public projection on a private per-posting topic —
  not `postgres_changes`, which would send `author_id` to every listener.

### Service

`npm run server:dev`. Three groups of routes, on top of phase 0's skeleton:

- `POST /v1/comments` — §10's pipeline: doxxing regex, threat lexicon, hosted classifier, then the
  SQL write path. A refusal is a 422 with a sentence the writer can act on.
- `/v1/verify/edu/{start,confirm}`, `/v1/verify/identity/start`, `POST /webhooks/persona`.
- `/v1/moderation/*` and the review page at `/moderation`.

### Client

- Comments are real, paginated, live, and moderated. The composer knows in advance whether this
  account can write and says why not.
- The content policy is shown before a first comment and its version is recorded.
- Reporting and blocking are one sheet, keyed by the comment, because the client holds no author id.
- `app/verify.tsx` offers **both** verification paths as peers — §3.2 makes them siblings, and
  hiding the ID path behind a failed `.edu` attempt would strand exactly the people it is for.
- The Activity tab's third list is now the notification inbox: replies, aggregated likes, and
  moderation and verification notices.
- `data/mockComments.ts` and `data/mockCommentActivity.ts` are gone.

### Checking it

```
npm run db:reset
npm run server:dev      # in another terminal
npm run verify:phase3
```

116 checks. With the service down it skips the HTTP half and says so, and still fails on anything
wrong with the database half. A third of the checks exist to prove the phase does not *leak*: every
response shape the client can obtain is searched recursively for `author_id`, `actor_id`,
`issued_by` and `moderation_scores`, because this is the one phase where a working feature and a
broken promise look identical from outside.

---

## 7. Troubleshooting

| Symptom | Cause |
|---|---|
| `EXPO_PUBLIC_SUPABASE_URL is not set` | No `.env.local`, or the dev server predates it. `npx expo start --clear`. |
| "That code is wrong or has expired" on a fresh code | The hosted Magic Link template still sends a link. Step A4. |
| Google sheet opens, closes, nothing happens | The redirect URI isn't in Supabase's allow-list. Step B3. |
| "This account has no profile row" | The account predates the migration. Delete it in Authentication → Users and sign in again. |
| `supabase start` fails to bind a port | Another reserved range moved. `netsh interface ipv4 show excludedportrange protocol=tcp`, then pick free ports in `config.toml`. |
| `verify:phase0` fails at sign-in after passing a moment ago | Each run creates two accounts and GoTrue rate-limits sign-ups per five minutes. Wait a minute. |
| Types disagree with the database | `npm run types:generate` after every migration. |
| The feed is empty after `db:reset` | The 53 fixture postings are seeded; if even those are missing, `npm run seed:generate` then reset again. |
| `verify:phase1` reports `MISS` on the corpus checks | Expected on a fresh database. Run `npm run ingest`. |
| A board 404s in the crawl output | The company renamed or retired that board. Fix or remove its row in `scripts/board-list.ts`, then `npm run seed:generate`. |
| A crawl says "Nothing due" | Sources are only crawled once per `crawl_interval`. `--force`, or `--source=<slug>`. |
| Every source fails at once | Usually no network, or `server/.env` pointing somewhere unreachable. A single run where *all* sources fail exits non-zero on purpose. |
