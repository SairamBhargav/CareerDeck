# Phase 2 — Interactions and tracking

Companion to [README.md](./README.md) §15, which says what phase 2 is in four lines. This
is the design: every table, every write path, every client file that changes, and the
reasons for each deviation from the plan.

**Written for:** whoever builds or reviews this phase, including someone who has read
neither [PHASE1.md](./PHASE1.md) nor the client.

**Exit condition (from §15):** *every existing UI interaction persists; impressions
logging at volume.*

---

## Decisions taken for this phase

Six questions were open when this document was first written. They are settled, and the
rest of the document reflects the answers rather than the alternatives.

| # | Question | Chosen | Consequence |
|---|---|---|---|
| A | Does the server fill `viewer` per feed row, or does the client merge sets? | **One `viewer_state()` read per session, merged client-side** | Feed pages stay identical for every reader and stay cacheable — §1.3(a)'s actual point. `feed_jobs` is untouched. §3. |
| B | How are likes, saves and follows written? | **`security definer` RPCs, set-to-a-state** | No insert or delete grant on either table. One write path, idempotent, and `user_id` cannot be supplied. §4. |
| C | What backs the offline outbox? | **AsyncStorage, no NetInfo** | Appendix A suggests expo-sqlite or MMKV; both are native modules and neither is a dependency. A foreground drain plus backoff covers the case that happens. §5. |
| D | Are application writes keyed by row id or by job? | **By `job_id`** | `unique (user_id, job_id)` makes it a real key, and an offline "applied" followed by "interview" does not need an id the first operation has not been issued. §4.3. |
| E | Do impressions go through the outbox? | **No — buffered in memory, dropped on failure** | Telemetry must never block intent, and 3M rows/day is not something to make durable on a phone. §6. |
| F | Does the Following feed become a join? | **No — it still filters by slug array** | PHASE1 §7.3 expected a join. The slugs are already in memory from `viewer_state()`, and a join means dropping and recreating `feed_jobs`. §9.2. |

**A is the load-bearing one**, and it is the one that contradicts what phase 1 wrote down.
`lib/api.ts` said "in phase 2 the server fills it and the overlay is deleted"; §3 argues
why it should not, and the overlay stays. Nothing else in this phase changes if that call
is reversed later — which is the test of whether it was a safe one to make.

---

## 0. What phase 2 is, in one paragraph

Today every like, save, follow and tracked application in the app lives in a `useState`
inside `CareerDeckContext`, and a cold start throws all of it away. Phase 2 makes them
rows: `company_follows`, `job_interactions`, `applications` and `application_events`,
written optimistically, queued through a durable outbox so a tunnel cannot lose one, and
read back as the same sets the context used to hold. Alongside them it adds
`job_impressions` — the highest-volume table in the system and the one §3.6 says buys a
phase 5 ranker — logged in batches from every surface that shows a posting, with dwell
time on Reels. The Collections screens and the weekly goal stop being fixtures and start
being reads.

Nothing about *who the user is* changes — that was phase 0. Nothing about *what there is
to look at* changes — that was phase 1. Comments, resumes and Auto Apply credits are still
in memory, and are phases 3, 4 and 6 respectively.

---

## 1. Scope

### In

| # | Deliverable | § |
|---|---|---|
| 1 | `company_follows`, `job_interactions`, `applications`, `application_events`, `job_impressions` | 2 |
| 2 | RLS and column grants on all five; likes and follows writable only through functions | 2.5 |
| 3 | `viewer_state()` — the viewer half of the `{job, viewer}` envelope | 3 |
| 4 | `set_job_interaction()`, `set_company_follow()`, `log_impressions()` | 4 |
| 5 | Follower-count trigger, nightly reconcile, monthly impression partitions, 13-month retention | 2.4, 7 |
| 6 | Optimistic mutations with an ordered, durable offline outbox | 5 |
| 7 | Impression logging on Reels (with dwell), Home, search, a company page and the collections | 6 |
| 8 | Collections and the weekly goal reading real rows | 9 |
| 9 | `npm run verify:phase2` | 10 |

### Out, and where it goes instead

