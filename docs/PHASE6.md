# Phase 6 — Money and Auto Apply

**Status:** in progress. The ledger, the run schema and the client migration are built;
draft generation and the review sheet are not.

Design doc for §6 (Auto Apply), §7 (the credit ledger) and §8 (subscriptions) of
[README.md](./README.md). Where this document and that one disagree, this one is what was
built and the disagreement is argued below.

---

## Decisions taken for this phase

| | Decision | Where |
|---|---|---|
| **A** | Subscriptions are cut from this phase entirely. `entitlements` is not built either. | §1 |
| **B** | Auto Apply produces a draft the user carries to the employer. Nothing submits. | §2 |
| **C** | The daily grant happens lazily on read, not from a scheduled job. | §3.1 |
| **D** | Refunds ignore the bank cap. Every other grant respects it. | §3.2 |
| **E** | Credit writes await the server. They are not optimistic, unlike every other mutation. | §3.3 |
| **F** | `auto_apply_runs.resume_id` is nullable, against §6. | §3.4 |

---

## 0. What phase 6 is, in one paragraph

Every phase so far has built something the user gets for free. This is the one that builds
something to sell, and the honest version of that sentence is that it builds **half** of
it: the thing a credit buys, and the ledger that tracks credits, without the store
machinery that would let anyone buy more. The credit economy has existed in
[constants/goal.ts](../constants/goal.ts) since before there was a database, running
entirely on client state that a reload throws away. This phase makes it durable, gives it
something to spend on, and stops short of the register.

---

## 1. Subscriptions are cut — decision A

§8 specifies RevenueCat, `subscriptions` and `entitlements`. None of it is here.

`react-native-purchases` is a native module. This project is managed-workflow Expo with no
`expo-dev-client` and no `android/` or `ios/` directory, so **it cannot run in Expo Go at
all** — the only way to exercise a single line of it is to produce a development build
first. Past that, products have to exist in App Store Connect and Play Console before a
purchase can be tested, which requires an Apple developer account ($99/yr) and a Google
one ($25). Neither exists yet.

Writing the integration anyway would mean writing the one part of the system where bugs
cost money, with no way to run it. That is the worst possible thing to build blind.

**`entitlements` is cut with it, and that is the less obvious call.** The table itself is
cheap and §8's rule — *"every gate checks `entitlements`, not `subscriptions`"* — is
right. But an entitlements table with no writer is a lookup that always misses, and every
gate written against it would be a branch that has only ever taken one path. The gate that
exists today, `FREE_RESUME_LIMIT` in [constants/limits.ts](../constants/limits.ts),
already carries the note that it becomes plan-dependent later. One constant to change is a
better seam than a table nobody can populate.

What this phase does preserve: `credit_kind` declares `purchase` and `subscription_grant`
even though nothing produces them. Adding a value to an enum later is a migration that
cannot run in a transaction alongside anything using it, and the whole point of the ledger
is that a purchased credit is the same kind of object as a granted one.

---

## 2. Auto Apply does not apply — decision B

§6's flow ends: *"user taps through to the ATS with values ready to paste/autofill → user
confirms they submitted."* That is a **handoff**, and the name on the button oversells it.

It stays a handoff. Greenhouse's and Lever's terms both forbid automated submission, and
the entire job corpus — 30,800 postings across 140 companies — is crawled from them and
Ashby. Trading the corpus for a convenience feature is not a trade, and §4.3 already
frames crawl hygiene as the legal posture rather than politeness.

So `used` means *the user told us they submitted*, exactly as `applications.self_reported`
has meant since phase 2. Nothing in this system has ever observed a real submission and
this phase does not change that.

The expectation gap is real and is left open deliberately: the violet **Auto Apply**
button stays, because renaming it is a product call that wants to be made against the
review sheet once it exists, not against a schema.

### What the generator may not do

§6's second non-negotiable, restated because it constrains the schema: **never fabricate a
fact.** If the resume does not answer "years of Python experience", the field comes back
with a null value and a prompt — not a plausible number. `confidence` and `source` sit on
every field in `draft` so the sheet can mark what was inferred, and a UI that cannot tell
read-from-resume apart from guessed cannot honour the rule.

---

## 3. The ledger

§7 as written, with two departures.

