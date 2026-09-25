# Phase 5 — Ranking

Companion to [README.md](./README.md) §15, which says what phase 5 is in three lines. This is the
design: every table, every scoring term, every client file that changes, and the reasons for each
deviation from the plan.

**Written for:** whoever builds or reviews this phase, including someone who has read none of
[PHASE1.md](./PHASE1.md), [PHASE2.md](./PHASE2.md), [PHASE3.md](./PHASE3.md) or
[PHASE4.md](./PHASE4.md).

**Exit condition (from §15):** *ranked feed beats recency on apply-rate, measurably.*

---

## Decisions taken for this phase

Five questions were open when this document was first written. They are settled, and the rest of
the document reflects the answers rather than the alternatives.

| # | Question | Chosen | Consequence |
|---|---|---|---|
| A | Does the ranked feed move to the API service? | **No. It stays in Postgres** | PHASE1.md named the trigger — "a Redis candidate pool and a diversity pass that Postgres cannot express" — and neither happened. Moving it would mean shipping six hundred candidate rows out of the database to sort them and shipping twenty back. §2. |
| B | Is there a Redis pool? | **No, and the trigger is named** | §5.4 asks for one with Postgres as the fallback. The fallback is read once per *page* by primary key, returning one row. Phase 3 made the same call about the rate limiter. §4.2. |
| C | Are taste vectors populated? | **No. The table and the ANN arm exist, dormant** | §5.2 opens with "once resumes are parsed **and embeddings exist**". Phase 4 deferred the vendor with the trigger "phase 5 starting", and this re-argues rather than silently collecting it: ranking does not change, one retrieval arm does. §5. |
| D | How is the experiment attributed? | **By the reader, from the session ledger** | The obvious join — impressions to `feed_sessions.id` — cannot work, because §3.6's `session_id` is one per app launch. Assignment is sticky per user, so the arm is read from the sessions actually served, and readers who appear under both arms are counted and excluded. §6.2. |
| E | Is cold start a separate path? | **No. It is the same scorer with fewer answerable terms** | §5.1 describes it as a separate mode. Two code paths would mean one that only runs on a user's first day and is therefore never exercised; renormalization already produces the behaviour §5.1 asks for. §3.3. |

---

## 0. What phase 5 is, in one paragraph

Phase 1 built a feed sorted by `posted_at desc`. Every phase since has added a signal about what a
particular reader wants — phase 2 their likes, saves, follows and impressions, phase 3 nothing
deliberately, phase 4 their parsed skills — and none of it has ever changed what they are shown.
This is the phase that spends them. It builds §5.1's heuristic scorer with its weights in a table,
§5.2's candidate union, §5.1's diversity and exploration rules, §5.4's session pool so the feed is
stable under a scrolling thumb, and the A/B harness that answers the only question §15 actually
asks — whether any of it beats the feed it replaces.

---

## 1. Scope

### In

- §5.1's scorer, every term, with weights in `ranking_weights` and components stored per card.
- §5.2's candidate union, three arms live and one dormant.
- §5.1's diversity rules and exploration quota.
- §5.4's `feed_sessions`, and a cursor that pages one.
- The A/B harness: `feed_experiments`, sticky assignment, and `feed_experiment_results()`.
- `explain_feed_rank()`, because §13.3 is about the feed at least as much as about the match ring.
- §5.2's `user_taste_vectors`, declared and empty.

### Out, and where it goes instead

| Not built | Why | Where it lands |
|---|---|---|
| Populating taste vectors or `jobs.embedding` | §5.2's own first clause makes it conditional on embeddings existing, and choosing an embedding vendor is still a decision with no consumer. §5 | When a vendor is chosen. The arm is written and dormant |
| §5.3's learned re-ranker | It needs "roughly 100k+ labeled impressions", and this phase is what starts producing them at rank-annotated volume | Explicitly §5.3's own phase |
| Redis | §4.2 | When the named trigger fires |
| Background pre-building of the next pool | §5.4's "near the end of the pool, build the next one in the background" is a client concern, and the pool is 200 cards deep | When somebody reaches the end of one |
| Ranking the Home tab's explicit sorts | A reader who taps "Salary" asked a question with a correct answer. §7 | Not planned — it would be a bug |
| A "why is this third" screen | `explain_feed_rank()` returns the answer; nothing renders it | When the job detail screen wants it |

---

## 2. The ranker stays in Postgres — decision A

[PHASE1.md](./PHASE1.md)'s decision B deferred moving reads to the API service and named the
trigger precisely. `lib/api.ts` still carries it in its header:

> *"when §5.1's ranker needs a Redis candidate pool and a diversity pass that Postgres cannot
> express, these same functions start issuing `fetch` to `/v1/feed` and no hook, screen or
> component changes."*

