/**
 * The pipeline — docs/README.md §4.1.
 *
 *   fetch → land raw_postings → normalize → enrich → reconcile
 *
 * Each step is a pure function of the previous one's output, with exactly three impure
 * edges: the fetch, the landing insert, and the reconcile call. That is what makes the
 * normalizer replayable over `raw_postings` when it has a bug, which §3.4 says is the
 * whole reason that table exists.
 *
 * One pipeline, three adapters. An adapter that needed its own pipeline would mean the
 * interface in sources/types.ts is wrong.
 */

import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  chunk,
  finishRun,
  recordSourceOutcome,
  startRun,
  touchSeen,
  type RunTotals,
  type SourceRow,
} from './db.ts';
import { HttpError, politeFetch, RobotsDisallowedError } from './http.ts';
import { extractRequirements, htmlToText } from './normalize/html.ts';
import { parseLocations, type ParsedLocation } from './normalize/location.ts';
import { parseSalary } from './normalize/salary.ts';
import {
  extractEmploymentType,
  extractSeniority,
  normalizeTitle,
  type SeniorityLevel,
} from './normalize/seniority.ts';
import { extractSkills, type SkillDictionary } from './normalize/skills.ts';
import { scoreQuality } from './normalize/quality.ts';
import { adapterFor } from './sources/index.ts';
import type { ParsedPosting, RawPosting, SourceAdapter } from './sources/types.ts';

/**
 * Rows per `ingest_upsert_jobs` call. Large enough to amortise the round trip, small
 * enough that one request body stays a few hundred kilobytes.
 */
const UPSERT_BATCH = 50;

/**
 * Fields that change on every board render whether or not the posting did.
 *
 * Hashing these makes `unique (source_id, external_id, content_hash)` useless: every
 * crawl looks like a change, every posting is re-normalized and re-written, and
 * `raw_postings` grows without bound. `crawl_runs.raw_inserted / postings_seen` is the
 * alarm for a new one appearing.
 */
const VOLATILE_KEYS = new Set([
  'updated_at',
  'updatedAt',
  'last_updated',
  'lastUpdatedAt',
  'fetched_at',
  'fetchedAt',
  'requisition_id',
]);

/** Deterministic JSON: keys sorted at every level, volatile keys removed. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      if (VOLATILE_KEYS.has(key)) continue;
      out[key] = canonicalize(source[key]);
    }
    return out;
  }
  return value;
}

/**
 * A readable message from anything that was thrown.
 *
 * `String(error)` is not enough: a PostgrestError is a plain object with `message`,
 * `code` and `details`, and stringifying it writes "[object Object]" into `crawl_runs.error`
 * — which is how the first full crawl recorded two of its failures, leaving nothing to
 * debug from.
 */
export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error !== null && typeof error === 'object') {
    const shaped = error as { message?: unknown; code?: unknown; details?: unknown; hint?: unknown };
    const parts = [shaped.message, shaped.details, shaped.hint]
      .filter((part): part is string => typeof part === 'string' && part !== '');
    const code = typeof shaped.code === 'string' ? `[${shaped.code}] ` : '';
    if (parts.length > 0) return `${code}${parts.join(' — ')}`;
    try {
      return JSON.stringify(error);
    } catch {
      return 'Unserializable error';
    }
  }
  return String(error);
}

export function contentHash(payload: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(payload))).digest('hex');
}

// ── normalize + enrich ─────────────────────────────────────────────────────────

export interface NormalizedJob {
  company_id: string;
  company_name: string;
  source_id: string | null;
  run_id: string | null;
  external_id: string;
  title: string;
  title_normalized: string;
  seniority: SeniorityLevel | null;
  location_raw: string;
  location_city: string | null;
  location_region: string | null;
  location_country: string | null;
  location_type: ParsedLocation['type'];
  employment_type: string;
  salary_min: number | null;
  salary_max: number | null;
  salary_period: 'hour' | 'year' | null;
  salary_currency: string;
  description_text: string;
  description_html: string | null;
  requirements: string[];
  skills: string[];
  apply_url: string;
  apply_host: string;
  posted_at: string | null;
  closes_at: string | null;
  dedup_group_id: string;
  quality_score: number;
}

