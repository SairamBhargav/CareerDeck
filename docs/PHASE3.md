# Phase 3 — Identity and social

Companion to [README.md](./README.md) §15, which says what phase 3 is in four lines. This is the
design: every table, every write path, every client file that changes, and the reasons for each
deviation from the plan.

**Written for:** whoever builds or reviews this phase, including someone who has read neither
[PHASE1.md](./PHASE1.md) nor [PHASE2.md](./PHASE2.md) nor the client.

**Exit condition (from §15):** *verified users comment, moderation blocks the obvious, review queue
staffed, content policy published.*

---

## Decisions taken for this phase

Six questions were open when this document was first written. They are settled, and the rest of the
document reflects the answers rather than the alternatives.

| # | Question | Chosen | Consequence |
|---|---|---|---|
| A | Where does the comment write path live? | **The API service**, with every rule still in SQL | The classifier needs a secret, so the route cannot be the client. `post_comment()` is `service_role`-only and enforces tier, strikes, rate, depth and policy itself, so a bug in the service cannot write a comment the database would refuse. §4. |
| B | What backs the rate limit? | **Postgres, not Redis** | §10 says Redis. A partial index answers "10 in the last hour" in a millisecond and is *transactional with the insert*, which makes it exactly right rather than approximately right. §4.2. |
| C | How does realtime reach a thread? | **Broadcast from the database**, not `postgres_changes` | A changefeed row carries `author_id`, and the entire read path exists to keep that column away from clients. A trigger sends the public projection instead. §3.2. |
| D | Where do comment counts live? | **A separate `comment_counts()` read** | Putting the counter on `job_card` would make every feed page per-reader and uncacheable, for a number nobody reads while scrolling — the same argument phase 2 made about viewer state. §3.1. |
| E | Do comment posts go through the outbox? | **No. Comment *likes* do** | A queued post that the classifier refuses would be reported as sent and dropped an hour later, when the writer no longer has the text. A like sets a state and is safe to replay. §5. |
| F | How are blocking and reporting keyed? | **By the comment id** | The client never holds an author identifier. The author is resolved server-side, which also means a reporter cannot learn who they reported. §6.2. |

---

## 0. What phase 3 is, in one paragraph

Phase 0 established who a reader is, phase 1 what there is to look at, phase 2 what they did about
it. Phase 3 is where they say something to each other — which means it is the first phase whose
failure mode is not a lost tap but a real person being harassed by another real person under a name
neither of them can see. It builds the two verification paths that unlock writing, the comments
those verified accounts write, the moderation that sits in the write path, the strike ladder behind
it, the internal queue a human works, the notifications that tell people what happened, and the
realtime that makes a thread feel live. Everything in it follows from one property, which is worth
stating before any schema: **users are anonymous to each other and fully identified to us.**

---

## 1. Scope

### In

- §3.2's `verifications`, both paths, and the credential blocklist that makes a ban mean something.
- Generated pseudonyms (`profiles.handle`), which have existed as a column since phase 0 and have
  never been filled.
- §3.8's `comments`, `comment_likes`, `reports`, `blocks`, `user_strikes`, `notifications`.
- §10's pipeline: doxxing regex, threat lexicon, hosted classifier, rate limit, strike escalation.
- The internal review queue, as JSON routes plus one HTML page.
- The content policy, published and version-recorded.
- §15's "realtime on threads".
- §1.3(b), which phase 2 deferred explicitly and which this phase closes.

### Out, and where it goes instead

| Not built | Why | Where it lands |
|---|---|---|
| Push notifications | The `notifications` table is the substrate; delivery is a separate concern with its own credential and its own consent flow | Phase 7, which §15 already assigns them to |
| Editing a comment | `edited_at` exists and nothing sets it. An edit after moderation is a hole in the pipeline — the reviewed text is not the published text — and closing it properly means re-classifying on edit and versioning what was seen | Deferred, §12 |
| Comment search, sorting, or "top" ordering | Newest-first is what a thread on a posting wants. A ranking here would need the same infrastructure §5 builds for the feed | Phase 5, if ever |
| Following a *person* | There are no people to follow. Anonymity is not a layer over a social graph, it is instead of one | Not planned |
| Moderator UI beyond the queue | Analytics, audit browsing, bulk actions. §10 asks for a queue before launch, and that is what exists | When a moderator asks for it |
| Appeals as a flow | The policy gives a contact address and a human answers it. A ticketing system for a product with no users would be furniture | Deferred, §12 |

