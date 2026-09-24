/**
 * The ingestion pipeline's database access.
 *
 * Everything here runs under the service role, which bypasses every RLS policy in the
 * project. That is correct for a crawler — it writes tables no user may write — and it is
 * also why nothing in this module takes a user id or is reachable from a request handler.
 * The only caller is run.ts.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { AtsKind, SourceRef } from './sources/types.ts';
import type { SkillEntry } from './normalize/skills.ts';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Copy server/.env.example to server/.env and fill it in ` +
        `(\`npm run db:status\` in the repo root prints the local values).`,
    );
  }
  return value;
}

export function serviceClient(): SupabaseClient {
  return createClient(required('SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
    // The pipeline's writes are large and frequent; asking PostgREST to send every row
    // back doubles the traffic for data nothing reads.
    db: { schema: 'public' },
    global: { headers: { 'x-client-info': 'careerdeck-ingest' } },
  });
}

export interface SourceRow extends SourceRef {
  companyId: string | null;
  companyName: string | null;
  companyDomain: string | null;
  crawlInterval: string;
  lastCrawledAt: string | null;
  consecutiveFailures: number;
}

/**
 * Sources that are enabled and due, oldest first.
 *
 * "Due" is `last_crawled_at + crawl_interval < now()`, evaluated in SQL so a run started
 * five minutes after the last one does nothing rather than crawling every board again.
 * `--force` skips the check; nothing else does.
 */
export async function dueSources(
  client: SupabaseClient,
  options: { slug?: string; force?: boolean; limit?: number } = {},
): Promise<SourceRow[]> {
  let query = client
    .from('job_sources')
    .select('id, kind, board_url, board_token, etag, crawl_interval, last_crawled_at, consecutive_failures, companies(id, name, domain, slug)')
    .eq('enabled', true)
    .order('last_crawled_at', { ascending: true, nullsFirst: true });

  if (options.limit) query = query.limit(options.limit);

  const { data, error } = await query;
  if (error) throw error;

  const now = Date.now();

  return (data ?? [])
    .map((row): SourceRow => {
      // PostgREST returns an embedded one-to-one as an object, but types it as either.
      const company = (Array.isArray(row.companies) ? row.companies[0] : row.companies) as
        | { id: string; name: string; domain: string | null; slug: string }
        | null
        | undefined;

      return {
        id: row.id as string,
        kind: row.kind as AtsKind,
        boardUrl: row.board_url as string,
        boardToken: (row.board_token as string | null) ?? null,
        etag: (row.etag as string | null) ?? null,
        crawlInterval: (row.crawl_interval as string) ?? '6 hours',
        lastCrawledAt: (row.last_crawled_at as string | null) ?? null,
        consecutiveFailures: (row.consecutive_failures as number) ?? 0,
        companyId: company?.id ?? null,
        companyName: company?.name ?? null,
        companyDomain: company?.domain ?? null,
        // Carried only so --source can match on it.
        ...(company ? { companySlug: company.slug } : {}),
      } as SourceRow & { companySlug?: string };
    })
    .filter((source) => {
      if (options.slug) {
        const slug = (source as SourceRow & { companySlug?: string }).companySlug;
        return slug === options.slug || source.boardToken === options.slug;
      }
      if (options.force) return true;
      if (source.lastCrawledAt === null) return true;
      return Date.parse(source.lastCrawledAt) + intervalMs(source.crawlInterval) <= now;
    });
}

/**
 * Every source that has landed raw data, regardless of `enabled`.
 *
 * Deliberately not `dueSources` with a flag bolted on: that function always filters to
 * `enabled = true`, which is correct for crawling (an auto-disabled board should not be
 * fetched again) and wrong for replay. A source disabled after five failures can still
 * have thousands of stored `raw_postings` and open `jobs` from before it broke, and a
 * normalizer bugfix needs to reach those rows too — disabling a source stops crawling it,
 * it does not retroactively make its data not worth fixing.
 */
