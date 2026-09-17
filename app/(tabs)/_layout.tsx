import { TopTabs } from 'expo-router/js-top-tabs';

import { FloatingTabBar, type FloatingTabBarProps } from '@/components/navigation/FloatingTabBar';
import { TabBarVisibilityProvider } from '@/context/TabBarVisibilityContext';

/**
 * Home / Reels / Activity ride on a swipeable top-tabs navigator (react-native-tab-view,
 * which is what actually gives horizontal swipe-to-switch between them) even though there's
 * no visible top bar — FloatingTabBar is passed in as the custom `tabBar` render and
 * positions itself at the bottom via its own absolute styling, same as it did on the
 * plain bottom-tabs navigator this replaced.
 */
export default function TabsLayout() {
  return (
    <TabBarVisibilityProvider>
      <TopTabs
        tabBar={(props: FloatingTabBarProps) => <FloatingTabBar {...props} />}
        tabBarPosition="bottom">
        <TopTabs.Screen name="index" options={{ title: 'Home' }} />
        <TopTabs.Screen name="reels" options={{ title: 'Reels' }} />
        <TopTabs.Screen name="activity" options={{ title: 'Activity' }} />
      </TopTabs>
    </TabBarVisibilityProvider>
  );
}
