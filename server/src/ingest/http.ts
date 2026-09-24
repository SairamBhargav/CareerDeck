/**
 * The only place in the pipeline that touches the network — and the only place that can.
 *
 * docs/README.md §4.3 calls crawl hygiene "the legal posture, not politeness". Every rule
 * in that section is enforced here rather than left to each adapter, because a rule that
 * three adapters have to remember is a rule that the fourth one breaks:
 *
 *   - we identify ourselves, with a contact URL;
 *   - we never send a credential, because there is none in this module to send;
 *   - we honour robots.txt, cached per host;
 *   - we cap concurrency per host and keep a minimum gap between requests to one host;
 *   - we back off on 429 and 5xx, honouring Retry-After;
 *   - we send conditional requests so an unchanged board costs the other side a 304.
 */

const DEFAULT_CONTACT = 'https://github.com/careerdeck/careerdeck';

/**
 * §4.3: "Identify yourself in User-Agent with a contact URL."
 *
 * The contact is configurable because it should eventually be a page that explains who
 * we are and how to get us to stop. Until CareerDeck has a domain it points at the repo,
 * which is still a real answer to "who is this and how do I reach them" — an anonymous
 * crawler is the thing §4.3 is warning against.
 */
export const USER_AGENT = `CareerDeckBot/0.1 (+${process.env.CRAWLER_CONTACT_URL ?? DEFAULT_CONTACT})`;

/** Requests in flight to one host. Boards are big; parallelism buys little and costs goodwill. */
const MAX_CONCURRENCY_PER_HOST = 2;
/** Minimum gap between two requests to the same host, unless robots.txt asks for more. */
const MIN_GAP_MS = 700;
const REQUEST_TIMEOUT_MS = 45_000;
const MAX_ATTEMPTS = 4;

export interface FetchResult {
  status: number;
  /** Null on 304 — the caller already has this content and should stop. */
  body: string | null;
  etag: string | null;
  lastModified: string | null;
}

