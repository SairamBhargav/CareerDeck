import { Tabs } from 'expo-router/js-tabs';

import { FloatingTabBar } from '@/components/navigation/FloatingTabBar';
import { TabBarVisibilityProvider } from '@/context/TabBarVisibilityContext';

export default function TabsLayout() {
  return (
    <TabBarVisibilityProvider>
      <Tabs
        screenOptions={{ headerShown: false }}
        tabBar={(props) => <FloatingTabBar {...props} />}>
        <Tabs.Screen name="index" options={{ title: 'Home' }} />
        <Tabs.Screen name="reels" options={{ title: 'Reels' }} />
        <Tabs.Screen name="activity" options={{ title: 'Activity' }} />
      </Tabs>
    </TabBarVisibilityProvider>
  );
}
