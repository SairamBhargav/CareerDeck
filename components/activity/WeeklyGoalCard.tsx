import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { GoalRing } from '@/components/activity/GoalRing';
import { GoalSpline } from '@/components/activity/GoalSpline';
import { IconButton } from '@/components/common/IconButton';
import { fontSize, radius, spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { useCareerDeck } from '@/context/CareerDeckContext';
import type { WeeklyGoal } from '@/hooks/useWeeklyGoal';
import { daysLeftInWeek } from '@/utils/week';

interface WeeklyGoalCardProps {
  goal: WeeklyGoal;
  onEditGoal: () => void;
}

/**
 * Activity's header: this week's applications against the goal the user set, the run
 * of weeks behind it, and what finishing this one is worth.
 *
 * It replaced a stage breakdown, which described a pile that only the user could
 * change and gave them no reason to change it. A goal is the one figure on this screen
 * that is about the week ahead rather than the season behind, so it leads.
 */
export function WeeklyGoalCard({ goal, onEditGoal }: WeeklyGoalCardProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const { autoApplyCredits, claimStreakBonus, lastStreakAward } = useCareerDeck();

  // The bonus is claimed the moment the goal is reached rather than on Monday: the reward
  // has to land while the user is looking at the thing they just finished. The server
  // decides what the week is worth and pays it once, however many times this asks.
  const currentWeekKey = goal.history[goal.history.length - 1]?.key;
  useEffect(() => {
    if (goal.met && currentWeekKey) claimStreakBonus(currentWeekKey);
  }, [goal.met, currentWeekKey, claimStreakBonus]);

  // What this week actually paid, which a full bank can cut short. Any other week's
  // receipt is somebody else's news.
  const awarded =
    lastStreakAward && lastStreakAward.weekKey === currentWeekKey ? lastStreakAward.amount : null;

  return (
    <View style={styles.card}>
      <View style={styles.top}>
        <GoalRing count={goal.count} target={goal.target} progress={goal.progress} met={goal.met} />

        <View style={styles.copy}>
          <Text style={styles.headline}>{headlineFor(goal)}</Text>
          <Text style={styles.detail}>{detailFor(goal)}</Text>

          {goal.streakWeeks > 0 ? (
            <Animated.View entering={FadeIn.duration(240)} style={styles.streak}>
              <Ionicons name="flame" size={13} color={colors.goalMet} />
              <Text style={styles.streakText}>
                {goal.streakWeeks} week{goal.streakWeeks === 1 ? '' : 's'} in a row
              </Text>
            </Animated.View>
          ) : null}
        </View>

        <IconButton
          name="ellipsis-horizontal"
          onPress={onEditGoal}
          accessibilityLabel="Change your weekly goal"
          size={18}
          color={colors.textTertiary}
          style={styles.menu}
        />
      </View>

      <GoalSpline weeks={goal.history} target={goal.target} met={goal.met} />

      <View style={styles.reward}>
        <Text style={styles.creditsText}>
          {autoApplyCredits} Auto {autoApplyCredits === 1 ? 'Apply' : 'Applies'} left
        </Text>

        <View style={[styles.rewardPill, goal.met ? styles.rewardPillMet : null]}>
          <Text style={[styles.rewardNote, goal.met ? styles.rewardNoteMet : null]}>
            {rewardNoteFor(goal, awarded)}
          </Text>
        </View>
      </View>
    </View>
  );
}

/** `awarded` is what this week actually paid, or null when it hasn't paid yet. */
function rewardNoteFor(goal: WeeklyGoal, awarded: number | null): string {
  if (!goal.met) return `+${goal.bonusThisWeek} when you hit ${goal.target}`;
  if (awarded === null) return 'Goal met';
  // A met week that paid nothing means the bank was already full — say that rather
  // than printing "+0", which reads as the reward having been denied.
  return awarded > 0 ? `+${awarded} earned this week` : 'Bank full — spend some first';
}

function headlineFor(goal: WeeklyGoal): string {
  if (goal.met) return goal.count > goal.target ? `${goal.count} sent — goal cleared` : 'Weekly goal met';
  if (goal.count === 0) return `${goal.target} applications this week`;
  return `${goal.remaining} more to go`;
}

function detailFor(goal: WeeklyGoal): string {
  const daysLeft = daysLeftInWeek(new Date());

  if (goal.met) {
    return goal.streakWeeks > 1
      ? 'Keep it up next week and the streak pays more.'
      : 'Resets Monday. Do it again to start a streak.';
  }

  if (daysLeft === 1) return 'Last day — the week resets tomorrow.';
  return `${daysLeft} days left in the week.`;
}

const useStyles = makeStyles((colors) => ({
  card: {
    gap: spacing.lg,
    padding: spacing.lg,
    borderRadius: radius.lg + 2,
    backgroundColor: colors.surface,
    // A touch darker than the app's default card edge, so the card holds its shape on white.
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    ...colors.shadowSoft,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
  },
  copy: {
    flex: 1,
    gap: 2,
  },
  headline: {
    fontSize: fontSize.title - 1,
    fontWeight: '800',
    color: colors.text,
    letterSpacing: -0.3,
  },
  detail: {
    fontSize: fontSize.small,
    lineHeight: 18,
    color: colors.textSecondary,
  },
  streak: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: spacing.xs,
  },
  streakText: {
    fontSize: fontSize.caption + 1,
    fontWeight: '700',
    color: colors.goalMet,
  },
  // Pulled up and out so the control sits in the card's corner rather than being
  // vertically centred against the ring.
  menu: {
    alignSelf: 'flex-start',
    marginTop: -spacing.xs,
    marginRight: -spacing.xs,
  },
  reward: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  creditsText: {
    fontSize: fontSize.small,
    fontWeight: '700',
    color: colors.text,
  },
  rewardPill: {
    flexShrink: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.backgroundMuted,
  },
  rewardPillMet: {
    backgroundColor: colors.goalMetSurface,
  },
  rewardNote: {
    fontSize: fontSize.caption + 1,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  rewardNoteMet: {
    color: colors.goalMet,
  },
}));
