import { QueryClient, focusManager } from '@tanstack/react-query';
import { AppState, Platform } from 'react-native';

/**
 * The server cache. Appendix A of docs/README.md picks TanStack Query for this, and
 * phase 1's paginated feed and phase 2's optimistic mutations both build on it.
 *
 * A module singleton rather than a `useState` in the provider, so signing out can clear
 * it from outside the tree — see context/AuthContext.tsx.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A profile does not change behind the user's back. Long enough that moving
      // between Home, Profile and Settings never refetches; short enough that an edit
      // made on another device lands within a session.
      staleTime: 60_000,
      // Mobile networks fail transiently. Two retries with the default backoff is the
      // difference between a lost tunnel and an error screen.
      retry: 2,
      // The native equivalent of a window focus is the app coming back to the
      // foreground, which the AppState bridge below reports. Left on, so a session
      // resumed after an hour in a pocket revalidates rather than rendering an hour-old
      // feed as though it were current.
      refetchOnWindowFocus: true,
    },
    mutations: {
      // A failed write must surface, not silently retry into a double-apply. Every
      // mutation that is safe to repeat says so for itself.
      retry: 0,
    },
  },
});

/**
 * "Window focus" on a phone is the app returning to the foreground.
 *
 * TanStack Query's default listener watches browser events that do not exist here, so
 * without this bridge `refetchOnWindowFocus` never fires at all. The `onlineManager` half
 * of the pair is still unwired: it wants `@react-native-community/netinfo`, which is a
 * native module and therefore a development build, and until that trade is worth making
 * `lib/outbox.ts` covers reconnection for the writes — which is the half that matters,
 * because a stale read corrects itself and a lost write does not.
 */
if (Platform.OS !== 'web' || typeof document !== 'undefined') {
  AppState.addEventListener('change', (state) => {
    focusManager.setFocused(state === 'active');
  });
}
