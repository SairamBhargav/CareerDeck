/**
 * Lever — docs/README.md §4.2: "Public JSON. Easy."
 *
 *   GET https://api.lever.co/v0/postings/{company}?mode=json
 *
 * The most generous of the three: it returns plain-text descriptions alongside the HTML,
 * an explicit `workplaceType`, a structured `salaryRange`, and `createdAt` as real epoch
 * milliseconds. Almost nothing has to be inferred.
 *
 * The response is a bare array rather than an object, which is the one shape difference
 * from the other two adapters.
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
  const segments = new URL(source.boardUrl).pathname.split('/').filter(Boolean);
  const token = segments.at(-1);
  if (!token) throw new Error(`Cannot derive a Lever handle from ${source.boardUrl}`);
  return token;
}

/**
 * Lever's `salaryRange.interval` is one of `per-year-salary`, `per-hour-wage`,
 * `per-month-salary`, `per-week-salary`, `per-day-wage`, `one-time`.
 *
 * Monthly and weekly are converted to annual, because they are still a *stated* figure —
 * the employer said what they pay, just on a different clock. `one-time` is a bonus or a
 * stipend, not a rate, and is discarded rather than stored as if it were pay.
 */
function parseSalary(payload: Record<string, unknown>): StructuredSalary | null {
  const range = asRecord(payload.salaryRange);
  const min = num(range.min);
  const max = num(range.max);
  if (min === null && max === null) return null;

  const currency = (str(range.currency) ?? 'USD').toUpperCase();
  const interval = str(range.interval) ?? 'per-year-salary';

  const annualize = (value: number | null, factor: number) => (value === null ? null : value * factor);

  switch (interval) {
    case 'per-hour-wage':
      return { min, max, period: 'hour', currency };
    case 'per-month-salary':
      return { min: annualize(min, 12), max: annualize(max, 12), period: 'year', currency };
    case 'per-week-salary':
      return { min: annualize(min, 52), max: annualize(max, 52), period: 'year', currency };
    case 'per-day-wage':
      return { min: annualize(min, 260), max: annualize(max, 260), period: 'year', currency };
    case 'one-time':
      return null;
    default:
      return { min, max, period: 'year', currency };
  }
}

function workplace(payload: Record<string, unknown>): ParsedPosting['workplaceHint'] {
  switch (str(payload.workplaceType)?.toLowerCase()) {
    case 'remote':
      return 'Remote';
    case 'hybrid':
      return 'Hybrid';
    case 'on-site':
    case 'onsite':
      return 'Onsite';
    default:
      return null;
  }
}

/**
 * Lever splits a posting across `descriptionPlain`, a `lists` array of titled bullet
 * sections (Requirements, Benefits…) and `additionalPlain`.
 *
 * Reassembling them in order is what makes a Lever description read like a description
 * rather than a lede with its requirements missing — which also matters for the salary
 * parser, since the compliance paragraph usually lives in `additionalPlain`.
 */
function assembleText(payload: Record<string, unknown>): string | null {
  const parts: string[] = [];
  const opening = str(payload.descriptionPlain);
  if (opening) parts.push(opening);

  if (Array.isArray(payload.lists)) {
    for (const entry of payload.lists) {
      const list = asRecord(entry);
      const heading = str(list.text);
      const content = str(list.content);
      if (!content) continue;
      // `content` is an HTML <li> run; ../normalize/html.ts turns it into lines.
      parts.push(heading ? `${heading}\n${content}` : content);
    }
  }

  const closing = str(payload.additionalPlain);
  if (closing) parts.push(closing);

  return parts.length > 0 ? parts.join('\n\n') : null;
}

export const lever: SourceAdapter = {
  kind: 'lever',
  applyHost: 'lever',

  request(source: SourceRef): SourceRequest {
    return {
      url: `https://api.lever.co/v0/postings/${encodeURIComponent(boardToken(source))}?mode=json`,
    };
  },

  extract(body: string): RawPosting[] {
    const parsed: unknown = JSON.parse(body);
    if (!Array.isArray(parsed)) {
      throw new Error('Lever response is not an array of postings');
    }

    return parsed.flatMap((entry) => {
      const payload = asRecord(entry);
      const externalId = str(payload.id);
      return externalId ? [{ externalId, payload }] : [];
    });
  },

  parse({ externalId, payload }: RawPosting): ParsedPosting {
    const categories = asRecord(payload.categories);
    const primary = str(categories.location);

    const all = Array.isArray(categories.allLocations)
      ? categories.allLocations.flatMap((value) => {
          const location = str(value);
          return location && location !== primary ? [location] : [];
        })
      : [];

    return {
      externalId,
      title: str(payload.text) ?? 'Untitled role',
      locationRaw: primary,
      extraLocations: all,
      descriptionHtml: str(payload.description),
      descriptionText: assembleText(payload),
      // `applyUrl` goes straight to the form; `hostedUrl` is the posting page. Either is
      // the employer's own ATS, which §4.3 requires — we never rewrite it.
      applyUrl: str(payload.applyUrl) ?? str(payload.hostedUrl) ?? `https://jobs.lever.co/${externalId}`,
      postedAt: isoDate(payload.createdAt),
      closesAt: null,
      employmentTypeHint: str(categories.commitment),
      workplaceHint: workplace(payload),
      salary: parseSalary(payload),
      department: str(categories.department) ?? str(categories.team),
    };
  },
};
