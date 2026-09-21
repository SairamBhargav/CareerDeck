# Phase 0 — running it, and what still needs an account

Companion to [README.md](./README.md), which is the plan. This is the part you operate.

Phase 0 is §15's first milestone: Supabase, migration tooling, auth, `profiles` /
`user_preferences` / `schools`, a seed script, the API service skeleton, Sentry wiring,
and the client reading identity and preferences from Postgres instead of a fixture.

**Exit condition:** sign in on a device, edit your profile, it survives a restart.

---

## 1. Local, right now

Nothing below needs an account. Docker Desktop has to be running.

```bash
npm install
npm run db:start          # first run pulls ~2GB of images
npm run verify:phase0     # 34 checks against the live local stack
npx expo start
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
| `npm run seed:generate` | Rewrites `supabase/seed.sql` from `data/mock*.ts` |
| `npm run types:generate` | Rewrites `types/database.ts` — **run after every migration** |
| `npm run verify:phase0` | End-to-end check of the exit condition, plus the authz rules |
| `npm run server:dev` | The API service on :8787 |

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

### E. Fly.io — not yet

`server/` runs locally with `npm run server:dev` and the app does not call it: every read
phase 0 makes is expressible in RLS, which §2.1 says belongs on the Supabase client.
It earns a deployment in phase 1, when the ranked feed needs somewhere to live.

When that day comes, `server/fly.toml` has the commands in its header comment. Secrets go
through `fly secrets`, never into the file.

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
