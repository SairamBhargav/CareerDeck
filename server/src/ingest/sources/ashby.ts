/**
 * Ashby — docs/README.md §4.2: "Public JSON / GraphQL. Well structured, less documented."
 *
 *   GET https://api.ashbyhq.com/posting-api/job-board/{token}?includeCompensation=true
 *
 * This is Ashby's documented Job Posting API, not the GraphQL endpoint their own board UI
 * calls. The GraphQL one returns more, but it is an internal interface with no stability
 * promise, and §4.3's "only public, unauthenticated endpoints" is about intent as much as
 * access. The documented one is the one they meant for this.
 *
 * `includeCompensation` is opt-in and per-board: a board that has not published pay
 * simply omits the field, which is a real "not stated" and not a parse failure.
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
  if (!token) throw new Error(`Cannot derive an Ashby board name from ${source.boardUrl}`);
  return token;
}

/**
 * Ashby's compensation block is a list of `compensationTiers`, each with a `components`
 * array — salary, equity, bonus, commission. Only the salary component is pay in the
 * sense the card means, and folding equity into a salary range would inflate every
 * startup posting in the corpus.
 */
function parseSalary(payload: Record<string, unknown>): StructuredSalary | null {
  const compensation = asRecord(payload.compensation);
  const tiers = compensation.compensationTiers;
  if (!Array.isArray(tiers)) return null;

  let min: number | null = null;
  let max: number | null = null;
  let currency = 'USD';
  let period: 'hour' | 'year' | null = null;

  for (const tierEntry of tiers) {
    const components = asRecord(tierEntry).components;
    if (!Array.isArray(components)) continue;

    for (const componentEntry of components) {
      const component = asRecord(componentEntry);
      if (str(component.compensationType) !== 'Salary') continue;

      const interval = str(component.interval);
      // PER_HOUR / PER_YEAR are the two that matter; anything else (PER_MONTH, NONE) is
      // rare enough on Ashby that guessing is worse than reading the magnitude below.
      if (interval === 'PER_HOUR') period = 'hour';
      else if (interval === 'PER_YEAR') period = 'year';

      const code = str(component.currencyCode);
      if (code && code.length === 3) currency = code.toUpperCase();

      const low = num(component.minValue);
      const high = num(component.maxValue);
      if (low !== null) min = min === null ? low : Math.min(min, low);
      if (high !== null) max = max === null ? high : Math.max(max, high);
    }
  }

  if (min === null && max === null) return null;

  const scale = max ?? min ?? 0;
  return { min, max, period: period ?? (scale < 2000 ? 'hour' : 'year'), currency };
}

/** Ashby's employmentType vocabulary is its own; the normalizer maps it to ours. */
function employmentHint(payload: Record<string, unknown>): string | null {
  const value = str(payload.employmentType);
  if (!value) return null;
  switch (value) {
    case 'FullTime':
      return 'Full-time';
    case 'PartTime':
      return 'Part-time';
    case 'Intern':
      return 'Internship';
    case 'Contract':
    case 'Temporary':
      return 'Contract';
    default:
      return value;
  }
}

export const ashby: SourceAdapter = {
  kind: 'ashby',
  applyHost: 'ashby',

  request(source: SourceRef): SourceRequest {
    return {
      url: `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(
        boardToken(source),
      )}?includeCompensation=true`,
    };
  },

  extract(body: string): RawPosting[] {
    const parsed = asRecord(JSON.parse(body));
    const jobs = parsed.jobs;
    if (!Array.isArray(jobs)) {
      throw new Error('Ashby response has no `jobs` array');
    }

    return jobs.flatMap((entry) => {
      const payload = asRecord(entry);
      const externalId = str(payload.id);
      if (!externalId) return [];
      // `isListed: false` is a posting the employer has deliberately unpublished. It
      // still appears in the response; landing it would resurrect roles nobody can apply
      // to, which §16 names as a top-tier trust risk.
      if (payload.isListed === false) return [];
      return [{ externalId, payload }];
    });
  },

  parse({ externalId, payload }: RawPosting): ParsedPosting {
    const primary = str(payload.location);

    const secondary = Array.isArray(payload.secondaryLocations)
      ? payload.secondaryLocations.flatMap((entry) => {
          const location = str(asRecord(entry).location);
          return location && location !== primary ? [location] : [];
        })
      : [];

    return {
      externalId,
      title: str(payload.title) ?? 'Untitled role',
      locationRaw: primary,
      extraLocations: secondary,
      descriptionHtml: str(payload.descriptionHtml),
      descriptionText: str(payload.descriptionPlain),
      applyUrl: str(payload.applyUrl) ?? str(payload.jobUrl) ?? `https://jobs.ashbyhq.com/${externalId}`,
      postedAt: isoDate(payload.publishedAt) ?? isoDate(payload.updatedAt),
      closesAt: null,
      employmentTypeHint: employmentHint(payload),
      // Ashby states remoteness as a boolean. Absence is not "onsite" — it is silence,
      // and the location parser reads the location string for a hybrid signal instead.
      workplaceHint: payload.isRemote === true ? 'Remote' : null,
      salary: parseSalary(payload),
      department: str(payload.department) ?? str(payload.team),
    };
  },
};
