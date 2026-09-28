/**
 * §9's pipeline, end to end:
 *
 *   fetch feed (ETag) → dedup by url_hash → match to company → summary → relevance → publish
 *
 * Bounded on purpose, because every new story is a model call. Per source per run: only stories
 * from the last `maxAgeDays`, at most `perSource` of them, newest first. A first fetch of OpenAI's
 * feed — 1,233 items — therefore costs ten summaries, not twelve hundred. Everything summarized is
 * kept, published or suppressed, so no story is ever paid for twice.
 */

import { adminClient } from '../auth.ts';
import { politeFetch } from '../ingest/http.ts';
import { canonicalUrl, parseFeed, urlHash, type FeedEntry } from './feed.ts';
import { NEWS_PROMPT_VERSION, summarizeStory } from './summarize.ts';

interface SourceRow {
  id: string;
  url: string;
  name: string;
  publisher: string;
  category: 'company' | 'industry';
  company_slug: string | null;
  company_id: string | null;
  etag: string | null;
  consecutive_failures: number;
}

export interface NewsRunOptions {
  /** Sources fetched within this many hours are skipped. */
  minIntervalHours?: number;
  maxAgeDays?: number;
  perSource?: number;
  /** Only this source id (verification and manual reruns). */
  sourceId?: string;
  /** Ignore the source's ETag, so an unchanged feed is re-read. */
  ignoreEtag?: boolean;
}

export interface NewsRunResult {
  sources: number;
  notModified: number;
  failed: number;
  published: number;
  suppressed: number;
  costUsd: number;
}

/**
 * The published bar, by kind of source. A company's own newsroom is lower: someone following
 * Stripe wants Stripe's news even when it is not about hiring. An industry feed has to earn it.
 */
const THRESHOLD = { company: 0.3, industry: 0.6 } as const;

/** Soft story backgrounds — `StoryPage` sets fixed dark ink on them, so they stay pastel. */
const PASTELS = ['#EAF6DD', '#E4EEFB', '#F7E8F3', '#FFF1DB', '#E6F4F1', '#EFE9FB', '#FBE9E4', '#EAF1F6'];

function pastelFor(key: string): string {
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return PASTELS[Math.abs(hash) % PASTELS.length] ?? PASTELS[0]!;
}

const TOPIC_LABEL: Record<string, string> = {
  hiring: 'Hiring', layoffs: 'Layoffs', funding: 'Funding', product: 'Product', engineering: 'Engineering', other: 'News',
};

async function resolveCompany(source: SourceRow): Promise<{ id: string | null; name: string | null }> {
  if (source.category !== 'company' || !source.company_slug) return { id: null, name: null };

  const { data } = await adminClient
    .from('companies')
    .select('id, name')
    .eq('slug', source.company_slug)
    .maybeSingle<{ id: string; name: string }>();

  if (data && data.id !== source.company_id) {
    await adminClient.from('news_sources').update({ company_id: data.id }).eq('id', source.id);
  }
  return { id: data?.id ?? null, name: data?.name ?? null };
}

