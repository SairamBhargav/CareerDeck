# Phase 8 — A deck that knows what the student is studying

Companion to [README.md](./README.md) §5 (ranking) and [PHASE5.md](./PHASE5.md), which built the
ranker this phase changes.

**Written for:** whoever builds or reviews this phase, including someone who has read none of the
earlier phase documents.

**Exit condition:** a CS student who is looking for an internship opens the deck and sees
software, data and ML internships posted in the last month, with room left for exploration. A
student whose major is marketing sees marketing roles.

**Status:** built and verified locally on branch `deck-personalization`, 2026-09-29.
- `npm run verify:phase8` passes 61 checks.
- Phases 0–7 and `verify:ingest-recovery` still pass. Their only skips are the checks that need a model.
- Going live needs the owner to do three things (§7).

---

## Decisions taken for this phase

| # | Question | Chosen | Consequence |
|---|---|---|---|
| A | Where does a student's major come from? | **The resume** *(owner's choice)*, editable on Profile | Onboarding stays at three steps. Confirming a parsed resume fills `profiles.major` and `graduation_year` when they are blank. It never overwrites what the student typed. §3. |
| B | How strictly does the deck keep to a student's fields? | **Mostly in-field, plus the explore slot** *(owner's choice)* | Retrieval is scoped to the student's job families. Phase 5's one-in-seven exploration slot keeps out-of-field cards from vanishing. §4. |
| C | What happens to "Already working"? | **Renamed for early-career switchers** *(assumed from "i like"; owner to confirm)* | It targets new-grad and mid-level roles. Senior and Staff+ are no longer stored (decision 2026-09-29), so the old `mid, senior` target half-pointed at nothing. §3.2. |
| D | How recent is "recent"? | **30 days, widening to 60 when thin** *(owner's choice)* | 6,013 of 13,649 open jobs were posted within 30 days on 2026-09-29, and 8,702 within 60. §4.1. |
| E | Where do application answers live? | **A new owner-only table, prefilled from the resume** *(owner's request)* | Work authorization, sponsorship, links, start date and relocation, which the student states once. Auto Apply uses them instead of leaving those questions blank on every draft. §5. |

---

## 1. What was wrong

Onboarding asked the right questions, and the ranker ignored almost every answer:

| Signal | Collected by | Read by the ranker before this phase |
|---|---|---|
| Stage ("Student, looking for an internship") | onboarding step 1 | only as an employment-type filter. The target seniority was computed and thrown away. |
| Fields ("Software Development", "Marketing"…) | onboarding step 2 → `user_preferences.preferred_industries` | never |
| School | sign-up picker → `profiles.school_id_claimed` | never. The cohort signal reads `school_id`, which only verification sets. |
| Graduation year | sign-up → `profiles.graduation_year` | never |
| Major | nowhere in onboarding; Profile only | never |
| Resume field of study, graduation year | resume parse → `resume_profiles.education` | never |
| Resume skills | resume parse | yes, as 20% of the score |

The job side had the matching gap: **jobs carried no field at all.** Retrieval took "the 200
newest eligible jobs of any kind", so a CS student with no follows was scored against whatever
sales, manufacturing and legal postings happened to be newest. A good software internship from
two weeks ago often never reached the scorer.

## 2. Job families

Every job gets a `job_family`, classified from its title at crawl time, with skills as the
tiebreak:

| Family | Covers |
|---|---|
| `software` | software, web, mobile, infrastructure, DevOps/SRE, security, IT |
| `data_ml` | data science and analytics, data engineering, ML/AI, research engineering, quant |
| `hardware` | electrical, mechanical, manufacturing, embedded/firmware, robotics, test, production |
| `product` | product and program management |
| `design` | UX/UI, product, graphic and brand design |
| `business` | finance, accounting, strategy, business operations, consulting |
| `sales_marketing` | sales, business development, marketing, communications, growth, customer success |
| `operations` | operations, supply chain, support, people/HR, recruiting, legal, policy |

A title that matches nothing stays `null`, and a null family is never filtered out (§4).

A first rough pass on 2026-09-29 classified 75% of open jobs by title alone. Rules are ordered
most-specific first, so "Product Designer" is `design` and not `product`, and "Data Engineer" is
`data_ml` and not `software`. Existing jobs are classified once by `scripts/backfill-job-family.mjs`.

## 3. What we know about the student

### 3.1 Fields

`user_job_families(user)` is the union of three sources. Each maps to families through a small
seeded table:

1. **Onboarding fields**, through `sector_families` (for example `software-development` →
   `software`, and `data-science` → `data_ml`).
2. **Major**, from `profiles.major`, through `major_families` (keyword patterns: "computer",
   "software" → `software` and `data_ml`; "statistics" → `data_ml`; "marketing" →
   `sales_marketing`…).
3. **The resume's fields of study**, through the same major patterns.

A union rather than a precedence order: a student who picked "Finance" in onboarding and whose
resume says Computer Science is interested in both, and a feed of both is the honest reading. An
empty union means no family filter, which is the phase 5 behaviour.

**Major comes from the resume** (decision A). Confirming a parsed resume fills
`profiles.major` and `profiles.graduation_year` when they are blank, from the most recent
education entry. It never overwrites a value the student entered: the resume is evidence, and
the student's own statement wins.

### 3.2 Stage

Onboarding step 1 is stored as `user_preferences.career_stage`, and `target_seniorities(user)`
turns it into levels:

| Stage | Seniorities shown |
|---|---|
| `student_intern` | intern |
| `graduating` | new_grad, intern |
| `recent_grad` | new_grad |
| `early_career` (was "Already working") | new_grad, mid |

With no stage, graduation year decides. A graduation year more than a year out means intern; a
graduation year within a year either side means new grad and intern; anything older means new
grad and mid. A job with no detected seniority is always allowed, because most "Software Engineer"
titles are open to new grads.

### 3.3 School

The cohort signal ("students at your school applied to these") reads
`coalesce(school_id, school_id_claimed)`. The claimed school is safe for ranking because a feed is
private: the worst a false claim does is give the claimant a worse feed. The comment badge keeps
reading the verified `school_id` only.

## 4. The deck

### 4.1 Retrieval

The phase 5 candidate pool becomes:

| Arm | What | Size |
|---|---|---|
| **fit** (new) | in the student's families (or any family when they have none), at a target seniority, posted within the window | 400 |
| follow | every open job at a followed company (unchanged) | 200 |
| industry | companies in industries the student has liked or saved (unchanged) | 200 |
| **explore** (replaces "200 newest") | the newest jobs *outside* the student's families, at a target seniority | 60 |

The window is 30 days. When fewer than 150 jobs fit, it widens to 60 days (decision D). The
hard filters (hidden, not interested, applied, closed, quality, employment type) are unchanged.

### 4.2 Scoring

A new component, `fieldMatch`:
- 1.0 when the job's family is one of the student's
- 0.3 when the job has no family
- 0.0 otherwise
- null when the student has no families, so renormalization drops it, as with every other component

It joins as weights row `v2-fields`, alongside phase 5's `v1-heuristic`.
Weights are rows, not code, so tuning later is an update and not a migration.

## 5. Application answers (decision E)

A student answers the same questions on every application. A new owner-only table,
`application_answers`, stores them once:

- degree, and `field_of_study` shown with it: **prefilled from the resume**
- authorized to work in the US; needs sponsorship now or later
- LinkedIn, GitHub and portfolio links
- earliest start date; willing to relocate

They are edited in a new **Application answers** section on Profile. Resume-derived values arrive
prefilled and marked as coming from the resume. Nothing sensitive is ever inferred: work
authorization and sponsorship are answered by the student or left blank.

**Auto Apply reads them.** Phase 6's drafter leaves work authorization and sponsorship null on
every draft, because it must never infer them. A student's own saved answer is not inference, so
the drafter receives these answers as stated facts. They are included in the CCPA export and
deleted with the account.

## 6. Verification

`npm run verify:phase8` checks the following against the local stack:
- the classifier on real titles
- `user_job_families` from each of the three sources, and their union
- `target_seniorities` from stage and from graduation year
- that a CS intern's deck is in-field, in-window, and still carries explore cards
- that confirming a resume fills a blank major and leaves a typed one alone
- that another student cannot read someone's application answers

Phases 1, 5 and 6 are re-run, because this phase changes the ingest function, the ranker and the
drafter's input.

**What verification caught.** The first version of the session checks put every fixture posting
at one company. Phase 5's diversity rule (at most 2 per company in any 10 cards) then dropped all
but two of them, and the ordering checks were measuring the diversity pass instead of
`fieldMatch`. The fixtures are now dealt across six companies.

**The classifier on the hosted corpus**, dry run, 2026-09-29, 13,649 open jobs:

| Family | Share |
|---|---|
| software | 24.0% |
| data_ml | 17.1% |
| sales_marketing | 13.7% |
| hardware | 11.5% |
| operations | 6.9% |
| product | 5.7% |
| business | 5.5% |
| design | 1.0% |
| **unclassified** | **14.6%** |

Unclassified jobs are still shown; they score 0.3 on `fieldMatch` rather than 0.

## 7. Going live

1. `npx supabase db push --linked` applies `20261004000000_phase8_personalization.sql`, plus
   `20261005000000` (closed-job retention) and `20261005000001` (stops the A/B, see item 3).
   Together they add one nullable column and one index to `jobs`, with no table rewrite.
2. `node --env-file=server/.env scripts/backfill-job-family.mjs --apply` classifies the existing
   jobs. It is about 11,600 updates, once, in batches of 200.
3. **The phase 5 A/B is still running at 50%.** `ranked_feed_v1` sends half of all readers to the
   control arm, which is phase 1's newest-first feed and therefore gets none of this phase. That is
   correct for measuring the ranker. It also means half of launch users would not see a
   personalized deck. Stopping it is one row:
   `update feed_experiments set is_running = false where name = 'ranked_feed_v1'`.
   `20261005000001_stop_ranked_feed_ab.sql` makes that change. It is a separate file, so
   deleting it before `db push` keeps the experiment running.
