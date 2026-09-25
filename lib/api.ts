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
 *    travel separately, and in phase 2 they still arrive in separate calls: the feed is
 *    the same bytes for every reader, and `fetchViewerState()` says what this reader has
 *    done to them. Phase 1 predicted the server would fill `viewer` per row instead;
 *    PHASE2.md §3 argues why it should not, and the merge in `useJobFeeds` stays.
 *  - **Opaque cursors.** The server hands back a continuation token per row; the client
 *    passes the last one back and never looks inside. Keyset pagination is an
 *    implementation detail of the SQL, and phase 5 gets to change it.
 */

import { supabase } from '@/lib/supabase';
import { serviceFetch } from '@/lib/service';
import type {
  Application,
  ApplicationSource,
  ApplicationStatus,
  AppNotification,
  Company,
  CommentGate,
  EduChallenge,
  EmploymentType,
  Job,
  JobComment,
  LocationType,
  MatchScore,
  NotificationKind,
  ReportReason,
  Resume,
  ResumeEducation,
  ResumeExperience,
  ResumeParseStatus,
  ResumeSeniority,
  SalaryPeriod,
  Seniority,
  VerificationTier,
} from '@/types';

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

/**
 * `recommended` is phase 5's ranked feed; the other three are phase 1's explicit sorts.
 *
 * The split is the point. A reader who taps "Salary" has asked a question with a correct
 * answer and must get salary order — a ranker that quietly reorders an explicit sort is a
 * control that lies. Ranking is what the feed does when nobody has asked for anything
 * specific, which is the overwhelmingly common case and the one §5 is about.
 */
