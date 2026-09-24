# Running CareerDeck — phases 0 and 1

Companion to [README.md](./README.md), which is the plan, and
[PHASE1.md](./PHASE1.md), which is phase 1's design. This is the part you operate.

**Phase 0** is §15's first milestone: Supabase, migration tooling, auth, `profiles` /
`user_preferences` / `schools`, a seed script, the API service skeleton, Sentry wiring,
and the client reading identity and preferences from Postgres instead of a fixture.
*Exit condition: sign in on a device, edit your profile, it survives a restart.*

**Phase 1** is the corpus: `companies`, `job_sources`, `raw_postings`, `jobs`, the
Greenhouse / Lever / Ashby crawlers, dedup, staleness, full-text search, and a paginated
feed. *Exit condition: 10k+ real postings from 100+ companies, feed and search work,
dedup rate < 2%.*

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
| `npm run ingest` | Crawls every enabled source that is due, then sweeps |
| `npm run ingest:sweep` | The staleness pass on its own |
| `npm run server:dev` | The API service on :8787 — **not needed by the app in phase 1** |

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

### F. Fly.io — still not yet

`server/` holds the ingestion pipeline, which runs as a command. The app reads jobs
directly from Postgres (PHASE1.md decision B), so there is still nothing for a deployed
service to serve.

It comes due when phase 2 needs idempotency keys on writes and an impression batch
endpoint, or when phase 5's ranker needs a process. `server/fly.toml` has the commands in
its header comment. Secrets go through `fly secrets`, never into the file.

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

## 5. Troubleshooting

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
