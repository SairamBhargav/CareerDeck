import { useAnimatedScrollHandler, useSharedValue, withTiming } from 'react-native-reanimated';

import { useTabBarVisibility } from '@/context/TabBarVisibilityContext';

/** Always show the tab bar within this many px of the top, even mid-bounce. */
const TOP_THRESHOLD = 24;
/** Ignore sub-pixel/bounce jitter smaller than this before treating it as a real swipe. */
const DIRECTION_THRESHOLD = 8;
const ANIMATION_DURATION = 220;

/**
 * Wires a scrollable screen up to the floating tab bar: scrolling down hides it, scrolling
 * up (or reaching the top) brings it back, Instagram-feed style. Attach the returned handler
 * to an Animated.ScrollView / Animated.FlatList's `onScroll` with `scrollEventThrottle={16}`.
 */
export function useHideTabBarOnScroll(totalTabBarHeight: number) {
  const { hiddenOffset } = useTabBarVisibility();
  const lastOffsetY = useSharedValue(0);

  return useAnimatedScrollHandler({
    onScroll: (event) => {
      'worklet';
      const y = event.contentOffset.y;
      const delta = y - lastOffsetY.value;

      if (y <= TOP_THRESHOLD) {
        hiddenOffset.value = withTiming(0, { duration: ANIMATION_DURATION });
      } else if (delta > DIRECTION_THRESHOLD) {
        hiddenOffset.value = withTiming(totalTabBarHeight, { duration: ANIMATION_DURATION });
      } else if (delta < -DIRECTION_THRESHOLD) {
        hiddenOffset.value = withTiming(0, { duration: ANIMATION_DURATION });
      }

      lastOffsetY.value = y;
    },
  });
}