export async function sourcesWithRawData(
  client: SupabaseClient,
  options: { slug?: string } = {},
): Promise<SourceRow[]> {
  const { data, error } = await client
    .from('job_sources')
    .select('id, kind, board_url, board_token, etag, crawl_interval, last_crawled_at, consecutive_failures, companies(id, name, domain, slug)')
    .order('id', { ascending: true });
  if (error) throw error;

  return (data ?? [])
    .map((row): SourceRow => {
      const company = (Array.isArray(row.companies) ? row.companies[0] : row.companies) as
        | { id: string; name: string; domain: string | null; slug: string }
        | null
        | undefined;

      return {
        id: row.id as string,
        kind: row.kind as AtsKind,
        boardUrl: row.board_url as string,
        boardToken: (row.board_token as string | null) ?? null,
        etag: (row.etag as string | null) ?? null,
        crawlInterval: (row.crawl_interval as string) ?? '6 hours',
        lastCrawledAt: (row.last_crawled_at as string | null) ?? null,
        consecutiveFailures: (row.consecutive_failures as number) ?? 0,
        companyId: company?.id ?? null,
        companyName: company?.name ?? null,
        companyDomain: company?.domain ?? null,
        ...(company ? { companySlug: company.slug } : {}),
      } as SourceRow & { companySlug?: string };
    })
    .filter((source) => {
      if (!options.slug) return true;
      const slug = (source as SourceRow & { companySlug?: string }).companySlug;
      return slug === options.slug || source.boardToken === options.slug;
    });
}

/**
 * Postgres prints an interval as `06:00:00` or `1 day 06:00:00`. Only the shapes our own
 * `crawl_interval` values produce are handled; anything unrecognised is treated as due,
 * because a source that never gets crawled is a worse failure than one crawled early.
 */
function intervalMs(interval: string): number {
  const days = /(\d+)\s*days?/.exec(interval);
  const clock = /(\d+):(\d\d):(\d\d)/.exec(interval);
  const hours = /(\d+)\s*hours?/.exec(interval);

  let ms = 0;
  if (days?.[1]) ms += Number(days[1]) * 86_400_000;
  if (clock?.[1] && clock[2] && clock[3]) {
    ms += Number(clock[1]) * 3_600_000 + Number(clock[2]) * 60_000 + Number(clock[3]) * 1000;
  } else if (hours?.[1]) {
    ms += Number(hours[1]) * 3_600_000;
  }

  return ms > 0 ? ms : 0;
}

export async function loadSkillDictionary(client: SupabaseClient): Promise<SkillEntry[]> {
  const { data, error } = await client.from('skills').select('slug, label, aliases');
  if (error) throw error;

  return (data ?? []).map((row) => ({
    slug: row.slug as string,
    label: row.label as string,
    aliases: (row.aliases as string[] | null) ?? [],
  }));
}

export async function startRun(client: SupabaseClient, sourceId: string): Promise<string> {
  const { data, error } = await client
    .from('crawl_runs')
    .insert({ source_id: sourceId })
    .select('id')
    .single();
  if (error) throw error;
  return data.id as string;
}

export interface RunTotals {
  postingsSeen: number;
  rawInserted: number;
  jobsCreated: number;
  jobsUpdated: number;
  /** One employer, one role, several requisition ids. Their behaviour, not our defect. */
  collapsed: number;
  /** The same job reached by two different sources. The number §3.4 is about. */
  duplicates: number;
}

export async function finishRun(
  client: SupabaseClient,
  runId: string,
  status: 'success' | 'failed' | 'skipped' | 'not_modified',
  totals: Partial<RunTotals> & { httpStatus?: number; error?: string },
): Promise<void> {
  const { error } = await client
    .from('crawl_runs')
    .update({
      finished_at: new Date().toISOString(),
      status,
      http_status: totals.httpStatus ?? null,
      postings_seen: totals.postingsSeen ?? 0,
      raw_inserted: totals.rawInserted ?? 0,
      jobs_created: totals.jobsCreated ?? 0,
      jobs_updated: totals.jobsUpdated ?? 0,
      collapsed: totals.collapsed ?? 0,
      duplicates: totals.duplicates ?? 0,
      // Truncated: a stack trace from a 40MB JSON parse failure can be enormous, and the
      // useful part is always at the front.
      error: totals.error ? totals.error.slice(0, 2000) : null,
    })
    .eq('id', runId);
  if (error) throw error;
}

/**
 * §4.3: "disable a source after N consecutive failures and alert."
 *
 * Five, because a board that 500s twice is having a bad morning and a board that 500s
 * five times in a row has changed. Re-enabling is deliberate and manual — a source that
 * silently re-enables itself is one nobody ever looks at.
 */
export const MAX_CONSECUTIVE_FAILURES = 5;

