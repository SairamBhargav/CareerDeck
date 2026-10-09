/**
 * Product limits the UI has to know about.
 *
 * These are *copies* of numbers the database enforces, and that duplication is deliberate and
 * one-directional: the server is the authority and the client's copy exists only so the user
 * finds out before they act rather than after. A disabled Add tile that explains itself beats
 * a file picker, a hash, an upload and then an error.
 *
 * The rule for anything in here: the server must still reject the action on its own. Nothing
 * below is a security boundary — deleting this file should cost clarity, never correctness.
 */

/**
 * How many resumes a free account keeps on the shelf at once.
 *
 * Mirrors `max_live` in `register_resume` (migration 20260928000000), which raises `CD011`
 * past this count. Phase 4's original cap was 10, chosen as an abuse ceiling rather than a
 * product limit — see that migration for why the two are different questions.
 *
 * Phase 6 made both halves of that prediction true: `max_live` reads `plans.resume_limit` for
 * the viewer's plan, and the shelf reads the same number from `my_credits()`. This constant is
 * now only the fallback `useCredits` shows before that answer arrives — the `free` row's value.
 */
export const FREE_RESUME_LIMIT = 3;

/**
 * Free readers open the full match breakdown on this many postings a week (Monday to Sunday,
 * their own time). Mirrors `match_look_limit()` in 20261025000000_match_free_looks.sql, which is
 * the one that is enforced; this copy is for words on screen before the server has answered.
 */
export const FREE_MATCH_LOOKS = 3;
