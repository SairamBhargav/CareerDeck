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
 * When a paid tier exists this becomes a function of the viewer's plan, and the database's
 * `max_live` becomes a select against it. Until then a single constant is the honest shape.
 */
export const FREE_RESUME_LIMIT = 3;
