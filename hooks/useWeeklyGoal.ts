import { useMemo } from 'react';

import { streakBonusFor } from '@/constants/goal';
import { useCareerDeck } from '@/context/CareerDeckContext';
import type { Application } from '@/types';
import { formatWeekLabel, parseLocalDate, weekKey, weekStartBefore, weeksBefore } from '@/utils/week';

/** How many past weeks the card draws behind the ring. */
export const HISTORY_WEEKS = 6;

export interface GoalWeek {
  /** The week's Monday, as `YYYY-MM-DD`. */
  key: string;
  label: string;
  count: number;
  met: boolean;
}

export interface WeeklyGoal {
  target: number;
  /** Applications logged in the current week. Can exceed the target. */
  count: number;
  /** 0-1, clamped — the ring never overdraws itself. */
  progress: number;
  remaining: number;
  met: boolean;
  /**
   * Consecutive weeks at or above the target, counting back from now. The current week
   * only joins the run once it's actually met, so the figure never claims a week that
   * hasn't happened yet.
   */
  streakWeeks: number;
  /** What finishing this week at goal is worth, in Auto Apply credits. */
  bonusThisWeek: number;
  /** Oldest first, ending with the current week — the strip under the ring. */
  history: GoalWeek[];
}

/** Applications per week key. Weeks with none are simply absent. */
function countByWeek(applications: Application[]): Map<string, number> {
  const counts = new Map<string, number>();

  for (const application of applications) {
    const applied = parseLocalDate(application.appliedAt);
    if (!applied) continue;
    const key = weekKey(applied);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return counts;
}

/**
 * Turns the tracker into the one figure the Activity header leads on: how much of this
 * week's goal is done, and how many weeks in a row it's been done before.
 *
 * Derived rather than stored. A streak kept as a counter drifts the moment anything
 * else edits the tracker — delete an application and a stored streak would still claim
 * the week — whereas recomputing from `appliedAt` is always the truth.
 */
export function useWeeklyGoal(now: Date = new Date()): WeeklyGoal {
  const { applications, weeklyGoal } = useCareerDeck();

  // Date objects are new on every render, so the memo keys off the week and day rather
  // than the instance — recomputing once a day is enough for a goal that resets weekly.
  const today = now.toDateString();

  return useMemo(() => {
    const reference = new Date(today);
    const counts = countByWeek(applications);
    const target = weeklyGoal;

    const currentKey = weekKey(reference);
    const count = counts.get(currentKey) ?? 0;
    const met = count >= target;

    // Walk backwards from this week. The current week is skipped when it isn't met yet,
    // so a streak of three stays three on Monday morning instead of collapsing to zero.
    // A streak can't run back past the oldest application, which also bounds the loop.
    const oldest = oldestApplied(applications);
    const reach = oldest ? weeksBefore(reference, oldest) : 0;

    let streakWeeks = 0;
    for (let back = met ? 0 : 1; back <= reach; back += 1) {
      const weekCount = counts.get(weekKey(weekStartBefore(reference, back))) ?? 0;
      if (weekCount < target) break;
      streakWeeks += 1;
    }

    const history: GoalWeek[] = [];
    for (let back = HISTORY_WEEKS; back >= 0; back -= 1) {
      const start = weekStartBefore(reference, back);
      const key = weekKey(start);
      const weekCount = counts.get(key) ?? 0;
      history.push({
        key,
        label: back === 0 ? 'Now' : formatWeekLabel(start),
        count: weekCount,
        met: weekCount >= target,
      });
    }

    return {
      target,
      count,
      progress: target > 0 ? Math.min(count / target, 1) : 0,
      remaining: Math.max(target - count, 0),
      met,
      streakWeeks,
      // Quoted for the week about to be completed, so it reflects the streak this week
      // would extend rather than the one already banked.
      bonusThisWeek: streakBonusFor(met ? streakWeeks : streakWeeks + 1),
      history,
    };
  }, [applications, weeklyGoal, today]);
}

function oldestApplied(applications: Application[]): Date | null {
  let oldest: Date | null = null;

  for (const application of applications) {
    const applied = parseLocalDate(application.appliedAt);
    if (applied && (!oldest || applied < oldest)) oldest = applied;
  }

  return oldest;
}