Both halves are false, so the trigger has not fired.

**Postgres can express the diversity pass.** It is a greedy walk over a scored list — two hundred
iterations of plpgsql, microseconds, once per session rather than once per page. §3.4 explains why
it is a loop rather than a window function, and the reason is about the *rule*, not about the
database.

**Moving it would make it slower.** The candidate pool is six hundred rows wide before scoring and
twenty rows narrow after paging. A ranker in the API service has to pull the wide end over the wire
to sort it, and push the narrow end back. Every input the scorer reads — impressions, interactions,
follows, the parsed resume, the cohort — is already in the database, and none of it is in the
service.

**What the seam bought is still real.** Phase 1's argument for `lib/api.ts` was reversibility, and
this phase collected on it: the pagination model changed completely — from a keyset cursor over a
sorted column to a session id and an offset — and the change is one branch in one function. No
hook, no screen, no component. That the seam was used for something other than what it was
predicted to be used for is the normal case for a good seam.

The trigger stays named. If a learned re-ranker (§5.3) arrives, it will not be a SQL function, and
that is the version of this decision that goes the other way.

---

## 3. The scorer

### 3.1 §5.1's terms, as written

```
0.28 · prefMatch      role-title match vs preferred_roles
                      + location match vs preferred_locations
0.20 · skillOverlap   Jaccard(resume.skills, job.skills)
0.16 · recency        exp(-age_days / 7)
0.14 · affinity       1.0 follows · 0.6 engaged with the company · 0.4 same industry
0.12 · quality        set at ingest
0.10 · urgency        closes within 14 days, ramping
0.10 · cohort         applications from readers at the same school
0.06 · popularity     likes and saves, corpus-wide
− 0.30 · seenPenalty  ln(1 + times shown, not engaged)
```

`skillOverlap` reuses phase 4's `skill_jaccard()` rather than restating it. §5.1 and §3.10 describe
the same Jaccard over the same two arrays, and two implementations of one question drift the day
somebody fixes one of them. `prefMatch`'s location half reuses phase 4's `location_affinity()` for
the same reason.

The hard filters — "applied, hidden, not_interested, closed" — are applied in retrieval rather than
scored at `− 1.00`. A hard filter is a reason not to *retrieve*; §5.1's notation is a way of writing
"not in the candidate set", and implementing it as a score would mean carrying rows through the
whole pipeline in order to guarantee they lose.

### 3.2 `cohort` and `popularity` are components, not a cold-start mode — decision E

§5.1 describes cold start separately: *"a new user with no resume, no likes, no follows: onboarding
preferences + popularity + recency + school-cohort signal."*

Building that as a branch would mean a second code path that only executes on somebody's first day
and is therefore the least-tested code in the ranker, guarding the most important impression the
product ever makes. Instead both signals are ordinary components that every score computes, and
renormalization does the rest: a reader with no resume has a null `skillOverlap`, a reader who
follows nobody has a null `affinity`, and the weight redistributes across what is left. A brand-new
account is scored on recency, quality, cohort and popularity — which is exactly §5.1's list — by
the same function that scores everyone else.

### 3.3 Renormalization, and null versus zero

The distinction phase 4 established for the match ring, applied to a harder case. Each term is null
when the input is absent and zero only when the input is present and bad:

- A posting with no closing date has a **null** urgency. Zero would say "this is not urgent", and
  drag down every employer who simply did not publish a deadline.
- A company the reader has no relationship with has a **null** affinity. Zero would say "this
  reader is uninterested in this company", which is a claim nobody made.
- A posting whose skills do not overlap the resume at all has a **zero** `skillOverlap`, because
  that is a real measurement.

The denominator is the sum of the weights that had inputs, and `coverage` travels in the components
so the difference between a confident 80 and a thin one is legible rather than lost.

### 3.4 The diversity pass is a loop, and why

§5.1's first rule is *"at most 2 postings per company in any 10-card window"*. That is a
**sequential** constraint: whether the eleventh card is allowed depends on which cards were
*emitted* before it, not on which scored above it. A window function can express "the nth posting
from this company in score order" but not "the nth among those that survived", because the
survivors are what it is trying to compute.

So `build_feed_session()` walks the scored list once and greedily emits, keeping a ten-element ring
of recently emitted companies and a running count per `title_normalized`. Two hundred iterations,
once per session.

Exploration is every seventh slot, ≈14%, inside §5.1's "10–15%". It is filled from further down the
list, preferring companies the reader has no history with, and it is deliberately not random: §5.1
wants "high-uncertainty jobs outside the user's established pattern", and a random card is noise
rather than a hypothesis. When there is nothing unfamiliar left to promote the slot is used
normally — an exploration quota that can stall the feed is worse than one that occasionally misses.

