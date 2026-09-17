import { useEffect } from 'react';
import { StyleSheet, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

import { radius } from '@/constants/theme';
import { makeStyles } from '@/context/ThemeContext';

interface SkeletonProps {
  width?: number | `${number}%`;
  height: number;
  borderRadius?: number;
  style?: ViewStyle;
}

/**
 * A single placeholder block, breathing between two opacities on an infinite loop.
 * Stand-in for content while a screen's data hasn't arrived yet — there's no real
 * async fetch behind Home's data today, so `CareerDeckProvider`'s `isInitialLoading`
 * is what actually gates how long these show for.
 */
export function Skeleton({ width, height, borderRadius = radius.md, style }: SkeletonProps) {
  const styles = useStyles();
  const pulse = useSharedValue(0);

  useEffect(() => {
    pulse.value = withRepeat(withTiming(1, { duration: 900 }), -1, true);
  }, [pulse]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: 0.5 + pulse.value * 0.35,
  }));

  return (
    <Animated.View
      style={[styles.block, { width, height, borderRadius }, animatedStyle, style]}
    />
  );
}

const useStyles = makeStyles((colors) => ({
  block: StyleSheet.flatten({
    backgroundColor: colors.borderStrong,
  }),
}));
