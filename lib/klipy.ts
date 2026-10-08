import * as Crypto from 'expo-crypto';

import { KLIPY_APP_KEY } from '@/lib/env';

/**
 * KLIPY — the GIF library behind the comment picker. Free, and built by the people who ran
 * Tenor, whose public API Google shut down on 2026-06-30. GIPHY charges for production keys.
 *
 * Three of KLIPY's integration rules decide how this file looks (docs.klipy.com/integration-
 * requirements), and none of them is negotiable without their written approval:
 *
 *  - **Requests go from the phone, not through our API service.** So the app key ships in the
 *    bundle, like the Supabase anon key and the RevenueCat key. It can only search GIFs.
 *  - **Media loads straight from the URLs they return, and is never stored.** A comment keeps
 *    only `klipy:<slug>`, and rows resolve slugs to URLs through the Items API when they render.
 *    That also means a GIF KLIPY takes down disappears from our threads too.
 *  - **Results are shown in the order and composition KLIPY returns.** No reordering, no mixing
 *    with the bundled reactions in one grid, and filtering is configured in KLIPY's Partner Panel.
 *    The `content_filter` below is their own safety level, which is allowed.
 *
 * The picker also has to show KLIPY branding — `GifPicker` does.
 */

const BASE = 'https://api.klipy.com/api/v1';

/**
 * `high` is KLIPY's strictest level. These comments sit under job postings that students read
 * between classes and in front of recruiters. A funny reaction is the point; anything that
 * would be awkward on a work laptop is not.
 */
const CONTENT_FILTER = 'high';

/** The prefix a comment's `gif_id` carries for a KLIPY GIF. Bare ids are the bundled set. */
export const KLIPY_PREFIX = 'klipy:';

/** Slugs are URL path segments. The server and the database check the same shape. */
const SLUG = /^[A-Za-z0-9_-]{1,120}$/;

export const isKlipyConfigured = KLIPY_APP_KEY !== undefined;

export interface KlipyGif {
  slug: string;
  title: string;
  /** Picker tile: `xs`, about 100 KB as a GIF. */
  preview: { url: string; width: number; height: number };
  /** In a comment: `sm`, about 330 KB. */
  full: { url: string; width: number; height: number };
}

export interface KlipyPage {
  gifs: KlipyGif[];
  page: number;
  hasNext: boolean;
}

export function klipyGifId(slug: string): string {
  return KLIPY_PREFIX + slug;
}

/** The slug in a comment's `gif_id`, or null when it is a bundled reaction (or garbage). */
export function klipySlugOf(gifId: string | undefined | null): string | null {
  if (!gifId?.startsWith(KLIPY_PREFIX)) return null;
  const slug = gifId.slice(KLIPY_PREFIX.length);
  return SLUG.test(slug) ? slug : null;
}

/*
 * KLIPY asks for a stable per-user id to personalise trending and "recent". It never needs
 * to be our user id, so it is a hash of it: the same person every time, and nobody at KLIPY
 * can join it back to an account.
 */
let customer: { userId: string; id: Promise<string> } | null = null;

function customerId(userId: string | null): Promise<string> | null {
  if (userId === null) return null;
  if (customer?.userId !== userId) {
    customer = {
      userId,
      id: Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `careerdeck:${userId}`),
    };
  }
  return customer.id;
}

interface Rendition {
  url?: unknown;
  width?: unknown;
  height?: unknown;
}

function rendition(file: unknown, size: string): KlipyGif['full'] | null {
  const gif = (file as Record<string, Record<string, Rendition> | undefined> | undefined)?.[size]?.gif;
  if (!gif || typeof gif.url !== 'string' || !gif.url.startsWith('https://')) return null;
  const width = typeof gif.width === 'number' && gif.width > 0 ? gif.width : 1;
  const height = typeof gif.height === 'number' && gif.height > 0 ? gif.height : 1;
  return { url: gif.url, width, height };
}

