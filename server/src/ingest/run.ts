/**
 * The ingestion CLI — PHASE1.md §9.
 *
 *   npm run ingest                      every enabled source that is due
 *   npm run ingest -- --all --force     every enabled source, ignoring crawl_interval
 *   npm run ingest -- --source=stripe   one company, by slug or board token
 *   npm run ingest -- --source=stripe --dry-run
 *                                       parse and print; writes nothing, not even a run row
 *   npm run ingest -- --sweep           the staleness pass on its own
 *   npm run ingest -- --limit=10        the ten most overdue sources
 *   npm run ingest -- --replay          re-normalize every stored raw_postings row, no network
 *   npm run ingest -- --replay --source=stripe
 *                                       replay one source only
 *
 * Deliberately a command rather than a scheduler. The pipeline is plain functions, so
 * GitHub Actions (see .github/workflows/ingest.yml), a Fly cron or Inngest are
 * interchangeable wrappers over this file — and choosing between them is an ops decision
 * that does not change a line of the pipeline.
 */

import { compileDictionary } from './normalize/skills.ts';
import {
  dueSources,
  loadSkillDictionary,
  refreshOpenJobCounts,
  serviceClient,
  sourcesWithRawData,
} from './db.ts';
import { crawlSource, replaySource, type CrawlOutcome, type ReplayOutcome } from './pipeline.ts';
import { sweep } from './staleness.ts';

interface Args {
  all: boolean;
  force: boolean;
  dryRun: boolean;
  sweepOnly: boolean;
  replayOnly: boolean;
  withSweep: boolean;
  ignoreEtag: boolean;
  source?: string;
  limit?: number;
  concurrency: number;
}

function parseArgs(argv: string[]): Args {
  const flag = (name: string) => argv.includes(`--${name}`);
  const value = (name: string) => {
    const match = argv.find((arg) => arg.startsWith(`--${name}=`));
    return match?.slice(name.length + 3);
  };

  const limit = value('limit');
  const concurrency = value('concurrency');

  return {
    all: flag('all'),
    force: flag('force'),
    dryRun: flag('dry-run'),
    sweepOnly: flag('sweep'),
    replayOnly: flag('replay'),
    // The sweep runs after a full crawl by default: closing postings is only meaningful
    // once the evidence for them still being open has just been refreshed.
    withSweep: !flag('no-sweep'),
    ignoreEtag: flag('ignore-etag') || flag('force'),
    ...(value('source') ? { source: value('source') } : {}),
    ...(limit ? { limit: Number.parseInt(limit, 10) } : {}),
    // Board hosts are shared — ~80 Greenhouse boards live on one hostname — so real
    // pacing is enforced per host in http.ts. This only bounds how many boards are in
    // flight at once, which mostly bounds memory: a big board response is tens of MB.
    concurrency: concurrency ? Math.max(1, Number.parseInt(concurrency, 10)) : 4,
  };
}

/** Runs `worker` over `items` with at most `limit` in flight, preserving nothing but order of completion. */
async function pooled<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let cursor = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (item === undefined) return;
      results.push(await worker(item));
    }
  });

  await Promise.all(runners);
  return results;
}

function summarize(outcomes: CrawlOutcome[]): void {
  const total = (pick: (outcome: CrawlOutcome) => number) => outcomes.reduce((sum, o) => sum + pick(o), 0);

  const seen = total((o) => o.postingsSeen);
  const created = total((o) => o.jobsCreated);
  const updated = total((o) => o.jobsUpdated);
  const collapsed = total((o) => o.collapsed);
  const duplicates = total((o) => o.duplicates);
  const failed = outcomes.filter((o) => o.status === 'failed');
  const disabled = outcomes.filter((o) => o.disabled);

  /*
   * §15's exit metric is "dedup rate < 2%", and getting the denominator right matters.
   *
   * The rate is over *reconcile attempts* — one per posting per location after §4.4's
   * fan-out — not over postings, because a posting that fans out to four cities makes
   * four independent chances to collide.
   *
   * And it counts only cross-source duplicates. An employer posting one role under five
   * requisition ids is counted separately as `collapsed`: that is the dedup key doing its
   * job on their data, not two crawlers tripping over each other, and folding the two
   * together makes a working key look broken. See PHASE1.md §5.2.
   */
  const attempts = created + updated + collapsed + duplicates;
  const rate = (value: number) => (attempts > 0 ? ((value / attempts) * 100).toFixed(2) : '0.00');

  console.log('');
  console.log(`sources     ${outcomes.length} (${failed.length} failed, ${outcomes.filter((o) => o.status === 'not_modified').length} unchanged)`);
  console.log(`postings    ${seen} seen, ${total((o) => o.rawInserted)} changed`);
  console.log(`jobs        +${created} created, ~${updated} updated`);
  console.log(`collapsed   ${rate(collapsed)}%  (${collapsed}/${attempts})  employer re-posts, absorbed by the dedup key`);
  console.log(`dedup rate  ${rate(duplicates)}%  (${duplicates}/${attempts})  cross-source — the §15 metric`);

  if (failed.length > 0) {
    console.log('');
    for (const outcome of failed.slice(0, 15)) {
      console.log(`  failed: ${outcome.source} — ${outcome.error}`);
    }
    if (failed.length > 15) console.log(`  …and ${failed.length - 15} more`);
  }
  if (disabled.length > 0) {
    console.log('');
    console.log(`  auto-disabled: ${disabled.map((o) => o.source).join(', ')}`);
  }
}

