import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import * as WebBrowser from 'expo-web-browser';

import { commentGateKey } from '@/hooks/useComments';
import {
  confirmEduVerification,
  fetchCommentGate,
  fetchVerifications,
  startEduVerification,
  startIdentityVerification,
} from '@/lib/api';
import { isServiceConfigured } from '@/lib/service';
import type { EduChallenge, VerificationState } from '@/types';

/**
 * README §3.2's ladder, as the verification screen uses it.
 *
 * Two things this hook is deliberately shaped around:
 *
 * **The two paths are siblings, not a fallback chain.** `edu` and `identity` both open the composer
 * and differ only in the badge. So both are offered at once, and `startIdentity` is not hidden
 * behind a failed `startEdu` — the bootcamp grad, the career switcher and the student at a `.ac.uk`
 * school would never reach it if it were.
 *
 * **Verification can be unavailable.** Both paths run through `server/`, because one needs an email
 * provider and the other a vendor's signing secret. On a build with no `EXPO_PUBLIC_API_URL` the
 * screen says so rather than failing a request nobody can diagnose — `isConfigured` is what it reads.
 */

export function verificationKey(userId: string | null) {
  return ['verification', userId ?? 'anonymous'] as const;
}

export interface VerificationActions extends VerificationState {
  isLoading: boolean;
  /** False on a build with no API service — both paths need one. */
  isConfigured: boolean;
  /** Sends a code to a school address. Rejects with a `ServiceError` the screen branches on. */
  startEdu: (email: string) => Promise<EduChallenge>;
  confirmEdu: (code: string) => Promise<{ school: string; badge: string | null }>;
  /** Opens the vendor's hosted flow. The document never touches CareerDeck. */
  startIdentity: () => Promise<void>;
  refresh: () => void;
}

export function useVerification(userId: string | null): VerificationActions {
  const queryClient = useQueryClient();
  const key = useMemo(() => verificationKey(userId), [userId]);

  /*
   * The tier comes from the gate rather than from a second read of `profiles`.
   *
   * `comment_gate()` already computes it, the composer already reads it, and two sources for "can
   * this account comment" is the drift §3.2's ladder can least afford — a screen that says
   * "Verified" over a composer that refuses is worse than either alone.
   */
  const gate = useQuery({
    queryKey: commentGateKey(),
    queryFn: fetchCommentGate,
    enabled: userId !== null,
    staleTime: 60_000,
  });

  const rows = useQuery({
    queryKey: key,
    queryFn: fetchVerifications,
    enabled: userId !== null,
    staleTime: 60_000,
  });

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: commentGateKey() });
    void queryClient.invalidateQueries({ queryKey: key });
  }, [queryClient, key]);

  const startEdu = useMutation({
    mutationFn: (email: string) => startEduVerification(email),
    // A pending verification is now on the account, which the screen shows as "we sent a code".
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: key }),
  });

  const confirmEdu = useMutation({
    mutationFn: (code: string) => confirmEduVerification(code),
    onSuccess: refresh,
  });

  const startIdentity = useMutation({
    mutationFn: async () => {
      const { url } = await startIdentityVerification();
      /*
       * Opened in the system browser sheet, not a WebView.
       *
       * The vendor's flow uses the camera and asks for a government document, and both of those
       * belong in a browser the user recognises as a browser. It also means the capture never
       * passes through our JavaScript context, which is the property §3.2 cares about: we cannot
       * store what we never receive.
       */
      await WebBrowser.openBrowserAsync(url);
      /*
       * No result is read back. The outcome arrives as a signed webhook to the service, so the
       * screen refreshes and waits rather than trusting whatever the browser returned — a client
       * that could report its own verification outcome is a client that could grant itself one.
       */
      refresh();
    },
  });

  const tier = gate.data?.tier ?? 'none';

  return {
    tier,
    canComment: tier === 'edu' || tier === 'identity',
    badge: gate.data?.badge ?? null,
    handle: gate.data?.handle ?? null,
    eduExpiresAt: rows.data?.eduExpiresAt ?? null,
    pendingEduEmail: rows.data?.pendingEduEmail ?? null,
    isLoading: (gate.isPending || rows.isPending) && userId !== null,
    isConfigured: isServiceConfigured(),
    startEdu: startEdu.mutateAsync,
    confirmEdu: confirmEdu.mutateAsync,
    startIdentity: startIdentity.mutateAsync,
    refresh,
  };
}
