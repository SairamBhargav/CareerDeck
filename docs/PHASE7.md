# Phase 7 — News, notifications, and launch obligations

Companion to [README.md](./README.md) §15. This covers the design, what was measured, and where
this phase departs from the plan.

**Written for:** whoever builds or reviews this phase, including someone who has read none of the
earlier phase documents.

**Exit condition (from §15):** *launch-ready.*

**Status:** everything in scope is built and verified locally. `npm run verify:phase7` passes 78
checks, including a live news ingest, and `npm run load-test` passes its budgets at 50 concurrent
readers. "Launch-ready" still depends on items only the owner can do (§8); none of them is code.

---

## Decisions taken for this phase

| # | Question | Chosen | Consequence |
|---|---|---|---|
| A | How is push delivered? | **Expo Push Service** *(owner's choice)* | One HTTP API for both platforms, no vendor SDK. Needs an EAS project id to issue tokens; Android needs a development build. §3.1. |
| B | Where does news come from? | **A curated RSS list** *(owner's choice)* | 24 company feeds and 3 TechCrunch feeds, each fetched live before it was added. No API keys and no terms-of-service ambiguity. §2.2. |
| C | Which model summarizes? | **Haiku 4.5** *(owner's choice)* | Measured at **~$0.002 per story**. Stories are summarized once and kept forever, suppressed ones included. §2.3. |
| D | What runs the background work? | **The API service, in-process** | No queue and no cron. Every job is claimed in the database, so several machines never double-send. §5. |
| E | How is an export delivered? | **In the response, as a download** | §13.2 says "signed URL". A bundle built in one request never needs to sit in a bucket. §4.2. |
| F | What happens to a deleted reader's comments? | **Moved to a tombstone account** | §13.2's own plan. The tombstone is created through the Auth admin API, not a migration, because the hosted platform may refuse writes to `auth`. §4.3. |
| G | How are news sources tied to companies? | **By slug, with the id resolved at ingest** | Migrations run before seeds, so a source cannot rely on its company already existing. §2.2. |

---

## 1. Scope

**In:**
- §3.11's news tables and §9's pipeline.
- The copyright-safe link-out.
- Push notifications (replies, moderation notices, job alerts, deadline reminders), with receipts.
- The weekly digest email.
- CCPA deletion (30-day grace, purge, anonymization) and export.
- A load test.
- Settings screens for all of it.

**Out, with the trigger to revisit:**

| Not built | Why | Trigger |
|---|---|---|
| A privacy policy and terms | Legal text is the owner's to write. §13.2 requires the comment-anonymization rule to be "disclosed … before the fact" | Before launch. §8 |
| Quiet hours for push | Job alerts are capped at one a day and deadline reminders at one per posting, so volume is already bounded | Complaints, or a second alert type |
| Hiring-relevance matching of industry news to companies | Company names are ordinary words ("Ramp", "Modal", "Mercury"), and naive matching would mislabel stories | A cheap entity pass is added to the summarizer |
| Push for comment likes | They aggregate on one inbox row by design. A buzz per like is how an app loses the notification permission | Never, probably |
| A capacity number | Local Docker can't give one. §6 | A staging project |

---

## 2. News

### 2.1 The copyright rule is a schema rule

§9: storing and redisplaying article text is infringement. `news_items` has **no column that
could hold a body**, and `verify:phase7` checks that. `summary` is at most three sentences and
900 characters, enforced by a check constraint. The feed's teaser goes to the summarizer and is
then dropped. The story sheet (`StoryArticleSheet`) shows the publisher's headline with their name
on it, then our summary labelled "Summary by CareerDeck", then **Read at {publisher}**, which opens
the real article in the in-app browser. `types/news.ts` lost `body` for the same reason, and
`data/mockNews.ts` is deleted.

### 2.2 The sources

Migration `20260930000001_news_sources.sql` seeds the sources. Every URL was fetched on
2026-09-28 and returned a parseable, recent feed. The obvious candidates that failed are listed
in that migration:

- Anthropic, MongoDB, Amplitude and Cockroach Labs returned 404.
- Coinbase and DoorDash returned 403.
- Dropbox returned 500.
- Cohere, LangChain, Asana and Brex redirect their feeds to HTML.

**The rule for adding a source is to fetch it first.**

Sources name their company by `company_slug`. The first run of that migration linked zero
company feeds, because migrations run before `seed.sql` loads companies. So the ingest resolves
the id from the slug and caches it on the row.

### 2.3 The pipeline, and what it costs

`server/src/news/`:

1. **`feed.ts`** parses RSS and Atom with no XML library, for the crawlers' reason: a parser for
   a hostile format has no place in the process that holds the service key.
2. **`summarize.ts`** makes one forced tool call to Haiku per story. The model is told to write its
   own words, copying at most six words in a row, and scores relevance to a student job-seeker.
3. **`ingest.ts`** is bounded. Per source per run it takes stories from the last 14 days only, at
   most 10, newest first, and dedups by `url_hash` before anything is billed. A first fetch of
   OpenAI's 1,233-item feed costs ten summaries.

A story is published if its relevance is at least **0.3** for a company's own feed, or at least
**0.6** for an industry feed. Everything below is kept as `suppressed`, so it is never summarized
again, and the threshold can move without re-billing.

**Measured:** three TechCrunch Layoffs stories cost $0.00184–$0.00204 each, over about 14 s.
The model scored "Uber is laying off 10% of staff" at 0.9 relevance, topic `layoffs`.

---

## 3. Delivery

### 3.1 Push — decision A

- **Tokens.** `push_tokens` is unique on the token, so a phone that signs into a second account
  moves to it. Sign-out unregisters first (`AuthContext`). Permission is asked only when the
  reader turns push on in Settings, never at launch. A launch refreshes the registration silently
  if permission already exists.
- **What pushes.** Every new notification except `comment_like` is set to `pending` by a trigger.
  The default is `none`, so the migration pages nobody about last month's rows.
- **Sending** (`notify/push.ts`). `claim_push_batch()` uses `for update skip locked`. It marks as
  `skipped` anything that is pointless to send: no live device, that kind switched off, an
  account being deleted, or older than a day. The rest goes to Expo in chunks of 100. Each push
  carries `data.url`, so a tap opens the posting.
- **Receipts.** Tickets older than 15 minutes are checked. `DeviceNotRegistered`, on a ticket or
  a receipt, retires the token.
- **What a lock screen shows** is only what the inbox row already shows: the pseudonym, the reply
  text, a posting title.

### 3.2 Alerts and deadlines

- **`generate_job_alerts()`**: at most one alert per reader per day, however many postings are
  new ("4 new roles at companies you follow"). It covers postings at followed companies first
  seen since the last alert, respects stated employment types, and skips hidden postings.
- **`generate_deadline_reminders()`**: one reminder per saved posting that closes within three
  days and hasn't been applied to. A unique index makes it once per posting, ever.

Both write ordinary `notifications` rows with `headline`, `detail` and `job_id` in the payload,
which is what the existing inbox card renders. They appear in Activity without a client change.

### 3.3 The weekly digest

`claim_digest_batch()` claims a reader for the week **before** anything is sent. A crash leaves a
`sending` row, never a second email. A reader with nothing to say (no new postings at followed
companies, nothing saved closing this week) is recorded as `skipped`, not emailed.

CAN-SPAM drives most of the design:

- **An HMAC-signed unsubscribe link** that works without a login.
- **`List-Unsubscribe` and `List-Unsubscribe-Post`** headers (RFC 8058, which Gmail and Yahoo
  require of bulk senders).
- **A postal address.**

`GET /unsubscribe` changes nothing, because mail scanners follow links; only POST unsubscribes.
`capabilities.digest` is false unless Resend, `PUBLIC_API_URL`, and in production a postal
address and a real signing secret are all set. Nothing sends while it is false.

---

## 4. Privacy

### 4.1 Deletion

- **`request_account_deletion()`** sets `profiles.deleted_at`, and phase 0's profile policy
  (`deleted_at is null`) disables the account at once. The app's shell sees an unreadable
  profile, asks `my_account_status()`, and shows **AccountGate**: "scheduled for deletion on
  {date}", with **Keep my account** or **Sign out**. Pushes and digests stop immediately.
  Comments stay up under the pseudonym during the grace period, so changing your mind restores a
  thread rather than a hole.
- **The purge** (`purgeAccount`, every 6 hours for requests past 30 days) runs in this order:
  1. In SQL: re-point comments to the tombstone and dissociate impressions to one random id.
  2. Delete storage objects.
  3. Delete the RevenueCat customer, if a secret key is set.
  4. Delete the auth user; the cascade takes the rest.
  5. Close the request.

  Every step is safe to repeat. `deletion_requests` has no foreign key: it survives as the record
  that the deletion happened.

### 4.2 Export — decision E

`POST /v1/me/export` returns the whole bundle as an attachment with `no-store`, rate-limited to
one a day. It covers 27 sections:

- profile, preferences, follows and interactions;
- applications with their events;
- comments, comment likes, reports filed and strikes;
- verifications (the `.edu` address, not the hashes);
- notifications, resumes with parsed fields, and the resume contact details, opened and logged
  as `export`;
- the credit ledger, subscription, entitlements and Auto Apply drafts;
- devices, and impressions summarised by month;
- **`who_accessed_your_data`** from `pii_access_log`, which CCPA's right to know covers.

The app writes it to cache and opens the share sheet.

### 4.3 The tombstone — decision F

The tombstone is created on first use through the Auth admin API: no password, a century-long
ban, handle `deleted-account`. It is recorded in `system_accounts`. A migration writing
`auth.users` works locally and may not on the hosted platform. The verify script confirms it
can't sign in and that anonymized comments render as `deleted-account`.

---

## 5. The job runner — decision D

`server/src/jobs.ts` holds push (15 s), receipts (10 min), alerts (30 min), news (3 h), digest
(Mondays from 14:00 UTC), purge (6 h) and prune (daily). The API service is already long-running
on Fly, and every job claims its work in the database, so two machines never double-send. That is
what a queue would buy, and it's already bought. Jobs are on by default in production and **off in
development**, so a laptop pointed at the hosted project doesn't start paging real users. The same
file is a CLI (`npm run jobs -- push`) for manual runs.

---

## 6. Load test

`npm run load-test` runs N real accounts doing what the app does on open and while scrolling:
viewer state, credits, stories and inbox in parallel, then a ranked feed session with three pages,
flushing impressions per page.

It found one real problem. **`my_credits()` took the ledger's row lock on every read**, and a row
lock writes to the tuple and the WAL. It missed its budget, and it dragged the other reads' tails
up with it:

| at 50 readers, 233 req/s | before, p95 | after, p95 |
|---|---|---|
| `my_credits` | **301 ms** (over) | 117 ms |
| `viewer_state` | 234 ms | 125 ms |
| `notifications` | 232 ms | 109 ms |
| `feed: build session` | 255 ms | 267 ms |
| `feed: next page` | 81 ms | 83 ms |

The fix (in the phase 7 migration) checks whether a grant is due before locking. The idempotency
key was always the real guard. Phase 6's verify, including five parallel reads paying one grant,
passes on the new function.

**This is a regression test, not a capacity number.** It ran against Docker on the same laptop
generating the load, over a seed corpus of 53 postings. For a capacity number, run it against a
**staging** project:

```
LOAD_SUPABASE_URL=… LOAD_ANON_KEY=… LOAD_SERVICE_ROLE_KEY=… LOAD_I_UNDERSTAND=staging npm run load-test
```

It refuses any non-local URL without that flag. Never point it at production: every virtual reader
writes impressions.

---

## 7. Verification

`npm run verify:phase7` needs the service on the local stack (see PHASE6.md §7 for the command,
plus `PUBLIC_API_URL`). It runs the real jobs as child processes, with push sent to a stand-in for
Expo's API served by the script. **78 checks, 0 failures.**

**Caught by verification:**

- **`canonicalUrl` kept a trailing slash when a query string followed it.** Syndicated copies
  would have been summarized, and billed, twice.
- **The first push run sent nothing, and the sender was right.** The script ran jobs with
  `execFileSync`, which blocked the event loop the stand-in answered on. Every send timed out and
  was correctly recorded as failed. Jobs now run asynchronously.
- **A preference change was placed before the first send**, so the reply the next checks
  depended on was, correctly, skipped. The checks now switch the preference after that send.

`verify:phase5`'s route check lists `/me` and `/unsubscribe`. Phase 6's verify passes on the
changed `my_credits`.

---

## 8. What needs the owner before launch

1. **Push the five pending migrations** (`npm run db:push`): `20260927`, `20260928`, `20260929`,
   `20260930000000` and `20260930000001`.
2. **`eas init`**, so push tokens can be issued, then a development build for Android push and
   for real purchases.
3. **Digest:** a verified Resend sending domain, `PUBLIC_API_URL`, `DIGEST_FROM_EMAIL`,
   `DIGEST_POSTAL_ADDRESS` and `UNSUBSCRIBE_SECRET`.
4. **A privacy policy and terms.** They must disclose comment anonymization on deletion (§13.2),
   the subprocessors (Supabase, Anthropic, Expo, RevenueCat, Resend, Sentry), and "we do not sell
   or share" (§13.3). Replace the two "Soon" rows in Settings with links.
5. **A staging project** and one load-test run against it at the compute size you'll launch on.
6. **Deploy the API service** with `BACKGROUND_JOBS` on (the default in production).