---

## 2. Schema

[`supabase/migrations/20260924000000_phase3_social.sql`](../supabase/migrations/20260924000000_phase3_social.sql).

### 2.1 Pseudonyms

`profiles.handle` is a `citext unique` column that phase 0 created and nothing ever wrote to. Phase 3
fills it, from a two-word-plus-four-digit vocabulary in `handle_words`
([scripts/handle-words.ts](../scripts/handle-words.ts) seeds it).

**Generated, never chosen.** A user-picked handle is a second identity to moderate: it can carry a
slur, a real name, a school the account has never verified, or a homoglyph impersonation of somebody
else's handle. It gives the product nothing that `quiet-otter-4821` does not. §3.8 generates the
*badge* for exactly this reason; the handle is the same argument one field over.

That puts a constraint on the word list which is easy to miss: every pair will eventually be
generated, so every pair has to be inoffensive. The adjectives are descriptive rather than
evaluative — no `lucky`, no `clever`, because a handle should neither flatter nor mock its owner —
and the nouns are weather, landscape and animals with nothing anatomical, political, religious, or
national in them.

Assignment happens inside phase 0's signup trigger, which is `create or replace`d here. That
function runs in the signup transaction, so `generate_handle()` cannot loop forever: it tries ten
times and then falls back to a uuid tail, which is ugly and always available.

### 2.2 `verifications`

Both §3.2 paths in one table, with the §3.2 non-negotiable expressed as schema rather than as
policy: **there is no column that could hold document data.** No image, no document number, no date
of birth, no name from the document. On top of that, `verifications_result_is_minimal` rejects an
insert whose `provider_result` contains any of those keys, because a vendor payload contains all of
them and forwarding one by accident is a single careless line.

"We decided not to store it" is a promise. "There is nowhere to put it, and the constraint rejects
it" is a fact, and the difference is what a breach-notification obligation turns on.

The magic-link token is the same shape of decision: `token_hash` holds a salted digest, so a dump of
this table does not let the reader verify anybody's account.

Two unique indexes matter more than they look:

- `(user_id, kind) where status = 'verified'` — one verified row per path, and a user may hold both,
  because the paths are siblings.
- `(edu_email) where status = 'verified'` — one account per address. Without it a shared
  departmental alias mints verified accounts indefinitely.

### 2.3 `verification_blocklist`

§10: *"`user_strikes` escalation (warn → 7-day mute → ban) bound to the verification, so a banned
user needs a new `.edu` address or a new government ID to return."*

A ban that touches only the account is a ban on nothing — signup is open to any email, so it costs
the offender ten seconds. What has to be burned is the credential, and the credential is not ours to
keep. So this table holds a peppered SHA-256 of the `.edu` address or the provider's inquiry
reference, and nothing that can be read back into either.

The digest is deliberately **not** salted per row or per account: the entire purpose is that the same
address under a *different* account is recognised, which requires the hashes to be comparable. The
pepper is shared between `apply_strike()` in SQL and the service
([`server/src/verification.ts`](../server/src/verification.ts)), which is why changing
`VERIFICATION_PEPPER` un-bans everybody banned under the old one. That is a data migration, not a
config change, and the env file says so.

### 2.4 `comments`

Close to §3.8, with three additions.

`idempotency_key`, unique per author. Every write phase 2 added was idempotent by construction — a
toggle sets a state — and this one appends, so idempotency has to be carried explicitly. §5.

`moderation_reason`, in words a reviewer can act on, next to §3.8's `moderation_scores`.

A `check` on body length at 500 characters, matching the composer, so the failure is a constraint
and not a truncation.

Four indexes, each for one read: the thread (roots by recency), a thread's replies, the rate limiter,
and the review queue. The last is partial — flagged comments are a rounding error against the table,
and a full index on a status nothing filters by is paid on every insert.

Flat threading is a trigger, not a convention. `types/comment.ts` has said "replies are flat" since
the first fixture and the sheet is built around it; a nested reply would not crash anything, it would
render at the wrong indent, which is the kind of bug that survives for a year.

### 2.5 `notifications`

§3.8's aggregated feed, written by triggers in the same transaction as the thing it describes. A
queue worker was the alternative; it buys throughput this table does not need and costs the property
that matters — a notification cannot exist for a rolled-back comment, and a comment cannot land
without its notification.

