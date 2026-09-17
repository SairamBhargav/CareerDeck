import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useSharedValue, type SharedValue } from 'react-native-reanimated';

/**
 * A single Reanimated shared value, shared between the floating tab bar and whichever
 * screen is currently scrolling. Scroll handlers mutate it on the UI thread; the tab bar
 * reads it in an animated style. Using a shared value (instead of React state) means the
 * hide/show animation stays smooth even while a list is actively scrolling.
 */
interface TabBarVisibilityValue {
  /** 0 = tab bar fully shown, tabBarHeight = fully hidden below the screen edge. */
  hiddenOffset: SharedValue<number>;
}

const TabBarVisibilityContext = createContext<TabBarVisibilityValue | null>(null);

export function TabBarVisibilityProvider({ children }: { children: ReactNode }) {
  const hiddenOffset = useSharedValue(0);
  const value = useMemo(() => ({ hiddenOffset }), [hiddenOffset]);

  return <TabBarVisibilityContext.Provider value={value}>{children}</TabBarVisibilityContext.Provider>;
}

export function useTabBarVisibility(): TabBarVisibilityValue {
  const context = useContext(TabBarVisibilityContext);
  if (!context) {
    throw new Error('useTabBarVisibility must be used inside a <TabBarVisibilityProvider>.');
  }
  return context;
}