export async function recordSourceOutcome(
  client: SupabaseClient,
  source: SourceRow,
  outcome: { ok: boolean; etag?: string | null },
): Promise<{ disabled: boolean }> {
  const failures = outcome.ok ? 0 : source.consecutiveFailures + 1;
  const disabled = failures >= MAX_CONSECUTIVE_FAILURES;

  const patch: Record<string, unknown> = {
    last_crawled_at: new Date().toISOString(),
    consecutive_failures: failures,
  };

  if (outcome.ok) {
    patch.last_success_at = new Date().toISOString();
    // Only overwrite a stored ETag with a real one — a null would make the next crawl
    // unconditional and cost the other side a full board render for nothing.
    if (outcome.etag) patch.etag = outcome.etag;
  }

  if (disabled) {
    patch.enabled = false;
    patch.notes = `Auto-disabled after ${failures} consecutive failures on ${new Date().toISOString().slice(0, 10)}.`;
  }

  const { error } = await client.from('job_sources').update(patch).eq('id', source.id);
  if (error) throw error;

  return { disabled };
}

/**
 * Chunk size for `in` filters.
 *
 * PostgREST puts these in the URL and the gateway caps its length. 300 was too many:
 * Ashby's external ids are 36-character uuids, so a batch became a ~12 KB URL and both
 * Ashby boards failed the first full crawl with "URI too long". Eighty uuids is ~3 KB,
 * comfortably inside every proxy default.
 */
const IN_CHUNK = 80;

export function chunk<T>(items: T[], size = IN_CHUNK): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

/**
 * Marks every posting this crawl saw as still alive, changed or not.
 *
 * This is the single most important write in the pipeline and the easiest one to forget.
 * The content hash means an unchanged posting does no downstream work — but "no work"
 * must not include "no `last_seen_at`", or the staleness sweep closes every posting that
 * has not been edited in 48 hours, which is most of them.
 */
export async function touchSeen(
  client: SupabaseClient,
  sourceId: string,
  externalIds: string[],
): Promise<void> {
  for (const batch of chunk(externalIds)) {
    const { error } = await client
      .from('jobs')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('source_id', sourceId)
      .eq('status', 'open')
      .in('external_id', batch);
    if (error) throw error;
  }
}

export async function refreshOpenJobCounts(client: SupabaseClient): Promise<number> {
  const { data, error } = await client.rpc('refresh_open_job_counts');
  if (error) throw error;
  return (data as number) ?? 0;
}

export async function closeStaleJobs(client: SupabaseClient, unseenHours = 48): Promise<number> {
  const { data, error } = await client.rpc('close_stale_jobs', { p_unseen_hours: unseenHours });
  if (error) throw error;
  return (data as number) ?? 0;
}

// ── aggregator support ───────────────────────────────────────────────────────────

/**
 * The one `job_sources` row a multi-company feed source needs, created on first use
 * rather than through the seed script.
 *
 * `board-list.ts` is deliberately per-company — one row is one employer's own board —
 * because that is what §3.4's model assumes. A feed like Simplify's covers over a
 * thousand employers in a single fetch and has no single company to seed it under, so
 * `company_id` is left null (the column already allows this) and the source
 * self-registers the first time it runs, the same way a new board would be a one-line
 * seed insert if it fit that model.
 */
export async function getOrCreateFeedSource(
  client: SupabaseClient,
  params: {
    kind: AtsKind;
    boardUrl: string;
    crawlInterval?: string;
    notes?: string;
    /**
     * False for a dry run. Every other write in this pipeline is already conditioned on
     * `!dryRun` — the CLI's own help text promises `--dry-run` writes "nothing, not even
     * a run row" — and this function silently violated that the first time it was used,
     * creating a real `job_sources` row before the caller had decided whether to write
     * anything at all. Defaults to true so a genuine first-run bootstrap still works.
     */
    createIfMissing?: boolean;
  },
): Promise<SourceRow | null> {
  const { data: existing, error: selectError } = await client
    .from('job_sources')
    .select('id, kind, board_url, board_token, etag, crawl_interval, last_crawled_at, consecutive_failures')
    .eq('kind', params.kind)
    .eq('board_url', params.boardUrl)
    .maybeSingle();
  if (selectError) throw selectError;

  if (!existing && params.createIfMissing === false) return null;

  const row = existing ??
    (
      await (async () => {
        const { data, error } = await client
          .from('job_sources')
          .insert({
            kind: params.kind,
            board_url: params.boardUrl,
            crawl_interval: params.crawlInterval ?? '24 hours',
            notes: params.notes ?? null,
          })
          .select('id, kind, board_url, board_token, etag, crawl_interval, last_crawled_at, consecutive_failures')
          .single();
        if (error) throw error;
        return data;
      })()
    );

  return {
    id: row.id as string,
    kind: row.kind as AtsKind,
    boardUrl: row.board_url as string,
    boardToken: (row.board_token as string | null) ?? null,
    etag: (row.etag as string | null) ?? null,
    crawlInterval: (row.crawl_interval as string) ?? params.crawlInterval ?? '24 hours',
    lastCrawledAt: (row.last_crawled_at as string | null) ?? null,
    consecutiveFailures: (row.consecutive_failures as number) ?? 0,
    companyId: null,
    companyName: null,
    companyDomain: null,
  };
}

