import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { Pressable } from 'react-native';
import Animated, {
  Easing,
  FadeInDown,
  LinearTransition,
  ZoomIn,
  interpolateColor,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
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
// Eased, not sprung. The lift on select is the motion; a spring added a wobble after it.
const SELECT_TIMING = { duration: 220, easing: Easing.out(Easing.cubic) };
const PRESS_TIMING = { duration: 120, easing: Easing.out(Easing.quad) };

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

  const fill = useDerivedValue(() => withTiming(selected ? 1 : 0, { duration: 200 }), [selected]);
  const lift = useDerivedValue(() => withTiming(selected ? 1.06 : 1, SELECT_TIMING), [selected]);
  const press = useSharedValue(1);

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
      <AnimatedPressable
        onPress={() => {
          Haptics.selectionAsync();
          onPress();
        }}
        onPressIn={() => {
          press.set(withTiming(0.95, PRESS_TIMING));
        }}
        onPressOut={() => {
          press.set(withTiming(1, PRESS_TIMING));
        }}
        hitSlop={4}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: selected }}
        accessibilityLabel={label}
        layout={LinearTransition.duration(200).easing(Easing.out(Easing.cubic))}
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