| Not built | Why | Where |
|---|---|---|
| `comments`, `notifications`, likes on comments | Needs the verification ladder to exist first — an anonymous badge is a phase 3 object | Phase 3 |
| `resumes`, `job_match_scores` | The match ring still reads `utils/resumeMatch.ts`, which §1.2 marks for deletion | Phase 4 |
| Ranking, `feed_sessions`, a seen-penalty from impressions | Phase 2 *writes* the training data; reading it is the next phase that needs it | Phase 5 |
| `credit_transactions` | The Auto Apply balance is still a number in memory | Phase 6 |
| `application_intents` (§12's weak signal at tap-Apply) | One more table for a signal nothing reads yet. `applications` is the strong version and it is built | Phase 5, with the ranker that would use it |
| `hide` / `not_interested` UI | The enum values and the table support them; no screen offers them yet | Whenever the feed earns a negative action |
| `news_seen` | News is phase 7, and `markNewsSeen` is still per-session | Phase 7 |

---

## 2. Schema

[`supabase/migrations/20260923000000_phase2_interactions.sql`](../supabase/migrations/20260923000000_phase2_interactions.sql).
Nothing in phase 0 or phase 1 is altered — every object is new. That is worth stating
because the alternative was live: filling viewer columns on `job_card` would have meant
altering a composite type that four functions return, in a migration that cannot be tested
without Docker. §3 explains why that turned out to be the wrong idea for better reasons
than that one.

### 2.1 `company_follows`

§3.5's table, unchanged. `primary key (user_id, company_id)` and a second index on
`company_id` for the other direction.

`companies.follower_count` is maintained by an `after insert or delete` trigger, because
the suggestion rail renders it on every card and counting live is a scan over the largest
join table in the system for a decorative number. The trigger is `security definer`: an
authenticated user has no update grant on `companies`, and the denormalized count is not
the follower's to write. A nightly `reconcile_follower_counts()` exists because a
denormalized counter nobody checks is one that is eventually wrong and nothing else would
notice.

The decrement is `greatest(follower_count - 1, 0)`. A count that has drifted below the
truth must not be able to render as "-1 followers".

### 2.2 `job_interactions`

§3.5's table, unchanged: one table with a `kind` discriminator rather than
`likes`/`saves`/`hides`, because they have identical shape, identical access patterns, and
the ranking engine wants to read all of them together.

`hide` and `not_interested` are in the enum with no UI behind them. Adding an enum value
later is a migration that cannot run in a transaction alongside anything that uses it, and
these two are the cheapest negative signal the feed will ever get.

### 2.3 `applications` and `application_events`

§3.7's tables, with three deliberate differences.

**No `auto_apply_run_id`.** §3.7 lists the column; `auto_apply_runs` is phase 6's table and
§15 is explicit that phase N does not build phase N+1's schema. A nullable FK column is a
one-line migration once it has something to point at.

**No delete grant.** Nothing in the UI removes a tracked application, and the weekly goal
and the streak are derived from this table — a delete path arrives with the screen that
needs one, along with an answer for what the streak should do about it.

**`status_changed_at` is stamped by a trigger, and `application_events` is written by one.**
Both for the same reason: a client that has to remember to write the audit row is a client
that will eventually forget, and the gap is invisible until someone asks a question of the
data. The event trigger is `security definer` because `authenticated` has no insert grant
on `application_events` — the trigger is the only writer, which is what makes the trail
worth having. Re-setting a stage to the value it already holds writes nothing.

`on delete restrict` on `job_id` is §3.7's, and it is load-bearing: a user's application
history must not evaporate because a crawler decided a posting was gone. Jobs are closed,
never deleted.

### 2.4 `job_impressions`

§3.6's table, partitioned by month, with three departures — all in the direction of write
throughput, because this table takes ~3M rows a day at the size §3.6 sizes it for and
nothing reads it in a request path.

**No foreign keys.** `user_id` and `job_id` are bare uuids. An FK is a lookup on every
insert, in exchange for referential tidiness on data that is joined at analysis time
against whatever still exists.

**No key of any kind**, not even a surrogate id. A unique index on a partitioned table must
include the partition key, so a primary key would cost an index per partition to enforce a
property nobody asks about; a row is identified for debugging by (user, session, job,
`shown_at`). Dropping §3.6's identity column takes a shared sequence out of the write path
of the busiest table in the system, and eight bytes off three million rows a day.

**One index**, `(user_id, shown_at desc)` — what a phase 5 seen-penalty and any per-user
debugging both want. Every index here is paid for 3M times a day.

Partitions are created ahead by `ensure_impression_partitions()` and dropped at 13 months
(§13.2) by `drop_old_impression_partitions()`, both run nightly (§7). There is also a
**default partition**, because a partitioned table with no partition covering a row's
timestamp rejects the insert outright, and a client flushing a buffer across a month
boundary is exactly that row. The cost is that attaching a partition has to scan the
default — cheap precisely because it should stay near-empty, and a row landing in it is
itself worth noticing.

### 2.5 Authorization

Phase 0's discipline, applied again: **RLS decides which rows, column grants decide which
fields.** Both are needed, and neither substitutes for the other.

| Table | Read | Write |
|---|---|---|
| `company_follows` | own rows | none — `set_company_follow()` only |
| `job_interactions` | own rows | none — `set_job_interaction()` only |
| `applications` | own rows | insert `(job_id, status, source, applied_at, notes)`, update `(status, notes)` |
| `application_events` | own, via the application | none — trigger only |
| `job_impressions` | **nobody** | none — `log_impressions()` only |

Impressions have RLS enabled and *no policy at all*, which denies everything, and no select
grant. A user cannot page through their own behavioural log, let alone anyone else's; §13.2
classes it P2 and analysis runs as the service role. Enabling RLS on a table with no policy
looks redundant next to "no grant", and it is the point: a convenience grant added by
somebody in six months still hits a locked door.

The three columns that make an application trustworthy — `user_id`, `self_reported`,
`status_changed_at` — are the three it cannot set. `user_id` defaults to `auth.uid()` and is
not in the insert grant, so a client cannot author a row for anyone else before RLS even
looks at it.

**One phase 1 fix travels with this migration.** Phase 1 revokes its operational functions
from `anon, authenticated` and stops there. PostgreSQL grants EXECUTE on every new function
to PUBLIC, and revoking from a role that holds a privilege only through PUBLIC does nothing
— it warns and moves on. Nothing escalates, because every phase 1 function is `security
invoker` and `anon` calling `close_stale_jobs()` still hits the missing update grant on
`jobs`. But an ops function that answers the REST API at all is an invitation, and an
applied migration is not something to edit in place, so the `revoke ... from public` lands
here. Phase 2's own functions are revoked from **both** PUBLIC and the named roles, because
Supabase separately grants all functions to `anon, authenticated, service_role` by default
and neither revoke covers the other.

---

## 3. The viewer envelope — decision A

Phase 1 shipped the `{job, viewer}` envelope with `viewer` always at its default, and wrote
down that phase 2 would fill it server-side and delete the client merge. This phase does
the opposite, and the reason is in §1.3(a) itself:

> `Job.isSaved`, `Job.isLiked`, and `Company.isFollowing` are viewer-specific fields living
> on records that are otherwise identical for everyone. That's convenient in a mock store
> and actively harmful with a real one: it means a job row can never be cached or shared
> across users, and **every feed response has to be assembled per-viewer**.

Adding `viewer_liked` / `viewer_saved` columns to `job_card` and filling them in
`feed_jobs` moves the embedding from the client's `Job` type to the server's feed response.
Every page becomes per-viewer, un-shareable between readers, and carries three index
lookups per row for state that changes on a tap. The envelope was never about where the
flags are computed — it was about them travelling separately.

So they travel separately. `viewer_state()` returns five arrays — liked, saved, hidden,
followed company ids, followed company slugs — for the signed-in user, in one read per
session. The feed hooks merge them onto whatever pages they hold, which is the merge
`useJobFeeds` already does, unchanged:

```ts
isSaved: viewer.saved || saved.has(job.id),
isLiked: viewer.liked || liked.has(job.id),
```

What this buys, beyond cacheable feed pages:

- **Optimistic mutations become trivial.** A like updates one small cache entry, not every
  feed page, search result and collection that happens to contain that posting.
- **Collections need no extra query.** The Saved screen already has the ids.
- **Zero extra round trips.** A per-page viewer decoration would have cost one join per
  page; this costs one small read per session.

What it costs, and the bound on it: the sets are capped at 2,000 entries each. That is far
past any real user and about 72KB of uuids; a reader who somehow passes it loses the oldest
entries from their collections and nothing else. If that ever stops being true, the answer
is per-page decoration — at which point this decision reverses by changing `lib/api.ts` and
`useViewerState.ts`, and nothing else.

---

## 4. The write path

### 4.1 Toggles set a state

§11: *"Toggles are `PUT`/`DELETE` (idempotent by construction) rather than `POST /toggle`,
so a retry on a flaky connection can't invert the state — the failure mode where a user's
save silently un-saves itself."*

`set_job_interaction(job_id, kind, on)` and `set_company_follow(slug, on)` take the state
they should end in. That matters more here than it does over HTTP, because the outbox
replays them and a replay is a retry wearing a different hat. Both return the state the
database actually ended up in, which is what a caller should believe over its own
optimistic guess.

Both are `security definer`, so `user_id` comes from `auth.uid()` and not from an argument,
and both refuse a null `auth.uid()` outright. Neither table has an insert or delete grant,
so these functions are not the recommended write path — they are the only one.

### 4.2 Follows are keyed by slug on the wire

§3.5 says phase 2's follows key on the company uuid, and the table does. The *argument* is
the slug, because the slug is what every caller already holds — a route segment, a news
item's company, the `p_company_slugs` filter — and resolving it is one lookup against a few
hundred rows instead of a directory the client has to have loaded first. §1.3(c) keeps
company slugs precisely because they are good stable identifiers.

### 4.3 Applications are keyed by job — decision D

`unique (user_id, job_id)` makes the job a real key for the viewer's application, and using
it on the wire is what lets the outbox queue "I applied" and "I got an interview" back to
back while offline: the second operation does not need an id the first has not been issued
yet. The row's own uuid never leaves the device. Callers still pass the application id,
because that is what the UI holds; `useApplicationRecords` resolves it against the list it
already has.

Applications are written through PostgREST rather than a function, because an insert that
returns the created row is worth more here than a single entry point, and the column grants
already stop everything that matters.

### 4.4 Impressions are one call per batch

`log_impressions(jsonb)` does one multi-row insert. `user_id` is the session's.
`shown_at` is the client's — the whole point of buffering is that the row is written some
seconds after the event — but clamped to a seven-day window ending at `now()`, so a device
with a wrong clock cannot write into next year or into a partition that has been dropped.
`dwell_ms` is clamped to ten minutes: a dwell of eleven hours is a phone left on a table,
and left unbounded it would dominate every average the signal is used in. Malformed rows
are dropped and a batch is capped at 200 rather than rejected, because a client bug that
buffers without bound should lose impressions, not fail loudly enough to matter.

---

## 5. Optimistic mutations and the outbox

[`lib/outbox.ts`](../lib/outbox.ts). Appendix A names the two behaviours worth getting
right early: *"optimistic writes with rollback on every toggle (a like that flickers feels
broken), and an ordered outbox so an offline like-then-unlike doesn't replay out of order
and leave the wrong final state."*

