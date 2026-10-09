import { useRouter } from 'expo-router';
import { TopTabs } from 'expo-router/js-top-tabs';
import { useEffect, useState } from 'react';

import { FloatingTabBar, type FloatingTabBarProps } from '@/components/navigation/FloatingTabBar';
import { useCareerDeck } from '@/context/CareerDeckContext';
import { TabBarVisibilityProvider } from '@/context/TabBarVisibilityContext';
import { claimPaywallMoment } from '@/lib/paywallPrompts';
import { tourJustFinished } from '@/lib/tour';

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
  // The first-run tour ends on "Start swiping", so the app it hands over to opens on the Deck.
  const [openOnDeck] = useState(tourJustFinished);
  return (
    <TabBarVisibilityProvider>
      <TopTabs
        initialRouteName={openOnDeck ? 'reels' : undefined}
        tabBar={(props: FloatingTabBarProps) => <FloatingTabBar {...props} />}
        tabBarPosition="bottom">
        {/*
          * Home keeps the pager, and the gesture is settled by who is underneath the
          * finger rather than by turning anything off.
          *
          * This was `swipeEnabled: false` for a while, on the reasoning that a feed row's
          * pan could never beat react-native-pager-view — a native pager that intercepts
          * horizontal drags and offers no handler ref to block. That reasoning skipped a
          * step: gesture-handler calls `requestDisallowInterceptTouchEvent` on the native
          * parent the moment one of its own handlers activates, which is exactly the
          * mechanism for a child winning an axis back from a scrolling ancestor.
          *
          * So the arrangement is the ordinary nested one. A pan that starts on a feed card
          * is claimed by the card after 14px across and hides the posting; one that starts
          * on the stories or suggestions rail scrolls that rail; and one that starts
          * anywhere else — the gaps between cards, the header, the sort bar — reaches the
          * pager and moves to the Deck.
          */}
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
    // Not over the end of the tour: the reader was just handed four free Auto Applies, and a
    // paywall sliding up over that reads as a bait and switch. It waits for the next launch.
    if (!ready || isPro || userId === null || tourJustFinished()) return;
    // Claimed only when it is about to open, so a re-render inside the delay cannot spend it.
    const timer = setTimeout(() => {
      void claimPaywallMoment('welcome', userId).then((first) => {
        if (first) router.push({ pathname: '/paywall', params: { from: 'welcome' } });
      });
    }, WELCOME_PAYWALL_DELAY_MS);
    return () => clearTimeout(timer);
  }, [ready, isPro, userId, router]);
}