function toGif(item: unknown): KlipyGif | null {
  const row = item as { slug?: unknown; title?: unknown; type?: unknown; file?: unknown } | null;
  // Anything that is not a GIF (an ad slot, if the account ever turns them on) is skipped.
  if (!row || typeof row.slug !== 'string' || !SLUG.test(row.slug)) return null;
  if (row.type !== undefined && row.type !== 'gif') return null;
  const preview = rendition(row.file, 'xs') ?? rendition(row.file, 'sm');
  const full = rendition(row.file, 'sm') ?? preview;
  if (!preview || !full) return null;
  return {
    slug: row.slug,
    title: typeof row.title === 'string' && row.title.trim().length > 0 ? row.title.trim() : 'GIF',
    preview,
    full,
  };
}

async function get(path: string, params: Record<string, string | undefined>, signal?: AbortSignal) {
  if (!KLIPY_APP_KEY) throw new Error('KLIPY is not configured on this build.');
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined) query.set(key, value);
  const response = await fetch(`${BASE}/${encodeURIComponent(KLIPY_APP_KEY)}${path}?${query}`, { signal });
  if (!response.ok) throw new Error(`KLIPY answered ${response.status}.`);
  return (await response.json()) as {
    result?: boolean;
    data?: { data?: unknown[]; current_page?: unknown; has_next?: unknown };
  };
}

const PER_PAGE = 24;

/** Trending when `query` is blank, search otherwise. One page. */
export async function fetchGifPage(input: {
  query: string;
  page: number;
  userId: string | null;
  signal?: AbortSignal;
}): Promise<KlipyPage> {
  const q = input.query.trim();
  const json = await get(
    q.length > 0 ? '/gifs/search' : '/gifs/trending',
    {
      q: q.length > 0 ? q : undefined,
      page: String(input.page),
      per_page: String(PER_PAGE),
      customer_id: (await customerId(input.userId)) ?? undefined,
      locale: 'us',
      content_filter: CONTENT_FILTER,
      format_filter: 'gif',
    },
    input.signal,
  );
  const items = Array.isArray(json.data?.data) ? json.data.data : [];
  return {
    gifs: items.map(toGif).filter((gif): gif is KlipyGif => gif !== null),
    page: typeof json.data?.current_page === 'number' ? json.data.current_page : input.page,
    hasNext: json.data?.has_next === true,
  };
}

/** The GIFs behind a set of slugs, keyed by slug. A slug KLIPY no longer serves is absent. */
export async function fetchGifsBySlug(slugs: string[]): Promise<Map<string, KlipyGif>> {
  const valid = [...new Set(slugs.filter((slug) => SLUG.test(slug)))];
  const found = new Map<string, KlipyGif>();
  // The Items API takes a comma-separated list; 50 matches the search endpoint's page cap.
  for (let i = 0; i < valid.length; i += 50) {
    const batch = valid.slice(i, i + 50);
    /*
     * Search and trending hand out slugs with a tracking suffix (`deer-interview-1--kqTOiJzPP`),
     * which is what a comment stores, and the Items API answers with the bare slug
     * (`deer-interview-1`). So answers are matched to requests on the bare form.
     */
    const asked = new Map<string, string[]>();
    for (const slug of batch) asked.set(bareSlug(slug), [...(asked.get(bareSlug(slug)) ?? []), slug]);

    const json = await get('/gifs/items', { slugs: batch.join(','), format_filter: 'gif' });
    const items = Array.isArray(json.data?.data) ? json.data.data : [];
    for (const gif of items.map(toGif)) {
      if (!gif) continue;
      for (const slug of asked.get(bareSlug(gif.slug)) ?? []) found.set(slug, gif);
    }
  }
  return found;
}

/** `deer-interview-1--kqTOiJzPP` → `deer-interview-1`. A slug without the suffix is unchanged. */
function bareSlug(slug: string): string {
  const cut = slug.lastIndexOf('--');
  return cut > 0 ? slug.slice(0, cut) : slug;
}

/**
 * Tells KLIPY a GIF was posted — their share trigger, which tunes trending and the reader's
 * recents. Fire and forget: a lost ping costs nothing, and a comment must never wait on it.
 */
export function reportGifShared(slug: string, userId: string | null): void {
  if (!KLIPY_APP_KEY || !SLUG.test(slug)) return;
  void (async () => {
    try {
      const id = await customerId(userId);
      await fetch(`${BASE}/${encodeURIComponent(KLIPY_APP_KEY)}/gifs/share/${encodeURIComponent(slug)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(id ? { customer_id: id } : {}),
      });
    } catch {
      // Analytics for somebody else. Nothing to do.
    }
  })();
}