`payload` is denormalized on purpose. A notification is read days later, by which time the comment it
describes may have been deleted by its author or removed by a moderator, and joining back would
produce a blank row where a sentence should be.

The aggregation index is scoped to **unread** rows (`where read_at is null and kind =
'comment_like'`), so a like arriving a week after the last batch was read starts a new notification
instead of bumping a count on something already dismissed.

One subtlety worth its comment in the migration: the aggregate is **recomputed** from
`comment_likes`, not incremented. Unliking deliberately does not decrement — "somebody liked your
comment and then thought better of it" is not a thing to tell anybody — so incrementing would let a
reader inflate "and 4 others" by toggling. Recomputing makes the sentence true by construction and
makes toggling inert. `verify:phase3` checks exactly this.

### 2.6 Authorization

Phase 0's discipline for the third time: **RLS decides which rows, column grants decide which
fields**, and neither substitutes for the other.

| Table | Read | Write |
|---|---|---|
| `comments` | **nobody** — the view only | none — `post_comment()` only |
| `comments_public` | every signed-in reader | — |
| `comment_likes` | own rows | none — `set_comment_like()` only |
| `blocks` | own rows, **as blocker only** | none — `set_block_from_comment()` |
| `reports` | own rows | none — `report_content()` only |
| `user_strikes` | own rows, minus `issued_by` | none — moderators only |
| `verifications` | own rows, minus every secret | none — service role only |
| `verification_blocklist` | **nobody** | none |
| `notifications` | own rows, minus `actor_id` | none — `mark_notifications_read()` |
| `moderators`, `handle_words` | **nobody** | none |

Three of these are worth spelling out.

**The base `comments` table is unreadable.** Granting select and relying on a policy would leave
`author_id` one `select *` away, and the whole anonymity contract rests on that column never being in
a client response. `verify:phase3` asserts the grant is absent.

**`comments_public` is not a `security_invoker` view, and `notifications_public` is.** This looks
inconsistent and is not. An invoker view reads with the caller's privileges, so it needs base-table
grants; `comments_public` joins on `author_id`, so making it an invoker view would require granting
the one column this phase exists to withhold. It therefore runs as its owner, with the visibility and
block filters written into its `where` clause. `notifications_public` selects nothing that is
withheld, so a column grant omitting `actor_id` expresses it exactly, and it keeps RLS in play. The
rule is: *which projection can be expressed as a grant.*

**`blocks` is readable by the blocker and not by the blocked.** Being able to read "who has blocked
me" would tell somebody that a particular pseudonym blocked them, which in a small thread is enough
to work out who it was. Being blocked should be indistinguishable from being ignored.

`verification_blocklist`, `moderators` and `handle_words` have RLS enabled with **no policy at all**,
on top of no grant — phase 2's belt-and-braces treatment of `job_impressions`, for a higher-stakes
reason: `handle_words` is the dictionary every pseudonym in the system is drawn from.

---

## 3. Reads

### 3.1 Comment counts do not ride on the feed — decision D

A reel's comment action shows a count. The obvious implementation adds `comment_count` to the
`job_card` composite and fills it in `feed_jobs`.

Phase 2 already argued why not, about a different field. §1.3(a)'s point was never about where a
value is computed — it was that a feed page has to be *identical for every reader* to be cacheable.
A counter that changes every few seconds breaks that just as thoroughly as a per-viewer flag does,
and it breaks it for a number nobody is reading while they scroll.

So `comment_counts(p_job_ids uuid[])` is a separate read, called by the screen with the ids it is
holding, cached for a minute. It is deliberately **viewer-independent**, unlike the thread read: a
blocked author's comments are hidden from a thread, but subtracting them from a count would tell the
reader exactly how many comments they are not being shown, which is information about somebody they
asked not to hear from.

A second benefit fell out of this: `job_card`, `feed_jobs` and `search_jobs` are untouched by phase 3.

### 3.2 Realtime is a broadcast, not a changefeed — decision C

§15 asks for realtime on threads. The default answer is `postgres_changes` on `comments`, and it is
wrong here for a reason that has nothing to do with performance: **a changefeed sends the row**, and
the row contains `author_id`. Subscribing to a table whose entire read path exists to project one
column away would hand every listener the column.

So a trigger composes the `comments_public` shape and calls `realtime.send()` on a per-posting topic,
`job:<uuid>:comments`, marked private. Three consequences:

