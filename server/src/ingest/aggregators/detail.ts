/**
 * The employer's own description for a posting the Simplify feed only links to.
 *
 * The feed gives a title, a company, a location and an apply URL, and nothing to read. That
 * left 37% of the corpus as one synthesized sentence, which is what a reel showed. But the apply
 * URL is the employer's own ATS page, and most ATSs publish the same posting through the public
 * API our direct crawlers already read. So each URL is mapped to that API and read once, as a
 * single posting rather than a whole board.
 *
 * Same §4.3 posture as the direct crawl: every request goes through `politeFetch` (robots.txt,
 * per-host pacing, backoff), and every endpoint is the one the employer's own career page fetches
 * to render itself. Where there is no API, the page's schema.org `JobPosting` block is read —
 * structured data the employer publishes specifically so machines can read the posting.
 *
 * Returns null when the host is not one of these, the posting is gone, or robots.txt says no.
 * The caller then keeps the synthesized sentence, so a failure here costs a description and
 * never a posting.
 */

import { politeFetch } from '../http.ts';
import { classifyFamily, type JobFamily } from '../normalize/family.ts';
import { decodeEntities, extractRequirements, htmlToText } from '../normalize/html.ts';
import { parseSalary } from '../normalize/salary.ts';
import { extractSkills, type SkillDictionary } from '../normalize/skills.ts';
import { ashby, greenhouse, lever, workday } from '../sources/index.ts';
import { asRecord, str, type ParsedPosting, type StructuredSalary } from '../sources/types.ts';

export interface PostingDetail {
  descriptionHtml: string | null;
  descriptionText: string | null;
  salary: StructuredSalary | null;
}

const LOCALE = /^[a-z]{2}(-[A-Za-z]{2})?$/;

function fromParsed(parsed: ParsedPosting): PostingDetail | null {
  if (!parsed.descriptionHtml && !parsed.descriptionText) return null;
  return { descriptionHtml: parsed.descriptionHtml, descriptionText: parsed.descriptionText, salary: parsed.salary };
}

async function json(url: string): Promise<Record<string, unknown>> {
  const response = await politeFetch({ url });
  return asRecord(JSON.parse(response.body ?? '{}'));
}

// ── one reader per ATS ───────────────────────────────────────────────────────

/** `job-boards.greenhouse.io/{token}/jobs/{id}`, `boards.greenhouse.io/...`, or `?for=&token=`. */
async function readGreenhouse(url: URL): Promise<PostingDetail | null> {
  const path = url.pathname.match(/^\/([^/]+)\/jobs\/(\d+)/);
  const board = path?.[1] ?? url.searchParams.get('for');
  const id = path?.[2] ?? url.searchParams.get('token') ?? url.searchParams.get('gh_jid');
  if (!board || !id || board === 'embed') return null;

  const payload = await json(
    `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs/${encodeURIComponent(id)}`,
  );
  return fromParsed(greenhouse.parse({ externalId: id, payload }));
}

/** `jobs.lever.co/{org}/{id}[/apply]`, and the EU instance at `jobs.eu.lever.co`. */
async function readLever(url: URL): Promise<PostingDetail | null> {
  const [org, id] = url.pathname.split('/').filter(Boolean);
  if (!org || !id) return null;
  const api = url.hostname.includes('.eu.') ? 'api.eu.lever.co' : 'api.lever.co';
  const payload = await json(`https://${api}/v0/postings/${encodeURIComponent(org)}/${encodeURIComponent(id)}`);
  return fromParsed(lever.parse({ externalId: id, payload }));
}

/**
 * Ashby publishes a board, not a posting, so one board read answers every posting on it. Cached
 * for a few minutes: a feed with 40 postings at one company costs one request, not 40, and the
 * API server (which checks liveness per Auto Apply) never serves a board from yesterday.
 */
const ashbyBoards = new Map<string, { at: number; jobs: Promise<Record<string, unknown>[]> }>();
const ASHBY_BOARD_TTL_MS = 10 * 60_000;

