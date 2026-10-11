import { QueryClientProvider } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AccountGate } from '@/components/common/AccountGate';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { CareerDeckProvider, useCareerDeck } from '@/context/CareerDeckContext';
import { OnboardingProvider } from '@/context/OnboardingContext';
import { ThemeProvider, useTheme } from '@/context/ThemeContext';
import { initObservability, withObservability } from '@/lib/observability';
import { onNotificationTap, refreshPushRegistration } from '@/lib/push';
import { queryClient } from '@/lib/query-client';
import { ALWAYS_TOUR, tourJustFinished } from '@/lib/tour';

// Both before first paint: the splash has to already be held when the tree mounts, or
// there is a frame of empty app while the stored session is read off disk.
void SplashScreen.preventAutoHideAsync();
initObservability();

function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <ThemeProvider>
              {/* Inside AuthProvider: the store's identity and preferences are reads
                  against the signed-in user, so it needs to know who that is. */}
              {/* Outside CareerDeckProvider: the draft it holds belongs to someone who
                  does not have an account yet, so it cannot live anywhere that reads one. */}
              <OnboardingProvider>
                <CareerDeckProvider>
                  <RootNavigator />
                </CareerDeckProvider>
              </OnboardingProvider>
            </ThemeProvider>
          </AuthProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

export default withObservability(RootLayout);

/**
 * Split out from RootLayout so it sits *inside* ThemeProvider and can repaint the
 * navigator chrome — screen backgrounds and the native modal headers — along with
 * everything else when the scheme flips.
 *
 * It is also where the auth gate lives. `Stack.Protected` removes the screens behind a
 * false guard from the navigation state entirely, so signing out doesn't navigate away
 * from a tab, it stops that tab existing.
 */
function RootNavigator() {
  const { scheme, colors } = useTheme();
  const { session, isResolved, signOut } = useAuth();
  const { isInitialLoading, profileError, retryProfile, user } = useCareerDeck();

  const isSignedIn = session !== null;
  /*
   * A new account opens on the first-run tour, and on nothing else until it is done: the app's
   * own screens are behind the guard below until `tutorial_completed_at` is set. Accounts from
   * before the tour existed were stamped by its migration, so they never see it.
   */
  const needsTour =
    isSignedIn && user !== null && (user.tourCompletedAt === null || (ALWAYS_TOUR && !tourJustFinished()));
  // Signed out, there is nothing left to wait for. Signed in, the profile is what every
  // screen above reads from, so showing the app before it lands is showing a blank one.
  const isReady = isResolved && (!isSignedIn || !isInitialLoading);

  useEffect(() => {
    if (isReady) void SplashScreen.hideAsync();
  }, [isReady]);

  /*
   * Phase 7. A tapped push opens what it is about, and a signed-in launch quietly refreshes this
   * device's push registration if permission was already granted — tokens rotate. Neither prompts.
   */
  const router = useRouter();
  const canRoute = isReady && isSignedIn && !profileError;
  useEffect(() => {
    if (!canRoute) return;
    void refreshPushRegistration().catch(() => undefined);
    return onNotificationTap((url) => router.push(url as never));
  }, [canRoute, router]);

  if (!isReady) return null;

  if (isSignedIn && profileError) {
    return (
      <AccountGate
        message={profileError.message}
        onRetry={retryProfile}
        onSignOut={() => void signOut()}
      />
    );
  }

  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          contentStyle: { backgroundColor: colors.background },
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.text,
          headerTitleStyle: { color: colors.text },
        }}>
        <Stack.Protected guard={needsTour}>
          <Stack.Screen name="tour" options={{ headerShown: false, gestureEnabled: false, animation: 'fade' }} />
        </Stack.Protected>

        <Stack.Protected guard={isSignedIn && !needsTour}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false, animation: 'fade' }} />
          <Stack.Screen name="profile" options={{ headerShown: false }} />
          <Stack.Screen name="settings" options={{ headerShown: false }} />
          <Stack.Screen name="verify" options={{ headerShown: false }} />
          {/*
            * A modal, not a pushed screen. It is a step in an upload the user just started, and
            * it has to be dismissable without anywhere to go back to — Activity is underneath
            * it and is where they came from.
            */}
          <Stack.Screen
            /*
              Over the document, not instead of it. The viewer below is a route for this
              reason — see components/activity/ResumeViewer.tsx — so this presents on top of
              it and swiping it away reveals the PDF it was describing.
            */
            name="resume-review"
            options={{ presentation: 'modal', headerShown: false }}
          />
          <Stack.Screen name="collection/[type]" options={{ headerShown: false }} />
          <Stack.Screen name="inbox" options={{ headerShown: false }} />
          {/*
            * Full-screen so it covers the floating tab bar, which is what the native Modal
            * this replaced was really for. Being a route rather than a Modal is what lets
            * a company sheet open over a story and hand it back on dismissal.
            */}
          <Stack.Screen
            name="story"
            options={{ headerShown: false, presentation: 'fullScreenModal', animation: 'slide_from_bottom' }}
          />
          {/* Phase 6. A modal for the same reason as resume-review: it is reached from inside a
              flow (an empty Auto Apply balance), and closing it should land back in that flow.
              Full screen since 2026-10-06: the paywall is its own dark stage, not a card. */}
          <Stack.Screen
            name="paywall"
            options={{ presentation: 'fullScreenModal', headerShown: false, contentStyle: { backgroundColor: scheme === 'dark' ? '#07060D' : '#F7F5FF' } }}
          />
          {/* The PDF itself. A route rather than a modal so the parse review can sit over it. */}
          <Stack.Screen
            name="resume/[id]"
            options={{ presentation: 'fullScreenModal', headerShown: false, animation: 'slide_from_bottom' }}
          />
          <Stack.Screen name="job/[id]" options={{ presentation: 'modal', title: 'Job details' }} />
          {/* Chevron only: iOS labels the back button with the previous screen's title, and the
              tabs have none, so it read "(tabs)". A company opens from several places, so no
              single label would be right anyway. */}
          <Stack.Screen
            name="company/[id]"
            /*
             * No native header. It was `title: ''` with a minimal back button, which draws
             * an empty bar across the top of the screen — the blank strip above the brand
             * wash — and hands the back control to the OS, which gives it its own circular
             * backing. The page draws its own chevron over the wash instead, so the
             * company's colour reaches the top of the screen.
             *
             * `modal` because this is a thing you look at and leave, not somewhere you go.
             * It arrives from the bottom and can be flicked away downwards, which is what
             * a reader expects of a sheet and what they cannot do with a pushed card.
             */
            options={{ headerShown: false, presentation: 'modal' }}
          />
        </Stack.Protected>

        <Stack.Protected guard={!isSignedIn}>
          {/* `welcome` is first, so it is what a signed-out launch lands on. Sign-in is
              still reachable from it, for people who already have an account. */}
          <Stack.Screen name="welcome" options={{ headerShown: false }} />
          <Stack.Screen name="onboarding/role" options={{ headerShown: false }} />
          <Stack.Screen name="onboarding/interests" options={{ headerShown: false }} />
          <Stack.Screen name="onboarding/companies" options={{ headerShown: false }} />
          <Stack.Screen name="onboarding/goal" options={{ headerShown: false }} />
          <Stack.Screen name="sign-up" options={{ headerShown: false }} />
          <Stack.Screen name="sign-in" options={{ headerShown: false }} />
        </Stack.Protected>
      </Stack>
    </>
  );
}
