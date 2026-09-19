import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import Animated, { useAnimatedStyle, useDerivedValue, withSpring } from 'react-native-reanimated';

import { fontSize, minTapTarget, radius, spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** Spring the pill settles on when pressed — short and slightly stiff, no visible bounce. */
const PRESS_SPRING = { damping: 18, stiffness: 320, mass: 0.5 };

interface SearchBarProps {
  onPress: () => void;
}

/**
 * The collapsed search affordance at the top of Home. It never takes input itself —
 * tapping hands off to SearchOverlay, which owns the field, the results and the
 * keyboard. Keeping it inert is what lets it sit inside Home's ScrollView without
 * a focused TextInput fighting the scroll for gestures.
 */
export function SearchBar({ onPress }: SearchBarProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const [pressed, setPressed] = useState(false);

  // Derived from state rather than written to from the press handlers: the spring still
  // runs on the UI thread, but nothing mutates a shared value from JS.
  const scale = useDerivedValue(() => withSpring(pressed ? 0.97 : 1, PRESS_SPRING), [pressed]);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      accessibilityRole="search"
      accessibilityLabel="Search jobs and companies"
      style={[styles.pill, animatedStyle]}>
      <Ionicons name="search" size={18} color={colors.textTertiary} />
      <Text style={styles.placeholder}>Search jobs and companies</Text>
    </AnimatedPressable>
  );
}

const useStyles = makeStyles((colors) => ({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: minTapTarget,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.backgroundMuted,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  placeholder: {
    fontSize: fontSize.body,
    color: colors.textTertiary,
  },
}));