export interface NormalizeContext {
  companyId: string;
  companyName: string;
  companyDomain: string | null;
  sourceId: string | null;
  runId: string | null;
  applyHost: string;
  dictionary: SkillDictionary;
  /** Postings on this board, for quality.ts's "a real board, not a one-off" signal. */
  boardSize: number;
}

/**
 * One posting → one `jobs` row per location (§4.4's fan-out).
 *
 * The rows share a `dedup_group_id`, which is what lets the UI say "also in 2 other
 * locations" later and what stops the near-miss detector filing its own siblings as
 * suspected duplicates.
 */
export function normalize(posting: ParsedPosting, context: NormalizeContext): NormalizedJob[] {
  // The adapter's plain text is preferred where the vendor supplies one — it is their own
  // rendering, and it keeps list structure that a generic HTML strip would flatten.
  const text = posting.descriptionText?.trim()
    ? posting.descriptionText.trim()
    : htmlToText(posting.descriptionHtml);

  const requirements = extractRequirements(text);
  const seniority = extractSeniority(posting.title, text);
  const employmentType = extractEmploymentType(posting.employmentTypeHint, posting.title, seniority);
  const skills = extractSkills(context.dictionary, posting.title, requirements, text);
  const salary = parseSalary(posting.salary, text);

  const quality = scoreQuality({
    title: posting.title,
    descriptionText: text,
    requirements,
    skills,
    hasStructuredSalary: posting.salary !== null,
    companyOpenPostings: context.boardSize,
    seniority,
    hasCompanyDomain: context.companyDomain !== null,
  });

  const titleNormalized = normalizeTitle(posting.title);
  const groupId = crypto.randomUUID();

  /*
   * Fan-out siblings that would land on the same dedup key are collapsed here.
   *
   * The key's location term is `coalesce(location_city, '*')`, so two locations from one
   * posting that resolve to the same city — or to no city at all, which "Remote" and an
   * unrecognised string both do — are the same row by construction. Sending both means
   * the second is counted as a duplicate of the first, which inflated the run's dedup
   * rate with collisions the pipeline created itself.
   */
  const parsed = parseLocations(posting.locationRaw, posting.extraLocations, posting.workplaceHint);

  /*
   * A "city" named after the employer is an office label, not a place.
   *
   * Greenhouse lets a company name its offices anything, and several use the company name:
   * Gemini's board lists "Gemini North America", which the parser has no way to know is
   * not a town. Dropping these here rather than in the parser is deliberate — it is the
   * only place that knows whose board this is.
   */
  const companyToken = context.companyName.toLowerCase().split(/\s+/)[0] ?? '';
  const usable = parsed.filter(
    (location) =>
      location.city === null ||
      companyToken.length < 3 ||
      !location.city.toLowerCase().includes(companyToken),
  );

  // Falling back to the unfiltered set rather than to nothing: a posting whose only
  // location happens to share a word with the employer's name is still a posting.
  const locations = usable.length > 0 ? usable : parsed;

  const distinct = new Map<string, (typeof locations)[number]>();
  for (const location of locations) {
    const key = location.city ?? '*';
    if (!distinct.has(key)) distinct.set(key, location);
  }

  return [...distinct.values()].map((location) => ({
    company_id: context.companyId,
    company_name: context.companyName,
    source_id: context.sourceId,
    run_id: context.runId,
    external_id: posting.externalId,
    title: posting.title,
    title_normalized: titleNormalized,
    seniority,
    location_raw: location.raw,
    location_city: location.city,
    location_region: location.region,
    location_country: location.country,
    location_type: location.type,
    employment_type: employmentType,
    salary_min: salary?.min ?? null,
    salary_max: salary?.max ?? null,
    salary_period: salary?.period ?? null,
    salary_currency: salary?.currency ?? 'USD',
    // A posting with a genuinely empty description still exists and can still be applied
    // to; quality.ts has already scored it down to near the feed's floor.
    description_text: text === '' ? posting.title : text,
    description_html: posting.descriptionHtml,
    requirements,
    skills,
    apply_url: posting.applyUrl,
    apply_host: context.applyHost,
    posted_at: posting.postedAt,
    closes_at: posting.closesAt,
    dedup_group_id: groupId,
    quality_score: quality,
  }));
}

