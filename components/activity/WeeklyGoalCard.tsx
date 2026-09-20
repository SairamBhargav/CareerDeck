import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

import { GoalRing } from '@/components/activity/GoalRing';
import { IconButton } from '@/components/common/IconButton';
import { fontSize, radius, spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { useCareerDeck } from '@/context/CareerDeckContext';
import type { WeeklyGoal } from '@/hooks/useWeeklyGoal';
import { daysLeftInWeek } from '@/utils/week';

/** Per-column stagger on the history strip. */
const STAGGER_MS = 40;

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
  const { autoApplyCredits, awardStreakBonus, lastStreakAward } = useCareerDeck();

  // The bonus is paid the moment the goal is reached rather than on Monday: the reward
  // has to land while the user is looking at the thing they just finished.
  // awardStreakBonus is idempotent per week, so re-renders can't pay it twice.
  const currentWeekKey = goal.history[goal.history.length - 1]?.key;
  useEffect(() => {
    if (goal.met && currentWeekKey) awardStreakBonus(currentWeekKey, goal.bonusThisWeek);
  }, [goal.met, goal.bonusThisWeek, currentWeekKey, awardStreakBonus]);

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

      <View style={styles.history} accessibilityRole="summary" accessibilityLabel={historyLabel(goal)}>
        {goal.history.map((week, index) => (
          <Animated.View
            key={week.key}
            entering={FadeInDown.duration(260).delay(index * STAGGER_MS)}
            style={styles.week}>
            <View style={styles.trackWrap}>
              <View
                style={[
                  styles.track,
                  {
                    height: `${Math.min(week.count / Math.max(goal.target, 1), 1) * 100}%`,
                    backgroundColor: week.met ? colors.goalMet : colors.borderStrong,
                  },
                  // An empty week still needs to read as a week rather than as a gap.
                  week.count === 0 ? styles.trackEmpty : null,
                ]}
              />
            </View>
            <Text style={[styles.weekLabel, index === goal.history.length - 1 ? styles.weekLabelNow : null]}>
              {week.label}
            </Text>
          </Animated.View>
        ))}
      </View>

      <View style={styles.reward}>
        <View style={styles.credits}>
          <Ionicons name="flash" size={13} color={colors.autoApply} />
          <Text style={styles.creditsText}>
            {autoApplyCredits} Auto {autoApplyCredits === 1 ? 'Apply' : 'Applies'} left
          </Text>
        </View>

        <Text style={styles.rewardNote}>{rewardNoteFor(goal, awarded)}</Text>
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

function historyLabel(goal: WeeklyGoal): string {
  return `Applications per week: ${goal.history.map((week) => `${week.label}, ${week.count}`).join('; ')}`;
}

const useStyles = makeStyles((colors) => ({
  card: {
    gap: spacing.lg,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
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
    fontSize: fontSize.body,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.3,
  },
  detail: {
    fontSize: fontSize.small,
    color: colors.textTertiary,
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
  history: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  week: {
    flex: 1,
    alignItems: 'center',
    gap: 5,
  },
  trackWrap: {
    width: '100%',
    height: 34,
    justifyContent: 'flex-end',
    backgroundColor: colors.backgroundMuted,
    borderRadius: radius.md - 6,
    overflow: 'hidden',
  },
  track: {
    width: '100%',
    borderRadius: radius.md - 6,
  },
  trackEmpty: {
    height: 3,
    backgroundColor: colors.border,
  },
  weekLabel: {
    fontSize: 9.5,
    fontWeight: '600',
    color: colors.textTertiary,
  },
  weekLabelNow: {
    color: colors.text,
  },
  reward: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  credits: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  creditsText: {
    fontSize: fontSize.small,
    fontWeight: '700',
    color: colors.text,
  },
  rewardNote: {
    fontSize: fontSize.caption + 1,
    color: colors.textTertiary,
    flexShrink: 1,
    textAlign: 'right',
  },
}));
