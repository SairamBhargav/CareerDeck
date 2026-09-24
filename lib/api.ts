/**
 * The seam — PHASE1.md §7 and §8.1.
 *
 * Every job and company read in the app goes through this file, and this file is the only
 * one that knows *how* they are fetched. Right now that is Supabase RPC against the SQL
 * functions in the phase 1 migration; when §5.1's ranker needs a Redis candidate pool and
 * a diversity pass that Postgres cannot express, these same functions start issuing
 * `fetch` to `/v1/feed` and no hook, screen or component changes.
 *
 * That reversibility is the whole reason the module exists. Decision B in PHASE1.md is a
 * deferral, not a rejection, and it is only cheap while this is the single point of
 * contact.
 *
 * Two shapes it is careful about:
 *
 *  - **`{job, viewer}`** (§1.3a). The shared entity and the viewer's relationship to it
 *    travel separately. In phase 1 `viewer` is always the default and the feed hooks
 *    overlay the client's in-memory sets; in phase 2 the server fills it and the overlay
 *    is deleted. The envelope shipping early is what makes that a deletion rather than a
 *    migration.
 *  - **Opaque cursors.** The server hands back a continuation token per row; the client
 *    passes the last one back and never looks inside. Keyset pagination is an
 *    implementation detail of the SQL, and phase 5 gets to change it.
 */

import { supabase } from '@/lib/supabase';
import type { Company, EmploymentType, Job, LocationType, SalaryPeriod, Seniority } from '@/types';

/** What the server knows about this viewer's relationship to a posting. §1.3(a). */
export interface JobViewerState {
  liked: boolean;
  saved: boolean;
  applied: boolean;
  /** Phase 4 fills this from `job_match_scores`. Null until then. */
  matchScore: number | null;
}

export interface JobEnvelope {
  job: Job;
  viewer: JobViewerState;
}

export interface Page<T> {
  items: T[];
  /** Pass back as `cursor` for the next page. Null when there is nothing after this one. */
  nextCursor: string | null;
}

export type FeedSort = 'recent' | 'salary' | 'company';

export interface FeedQuery {
  sort?: FeedSort;
  /** Restricts to these companies. Phase 1's stand-in for `company_follows`. §7.3. */
  companySlugs?: string[];
  cursor?: string | null;
  limit?: number;
}

/** Matches the `job_card` composite type in the phase 1 migration. */
interface JobCardRow {
  id: string;
  company_id: string;
  company_slug: string;
  company_name: string;
  company_logo_url: string | null;
  company_logo_color: string | null;
  company_monogram: string | null;
  title: string;
  seniority: Seniority | null;
  location_raw: string | null;
  location_city: string | null;
  location_region: string | null;
  location_country: string | null;
  location_type: LocationType;
  employment_type: EmploymentType;
  salary_min: string | number | null;
  salary_max: string | number | null;
  salary_period: SalaryPeriod | null;
  salary_is_estimated: boolean;
  description_text: string;
  requirements: string[] | null;
  skills: string[] | null;
  apply_url: string;
  apply_host: string | null;
  posted_at: string;
  last_seen_at: string;
  closes_at: string | null;
  quality_score: number;
  dedup_group_id: string;
  page_cursor: string | null;
  rank: number | null;
}

interface CompanyCardRow {
  id: string;
  slug: string;
  name: string;
  domain: string | null;
  logo_url: string | null;
  logo_monogram: string | null;
  logo_color: string | null;
  industry: string | null;
  hq_location: string | null;
  description: string | null;
  follower_count: number;
  open_job_count: number;
  rank: number | null;
}

/** "NVIDIA" → "NV". The last-resort monogram when a row has neither logo nor monogram. */
function monogramOf(name: string): string {
  const letters = name.replace(/[^a-zA-Z]/g, '');
  return (letters.slice(0, 2) || name.slice(0, 2)).toUpperCase();
}

/**
 * PostgREST serializes `numeric` as a string to avoid the precision loss that JSON numbers
 * would cause. Salaries are small enough that it does not matter, but reading them as
 * strings would — `salaryMin` would render as "40.00" and sort lexically.
 */
