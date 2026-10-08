import AsyncStorage from '@react-native-async-storage/async-storage';

/*
 * When each suggested company entered the row, so the row can turn over.
 *
 * ── Why a rotation rather than an expiry ──────────────────────────────────────
 *
 * The obvious reading of "take it out after a day or two" is a hard exclusion, and that
 * empties the carousel. `suggested_companies()` caps its limit at fifty; at ten on screen
 * and five days each, a permanent exclusion exhausts the entire pool in a fortnight and the
 * section hides itself for good.
 *
 * So a retired company is not gone, it is at the back of the queue. The row prefers
 * companies it has never shown, and falls back to the ones it retired longest ago — which
 * means the pool cycles instead of draining, and a company seen a fortnight ago is a
 * perfectly good suggestion again.
 *
 * ── Why the first batch is backdated ──────────────────────────────────────────
 *
 * Recording ten companies at one instant makes them all retire at one instant, and ten
 * replacements then arrive together and retire together. That is a row that changes
 * wholesale every five days, in lockstep, forever — not the trickle the feature is for.
 *
 * Writing a batch therefore spreads it across the rotation window: the first keeps `now`
 * and each one after is a little older, so the rightmost card is nearly due and the leftmost
 * has its full term. From then on they fall due one at a time and are replaced one at a
 * time, which is the behaviour that was actually wanted. Only batches are staggered; a
 * single replacement simply gets the current time.
 *
 * Device-local, the same trade as suggestionDismissals.ts and for the same reason: there is
 * no server-side notion of "already shown this to you", and a carousel's turnover is not
 * worth a table and an RLS policy.
 */

const PREFIX = 'suggestions.shown.';

/** How long a company holds its slot. */
export const ROTATION_MS = 5 * 24 * 60 * 60 * 1000;

/**
 * Entries kept. Beyond this the oldest are dropped, which only makes those companies
 * eligible sooner — the failure mode is a suggestion returning early, not a broken row.
 */
const LIMIT = 300;

/** slug -> epoch ms at which it took its slot. */
export type SuggestionShownAt = Record<string, number>;

const keyFor = (userId: string) => `${PREFIX}${userId}`;

export async function readSuggestionShownAt(userId: string): Promise<SuggestionShownAt> {
  try {
    const raw = await AsyncStorage.getItem(keyFor(userId));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const out: SuggestionShownAt = {};
    for (const [slug, at] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof at === 'number' && Number.isFinite(at)) out[slug] = at;
    }
    return out;
  } catch {
    return {};
  }
}

/** True once a company has held its slot for the full window. */
export function isRetired(at: number | undefined, now = Date.now()): boolean {
  return at !== undefined && now - at > ROTATION_MS;
}

/*
 * Serialised for the same reason the dismissals are: read-modify-write, and the row records
 * whatever it is showing as it changes, which can be more than once in quick succession.
 */
let queue: Promise<unknown> = Promise.resolve();

/**
 * Stamps `slugs` that are new to the row or whose term has expired, and returns the whole
 * map so the caller can put it straight into its cache. Slugs already holding a live slot
 * keep the time they started, or nothing would ever come due.
 */
export function recordSuggestionsShown(userId: string, slugs: string[]): Promise<SuggestionShownAt> {
  const result = queue.then(() => write(userId, slugs));
  queue = result.catch(() => {});
  return result;
}

async function write(userId: string, slugs: string[]): Promise<SuggestionShownAt> {
  const current = await readSuggestionShownAt(userId);
  const now = Date.now();

  const fresh = slugs.filter((slug) => !(slug in current) || isRetired(current[slug], now));
  if (fresh.length === 0) return current;

  const next: SuggestionShownAt = { ...current };
  fresh.forEach((slug, index) => {
    // The stagger. One addition lands on `now`; a batch is spread back across the window so
    // the slots fall due separately. See the header.
    next[slug] = now - Math.round((index * ROTATION_MS) / Math.max(fresh.length, 1));
  });

  const trimmed = Object.entries(next)
    .sort(([, a], [, b]) => b - a)
    .slice(0, LIMIT);

  const capped: SuggestionShownAt = {};
  for (const [slug, at] of trimmed) capped[slug] = at;

  try {
    await AsyncStorage.setItem(keyFor(userId), JSON.stringify(capped));
  } catch {
    // Holds for this session; the row just will not remember its turnover across a restart.
  }
  return capped;
}
