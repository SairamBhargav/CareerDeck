/**
 * The contract every ATS implements, and the reason there is one pipeline rather than
 * three.
 *
 * Adapters are deliberately dumb: they know one vendor's JSON shape and nothing else. No
 * adapter fetches, writes, normalizes, scores or dedupes — those belong to code that is
 * the same for every source. When SmartRecruiters or Workday arrive (docs/README.md §4.2)
 * they implement this interface and touch nothing else, which is the only real test of
 * whether the abstraction is right.
 */

export type AtsKind = 'greenhouse' | 'lever' | 'ashby' | 'workday' | 'smartrecruiters' | 'company_site' | 'feed';

/** A board row, as much of it as an adapter is allowed to see. */
export interface SourceRef {
  id: string;
  kind: AtsKind;
  boardUrl: string;
  boardToken: string | null;
  etag: string | null;
}

export interface SourceRequest {
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
}

/** One posting as the vendor sent it, before anything has been interpreted. */
export interface RawPosting {
  externalId: string;
  payload: Record<string, unknown>;
}

export interface StructuredSalary {
  min: number | null;
  max: number | null;
  period: 'hour' | 'year';
  currency: string;
}

/**
 * The vendor-neutral view of a posting: every field the normalizer reads, and nothing
 * that is specific to one ATS.
 *
 * The `*Hint` fields are the vendor's own opinion where it has one — Lever states a
 * `workplaceType`, Ashby states `isRemote`, Greenhouse states nothing and leaves it in
 * the location string. A hint is trusted over text parsing when present, which is the
 * whole reason they are carried separately rather than flattened into `locationRaw`.
 */
export interface ParsedPosting {
  externalId: string;
  title: string;
  locationRaw: string | null;
  /** Locations the ATS lists as separate fields; merged with `locationRaw` by the normalizer. */
  extraLocations: string[];
  descriptionHtml: string | null;
  descriptionText: string | null;
  applyUrl: string;
  /** ISO 8601, or null when the vendor does not say. */
  postedAt: string | null;
  closesAt: string | null;
  employmentTypeHint: string | null;
  workplaceHint: 'Remote' | 'Hybrid' | 'Onsite' | null;
  salary: StructuredSalary | null;
  department: string | null;
}

/** One page of a board that takes more than one request to read. */
export interface SourcePage {
  postings: RawPosting[];
  /** The request for the next page, or null when the board is exhausted. */
  next: SourceRequest | null;
}

export interface SourceAdapter {
  kind: AtsKind;
  /** The host used for `jobs.apply_host`, and what ApplicationSource reads in phase 2. */
  applyHost: string;
  /** Pure: a board row in, a request out. */
  request(source: SourceRef): SourceRequest;
  /** Split a board response into per-posting payloads. Throws if the body is not a board. */
  extract(body: string): RawPosting[];
  /** One stored payload → the neutral view above. Never touches the network. */
  parse(posting: RawPosting): ParsedPosting;

  /**
   * Optional, for a board that cannot be read in one request.
   *
   * Greenhouse, Lever and Ashby each return a whole board in one response, which is why
   * `extract` above takes a body and nothing else. Workday does not: its list endpoint is
   * offset-paginated and caps a page at 20. An adapter that implements this is handed each
   * page with the request that produced it, and names the next one — or null when done.
   *
   * This is the one place §4.2's claim that a new ATS "implements this interface and
   * touches nothing else" turned out to be wrong. Pagination is not expressible as a pure
   * body → postings function, so the contract grew rather than Workday faking it.
   */
  extractPage?(body: string, request: SourceRequest): SourcePage;

  /**
   * Optional second request per posting, for a list endpoint that omits the description.
   *
   * Returning null means the posting is already complete — which is also how a replay over
   * stored payloads avoids re-fetching what it already has.
   *
   * This runs *before* the content-hash dedup in landRawPostings, not after, because the
   * description has to be inside the payload for the hash to cover it and for
   * replaySource() to see it at all. The cost is one request per posting seen per crawl,
   * which is the price of a board that will not hand over its own descriptions. The fix,
   * if it ever bites, is a `raw_postings.list_hash` column to dedup against before
   * hydrating — not moving this after the landing, which would store descriptionless
   * payloads and quietly break replay.
   */
  detailRequest?(posting: RawPosting): SourceRequest | null;

  /** Fold a `detailRequest` response into the posting. Pure; required if that is set. */
  mergeDetail?(posting: RawPosting, body: string): RawPosting;
}

// ── helpers shared by the adapters ─────────────────────────────────────────────

export function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function str(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

export function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Whatever a vendor calls a timestamp → ISO 8601, or null.
 *
 * Handles epoch milliseconds (Lever), epoch seconds, and anything `Date` can read.
 * A date far in the future or before 2000 is treated as absent rather than stored: a
 * posting "published" in 1970 sorts to the bottom of every feed forever, and one
 * published in 2087 sorts to the top of every feed forever, which is worse.
 */
export function isoDate(value: unknown): string | null {
  if (value === null || value === undefined) return null;

  let date: Date;
  if (typeof value === 'number') {
    date = new Date(value > 1e11 ? value : value * 1000);
  } else if (typeof value === 'string') {
    const asNumber = Number(value);
    date = Number.isFinite(asNumber) && value.trim() !== '' && /^\d+$/.test(value.trim())
      ? new Date(asNumber > 1e11 ? asNumber : asNumber * 1000)
      : new Date(value);
  } else {
    return null;
  }

  const time = date.getTime();
  if (!Number.isFinite(time)) return null;

  const year = date.getUTCFullYear();
  if (year < 2000 || year > new Date().getUTCFullYear() + 2) return null;

  return date.toISOString();
}