- The payload is the projection. There is no `author_id` and no `moderation_scores` on the wire, and
  `verify:phase3` subscribes as a real client and asserts it.
- The topic is private, authorized by a policy on `realtime.messages` that admits any signed-in
  reader to any `job:%:comments` topic. There is deliberately **no insert policy**, so a client
  cannot broadcast a comment that was never written — the attack a public broadcast channel invites.
  The verification script checks both halves: a signed-in reader subscribes, an anonymous one is
  refused.
- A removal broadcasts only the id. Re-transmitting the body of a comment a moderator just removed
  would republish the thing that was removed.

`realtime.send` swallows its own errors as a warning by design, which is the right failure: a thread
whose live updates break falls back to being a thread you pull to refresh, rather than a thread you
cannot post to.

### 3.3 `is_own` rides on the comment row, and viewer state did not

Phase 2 spent a section arguing that viewer state must not sit on a shared row, and `comment_card`
has an `is_own` flag on it. The distinction is worth being precise about, because "be consistent"
points the wrong way here.

A feed page is identical for every reader and therefore cacheable; folding viewer state into it
destroys that property. A *thread* is not, and cannot be: blocks remove rows from it per reader
(§3.8), so it was never a shared object. Once a response is per-viewer by necessity, keeping a flag
off it buys nothing and costs the client a second lookup.

`author_id` is still absent. That is not a caching decision, it is the contract.

The viewer's comment *likes* do travel separately, in `viewer_state()`'s new sixth attribute —
because that is §1.3(b), and it is a different argument (below).

### 3.4 §1.3(b), closed

> `Comment.likeCount` includes the viewer's own like. This is the kind of thing that looks harmless
> and then produces a UI where unliking decrements to a wrong number. Store the true count; send
> `viewerHasLiked` separately.

Phase 2 left the client folding its own like into the count and wrote down that the fix and phase 3
would land together, because there was no stored count for the fix to be about. There is now:
`comments.like_count` is maintained by a trigger, `viewer_state()` gained `liked_comment_ids`, and
`CareerDeckContext` no longer adds one to anything. The count is the true total; the predicate is
separate; unliking decrements to the right number. `verify:phase3` checks that too.

---

## 4. The write path — decision A

### 4.1 Why it is in the API service, and why the rules are not

§10's pipeline has one step Postgres cannot do:

```
POST /v1/comments
  → verify tier ∈ (edu, identity)        else 403      ← post_comment(), in SQL
  → rate limit                           else 429      ← post_comment(), in SQL
  → moderation classifier (~50–200ms)                  ← the service
      block → 422 with a reason the user can act on
      flag  → insert approved + review queue
      pass  → insert approved
  → return; realtime broadcast to the thread            ← a trigger
```

The classifier needs a secret and a model, and a secret in an Expo bundle is a published secret. So
this is the first route to land in `server/` — exactly as phase 0 predicted when it wrote *"what
lands here in later phases is the set that isn't [expressible in RLS]: … and the moderation write
path (§10)"*.

The important half of the decision is the other one. **`post_comment()` is granted to `service_role`
alone and enforces every rule itself**: tier, strikes, rate limit, thread depth, policy acceptance,
idempotency, block-aware reply delivery. The service supplies the classifier's verdict and nothing
else.

The alternative — checks in the handler, a plain insert underneath — reads as simpler and fails
badly. A forgotten check, a mis-parsed body, a second route added in a hurry, and an unverified
account is commenting. This way a bug in the service can produce a *wrongly classified* comment,
which is recoverable, and cannot produce an *illegitimate* one.

Errors carry distinguishable SQLSTATEs (`CD001`–`CD005`) so the handler maps them to status codes
without matching on message text, and the client branches on a token rather than on prose.

### 4.2 The rate limit is Postgres — decision B

§10 puts the counter in Redis. There is no Redis here and there does not need to be one:
`comments_author_recent_idx` answers "how many in the last hour" in a millisecond, and being in the
same transaction as the insert makes it **exactly** right rather than approximately right. A Redis
counter and a Postgres insert can disagree; these cannot.

The trigger for revisiting it is real and worth writing down: a counter in the database costs a read
per attempt against a table that is also being written to at volume. If comment volume ever makes
that index hot, the answer is a Redis token bucket in front of the route, and `post_comment()` keeps
its own check as the backstop.

### 4.3 The classifier, and the category that must not be blocked