The shape is: the caller writes the new state into the TanStack cache, appends an operation
to a durable queue, and returns. The queue drains strictly sequentially — one operation in
flight, a failure stops the drain rather than skipping ahead. Parallelism here would be a
correctness bug wearing a performance costume.

Two things make sequential draining affordable:

- Every operation is idempotent (§4.1), so a retry after an ambiguous failure cannot invert
  anything.
- Consecutive operations on the same subject **collapse**. Liking, unliking and liking
  again while offline sends one call. `application.create` is deliberately excluded from
  collapsing: a create and a later stage change are different statements, and merging them
  would lose the stage.

**Rollback is not a rollback.** Appendix A says "with rollback", and what is implemented is
reconciliation: the optimistic value stands, and when the outbox reports an operation as
landed or dropped, the affected query is invalidated and the server's answer replaces the
guess. For an idempotent set-to-a-state operation those are the same thing everywhere
except the failure case, and in the failure case invalidating is strictly better than
restoring a remembered previous value — the previous value is also a guess by then, several
operations old.

**Entries are stamped with the user who queued them.** Without that, signing out with
pending writes and signing back in as someone else replays one person's likes into
another's account. Signing out does not clear the queue — those writes still belong to the
person who made them, and if they return on the same device it drains as though nothing
happened.