function ashbyBoard(org: string): Promise<Record<string, unknown>[]> {
  const cached = ashbyBoards.get(org);
  if (cached && Date.now() - cached.at < ASHBY_BOARD_TTL_MS) return cached.jobs;
  const jobs = json(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(org)}?includeCompensation=true`)
    .then((body) => (Array.isArray(body.jobs) ? body.jobs.map(asRecord) : []));
  // A failed read is not cached, or one timeout would hide a whole board for ten minutes.
  jobs.catch(() => ashbyBoards.delete(org));
  ashbyBoards.set(org, { at: Date.now(), jobs });
  return jobs;
}

/** Decoded, because org names can hold spaces ("Verne%20Robotics") and are re-encoded on use. */
function ashbyIds(url: URL): [string, string] | null {
  const [org, id] = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  return org && id ? [org, id] : null;
}

async function readAshby(url: URL): Promise<PostingDetail | null> {
  const ids = ashbyIds(url);
  if (!ids) return null;
  const [org, id] = ids;
  const payload = (await ashbyBoard(org)).find((job) => str(job.id) === id && job.isListed !== false);
  return payload ? fromParsed(ashby.parse({ externalId: id, payload })) : null;
}

/** `{tenant}.wd5.myworkdayjobs.com/[en-US/]{site}/job/{location}/{slug}` → the cxs detail. */
async function readWorkday(url: URL): Promise<PostingDetail | null> {
  const tenant = url.hostname.split('.')[0];
  const segments = url.pathname.split('/').filter((segment) => segment && !LOCALE.test(segment));
  const [site, kind, ...rest] = segments;
  if (!tenant || !site || (kind !== 'job' && kind !== 'details') || rest.length === 0) return null;

  const externalPath = `/job/${rest.join('/')}`;
  const body = await json(
    `https://${url.host}/wday/cxs/${encodeURIComponent(tenant)}/${encodeURIComponent(site)}${externalPath}`,
  );
  const wrapped = asRecord(body.jobPostingInfo);
  const detail = Object.keys(wrapped).length > 0 ? wrapped : body;

  return fromParsed(workday.parse({
    externalId: externalPath,
    payload: { __host: url.host, __tenant: tenant, __site: site, externalPath, __detail: detail },
  }));
}

/** `jobs.smartrecruiters.com/{company}/{id}[-slug]` → the public postings API. */
async function readSmartRecruiters(url: URL): Promise<PostingDetail | null> {
  const [company, idSlug] = url.pathname.split('/').filter(Boolean);
  const id = idSlug?.match(/^\d+/)?.[0];
  if (!company || !id) return null;

  const body = await json(
    `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(company)}/postings/${id}`,
  );
  const sections = asRecord(asRecord(body.jobAd).sections);
  const html = ['jobDescription', 'qualifications', 'additionalInformation', 'companyDescription']
    .map((key) => asRecord(sections[key]))
    .filter((section) => str(section.text))
    .map((section) => `<h3>${str(section.title) ?? ''}</h3>${str(section.text)}`)
    .join('\n');
  return html ? { descriptionHtml: html, descriptionText: null, salary: null } : null;
}

/** `apply.workable.com/{account}/j/{shortcode}[/apply]` → Workable's public v2 job API. */
async function readWorkable(url: URL): Promise<PostingDetail | null> {
  const [account, marker, shortcode] = url.pathname.split('/').filter(Boolean);
  if (!account || marker !== 'j' || !shortcode) return null;

  const body = await json(
    `https://apply.workable.com/api/v2/accounts/${encodeURIComponent(account)}/jobs/${encodeURIComponent(shortcode)}`,
  );
  const html = [
    str(body.description),
    str(body.requirements) ? `<h3>Requirements</h3>${str(body.requirements)}` : null,
    str(body.benefits) ? `<h3>Benefits</h3>${str(body.benefits)}` : null,
  ].filter(Boolean).join('\n');
  return html ? { descriptionHtml: html, descriptionText: null, salary: null } : null;
}

/**
 * Anything else: the page's own schema.org `JobPosting`. iCIMS and most enterprise career sites
 * publish one for search engines; single-page apps that render client-side do not, and those
 * return null.
 */
async function readJsonLd(url: URL): Promise<PostingDetail | null> {
  const response = await politeFetch({ url: url.toString(), headers: { accept: 'text/html' } });
  const page = response.body ?? '';

  for (const match of page.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(match[1]!.trim());
    } catch {
      continue;
    }
    const nodes = (Array.isArray(parsed) ? parsed : [parsed, ...asArray(asRecord(parsed)['@graph'])]).map(asRecord);
    const posting = nodes.find((node) => String(node['@type']).includes('JobPosting'));
    const description = str(posting?.description);
    // Some sites entity-escape the HTML inside the JSON, as Greenhouse does in its API.
    if (description) return { descriptionHtml: decodeEntities(description), descriptionText: null, salary: null };
  }
  return null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

