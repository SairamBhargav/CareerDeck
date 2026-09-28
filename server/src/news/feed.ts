/**
 * Reading an RSS or Atom feed — the first step of §9's news pipeline.
 *
 * No XML library, for the reason the ingest crawlers are hand-written HTTP: a parser for a
 * hostile, attacker-supplied format running in the process that holds the service-role key is
 * attack surface, and what is needed here is five fields out of well-trodden markup. The parser
 * is deliberately tolerant — feeds are malformed constantly — and deliberately narrow: it reads
 * title, link, date, a text blurb and an optional image, and nothing it reads is stored except
 * the title and the link. The blurb goes to the summarizer and is dropped. §9.
 */

import { createHash } from 'node:crypto';

export interface FeedEntry {
  title: string;
  url: string;
  publishedAt: Date | null;
  /** Plain text, for the summarizer only. Never stored — §9. */
  blurb: string;
  imageUrl: string | null;
}

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', mdash: '—', ndash: '–', hellip: '…',
};

export function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const n = code[1]?.toLowerCase() === 'x' ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

/** CDATA unwrapped, tags stripped, entities decoded, whitespace collapsed. */
export function plainText(raw: string): string {
  const unwrapped = raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  // Entities first, then tags: an escaped-HTML description (`&lt;p&gt;`) is common in RSS.
  return decodeEntities(decodeEntities(unwrapped).replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function tag(block: string, name: string): string | null {
  const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(block);
  return match?.[1] ?? null;
}

function attr(block: string, element: string, attribute: string, where?: RegExp): string | null {
  const pattern = new RegExp(`<${element}\\b[^>]*>`, 'gi');
  for (const match of block.matchAll(pattern)) {
    if (where && !where.test(match[0])) continue;
    const value = new RegExp(`\\s${attribute}\\s*=\\s*["']([^"']+)["']`, 'i').exec(match[0]);
    if (value?.[1]) return decodeEntities(value[1]);
  }
  return null;
}

function date(raw: string | null): Date | null {
  if (!raw) return null;
  const parsed = new Date(plainText(raw));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function httpUrl(raw: string | null): string | null {
  if (!raw) return null;
  const candidate = plainText(raw);
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Parses RSS 2.0 `<item>`s or Atom `<entry>`s, whichever the document has. */
export function parseFeed(xml: string): FeedEntry[] {
  const isAtom = /<feed[\s>]/i.test(xml) && !/<rss[\s>]/i.test(xml);
  const blocks = [...xml.matchAll(isAtom ? /<entry[\s>][\s\S]*?<\/entry>/gi : /<item[\s>][\s\S]*?<\/item>/gi)]
    .map((m) => m[0]);

  const entries: FeedEntry[] = [];
  for (const block of blocks) {
    const title = plainText(tag(block, 'title') ?? '');
    const url = isAtom
      ? httpUrl(attr(block, 'link', 'href', /rel\s*=\s*["']alternate["']/i) ?? attr(block, 'link', 'href'))
      : httpUrl(tag(block, 'link')) ?? httpUrl(tag(block, 'guid'));
    if (!title || !url) continue;

    const blurbSource =
      tag(block, 'description') ?? tag(block, 'summary') ?? tag(block, 'content:encoded') ?? tag(block, 'content') ?? '';

    entries.push({
      title: title.slice(0, 300),
      url,
      publishedAt: date(tag(block, 'pubDate') ?? tag(block, 'published') ?? tag(block, 'updated') ?? tag(block, 'dc:date')),
      // Enough for a summary, far short of an article. The blurb is transient either way.
      blurb: plainText(blurbSource).slice(0, 1_500),
      imageUrl: httpUrl(attr(block, 'media:content', 'url') ?? attr(block, 'media:thumbnail', 'url') ??
        attr(block, 'enclosure', 'url', /type\s*=\s*["']image\//i)),
    });
  }
  return entries;
}

const TRACKING = /^(utm_|mc_|mkt_|fbclid$|gclid$|ref$|ref_src$|source$|_hs)/i;

/**
 * The URL a story is deduplicated on. Syndicated copies of one story differ in tracking
 * parameters, fragments, `www.` and trailing slashes far more often than in anything real.
 */
export function canonicalUrl(raw: string): string {
  const url = new URL(raw);
  url.hash = '';
  url.protocol = 'https:';
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) url.pathname = url.pathname.slice(0, -1);
  return url.toString();
}

export function urlHash(raw: string): string {
  return createHash('sha256').update(canonicalUrl(raw)).digest('hex');
}