**Permanent failures are dropped, not retried forever.** A PostgREST error carrying a
Postgres `code` (a missing slug, a permission failure, a bad uuid) will fail the same way in
an hour, and a queue head that can never drain blocks everything behind it. The auth codes
are the deliberate exception: an expired session is retryable, because the Supabase client
refreshes it. Anything dropped is reported through `lib/observability.ts`.

**Why AsyncStorage** — decision C. Appendix A suggests expo-sqlite or MMKV. Neither is a
dependency, both are native modules, and a native module means the app needs a development
build to run at all. AsyncStorage is already here holding the encrypted session, is
SQLite-backed on Android, and a queue measured in tens of entries does not need a query
planner.

**Why no NetInfo.** `@react-native-community/netinfo` would give TanStack Query's
`onlineManager` a real reconnect signal, and it is the same native-module trade. What is
wired instead is `focusManager` off `AppState`, plus a foreground drain and exponential
backoff in the outbox. That covers the case that actually happens — the phone was in a
pocket with no signal and is now in a hand with some — and leaves reads to correct
themselves, which they do, while the writes are the half that cannot.

---

## 6. Impressions on the client

[`lib/impressions.ts`](../lib/impressions.ts) is §3.6's buffer and its three triggers: a
10-second timer, a 25-item batch, and app backgrounding. [`hooks/useImpressions.ts`](../hooks/useImpressions.ts)
binds it to the three kinds of list the app has.

