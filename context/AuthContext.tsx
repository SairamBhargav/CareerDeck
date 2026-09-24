import type { Session } from '@supabase/supabase-js';
import * as AppleAuthentication from 'expo-apple-authentication';
import { makeRedirectUri } from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Platform } from 'react-native';

import { DEV_TEST_EMAIL, DEV_TEST_PASSWORD } from '@/lib/env';
import { SKIP_AUTH } from '@/lib/env';
import { MOCK_SESSION } from '@/lib/mockSession';
import { identifyUser, reportError } from '@/lib/observability';
import { queryClient } from '@/lib/query-client';
import { supabase } from '@/lib/supabase';

/**
 * Who is signed in, and the three ways to become so.
 *
 * Phase 0's exit condition is "sign in on a device, edit your profile, it survives a
 * restart". The surviving part is lib/supabase.ts; this file is the signing in.
 *
 * All three paths land in the same place: a Supabase session, which triggers
 * handle_auth_user_change() in the database to provision a profile row. Nothing here
 * writes to `profiles` — a client that could would be a client that could write someone
 * else's.
 */

/** Finishes a web popup sign-in. No-op on native, required on web. */
WebBrowser.maybeCompleteAuthSession();

interface AuthState {
  session: Session | null;
  userId: string | null;
  /**
   * False until the stored session has been read off disk. Everything above this waits
   * on it — rendering the sign-in screen before we know is a flash of the wrong app.
   */
  isResolved: boolean;
  /** Sign in with Apple exists on iOS only, and only where the device supports it. */
  isAppleAvailable: boolean;
  /** Emails a six-digit code. Resolves when it has been sent, not when it's used. */
  sendEmailCode: (email: string) => Promise<void>;
  verifyEmailCode: (email: string, code: string) => Promise<void>;
  signInWithApple: () => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  /**
   * Signs in as a fixed password-auth test account, entirely bypassing email delivery.
   *
   * Null except when `__DEV__` is true *and* EXPO_PUBLIC_DEV_TEST_EMAIL /
   * EXPO_PUBLIC_DEV_TEST_PASSWORD are both set — app/sign-in.tsx renders its shortcut
   * button only when this is non-null, so there is one gate to reason about rather than
   * the screen and the context each deciding separately. `__DEV__` is false in every
   * release build no matter what the env vars hold, which is what makes this safe to
   * leave wired rather than something to remember to strip out before shipping.
   *
   * The account itself has to exist first — scripts/create-dev-user.mjs provisions it
   * against whichever project SUPABASE_URL points at.
   */
  signInDev: (() => Promise<void>) | null;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

/**
 * Raised when the user backs out of a provider sheet. Callers swallow it: an abandoned
 * sign-in is a decision, not a failure, and showing an error for one is obnoxious.
 */
export class SignInCancelled extends Error {
  constructor() {
    super('Sign-in cancelled');
    this.name = 'SignInCancelled';
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // SKIP_AUTH starts already "signed in", so nothing above this waits on a session read
  // that would never resolve to one — see lib/mockSession.ts.
  const [session, setSession] = useState<Session | null>(SKIP_AUTH ? MOCK_SESSION : null);
  const [isResolved, setIsResolved] = useState(SKIP_AUTH);
  const [isAppleAvailable, setIsAppleAvailable] = useState(false);

  useEffect(() => {
    if (SKIP_AUTH) return;
    let active = true;

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!active) return;
        setSession(data.session);
        setIsResolved(true);
      })
      .catch((error: unknown) => {
        if (!active) return;
        // A session that can't be read is a session the user doesn't have. Report it and
        // show the sign-in screen rather than hanging on the splash forever.
        reportError(error, { where: 'getSession' });
        setIsResolved(true);
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, next) => {
      // Deliberately synchronous. Supabase serialises auth callbacks, so awaiting
      // another auth call in here deadlocks the client.
      setSession(next);
      setIsResolved(true);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    AppleAuthentication.isAvailableAsync()
      .then(setIsAppleAvailable)
      .catch(() => setIsAppleAvailable(false));
  }, []);

  const userId = session?.user.id ?? null;

  useEffect(() => {
    identifyUser(userId);
  }, [userId]);