/**
 * "NVIDIA" -> "nvidia", "Two Sigma" -> "two-sigma". Not the curated identifiers
 * board-list.ts hand-picks — those are worth naming deliberately — but good enough for
 * companies an aggregator discovers automatically, where deliberateness is not on offer.
 */
function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base === '' ? 'company' : base;
}

/**
 * Resolves a batch of free-text company names to `companies.id`, creating rows for any
 * name that doesn't already exist.
 *
 * Matching is exact, case-insensitive, on `companies.name`. That is a real limitation —
 * "Coinbase" and "Coinbase Global, Inc." would create two rows rather than merge — and it
 * is the honest trade for this being automatic. §3.3's domain-based dedup does not apply
 * here: an aggregator's own record of a company rarely carries the company's real domain,
 * only the ATS or aggregator's own landing-page URL, which is not the same thing and
 * would be actively wrong to store as `companies.domain`. A created row's `domain` is
 * left null, same as a company with no crawl source at all.
 *
 * Fetches every existing company once rather than querying per name: even after this
 * aggregator runs, the table is a few thousand rows at most, and one query beats however
 * many hundreds of distinct names a feed contains.
 */
export async function resolveCompaniesByName(
  client: SupabaseClient,
  names: string[],
  /**
   * False for a dry run: matches names against companies that already exist so a
   * preview can show real resolutions, but never inserts. A name with no existing match
   * simply comes back unresolved rather than being created — the same shape a genuinely
   * new, not-yet-seen company has, which is an honest thing for a dry run to show.
   */
  options: { createMissing?: boolean } = {},
): Promise<Map<string, string>> {
  const createMissing = options.createMissing ?? true;
  const distinct = [...new Set(names.map((name) => name.trim()).filter((name) => name !== ''))];
  const byLower = new Map<string, string>(); // lowercased name -> id

  const { data: existing, error: fetchError } = await client.from('companies').select('id, name');
  if (fetchError) throw fetchError;
  for (const row of existing ?? []) {
    byLower.set((row.name as string).toLowerCase(), row.id as string);
  }

  const missing = distinct.filter((name) => !byLower.has(name.toLowerCase()));
  if (missing.length > 0 && createMissing) {
    const usedSlugs = new Set<string>();
    const rows = missing.map((name) => {
      let slug = slugify(name);
      // A collision here means two different company names slugify identically (rare —
      // punctuation-only differences). Suffixing keeps both rows distinct rather than
      // silently dropping one of them.
      let suffix = 2;
      while (usedSlugs.has(slug)) {
        slug = `${slugify(name)}-${suffix}`;
        suffix += 1;
      }
      usedSlugs.add(slug);
      return { slug, name, logo_monogram: monogramOf(name) };
    });

    for (const batch of chunk(rows, 200)) {
      // ignoreDuplicates rather than a plain insert: a slug or domain collision against a
      // row created by a concurrent process (there is only one right now, but the next
      // aggregator to run this same batch resolver should not crash on one) is skipped,
      // not fatal — the row already exists under that identity, which is what we wanted.
      const { error } = await client.from('companies').upsert(batch, { onConflict: 'slug', ignoreDuplicates: true });
      if (error) throw error;
    }

    // A second unfiltered fetch rather than `.in('name', missing)`: an aggregator can
    // easily produce over a thousand distinct new names in one run, and PostgREST puts an
    // `in` filter's values in the URL — a batch that size is exactly what made two Ashby
    // boards fail with "URI too long" earlier in this project. The companies table is a
    // few thousand rows at most, so one more full select is cheap and has no length limit
    // to hit.
    const { data: refreshed, error: refetchError } = await client.from('companies').select('id, name');
    if (refetchError) throw refetchError;
    for (const row of refreshed ?? []) {
      byLower.set((row.name as string).toLowerCase(), row.id as string);
    }
  }

  const resolved = new Map<string, string>();
  for (const name of distinct) {
    const id = byLower.get(name.toLowerCase());
    if (id) resolved.set(name, id);
  }
  return resolved;
}

/** "NVIDIA" -> "NV" — mirrors board-list.ts's own helper for the same fallback. */
function monogramOf(name: string): string {
  const words = name
    .replace(/[^A-Za-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return (words[0] ?? '').slice(0, 2).toUpperCase();
  return `${words[0]?.charAt(0) ?? ''}${words[1]?.charAt(0) ?? ''}`.toUpperCase();
}