function toNumber(value: string | number | null): number | null {
  if (value === null) return null;
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toJob(row: JobCardRow): Job {
  return {
    id: row.id,
    companyId: row.company_id,
    companySlug: row.company_slug,
    companyName: row.company_name,
    companyLogo: row.company_monogram ?? monogramOf(row.company_name),
    companyLogoUrl: row.company_logo_url,
    companyLogoColor: row.company_logo_color,
    title: row.title,
    seniority: row.seniority,
    location: row.location_raw ?? 'Not specified',
    locationType: row.location_type,
    employmentType: row.employment_type,
    salaryMin: toNumber(row.salary_min),
    salaryMax: toNumber(row.salary_max),
    // The column is nullable — a posting with no stated pay has no period either. 'year'
    // is inert here: formatSalary() only reads it when there is an amount to format.
    salaryPeriod: row.salary_period ?? 'year',
    salaryIsEstimated: row.salary_is_estimated,
    description: row.description_text,
    requirements: row.requirements ?? [],
    skills: row.skills ?? [],
    postedAt: row.posted_at,
    lastSeenAt: row.last_seen_at,
    applicationUrl: row.apply_url,
    // Overwritten by the feed hooks' merge. Defaulting to false rather than leaving them
    // undefined keeps `Job` a complete value at every point it exists.
    isSaved: false,
    isLiked: false,
  };
}

const DEFAULT_VIEWER: JobViewerState = { liked: false, saved: false, applied: false, matchScore: null };

function toEnvelope(row: JobCardRow): JobEnvelope {
  return { job: toJob(row), viewer: { ...DEFAULT_VIEWER } };
}

function toCompany(row: CompanyCardRow): Company {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    logo: row.logo_url ?? row.logo_monogram ?? monogramOf(row.name),
    // CompanyLogo treats the colour as the plate behind the monogram, so an absent brand
    // colour has to become *something*. Near-black matches the app's own accent.
    logoColor: row.logo_color ?? '#111114',
    industry: row.industry ?? '',
    followerCount: row.follower_count,
    openJobCount: row.open_job_count,
    isFollowing: false,
  };
}

/**
 * The page size everywhere. Twenty is about three screens of Home's list and twenty Reels
 * cards, which is enough that `onEndReached` fires well before the reader arrives.
 */
export const PAGE_SIZE = 20;

/**
 * The last row's cursor, or null when the page came back short.
 *
 * A short page is the only reliable end-of-feed signal with keyset pagination — asking for
 * a count of a filtered, ranked set costs a full scan on every page for information the
 * reader never sees.
 */
function pageOf<T>(rows: JobCardRow[], limit: number, map: (row: JobCardRow) => T): Page<T> {
  return {
    items: rows.map(map),
    nextCursor: rows.length < limit ? null : (rows[rows.length - 1]?.page_cursor ?? null),
  };
}

export async function fetchFeed(query: FeedQuery = {}): Promise<Page<JobEnvelope>> {
  const limit = query.limit ?? PAGE_SIZE;

  const { data, error } = await supabase.rpc('feed_jobs', {
    p_sort: query.sort ?? 'recent',
    /*
     * `undefined`, not `null`, for an absent argument.
     *
     * Omitting the key lets Postgres apply the parameter's own DEFAULT, which is what
     * the function is written around. Sending an explicit null would work here too,
     * but the generated types model a defaulted argument as optional-and-not-null, and
     * fighting that would mean casting away the one check that keeps these call sites
     * honest about the function's signature.
     *
     * An empty slug array is deliberately turned into "no filter" rather than sent:
     * the SQL cannot tell the two apart, and only the caller knows which it means. §7.3.
     */
    p_company_slugs:
      query.companySlugs && query.companySlugs.length > 0 ? query.companySlugs : undefined,
    p_cursor: query.cursor ?? undefined,
    p_limit: limit,
  });

  if (error) throw error;
  return pageOf((data ?? []) as JobCardRow[], limit, toEnvelope);
}

export async function fetchCompanyJobs(slug: string, cursor?: string | null): Promise<Page<JobEnvelope>> {
  return fetchFeed({ companySlugs: [slug], cursor: cursor ?? null });
}

