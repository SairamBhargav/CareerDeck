import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { GoalRing } from '@/components/activity/GoalRing';
import { fontSize, radius, spacing } from '@/constants/theme';
import { useCareerDeck } from '@/context/CareerDeckContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import type { WeeklyGoal } from '@/hooks/useWeeklyGoal';
import { daysLeftInWeek } from '@/utils/week';

interface WeekStripProps {
  goal: WeeklyGoal;
  /** The whole strip opens the goal picker: it is the one thing on it a reader can change. */
  onEditGoal: () => void;
}

/**
 * This week against the goal, on one line: the ring, what is left and what it pays, then the
 * streak and the Auto Apply bank as two pills.
 *
 * It replaced WeeklyGoalCard (2026-10-09). The card spent a third of the first screen on a
 * goal the reader checks at a glance, and pushed the stage tiles — the part of Activity that
 * is about the season rather than the week — below the fold.
 */
export function WeekStrip({ goal, onEditGoal }: WeekStripProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const { autoApplyCredits, claimStreakBonus, lastStreakAward } = useCareerDeck();

  // Claimed the moment the goal is reached, as the old card did: the reward lands while the
  // reader is looking at the week they just finished. The server pays it once per week.
  const currentWeekKey = goal.history[goal.history.length - 1]?.key;
  useEffect(() => {
    if (goal.met && currentWeekKey) claimStreakBonus(currentWeekKey);
  }, [goal.met, currentWeekKey, claimStreakBonus]);

  const awarded =
    lastStreakAward && lastStreakAward.weekKey === currentWeekKey ? lastStreakAward.amount : null;

  return (
    <Pressable
      onPress={onEditGoal}
      accessibilityRole="button"
      accessibilityLabel={`${goal.count} of ${goal.target} applications this week. ${detailFor(goal, awarded)}. Change your weekly goal.`}
      style={({ pressed }) => [styles.strip, pressed ? styles.pressed : null]}>
      <GoalRing count={goal.count} target={goal.target} progress={goal.progress} met={goal.met} size={40} strokeWidth={5} />

      <View style={styles.copy}>
        <Text style={styles.headline} numberOfLines={1}>
          {headlineFor(goal)}
        </Text>
        <Text style={styles.detail} numberOfLines={1}>
          {detailFor(goal, awarded)}
        </Text>
      </View>

      {goal.streakWeeks > 0 ? (
        <View style={[styles.pill, { backgroundColor: colors.goalMetSurface }]}>
          <Ionicons name="flame" size={12} color={colors.goalMet} />
          <Text style={[styles.pillText, { color: colors.goalMet }]}>{goal.streakWeeks}</Text>
        </View>
      ) : null}

      <View style={[styles.pill, { backgroundColor: colors.autoApplySurface }]}>
        <Ionicons name="flash" size={12} color={colors.autoApplyIcon} />
        <Text style={[styles.pillText, { color: colors.autoApplyLabel }]}>{autoApplyCredits}</Text>
      </View>
    </Pressable>
  );
}

function headlineFor(goal: WeeklyGoal): string {
  if (goal.met) return goal.count > goal.target ? `${goal.count} sent — goal cleared` : 'Weekly goal met';
  return `${goal.count} of ${goal.target} this week`;
}

/** `awarded` is what this week actually paid, or null when it hasn't paid yet. */
function detailFor(goal: WeeklyGoal, awarded: number | null): string {
  const daysLeft = daysLeftInWeek(new Date());
  const left = daysLeft === 1 ? 'last day' : `${daysLeft} days left`;

  if (!goal.met) return `+${goal.bonusThisWeek} Auto Apply at ${goal.target} · ${left}`;
  if (awarded === null) return 'Resets Monday';
  // A met week that paid nothing means the bank was already full; "+0" would read as denied.
  return awarded > 0 ? `+${awarded} earned this week` : 'Bank full — spend some first';
}

const useStyles = makeStyles((colors) => ({
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md + 2,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  pressed: {
    backgroundColor: colors.backgroundMuted,
  },
  copy: {
    flex: 1,
    gap: 1,
  },
  headline: {
    fontSize: fontSize.body,
    fontWeight: '800',
    color: colors.text,
    letterSpacing: -0.2,
  },
  detail: {
    fontSize: fontSize.caption + 1,
    color: colors.textSecondary,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 30,
    paddingHorizontal: spacing.sm + 2,
    borderRadius: radius.pill,
  },
  pillText: {
    fontSize: fontSize.caption + 1,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
}));
