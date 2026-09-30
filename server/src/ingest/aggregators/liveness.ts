/**
 * Closes Simplify postings the employer has already taken down.
 *
 * The staleness sweep (../staleness.ts) closes a posting when its source stops listing it. For
 * the Simplify feed that source is Simplify, which lags employers by days — so a posting stays
 * "open" here, in reels and in Auto Apply, after its page already says "not found". This asks
 * each employer's ATS directly (detail.ts `checkPostingLive`) and closes only clear "gone"s.
 *
 *   npm run ingest:verify-live              check and close
 *   npm run ingest:verify-live -- --dry-run check and report only
 *
 * Also runs after every Simplify crawl in run.ts.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { checkPostingLive, type Liveness } from './detail.ts';

export interface LivenessReport {
  checked: number;
  gone: number;
  closedRows: number;
  unknown: number;
}

export async function closeDeadFeedPostings(
  client: SupabaseClient,
  options: { dryRun?: boolean; concurrency?: number; log?: (message: string) => void } = {},
): Promise<LivenessReport> {
  const log = options.log ?? (() => {});

  const { data: sources, error: sourceError } = await client.from('job_sources').select('id').eq('kind', 'feed');
  if (sourceError) throw sourceError;
  const sourceIds = (sources ?? []).map((source) => source.id as string);

  const urls = new Set<string>();
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await client
      .from('jobs')
      .select('apply_url')
      .in('source_id', sourceIds)
      .eq('status', 'open')
      .order('id')
      .range(offset, offset + 999);
    if (error) throw error;
    for (const row of data ?? []) urls.add(row.apply_url as string);
    if (!data || data.length < 1000) break;
  }

  const queue = [...urls];
  const results = new Map<string, Liveness>();
  let next = 0;
  await Promise.all(Array.from({ length: options.concurrency ?? 12 }, async () => {
    while (next < queue.length) {
      const url = queue[next++]!;
      results.set(url, await checkPostingLive(url).catch(() => 'unknown' as const));
    }
  }));

  const gone = queue.filter((url) => results.get(url) === 'gone');
  const report: LivenessReport = {
    checked: queue.length,
    gone: gone.length,
    closedRows: 0,
    unknown: queue.filter((url) => results.get(url) === 'unknown').length,
  };

  if (!options.dryRun) {
    for (let i = 0; i < gone.length; i += 100) {
      const { count, error } = await client
        .from('jobs')
        .update({ status: 'closed' }, { count: 'exact' })
        .in('apply_url', gone.slice(i, i + 100))
        .eq('status', 'open');
      if (error) throw error;
      report.closedRows += count ?? 0;
    }
  }

  log(
    `live  feed postings — ${report.checked} checked, ${report.gone} gone at the employer ` +
      `(${options.dryRun ? 'dry run, nothing closed' : `${report.closedRows} row(s) closed`}), ` +
      `${report.unknown} could not be checked`,
  );
  return report;
}

// Run directly: `node server/src/ingest/aggregators/liveness.ts [--dry-run]`.
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/').replace(/^(?=[A-Za-z]:)/, '/')}`) {
  const { serviceClient } = await import('../db.ts');
  await closeDeadFeedPostings(serviceClient(), {
    dryRun: process.argv.includes('--dry-run'),
    log: (message) => console.log(message),
  });
}