| Surface | Hook | Signal |
|---|---|---|
| Reels | `useDwellImpressions` | position, `dwell_ms`, `completed` |
| Home, search | `useListImpressions` | position, on viewability |
| A company's openings, collections | `useRenderedImpressions` | position, on render |

**Dwell is the reason Reels exists.** §3.6: *"`dwell_ms` is the strongest implicit signal
you have and the reason a Reels-style UI is worth the trouble. `reels.tsx` already knows
which page is active; it just needs to time it."* The impression is written when the reader
*leaves* a card, because that is when the number is known. `completed` is true when the next
card is further down and false when it is further up — scrolled past versus bounced back.

Leaving the screen entirely, or backgrounding the app, settles the current card with
`completed: null`. That is not a missing value being papered over: closing the tab is
neither moving on nor going back, and recording it as either puts a thumb on the scale of
the signal phase 5 will lean on hardest.

The mapped-list variant logs on render rather than on viewability, because everything in a
`ScrollView` of mapped rows is mounted at once and there is no viewability to read. For a
list the reader can see the whole of in a flick that is the honest reading of "shown", and
the alternative is making those screens virtualized for no other reason.

**Impressions are not in the outbox** — decision E. A failed flush drops its batch. A like
the user made is theirs and has to survive a tunnel; an impression is a row in a training
set that will have millions of siblings. Durably queueing them would mean a day underground
filling the disk with behavioural data and, worse, a telemetry backlog delaying the user's
actual writes. A persistent failure is still reported, because silence here looks exactly
like a user who does not scroll.

---

## 7. Operations

[`scripts/maintain.mjs`](../scripts/maintain.mjs), wired into the existing nightly workflow
next to the crawl. Three jobs, all invisible until the day they have not been running:

1. **`ensure_impression_partitions(3)`** — keeps three months of partitions ahead. Without
   it, impression logging breaks at midnight on the first of a month. The default partition
   turns that from an outage into rows in the wrong place, which is a difference worth
   having and not a reason to skip the job.
2. **`drop_old_impression_partitions(13)`** — §13.2's retention.
3. **`reconcile_follower_counts()`** — §3.5's nightly check on the denormalized counter.

It runs even when the crawl step failed, because the partition it creates is what next
month's logging writes into and has nothing to do with whether a board was reachable.

---

## 8. Client migration

Appendix A's claim is that `CareerDeckContext` is nearly the only file that changes. For
this phase it is almost exactly true — the context's public interface is **unchanged**, so
no screen or component that reads `useCareerDeck()` was touched for persistence reasons.