function summarizeReplay(outcomes: ReplayOutcome[]): void {
  const total = (pick: (outcome: ReplayOutcome) => number) => outcomes.reduce((sum, o) => sum + pick(o), 0);
  const errors = total((o) => o.errors);

  console.log('');
  console.log(`sources     ${outcomes.length}`);
  console.log(`raw rows    ${total((o) => o.rawSeen)} replayed`);
  console.log(`jobs        +${total((o) => o.jobsCreated)} created, ~${total((o) => o.jobsUpdated)} updated`);
  console.log(`collapsed   ${total((o) => o.collapsed)}  duplicates  ${total((o) => o.duplicates)}`);
  if (errors > 0) console.log(`errors      ${errors} raw posting(s) failed to re-parse — see the log above`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const client = serviceClient();

  if (args.sweepOnly) {
    await sweep(client, { log: (message) => console.log(message) });
    return;
  }

  if (args.replayOnly) {
    /*
     * No network, no `dueSources` filtering — every source with landed raw data,
     * including ones auto-disabled after repeated crawl failures. Disabling a source
     * stops fetching it; it does not make the rows it already produced not worth fixing,
     * and this is exactly the path a normalizer bugfix needs (see pipeline.ts).
     */
    const sources = await sourcesWithRawData(client, args.source ? { slug: args.source } : {});
    if (sources.length === 0) {
      console.log(`No source matches "${args.source}".`);
      return;
    }

    console.log(`Replaying ${sources.length} source(s) from stored raw_postings — no network\n`);

    const dictionary = compileDictionary(await loadSkillDictionary(client));
    if (dictionary.unigrams.size === 0 && dictionary.phrases.length === 0) {
      throw new Error('The skills dictionary is empty. Run `npm run db:reset` (or `npm run seed:generate`) first.');
    }

    const started = Date.now();
    const outcomes = await pooled(sources, args.concurrency, (source) =>
      replaySource(client, source, { dictionary, log: (message) => console.log(message) }),
    );

    const corrected = await refreshOpenJobCounts(client);
    if (corrected > 0) console.log(`\ncounts      ${corrected} company open-role count(s) corrected`);

    summarizeReplay(outcomes);
    console.log(`elapsed     ${((Date.now() - started) / 1000).toFixed(1)}s`);
    return;
  }

  const sources = await dueSources(client, {
    ...(args.source ? { slug: args.source } : {}),
    force: args.force || args.source !== undefined,
    ...(args.limit ? { limit: args.limit } : {}),
  });

  const selected = args.limit ? sources.slice(0, args.limit) : sources;

  if (selected.length === 0) {
    console.log('Nothing due. Pass --force to crawl anyway, or --source=<slug> for one board.');
    return;
  }

  console.log(
    `${args.dryRun ? 'Dry run over' : 'Crawling'} ${selected.length} source(s)` +
      `${args.dryRun ? ' — nothing will be written' : ''}\n`,
  );

  const dictionary = compileDictionary(await loadSkillDictionary(client));
  if (dictionary.unigrams.size === 0 && dictionary.phrases.length === 0) {
    // Every posting would come out with no skills, which also drops its quality score.
    // Better to stop than to write a corpus that has to be re-ingested.
    throw new Error('The skills dictionary is empty. Run `npm run db:reset` (or `npm run seed:generate`) first.');
  }

  const started = Date.now();
  const outcomes = await pooled(selected, args.concurrency, (source) =>
    crawlSource(client, source, {
      dictionary,
      dryRun: args.dryRun,
      ignoreEtag: args.ignoreEtag,
      log: (message) => console.log(message),
    }),
  );

  if (!args.dryRun) {
    const corrected = await refreshOpenJobCounts(client);
    if (corrected > 0) console.log(`\ncounts      ${corrected} company open-role count(s) corrected`);
  }

  summarize(outcomes);
  console.log(`elapsed     ${((Date.now() - started) / 1000).toFixed(1)}s`);

  if (!args.dryRun && args.withSweep && !args.source) {
    console.log('');
    await sweep(client, { log: (message) => console.log(message) });
  }

  // A run where every source failed is a failed run, and CI should see that. A run where
  // one board 404s is not — boards get renamed and the source's failure counter handles it.
  const failures = outcomes.filter((outcome) => outcome.status === 'failed').length;
  if (failures === outcomes.length && outcomes.length > 0) {
    process.exitCode = 1;
  }
}

await main();