// ── dispatch ──────────────────────────────────────────────────────────────────

export async function fetchPostingDetail(applyUrl: string): Promise<PostingDetail | null> {
  let url: URL;
  try {
    url = new URL(applyUrl);
  } catch {
    return null;
  }
  const host = url.hostname;

  if (host.endsWith('greenhouse.io')) return readGreenhouse(url);
  if (host.endsWith('lever.co')) return readLever(url);
  if (host === 'jobs.ashbyhq.com') return readAshby(url);
  if (host.endsWith('myworkdayjobs.com')) return readWorkday(url);
  if (host === 'jobs.smartrecruiters.com') return readSmartRecruiters(url);
  if (host === 'apply.workable.com') return readWorkable(url);
  // Oracle Cloud HCM renders client-side (no JSON-LD to read), and its per-tenant hosts trip
  // antivirus phishing heuristics on developer machines. Nothing to gain by requesting them.
  if (host.endsWith('oraclecloud.com')) return null;
  return readJsonLd(url);
}

/** Forgets cached Ashby boards between runs, so a long-lived process does not serve stale ones. */
export function resetDetailCache(): void {
  ashbyBoards.clear();
}

// ── is the posting still up? ──────────────────────────────────────────────────

export type Liveness = 'live' | 'gone' | 'unknown';

/**
 * Whether the employer still lists a posting, asked of the employer's own ATS.
 *
 * The Simplify feed lags employers by days, so a posting can be "open" here and already gone
 * there — and an Auto Apply that opens a "page not found" is the worst version of that. Only an
 * answer the ATS gives unambiguously counts as `gone`: a 404/410 from a posting API, an Ashby
 * board that no longer lists the id, or a Workday tenant whose own search cannot find the
 * requisition. A timeout, a robots refusal, a bot wall or an unknown host is `unknown`, and
 * callers must treat `unknown` as open.
 */
export async function checkPostingLive(applyUrl: string): Promise<Liveness> {
  let url: URL;
  try {
    url = new URL(applyUrl);
  } catch {
    return 'unknown';
  }
  const host = url.hostname;

  try {
    if (host === 'jobs.ashbyhq.com') {
      const ids = ashbyIds(url);
      if (!ids) return 'unknown';
      const board = await ashbyBoard(ids[0]);
      const job = board.find((entry) => str(entry.id) === ids[1]);
      // An empty board is more likely a renamed org than every job closing at once.
      if (board.length === 0) return 'unknown';
      return job && job.isListed !== false ? 'live' : 'gone';
    }
    if (host.endsWith('myworkdayjobs.com')) return await workdayLive(url);
    if (
      host.endsWith('greenhouse.io') || host.endsWith('lever.co') ||
      host === 'jobs.smartrecruiters.com' || host === 'apply.workable.com'
    ) {
      return (await fetchPostingDetail(applyUrl)) ? 'live' : 'unknown';
    }
    return 'unknown';
  } catch (error) {
    const status = (error as { status?: unknown }).status;
    return status === 404 || status === 410 ? 'gone' : 'unknown';
  }
}

/**
 * Workday answers a removed posting's detail with 403 "permission denied" — the same status a
 * tenant's bot wall uses. So a failed detail read is confirmed against the tenant's own public
 * search: the requisition id (the `_R12345` / `_01875358` suffix) either still appears or not.
 */
