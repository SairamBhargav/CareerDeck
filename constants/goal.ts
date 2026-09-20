/**
 * The weekly application goal and the Auto Apply economy that rewards keeping it.
 *
 * Every number here is a guess. The point of this file is that they're all in one
 * place: the balance between "one Auto Apply a day" and "what a streak is worth" is
 * the kind of thing that only settles once real users are hitting it, so nothing else
 * in the app hard-codes any of it.
 */

/** Targets offered in the goal picker. Deliberately short — a slider invites fiddling. */
export const WEEKLY_GOAL_OPTIONS = [2, 3, 5, 8, 10] as const;

export const DEFAULT_WEEKLY_GOAL = 3;

/** The picker's ends, kept in sync with the list above — `setWeeklyGoal` clamps to them. */
export const MIN_WEEKLY_GOAL: number = Math.min(...WEEKLY_GOAL_OPTIONS);
export const MAX_WEEKLY_GOAL: number = Math.max(...WEEKLY_GOAL_OPTIONS);

export const AUTO_APPLY_ECONOMY = {
  /** Handed out every day regardless of the goal — the floor, so the feature is never unusable. */
  dailyGrant: 1,
  /** Unspent credits stop piling up here, so a month away doesn't bank thirty of them. */
  bankCap: 5,
  /** Paid once for each week that finishes at or above the goal. */
  streakBonus: 1,
  /** Paid instead of `streakBonus` once the streak is this long. */
  longStreakBonus: 2,
  longStreakWeeks: 4,
} as const;

/** What a week at goal is worth right now, given how long the streak already is. */
export function streakBonusFor(streakWeeks: number): number {
  return streakWeeks >= AUTO_APPLY_ECONOMY.longStreakWeeks
    ? AUTO_APPLY_ECONOMY.longStreakBonus
    : AUTO_APPLY_ECONOMY.streakBonus;
}
