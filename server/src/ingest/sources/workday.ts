/**
 * Workday — docs/README.md §4.2: "Workday is where a quarter disappears."
 *
 * This reads the same JSON a company's own public career site fetches to render itself:
 *
 *   POST https://{tenant}.wd{n}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs
 *        {"appliedFacets":{},"limit":20,"offset":0,"searchText":""}
 *   GET  https://{tenant}.wd{n}.myworkdayjobs.com/wday/cxs/{tenant}/{site}{externalPath}
 *
 * §4.3 compliance, since this is the first source where it has to be checked per tenant
 * rather than once per vendor:
 *
 *  - This is the employer's own tenant serving the employer's own public postings to
 *    anonymous visitors, for the purpose of being read. No credential, no session, no bot
 *    check, and nothing here behaves differently from the career page itself.
 *  - robots.txt is per tenant, so ../http.ts decides it per tenant with no help from this
 *    file. Checked while writing it, NVIDIA's tenant is representative: `User-agent: *`,
 *    `Allow: /{site}/`, a published sitemap, and exactly two disallows —
 *    `/talentcommunity/` and `/refreshFacet/`. A tenant that disallows `/wday/` is
 *    disabled on its first crawl by the RobotsDisallowedError branch in ../pipeline.ts,
 *    which is the correct outcome and needs no code here.
 *  - That `/refreshFacet/` disallow is also why this uses the plain `/jobs` list endpoint
 *    rather than the `customfacets/explore` one: facet endpoints are the ones Workday
 *    tenants actually ask crawlers to leave alone, and `/jobs` returns strictly more of
 *    what we want anyway.
 *
 * Two structural differences from the other three adapters, and the reason `extractPage`
 * and `detailRequest` exist in ./types.ts at all:
 *
 *  - The list endpoint is offset-paginated and silently caps `limit` at 20, so a
 *    600-posting tenant is 30 requests rather than one.
 *  - The list endpoint does not return descriptions. Without one there is no salary, no
 *    requirements, no skills and a quality score near the floor, so each *changed*
 *    posting costs one more request. Unchanged postings cost nothing — ../pipeline.ts
 *    hydrates after the content-hash dedup, not before.
 */

import { isCountryName, isRegionName } from '../normalize/location.ts';
import {
  asRecord,
  isoDate,
  str,
  type ParsedPosting,
  type RawPosting,
  type SourceAdapter,
  type SourcePage,
  type SourceRef,
  type SourceRequest,
} from './types.ts';

/** Workday caps a page at 20 regardless of what we ask for. Asking for more invites a 400. */
const PAGE_SIZE = 20;

/**
 * Locale segments that appear in a career-site URL but are not the site name.
 *
 * `https://tenant.wd5.myworkdayjobs.com/en-US/CareerSite` and
 * `https://tenant.wd5.myworkdayjobs.com/CareerSite` are the same board, and board rows
 * are written both ways in the wild.
 */
const LOCALE = /^[a-z]{2}(-[A-Za-z]{2})?$/;

interface Tenant {
  /** `tenant.wd5.myworkdayjobs.com` — the tenant's own host, never ours to choose. */
  host: string;
  /** `tenant` — the first host label, which Workday repeats inside the cxs path. */
  name: string;
  /** `NVIDIAExternalCareerSite` — the career site within the tenant. */
  site: string;
}

function tenantFromBoardUrl(source: SourceRef): Tenant {
  const url = new URL(source.boardUrl);
  const name = url.host.split('.')[0];
  if (!name) throw new Error(`Cannot derive a Workday tenant from ${source.boardUrl}`);

  const segments = url.pathname.split('/').filter(Boolean);
  const site = source.boardToken ?? segments.filter((segment) => !LOCALE.test(segment)).at(-1);
  if (!site) throw new Error(`Cannot derive a Workday career site from ${source.boardUrl}`);

  return { host: url.host, name, site };
}

/**
 * The tenant, read back out of a list request's own URL.
 *
 * This is what keeps the pagination hook pure and keeps ../pipeline.ts vendor-agnostic:
 * `extractPage` is handed the request that produced the body, so it can name the next
 * page and stamp the tenant onto each payload without ever seeing the SourceRef.
 */
