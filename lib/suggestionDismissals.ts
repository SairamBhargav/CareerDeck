import AsyncStorage from '@react-native-async-storage/async-storage';

/*
 * Companies the reader has told us to stop suggesting.
 *
 * ── Why this is on the device ─────────────────────────────────────────────────
 *
 * There is no server-side notion of "do not suggest this company". `company_follows` says
 * yes and says nothing about no, and `suggested_companies()` is a plain top-by-openings
 * query with no per-user state in it at all. Giving the X a home on the server means a new
 * table, a migration, and RLS for a preference about a row in a carousel.
 *
 * So it lives in AsyncStorage, keyed per user the way paywallPrompts.ts keys its moments.
 * The honest cost: it does not follow the reader to another device, and signing out and
 * back in on a fresh install brings the suggestions back. That is the right trade for a
 * carousel — and if it ever stops being, the shape here is a set of slugs, which is what a
 * table would hold too.
 */

const PREFIX = 'suggestions.dismissed.';

/**
 * A ceiling, because this only ever grows.
 *
 * `suggested_companies()` draws from the companies that are hiring, which is on the order
 * of a thousand; nobody dismisses their way through it, and a reader who tries is better
 * served by the list eventually refilling than by an unbounded key.
 */
const LIMIT = 200;

const keyFor = (userId: string) => `${PREFIX}${userId}`;

export async function readDismissedSuggestions(userId: string): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(keyFor(userId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    // Anything else means the key was written by a different version of this code, and an
    // empty list is a better answer than a crash on the home screen.
    return Array.isArray(parsed) ? parsed.filter((slug): slug is string => typeof slug === 'string') : [];
  } catch {
    return [];
  }
}

/*
 * Writes run one at a time.
 *
 * Each one is a read, a modify and a write, and dismissing two cards in a row is the
 * expected way to use a carousel — not an edge case. Run concurrently, both would read the
 * same list, and whichever wrote second would drop the other's slug. Chaining costs
 * nothing at this rate and removes the race entirely.
 */
let queue: Promise<unknown> = Promise.resolve();

/** Returns the new set, so the caller can put it straight into its cache. */
export function dismissSuggestion(userId: string, slug: string): Promise<string[]> {
  const result = queue.then(() => write(userId, slug));
  // Swallowed on the chain only, so one failed write cannot reject every write after it.
  queue = result.catch(() => {});
  return result;
}

async function write(userId: string, slug: string): Promise<string[]> {
  const current = await readDismissedSuggestions(userId);
  if (current.includes(slug)) return current;

  // Newest first, so the cap drops the oldest dismissals — the ones most likely to have
  // been about a company the reader has since forgotten.
  const next = [slug, ...current].slice(0, LIMIT);
  try {
    await AsyncStorage.setItem(keyFor(userId), JSON.stringify(next));
  } catch {
    // The dismissal still applies for this session; it just will not survive a restart.
  }
  return next;
}