[`server/src/moderation/classifier.ts`](../server/src/moderation/classifier.ts) runs three passes,
cheapest first, and each can end the decision.

1. **Doxxing regex** ([`doxx.ts`](../server/src/moderation/doxx.ts)). Free, instant, and genuinely
   better than a model at the one thing it does: a phone number's harm is entirely in a token
   pattern, and a classifier tuned for tone rates "you can reach him at 317-555-0148" as perfectly
   pleasant. It normalizes zero-width characters and `(at)`/`(dot)` obfuscation first, and it
   deliberately also matches the *invitation* — "dm me on instagram" — because that is the
   workaround that actually happens.
2. **A threat lexicon.** A small set of unambiguous violent and self-harm directives, so the highest-
   severity category is still caught on a deployment with no model credential. **There is
   deliberately no slur list in this repository**: a good one is long, needs maintaining against
   language that changes monthly, and is a document that does real harm if it is ever mistaken for
   anything other than a blocklist. That work belongs in a hosted classifier maintained by people who
   do it full time.
3. **The model**, for everything that needs a sentence read rather than matched.

§10 is unusually direct about one category: *"negative employer claims — 'this company rejected me
for no reason' is exactly the speech the product exists for, and over-blocking it makes the comment
section worthless."* A general-purpose moderation model does not know that, and asked whether an
anonymous accusation against a named company is harmful will often say yes. So the prompt says so
explicitly **and** the verdict is overridden in code afterwards: an `employer_claim` block becomes a
flag, unconditionally. A policy this important is not left to a prompt.

**Failure flags rather than blocks or approves.** A timeout, an error, or no credential at all
publishes the comment as `flagged`. Blocking would mean a model outage silences every verified
student; approving would mean an outage publishes unchecked text. Flagging posts it and asks a human,
which is wrong in neither direction. The server warns loudly on every boot when no credential is
configured, because that state is right for local development and not for real users.

The model defaults to `claude-opus-5` and `MODERATION_MODEL` overrides it. That is a deliberate
non-choice: §10 budgets 50–200ms and Opus with adaptive thinking does not fit that at p95, while
`claude-haiku-4-5` does, for less money and some accuracy. The trade depends on a number only the
operator can measure, so the default is the more capable model and the alternative is documented
rather than picked on their behalf.

### 4.4 Verification needs two more secrets

[`server/src/verification.ts`](../server/src/verification.ts).

**The `.edu` path cannot reuse Supabase Auth**, which already sends a six-digit code with a template
this repo ships. Auth sends to the *account's* address, and the point of §3.2's edu path is proving
control of a **second** address the account does not sign in with. The only way to make Auth do it is
`updateUser({ email })`, which changes the login address — so a student who verifies with a
university address they lose at graduation would lose the account with it. So the service sends it,
over `fetch` to Resend, because one POST does not earn an SMTP dependency.

With no provider and `NODE_ENV=development`, the code comes back in the response so the flow is
testable on a fresh clone. In production that path is refused outright: a verification code in an
HTTP response is not a verification.

**The ID path is a hosted inquiry plus a signed webhook.** The document, the selfie and the liveness
check never touch this process, which is the entire reason to use a vendor. The webhook verifies an
HMAC over the **raw** body (re-serializing JSON changes bytes, and every signature check written
against a parsed object either passes for the wrong reasons or fails for none), rejects anything
older than five minutes, and refuses every request when `PERSONA_WEBHOOK_SECRET` is unset — an
unauthenticated endpoint that grants a privilege is the worst thing this service could expose.

Neither of these makes the app refuse to start. `capabilities` on `/health` reports what is live, the
routes 503 with the variable name when they are not, and `EXPO_PUBLIC_API_URL` is optional on the
client. §8.

---

## 5. Comments are not in the outbox — decision E

[`lib/outbox.ts`](../lib/outbox.ts) exists so that a like made on a subway platform lands when the
train surfaces. A comment looks exactly like the kind of write it was built for, and it is excluded.

The property everything in that file depends on is that **every operation sets a state**, so a retry
after an ambiguous failure cannot do harm. A comment appends — and worse, it can be *refused*, by the
classifier, by the rate limit, by a strike. Queueing it would mean showing somebody a posted comment
and then dropping it an hour later, when they no longer have the text and there is nothing useful
left to tell them.

