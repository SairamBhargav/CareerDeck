/*
 * Stops phase 5's ranked-versus-recency A/B, so every reader gets phase 8's personalized deck.
 *
 * ── OWNER'S CALL: delete this file before `db push` to keep the experiment running ────────
 *
 * `ranked_feed_v1` sends half of all readers to the control arm, which is phase 1's
 * newest-first feed: no field, no level, no ranking. That is the right design for proving the
 * ranker beats recency (PHASE5.md), and it would mean half of launch users never see the deck
 * phase 8 built. Proposed 2026-09-29 in PHASE8.md §7. Kept in its own migration so it can be
 * vetoed without touching anything else.
 *
 * Reversible with one row: set is_running back to true, and assignment is a deterministic
 * hash, so every reader returns to the arm they had before.
 *
 * With the experiment stopped, experiment_arm() answers 'ranked' for everyone, and
 * feed_experiment_results() still reports whatever was measured while it ran.
 */

update public.feed_experiments
   set is_running = false,
       stopped_at = now(),
       notes = coalesce(notes || ' ', '') || 'Stopped 2026-09-29 before launch so every reader gets the personalized deck (PHASE8.md §7).'
 where name = 'ranked_feed_v1'
   and is_running;
