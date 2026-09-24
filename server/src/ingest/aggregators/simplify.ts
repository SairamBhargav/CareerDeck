/**
 * The Simplify internship feed — a deliberate departure from §4.2's ATS adapters.
 *
 * Greenhouse, Lever and Ashby are read straight from the employer's own board, one
 * company at a time, which is why board-list.ts is a per-company table. This source is
 * different in kind: it is a single, third-party, community-maintained aggregation
 * (github.com/SimplifyJobs/Summer2027-Internships) covering 1,000+ employers in one JSON
 * file, including companies whose own boards run on Workday and are otherwise entirely
 * out of reach for this crawler (§4.2: "Workday is where a quarter disappears").
 *
 * **This departs from §4.3's crawl-hygiene posture.** Everywhere else in this codebase,
 * "public endpoint" means the employer's own board API, published by the employer or
 * their ATS for exactly this purpose. Here it means republishing a third party's own
 * compiled dataset, which they maintain with real ongoing effort and which is not
 * accompanied by a license or an explicit reuse grant. That is a real, acknowledged
 * legal ambiguity, not a technicality — it was raised and the decision to proceed anyway
 * was made deliberately, not by default. If this ever needs to come out, it is exactly
 * one `job_sources.enabled = false` away from being gone, because every posting it
 * produces carries this source's id and nothing else in the corpus depends on it.
 *
 * What is NOT compromised: every `apply_url` this source produces is already the
 * employer's own application page — Simplify's dataset links out the same way our own
 * crawlers do — so nothing here changes who a user is ultimately sent to.
 *
 * Structurally this is closer to a second pipeline than a fourth adapter, because the
 * unit of work is different: one fetch produces postings for a thousand companies rather
 * than one, and "which company is this" is something to resolve per-row rather than
 * something the source configuration already knows. It still lands through the same
 * `raw_postings` table and the same `ingest_upsert_job` reconciliation as everything
 * else, which is what lets a posting this source finds and a posting our own Greenhouse
 * crawl finds collapse into one row the same way any two sources would (§3.4, §5.2).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  chunk,
  getOrCreateFeedSource,
  recordSourceOutcome,
  resolveCompaniesByName,
  startRun,
  finishRun,
  type RunTotals,
  type SourceRow,
} from '../db.ts';
import { describeError, landRawPostings, type NormalizedJob } from '../pipeline.ts';
import { politeFetch } from '../http.ts';
import { parseLocations } from '../normalize/location.ts';
import { normalizeTitle } from '../normalize/seniority.ts';
import { extractSkills, type SkillDictionary } from '../normalize/skills.ts';
import { scoreQuality } from '../normalize/quality.ts';
import { isoDate, type RawPosting } from '../sources/types.ts';

/** The bot-generated JSON the repo's own README points readers at for programmatic use. */
const FEED_URL =
  'https://raw.githubusercontent.com/SimplifyJobs/Summer2027-Internships/dev/.github/scripts/listings.json';

/** Identifies this source in `job_sources`. Not a company board, so no board_token. */
const BOARD_URL = 'https://github.com/SimplifyJobs/Summer2027-Internships';

/** Updated by its own maintainers roughly daily; matching that cadence is enough. */
const CRAWL_INTERVAL = '24 hours';

const SOURCE_NOTES =
  'Community-maintained internship aggregator, not an employer board. No license is ' +
  'published for this data; reuse here is a deliberate, acknowledged decision — see the ' +
  'module comment in server/src/ingest/aggregators/simplify.ts before changing how it is ' +
  'used, and disable via enabled=false rather than editing this file if it needs to stop.';

interface SimplifyListing {
  id?: unknown;
  company_name?: unknown;
  title?: unknown;
  url?: unknown;
  locations?: unknown;
  terms?: unknown;
  degrees?: unknown;
  date_posted?: unknown;
  date_updated?: unknown;
  active?: unknown;
  is_visible?: unknown;
}