async function workdayLive(url: URL): Promise<Liveness> {
  const tenant = url.hostname.split('.')[0];
  const segments = url.pathname.split('/').filter((segment) => segment && !LOCALE.test(segment));
  const [site, , ...rest] = segments;
  const requisition = rest.at(-1)?.match(/_([A-Za-z]*-?\d[\w-]*)$/)?.[1];
  if (!tenant || !site) return 'unknown';

  try {
    return (await readWorkday(url)) ? 'live' : 'unknown';
  } catch (error) {
    const status = (error as { status?: unknown }).status;
    if (status !== 403 && status !== 404 && status !== 410) return 'unknown';
  }
  if (!requisition) return 'unknown';

  const response = await politeFetch({
    url: `https://${url.host}/wday/cxs/${encodeURIComponent(tenant)}/${encodeURIComponent(site)}/jobs`,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: 0, searchText: requisition }),
  });
  const body = asRecord(JSON.parse(response.body ?? '{}'));
  const postings = Array.isArray(body.jobPostings) ? body.jobPostings.map(asRecord) : null;
  if (postings === null) return 'unknown';
  return postings.some((posting) => String(posting.externalPath ?? '').includes(requisition)) ? 'live' : 'gone';
}

/**
 * Details for many URLs at once, each fetched once. `politeFetch` paces each host on its own,
 * so the concurrency here only spreads work across different employers.
 */
export async function fetchPostingDetails(
  urls: string[],
  options: { concurrency?: number; log?: (message: string) => void } = {},
): Promise<Map<string, PostingDetail | null>> {
  const unique = [...new Set(urls)];
  const results = new Map<string, PostingDetail | null>();
  let next = 0;

  const worker = async () => {
    while (next < unique.length) {
      const url = unique[next++]!;
      try {
        results.set(url, await fetchPostingDetail(url));
      } catch (error) {
        // A 404 is a posting the employer already took down; anything else is logged and skipped.
        options.log?.(`      detail ${url} — ${error instanceof Error ? error.message : String(error)}`);
        results.set(url, null);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(options.concurrency ?? 8, unique.length) }, worker));
  return results;
}

// ── turning a detail into the columns a jobs row carries ─────────────────────

export interface ListingFacts {
  title: string;
  companyName: string;
  terms: string[];
  degrees: string[];
}

export interface DescribedPosting {
  description_text: string;
  requirements: string[];
  skills: string[];
  salary: { min: number | null; max: number | null; period: 'hour' | 'year'; currency: string } | null;
  job_family: JobFamily | null;
  /** Whether the text is the employer's own, which is what quality.ts rewards. */
  hasFullDescription: boolean;
  hasStructuredSalary: boolean;
}

/**
 * The stand-in when the employer's description cannot be read: what the role is, who it is
 * with, and the terms and degrees the feed states. Nothing invented, and no provenance line —
 * a card is not the place to cite where a listing was found.
 */
export function synthesizeDescription(listing: ListingFacts): string {
  const parts = [`${listing.title} at ${listing.companyName}.`];
  if (listing.terms.length > 0) parts.push(`Term: ${listing.terms.join(', ')}.`);
  if (listing.degrees.length > 0) parts.push(`Open to ${listing.degrees.join(', ')} students.`);
  parts.push('Tap Apply to see the full posting on the employer’s site.');
  return parts.join(' ');
}

/** A listing plus whatever detail was read → description, requirements, skills, salary, family. */
export function describePosting(
  listing: ListingFacts,
  detail: PostingDetail | null,
  dictionary: SkillDictionary,
): DescribedPosting {
  const text = detail
    ? (detail.descriptionText?.trim() ? detail.descriptionText.trim() : htmlToText(detail.descriptionHtml))
    : '';

  if (text.length < MIN_REAL_DESCRIPTION) {
    const requirements = listing.degrees.length > 0 ? [`Open to ${listing.degrees.join(', ')} students`] : [];
    const skills = extractSkills(dictionary, listing.title, requirements, '');
    return {
      description_text: synthesizeDescription(listing),
      requirements,
      skills,
      salary: null,
      job_family: classifyFamily(listing.title, skills),
      hasFullDescription: false,
      hasStructuredSalary: false,
    };
  }

  const requirements = extractRequirements(text);
  const skills = extractSkills(dictionary, listing.title, requirements, text);
  // USD only, for the reason normalize() in ../pipeline.ts gives: the card prints `$`.
  const parsed = parseSalary(detail?.salary ?? null, text);
  return {
    description_text: text,
    requirements,
    skills,
    salary: parsed?.currency === 'USD' ? parsed : null,
    job_family: classifyFamily(listing.title, skills),
    hasFullDescription: true,
    hasStructuredSalary: detail?.salary != null,
  };
}

/** Below this, what came back is a stub of its own (a title, a "see site") and not worth keeping. */
const MIN_REAL_DESCRIPTION = 200;