So a post is a foreground write with a visible failure. The composer clears, a `pending` row appears,
and on failure the draft goes back in the box with the reason — mapped from the service's `code`, and
for a classifier refusal, quoting the classifier's own sentence, because it names what to change.

Comment *likes* are in the outbox, because a like is a state like any other, and they collapse under
the same key rule.

The one thing the client has to carry for this is `idempotencyKey`, one per composer session: a
retried POST returns the comment that already exists rather than writing a second one.

---

## 6. The reader's own actions

### 6.1 Everything else is still an RLS-shaped write

`set_comment_like`, `delete_own_comment`, `report_content`, `set_block_from_comment`,
`accept_content_policy`, `mark_notifications_read` are all `security definer` RPCs granted to
`authenticated`, in phase 2's idiom: set a state, take the user from `auth.uid()`, return what the
database ended up holding. PHASE1.md decision B is unchanged — the service is where a secret is
needed, not where writes go by default.

Deleting is soft, per §3's convention for anything a user authored: a comment that produced a report
or a strike is evidence, and evidence a user can erase is not evidence. Replies go with it — an
orphaned reply reads as a non sequitur, and promoting it to the top level (which the fixture version
did) publishes somebody's answer as though it were a statement.

### 6.2 Blocking and reporting are keyed by the comment — decision F

The client has no author identifier and never will, so it names something the person *said* and the
author is resolved server-side. That reads like a workaround for a self-inflicted problem; it is the
contract holding, and it has a second benefit — a reporter never learns the uuid they reported, so
reporting cannot be used to correlate two pseudonyms.

Reporting and blocking are offered together in one sheet, with the block pre-checked for the reasons
where it obviously applies. They are separate rows and separate meanings — a report goes to a human
and takes a day, a block is immediate and personal — but somebody reporting harassment almost always
wants both, and making them find a second menu is a bad half-minute at the worst possible time.

A block is one-directional in the table and **two-directional in effect**: it hides them from you and
you from them, and `post_comment()` refuses a reply across it rather than writing one that gets
filtered on read. A replier who is silently filtered believes they were heard.

---

## 7. Moderation and the review queue

§10: *"Human review queue: a small internal web view over `reports` and flagged comments. Build it
before launch, not after the first incident."*

It is one HTML page ([`server/src/moderation/review.ts`](../server/src/moderation/review.ts)) with no
build step, no framework and no bundler — a `<script type="module">` that signs in against Supabase
with the publishable key and calls two JSON routes. A review tool that needs its own deploy pipeline
is a review tool that is broken on the evening it is first needed.

`moderation_queue()` returns open reports and flagged comments as **one list**, because a reviewer
works a list and not two tabs, ordered so reported items come before merely-flagged ones of the same
age — a flag is a machine's suspicion and a report is a person telling us something is wrong. It is
the one read in the system that sees `author_id`, and it also carries the account's tier and strike
count, because deciding between a warning and a ban is impossible without the history.

Access is a row in `moderators`, checked on every request, with a separate `can_ban` flag: a new
reviewer can work reports on their first day without being able to burn somebody's credential. A
non-moderator gets **404**, not 403 — an endpoint that admits to existing is an endpoint worth
probing.

`moderation_resolve()` moves the comment, closes its reports, and optionally issues a strike in one
transaction, because those three facts have to move together. A removal whose reports stay open comes
back up the queue tomorrow; a strike issued without the removal punishes somebody for something still
on the page.

Escalation is computed from history rather than passed in, so two moderators working the queue at
once cannot both issue a "first warning". A ban burns the credential (§2.3) and drops the account to
`email` — it keeps reading, applying and tracking, and loses commenting, which is the only thing
verification ever unlocked.

Everything notifies. §10's *"do not silently revoke — notify"* is about verification expiry, and the
same instinct applies to a removal: a comment that vanishes without explanation reads as a bug, and
the user's next move is to post it again.

Moderator accounts are made by hand with the service role, because granting yourself moderator is
precisely the escalation this is guarding:

```sql
-- after creating the auth user (Supabase dashboard, or auth.admin.createUser)
insert into public.moderators (user_id, email, can_ban)
values ('<uuid>', 'you@example.com', true);
```

Then open `/moderation` on the service and sign in with that account's email and password.

---

## 8. Configuration, and what happens without it

Three of phase 3's features need a third-party account that somebody cloning this repo does not have:
a model credential, an email provider, an identity vendor. A server that refuses to boot without all
three is a server nobody can run, and an app that crashes on launch because one is missing is worse.