  const sendEmailCode = useCallback(async (email: string) => {
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        // Signup and sign-in are the same gesture here: §3.2 opens signup to any email
        // and puts the gate on commenting instead.
        shouldCreateUser: true,
      },
    });
    if (error) throw error;
  }, []);

  const verifyEmailCode = useCallback(async (email: string, code: string) => {
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: code.trim(),
      type: 'email',
    });
    if (error) throw error;
  }, []);

  const signInWithApple = useCallback(async () => {
    let credential: AppleAuthentication.AppleAuthenticationCredential;
    try {
      credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'ERR_REQUEST_CANCELED') throw new SignInCancelled();
      throw error;
    }

    if (!credential.identityToken) {
      throw new Error('Apple did not return an identity token.');
    }

    const { error } = await supabase.auth.signInWithIdToken({
      provider: 'apple',
      token: credential.identityToken,
    });
    if (error) throw error;

    // Apple sends the name exactly once, on the very first authorisation, and never
    // again. If it isn't copied into user metadata now it is gone for good — and
    // handle_auth_user_change() reads it from there to fill in the profile.
    if (credential.fullName?.givenName || credential.fullName?.familyName) {
      const { error: updateError } = await supabase.auth.updateUser({
        data: {
          given_name: credential.fullName.givenName ?? undefined,
          family_name: credential.fullName.familyName ?? undefined,
        },
      });
      if (updateError) reportError(updateError, { where: 'appleNameBackfill' });
    }
  }, []);

  const signInWithGoogle = useCallback(async () => {
    // In Expo Go this is an `exp://…` URL and in a build it is `careerdeck://`. Both
    // have to be listed in the Supabase project's redirect allow-list or the provider
    // refuses the round trip.
    const redirectTo = makeRedirectUri();

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo, skipBrowserRedirect: true },
    });
    if (error) throw error;
    if (!data.url) throw new Error('Google sign-in could not be started.');

    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    if (result.type !== 'success') throw new SignInCancelled();

    await completeOAuthRedirect(result.url);
  }, []);

  const signInDev = useCallback(async () => {
    // Guarded again here, not just at the call site: `run()` in the sign-in screen
    // reads this straight off the button's onPress, and a stale closure from a hot
    // reload is not a case worth trusting the outer null-check alone to cover.
    if (!DEV_TEST_EMAIL || !DEV_TEST_PASSWORD) {
      throw new Error('EXPO_PUBLIC_DEV_TEST_EMAIL / EXPO_PUBLIC_DEV_TEST_PASSWORD are not set.');
    }

    const { error } = await supabase.auth.signInWithPassword({
      email: DEV_TEST_EMAIL,
      password: DEV_TEST_PASSWORD,
    });
    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    if (SKIP_AUTH) {
      // The real client was never signed in — there is nothing for supabase.auth to
      // sign out of. Dropping the fabricated session is the whole of it.
      setSession(null);
      queryClient.clear();
      return;
    }

    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    // Everything cached is scoped to the account that just left. Clearing after the
    // sign-out — not before — means a failed sign-out leaves the session intact.
    queryClient.clear();
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      session,
      userId,
      isResolved,
      isAppleAvailable,
      sendEmailCode,
      verifyEmailCode,
      signInWithApple,
      signInWithGoogle,
      // The null-vs-function decision lives here, once, rather than being re-checked by
      // every caller: __DEV__ is a constant per bundle, so this never toggles mid-session.
      signInDev: __DEV__ && DEV_TEST_EMAIL && DEV_TEST_PASSWORD ? signInDev : null,
      signOut,
    }),
    [
      session,
      userId,
      isResolved,
      isAppleAvailable,
      sendEmailCode,
      verifyEmailCode,
      signInWithApple,
      signInWithGoogle,
      signInDev,
      signOut,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * Turns the URL the provider redirected back to into a session.
 *
 * The client runs PKCE, so the happy path is a `code` to exchange. The implicit-flow
 * shape is handled too because which one you get depends on project configuration, and
 * a sign-in that works on one project and silently does nothing on another is a bad way
 * to spend an afternoon.
 */
async function completeOAuthRedirect(url: string): Promise<void> {
  const params = parseRedirectParams(url);

  if (params.error_description || params.error) {
    throw new Error(params.error_description ?? params.error ?? 'Sign-in failed.');
  }

  if (params.code) {
    const { error } = await supabase.auth.exchangeCodeForSession(params.code);
    if (error) throw error;
    return;
  }

  if (params.access_token && params.refresh_token) {
    const { error } = await supabase.auth.setSession({
      access_token: params.access_token,
      refresh_token: params.refresh_token,
    });
    if (error) throw error;
    return;
  }

  throw new Error('Sign-in did not return a session.');
}

/** Supabase puts these in the query string or the fragment depending on the flow. */
function parseRedirectParams(url: string): Record<string, string> {
  const params: Record<string, string> = {};

  for (const part of [url.split('?')[1], url.split('#')[1]]) {
    if (!part) continue;
    for (const [key, value] of new URLSearchParams(part.split('#')[0])) {
      params[key] = value;
    }
  }

  return params;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside an <AuthProvider>.');
  }
  return context;
}
