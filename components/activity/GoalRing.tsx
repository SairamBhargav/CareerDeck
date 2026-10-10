import { StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedProps, useDerivedValue, withTiming } from 'react-native-reanimated';
import { Circle, Svg } from 'react-native-svg';

import { fontSize } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';

const SIZE = 68;
const STROKE_WIDTH = 7;
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
  /** Diameter. The figure in the middle only shows at the full size, where it fits. */
  size?: number;
  strokeWidth?: number;
}

/**
 * This week's applications against the goal.
 *
 * Same idiom as the resume match ring on Reels, at a size that can carry "3/5" in the
 * middle. A ring is right here for the reason it's wrong there: this genuinely is a
 * gauge filling up, and it empties again every Monday.
 */
export function GoalRing({ count, target, progress, met, size = SIZE, strokeWidth = STROKE_WIDTH }: GoalRingProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;
  const showValue = size >= SIZE;

  const fill = useDerivedValue(() => withTiming(progress, { duration: FILL_MS }), [progress]);

  const ringProps = useAnimatedProps(() => ({
    strokeDashoffset: circumference * (1 - fill.value),
  }));

  return (
    <View
      style={[styles.wrap, { width: size, height: size }]}
      accessibilityRole="progressbar"
      accessibilityLabel={`${count} of ${target} applications this week`}
      accessibilityValue={{ min: 0, max: target, now: count }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle
          cx={center}
          cy={center}
          r={radius}
          stroke={colors.backgroundMuted}
          strokeWidth={strokeWidth}
          fill="none"
        />
        <AnimatedCircle
          cx={center}
          cy={center}
          r={radius}
          stroke={met || !showValue ? colors.goalMet : colors.text}
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${circumference}, ${circumference}`}
          rotation={-90}
          origin={`${center}, ${center}`}
          animatedProps={ringProps}
        />
      </Svg>

      {/* One figure, "7/7", green once the week is done. "This week" is in the label. */}
      {showValue ? (
        <Text style={[styles.value, met ? styles.valueMet : null]}>
          {count}/{target}
        </Text>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  value: {
    fontSize: fontSize.title,
    fontWeight: '800',
    color: colors.text,
    letterSpacing: -0.4,
  },
  valueMet: {
    color: colors.goalMet,
  },
}));
