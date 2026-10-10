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
import { writeBatches } from './batches.ts';

import {
  chunk,
  finishRun,
  recordSourceOutcome,
  startRun,
  touchSeen,
  TOUCH_EVERY_MS,
  type RunTotals,
  type SourceRow,
} from './db.ts';
import { HttpError, politeFetch, RobotsDisallowedError } from './http.ts';
import { extractRequirements, postingText } from './normalize/html.ts';
import { parseLocations, type ParsedLocation } from './normalize/location.ts';
import { asInternshipPay, parseSalary } from './normalize/salary.ts';
import {
  extractEmploymentType,
  extractSeniority,
  normalizeTitle,
  type SeniorityLevel,
} from './normalize/seniority.ts';
import { extractSkills, type SkillDictionary } from './normalize/skills.ts';
import { scoreQuality } from './normalize/quality.ts';
import { classifyFamily, type JobFamily } from './normalize/family.ts';
import { adapterFor } from './sources/index.ts';
import type { ParsedPosting, RawPosting, SourceAdapter, SourceRequest } from './sources/types.ts';

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
  'date_updated',
  'fetched_at',
  'fetchedAt',
  'requisition_id',
  /*
   * Workday states a posting's age as display text — "Posted 3 Days Ago" — which changes
   * on its own every single day while the posting does not. Hashed, it would mark every
   * Workday posting as changed on every crawl: full re-normalization of every tenant
   * daily, and a `raw_postings` row per posting per day forever. It is still stored and
   * still parsed (sources/workday.ts reads it for `posted_at`); it just cannot be part of
   * the identity of the content.
   */
  'postedOn',
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
  /** docs/PHASE8.md §2. Null when the title and skills name no field. */
  job_family: JobFamily | null;
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

/** Whether any of a posting's locations is in the market (MARKET_COUNTRIES) or unknown. */
export function postingInMarket(posting: Pick<ParsedPosting, 'locationRaw' | 'extraLocations' | 'workplaceHint'>): boolean {
  return parseLocations(posting.locationRaw, posting.extraLocations, posting.workplaceHint)
    .some((location) => !location.abroad);
}

/**
 * Seniority the app does not list (decision 2026-09-29). The audience is students, and
 * README §4.4 already says a student "should essentially never see a Staff Engineer role".
 * Unranked titles ("Software Engineer") stay: most of them are open to new grads.
 */
export const EXCLUDED_SENIORITY = new Set(['senior', 'staff_plus']);

function descriptionText(posting: Pick<ParsedPosting, 'descriptionText' | 'descriptionHtml'>): string {
  // The adapter's plain text is preferred where the vendor supplies one — it is their own
  // rendering, and it keeps list structure that a generic HTML strip would flatten. See
  // postingText for why "plain" still gets cleaned.
  return postingText(posting.descriptionText, posting.descriptionHtml);
}

/**
 * Whether a posting belongs in the corpus at all: in the market, and at a level the app
 * lists. Checked before a posting is stored, so one that is not wanted costs no storage and
 * no Disk IO; normalize() applies the same two rules for a replay of older raw rows.
 */
export function postingInScope(posting: ParsedPosting): boolean {
  if (!postingInMarket(posting)) return false;
  return !EXCLUDED_SENIORITY.has(extractSeniority(posting.title, descriptionText(posting)) ?? '');
}

/**
 * Postings first published more than this long ago are not stored (decision 2026-10-09, when
 * the database passed the free plan's 500 MB). The deck's fit arm only reaches back 30–60
 * days, so an evergreen requisition from last spring costs storage and is almost never shown.
 */
export const MAX_POSTING_AGE_DAYS = 90;

/**
 * Whether a posting is recent enough to store. A posting with no date is kept: an unknown age
 * is not evidence of an old one.
 *
 * This gates *landing* only, not "seen". An old job already in the corpus — one kept because a
 * student liked it or applied to it — is still touched as alive, so the staleness sweep does
 * not close a posting its board still lists.
 */
