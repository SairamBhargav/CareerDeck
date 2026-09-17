import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { tabBarHeight } from '@/constants/theme';

/**
 * Total space the floating tab bar occupies at the bottom of the screen, safe-area inset
 * included. The bar is absolutely positioned, so any screen it floats over needs to add
 * this as scroll content padding itself.
 */
export function useTabBarHeight(): number {
  const insets = useSafeAreaInsets();
  return tabBarHeight + insets.bottom;
}
