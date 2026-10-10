import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  FadeInDown,
  FadeOutUp,
  useAnimatedProps,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Circle, Svg } from 'react-native-svg';

import { OnboardingStep } from '@/components/onboarding/OnboardingStep';
import { AUTO_APPLY_ECONOMY, DEFAULT_WEEKLY_GOAL, WEEKLY_GOAL_OPTIONS } from '@/constants/goal';
import { fontSize, radius, spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { useOnboarding } from '@/context/OnboardingContext';
import { useGuardedRouter } from '@/hooks/useGuardedRouter';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const RING_STROKE = 14;
/** The ring shrinks on short screens (an SE is 667pt) so the step never needs to scroll. */
const RING_SIZE_TALL = 208;
const RING_SIZE_SHORT = 164;
const SHORT_SCREEN = 760;
const FILL_MS = 700;
const SLIDE_SPRING = { damping: 17, stiffness: 210, mass: 0.7 };

/**
 * What each target is called under the number. The ring fills by position in the list,
 * not by value: thirty would otherwise make three look like nothing at all.
 */
const GOAL_LABEL: Record<number, string> = {
  3: 'Just looking',
  7: 'About one a day',
  14: 'Two a day',
  30: 'All in',
};

/**
 * Step three: a weekly application goal.
 *
 * The goal used to wait for the Activity tab, where most people met it already behind.
 * Asking here sets it while the person is deciding how serious they are, and it is the
 * natural place to say what keeping it pays: the Auto Apply bonus is the reason the goal
 * exists at all (constants/goal.ts).
 *
 * Seven is preselected, so Continue is never disabled. It is DEFAULT_WEEKLY_GOAL, the same
 * value somebody who skipped this would get.
 */
export default function GoalStep() {
  const router = useGuardedRouter();
  const styles = useStyles();
  const { colors } = useTheme();
  const reduceMotion = useReducedMotion();
  const { weeklyGoal, setWeeklyGoal } = useOnboarding();
  const { height } = useWindowDimensions();
  const ringSize = height < SHORT_SCREEN ? RING_SIZE_SHORT : RING_SIZE_TALL;
  const ringRadius = (ringSize - RING_STROKE) / 2;
  const circumference = 2 * Math.PI * ringRadius;

  const index = Math.max(0, WEEKLY_GOAL_OPTIONS.findIndex((option) => option === weeklyGoal));
  const goal: number = WEEKLY_GOAL_OPTIONS[index] ?? DEFAULT_WEEKLY_GOAL;
  const goalLabel = GOAL_LABEL[goal] ?? '';

  const fill = useDerivedValue(
    () => withTiming((index + 1) / WEEKLY_GOAL_OPTIONS.length, { duration: FILL_MS, easing: Easing.out(Easing.cubic) }),
    [index],
  );
  const ringProps = useAnimatedProps(() => ({
    strokeDashoffset: circumference * (1 - fill.value),
  }));

  // The segment indicator needs a width to slide by, and the control's width is the
  // screen's, so it is measured rather than assumed.
  const [trackWidth, setTrackWidth] = useState(0);
  const segmentWidth = trackWidth > 0 ? (trackWidth - SEGMENT_INSET * 2) / WEEKLY_GOAL_OPTIONS.length : 0;
  const slide = useDerivedValue(() => withSpring(index * segmentWidth, SLIDE_SPRING), [index, segmentWidth]);
  const indicatorStyle = useAnimatedStyle(() => ({
    width: segmentWidth,
    transform: [{ translateX: slide.value }],
  }));

  // A slow pulse behind the bolt, so the reward reads as something live.
  const pulse = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion) return;
    pulse.set(withRepeat(withTiming(1, { duration: 1800, easing: Easing.out(Easing.quad) }), -1, false));
    // Writing the shared value is the effect's whole job.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduceMotion]);
  const haloStyle = useAnimatedStyle(() => ({
    opacity: 0.45 * (1 - pulse.value),
    transform: [{ scale: 1 + pulse.value * 0.55 }],
  }));

  const choose = (option: number) => {
    if (option === goal) return;
    Haptics.selectionAsync();
    setWeeklyGoal(option);
  };

  return (
    <OnboardingStep
      step={3}
      title={'Set a\nweekly goal'}
      subtitle="How many applications a week. You can change it any time."
      canContinue
      onContinue={() => router.push('/onboarding/companies')}>
      <View style={styles.body}>
        <View
          style={[styles.ring, { width: ringSize, height: ringSize }]}
          accessibilityRole="text"
          accessibilityLabel={`${goal} applications a week, ${goalLabel.toLowerCase()}`}>
          <Svg width={ringSize} height={ringSize} style={StyleSheet.absoluteFill}>
            <Circle
              cx={ringSize / 2}
              cy={ringSize / 2}
              r={ringRadius}
              stroke={colors.backgroundMuted}
              strokeWidth={RING_STROKE}
              fill="none"
            />
            <AnimatedCircle
              cx={ringSize / 2}
              cy={ringSize / 2}
              r={ringRadius}
              stroke={colors.text}
              strokeWidth={RING_STROKE}
              fill="none"
              strokeLinecap="round"
              strokeDasharray={`${circumference}, ${circumference}`}
              rotation={-90}
              origin={`${ringSize / 2}, ${ringSize / 2}`}
              animatedProps={ringProps}
            />
          </Svg>

          {/* Keyed by the goal, so each change swaps the figure: the old one lifts out
              and the new one springs up into its place. */}
          <View style={styles.figure}>
            <Animated.Text
              key={goal}
              entering={reduceMotion ? undefined : FadeInDown.springify().damping(14).stiffness(180)}
              exiting={reduceMotion ? undefined : FadeOutUp.duration(160)}
              style={styles.number}>
              {goal}
            </Animated.Text>
          </View>
          <Text style={styles.caption}>{goalLabel}</Text>
        </View>

        <View
          style={styles.track}
          onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
          accessibilityRole="radiogroup"
          accessibilityLabel="Applications a week">
          {segmentWidth > 0 ? <Animated.View style={[styles.indicator, indicatorStyle]} /> : null}
          {WEEKLY_GOAL_OPTIONS.map((option) => {
            const selected = option === goal;
            return (
              <Pressable
                key={option}
                onPress={() => choose(option)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={`${option} a week`}
                style={styles.segment}>
                <Text style={[styles.segmentLabel, selected ? styles.segmentLabelOn : null]}>{option}</Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.reward}>
          <View style={styles.boltWrap}>
            <Animated.View pointerEvents="none" style={[styles.halo, haloStyle]} />
            <View style={styles.bolt}>
              <Ionicons name="flash" size={19} color={colors.autoApplyIcon} />
            </View>
          </View>
          <View style={styles.rewardText}>
            <Text style={styles.rewardTitle}>+{AUTO_APPLY_ECONOMY.streakBonus} Auto Apply</Text>
            <Text style={styles.rewardBody}>
              for every week you hit it, on top of {AUTO_APPLY_ECONOMY.dailyGrant} a day.
            </Text>
          </View>
        </View>
      </View>
    </OnboardingStep>
  );
}

const SEGMENT_INSET = 4;

const useStyles = makeStyles((colors) => ({
  body: {
    alignItems: 'center',
    gap: spacing.xl + spacing.xs,
  },
  ring: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  figure: {
    height: 72,
    justifyContent: 'center',
  },
  number: {
    fontSize: 64,
    lineHeight: 72,
    fontWeight: '700',
    letterSpacing: -2.5,
    color: colors.text,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  caption: {
    fontSize: fontSize.small + 1,
    fontWeight: '600',
    color: colors.textTertiary,
  },
  track: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    padding: SEGMENT_INSET,
    borderRadius: radius.pill,
    backgroundColor: colors.backgroundMuted,
  },
  indicator: {
    position: 'absolute',
    top: SEGMENT_INSET,
    bottom: SEGMENT_INSET,
    left: SEGMENT_INSET,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    ...colors.shadowSoft,
  },
  segment: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentLabel: {
    fontSize: fontSize.body + 1,
    fontWeight: '700',
    color: colors.textTertiary,
  },
  segmentLabelOn: {
    color: colors.text,
  },
  reward: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md + 2,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  boltWrap: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  halo: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.autoApply,
  },
  bolt: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.autoApply,
  },
  rewardText: {
    flex: 1,
    gap: 2,
  },
  rewardTitle: {
    fontSize: fontSize.body,
    fontWeight: '700',
    color: colors.text,
  },
  rewardBody: {
    fontSize: fontSize.small,
    lineHeight: 18,
    color: colors.textSecondary,
  },
}));