function tenantFromListUrl(requestUrl: string): Tenant {
  const url = new URL(requestUrl);
  // /wday/cxs/{tenant}/{site}/jobs
  const [, , , name, site] = url.pathname.split('/');
  if (!name || !site) throw new Error(`Not a Workday list URL: ${requestUrl}`);
  return { host: url.host, name, site };
}

function listRequest(tenant: Tenant, offset: number): SourceRequest {
  return {
    url: `https://${tenant.host}/wday/cxs/${encodeURIComponent(tenant.name)}/${encodeURIComponent(
      tenant.site,
    )}/jobs`,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ appliedFacets: {}, limit: PAGE_SIZE, offset, searchText: '' }),
  };
}

/** The offset a list request asked for, read back out of its own body. */
function offsetOf(request: SourceRequest): number {
  if (!request.body) return 0;
  try {
    const offset = asRecord(JSON.parse(request.body)).offset;
    return typeof offset === 'number' ? offset : 0;
  } catch {
    return 0;
  }
}

/**
 * `"Posted 3 Days Ago"` → an ISO timestamp.
 *
 * Workday's list endpoint states age as display text, not a date, and many tenants leave
 * `startDate` empty on the detail record too. The alternative to reading this is a null
 * `posted_at`, which sorts a posting to the bottom of every feed forever and makes the
 * recency term in §5.1 dead weight for the whole source.
 *
 * It is approximate and deliberately biased toward *older*: "Today" is midnight rather
 * than now, and the open-ended "30+ Days Ago" is taken as exactly 30 days, a floor on a
 * posting that may be far older. Under-stating freshness costs a posting some rank;
 * over-stating it puts stale postings at the top of a student's feed, which §16 counts as
 * a top-tier trust risk.
 */
function parseRelativePosted(value: string | null): string | null {
  if (!value) return null;
  const text = value.toLowerCase();

  const days = /(\d+)\+?\s*day/.exec(text);
  if (days?.[1]) return daysAgo(Number.parseInt(days[1], 10));

  const months = /(\d+)\+?\s*month/.exec(text);
  if (months?.[1]) return daysAgo(Number.parseInt(months[1], 10) * 30);

  if (text.includes('yesterday')) return daysAgo(1);
  if (text.includes('today') || text.includes('just posted')) return daysAgo(0);

  return null;
}

function daysAgo(days: number): string {
  const date = new Date();
  if (Number.isFinite(days) && days > 0) date.setUTCDate(date.getUTCDate() - days);
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString();
}

/**
 * `"2 Locations"` is not a place.
 *
 * Workday writes this into `locationsText` whenever a posting is listed in more than one
 * office, and the detail record carries the real ones. Passed through, the parser in
 * ../normalize/location.ts has no way to know it is a label rather than a town, and it
 * becomes a city attached to every multi-location posting in the corpus — the same class
 * of bug as the employer office codes rejected in 51d3d73.
 */
function realLocation(value: string | null): string | null {
  if (!value) return null;
  return /^\d+\s+locations?$/i.test(value.trim()) ? null : cityFirst(value);
}

/**
 * `"US, CA, Santa Clara"` → `"Santa Clara, CA, US"`.
 *
 * Workday orders a location broadest-first. Every heuristic in ../normalize/location.ts
 * assumes the opposite, because that is what the other three ATSs emit — so left alone,
 * "US, CA, Santa Clara" is read as a *two-location* posting and fans out into a row for
 * "Santa Clara" plus a row whose city is literally "US". That is the §4.4 failure where
 * the location filter lies, and it is the same shape as the office codes rejected in
 * 51d3d73. Verified against NVIDIA's tenant, which is where it was found.
 *
 * Only reorders when the first segment really is a country: tenants configured city-first
 * ("Santa Clara, CA, United States") exist and are already right.
 */
