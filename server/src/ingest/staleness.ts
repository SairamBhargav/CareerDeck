/**
 * The staleness sweep — docs/README.md §3.4.
 *
 * "A crawler that stops seeing a posting is the only closure signal you get. Nightly: any
 * `open` job whose `source_id` was crawled successfully in the last 24h but whose
 * `last_seen_at` is older than 48h → `status = 'closed'`. Guard on the source having
 * actually succeeded, or one failing crawler closes a company's entire board."
 *
 * The guard lives in `close_stale_jobs()` in the migration rather than here, so it cannot
 * be bypassed by a second caller. This module is the operational wrapper: run it, report
 * what it did, and refuse to run it when the evidence is not there.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { closeStaleJobs, refreshOpenJobCounts } from './db.ts';

export interface SweepReport {
  closed: number;
  countsRefreshed: number;
  healthySources: number;
  failingSources: number;
  skipped: boolean;
}

/**
 * Refuses to sweep when no source has succeeded recently.
 *
 * `close_stale_jobs()` is already guarded per source, so this cannot close anything in
 * that state anyway — but an unconditional "closed 0 jobs" in the log reads like a quiet
 * success, and the situation it hides (every crawler broken) is the one worth shouting
 * about.
 */
export async function sweep(
  client: SupabaseClient,
  options: { unseenHours?: number; log?: (message: string) => void } = {},
): Promise<SweepReport> {
  const log = options.log ?? (() => {});
  const unseenHours = options.unseenHours ?? 48;

  const since = new Date(Date.now() - 24 * 3_600_000).toISOString();

  const [{ count: healthy, error: healthyError }, { count: failing, error: failingError }] = await Promise.all([
    client
      .from('job_sources')
      .select('id', { count: 'exact', head: true })
      .eq('enabled', true)
      .eq('consecutive_failures', 0)
      .gt('last_success_at', since),
    client
      .from('job_sources')
      .select('id', { count: 'exact', head: true })
      .eq('enabled', true)
      .gt('consecutive_failures', 0),
  ]);

  if (healthyError) throw healthyError;
  if (failingError) throw failingError;

  const healthySources = healthy ?? 0;
  const failingSources = failing ?? 0;

  if (healthySources === 0) {
    log('sweep skipped — no source has succeeded in the last 24h, so nothing can be trusted to be gone');
    return { closed: 0, countsRefreshed: 0, healthySources, failingSources, skipped: true };
  }

  const closed = await closeStaleJobs(client, unseenHours);
  const countsRefreshed = await refreshOpenJobCounts(client);

  log(
    `sweep closed ${closed} posting(s) unseen for ${unseenHours}h across ${healthySources} healthy source(s); ` +
      `${countsRefreshed} company count(s) corrected` +
      (failingSources > 0 ? `; ${failingSources} source(s) failing and skipped` : ''),
  );

  return { closed, countsRefreshed, healthySources, failingSources, skipped: false };
}