// ── the run ────────────────────────────────────────────────────────────────────

export interface CrawlOptions {
  dictionary: SkillDictionary;
  dryRun?: boolean;
  /** Ignore the stored ETag. Used when replaying after a normalizer change. */
  ignoreEtag?: boolean;
  log?: (message: string) => void;
}

export interface CrawlOutcome extends RunTotals {
  source: string;
  status: 'success' | 'failed' | 'skipped' | 'not_modified';
  error?: string;
  disabled?: boolean;
}

export async function crawlSource(
  client: SupabaseClient,
  source: SourceRow,
  options: CrawlOptions,
): Promise<CrawlOutcome> {
  const log = options.log ?? (() => {});
  const label = `${source.kind}:${source.boardToken ?? source.boardUrl}`;

  const adapter = adapterFor(source.kind);
  if (!adapter) {
    log(`skip  ${label} — no adapter for ${source.kind} yet (§4.2 sequencing)`);
    return { source: label, status: 'skipped', postingsSeen: 0, rawInserted: 0, jobsCreated: 0, jobsUpdated: 0, collapsed: 0, duplicates: 0 };
  }
  if (!source.companyId || !source.companyName) {
    log(`skip  ${label} — source has no company`);
    return { source: label, status: 'skipped', postingsSeen: 0, rawInserted: 0, jobsCreated: 0, jobsUpdated: 0, collapsed: 0, duplicates: 0 };
  }

  const runId = options.dryRun ? null : await startRun(client, source.id);
  const totals: RunTotals = { postingsSeen: 0, rawInserted: 0, jobsCreated: 0, jobsUpdated: 0, collapsed: 0, duplicates: 0 };

  try {
    const request = adapter.request(source);
    const response = await politeFetch({
      ...request,
      etag: options.ignoreEtag ? null : source.etag,
    });

    if (response.body === null) {
      log(`304   ${label} — unchanged`);
      if (runId) await finishRun(client, runId, 'not_modified', { httpStatus: 304 });
      // A 304 is a success: the board answered, and answered that nothing moved. Recording
      // it as one is what keeps the staleness sweep's "source succeeded recently" guard true.
      await recordSourceOutcome(client, source, { ok: true });
      return { source: label, status: 'not_modified', ...totals };
    }

    const postings = adapter.extract(response.body);
    totals.postingsSeen = postings.length;

    const changed = options.dryRun
      ? postings
      : await landRawPostings(client, source.id, runId, postings, totals);

    if (!options.dryRun) {
      // Every posting the board still lists is alive, changed or not.
      await touchSeen(client, source.id, postings.map((posting) => posting.externalId));
    }

    const context: NormalizeContext = {
      companyId: source.companyId,
      companyName: source.companyName,
      companyDomain: source.companyDomain,
      sourceId: source.id,
      runId,
      applyHost: adapter.applyHost,
      dictionary: options.dictionary,
      boardSize: postings.length,
    };

    const pending: NormalizedJob[] = [];

    for (const posting of changed) {
      const rows = normalize(adapter.parse(posting), context);

      if (options.dryRun) {
        for (const row of rows) {
          log(
            `      ${row.title} — ${row.location_raw} [${row.employment_type}/${row.seniority ?? 'unranked'}] ` +
              `q=${row.quality_score} ${row.salary_min !== null ? `$${row.salary_min}-${row.salary_max}/${row.salary_period}` : 'no pay'} ` +
              `skills=${row.skills.join(',') || '—'}`,
          );
        }
        continue;
      }

      pending.push(...rows);
    }

    // Batched because a full pass produces low six figures of rows and one round trip
    // each would make the crawl's runtime a function of network latency. Reconciliation
    // is still per row inside the function — see ingest_upsert_jobs in the migration.
    for (const batch of chunk(pending, UPSERT_BATCH)) {
      const { data, error } = await client.rpc('ingest_upsert_jobs', { p_rows: batch });
      if (error) throw error;
      const counts = (data ?? {}) as {
        created?: number;
        updated?: number;
        collapsed?: number;
        duplicate?: number;
      };
      totals.jobsCreated += counts.created ?? 0;
      totals.jobsUpdated += counts.updated ?? 0;
      totals.collapsed += counts.collapsed ?? 0;
      totals.duplicates += counts.duplicate ?? 0;
    }

    log(
      `ok    ${label} — ${totals.postingsSeen} seen, ${totals.rawInserted} changed, ` +
        `+${totals.jobsCreated} new, ~${totals.jobsUpdated} updated, ` +
        `${totals.collapsed} collapsed, ${totals.duplicates} dup`,
    );

    if (runId) await finishRun(client, runId, 'success', { ...totals, httpStatus: response.status });
    if (!options.dryRun) await recordSourceOutcome(client, source, { ok: true, etag: response.etag });

    return { source: label, status: 'success', ...totals };
  } catch (error) {
    const message = describeError(error);
    log(`FAIL  ${label} — ${message}`);

    if (runId) {
      await finishRun(client, runId, 'failed', {
        ...totals,
        error: message,
        ...(error instanceof HttpError ? { httpStatus: error.status } : {}),
      });
    }

    let disabled = false;
    if (!options.dryRun) {
      // robots.txt is not a transient failure and must not be retried into a ban. It
      // disables the source on the spot, with the reason on the row.
      if (error instanceof RobotsDisallowedError) {
        await client
          .from('job_sources')
          .update({ enabled: false, notes: `Disabled: ${message}`, last_crawled_at: new Date().toISOString() })
          .eq('id', source.id);
        disabled = true;
      } else {
        ({ disabled } = await recordSourceOutcome(client, source, { ok: false }));
        if (disabled) log(`      ${label} auto-disabled after repeated failures`);
      }
    }

    return { source: label, status: 'failed', error: message, disabled, ...totals };
  }
}