export class HttpError extends Error {
  // Assigned in the body rather than declared as a parameter property: Node runs these
  // files by stripping types, and strip-only mode cannot erase a `readonly status: number`
  // in a constructor signature — it would have to emit an assignment, which it does not do.
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

export class RobotsDisallowedError extends Error {
  constructor(url: string) {
    super(`robots.txt disallows ${url}`);
    this.name = 'RobotsDisallowedError';
  }
}

// ── per-host pacing ────────────────────────────────────────────────────────────

interface HostState {
  active: number;
  /** Earliest time the next request to this host may start. */
  nextAllowedAt: number;
  /** Crawl-delay from robots.txt, if it asked for one. */
  minGapMs: number;
  queue: (() => void)[];
}

const hosts = new Map<string, HostState>();

function hostState(host: string): HostState {
  let state = hosts.get(host);
  if (!state) {
    state = { active: 0, nextAllowedAt: 0, minGapMs: MIN_GAP_MS, queue: [] };
    hosts.set(host, state);
  }
  return state;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs `task` under this host's concurrency cap and spacing.
 *
 * The slot is released in a `finally`, so a throwing task cannot wedge the host — the
 * failure mode where one bad board stalls every other board behind it and the run looks
 * like a hang rather than an error.
 */
async function withHostSlot<T>(host: string, task: () => Promise<T>): Promise<T> {
  const state = hostState(host);

  if (state.active >= MAX_CONCURRENCY_PER_HOST) {
    await new Promise<void>((resolve) => state.queue.push(resolve));
  }
  state.active += 1;

  try {
    const wait = state.nextAllowedAt - Date.now();
    if (wait > 0) await sleep(wait);
    state.nextAllowedAt = Date.now() + state.minGapMs;
    return await task();
  } finally {
    state.active -= 1;
    state.queue.shift()?.();
  }
}

// ── robots.txt ─────────────────────────────────────────────────────────────────

interface RobotsRules {
  disallow: string[];
  allow: string[];
  crawlDelayMs: number | null;
}

const robotsCache = new Map<string, Promise<RobotsRules | null>>();

/**
 * A deliberately small robots.txt reader: the `User-agent: *` group's Allow, Disallow and
 * Crawl-delay, and nothing else.
 *
 * It does not implement the full specification, and it errs toward *not* fetching when it
 * is unsure — the failure that matters is crawling something we were asked not to, not
 * skipping something we could have had. A host that does not serve robots.txt, or serves
 * something unparseable, is treated as unrestricted, which is what the standard says.
 */
function parseRobots(text: string): RobotsRules {
  const rules: RobotsRules = { disallow: [], allow: [], crawlDelayMs: null };
  let inStarGroup = false;
  let sawAnyGroup = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.split('#')[0]?.trim() ?? '';
    if (line === '') continue;

    const separator = line.indexOf(':');
    if (separator === -1) continue;

    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (field === 'user-agent') {
      // Consecutive User-agent lines share one group of rules, so a `*` anywhere in the
      // run puts us in it. A new group after rules have started ends the previous one.
      if (sawAnyGroup) {
        inStarGroup = value === '*';
        sawAnyGroup = false;
      } else {
        inStarGroup = inStarGroup || value === '*';
      }
      continue;
    }

    if (!inStarGroup) continue;
    sawAnyGroup = true;

    if (field === 'disallow' && value !== '') rules.disallow.push(value);
    else if (field === 'allow' && value !== '') rules.allow.push(value);
    else if (field === 'crawl-delay') {
      const seconds = Number.parseFloat(value);
      if (Number.isFinite(seconds) && seconds > 0) rules.crawlDelayMs = seconds * 1000;
    }
  }

  return rules;
}

async function robotsFor(origin: string): Promise<RobotsRules | null> {
  const cached = robotsCache.get(origin);
  if (cached) return cached;

  const pending = (async (): Promise<RobotsRules | null> => {
    try {
      const response = await fetch(`${origin}/robots.txt`, {
        headers: { 'user-agent': USER_AGENT },
        signal: AbortSignal.timeout(10_000),
      });
      // 404 is the common and correct answer for "no restrictions".
      if (!response.ok) return null;
      return parseRobots(await response.text());
    } catch {
      // A host that will not serve robots.txt has not told us to stay out. Treating a
      // network blip as a blanket ban would disable the crawler on a bad wifi moment.
      return null;
    }
  })();

  robotsCache.set(origin, pending);
  return pending;
}

/** Longest-match wins, Allow beats Disallow at equal length — the de-facto standard. */
function isAllowed(rules: RobotsRules, path: string): boolean {
  const match = (patterns: string[]) =>
    patterns.reduce((longest, pattern) => (path.startsWith(pattern) ? Math.max(longest, pattern.length) : longest), -1);

  const disallowed = match(rules.disallow);
  if (disallowed === -1) return true;
  return match(rules.allow) >= disallowed;
}

// ── the fetch itself ───────────────────────────────────────────────────────────

function retryAfterMs(header: string | null, attempt: number): number {
  // Exponential backoff with jitter, unless the server named a delay — in which case it
  // gets what it asked for. Jitter matters because ~80 of our boards share one hostname
  // and a fixed backoff would retry all of them in the same instant.
  const backoff = Math.min(2 ** attempt * 1000, 30_000) + Math.random() * 500;
  if (!header) return backoff;

  const seconds = Number.parseInt(header, 10);
  if (Number.isFinite(seconds)) return Math.max(seconds * 1000, backoff);

  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(date - Date.now(), backoff) : backoff;
}

export interface ConditionalRequest {
  url: string;
  headers?: Record<string, string>;
  /** From job_sources.etag. An unchanged board answers 304 and costs nobody anything. */
  etag?: string | null;
  method?: 'GET' | 'POST';
  body?: string;
}

/**
 * One polite, conditional, backed-off request.
 *
 * Returns rather than throws on 304 (`body: null`), because "nothing changed" is the
 * expected outcome of most crawls and not an error. Throws `HttpError` on a status we
 * cannot use, after exhausting retries.
 */
export async function politeFetch(request: ConditionalRequest): Promise<FetchResult> {
  const url = new URL(request.url);
  const rules = await robotsFor(url.origin);

  if (rules) {
    if (!isAllowed(rules, url.pathname)) throw new RobotsDisallowedError(request.url);
    if (rules.crawlDelayMs !== null) {
      const state = hostState(url.host);
      state.minGapMs = Math.max(state.minGapMs, rules.crawlDelayMs);
    }
  }

  return withHostSlot(url.host, async () => {
    let lastError: unknown;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      try {
        const response = await fetch(request.url, {
          method: request.method ?? 'GET',
          headers: {
            'user-agent': USER_AGENT,
            accept: 'application/json',
            ...(request.etag ? { 'if-none-match': request.etag } : {}),
            ...request.headers,
          },
          body: request.body,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });

        if (response.status === 304) {
          return { status: 304, body: null, etag: request.etag ?? null, lastModified: null };
        }

        if (response.status === 429 || response.status >= 500) {
          // Read and discard the body: leaving it unconsumed keeps the socket out of the
          // pool, and the next attempt opens a new connection for no reason.
          await response.text().catch(() => undefined);
          lastError = new HttpError(`${response.status} from ${url.host}`, response.status);
          if (attempt < MAX_ATTEMPTS - 1) {
            await sleep(retryAfterMs(response.headers.get('retry-after'), attempt));
            continue;
          }
          throw lastError;
        }

        if (!response.ok) {
          // 404 on a board means the company took it down or renamed the token. Retrying
          // will not change that, so it fails immediately and the source's failure count
          // does the rest.
          throw new HttpError(`${response.status} from ${request.url}`, response.status);
        }

        return {
          status: response.status,
          body: await response.text(),
          etag: response.headers.get('etag'),
          lastModified: response.headers.get('last-modified'),
        };
      } catch (error) {
        lastError = error;
        if (error instanceof HttpError && error.status < 500 && error.status !== 429) throw error;
        if (error instanceof RobotsDisallowedError) throw error;
        if (attempt === MAX_ATTEMPTS - 1) break;
        await sleep(retryAfterMs(null, attempt));
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  });
}

/** Test seam: lets the offline pipeline checks run without reaching for the network. */
export function resetHttpCaches(): void {
  robotsCache.clear();
  hosts.clear();
}
