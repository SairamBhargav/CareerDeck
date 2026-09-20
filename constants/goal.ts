/**
 * The weekly application goal and the Auto Apply economy that rewards keeping it.
 *
 * Every number here is a guess. The point of this file is that they're all in one
 * place: the balance between "one Auto Apply a day" and "what a streak is worth" is
 * the kind of thing that only settles once real users are hitting it, so nothing else
 * in the app hard-codes any of it.
 *
 * The economy is deliberately small. The tracker is self-reported, so a determined
 * user can always claim a week they didn't work — the defence isn't detection, it's
 * that three extra Auto Applies aren't worth the lie.
 */

/** Targets offered in the goal picker. Deliberately short — a slider invites fiddling. */
export const WEEKLY_GOAL_OPTIONS = [3, 7, 14, 30] as const;

/** One a day. The same cadence as the Auto Apply grant, which is not a coincidence. */
export const DEFAULT_WEEKLY_GOAL = 7;

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
  /**
   * The ceiling on everything a single week can pay, however long the streak runs.
   * This is the number that keeps faking a week from being worth the trouble, so it
   * is enforced here rather than left to whatever the escalation above works out to.
   */
  maxWeeklyBonus: 3,
} as const;

/** What a week at goal is worth right now, given how long the streak already is. */
export function streakBonusFor(streakWeeks: number): number {
  const earned =
    streakWeeks >= AUTO_APPLY_ECONOMY.longStreakWeeks
      ? AUTO_APPLY_ECONOMY.longStreakBonus
      : AUTO_APPLY_ECONOMY.streakBonus;

  return Math.min(earned, AUTO_APPLY_ECONOMY.maxWeeklyBonus);
}