| File | Change |
|---|---|
| `lib/api.ts` | Phase 2 half appended: `fetchViewerState`, `setJobInteraction`, `setCompanyFollow`, `fetchApplications`, `createApplication`, `setApplicationStatus`, `logImpressions` |
| `lib/outbox.ts` | New — §5 |
| `lib/impressions.ts` | New — §6 |
| `lib/query-client.ts` | `focusManager` bridged to `AppState`; `refetchOnWindowFocus` turned on, since it now means something |
| `hooks/useViewerState.ts` | New — likes, saves, follows |
| `hooks/useApplicationRecords.ts` | New — the tracker |
| `hooks/useImpressions.ts` | New — §6 |
| `context/CareerDeckContext.tsx` | Six `useState` hooks and the `mockApplications` import replaced by the two hooks above; same interface out |
| `app/(tabs)/reels.tsx` | Dwell logging |
| `app/(tabs)/index.tsx`, `components/search/SearchOverlay.tsx` | Viewability logging |
| `app/company/[id].tsx`, `app/collection/[type].tsx` | Render logging |
| `hooks/useApplications.ts`, `hooks/useCompanies.ts` | Comments only — the phase 1 notes they carried are no longer true |
| `types/database.ts` | Phase 2 tables, functions, enums and the `viewer_sets` composite |

**`types/database.ts` was extended by hand**, which the file's own header forbids. It is
generated from a running local database and this phase was built without Docker available,
so the entries were written to match what `supabase gen types` produces. Run
`npm run types:generate` after the first `npm run db:reset` that applies this migration;
if anything here is wrong, that command is what says so.

### 8.1 What went away

`DEFAULT_FOLLOWED_SLUGS` — the two companies a fresh install used to follow. Follows are
real now, and a new account follows nobody. The Following tab already had the empty state
for it ("Follow companies on Home and their newest roles will show up here"), which is a
better first run than two companies the user did not choose.

`mockApplications` is no longer imported. The fixture file stays for the moment because
`data/mockCommentActivity.ts` points at its ids, and comments are phase 3.

---

## 9. What the exit condition actually required

### 9.1 "Every existing UI interaction persists"

| Interaction | Screen | Now writes |
|---|---|---|
| Double-tap to like | Deck | `job_interactions(like)` |
| Bookmark | Home, search, company, collections, job detail | `job_interactions(save)` |
| Follow | Home rail, company page, search, Following collection, stories | `company_follows` + counter trigger |
| "I applied — track it" | Apply sheet | `applications` + `application_events` |
| Move a stage | Activity | `applications.status` + event row |

Everything else a user can tap either belongs to a later phase (a comment, a resume, an
Auto Apply credit) or is genuinely session-scoped (a story marked seen, a search term in
Recents).

### 9.2 Collections screens

`app/collection/[type].tsx` already existed and already read the id sets from the context.
Because the sets kept their shape, the screen needed no change to start showing real data —
its jobs come from `useJobsByIds`, which resolves ids the client holds rather than filtering
a loaded page, and that was already the right design for a paginated corpus.

The Following list still resolves slugs through the company directory (`useCompanies.ts`).
`viewer_state()` answers *which* companies are followed; the directory answers *what they
are*, which is a read of the same few hundred shared rows every other screen already holds.

**The Following feed still filters by slug array** — decision F. PHASE1 §7.3 expected phase
2 to turn it into a join on `company_follows`. Adding a parameter to `feed_jobs` means
dropping and recreating it, and every call would become ambiguous between the old and new
overloads in the meantime. The slugs are already in memory from `viewer_state()`, and the
number of companies a student follows is small. The join is worth doing on the day
`feed_jobs` is being rewritten anyway, which §5's ranker guarantees.

### 9.3 Weekly goal reads real applications

`useWeeklyGoal` derives the target, the count, the streak and the six-week history from
`applications`, and `useApplications` derives the sorted list and the pipeline counts.
Neither changed. §1.2 called this correctly — *"Stays client-side. It derives from
`applications`, and the comment in that file is right: derived beats stored"* — and the
proof is that making the rows real was a change to where the array comes from and nothing
else.

One thing did need care: `applied_at` is the user's **local** date, not `toISOString()`'s
UTC one. An application submitted at 8pm in California is otherwise counted as tomorrow,
and tomorrow can be a different week.

### 9.4 "Impressions logging at volume"

