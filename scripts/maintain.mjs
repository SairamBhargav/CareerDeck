/*
 * Nightly database maintenance — docs/PHASE2.md §7.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run db:maintain
 *
 * Three jobs, all of them the kind that are invisible until the day they have not been
 * running:
 *
 *  1. **Create impression partitions ahead.** `job_impressions` is partitioned by month,
 *     and a partitioned table with no partition covering `now()` rejects every insert.
 *     Without this, impression logging breaks at midnight on the first of a month. The
 *     default partition catches the rows in the meantime, which turns an outage into a
 *     row in the wrong place.
 *  2. **Drop partitions past retention.** §13.2: impressions are kept 13 months. Dropping
 *     a partition is the only delete at this volume that does not leave a table needing a
 *     vacuum it will never get.
 *  3. **Reconcile follower counts.** `companies.follower_count` is maintained by a trigger
 *     and correct under normal operation. §3.5 asks for a nightly check anyway, because a
 *     denormalized counter nobody verifies is a counter that is eventually wrong and
 *     nothing else in the system would notice.
 *
 * Phase 3 adds three more, all of the same character:
 *
 *  4. **Reconcile comment counts.** `comments.like_count` and `comments.reply_count` get the same
 *     treatment as the follower counter, for the same reason.
 *  5. **Expire school verifications.** §3.2: ".edu addresses die after graduation. Run a quarterly
 *     job that re-challenges `edu` verifications older than ~2 years. Do not silently revoke —
 *     notify, give a grace period, offer the ID path, then downgrade the badge (not the account)."
 *     It runs nightly rather than quarterly, because a nightly job that usually finds nothing is
 *     far more reliable than a quarterly one nobody remembers exists; the function itself is
 *     idempotent and only acts on rows that are genuinely past their date.
 *  6. **Prune read notifications.** §13.2's retention, applied to the one table phase 3 adds that
 *     grows without bound.
 *
 * Runs as the service role, which is why it is a script rather than something the app can
 * call. Wired into .github/workflows/ingest.yml so it happens on the same schedule as the
 * crawl; it is idempotent, so running it by hand is always safe.
 */

import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error(
    'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set.\n' +
      'Against the local stack: `npm run db:status` prints both.',
  );
  process.exit(1);
}

const admin = createClient(url, key, { auth: { persistSession: false } });

/** How many months of partitions to keep ahead of today. */
const MONTHS_AHEAD = 3;
/** §13.2's retention for impressions. */
const KEEP_MONTHS = 13;
/** §3.2's grace period between warning somebody their address has expired and acting on it. */
const VERIFICATION_GRACE_DAYS = 30;
/** How long a read notification is kept. Long enough to answer "what did that reply say". */
const NOTIFICATION_KEEP_DAYS = 90;

let failed = false;

async function run(label, fn) {
  try {
    const { data, error } = await fn();
    if (error) throw error;
    console.log(`ok    ${label}  — ${data ?? 0}`);
  } catch (error) {
    failed = true;
    console.error(`FAIL  ${label}  — ${error instanceof Error ? error.message : String(error)}`);
  }
}

await run('impression partitions created', () =>
  admin.rpc('ensure_impression_partitions', { p_months_ahead: MONTHS_AHEAD }),
);

await run('impression partitions dropped', () =>
  admin.rpc('drop_old_impression_partitions', { p_keep_months: KEEP_MONTHS }),
);

await run('follower counts corrected', () => admin.rpc('reconcile_follower_counts'));

await run('comment counts corrected', () => admin.rpc('reconcile_comment_counts'));

await run('school verifications expired', () =>
  admin.rpc('expire_edu_verifications', { p_grace_days: VERIFICATION_GRACE_DAYS }),
);

await run('read notifications pruned', () =>
  admin.rpc('prune_notifications', { p_keep_days: NOTIFICATION_KEEP_DAYS }),
);

// A failed partition creation is the one that matters: it is a silent outage a month from
// now rather than an error today, so it has to fail the job loudly.
process.exit(failed ? 1 : 0);
