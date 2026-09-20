import { StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedProps, useDerivedValue, withTiming } from 'react-native-reanimated';
import { Circle, Svg } from 'react-native-svg';

import { fontSize } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';

const SIZE = 84;
const STROKE_WIDTH = 8;
const RADIUS = (SIZE - STROKE_WIDTH) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const CENTER = SIZE / 2;
const FILL_MS = 620;

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

interface GoalRingProps {
  /** Applications logged this week. Shown as-is, so an over-shot week reads honestly. */
  count: number;
  target: number;
  /** 0-1, already clamped by the caller. */
  progress: number;
  /** Turns the arc green once the week is done. */
  met: boolean;
}

/**
 * This week's applications against the goal.
 *
 * Same idiom as the resume match ring on Reels, at a size that can carry "3/5" in the
 * middle. A ring is right here for the reason it's wrong there: this genuinely is a
 * gauge filling up, and it empties again every Monday.
 */
export function GoalRing({ count, target, progress, met }: GoalRingProps) {
  const { colors } = useTheme();
  const styles = useStyles();

  const fill = useDerivedValue(() => withTiming(progress, { duration: FILL_MS }), [progress]);

  const ringProps = useAnimatedProps(() => ({
    strokeDashoffset: CIRCUMFERENCE * (1 - fill.value),
  }));

  return (
    <View
      style={styles.wrap}
      accessibilityRole="progressbar"
      accessibilityLabel={`${count} of ${target} applications this week`}
      accessibilityValue={{ min: 0, max: target, now: count }}>
      <Svg width={SIZE} height={SIZE} style={StyleSheet.absoluteFill}>
        <Circle
          cx={CENTER}
          cy={CENTER}
          r={RADIUS}
          stroke={colors.backgroundMuted}
          strokeWidth={STROKE_WIDTH}
          fill="none"
        />
        <AnimatedCircle
          cx={CENTER}
          cy={CENTER}
          r={RADIUS}
          stroke={met ? colors.goalMet : colors.text}
          strokeWidth={STROKE_WIDTH}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${CIRCUMFERENCE}, ${CIRCUMFERENCE}`}
          rotation={-90}
          origin={`${CENTER}, ${CENTER}`}
          animatedProps={ringProps}
        />
      </Svg>

      <Text style={styles.value}>
        {count}
        <Text style={styles.target}>/{target}</Text>
      </Text>
      <Text style={styles.caption}>this week</Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  wrap: {
    width: SIZE,
    height: SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  value: {
    fontSize: fontSize.heading,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.6,
    lineHeight: 24,
  },
  // Lighter than the figure beside it: the target is context for the count, not a
  // second number competing with it.
  target: {
    fontSize: fontSize.small,
    fontWeight: '600',
    color: colors.textTertiary,
  },
  caption: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.textTertiary,
  },
}));
