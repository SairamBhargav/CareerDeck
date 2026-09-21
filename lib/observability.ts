import type { ComponentType } from 'react';

import { SENTRY_DSN } from '@/lib/env';

/**
 * Sentry, wired but dormant until a DSN exists.
 *
 * §14 wants error reporting from day one. The catch is that @sentry/react-native is a
 * native module: it needs a development build and does not exist in Expo Go. So the
 * import is deferred behind `require` and only ever evaluated when EXPO_PUBLIC_SENTRY_DSN
 * is set. With no DSN — the default, and what Expo Go will always see — nothing here
 * touches a native binding and every call below is a no-op.
 *
 * Metro still bundles the module (the require path is a literal), so turning Sentry on
 * is a matter of setting the DSN and making a development build. No code changes.
 */

type SentryModule = typeof import('@sentry/react-native');

let cached: SentryModule | null = null;

function sentry(): SentryModule | null {
  if (!SENTRY_DSN) return null;
  if (!cached) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cached = require('@sentry/react-native') as SentryModule;
  }
  return cached;
}

export function initObservability(): void {
  const Sentry = sentry();
  if (!Sentry) return;

  Sentry.init({
    dsn: SENTRY_DSN,
    // Traces are sampled down hard because the interesting signal in phase 0 is crashes,
    // not latency. §14 turns this up once there is an API service worth tracing.
    tracesSampleRate: 0.1,
    // Resumes, applications and comments all pass through this app. Default PII
    // collection is off until §13.2's data classes are actually enforced.
    sendDefaultPii: false,
    enabled: !__DEV__,
  });
}

/** Wraps the root component for native crash + navigation instrumentation. */
export function withObservability<P extends object>(Component: ComponentType<P>): ComponentType<P> {
  const Sentry = sentry();
  if (!Sentry) return Component;
  // Sentry.wrap is declared over `ComponentType<Record<string, unknown>>` and passes the
  // props straight through, so the cast is safe and the alternative is giving up the
  // root layout's own prop types.
  return Sentry.wrap(Component as ComponentType<Record<string, unknown>>) as ComponentType<P>;
}

/**
 * Reports an error that was handled but shouldn't have happened.
 *
 * Without a DSN it logs, so a failure is never silent just because observability is off.
 */
export function reportError(error: unknown, context?: Record<string, unknown>): void {
  const Sentry = sentry();
  if (Sentry) {
    Sentry.captureException(error, context ? { extra: context } : undefined);
    return;
  }
  console.error('[careerdeck]', error, context ?? '');
}

/**
 * Ties subsequent events to the signed-in account. Called on every session change.
 *
 * The id is enough to find the account in Supabase; email and name deliberately are not
 * sent, because §13.2 classes them as P1 and Sentry is not on the subprocessor list.
 */
export function identifyUser(userId: string | null): void {
  sentry()?.setUser(userId ? { id: userId } : null);
}