export type FeedSort = 'recommended' | 'recent' | 'salary' | 'company';

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

  /*
   * Phase 5, and the moment phase 1's decision B was written for.
   *
   * This module's own header promised that "opaque cursors" meant "keyset pagination is an
   * implementation detail of the SQL, and phase 5 gets to change it". It is changed: a
   * cursor into the ranked feed encodes a session and an offset rather than a sort value
   * and an id, and because no caller has ever looked inside one, nothing above this
   * function knows. `useJobFeed`, `useInfiniteQuery` and every screen are untouched.
   *
   * Note what did *not* happen. The header also predicted this was the point where these
   * functions would "start issuing `fetch` to `/v1/feed`", and they do not — PHASE5.md §2
   * argues why the ranker stays in Postgres. The seam was worth having anyway; it is the
   * reason changing the pagination model cost one branch.
   */
  if ((query.sort ?? 'recommended') === 'recommended' && !query.companySlugs?.length) {
    const ranked = await supabase.rpc('ranked_feed', {
      p_cursor: query.cursor ?? undefined,
      p_limit: limit,
      p_surface: 'reels',
    });
    if (ranked.error) throw ranked.error;
    return pageOf((ranked.data ?? []) as JobCardRow[], limit, toEnvelope);
  }

  const { data, error } = await supabase.rpc('feed_jobs', {
    p_sort: query.sort === 'recommended' ? 'recent' : (query.sort ?? 'recent'),
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

/* ── phase 2: what the viewer did ─────────────────────────────────────────────
 *
 * README §3.5, §3.6, §3.7. Everything above this line is the shared corpus; everything
 * below it belongs to one person.
 *
 * The split is the reason `JobEnvelope` has two halves. A feed page is identical for
 * every reader and can be cached as such; the viewer's relationship to those postings
 * arrives separately, from `fetchViewerState()`, and is merged client-side. §1.3(a) is
 * explicit that folding the two together is what makes a feed uncacheable, so `viewer`
 * on the envelope stays at its default here and the merge in `useJobFeeds` stays where
 * it is — it just reads server-backed sets now instead of in-memory ones.
 */

/** §3.5. `hide` and `not_interested` have no UI yet; the enum and the table have both. */
export type InteractionKind = 'like' | 'save' | 'hide' | 'not_interested';

/** §3.6. Which surface showed a card, for the impression log. */
export type FeedSurface = 'reels' | 'home' | 'search' | 'company' | 'collection' | 'story';

/**
 * The viewer's half of the envelope, as sets rather than per-row flags.
 *
 * One read per session covering every posting the viewer has touched, instead of three
 * joins on every feed page. It is the same shape `CareerDeckContext` held in memory
 * through phase 1, which is why nothing downstream of it changes.
 */
export interface ViewerSets {
  likedJobIds: string[];
  savedJobIds: string[];
  hiddenJobIds: string[];
  /** Database uuids — what `company_follows` keys on. */
  followedCompanyIds: string[];
  /** The same follows as slugs, which is what routes and the Following feed filter use. */
  followedCompanySlugs: string[];
  /**
   * Phase 3. §1.3(b): "store the true count; send `viewerHasLiked` separately" — this is the
   * separately. The stored `like_count` on a comment is now the real total, and whether *this*
   * reader is one of them rides here with the rest of their relationship graph.
   */
  likedCommentIds: string[];
}

export const EMPTY_VIEWER_SETS: ViewerSets = {
  likedJobIds: [],
  savedJobIds: [],
  hiddenJobIds: [],
  followedCompanyIds: [],
  followedCompanySlugs: [],
  likedCommentIds: [],
};

interface ViewerSetsRow {
  liked_job_ids: string[] | null;
  saved_job_ids: string[] | null;
  hidden_job_ids: string[] | null;
  followed_company_ids: string[] | null;
  followed_company_slugs: string[] | null;
  liked_comment_ids: string[] | null;
}

export async function fetchViewerState(): Promise<ViewerSets> {
  const { data, error } = await supabase.rpc('viewer_state');
  if (error) throw error;

  /*
   * PostgREST returns a function that yields one composite as a single JSON object, and a
   * `setof` one as an array. `viewer_state()` is the former — but reading the wrong shape
   * here fails *silently*: every field comes back undefined, the `?? []` below turns that
   * into empty sets, and the app renders as though the user has never saved anything.
   * A wrong-but-plausible empty state is the worst failure mode there is, so both shapes
   * are accepted.
   */
  const row = (Array.isArray(data) ? data[0] : data) as ViewerSetsRow | null | undefined;
  if (!row) return EMPTY_VIEWER_SETS;

  return {
    likedJobIds: row.liked_job_ids ?? [],
    savedJobIds: row.saved_job_ids ?? [],
    hiddenJobIds: row.hidden_job_ids ?? [],
    followedCompanyIds: row.followed_company_ids ?? [],
    followedCompanySlugs: row.followed_company_slugs ?? [],
    likedCommentIds: row.liked_comment_ids ?? [],
  };
}

/**
 * Sets a like/save/hide to a state. Never flips what is there.
 *
 * §11: toggles are PUT/DELETE rather than POST /toggle so a retry cannot invert the
 * result. That is not pedantry here — `lib/outbox.ts` replays these after a reconnect,
 * and a replay is a retry wearing a different hat. Returns the state the database ended
 * up in, which is what the caller should believe over its own optimistic guess.
 */
export async function setJobInteraction(
  jobId: string,
  kind: InteractionKind,
  on: boolean,
): Promise<boolean> {
  const { data, error } = await supabase.rpc('set_job_interaction', {
    p_job_id: jobId,
    p_kind: kind,
    p_on: on,
  });
  if (error) throw error;
  return data === true;
}

/** The same contract for follows, keyed by slug because that is what every caller holds. */
export async function setCompanyFollow(companySlug: string, on: boolean): Promise<boolean> {
  const { data, error } = await supabase.rpc('set_company_follow', {
    p_company_slug: companySlug,
    p_on: on,
  });
  if (error) throw error;
  return data === true;
}

interface ApplicationRow {
  id: string;
  job_id: string;
  status: ApplicationStatus;
  source: ApplicationSource;
  applied_at: string;
  status_changed_at: string;
  self_reported: boolean;
}

const APPLICATION_SELECT = 'id, job_id, status, source, applied_at, status_changed_at, self_reported';

function toApplication(row: ApplicationRow): Application {
  return {
    id: row.id,
    jobId: row.job_id,
    status: row.status,
    source: row.source,
    appliedAt: row.applied_at,
    // The UI's "last activity" is the stage change, not the row's last write — a note
    // edit should not push an application back to the top of the tracker.
    updatedAt: row.status_changed_at.slice(0, 10),
    selfReported: row.self_reported,
  };
}

/**
 * The whole tracker, not a page of it.
 *
 * §11 says as much — "full list; client sorts and derives the goal" — and the weekly
 * goal in `useWeeklyGoal` needs every row to count streak weeks backwards. A student
 * with three hundred applications is having a rough season and is still two pages of
 * uuids.
 */
export async function fetchApplications(): Promise<Application[]> {
  const { data, error } = await supabase
    .from('applications')
    .select(APPLICATION_SELECT)
    .order('status_changed_at', { ascending: false });

  if (error) throw error;
  return ((data ?? []) as ApplicationRow[]).map(toApplication);
}

export interface NewApplication {
  jobId: string;
  source: ApplicationSource;
  /** `YYYY-MM-DD`, in the user's own timezone — the week the goal counts it towards. */
  appliedAt: string;
}

/**
 * Tracks an application.
 *
 * `user_id` is not sent: it defaults to `auth.uid()` and the insert grant does not
 * include the column, so a client cannot author a row for anyone else. Re-tracking a job
 * that is already in the tracker hits `unique (user_id, job_id)` — the row that comes
 * back is the existing one, because telling us twice is not applying twice.
 */
export async function createApplication(input: NewApplication): Promise<Application> {
  const { data, error } = await supabase
    .from('applications')
    .insert({ job_id: input.jobId, source: input.source, applied_at: input.appliedAt })
    .select(APPLICATION_SELECT)
    .maybeSingle();

  // 23505 is the unique violation: the application is already tracked, which is the
  // state the caller wanted. Read it back rather than surfacing an error for a no-op
  // the user cannot tell apart from success.
  if (error && error.code === '23505') {
    const existing = await supabase
      .from('applications')
      .select(APPLICATION_SELECT)
      .eq('job_id', input.jobId)
      .maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data) return toApplication(existing.data as ApplicationRow);
  }

  if (error) throw error;
  if (!data) throw new Error('The application was written but could not be read back.');
  return toApplication(data as ApplicationRow);
}

/**
 * Moves an application to a stage, keyed by **job** rather than by application id.
 *
 * `unique (user_id, job_id)` makes the job the natural key for the viewer's application,
 * and using it here is what lets the outbox queue "track this" and "move it to interview"
 * back to back while offline: the second operation does not need the id the first one has
 * not been given yet.
 */
export async function setApplicationStatus(
  jobId: string,
  status: ApplicationStatus,
): Promise<Application | null> {
  const { data, error } = await supabase
    .from('applications')
    .update({ status })
    .eq('job_id', jobId)
    .select(APPLICATION_SELECT)
    .maybeSingle();

  if (error) throw error;
  return data ? toApplication(data as ApplicationRow) : null;
}

/** One card, shown once, on one surface. §3.6. */
export interface ImpressionEvent {
  jobId: string;
  surface: FeedSurface;
  /** One per app launch. Makes "impressions per session" answerable. */
  sessionId: string;
  /** Rank within the feed when it was shown. */
  position: number | null;
  /** Reels only: how long the card was the active page. */
  dwellMs: number | null;
  /** Scrolled past (true) vs. bounced back (false). Null where the surface cannot tell. */
  completed: boolean | null;
  /** ISO timestamp of when it was *shown*, not of when the batch was flushed. */
  shownAt: string;
}

/**
 * One insert for a whole batch — §3.6's `POST /v1/events`.
 *
 * "At 50k DAU and ~60 cards a session this is ~3M rows/day — entirely fine for
 * partitioned Postgres, catastrophic as 3M HTTP requests."
 *
 * Returns how many rows the database actually wrote, which can be fewer than were sent:
 * `log_impressions` drops malformed rows and caps a batch at 200 rather than failing the
 * call, because a bad impression is worth losing and a failing queue is not.
 */
export async function logImpressions(events: ImpressionEvent[]): Promise<number> {
  if (events.length === 0) return 0;

  const { data, error } = await supabase.rpc('log_impressions', {
    p_rows: events.map((event) => ({
      job_id: event.jobId,
      surface: event.surface,
      session_id: event.sessionId,
      position: event.position,
      dwell_ms: event.dwellMs,
      completed: event.completed,
      shown_at: event.shownAt,
    })),
  });

  if (error) throw error;
  return typeof data === 'number' ? data : 0;
}

/* ── phase 3: what the viewer said ─────────────────────────────────────────────
 *
 * README §3.2, §3.8, §10. Two things distinguish this section from everything above it.
 *
 * **Some of it does not go to Postgres.** Posting a comment and verifying an address both pass
 * through `server/` — one needs a moderation classifier, the other an email provider, and both
 * need a secret. Those calls go through `lib/service.ts`; everything else here is still a Supabase
 * RPC, because everything else is still expressible in RLS. The split is visible in this file on
 * purpose: `postComment` can fail in ways `fetchJobComments` cannot.
 *
 * **Nothing here can carry an author's identity.** `comment_card` has no `author_id` and the
 * database has no grant that would produce one, so these types have nowhere to put it. Blocking
 * and reporting therefore take a *comment* id and resolve the author server-side, which reads like
 * a workaround and is actually the contract holding.
 */

/** Matches the `comment_card` composite in the phase 3 migration. */
interface CommentCardRow {
  id: string;
  job_id: string;
  parent_id: string | null;
  body: string;
  gif_id: string | null;
  like_count: number;
  reply_count: number;
  created_at: string;
  edited_at: string | null;
  author_handle: string;
  author_badge: string | null;
  author_color: string;
  is_own: boolean;
  page_cursor: string | null;
}

function toComment(row: CommentCardRow): JobComment {
  return {
    id: row.id,
    jobId: row.job_id,
    parentId: row.parent_id,
    authorHandle: row.author_handle,
    authorBadge: row.author_badge,
    authorColor: row.author_color,
    isYou: row.is_own,
    body: row.body,
    ...(row.gif_id === null ? {} : { gifId: row.gif_id }),
    createdAt: row.created_at,
    editedAt: row.edited_at,
    // Straight through, not adjusted. §1.3(b): this is the true total and the viewer's own like
    // arrives in `ViewerSets.likedCommentIds`. Phase 2 added one here against a fixture; doing
    // that against a real count is the double-count §1.3(b) warned about.
    likeCount: row.like_count,
    replyCount: row.reply_count,
  };
}

/** Roots only, newest first. The sheet fetches a thread's replies when it is opened. */
export async function fetchJobComments(
  jobId: string,
  cursor?: string | null,
  limit = 20,
): Promise<Page<JobComment>> {
  const { data, error } = await supabase.rpc('job_comments', {
    p_job_id: jobId,
    p_cursor: cursor ?? undefined,
    p_limit: limit,
  });

  if (error) throw error;
  const rows = (data ?? []) as CommentCardRow[];

  return {
    items: rows.map(toComment),
    nextCursor: rows.length < limit ? null : (rows[rows.length - 1]?.page_cursor ?? null),
  };
}

export async function fetchCommentReplies(commentId: string): Promise<JobComment[]> {
  const { data, error } = await supabase.rpc('comment_replies', { p_comment_id: commentId });
  if (error) throw error;
  return ((data ?? []) as CommentCardRow[]).map(toComment);
}

/**
 * Comment totals for the postings a screen is holding.
 *
 * Deliberately **not** a field on `job_card`. A counter that changes every few seconds inside a
 * feed page would make that page per-reader and uncacheable — phase 2 spent a section on why that
 * matters — and it would do it for a number nobody is reading while they scroll. So the volatile
 * counter travels separately, on the same principle as viewer state. PHASE3.md §3.
 */
export async function fetchCommentCounts(jobIds: string[]): Promise<Map<string, number>> {
  if (jobIds.length === 0) return new Map();

  const { data, error } = await supabase.rpc('comment_counts', { p_job_ids: jobIds.slice(0, 200) });
  if (error) throw error;

  const counts = new Map<string, number>();
  for (const row of (data ?? []) as { job_id: string; comment_count: number }[]) {
    counts.set(row.job_id, row.comment_count);
  }
  return counts;
}

interface CommentGateRow {
  can_comment: boolean | null;
  tier: VerificationTier | null;
  handle: string | null;
  badge: string | null;
  policy_version: string | null;
  policy_accepted: boolean | null;
  muted_until: string | null;
  banned: boolean | null;
  remaining_hour: number | null;
  remaining_day: number | null;
}

export const CLOSED_GATE: CommentGate = {
  canComment: false,
  tier: 'none',
  handle: null,
  badge: null,
  policyVersion: null,
  policyAccepted: false,
  mutedUntil: null,
  banned: false,
  remainingHour: 0,
  remainingDay: 0,
};

export async function fetchCommentGate(): Promise<CommentGate> {
  const { data, error } = await supabase.rpc('comment_gate');
  if (error) throw error;

  // Same defensive shape-handling as `fetchViewerState`: a composite comes back as an object, and
  // reading the wrong shape here would silently close the composer for everybody.
  const row = (Array.isArray(data) ? data[0] : data) as CommentGateRow | null | undefined;
  if (!row) return CLOSED_GATE;

  return {
    canComment: row.can_comment === true,
    tier: row.tier ?? 'none',
    handle: row.handle,
    badge: row.badge,
    policyVersion: row.policy_version,
    policyAccepted: row.policy_accepted === true,
    mutedUntil: row.muted_until,
    banned: row.banned === true,
    remainingHour: row.remaining_hour ?? 0,
    remainingDay: row.remaining_day ?? 0,
  };
}

export interface NewComment {
  jobId: string;
  body: string;
  parentId?: string | null;
  gifId?: string | null;
  /**
   * Makes a retried POST return the existing comment instead of writing a second one.
   *
   * Every write phase 2 added was idempotent by construction — a toggle sets a state. This one
   * appends, so idempotency has to be carried, and the client is the only place that knows two
   * attempts were the same attempt.
   */
  idempotencyKey: string;
}

/**
 * Posts a comment, through the API service.
 *
 * The one write in the app that does not go to Postgres directly and is not queued in the outbox.
 * PHASE3.md §5 has the argument: a comment the classifier will refuse must fail in front of the
 * person who wrote it, while they can still edit it — queueing it would mean telling them it
 * posted, and then quietly dropping it an hour later when the outbox gave up.
 *
 * Throws `ServiceError` with a `code` the composer branches on: `not_verified`,
 * `policy_not_accepted`, `rate_limited`, `rejected`, `blocked`, `offline`.
 */
export async function postComment(input: NewComment): Promise<JobComment> {
  const { comment } = await serviceFetch<{ comment: CommentCardRow }>('/v1/comments', {
    body: {
      jobId: input.jobId,
      body: input.body,
      parentId: input.parentId ?? null,
      gifId: input.gifId ?? null,
      idempotencyKey: input.idempotencyKey,
    },
    // Longer than a read, because the classifier is in the path by design.
    timeoutMs: 20_000,
  });

  return toComment(comment);
}

/** Sets a comment like to a state. Phase 2's contract, so the outbox can replay it safely. */
export async function setCommentLike(commentId: string, on: boolean): Promise<boolean> {
  const { data, error } = await supabase.rpc('set_comment_like', {
    p_comment_id: commentId,
    p_on: on,
  });
  if (error) throw error;
  return data === true;
}

/** Soft-deletes the viewer's own comment and everything replying to it. */
export async function deleteOwnComment(commentId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('delete_own_comment', { p_comment_id: commentId });
  if (error) throw error;
  return data === true;
}

/**
 * Reports a comment, or the account behind it.
 *
 * Keyed by the comment either way — including when the target is the account, because the client
 * holds no account identifier and never will. §3.8.
 */
export async function reportComment(
  commentId: string,
  reason: ReportReason,
  detail?: string,
  target: 'comment' | 'profile' = 'comment',
): Promise<string> {
  const { data, error } = await supabase.rpc('report_content', {
    p_comment_id: commentId,
    p_reason: reason,
    p_detail: detail ?? undefined,
    p_target: target,
  });
  if (error) throw error;
  return data as string;
}

/** Blocks or unblocks the author of a comment. Two-directional in effect — see the migration. */
export async function setBlockFromComment(commentId: string, on: boolean): Promise<boolean> {
  const { data, error } = await supabase.rpc('set_block_from_comment', {
    p_comment_id: commentId,
    p_on: on,
  });
  if (error) throw error;
  return data === true;
}

/** Records that this account was shown, and accepted, a version of the content policy. §10. */
export async function acceptContentPolicy(version: string): Promise<string> {
  const { data, error } = await supabase.rpc('accept_content_policy', { p_version: version });
  if (error) throw error;
  return data as string;
}

// ── notifications ──────────────────────────────────────────────────────────────

interface NotificationRow {
  id: string;
  kind: NotificationKind;
  subject_type: string | null;
  subject_id: string | null;
  aggregate_count: number;
  payload: Record<string, unknown> | null;
  read_at: string | null;
  created_at: string;
}

function text(payload: Record<string, unknown> | null, key: string): string | null {
  const value = payload?.[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function toNotification(row: NotificationRow): AppNotification {
  return {
    id: row.id,
    kind: row.kind,
    subjectId: row.subject_id,
    aggregateCount: row.aggregate_count,
    createdAt: row.created_at,
    read: row.read_at !== null,
    jobId: text(row.payload, 'job_id'),
    actorHandle: text(row.payload, 'actor_handle'),
    actorColor: text(row.payload, 'actor_color'),
    yourComment: text(row.payload, 'your_comment'),
    replyBody: text(row.payload, 'reply_body'),
    headline: text(row.payload, 'headline'),
    detail: text(row.payload, 'detail'),
  };
}

/**
 * The whole inbox, newest first.
 *
 * Read from `notifications_public`, which is the view that drops `actor_id` — so this function
 * *cannot* return who liked your comment even if a future caller asked it to. Capped rather than
 * paginated: an inbox nobody has scrolled to the bottom of does not need a cursor, and the cap is
 * two hundred rows of small JSON.
 */
export async function fetchNotifications(limit = 200): Promise<AppNotification[]> {
  const { data, error } = await supabase
    .from('notifications_public')
    .select('id, kind, subject_type, subject_id, aggregate_count, payload, read_at, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return ((data ?? []) as NotificationRow[]).map(toNotification);
}

/**
 * Marks specific notifications read, or every unread one when passed nothing.
 *
 * The key is omitted rather than sent as null for "everything", which is the same convention
 * `fetchFeed` uses for its optional arguments and for the same reason: omitting it lets the SQL
 * apply its own default, and the generated types model a defaulted argument as optional-and-not-null.
 */
export async function markNotificationsRead(ids?: string[]): Promise<number> {
  const { data, error } = await supabase.rpc(
    'mark_notifications_read',
    // `undefined` for "everything", so Postgres applies the parameter's own default. The generated
    // types model a defaulted argument as optional-and-not-null, which is the check that keeps this
    // call site honest about the function's signature.
    ids && ids.length > 0 ? { p_ids: ids } : undefined,
  );
  if (error) throw error;
  return typeof data === 'number' ? data : 0;
}

// ── verification ───────────────────────────────────────────────────────────────

/**
 * Starts the `.edu` path. Through the service, because a code has to be emailed.
 *
 * Throws `ServiceError` with `domain_not_recognised` when no school owns the domain — which is not
 * a failure the user can fix by retyping, and is the moment to offer the ID path instead. §3.2 is
 * explicit that the two are siblings, and this is where that matters in the UI.
 */
export async function startEduVerification(email: string): Promise<EduChallenge> {
  return serviceFetch<EduChallenge>('/v1/verify/edu/start', { body: { email } });
}

export async function confirmEduVerification(
  code: string,
): Promise<{ school: string; badge: string | null }> {
  return serviceFetch<{ school: string; badge: string | null }>('/v1/verify/edu/confirm', {
    body: { code },
  });
}

/** Hands back the vendor's hosted inquiry URL. The document never touches CareerDeck. §3.2. */
export async function startIdentityVerification(): Promise<{ url: string; provider: string }> {
  return serviceFetch<{ url: string; provider: string }>('/v1/verify/identity/start', { body: {} });
}

interface VerificationRow {
  kind: 'edu_email' | 'government_id';
  status: 'pending' | 'verified' | 'failed' | 'expired';
  edu_email: string | null;
  expires_at: string | null;
}

/**
 * The account's verification state, read straight from Postgres.
 *
 * Note what the select list does *not* ask for: `token_hash`, `provider_ref`, `provider_result`.
 * The column grant would refuse them, and naming them here would turn a deliberate restriction
 * into a runtime error somebody debugs for an afternoon.
 */
export async function fetchVerifications(): Promise<{
  eduExpiresAt: string | null;
  pendingEduEmail: string | null;
}> {
  const { data, error } = await supabase
    .from('verifications')
    .select('kind, status, edu_email, expires_at')
    .order('created_at', { ascending: false });

  if (error) throw error;
  const rows = (data ?? []) as VerificationRow[];

  const verifiedEdu = rows.find((row) => row.kind === 'edu_email' && row.status === 'verified');
  const pendingEdu = rows.find((row) => row.kind === 'edu_email' && row.status === 'pending');

  return {
    eduExpiresAt: verifiedEdu?.expires_at ?? null,
    pendingEduEmail: pendingEdu?.edu_email ?? null,
  };
}

// ── resumes and matching (phase 4) ─────────────────────────────────────────────

/**
 * Matches the `resume_card` composite in the phase 4 migration.
 *
 * No `storage_path`, and that is not an oversight the way a missing field usually is: the
 * function does not return one. The client never addresses the object — it cannot read it
 * anyway, since the bucket grants `select` to nobody — and a path it does not hold is a path it
 * cannot put in a log, a crash report or a deep link. PHASE4.md §4.2.
 */
interface ResumeCardRow {
  id: string;
  name: string;
  focus: string | null;
  file_size: number | null;
  page_count: number | null;
  is_default: boolean;
  parse_status: ResumeParseStatus;
  parse_error: string | null;
  skills: string[] | null;
  education: ResumeEducation[] | null;
  experience: ResumeExperience[] | null;
  years_experience: number | string | null;
  location: string | null;
  seniority: ResumeSeniority | null;
  parsed_at: string | null;
  user_confirmed_at: string | null;
  created_at: string;
  updated_at: string;
}

function toResume(row: ResumeCardRow): Resume {
  return {
    id: row.id,
    name: row.name,
    focus: row.focus,
    fileSize: row.file_size,
    pageCount: row.page_count,
    isDefault: row.is_default,
    parseStatus: row.parse_status,
    parseError: row.parse_error,
    profile: {
      skills: row.skills ?? [],
      education: row.education ?? [],
      experience: row.experience ?? [],
      // `numeric` arrives as a string over PostgREST — the same care `toNumber` takes for salary.
      yearsExperience: toNumber(row.years_experience),
      location: row.location,
      seniority: row.seniority,
      parsedAt: row.parsed_at,
      confirmedAt: row.user_confirmed_at,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** This account's resumes, default first. One call; there is no pagination and never will be. */
export async function fetchResumes(): Promise<Resume[]> {
  const { data, error } = await supabase.rpc('my_resumes');
  if (error) throw error;
  return ((data ?? []) as ResumeCardRow[]).map(toResume);
}

interface MatchScoreRow {
  job_id: string;
  score: number;
  components: Record<string, number> | null;
  computed_at: string;
}

/**
 * Match scores for the postings on screen — §3.10.
 *
 * Deliberately shaped like `fetchCommentCounts` above, because it is the same decision one
 * phase later: a score is per-reader and changes when the resume changes, so folding it into
 * `job_card` would make every feed page uncacheable for a number in one corner of one card.
 * PHASE3.md's decision D, applied again.
 *
 * Note this read *writes* — `match_scores()` computes and caches whatever it does not already
 * hold. An empty map is the honest answer for a user with no parsed default resume, and the
 * ring is hidden rather than drawn at zero.
 */
export async function fetchMatchScores(jobIds: string[]): Promise<Map<string, MatchScore>> {
  if (jobIds.length === 0) return new Map();

  const { data, error } = await supabase.rpc('match_scores', { p_job_ids: jobIds.slice(0, 200) });
  if (error) throw error;

  const scores = new Map<string, MatchScore>();
  for (const row of (data ?? []) as MatchScoreRow[]) {
    const { coverage, ...components } = row.components ?? {};
    scores.set(row.job_id, {
      score: row.score,
      components,
      coverage: typeof coverage === 'number' ? coverage : 1,
      computedAt: row.computed_at,
    });
  }
  return scores;
}

/**
 * Registers an uploaded object as a resume.
 *
 * Two steps, and the upload is the other one: the client puts the bytes in the bucket under its
 * own folder (the one thing storage RLS lets it do) and then calls this. A multi-megabyte body
 * has no business travelling through a Postgres function, and a failed upload this way leaves
 * no row — an orphaned object is collected by the retention sweep, whereas a row pointing at
 * nothing is a resume the shelf will offer to open.
 */
export async function registerResume(input: {
  name: string;
  storagePath: string;
  fileSize?: number;
  contentHash?: string;
  focus?: string;
}): Promise<Resume> {
  const { data, error } = await supabase.rpc('register_resume', {
    p_name: input.name,
    p_storage_path: input.storagePath,
    /*
     * `?? undefined` rather than `?? null` throughout: these arguments have SQL defaults, and
     * the generated types make a defaulted argument optional rather than nullable. Sending an
     * explicit null would also work in Postgres — it is the same value — but it would not
     * typecheck, and the generated file is the contract.
     */
    p_file_size: input.fileSize ?? undefined,
    p_content_hash: input.contentHash ?? undefined,
    p_focus: input.focus ?? undefined,
  });
  if (error) throw error;
  return toResume(data as ResumeCardRow);
}

/** §3.9's database invariant, exercised. Invalidates every cached score on the way through. */
export async function setDefaultResume(resumeId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('set_default_resume', { p_resume_id: resumeId });
  if (error) throw error;
  return data === true;
}

/**
 * The parse-confirmation screen's write — §3.9's `user_confirmed_at`.
 *
 * Only the four fields the matcher reads. Name, email and phone are sealed at parse time and
 * this phase never opens them: confirming a fact the user already knows is not worth a
 * decryption, a log row and a plaintext P0 field on the wire. PHASE4.md §4.4.
 */
export async function confirmResumeProfile(
  resumeId: string,
  edits: {
    skills?: string[];
    seniority?: ResumeSeniority | null;
    yearsExperience?: number | null;
    location?: string | null;
  },
): Promise<Resume> {
  const { data, error } = await supabase.rpc('confirm_resume_profile', {
    p_resume_id: resumeId,
    p_skills: edits.skills ?? undefined,
    p_seniority: edits.seniority ?? undefined,
    p_years: edits.yearsExperience ?? undefined,
    p_location: edits.location ?? undefined,
  });
  if (error) throw error;
  return toResume(data as ResumeCardRow);
}

/** Soft delete. The object survives the §13.2 grace period before the sweep destroys it. */
export async function deleteResume(resumeId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('delete_resume', { p_resume_id: resumeId });
  if (error) throw error;
  return data === true;
}

/** 128 bits of hex. Enough to name an object; this is not a security boundary. */
function randomObjectId(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Uploads the bytes, then registers them.
 *
 * The object key is `{user_id}/{uuid}.pdf` because the storage policy matches on the first path
 * segment — Supabase storage has no owner column, so the owner has to be in the key, and the
 * table's own check constraint says the same thing a second time.
 */
export async function uploadResume(input: {
  name: string;
  bytes: ArrayBuffer;
  focus?: string;
}): Promise<Resume> {
  const { data: session } = await supabase.auth.getUser();
  const userId = session.user?.id;
  if (!userId) throw new Error('Not signed in.');

  const objectName = `${userId}/${randomObjectId()}.pdf`;

  const upload = await supabase.storage.from('resumes').upload(objectName, input.bytes, {
    contentType: 'application/pdf',
    upsert: false,
  });
  if (upload.error) throw upload.error;

  try {
    return await registerResume({
      name: input.name,
      storagePath: objectName,
      fileSize: input.bytes.byteLength,
      focus: input.focus,
    });
  } catch (error) {
    /*
     * The row is what makes the object reachable, so a failed registration leaves an object
     * nothing will ever look at. The retention sweep would collect it eventually, but the cap
     * inside `register_resume` counts rows and the user's next attempt should not be charged
     * for this one — so it goes now. Storage grants the owner `delete` precisely so this works
     * without the service.
     */
    await supabase.storage.from('resumes').remove([objectName]).catch(() => undefined);
    throw error;
  }
}

/**
 * A short-lived signed URL for the user's own resume, issued by the API service.
 *
 * This is the one read in the app that could have gone straight to Supabase and deliberately
 * does not. §3.9 requires every read of a resume to be logged, and a client that signs its own
 * URL logs nothing — so the bucket grants `select` to nobody and this call writes a
 * `pii_access_log` row before it signs. PHASE4.md §4.2.
 */
export async function fetchResumeUrl(resumeId: string): Promise<string> {
  const response = await serviceFetch<{ url: string }>(`/v1/resumes/${resumeId}/url`, {
    method: 'GET',
  });
  return response.url;
}

/**
 * Asks the service to read the PDF.
 *
 * Slow by the standards of everything else in this file — it is a model reading several
 * rendered pages — so the timeout is generous and the caller shows a progress state. The
 * resume's own `parse_status` carries the outcome regardless, which is what lets this move to
 * a worker later without the client changing.
 */
export async function parseResume(resumeId: string): Promise<void> {
  await serviceFetch(`/v1/resumes/${resumeId}/parse`, { method: 'POST', timeoutMs: 120_000 });
}
