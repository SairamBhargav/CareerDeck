import AsyncStorage from '@react-native-async-storage/async-storage';

/*
 * Applications the reader answered "Not yet" for on Activity's check-in.
 *
 * On the device for the same reason as suggestionDismissals.ts: it is a preference about a
 * prompt, not a fact about the application, and a table plus RLS for "ask me again next week"
 * would be more machinery than the question deserves. The cost is the same too — a snooze
 * does not follow the reader to another device, where the card simply asks once more.
 *
 * Stored as application id → the ISO time the snooze runs out. Expired entries are dropped
 * on every write, so the map only ever holds what is currently snoozed.
 */

const PREFIX = 'checkin.snoozed.';

export type CheckInSnoozes = Record<string, string>;

const keyFor = (userId: string) => `${PREFIX}${userId}`;

export async function readCheckInSnoozes(userId: string): Promise<CheckInSnoozes> {
  try {
    const raw = await AsyncStorage.getItem(keyFor(userId));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    );
  } catch {
    return {};
  }
}

// One write at a time, for the reason suggestionDismissals.ts gives: two quick answers would
// otherwise both read the same map and the second write would drop the first.
let queue: Promise<unknown> = Promise.resolve();

/** Returns the new map, so the caller can put it straight into its cache. */
export function snoozeCheckIn(userId: string, applicationId: string, until: Date): Promise<CheckInSnoozes> {
  const result = queue.then(() => write(userId, applicationId, until));
  queue = result.catch(() => {});
  return result;
}

async function write(userId: string, applicationId: string, until: Date): Promise<CheckInSnoozes> {
  const now = Date.now();
  const current = await readCheckInSnoozes(userId);
  const next: CheckInSnoozes = {};
  for (const [id, expires] of Object.entries(current)) {
    if (new Date(expires).getTime() > now) next[id] = expires;
  }
  next[applicationId] = until.toISOString();

  try {
    await AsyncStorage.setItem(keyFor(userId), JSON.stringify(next));
  } catch {
    // The snooze still holds for this session; it just will not survive a restart.
  }
  return next;
}
