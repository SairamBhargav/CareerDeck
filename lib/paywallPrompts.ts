import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * The paywall opens by itself at most once per moment, per account:
 *
 *  - `welcome`: the first time someone lands in the app after onboarding
 *  - `first-auto-apply`: right after their first Auto Apply hands off, when they have just
 *    seen what one is worth
 *
 * Everywhere else it opens only when asked (Settings, the Activity card, an empty balance).
 * The flags are per device as well as per account. Seeing it once more on a new phone is an
 * acceptable cost for not adding a server column just for this.
 */
export type PaywallMoment = 'welcome' | 'first-auto-apply';

/** Where the paywall was opened from. It picks the headline. */
export type PaywallSource = PaywallMoment | 'activity' | 'settings' | 'limit';

const key = (moment: PaywallMoment, userId: string) => `paywall:${moment}:${userId}`;

/** Claimed this session, so the claim holds before the storage write lands. */
const claimed = new Set<string>();

/**
 * True the first time it is asked about a moment for an account, and false from then on.
 * Marks the moment as used in the same call, so two callers racing cannot both open it.
 * Storage that fails says no: a paywall that never auto-opens is the safe direction.
 */
export async function claimPaywallMoment(moment: PaywallMoment, userId: string): Promise<boolean> {
  if (claimed.has(key(moment, userId))) return false;
  claimed.add(key(moment, userId));
  try {
    if ((await AsyncStorage.getItem(key(moment, userId))) !== null) return false;
    await AsyncStorage.setItem(key(moment, userId), new Date().toISOString());
    return true;
  } catch {
    return false;
  }
}