So each capability reports its own readiness, and the degradation is deliberate at every level:

| Missing | What happens |
|---|---|
| `ANTHROPIC_API_KEY` | Comments still post. The regex and lexicon passes still run; anything they miss is published as `flagged` and queued. The server warns on every boot. |
| `RESEND_API_KEY` (dev) | The code is returned in the response and logged, so the `.edu` flow is testable. |
| `RESEND_API_KEY` (prod) | `/v1/verify/edu/start` returns 503 naming the variable. |
| `PERSONA_*` | `/v1/verify/identity/start` returns 503; the webhook refuses every request. |
| `EXPO_PUBLIC_API_URL` | The whole app works except commenting and verification. The composer says commenting is unavailable; the verify screen says which variable to set. |

`GET /health` reports the live set, so "is the classifier actually running in production" is not a
question answered by reading a deploy log.

---

## 9. Client migration

Phase 2 could claim the context's public interface was unchanged. Phase 3 cannot, and the reason is
§1.3(b) plus the anonymity contract: a comment no longer has a name on it, and the old shape had two.

| File | Change |
|---|---|
| `lib/service.ts` | **New.** The seam for calls that go to `server/` rather than Postgres — typed `code`, a distinct `ServiceUnavailable`, and an explicit offline status. |
| `lib/api.ts` | Phase 3 half appended: threads, replies, counts, the gate, posting, likes, deletes, reports, blocks, notifications, verification. `ViewerSets` gained `likedCommentIds`. |
| `lib/outbox.ts` | `comment.like`, and a long comment on why `comment.create` is absent. §5. |
| `hooks/useComments.ts` | Rewritten: infinite roots, per-thread replies, the realtime subscription, the gate, and the actions. |
| `hooks/useNotifications.ts` | **New.** Replaces the `commentActivity` fixture. |
| `hooks/useVerification.ts` | **New.** Both paths, offered as siblings. |
| `hooks/useViewerState.ts` | `isCommentLiked` / `toggleCommentLike`. |
| `context/CareerDeckContext.tsx` | Comments left entirely; the inbox arrived. The §1.3(b) fold is gone. |
| `components/comments/CommentRow.tsx` | Pseudonym and badge instead of a name; a Report action; a `pending` state. |
| `components/comments/CommentSheet.tsx` | Real reads, pagination, the gate banner, error mapping, the two new sheets. |
| `components/comments/CommentPolicySheet.tsx` | **New.** §10's first-comment policy. |
| `components/comments/ReportSheet.tsx` | **New.** §10's report path, with block. |
| `components/activity/NotificationCard.tsx` | **New**, replacing `CommentActivityCard`. Moderation and verification notices render here too. |
| `app/verify.tsx` | **New.** Both verification paths, deliberately as peers. |
| `app/profile.tsx`, `app/settings.tsx`, `components/profile/ProfileHeader.tsx` | The badge, and the way in. |
| `types/comment.ts`, `notification.ts`, `verification.ts` | The shapes above. |
| `constants/policy.ts` | The policy's short form and its version. |

### 9.1 What went away

`data/mockComments.ts` and `data/mockCommentActivity.ts` are deleted. `CommentActivity` and
`CommentActivityCard` are gone, replaced by `AppNotification` and `NotificationCard` — a wider type,
because the inbox now carries moderation and verification notices that used to have nowhere to go.

`JobComment.authorName` and `authorInitials` are gone and cannot come back. A shape that cannot hold
a name cannot leak one.

### 9.2 Where the UI says "no"

Three refusals had to be designed rather than thrown:

- **Unverified, muted, or banned**: a banner above the composer, with the thread still readable,
  because reading is most of what the sheet is for and an unverified reader is still a reader.
- **Policy unread**: the send button opens the policy rather than refusing. One tap towards
  commenting, not a wall.
- **A classifier refusal**: the draft comes back with the classifier's own sentence, which names what
  to change. The error clears the moment the text changes, so a fixed comment does not look broken.

Flagged comments are returned to the client as ordinary successes and the writer is **not** told.
Telling somebody their comment is under review teaches the few people probing the threshold exactly
where it is, and tells the many who tripped it by accident that they are suspected of something.

---

## 10. Verification — `npm run verify:phase3`