Five surfaces log, batched at 25 items or 10 seconds or backgrounding, one RPC per batch
doing one multi-row insert into a monthly partition. `verify:phase2` drives 2,000 rows
through the real path in ten calls and reports the throughput.

---

## 10. Verification — `npm run verify:phase2`

```
npm run db:start
npm run db:reset
npm run verify:phase2
```

Unlike phase 1 there is no corpus half. The script creates its own company, three postings
and two users, drives every write path, and cleans up after itself, so it passes on a
database that has just been reset and has never ingested anything.

It checks two kinds of thing:

**That it works** — a follow persists and moves the counter; a like is idempotent;
like → unlike → like ends liked exactly once (the outbox's replay, run against the real
function); tracking an application writes its opening event; a stage change writes a second
event carrying where it came from; re-setting the same stage writes none; a batch of
impressions lands with dwell intact; 2,000 impressions go through in ten calls.

**That it cannot be subverted** — anonymous readers cannot read any of the five tables or
call any of the four functions; one user cannot read another's follows, interactions,
applications or application history; a user cannot insert into `job_interactions` or
`company_follows` directly, cannot author an application for someone else, cannot claim an
application was observed rather than self-reported, cannot delete one, cannot write
`companies.follower_count`, and cannot read their own impression log back.

That second list is most of the file's length on purpose. Every line of it is a policy or a
column grant, and a policy nobody tests is one that silently stops applying the first time
somebody adds a convenience grant.

It also checks the operational edges: partition creation is idempotent, retention does not
drop a live month, malformed impression rows are dropped rather than failing a batch, an
implausible dwell is clamped, a `shown_at` from a wrong clock is clamped to now, an
oversized batch is capped at 200, and the nightly reconcile corrects a deliberately drifted
follower count.

**Not verified here:** none of the above has been run. This phase was built without Docker,
a local Supabase or a `.env`, exactly as phase 1's audit was. The migration, the RPC
signatures and the grants are written against the schema in phases 0 and 1 and typecheck
clean against hand-written generated types — but the first `npm run db:reset` is the first
time any of the SQL executes, and that run is the real review. Check it before believing
this document's §2.

---

## 11. Risks specific to this phase

| Risk | Mitigation |
|---|---|
| A missed month of partitions breaks impression logging at midnight | Default partition catches the rows; nightly job keeps three months ahead; `verify:phase2` checks idempotency |
| The outbox head gets stuck and blocks every write behind it | Permanent failures dropped on their error code, everything dropped after 12 attempts, every drop reported |
| Pending writes replay under the wrong account | Every entry stamped with the user who queued it; the drain skips and discards anything else |
| Viewer sets outgrow one read | Capped at 2,000 per set and documented; the reversal is `lib/api.ts` and one hook |
| `follower_count` drifts | Trigger for correctness, nightly reconcile for drift, `greatest(…, 0)` so it can never render negative |
| Impression volume swamps the database | Partitioned monthly, one index, batched writes, 13-month retention — §16's own mitigation list, implemented |
| Optimistic state disagrees with the server after a dropped operation | Every outbox flush invalidates the affected query, so the server's answer replaces the guess |

---

## 12. Deferred decisions this phase records rather than makes

1. **`viewer` on the envelope stays a default.** `JobEnvelope.viewer` is still
   `{liked: false, saved: false, applied: false, matchScore: null}` from `lib/api.ts`, and
   the merge fills it. `matchScore` is phase 4's; `applied` is answered by the context's
   `hasApplied` rather than the envelope, because the tracker is already fully loaded.
2. **§1.3(b) — `comment.likeCount` folding in the viewer's own like** — is still there, in
   `CareerDeckContext`. The fix is "store the true count, send `viewerHasLiked`
   separately", and there is no stored count to be true until phase 3 builds `comments`.
   Folding against a fixture is harmless; folding against a real count double-counts. The
   line and phase 3 land together.
3. **`application_intents`** (§12's weak signal at tap-Apply) is not built. It is one more
   table for a signal nothing reads, and phase 5 is the first phase that would.
4. **No `onlineManager`.** See §5. Revisit on the day the app needs a development build for
   something else — Sentry's native module is the likely trigger.
5. **The Following feed's slug filter.** See §9.2. Revisit when `feed_jobs` is rewritten for
   the ranker.