function cityFirst(value: string): string {
  const segments = value.split(',').map((segment) => segment.trim()).filter(Boolean);
  const [country, ...rest] = segments;
  if (!country || rest.length === 0 || !isCountryName(country)) return value;

  /*
   * Reversed rather than sorted into city/region slots: Workday nests as
   * country > region > city, so reversing is exactly the inverse.
   *
   * The intermediate levels are then dropped unless they are a US state, which is the only
   * kind of region ../normalize/location.ts recognises. "India, Karnataka, Bengaluru"
   * reordered in full is "Bengaluru, Karnataka, India", and that module — which says of
   * itself that it is "not a gazetteer" — has no way to know Karnataka is a province, so
   * it reads it as a *second* location and the posting fans out into a real city plus a
   * city called "Karnataka". Emitting "Bengaluru, India" keeps the two fields that the
   * feed actually filters on and invents nothing.
   */
  const city = rest.at(-1);
  const region = rest.length > 1 ? rest.slice(0, -1).filter(isRegionName) : [];

  return [city, ...region, country].filter(Boolean).join(', ');
}

/** Workday's own words for where the work happens, where the tenant has configured them. */
function workplaceHint(detail: Record<string, unknown>): ParsedPosting['workplaceHint'] {
  const remoteType = (str(detail.remoteType) ?? '').toLowerCase();
  if (remoteType === '') return null;
  if (remoteType.includes('hybrid')) return 'Hybrid';
  if (remoteType.includes('remote')) return 'Remote';
  // "On-site" / "In Office" is a real statement, unlike an absent field.
  if (remoteType.includes('site') || remoteType.includes('office')) return 'Onsite';
  return null;
}

function employmentHint(detail: Record<string, unknown>): string | null {
  const timeType = str(detail.timeType);
  if (!timeType) return null;
  const normalized = timeType.toLowerCase().replace(/[\s_-]+/g, '');
  if (normalized === 'fulltime') return 'Full-time';
  if (normalized === 'parttime') return 'Part-time';
  return timeType;
}

function raise(message: string): never {
  throw new Error(message);
}

/** The req id Workday shows on the card, which is the one id that survives a retitle. */
function requisitionId(payload: Record<string, unknown>): string | null {
  const bullets = payload.bulletFields;
  return Array.isArray(bullets) ? str(bullets[0]) : null;
}

/** One page's postings, before the tenant has been stamped on. */
function splitPostings(body: string): RawPosting[] {
  const parsed = asRecord(JSON.parse(body));
  const postings = parsed.jobPostings;
  if (!Array.isArray(postings)) {
    throw new Error('Workday response has no `jobPostings` array');
  }

  return postings.flatMap((entry) => {
    const payload = asRecord(entry);
    const externalPath = str(payload.externalPath);

    /*
     * The requisition id (`bulletFields: ["R-12345"]`) in preference to `externalPath`,
     * because the path contains the title slug: a posting retitled from "Intern" to
     * "Intern - Summer 2027" changes its path and would land as a second, competing row
     * for the same job. The req id survives a retitle.
     */
    const externalId = requisitionId(payload) ?? externalPath;

    // No id and no path means nothing to dedup against and nothing to hydrate. Dropping
    // it beats landing a row that can never be reconciled with its own future self.
    if (!externalId || !externalPath) return [];

    return [{ externalId, payload }];
  });
}