/**
 * Lands every posting and returns only the ones that were not already stored byte for
 * byte. `ignoreDuplicates` makes PostgREST return just the inserted rows, which is
 * exactly the set that needs normalizing.
 */
async function landRawPostings(
  client: SupabaseClient,
  sourceId: string,
  runId: string | null,
  postings: RawPosting[],
  totals: RunTotals,
): Promise<RawPosting[]> {
  const byHash = new Map<string, RawPosting>();
  const rows = postings.map((posting) => {
    const hash = contentHash(posting.payload);
    byHash.set(`${posting.externalId}:${hash}`, posting);
    return {
      source_id: sourceId,
      run_id: runId,
      external_id: posting.externalId,
      content_hash: hash,
      payload: posting.payload,
    };
  });

  const changed: RawPosting[] = [];

  for (const batch of chunk(rows, 200)) {
    const { data, error } = await client
      .from('raw_postings')
      .upsert(batch, { onConflict: 'source_id,external_id,content_hash', ignoreDuplicates: true })
      .select('external_id, content_hash');
    if (error) throw error;

    for (const row of data ?? []) {
      const posting = byHash.get(`${row.external_id as string}:${row.content_hash as string}`);
      if (posting) changed.push(posting);
    }
  }

  totals.rawInserted = changed.length;
  return changed;
}

// ── replay ─────────────────────────────────────────────────────────────────────

/**
 * Re-normalizes stored postings without touching the network — the path the module
 * comment at the top of this file promises and that a normalizer bugfix actually needs.
 *
 * `landRawPostings` deliberately skips re-normalizing a payload it has already stored
 * byte-for-byte (that's the whole point of the content-hash dedup: an unchanged posting
 * does no downstream work). That means a normalizer fix does not propagate just by
 * re-running `crawlSource` — the ATS payload hasn't changed, so nothing is ever marked
 * `changed`, and every already-landed row is silently skipped forever. Replay is the
 * other half of that design: it reads `raw_postings` directly and reprocesses every row
 * through the *current* adapter.parse + normalize, regardless of whether the payload
 * changed.
 *
 * Each row's `processed_at` is stamped once replay has reconciled it, so
 * `raw_postings_unprocessed_idx` reflects rows this pass has actually touched rather than
 * being permanently empty (nothing else in the pipeline writes this column).
 */
