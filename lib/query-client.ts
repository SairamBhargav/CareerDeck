import { QueryClient } from '@tanstack/react-query';

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
      // `refetchOnWindowFocus` is a browser idea. Phase 2 wires the native equivalent
      // (AppState + NetInfo through focusManager/onlineManager) alongside the offline
      // outbox, which is the point at which it starts to matter.
      refetchOnWindowFocus: false,
    },
    mutations: {
      // A failed write must surface, not silently retry into a double-apply. Every
      // mutation that is safe to repeat says so for itself.
      retry: 0,
    },
  },
});
