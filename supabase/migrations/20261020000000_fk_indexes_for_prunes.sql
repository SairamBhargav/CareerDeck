/*
 * Renumbered from 20261017000000 on merge (2026-10-09).
 *
 * That version was taken by 20261017000000_suggested_companies_personal.sql, which had
 * already been pushed — so the remote recorded 20261017000000 as applied and this file,
 * sharing the version, would have been treated as done and skipped forever. The indexes
 * below would never have been created, silently.
 *
 * Nothing in the SQL changed; only the filename.
 */
/*
 * Index the foreign keys that the nightly prunes and the account purge delete through
 * (2026-10-07 pre-launch scan).
 *
 * Postgres does not index the referencing side of a foreign key. Deleting a parent row then
 * checks each child table for referencing rows (to cascade, set null or refuse), and without an
 * index that check is a sequential scan per deleted parent. These five are on paths that delete
 * parents in bulk:
 *
 *  - prune_closed_jobs() deletes closed jobs nightly. job_match_scores is keyed (user_id, job_id),
 *    so its cascade cannot use the primary key, and the table grows with users × scored postings.
 *    Its `not exists` on auto_apply_runs.job_id scans that table per candidate job too.
 *  - prune_notifications() deletes read notifications; push_deliveries cascades from them.
 *  - unregister_push_token() and the purge delete push tokens; push_deliveries cascades again.
 *  - The account purge deletes a profile; notifications.actor_id is set null on every row that
 *    person's likes produced, across everybody's notifications.
 *
 * All of these tables are small today, so a plain create index takes a brief lock and finishes.
 */

create index if not exists job_match_scores_job_idx      on public.job_match_scores (job_id);
create index if not exists auto_apply_runs_job_idx       on public.auto_apply_runs (job_id);
create index if not exists push_deliveries_notification_idx on public.push_deliveries (notification_id);
create index if not exists push_deliveries_token_idx     on public.push_deliveries (token_id);
create index if not exists notifications_actor_idx       on public.notifications (actor_id)
  where actor_id is not null;
