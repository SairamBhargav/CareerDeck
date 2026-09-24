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