const JOB_SELECT =
  'id, company_id, title, seniority, location_raw, location_city, location_region, ' +
  'location_country, location_type, employment_type, salary_min, salary_max, salary_period, ' +
  'salary_is_estimated, description_text, requirements, skills, apply_url, apply_host, ' +
  'posted_at, last_seen_at, closes_at, quality_score, dedup_group_id, ' +
  'companies!inner(slug, name, logo_url, logo_color, logo_monogram)';

interface EmbeddedJobRow {
  companies: { slug: string; name: string; logo_url: string | null; logo_color: string | null; logo_monogram: string | null };
  [key: string]: unknown;
}

/**
 * Flattens PostgREST's embedded company back into the flat `job_card` shape, so one row
 * mapper serves both the RPC and the direct selects.
 */
function fromEmbedded(row: EmbeddedJobRow): JobCardRow {
  const company = row.companies;
  return {
    ...(row as unknown as JobCardRow),
    company_slug: company.slug,
    company_name: company.name,
    company_logo_url: company.logo_url,
    company_logo_color: company.logo_color,
    company_monogram: company.logo_monogram,
    page_cursor: null,
    rank: null,
  };
}

export async function fetchJob(id: string): Promise<JobEnvelope | null> {
  const { data, error } = await supabase.from('jobs').select(JOB_SELECT).eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? toEnvelope(fromEmbedded(data as unknown as EmbeddedJobRow)) : null;
}

/** Batch resolve. Used where a screen holds ids and no page that contains them. */
export async function fetchJobsByIds(ids: string[]): Promise<JobEnvelope[]> {
  if (ids.length === 0) return [];
  // PostgREST puts `in` filters in the URL, which has a length limit; 50 uuids is well
  // inside it and is more than any screen in the app holds.
  const { data, error } = await supabase.from('jobs').select(JOB_SELECT).in('id', ids.slice(0, 50));
  if (error) throw error;
  return ((data ?? []) as unknown as EmbeddedJobRow[]).map((row) => toEnvelope(fromEmbedded(row)));
}

const COMPANY_SELECT =
  'id, slug, name, domain, logo_url, logo_monogram, logo_color, industry, hq_location, ' +
  'description, follower_count, open_job_count';

export async function fetchCompany(slug: string): Promise<Company | null> {
  const { data, error } = await supabase.from('companies').select(COMPANY_SELECT).eq('slug', slug).maybeSingle();
  if (error) throw error;
  return data ? toCompany({ ...(data as unknown as CompanyCardRow), rank: null }) : null;
}

/**
 * The directory — PHASE1.md §8.7.
 *
 * Companies are a few hundred rows of small, shared, public data with no per-user
 * component, and three screens need to resolve one by slug without knowing in advance
 * which. Holding them client-side is the one place in this phase where a local collection
 * is still the right answer.
 */
export async function fetchCompanyDirectory(limit = 200): Promise<Company[]> {
  const { data, error } = await supabase
    .from('companies')
    .select(COMPANY_SELECT)
    .eq('is_active', true)
    .order('open_job_count', { ascending: false })
    .order('follower_count', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return ((data ?? []) as unknown as CompanyCardRow[]).map((row) => toCompany({ ...row, rank: null }));
}

/** Replaces the hardcoded `suggestedCompanyIds` array. */
export async function fetchSuggestedCompanies(limit = 12): Promise<Company[]> {
  const { data, error } = await supabase.rpc('suggested_companies', { p_limit: limit });
  if (error) throw error;
  return ((data ?? []) as CompanyCardRow[]).map(toCompany);
}

export async function searchJobs(query: string, cursor?: string | null, limit = PAGE_SIZE): Promise<Page<JobEnvelope>> {
  const { data, error } = await supabase.rpc('search_jobs', {
    p_query: query,
    p_limit: limit,
    p_cursor: cursor ?? undefined,
  });
  if (error) throw error;
  return pageOf((data ?? []) as JobCardRow[], limit, toEnvelope);
}

export async function searchCompanies(query: string, limit = 10): Promise<Company[]> {
  const { data, error } = await supabase.rpc('search_companies', { p_query: query, p_limit: limit });
  if (error) throw error;
  return ((data ?? []) as CompanyCardRow[]).map(toCompany);
}
