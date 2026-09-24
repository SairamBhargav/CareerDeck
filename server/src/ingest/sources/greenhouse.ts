/**
 * Greenhouse — docs/README.md §4.2: "Public JSON board API. Clean, stable, generous.
 * Start here."
 *
 *   GET https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true
 *
 * One request returns the whole board including every description, which is why a
 * 120-board crawl is ~150 requests rather than tens of thousands.
 *
 * Two quirks worth knowing:
 *  - `content` is HTML that has been HTML-escaped *again*, so it arrives as
 *    `&lt;p&gt;…`. It has to be unescaped before it can be treated as markup.
 *  - `updated_at` moves on every board rebuild whether or not the posting changed, which
 *    is exactly the volatile field canonicalPayload() in ../pipeline.ts strips before
 *    hashing. Without that, every crawl would look like a change.
 */

import {
  asRecord,
  isoDate,
  num,
  str,
  type ParsedPosting,
  type RawPosting,
  type SourceAdapter,
  type SourceRef,
  type SourceRequest,
  type StructuredSalary,
} from './types.ts';

function boardToken(source: SourceRef): string {
  if (source.boardToken) return source.boardToken;
  // Tolerate a source row that only carries the board URL: the token is its last segment.
  const segments = new URL(source.boardUrl).pathname.split('/').filter(Boolean);
  const token = segments.at(-1);
  if (!token) throw new Error(`Cannot derive a Greenhouse board token from ${source.boardUrl}`);
  return token;
}

/**
 * Greenhouse states pay in `pay_input_ranges` on boards that use the feature. The values
 * are cents, and the array can hold several ranges (per-location, or base vs total).
 * Taking the widest is the honest reading: it is the range the employer published.
 */
function parseSalary(payload: Record<string, unknown>): StructuredSalary | null {
  const ranges = payload.pay_input_ranges;
  if (!Array.isArray(ranges) || ranges.length === 0) return null;

  let min: number | null = null;
  let max: number | null = null;
  let currency = 'USD';

  for (const entry of ranges) {
    const range = asRecord(entry);
    const low = num(range.min_cents);
    const high = num(range.max_cents);
    const code = str(range.currency_type);
    if (code && code.length === 3) currency = code.toUpperCase();
    if (low !== null) min = min === null ? low / 100 : Math.min(min, low / 100);
    if (high !== null) max = max === null ? high / 100 : Math.max(max, high / 100);
  }

  if (min === null && max === null) return null;

  // Greenhouse does not say whether a range is hourly or annual. The magnitude does:
  // nobody is paid $95,000 an hour and nobody is paid $60 a year.
  const scale = max ?? min ?? 0;
  return { min, max, period: scale < 2000 ? 'hour' : 'year', currency };
}

/** `&lt;p&gt;` → `<p>`. Only the five entities Greenhouse actually emits. */
function unescapeHtml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

export const greenhouse: SourceAdapter = {
  kind: 'greenhouse',
  applyHost: 'greenhouse',

  request(source: SourceRef): SourceRequest {
    return {
      url: `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(boardToken(source))}/jobs?content=true`,
    };
  },

  extract(body: string): RawPosting[] {
    const parsed = asRecord(JSON.parse(body));
    const jobs = parsed.jobs;
    if (!Array.isArray(jobs)) {
      throw new Error('Greenhouse response has no `jobs` array');
    }

    return jobs.flatMap((entry) => {
      const payload = asRecord(entry);
      const externalId = str(payload.id);
      // A posting with no id cannot be deduped against its own future self, which is the
      // one thing raw_postings exists to do. Dropping it is better than landing it.
      return externalId ? [{ externalId, payload }] : [];
    });
  },

  parse({ externalId, payload }: RawPosting): ParsedPosting {
    const location = str(asRecord(payload.location).name);

    // Greenhouse boards list offices separately from the free-text location, and the two
    // disagree often enough to be worth merging rather than picking one.
    const offices = Array.isArray(payload.offices)
      ? payload.offices.flatMap((office) => {
          const name = str(asRecord(office).name);
          return name && name !== location ? [name] : [];
        })
      : [];

    const html = str(payload.content);
    const department = Array.isArray(payload.departments)
      ? str(asRecord(payload.departments[0]).name)
      : null;

    return {
      externalId,
      title: str(payload.title) ?? 'Untitled role',
      locationRaw: location,
      extraLocations: offices,
      descriptionHtml: html ? unescapeHtml(html) : null,
      descriptionText: null,
      applyUrl:
        str(payload.absolute_url) ??
        `https://boards.greenhouse.io/embed/job_app?token=${encodeURIComponent(externalId)}`,
      // `first_published` is the real posting date where the board exposes it;
      // `updated_at` is the fallback and is at least an upper bound.
      postedAt: isoDate(payload.first_published) ?? isoDate(payload.updated_at),
      closesAt: null,
      employmentTypeHint: null,
      workplaceHint: null,
      salary: parseSalary(payload),
      department,
    };
  },
};