function str(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function strArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

/**
 * The employer's own ATS, read off the real apply URL this source already gives us.
 * Same buckets `apply_host` uses elsewhere, so a future ApplicationSource mapping (§7 of
 * the API surface) does not need to special-case where a posting came from.
 */
function applyHostFor(url: string): string {
  try {
    const host = new URL(url).hostname;
    if (host.includes('myworkdayjobs')) return 'workday';
    if (host.includes('greenhouse')) return 'greenhouse';
    if (host.includes('lever')) return 'lever';
    if (host.includes('ashby')) return 'ashby';
    if (host.includes('smartrecruiters')) return 'smartrecruiters';
    if (host.includes('icims')) return 'icims';
    return host;
  } catch {
    return 'unknown';
  }
}

/**
 * Turns one listing into the description this source cannot otherwise provide.
 *
 * There is no free-text description field in this feed — only a title, a company, a
 * location and a link. Rather than leave `description_text` as a bare title (which would
 * make every posting from this source look identical to a spam listing under
 * quality.ts's ordinary rules), this synthesizes a short, factual, honestly-labelled
 * stand-in: what the role is, who it is with, and where it actually came from. It never
 * claims to be the employer's own copy, and it never invents a requirement or a
 * qualification the source did not state.
 */
function synthesizeDescription(listing: {
  title: string;
  companyName: string;
  terms: string[];
  degrees: string[];
}): string {
  const parts = [`${listing.title} — an internship at ${listing.companyName}.`];

  if (listing.terms.length > 0) parts.push(`Term(s): ${listing.terms.join(', ')}.`);
  if (listing.degrees.length > 0) parts.push(`Open to: ${listing.degrees.join(', ')} students.`);

  parts.push(
    'Sourced from the Simplify community internship tracker ' +
      '(github.com/SimplifyJobs/Summer2027-Internships). Apply directly with the employer.',
  );

  return parts.join(' ');
}

export interface AggregatorOptions {
  dictionary: SkillDictionary;
  dryRun?: boolean;
  log?: (message: string) => void;
}

export interface AggregatorOutcome {
  source: string;
  status: 'success' | 'failed';
  listingsSeen: number;
  rawInserted: number;
  jobsCreated: number;
  jobsUpdated: number;
  collapsed: number;
  duplicates: number;
  companiesCreated: number;
  error?: string;
}

const UPSERT_BATCH = 50;

export async function crawlSimplifyFeed(
  client: SupabaseClient,
  options: AggregatorOptions,
): Promise<AggregatorOutcome> {
  const log = options.log ?? (() => {});
  const label = 'feed:simplify-internships';

  const created = await getOrCreateFeedSource(client, {
    kind: 'feed',
    boardUrl: BOARD_URL,
    crawlInterval: CRAWL_INTERVAL,
    notes: SOURCE_NOTES,
    createIfMissing: !options.dryRun,
  });

  // A dry run before this source has ever run for real gets a placeholder id purely so
  // logging has something to print — nothing keyed on it is written, because every write
  // downstream is already conditioned on `options.dryRun`.
  const source: SourceRow = created ?? {
    id: '00000000-0000-0000-0000-000000000000',
    kind: 'feed',
    boardUrl: BOARD_URL,
    boardToken: null,
    etag: null,
    crawlInterval: CRAWL_INTERVAL,
    lastCrawledAt: null,
    consecutiveFailures: 0,
    companyId: null,
    companyName: null,
    companyDomain: null,
  };

  const runId = options.dryRun ? null : await startRun(client, source.id);
  const totals: RunTotals & { listingsSeen: number; companiesCreated: number } = {
    postingsSeen: 0,
    listingsSeen: 0,
    rawInserted: 0,
    jobsCreated: 0,
    jobsUpdated: 0,
    collapsed: 0,
    duplicates: 0,
    companiesCreated: 0,
  };

  try {
    // A single ~13MB GET, not a per-company fetch — still routed through politeFetch for
    // the same UA/backoff/timeout handling every other request in this pipeline gets.
    // raw.githubusercontent.com serves no robots.txt of its own that restricts this path.
    const response = await politeFetch({ url: FEED_URL });
    if (response.body === null) {
      log(`304   ${label} — unchanged`);
      if (runId) await finishRun(client, runId, 'not_modified', {});
      return { source: label, status: 'success', ...totals };
    }

    const parsed: unknown = JSON.parse(response.body);
    if (!Array.isArray(parsed)) throw new Error('Simplify feed did not return a JSON array');

    const listings = (parsed as SimplifyListing[]).filter(
      (entry) => entry.active === true && entry.is_visible !== false,
    );
    totals.listingsSeen = listings.length;
    totals.postingsSeen = listings.length;

    // Company resolution up front, in one batch, rather than per listing — see
    // resolveCompaniesByName's own reasoning for why exact-name matching is the honest
    // trade here rather than §3.3's domain-based dedup.
    //
    // Gated on !dryRun, same as every other write below: a dry run matches names against
    // companies that already exist and leaves the rest unresolved, rather than creating
    // real rows to preview against. The before/after count is only meaningful, and only
    // non-zero, once that gate is respected — it previously wasn't, and running
    // `--dry-run` once was enough to create ~1,100 company rows for real.
    const beforeCount = await client.from('companies').select('id', { count: 'exact', head: true });
    const names = listings.map((entry) => str(entry.company_name)).filter((name): name is string => name !== null);
    const companyIds = await resolveCompaniesByName(client, names, { createMissing: !options.dryRun });
    const afterCount = await client.from('companies').select('id', { count: 'exact', head: true });
    totals.companiesCreated = Math.max(0, (afterCount.count ?? 0) - (beforeCount.count ?? 0));

    const rawPostings: RawPosting[] = [];
    for (const entry of listings) {
      const id = str(entry.id);
      const companyName = str(entry.company_name);
      const title = str(entry.title);
      const url = str(entry.url);
      if (!id || !companyName || !title || !url) continue; // unusable without these four

      rawPostings.push({
        externalId: id,
        // Only the fields that matter for change detection travel into raw_postings;
        // date_updated is already in the shared VOLATILE_KEYS list in pipeline.ts and
        // gets stripped before hashing regardless, but excluding it here too keeps the
        // stored payload itself a true record of what we normalize from.
        payload: {
          id,
          company_name: companyName,
          title,
          url,
          locations: strArray(entry.locations),
          terms: strArray(entry.terms),
          degrees: strArray(entry.degrees),
          date_posted: entry.date_posted ?? null,
        },
      });
    }

    const changed = options.dryRun
      ? rawPostings
      : await landRawPostings(client, source.id, runId, rawPostings, totals);

    const pending: NormalizedJob[] = [];
    for (const posting of changed) {
      const p = posting.payload as {
        company_name: string;
        title: string;
        url: string;
        locations: string[];
        terms: string[];
        degrees: string[];
        date_posted: unknown;
      };

      const companyId = companyIds.get(p.company_name);
      if (!companyId) continue; // resolution failed for this name; skip rather than guess

      const titleNormalized = normalizeTitle(p.title);
      const [primaryLocation, ...extraLocations] = p.locations;
      const locations = parseLocations(primaryLocation ?? null, extraLocations, null);
      const description = synthesizeDescription({
        title: p.title,
        companyName: p.company_name,
        terms: p.terms,
        degrees: p.degrees,
      });
      const requirements = p.degrees.length > 0 ? [`Open to ${p.degrees.join(', ')} students`] : [];
      const skills = extractSkills(options.dictionary, p.title, requirements, '');

      const quality = scoreQuality({
        title: p.title,
        descriptionText: description,
        requirements,
        skills,
        hasStructuredSalary: false,
        // This source's own postings-per-company count, not the corpus-wide count — a
        // company this feed lists three internships for reads as a real program the same
        // way it would from a direct crawl.
        companyOpenPostings: listings.filter((entry) => str(entry.company_name) === p.company_name).length,
        // Hard-set, not classified: the repo's whole scope is internships, so trusting
        // the source is more accurate than running title-based inference meant for
        // sources that mix seniority levels.
        seniority: 'intern',
        hasCompanyDomain: false,
        hasFullDescription: false,
      });

      const groupId = crypto.randomUUID();
      for (const location of locations) {
        pending.push({
          company_id: companyId,
          company_name: p.company_name,
          source_id: source.id,
          run_id: runId,
          external_id: posting.externalId,
          title: p.title,
          title_normalized: titleNormalized,
          seniority: 'intern',
          location_raw: location.raw,
          location_city: location.city,
          location_region: location.region,
          location_country: location.country,
          location_type: location.type,
          employment_type: 'Internship',
          salary_min: null,
          salary_max: null,
          salary_period: null,
          salary_currency: 'USD',
          description_text: description,
          description_html: null,
          requirements,
          skills,
          apply_url: p.url,
          apply_host: applyHostFor(p.url),
          posted_at: isoDate(p.date_posted),
          closes_at: null,
          dedup_group_id: groupId,
          quality_score: quality,
        });
      }
    }

    if (!options.dryRun) {
      for (const batch of chunk(pending, UPSERT_BATCH)) {
        const { data, error } = await client.rpc('ingest_upsert_jobs', { p_rows: batch });
        if (error) throw error;
        const counts = (data ?? {}) as { created?: number; updated?: number; collapsed?: number; duplicate?: number };
        totals.jobsCreated += counts.created ?? 0;
        totals.jobsUpdated += counts.updated ?? 0;
        totals.collapsed += counts.collapsed ?? 0;
        totals.duplicates += counts.duplicate ?? 0;
      }
    } else {
      for (const row of pending.slice(0, 20)) {
        log(
          `      ${row.title} — ${row.company_name} — ${row.location_raw} ` +
            `q=${row.quality_score} host=${row.apply_host} skills=${row.skills.join(',') || '—'}`,
        );
      }
    }

    log(
      `ok    ${label} — ${totals.listingsSeen} listings, ${totals.rawInserted} changed, ` +
        `+${totals.jobsCreated} new, ~${totals.jobsUpdated} updated, ` +
        `${totals.collapsed} collapsed, ${totals.duplicates} dup, ` +
        `${totals.companiesCreated} companies created`,
    );

    if (runId) await finishRun(client, runId, 'success', totals);
    if (!options.dryRun) await recordSourceOutcome(client, source, { ok: true });

    return { source: label, status: 'success', ...totals };
  } catch (error) {
    const message = describeError(error);
    log(`FAIL  ${label} — ${message}`);
    if (runId) await finishRun(client, runId, 'failed', { ...totals, error: message });
    if (!options.dryRun) await recordSourceOutcome(client, source, { ok: false });
    return { source: label, status: 'failed', ...totals, error: message };
  }
}