---

## 4. Sessions

### 4.1 Why the pool is an array

§5.4: *"this gives a **stable feed** — a user scrolling back up sees the same cards, which is the
bug most infinite feeds ship with."*

A stored array of ids is what makes that true. A cursor over a re-run query cannot be stable,
because the scores it sorts by move underneath the reader: an impression logged thirty seconds ago
changes the seen penalty, and the card they are scrolling back to has been re-ranked out from under
them.

`verify:phase5` asserts it directly — the same cursor read twice returns the same cards — and a
null cursor builds a new session, which is §5.4's "pull-to-refresh explicitly builds a new session".
That happens to fall out of React Query for free: `refetch()` on an infinite query re-runs page one
with no cursor and recomputes the rest from it.

### 4.2 No Redis — decision B

§5.4 says *"mirror it in Redis with the same TTL; Postgres is the fallback."*

The fallback is a primary-key lookup returning one row, performed **once per page** — not once per
scroll, because a page is twenty cards. That is the cheapest thing a relational database does, and
putting a network hop and a second source of truth in front of it would add a cache-coherence
problem to solve a problem that does not exist yet.

This is phase 3's rate-limiter argument, one phase later and with the same shape, so it gets the
same discipline: **the trigger is named.** Move it to Redis when the session read shows up in the
slow-query log, or when sessions are being built faster than Postgres can write the arrays — which
is a write-volume problem and would show up as bloat on `feed_sessions` first.

### 4.3 The cursor is phase 1's envelope

`encode_cursor(value, id)` has emitted an opaque base64 `{v, i}` pair since phase 1, and a session
offset and a session id fit it exactly. So phase 5 defines no new cursor format, `decode_cursor()`
still parses everything, and phase 1's own sorts keep working off the same two helpers. Two cursor
formats in one API would have been the alternative, for no gain.

---

## 5. Taste vectors are declared and dormant — decision C

Phase 4 deferred the embedding vendor with a named trigger: *"phase 5 starting."* This is phase 5,
so the deferral has to be collected or re-argued. It is re-argued, once, and then not again.

**§5.2's own first clause is conditional.** *"Once resumes are parsed **and embeddings exist**,
retrieval changes but ranking doesn't."* The second half of that sentence is the design and it is
implemented in full: ranking does not change. What changes is one arm of the candidate union.

**The union is what matters, and it exists.** §5.2's argument for the union is not about vectors:

> *"pure ANN retrieval never surfaces a posting that's different from everything the user has
> touched, which is the definition of a filter bubble and, for a job seeker, a genuine harm."*

That argument applies to any single retrieval strategy. With the ANN arm dormant the live arms are
recency, follows, and a third added here — postings at companies in an *industry* the reader
already engages with. That third arm is the cheapest available stand-in for what the vector arm will
eventually do properly, and it exists because "new" and "followed" between them cannot surface a
good posting at a company the reader has never heard of. It is removed when the vector arm lands.

**What is still missing is a vendor, not a design.** `user_taste_vectors` is created, `jobs.embedding`
and its HNSW index were created in phase 4, and the weighted-mean recipe §5.2 specifies — applied
3×, saved 2×, liked 1×, resume 2×, time-decayed — is a job to write against a column that has
numbers in it. Turning the arm on is populating a column and adding a fourth `union all`.

**The trigger, restated:** an embedding vendor being chosen. Not a phase this time, because
deferring to "the next phase" twice in a row is how a deferral becomes an omission.

---

## 6. Measuring it

### 6.1 The control arm is kept alive

§15's exit condition is comparative, so the recency feed is not deleted — it becomes an arm. Two
consequences worth stating: if the ranked arm loses, the rollback is a row in `feed_experiments`
rather than a deploy; and the control has to stay *genuinely* phase 1's ordering. A "recency" arm
that quietly kept the diversity pass would be measuring diversity, not ranking.
`verify:phase5` asserts that the control arm's pool is in `posted_at desc` order and carries no
components, because it did no scoring.

### 6.2 Attribution is by reader, not by impression — decision D

The obvious query joins `job_impressions.session_id` to `feed_sessions.id`. It cannot work: §3.6's
`session_id` is *"one per app launch"* (`lib/impressions.ts`), not one per feed pool, and phase 2
built it that way so that "impressions per session" means a sitting rather than a scroll. Redefining
it to make this query easier would silently change the meaning of a column three phases of data
already use.

It is also unnecessary, because assignment is sticky: `experiment_arm()` is a pure function of
(experiment, reader). So the arm is read from the sessions the reader was actually served — the
ledger, not the hash — which keeps historical results correct when an operator changes
`treatment_pct`.