Balance is `sum(amount)` and nothing stores it, so there is never a stored number and a
log to reconcile. `idempotency_key` is the durable version of the `paidWeeks` `useRef` in
[CareerDeckContext.tsx](../context/CareerDeckContext.tsx) — today a reload re-pays a
week's streak bonus and resets credits to the daily grant, and both are that ref and that
`useState` being lost rather than bugs in the logic.

**No table grants.** `credit_transactions` is reachable only through six functions, every
one of them scoped to `auth.uid()` and none of them taking a user id. This is phase 2's
decision about likes and follows (PHASE2.md §2.5) applied to something with an actual
price: a client holding an insert grant can write itself a `purchase` row.
`grant_credits()` is the one function not granted to `authenticated`, because it takes a
kind and a cap.

### 3.1 The daily grant is lazy — decision C

§7 lists "grant/streak/spend/refund **jobs**". The grant is not a job.

A scheduler this project does not have, doing work proportional to every account that has
ever existed, for a resource capped at five. Granting when the client reads its balance
does that work only for people who opened the app — the same read-that-writes shape as
phase 3's `comment_counts()` and phase 4's `match_scores()`.

The visible difference is that somebody returning after a month gets one credit rather
than thirty. At `bankCap: 5` that is not a difference: thirty clamp to five, and so does
one a day for the next four days.

The day boundary is UTC, so that travelling east cannot collect twice.

### 3.2 Refunds ignore the cap — decision D

The one asymmetry. A user at the cap who starts a run and abandons it would otherwise be
charged for changing their mind — and "backing out costs you a credit" is precisely the
pressure that gets somebody to submit a draft they have not read, which is the opposite of
what the review step exists for.

A refund only returns what a spend actually took. No spend row, no refund; otherwise the
function mints credits from nothing.

### 3.3 Credit writes are not optimistic — decision E

Phase 2 established the opposite rule for likes and follows: write the cache first,
reconcile later, because a like that flickers feels broken (Appendix A). Credits get the
opposite treatment, and the difference is worth naming.

A like is a claim the user is making. A balance is a number *we* are telling them about
their account, and the server is the only thing that knows it — the daily grant may have
landed, a cap may have clamped a bonus, a second device may have spent one. Showing a
guess and then correcting it means showing "2 left" and a moment later "1 left", which
reads as having been charged twice.

So every mutation in `useCredits` awaits the server and takes what it says. The cost is a
tap's worth of latency on the one number in the app that behaves like money.

The single exception: a `startRun` that comes back `null` writes 0 locally, because the
server has just said there was nothing to spend and the stale number on screen is the
thing that is wrong.

### 3.4 `resume_id` is nullable — decision F

§6 writes `resume_id uuid not null references resumes(id)`.

Generation needs a parsed resume to produce anything worth reviewing, so §6 is right about
what a *useful* run requires. But a required column makes the violet button conditional on
having uploaded one — a product change §6 never discusses, and resume upload only started
working on 2026-09-25, so almost nobody has. A run without a resume still records honestly
what happened: a credit was spent on this posting. The requirement belongs in the
generator, where it can be stated in words rather than expressed as a missing button.

---

## 4. Verification

`npm run verify:phase6` exists and has never been run, because there is no local stack
here to run it against. It needs `npm run db:start` and `npm run db:reset` first, and no
API service — phase 6 adds no routes.

Forty-seven checks. The ones that matter most are the replay checks: every idempotency
key is exercised twice, because a second call that pays out again is the most expensive
bug this phase could ship. Four assert what a client cannot do, and four assert *scope*
rather than behaviour — no subscriptions table, no entitlements table, nothing writing a
draft, and nothing marking a run `used`. That last one is decision B written as a test:
if it ever fails, something has started claiming an application was submitted.

**None of this SQL has ever executed.** There is no local Supabase on this machine — no
Docker — and the seven migrations before it have never been applied here either. The
phase 6 migration is written against the shapes in phases 0–5 and reviewed by reading, not
by running. First `db:reset` should be treated as the real first test of this file.

---

## 5. Still to build

- `POST /v1/auto-apply/:runId/draft` in `server/` — the generator. Needs
  `ANTHROPIC_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY`, neither of which is set in this
  machine's `server/.env`.
- The ATS form-schema fetch. Greenhouse, Lever and Ashby each publish the question set for
  a posting; this is the part with no design yet.
- The review sheet, and whatever the button ends up being called.
