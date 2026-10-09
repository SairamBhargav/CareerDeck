/**
 * Phase 7's background work, and one runner for all of it.
 *
 * | job       | cadence          | what it does                                             |
 * |-----------|------------------|----------------------------------------------------------|
 * | push      | every 15 s       | send pending notifications to Expo                       |
 * | receipts  | every 10 min     | read Expo receipts; retire dead tokens                   |
 * | alerts    | every 30 min     | job alerts (≤1/reader/day) and deadline reminders        |
 * | news      | every 3 h        | fetch due feeds, summarize new stories                   |
 * | digest    | every 30 min, Mondays from 14:00 UTC | the weekly email, in batches        |
 * | purge     | every 6 h        | delete accounts whose 30-day grace has run out           |
 * | prune     | daily            | drop push delivery records older than 30 days            |
 * | moderation| every 2 min      | re-check comments the classifier timed out on            |
 *
 * **In process, not a queue.** The API service is already a long-running process (Fly), and
 * every job here is claimed in the database — `for update skip locked` or a unique key — so two
 * machines running the same loop take disjoint work and never double-send. That is the property a
 * queue would buy, and it is already bought. PHASE7.md §5.
 *
 * Also a CLI, for a deployment without the service and for verification:
 *
 *   node --env-file-if-exists=.env src/jobs.ts push|receipts|alerts|news|digest|purge|prune|moderation
 */

import { capabilities } from './env.ts';
import { sweepUnavailable } from './moderation/recheck.ts';
import { ingestNews } from './news/ingest.ts';
import { sendDigestBatch } from './notify/digest.ts';
import { checkPushReceipts, sendPendingPushes } from './notify/push.ts';
import { adminClient } from './auth.ts';
import { purgeDueAccounts } from './privacy.ts';

type JobName = 'push' | 'receipts' | 'alerts' | 'news' | 'digest' | 'purge' | 'prune' | 'moderation';

export const JOBS: Record<JobName, () => Promise<unknown>> = {
  push: async () => {
    // Drain: keep sending while full batches come back, so a burst clears in one tick.
    let total = 0;
    for (let i = 0; i < 20; i += 1) {
      const r = await sendPendingPushes(100);
      total += r.messages;
      if (r.notifications < 100) break;
    }
    return total;
  },
  receipts: () => checkPushReceipts(),
  alerts: async () => {
    const alerts = await adminClient.rpc('generate_job_alerts', { p_max_users: 1000 });
    if (alerts.error) throw alerts.error;
    const deadlines = await adminClient.rpc('generate_deadline_reminders', { p_within_days: 3 });
    if (deadlines.error) throw deadlines.error;
    return { alerts: alerts.data, deadlines: deadlines.data };
  },
  news: () => (capabilities.news ? ingestNews() : Promise.resolve('skipped: no ANTHROPIC_API_KEY')),
  digest: async () => {
    const now = new Date();
    if (now.getUTCDay() !== 1 || now.getUTCHours() < 14) return 'not digest time';
    return sendDigestBatch(50);
  },
  purge: () => purgeDueAccounts(),
  prune: async () => {
    const r = await adminClient.rpc('prune_push_deliveries', { p_keep_days: 30 });
    if (r.error) throw r.error;
    return r.data;
  },
  moderation: () => (capabilities.classifier ? sweepUnavailable() : Promise.resolve('skipped: no ANTHROPIC_API_KEY')),
};

const EVERY: Record<JobName, number> = {
  push: 15_000,
  receipts: 10 * 60_000,
  alerts: 30 * 60_000,
  news: 3 * 3_600_000,
  digest: 30 * 60_000,
  purge: 6 * 3_600_000,
  prune: 24 * 3_600_000,
  moderation: 2 * 60_000,
};

/** The two frequent loops only log when they did something. */
function quiet(name: JobName, result: unknown): boolean {
  if (name === 'push') return !(typeof result === 'number' && result > 0);
  if (name === 'moderation' && typeof result === 'object' && result !== null) {
    return Object.values(result).every((n) => n === 0);
  }
  return false;
}

/** Starts every loop. Each is non-overlapping, jittered, and logs rather than crashes. */
export function startBackgroundJobs(): void {
  for (const name of Object.keys(JOBS) as JobName[]) {
    const tick = async () => {
      try {
        const result = await JOBS[name]();
        if (!quiet(name, result)) {
          console.log(`[jobs] ${name}`, JSON.stringify(result));
        }
      } catch (error) {
        console.error(`[jobs] ${name} failed`, error instanceof Error ? error.message : error);
      } finally {
        setTimeout(tick, EVERY[name] * (0.9 + Math.random() * 0.2)).unref();
      }
    };
    // Staggered start, so a fresh boot does not fire every job in the same second.
    setTimeout(tick, 2_000 + Math.random() * 10_000).unref();
  }
  console.log('[jobs] background jobs started');
}

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop()!);
if (invokedDirectly) {
  const name = process.argv[2] as JobName | undefined;
  if (!name || !(name in JOBS)) {
    console.error(`usage: jobs.ts ${Object.keys(JOBS).join('|')}`);
    process.exit(2);
  }
  // The CLI runs the digest regardless of the day — whoever runs it by hand means it.
  const run = name === 'digest' ? () => sendDigestBatch(50) : JOBS[name];
  run()
    .then((result) => {
      console.log(JSON.stringify(result));
      process.exit(0);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