export const workday: SourceAdapter = {
  kind: 'workday',
  applyHost: 'workday',

  request(source: SourceRef): SourceRequest {
    return listRequest(tenantFromBoardUrl(source), 0);
  },

  /**
   * Postings from one page, with no pagination and no tenant stamped on.
   *
   * ../pipeline.ts prefers `extractPage` for this adapter and never calls this, but the
   * contract requires it and it is the honest answer to "what postings are in this body".
   */
  extract(body: string): RawPosting[] {
    return splitPostings(body);
  },

  extractPage(body: string, request: SourceRequest): SourcePage {
    const tenant = tenantFromListUrl(request.url);

    /*
     * The tenant is stamped onto every payload here rather than resolved later, because
     * `parse` is handed nothing but a stored payload — that is what makes replaying
     * `raw_postings` offline possible (replaySource in ../pipeline.ts) — and neither the
     * detail request nor the apply URL can be built without it.
     */
    const postings = splitPostings(body).map((posting) => ({
      externalId: posting.externalId,
      payload: {
        ...posting.payload,
        __host: tenant.host,
        __tenant: tenant.name,
        __site: tenant.site,
      },
    }));

    const offset = offsetOf(request);
    const total = asRecord(JSON.parse(body)).total;
    const seen = offset + postings.length;

    // Stopping on an empty page as well as on the count: tenants that report a wrong
    // `total` exist — usually the unfiltered one — and would otherwise page forever.
    const exhausted =
      postings.length === 0 || typeof total !== 'number' || seen >= total;

    return { postings, next: exhausted ? null : listRequest(tenant, seen) };
  },

  /** The description, which the list endpoint does not return. */
  detailRequest(posting: RawPosting): SourceRequest | null {
    // Already hydrated: a replay over stored payloads must not re-fetch.
    if (posting.payload.__detail !== undefined) return null;

    const host = str(posting.payload.__host);
    const tenant = str(posting.payload.__tenant);
    const site = str(posting.payload.__site);
    const externalPath = str(posting.payload.externalPath);
    if (!host || !tenant || !site || !externalPath) return null;

    return {
      url: `https://${host}/wday/cxs/${encodeURIComponent(tenant)}/${encodeURIComponent(site)}${externalPath}`,
    };
  },

  mergeDetail(posting: RawPosting, body: string): RawPosting {
    const parsed = asRecord(JSON.parse(body));
    // Tenants differ on whether the record is wrapped in `jobPostingInfo`; both appear.
    const wrapped = asRecord(parsed.jobPostingInfo);
    const detail = Object.keys(wrapped).length > 0 ? wrapped : parsed;

    return {
      externalId: posting.externalId,
      payload: { ...posting.payload, __detail: detail },
    };
  },

  parse({ externalId, payload }: RawPosting): ParsedPosting {
    const detail = asRecord(payload.__detail);

    const primary = realLocation(str(detail.location) ?? str(payload.locationsText));

    const additional = Array.isArray(detail.additionalLocations)
      ? detail.additionalLocations.flatMap((entry) => {
          const location = realLocation(str(entry));
          return location && location !== primary ? [location] : [];
        })
      : [];

    const host = str(payload.__host);
    const site = str(payload.__site);
    const externalPath = str(payload.externalPath);

    /*
     * Workday's own `externalUrl` where it gives one, because that is the link the
     * employer publishes. The constructed `/en-US/{site}{path}` form is the same page and
     * is what the career site's own listing links to. §4.3: we send users to the
     * employer's application page, which is the argument that makes this defensible.
     */
    const applyUrl =
      str(detail.externalUrl) ??
      (host && site && externalPath ? `https://${host}/en-US/${site}${externalPath}` : null);

    return {
      externalId,
      title: str(detail.title) ?? str(payload.title) ?? 'Untitled role',
      locationRaw: primary,
      extraLocations: additional,
      descriptionHtml: str(detail.jobDescription),
      // Workday sends HTML only; ../normalize/html.ts derives the text.
      descriptionText: null,
      // Throwing rather than landing an unapplyable row: a card a student cannot apply to
      // is worse than a card that does not exist (§16). Unreachable in practice, since
      // extractPage stamps the tenant onto every payload it produces.
      applyUrl: applyUrl ?? raise(`Workday posting ${externalId} has no apply URL`),
      postedAt:
        isoDate(detail.startDate) ??
        isoDate(detail.postedOnDate) ??
        parseRelativePosted(str(payload.postedOn)),
      closesAt: isoDate(detail.endDate),
      employmentTypeHint: employmentHint(detail),
      workplaceHint: workplaceHint(detail),
      // Workday tenants effectively never publish structured pay on the public endpoint;
      // ../normalize/salary.ts reads it out of the description text, as it already does
      // for Greenhouse boards that have not adopted pay ranges.
      salary: null,
      department: str(detail.jobFamily) ?? str(detail.jobFamilyGroup),
    };
  },
};
