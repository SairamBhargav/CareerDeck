import { useRouter } from 'expo-router';
import { TopTabs } from 'expo-router/js-top-tabs';
import { useEffect } from 'react';

import { FloatingTabBar, type FloatingTabBarProps } from '@/components/navigation/FloatingTabBar';
import { useCareerDeck } from '@/context/CareerDeckContext';
import { TabBarVisibilityProvider } from '@/context/TabBarVisibilityContext';
import { claimPaywallMoment } from '@/lib/paywallPrompts';

/**
 * Home / Deck / Activity ride on a swipeable top-tabs navigator (react-native-tab-view,
 * which is what actually gives horizontal swipe-to-switch between them) even though there's
 * no visible top bar — FloatingTabBar is passed in as the custom `tabBar` render and
 * positions itself at the bottom via its own absolute styling, same as it did on the
 * plain bottom-tabs navigator this replaced.
 *
 * The Deck tab keeps the route name `reels` — only its label changed, and renaming the
 * file would break every `/reels` push in the app for a string the user never sees.
 */
export default function TabsLayout() {
  useWelcomePaywall();
  return (
    <TabBarVisibilityProvider>
      <TopTabs
        tabBar={(props: FloatingTabBarProps) => <FloatingTabBar {...props} />}
        tabBarPosition="bottom">
        <TopTabs.Screen name="index" options={{ title: 'Home' }} />
        <TopTabs.Screen name="reels" options={{ title: 'Deck' }} />
        <TopTabs.Screen name="activity" options={{ title: 'Activity' }} />
      </TopTabs>
    </TabBarVisibilityProvider>
  );
}

/** Long enough for the first feed to paint, so the paywall arrives over the app, not instead of it. */
const WELCOME_PAYWALL_DELAY_MS = 1500;

/**
 * The paywall opens by itself once per account, the first time someone lands in the app after
 * onboarding. Waits for the plan to be known, so a subscriber never sees it.
 */
function useWelcomePaywall() {
  const router = useRouter();
  const { user, credits } = useCareerDeck();
  const userId = user?.id ?? null;
  const ready = userId !== null && !credits.isLoading;
  const isPro = credits.isPro;

  useEffect(() => {
    if (!ready || isPro || userId === null) return;
    // Claimed only when it is about to open, so a re-render inside the delay cannot spend it.
    const timer = setTimeout(() => {
      void claimPaywallMoment('welcome', userId).then((first) => {
        if (first) router.push({ pathname: '/paywall', params: { from: 'welcome' } });
      });
    }, WELCOME_PAYWALL_DELAY_MS);
    return () => clearTimeout(timer);
  }, [ready, isPro, userId, router]);
}