export function postingIsRecent(posting: Pick<ParsedPosting, 'postedAt'>, now = Date.now()): boolean {
  if (!posting.postedAt) return true;
  const posted = Date.parse(posting.postedAt);
  return Number.isNaN(posted) || now - posted <= MAX_POSTING_AGE_DAYS * 86_400_000;
}

/**
 * One posting → one `jobs` row per location (§4.4's fan-out).
 *
 * The rows share a `dedup_group_id`, which is what lets the UI say "also in 2 other
 * locations" later and what stops the near-miss detector filing its own siblings as
 * suspected duplicates.
 */
export function normalize(posting: ParsedPosting, context: NormalizeContext): NormalizedJob[] {
  const text = descriptionText(posting);

  const seniority = extractSeniority(posting.title, text);
  if (EXCLUDED_SENIORITY.has(seniority ?? '')) return [];
  const requirements = extractRequirements(text);
  const employmentType = extractEmploymentType(posting.employmentTypeHint, posting.title, seniority);
  const skills = extractSkills(context.dictionary, posting.title, requirements, text);
  const family = classifyFamily(posting.title, skills);
  /*
   * Only a salary the app can label honestly is stored. `job_card` carries no currency and the
   * card prints `$`, so a non-USD range would display as dollars — 226,000 złoty (≈ $57k) shown as
   * $226k/yr, the same shape of error as the ×12 bug this was found alongside. §0 decision 10 is
   * US-only first; when the card grows a currency this becomes `parseSalary(...)` again and a
   * `npm run ingest -- --replay` restores every one from `raw_postings`.
   */
  const parsedSalary = parseSalary(posting.salary, text);
  const usd = parsedSalary?.currency === 'USD' ? parsedSalary : null;
  // Internships are shown by the hour, whatever unit the employer's template used.
  const salary = employmentType === 'Internship' ? asInternshipPay(usd) : usd;

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
  const candidates = usable.length > 0 ? usable : parsed;

  // US and Canada only: a London + New York posting keeps its New York row, and a posting
  // with no location in the market produces no rows at all.
  const locations = candidates.filter((location) => !location.abroad);
  if (locations.length === 0) return [];

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
    // Not stored since 20261002000000: nothing reads it, and raw_postings keeps the source.
    description_html: null,
    requirements,
    skills,
    apply_url: posting.applyUrl,
    apply_host: context.applyHost,
    posted_at: posting.postedAt,
    closes_at: posting.closesAt,
    dedup_group_id: groupId,
    quality_score: quality,
    job_family: family,
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

/**
 * Hard cap on pages for one board.
 *
 * A tenant that reports a `total` larger than it can actually serve — or that ignores our
 * offset — would otherwise page until the process died. At Workday's 20 per page this is
 * 20,000 postings, which is an order of magnitude more than the largest real career site.
 */
const MAX_PAGES = 1_000;

/**
 * Every posting on a board, following pagination where the adapter implements it.
 *
 * Adapters that return a whole board in one response (Greenhouse, Lever, Ashby) do not
 * implement `extractPage` and take the first branch, which is byte-for-byte the behaviour
 * they had before pagination existed.
 *
 * Only the first request carries the stored ETag; a page-2 request is a different body to
 * a different offset and has no ETag of its own to send. A 304 mid-pagination is treated
 * as the end of the board rather than an error.
 */
async function readBoard(
  adapter: SourceAdapter,
  first: SourceRequest,
  firstBody: string,
): Promise<RawPosting[]> {
  if (!adapter.extractPage) return adapter.extract(firstBody);

  const postings: RawPosting[] = [];
  let page = adapter.extractPage(firstBody, first);
  postings.push(...page.postings);

  for (let fetched = 1; fetched < MAX_PAGES && page.next !== null; fetched += 1) {
    const request: SourceRequest = page.next;
    const response = await politeFetch(request);
    if (response.body === null) break;
    page = adapter.extractPage(response.body, request);
    postings.push(...page.postings);
  }

  return postings;
}

/**
 * Fills in postings whose list endpoint withheld the description.
 *
 * A detail request that fails does not fail the crawl: the posting lands with whatever the
 * list gave us, and quality.ts scores a descriptionless posting near the feed's floor on
 * its own. One 404 in a 600-posting tenant should cost that one posting, not the tenant.
 *
 * Sequential on purpose. http.ts already caps a host at 2 in flight and holds a 700ms gap
 * between requests to it, so the gap — not our parallelism — sets the pace; issuing these
 * concurrently would buy nothing and only make the pacing queue longer.
 */
async function hydrate(
  adapter: SourceAdapter,
  postings: RawPosting[],
  log: (message: string) => void,
): Promise<RawPosting[]> {
  const { detailRequest, mergeDetail } = adapter;
  if (!detailRequest || !mergeDetail) return postings;

  const hydrated: RawPosting[] = [];
  let failures = 0;

  for (const posting of postings) {
    const request = detailRequest.call(adapter, posting);
    if (request === null) {
      hydrated.push(posting);
      continue;
    }

    try {
      const response = await politeFetch(request);
      hydrated.push(
        response.body === null ? posting : mergeDetail.call(adapter, posting, response.body),
      );
    } catch (error) {
      failures += 1;
      // Logged once in aggregate below rather than per posting: a tenant having a bad
      // minute should not write 600 lines into the run log.
      if (failures === 1) log(`first detail fetch failure: ${describeError(error)}`);
      hydrated.push(posting);
    }
  }

  if (failures > 0) {
    log(`${failures}/${postings.length} detail fetch(es) failed; those postings have no description`);
  }

  return hydrated;
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
    const unprocessed = options.dryRun ? null : await client.from('raw_postings')
      .select('id').eq('source_id', source.id).is('processed_at', null).limit(1);
    if (unprocessed?.error) throw unprocessed.error;
    const response = await politeFetch({
      ...request,
      etag: options.ignoreEtag || source.consecutiveFailures > 0 || unprocessed?.data?.length ? null : source.etag,
    });

    if (response.body === null) {
      log(`304   ${label} — unchanged`);
      if (runId) await finishRun(client, runId, 'not_modified', { httpStatus: 304 });
      // A 304 is a success: the board answered, and answered that nothing moved. Recording
      // it as one is what keeps the staleness sweep's "source succeeded recently" guard true.
      if (!options.dryRun) await recordSourceOutcome(client, source, { ok: true });
      return { source: label, status: 'not_modified', ...totals };
    }

    const everything = await readBoard(adapter, request, response.body);
    /*
     * Scoped before hydration too, when hydration costs a request per posting (Workday). The
     * listing carries the title and location, which is enough to drop a foreign or senior
     * posting without fetching its detail page — thousands of requests on a board NVIDIA's
     * size. The pass after hydration still runs, for what only the full posting can say.
     */
    const listed = adapter.detailRequest
      ? everything.filter((posting) => postingInScope(adapter.parse(posting)))
      : everything;
    const hydrated = await hydrate(adapter, listed, (message) => log(`      ${label} — ${message}`));
    // Filtered before landing, so an unwanted posting costs no storage and no Disk IO at all —
    // landing it and discarding it later would re-store its payload on every crawl.
    const postings = hydrated.filter((posting) => postingInScope(adapter.parse(posting)));
    totals.postingsSeen = postings.length;
    if (postings.length < everything.length) {
      log(`      ${label} — ${everything.length - postings.length} posting(s) outside the US/Canada or above new-grad level skipped`);
    }

    const recent = postings.filter((posting) => postingIsRecent(adapter.parse(posting)));
    if (recent.length < postings.length) {
      log(`      ${label} — ${postings.length - recent.length} posting(s) older than ${MAX_POSTING_AGE_DAYS} days not stored`);
    }

    const changed = options.dryRun
      ? recent
      : await landRawPostings(client, source.id, runId, recent, totals);

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
    await writeBatches(pending, UPSERT_BATCH, 'reconcile jobs', async (batch) => {
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
    });
    if (!options.dryRun) await markRawProcessed(client, changed);

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
 * Lands every posting and returns current versions that have not finished reconciliation.
 * An existing raw row is not proof that its job was written: an earlier crawl may have
 * failed after landing it. Only processed_at acknowledges a completed import.
 *
 * Exported for the aggregator sources (server/src/ingest/aggregators/), which use the
 * exact same landing and content-hash dedup as the per-company crawlers — a feed source
 * is a different shape of adapter, not a different shape of raw-postings table.
 */
export async function landRawPostings(
  client: SupabaseClient,
  sourceId: string,
  runId: string | null,
  postings: RawPosting[],
  totals: RunTotals,
): Promise<(RawPosting & { rawId: number })[]> {
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

  const changed = new Map<string, RawPosting & { rawId: number }>();

  await writeBatches(rows, 200, 'land raw postings', async (batch) => {
    const { data, error } = await client
      .from('raw_postings')
      .upsert(batch, { onConflict: 'source_id,external_id,content_hash', ignoreDuplicates: true })
      .select('external_id, content_hash');
    if (error) throw error;

    totals.rawInserted += data?.length ?? 0;
  });

  // Filter against this fetch's hashes so an obsolete version is never replayed over
  // the current posting. Page each query: historical versions can exceed max_rows.
  for (const ids of chunk([...new Set(postings.map((posting) => posting.externalId))])) {
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await client.from('raw_postings')
        .select('id, external_id, content_hash').eq('source_id', sourceId)
        .in('external_id', ids).is('processed_at', null).order('id')
        .range(offset, offset + 499);
      if (error) throw error;
      for (const row of data ?? []) {
        const key = `${row.external_id}:${row.content_hash}`;
        const posting = byHash.get(key);
        if (posting) changed.set(key, { ...posting, rawId: row.id as number });
      }
      if (!data || data.length < 500) break;
    }
  }

  return [...changed.values()];
}

/** Called only after every location of these postings has reconciled successfully. */
export async function markRawProcessed(
  client: SupabaseClient,
  postings: (RawPosting & { rawId?: number })[],
): Promise<void> {
  const ids = postings.flatMap((posting) => posting.rawId === undefined ? [] : [posting.rawId]);
  await writeBatches(ids, 80, 'acknowledge raw postings', async (batch) => {
    const { error } = await client.from('raw_postings')
      .update({ processed_at: new Date().toISOString() }).in('id', batch);
    if (error) throw error;
  });
}

// ── replay ─────────────────────────────────────────────────────────────────────

/**
 * Re-normalizes stored postings without touching the network — the path the module
 * comment at the top of this file promises and that a normalizer bugfix actually needs.
 *
 * `landRawPostings` skips an unchanged payload once its import is acknowledged. That
 * means a normalizer fix does not propagate just by
 * re-running `crawlSource` — the ATS payload hasn't changed, so nothing is ever marked
 * `changed`, and every already-landed row is silently skipped forever. Replay is the
 * other half of that design: it reads `raw_postings` directly and reprocesses every row
 * through the *current* adapter.parse + normalize, regardless of whether the payload
 * changed.
 *
 * Each row's `processed_at` is stamped once replay has reconciled it, just as in a fresh crawl.
 */
export interface ReplayOptions {
  dictionary: SkillDictionary;
  log?: (message: string) => void;
  /**
   * Postings with an open job a crawl actually saw — the default — or every raw row.
   *
   * Every raw row is how the replay used to work, and on 2026-10-10 it re-created 295 jobs:
   * raw_postings outlives the jobs it fed, so postings that had left their boards (closed, or
   * deleted by a prune) came back as new open rows "seen" that minute. A replay is for
   * re-reading what is live, so `live` is what it does unless asked otherwise.
   */
  scope?: 'live' | 'all';
}

/**
 * Writes a crawl makes just after it records its run as finished (Workday's touch lands a few
 * seconds late), so a run's window is stretched by this much when matching rows to it.
 */
const RUN_WINDOW_SLACK_MS = 10 * 60 * 1000;

/**
 * External ids with an open job on this source that a crawl put there and still sees.
 *
 * Two tests, both needed:
 *
 *  - **Still seen.** `last_seen_at` within TOUCH_EVERY_MS before the source's last successful
 *    crawl started. A crawl that gets a 200 touches every posting the board lists, but skips
 *    rows touched in the last 12 hours, so "at or after the crawl started" would miss most of
 *    them. A 304 touches nothing and means nothing moved, so the last 200 still describes the
 *    board.
 *  - **Put there by a crawl.** `first_seen_at` inside one of the source's crawl runs. Without
 *    this, the 295 rows the 2026-10-10 full replay re-created — marked seen that night, so
 *    they pass the first test — would be refreshed again and never close. `run_id` cannot say
 *    the same thing: every replay writes it as null on the rows it updates.
 *
 * Null when the source has never had a successful crawl, which leaves nothing to call live.
 */
async function liveExternalIds(client: SupabaseClient, sourceId: string): Promise<Set<string> | null> {
  const { data: runs, error: runError } = await client
    .from('crawl_runs')
    .select('started_at, finished_at, status')
    .eq('source_id', sourceId)
    .not('finished_at', 'is', null)
    .order('started_at', { ascending: false })
    .limit(500);
  if (runError) throw runError;

  const lastSuccess = (runs ?? []).find((run) => run.status === 'success');
  if (!lastSuccess) return null;

  const windows = (runs ?? []).map((run) => [
    Date.parse(run.started_at as string),
    Date.parse(run.finished_at as string) + RUN_WINDOW_SLACK_MS,
  ]);
  const fromACrawl = (firstSeen: string) => {
    const at = Date.parse(firstSeen);
    return windows.some(([start, end]) => at >= start! && at <= end!);
  };

  const seenSince = new Date(Date.parse(lastSuccess.started_at as string) - TOUCH_EVERY_MS).toISOString();
  const ids = new Set<string>();
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await client
      .from('jobs')
      .select('external_id, first_seen_at')
      .eq('source_id', sourceId)
      .eq('status', 'open')
      .gte('last_seen_at', seenSince)
      .order('id', { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    for (const row of data ?? []) {
      if (row.external_id && fromACrawl(row.first_seen_at as string)) ids.add(row.external_id as string);
    }
    if (!data || data.length < PAGE) break;
  }
  return ids;
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
    await writeBatches(pending, UPSERT_BATCH, 'replay jobs', async (batch) => {
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
    });
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

  type RawRow = { id: unknown; external_id: unknown; payload: unknown };

  const replayRow = async (row: RawRow) => {
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

    // Flushed as it goes, not just at the end: a board with 30k raw rows would otherwise
    // hold 30k NormalizedJob objects (each with a full description) in memory at once.
    if (pending.length >= UPSERT_BATCH * 4) await flush();
  };

  const scope = options.scope ?? 'live';
  let live: Set<string> | null = null;
  const latest = new Map<string, RawRow>();
  if (scope === 'live') {
    live = await liveExternalIds(client, source.id);
    if (live === null) {
      log(`skip  ${label} — never crawled successfully, so nothing to call live`);
      return outcome;
    }
    if (live.size === 0) {
      log(`ok    ${label} — no live postings to replay`);
      return outcome;
    }
  }

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
      if (live) {
        // Only the newest stored version of a live posting. Ordered by id, so a later row
        // replaces an earlier one; an older version under a different title would otherwise
        // land as a job of its own.
        if (live.has(row.external_id as string)) latest.set(row.external_id as string, row);
        continue;
      }
      await replayRow(row);
    }

    offset += PAGE;
    if (data.length < PAGE) break;
  }

  for (const row of latest.values()) await replayRow(row);

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
