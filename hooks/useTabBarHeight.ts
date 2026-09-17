import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { tabBarFloatGap, tabBarHeight } from '@/constants/theme';

/**
 * Total space the floating tab bar pill occupies at the bottom of the screen: its own
 * height, the gap it hovers above the safe area, and the safe-area inset itself. The bar
 * is absolutely positioned, so any screen it floats over needs to add this as scroll
 * content padding itself — and it doubles as the distance the bar travels when it hides.
 */
export function useTabBarHeight(): number {
  const insets = useSafeAreaInsets();
  return tabBarHeight + tabBarFloatGap + insets.bottom;
}