That cannot make a mid-flight reassignment harmless, so it is **counted instead**. `contaminated` is
the number of readers who appear under both arms, and they are excluded from every rate. A quiet
reassignment is the classic way an A/B test reports a null result; a column that says it happened is
the difference between a wrong answer and a visible problem. `verify:phase5` deliberately
contaminates a reader and asserts that the query notices.

Applications and saves are counted **per distinct posting**, not per impression. A reader who
scrolled past a card four times and then applied has applied once, and counting it four times would
reward whichever arm repeated itself most — which is exactly what the seen penalty exists to
discourage.

No p-value. The function returns the counts a significance test needs; computing one inside a SQL
function would invite reading it as a verdict. §15 says "measurably", and measurably means somebody
looks at the numbers.

---

## 7. Client migration

| File | Change |
|---|---|
| `lib/api.ts` | `FeedSort` gains `'recommended'`; `fetchFeed` routes it to `ranked_feed` |
| `app/(tabs)/reels.tsx` | "For You" is `useJobFeed('recommended')`. It was `'recent'` for four phases |
| everything else | **unchanged** |

That table is the whole client migration, and it is the point of §2. `useJobFeed`,
`useInfiniteQuery`, `JobReelCard`, the pull-to-refresh indicator and every screen are untouched,
even though the pagination model underneath them changed completely.

**Explicit sorts are not ranked.** Home's sort bar still serves `recent`, `salary` and `company`
through phase 1's `feed_jobs`. A reader who taps "Salary" has asked a question with a correct answer,
and a ranker that quietly reorders an explicit sort is a control that lies. Ranking is what the feed
does when nobody has asked for anything specific.

`job_card.rank` — declared in phase 1, filled only by search, null for the feed ever since — now
carries the score.

---

## 8. Verification — `npm run verify:phase5`

51 checks, no API service required (and one of them asserts that no route was added). Four kinds:
it works; the ranking is real; the experiment is sound; it cannot be subverted or leak.

**The checks that matter most** are the ones a hash function or a `posted_at desc` feed would fail:
a posting matching the reader's stated preferences outranks one that does not (64 vs 41 on the
fixtures); a card shown and ignored five times either scores lower or leaves the pool; the scorer
docks a perfect card from 100 to 46 after five unengaged impressions; and the diversity rules hold
over the emitted order — worst company-per-window 2, worst title-per-session 3.

**Three test bugs it found in itself**, each worth recording because each one would have produced a
green run that proved nothing:

- The diversity assertions resolved postings against the script's own forty fixtures, but a
  candidate pool draws on the whole corpus. Unknown ids yielded `undefined`, were skipped, and the
  check passed on an almost-empty set. It now resolves every pooled id from the database and asserts
  that it resolved all of them.
- The preference-sensitivity check set `preferred_employment_types: ['Internship']`, which meant the
  retrieval filter — correctly — removed every posting it wanted to compare against.
- The seen-penalty check probed a posting the reader had *liked*, so §5.1's "not engaged" clause
  suppressed the penalty exactly as designed and the check failed anyway.

---

## 9. Risks specific to this phase

| Risk | Mitigation |
|---|---|
| The ranked arm loses | That is a real outcome, not a failure of the phase — §5.3 says "be prepared for it to lose". Rollback is `treatment_pct = 0`, a row, not a deploy |
| The seen penalty is too steep | At 0.30 a card shown once loses ~21 points. That is §5.1 as written; the fix is a row in `ranking_weights`, which is why that table exists |
| `feed_sessions` grows fast | One row per pull-to-refresh, each holding a 200-element array and a components blob. `prune_feed_sessions()` keeps them a day past expiry — a day, not zero, because the experiment query reads them |
| A mid-flight `treatment_pct` change | Counted as `contaminated` and excluded, rather than silently averaged into both arms |
| Diversity starves a thin corpus | The rules skip candidates rather than pad the pool, so a small corpus yields a short pool rather than a repetitive one. The exploration slot degrades to a normal slot rather than stalling |
| The ranker becomes unexplainable | `components` per card, `explain_feed_rank()` per posting, weights readable by any signed-in reader |

---

## 10. Deferred decisions this phase records rather than makes

- **An embedding vendor.** The arm is written and dormant; the trigger is a vendor being chosen,
  not a phase. §5.
- **Redis for the session pool.** Trigger named in §4.2.
- **§5.3's learned re-ranker.** Needs ~100k labeled impressions, which this phase starts producing
  with rank and position attached.
- **Background pre-building of the next pool.** §5.4 asks for it; the pool is 200 deep.
- **Removing the industry retrieval arm.** It is a stand-in for the vector arm and goes when that
  lands.
- **A "why is this third" screen.** `explain_feed_rank()` already answers it.
