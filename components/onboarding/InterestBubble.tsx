import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { useEffect } from 'react';
import { Pressable } from 'react-native';
import Animated, {
  Easing,
  FadeInDown,
  LinearTransition,
  ZoomIn,
  cancelAnimation,
  interpolateColor,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { fontSize, radius } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * Three sizes, so the cloud reads as bubbles rather than a row of identical buttons.
 * The spread is small on purpose: the smallest still clears the 44pt target with its
 * hit slop, and the largest is a pill, not a balloon.
 */
const SIZES = {
  lg: { height: 50, paddingHorizontal: 22, font: fontSize.body + 1 },
  md: { height: 44, paddingHorizontal: 18, font: fontSize.body },
  sm: { height: 40, paddingHorizontal: 15, font: fontSize.small + 1 },
} as const;

// Repeats every seven, which is long enough that no two neighbours in a row of three
// share a size.
const SIZE_PATTERN: (keyof typeof SIZES)[] = ['lg', 'md', 'sm', 'md', 'lg', 'sm', 'md'];

const ENTER_STAGGER_MS = 35;
const SELECT_SPRING = { damping: 12, stiffness: 380, mass: 0.6 };
const PRESS_SPRING = { damping: 18, stiffness: 520, mass: 0.5 };

/**
 * A stable number in [0, 1) for a bubble, so every bubble drifts differently but the
 * same bubble drifts the same way every time. Math.random would reshuffle the cloud on
 * every remount.
 */
function seeded(index: number, salt: number): number {
  const x = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

interface InterestBubbleProps {
  label: string;
  index: number;
  selected: boolean;
  /** Float up into place on mount. Off when returning to a screen already filled in. */
  animateIn: boolean;
  onPress: () => void;
}

export function InterestBubble({ label, index, selected, animateIn, onPress }: InterestBubbleProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const reduceMotion = useReducedMotion();
  const size = SIZES[SIZE_PATTERN[index % SIZE_PATTERN.length] ?? 'md'];

  /*
   * The drift: two loops on two axes with different periods, so the path never closes
   * into an obvious circle. A few points either way is enough to read as floating and
   * little enough that a bubble is always where the thumb expects it.
   */
  const driftX = useSharedValue(0);
  const driftY = useSharedValue(0);
  const amplitudeX = 3 + seeded(index, 1) * 4;
  const amplitudeY = 4 + seeded(index, 2) * 5;

  useEffect(() => {
    if (reduceMotion) return;
    const ease = Easing.inOut(Easing.sin);
    const periodX = 2600 + seeded(index, 3) * 1800;
    const periodY = 2200 + seeded(index, 4) * 1600;
    const loopX = withRepeat(withTiming(1, { duration: periodX, easing: ease }), -1, true);
    const loopY = withRepeat(withTiming(1, { duration: periodY, easing: ease }), -1, true);
    driftX.set(withDelay(seeded(index, 5) * 900, loopX));
    driftY.set(withDelay(seeded(index, 6) * 900, loopY));
    return () => {
      cancelAnimation(driftX);
      cancelAnimation(driftY);
    };
    // The shared values are stable by identity, and index never changes for a bubble.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduceMotion]);

  const fill = useDerivedValue(() => withTiming(selected ? 1 : 0, { duration: 200 }), [selected]);
  const lift = useDerivedValue(() => withSpring(selected ? 1.06 : 1, SELECT_SPRING), [selected]);
  const press = useSharedValue(1);

  const driftStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: (driftX.value - 0.5) * 2 * amplitudeX },
      { translateY: (driftY.value - 0.5) * 2 * amplitudeY },
    ],
  }));

  const pillStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(fill.value, [0, 1], [colors.surface, colors.accent]),
    borderColor: interpolateColor(fill.value, [0, 1], [colors.border, colors.accent]),
    transform: [{ scale: lift.value * press.value }],
  }));

  const labelStyle = useAnimatedStyle(() => ({
    color: interpolateColor(fill.value, [0, 1], [colors.text, colors.accentText]),
  }));

  return (
    <Animated.View
      entering={
        animateIn && !reduceMotion
          ? FadeInDown.delay(80 + index * ENTER_STAGGER_MS).springify().damping(15).stiffness(150)
          : undefined
      }>
      <Animated.View style={driftStyle}>
        <AnimatedPressable
          onPress={() => {
            Haptics.selectionAsync();
            onPress();
          }}
          onPressIn={() => {
            press.set(withSpring(0.93, PRESS_SPRING));
          }}
          onPressOut={() => {
            press.set(withSpring(1, PRESS_SPRING));
          }}
          hitSlop={4}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: selected }}
          accessibilityLabel={label}
          layout={LinearTransition.springify().damping(16)}
          style={[
            styles.pill,
            { height: size.height, paddingHorizontal: size.paddingHorizontal },
            selected ? colors.shadowLifted : colors.shadowSoft,
            pillStyle,
          ]}>
          {selected ? (
            <Animated.View entering={ZoomIn.duration(180)} style={styles.check}>
              <Ionicons name="checkmark" size={size.font + 1} color={colors.accentText} />
            </Animated.View>
          ) : null}
          <Animated.Text style={[styles.label, { fontSize: size.font }, labelStyle]} numberOfLines={1}>
            {label}
          </Animated.Text>
        </AnimatedPressable>
      </Animated.View>
    </Animated.View>
  );
}

const useStyles = makeStyles(() => ({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  check: {
    marginRight: 6,
  },
  label: {
    fontWeight: '600',
    letterSpacing: -0.1,
  },
}));