[`scripts/verify-phase3.mjs`](../scripts/verify-phase3.mjs). 116 checks. Like phase 2 it creates its
own company, postings, accounts and moderator, drives every path, and cleans up after itself.

Unlike phase 2, half of it is HTTP, because half of the phase is. With the service down it says so,
skips that half, and still fails on anything wrong with the database half — the arrangement phase 1
used for its corpus checks.

Three kinds of check are mixed on purpose:

- **It works.** A verified account comments, a reply notifies, a like aggregates, a moderator removes
  something and the author is told, a broadcast arrives at a live subscriber.
- **It cannot be subverted.** An unverified account cannot comment; a muted one cannot either; a
  client cannot insert into `comments` or call `post_comment` as somebody else; a non-moderator
  cannot find the queue; a banned credential cannot verify a second account.
- **It does not leak.** This is the one phase where a working feature and a broken promise look
  identical from outside, so `author_id`, `actor_id`, `issued_by` and `moderation_scores` are hunted
  for by a **deep search** of every response shape the client can obtain — written as a recursive
  walk rather than a field list precisely because the failure it guards against is somebody adding a
  column or a join in six months.

Four bugs were caught by this script and by the SQL smoke tests before any of it was believed:

1. Two `case` expressions assigning `text` to enum columns, which failed only on the code path that
   grants a tier.
2. `moderation_resolve()` comparing `reports.status` against its own OUT parameter named `status` — a
   filter that matched nothing and closed zero reports, silently, while appearing to work.
3. `comment_gate()` reporting `can_comment: true` for an account that had not accepted the policy,
   while the write path returned 428 — the exact drift §4.1 is structured to prevent, in the one
   place it was duplicated.
4. Both `*_public` views declared `security_invoker` against base tables that are deliberately
   ungranted, which made every notification read and the public comment projection fail. The fix is
   §2.6's rule.

A fifth was caught in the *test*: the realtime section originally posted as an account the script had
already rate-limited, so `post_comment` raised and nothing was broadcast — indistinguishable from a
broken trigger. The script now asserts the write succeeded before waiting for the broadcast.

---

## 11. Risks specific to this phase

**Employer defamation.** §10 names it as the highest-severity failure mode and it remains so. What
this phase ships against it: a published policy with a version recorded per account, a classifier that
flags rather than blocks employer claims so a human sees them, a report path with a stated SLA, a
documented notice-and-takedown address, and escalation bound to the credential. What it does not ship
is legal review of the policy text, which is not an engineering task and should happen before launch.

**The classifier is the weakest link and the easiest to under-configure.** A deployment with no
credential publishes everything as flagged, which is safe only if somebody is actually working the
queue. The boot warning and `/health` exist for this; a monitor on queue depth should exist before
launch.

**Handle collisions across a large user base.** ~83M combinations makes a collision rare, not
impossible, and `generate_handle()` gives up after ten tries and falls back to `anon-<uuid>`. That is
correct behaviour and an ugly handle; if it ever happens at volume the vocabulary grows.

**The pepper is load-bearing and invisible.** `VERIFICATION_PEPPER` must match between the service
and the database. Changing it silently un-bans everybody banned under the old value, and nothing
detects that. It is documented in two places and it is still the sharpest edge in this phase.

**A block cannot be undone from the UI.** `set_block_from_comment(id, false)` exists and the sheet
only ever calls it with `true` — unblocking needs a comment of theirs to un-key from, and their
comments are hidden. A blocked-accounts list in Settings is the fix and is not built. §12.

---

## 12. Deferred decisions this phase records rather than makes

- **Editing a comment.** `edited_at` exists and nothing sets it, because an edit after moderation
  means the reviewed text is not the published text. Doing it properly needs re-classification on
  edit and a record of what was reviewed.
- **A blocked-accounts list**, so a block can be undone. §11.
- **Appeals as a flow.** The policy gives an address and a human answers it.
- **Redis for the rate limit**, with the trigger named in §4.2.
- **Local JWKS verification in the service.** `requireAuth` still asks Supabase Auth who a token
  belongs to, one network call per request. Phase 0 wrote down that this would be replaced "when
  there is a hot path worth optimising"; a comment POST that already waits on a classifier is not it.
- **`moderation_actions` as an audit table.** Strikes carry `issued_by` and resolutions carry
  `resolved_by`, which is enough to answer "who did this". A full action log is what an appeals
  process would need.
- **Push delivery** for the notifications this phase writes. Phase 7, as §15 has it.