export interface ReplayOptions {
  dictionary: SkillDictionary;
  log?: (message: string) => void;
}

export interface ReplayOutcome {
  source: string;
  rawSeen: number;
  jobsCreated: number;
  jobsUpdated: number;
  collapsed: number;
  duplicates: number;
  errors: number;
}

export async function replaySource(
  client: SupabaseClient,
  source: SourceRow,
  options: ReplayOptions,
): Promise<ReplayOutcome> {
  const log = options.log ?? (() => {});
  const label = `${source.kind}:${source.boardToken ?? source.boardUrl}`;

  const adapter = adapterFor(source.kind);
  const outcome: ReplayOutcome = {
    source: label,
    rawSeen: 0,
    jobsCreated: 0,
    jobsUpdated: 0,
    collapsed: 0,
    duplicates: 0,
    errors: 0,
  };

  if (!adapter || !source.companyId || !source.companyName) {
    log(`skip  ${label} — no adapter or no company`);
    return outcome;
  }

  const context: NormalizeContext = {
    companyId: source.companyId,
    companyName: source.companyName,
    companyDomain: source.companyDomain,
    sourceId: source.id,
    runId: null,
    applyHost: adapter.applyHost,
    dictionary: options.dictionary,
    // The board's current size is unknown without a fresh crawl; the count of raw rows
    // already stored for this source is the closest honest stand-in for quality.ts's
    // "a real board, not a one-off" signal.
    boardSize: 0,
  };

  // Paged rather than selected in one shot: a busy board can have tens of thousands of
  // landed rows, and PostgREST caps a single response at max_rows regardless.
  const PAGE = 500;
  let offset = 0;
  let pending: NormalizedJob[] = [];
  let processedIds: number[] = [];

  const flush = async () => {
    if (pending.length === 0) return;
    for (const batch of chunk(pending, UPSERT_BATCH)) {
      const { data, error } = await client.rpc('ingest_upsert_jobs', { p_rows: batch });
      if (error) throw error;
      const counts = (data ?? {}) as {
        created?: number;
        updated?: number;
        collapsed?: number;
        duplicate?: number;
      };
      outcome.jobsCreated += counts.created ?? 0;
      outcome.jobsUpdated += counts.updated ?? 0;
      outcome.collapsed += counts.collapsed ?? 0;
      outcome.duplicates += counts.duplicate ?? 0;
    }
    pending = [];

    if (processedIds.length > 0) {
      const { error } = await client
        .from('raw_postings')
        .update({ processed_at: new Date().toISOString() })
        .in('id', processedIds);
      if (error) throw error;
      processedIds = [];
    }
  };

  for (;;) {
    const { data, error } = await client
      .from('raw_postings')
      .select('id, external_id, payload')
      .eq('source_id', source.id)
      .order('id', { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;

    for (const row of data) {
      outcome.rawSeen += 1;
      try {
        const posting = { externalId: row.external_id as string, payload: row.payload as Record<string, unknown> };
        const rows = normalize(adapter.parse(posting), context);
        pending.push(...rows);
        processedIds.push(row.id as number);
      } catch (error) {
        outcome.errors += 1;
        log(`      ${label} — failed to replay raw_postings.id=${row.id}: ${describeError(error)}`);
      }

      // Flushed inside the page, not just at the end: a board with 30k raw rows would
      // otherwise hold 30k NormalizedJob objects (each with a full description) in
      // memory at once.
      if (pending.length >= UPSERT_BATCH * 4) await flush();
    }

    offset += PAGE;
    if (data.length < PAGE) break;
  }

  await flush();

  log(
    `ok    ${label} — replayed ${outcome.rawSeen} raw posting(s), ` +
      `+${outcome.jobsCreated} new, ~${outcome.jobsUpdated} updated, ` +
      `${outcome.collapsed} collapsed, ${outcome.duplicates} dup` +
      (outcome.errors > 0 ? `, ${outcome.errors} error(s)` : ''),
  );

  return outcome;
}

export type { SourceAdapter };
