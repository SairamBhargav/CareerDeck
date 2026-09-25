import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { StartupError } from '@/components/common/StartupError';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { CareerDeckProvider, useCareerDeck } from '@/context/CareerDeckContext';
import { ThemeProvider, useTheme } from '@/context/ThemeContext';
import { initObservability, withObservability } from '@/lib/observability';
import { queryClient } from '@/lib/query-client';

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
              <CareerDeckProvider>
                <RootNavigator />
              </CareerDeckProvider>
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
  const { isInitialLoading, profileError, retryProfile } = useCareerDeck();

  const isSignedIn = session !== null;
  // Signed out, there is nothing left to wait for. Signed in, the profile is what every
  // screen above reads from, so showing the app before it lands is showing a blank one.
  const isReady = isResolved && (!isSignedIn || !isInitialLoading);

  useEffect(() => {
    if (isReady) void SplashScreen.hideAsync();
  }, [isReady]);

  if (!isReady) return null;

  if (isSignedIn && profileError) {
    return (
      <StartupError
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
        <Stack.Protected guard={isSignedIn}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="profile" options={{ headerShown: false }} />
          <Stack.Screen name="settings" options={{ headerShown: false }} />
          <Stack.Screen name="verify" options={{ headerShown: false }} />
          {/*
            * A modal, not a pushed screen. It is a step in an upload the user just started, and
            * it has to be dismissable without anywhere to go back to — Activity is underneath
            * it and is where they came from.
            */}
          <Stack.Screen
            name="resume-review"
            options={{ presentation: 'modal', headerShown: false }}
          />
          <Stack.Screen name="collection/[type]" options={{ headerShown: false }} />
          <Stack.Screen name="job/[id]" options={{ presentation: 'modal', title: 'Job details' }} />
          <Stack.Screen name="company/[id]" options={{ title: '' }} />
        </Stack.Protected>

        <Stack.Protected guard={!isSignedIn}>
          <Stack.Screen name="sign-in" options={{ headerShown: false }} />
        </Stack.Protected>
      </Stack>
    </>
  );
}