async function ingestSource(source: SourceRow, options: Required<Omit<NewsRunOptions, 'sourceId'>>, result: NewsRunResult) {
  const company = await resolveCompany(source);
  if (source.category === 'company' && !company.id) {
    // The board list has not brought this company in yet. Not a failure of the feed.
    return;
  }

  const fetched = await politeFetch({
    url: source.url,
    etag: options.ignoreEtag ? null : source.etag,
    headers: { accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8' },
  });

  const now = new Date().toISOString();
  if (fetched.status === 304 || fetched.body === null) {
    result.notModified += 1;
    await adminClient.from('news_sources')
      .update({ last_fetched_at: now, last_success_at: now, consecutive_failures: 0 })
      .eq('id', source.id);
    return;
  }

  const cutoff = Date.now() - options.maxAgeDays * 86_400_000;
  const fresh = parseFeed(fetched.body)
    .filter((e): e is FeedEntry & { publishedAt: Date } => e.publishedAt !== null && e.publishedAt.getTime() > cutoff
      && e.publishedAt.getTime() < Date.now() + 86_400_000)
    .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());

  // Dedup before paying for anything: the hashes already in the table, whatever their status.
  const hashes = fresh.map((e) => urlHash(e.url));
  const known = new Set<string>();
  if (hashes.length > 0) {
    const { data } = await adminClient.from('news_items').select('url_hash').in('url_hash', hashes);
    for (const row of data ?? []) known.add(row.url_hash as string);
  }

  const todo = fresh.filter((e, i) => !known.has(hashes[i]!)).slice(0, options.perSource);

  for (const entry of todo) {
    const card = await summarizeStory({
      headline: entry.title,
      publisher: source.publisher,
      blurb: entry.blurb,
      company: company.name,
    });
    result.costUsd += card.costUsd ?? 0;

    const published = card.summary.length > 0 && card.relevance >= THRESHOLD[source.category];
    const label = TOPIC_LABEL[card.topic] ?? 'News';

    const { error } = await adminClient.from('news_items').insert({
      source_id: source.id,
      company_id: company.id,
      category: source.category,
      url: canonicalUrl(entry.url),
      url_hash: urlHash(entry.url),
      publisher: source.publisher,
      tag: company.name ? `${company.name} · ${label}` : `Industry Pulse · ${label}`,
      headline: entry.title,
      subtext: card.subtext || null,
      summary: card.summary,
      topic: card.topic,
      image_url: entry.imageUrl,
      accent_color: pastelFor(source.company_slug ?? source.url),
      published_at: entry.publishedAt.toISOString(),
      relevance_score: card.relevance,
      status: published ? 'published' : 'suppressed',
      model: card.model,
      prompt_version: NEWS_PROMPT_VERSION,
      tokens_in: card.tokensIn,
      tokens_out: card.tokensOut,
      cost_usd: card.costUsd,
    });

    // 23505: a syndicated copy of this story landed from another source a moment ago. Fine.
    if (error && error.code !== '23505') throw error;
    if (!error) {
      if (published) result.published += 1;
      else result.suppressed += 1;
    }
  }

  await adminClient.from('news_sources')
    .update({ etag: fetched.etag, last_fetched_at: now, last_success_at: now, consecutive_failures: 0 })
    .eq('id', source.id);
}

export async function ingestNews(options: NewsRunOptions = {}): Promise<NewsRunResult> {
  const settings = {
    minIntervalHours: options.minIntervalHours ?? 3,
    maxAgeDays: options.maxAgeDays ?? 14,
    perSource: options.perSource ?? 10,
    ignoreEtag: options.ignoreEtag ?? false,
  };

  let query = adminClient
    .from('news_sources')
    .select('id, url, name, publisher, category, company_slug, company_id, etag, consecutive_failures')
    .eq('enabled', true);

  if (options.sourceId) {
    query = query.eq('id', options.sourceId);
  } else {
    const due = new Date(Date.now() - settings.minIntervalHours * 3_600_000).toISOString();
    query = query.or(`last_fetched_at.is.null,last_fetched_at.lt.${due}`);
  }

  const { data: sources, error } = await query.returns<SourceRow[]>();
  if (error) throw error;

  const result: NewsRunResult = { sources: sources.length, notModified: 0, failed: 0, published: 0, suppressed: 0, costUsd: 0 };

  for (const source of sources) {
    try {
      await ingestSource(source, settings, result);
    } catch (failure) {
      result.failed += 1;
      console.error(`[news] ${source.name} failed`, failure instanceof Error ? failure.message : failure);
      await adminClient.from('news_sources')
        .update({ last_fetched_at: new Date().toISOString(), consecutive_failures: source.consecutive_failures + 1 })
        .eq('id', source.id);
    }
  }

  result.costUsd = Math.round(result.costUsd * 100_000) / 100_000;
  return result;
}
