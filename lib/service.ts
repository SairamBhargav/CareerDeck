/**
 * The other seam — the one that talks to `server/` instead of to Postgres.
 *
 * [`lib/api.ts`](./api.ts) is the seam for everything expressible in RLS, which through phase 2
 * was everything. This file is the seam for what is not: a comment has to pass a moderation
 * classifier, and an address has to be emailed a code. Both need a secret, and a secret in an
 * Expo bundle is a published secret.
 *
 * Keeping the two seams separate rather than hiding the difference inside `lib/api.ts` is
 * deliberate. These calls have properties the Supabase ones do not, and the callers need to know:
 *
 *  - **They can be unavailable.** `EXPO_PUBLIC_API_URL` is optional, so the answer to "can I
 *    comment" is sometimes "not on this build". `ServiceUnavailable` says so in a way the UI can
 *    render rather than a network error it has to guess at.
 *  - **They have real status codes.** 403 not verified, 428 policy unread, 429 rate limited, 422
 *    rejected — each of which the composer does something different with. `ServiceError` carries
 *    the machine-readable `code` the service sends alongside the message, so the UI branches on a
 *    token and not on prose.
 *  - **They are not idempotent.** Posting a comment appends. Everything phase 2 put through the
 *    outbox sets a state instead, which is why comments deliberately do not go through it
 *    (PHASE3.md §5) and why `idempotencyKey` exists here.
 */

import { API_URL } from '@/lib/env';
import { supabase } from '@/lib/supabase';

/** Thrown when this build has no API service configured. Distinct from "the request failed". */
export class ServiceUnavailable extends Error {
  constructor() {
    super('Commenting is not available on this build.');
    this.name = 'ServiceUnavailable';
  }
}

export class ServiceError extends Error {
  readonly status: number;
  /**
   * The service's own short token — `not_verified`, `policy_not_accepted`, `rate_limited`,
   * `rejected`, `domain_not_recognised`, … Present on everything the client is expected to
   * handle; absent on a 500, which the client should not try to interpret.
   */
  readonly code: string | undefined;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = 'ServiceError';
    this.status = status;
    this.code = code;
  }
}

export function isServiceConfigured(): boolean {
  return API_URL !== undefined;
}

interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  /**
   * Overall deadline. Generous compared with a read, because the comment route waits on a
   * classifier by design — §10 budgets 50–200ms for it and the server allows longer before
   * falling back.
   */
  timeoutMs?: number;
}

/**
 * One authenticated call to the API service.
 *
 * The bearer token comes from the live Supabase session rather than being passed in, because the
 * session refreshes underneath the app and a token captured when a screen mounted is a token that
 * expires while the user is typing.
 */
export async function serviceFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  if (API_URL === undefined) throw new ServiceUnavailable();

  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;

  const token = data.session?.access_token;
  if (!token) {
    // Nothing in the app is reachable signed out, so this is a bug rather than a state — but it
    // is worth a clear message, because a 401 from the service would be diagnosed as a server
    // problem for an hour before anyone looked here.
    throw new ServiceError(401, 'Not signed in.');
  }

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method: options.method ?? 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
    });
  } catch (cause) {
    /*
     * A dropped connection, a wrong LAN address, a service that is not running. All of them look
     * the same from here and all of them mean the same thing to the user, so they get one
     * message — and a status of 0, so a caller can tell "never reached the server" from "the
     * server said no".
     */
    throw new ServiceError(0, 'Could not reach CareerDeck. Check your connection and try again.', 'offline');
  }

  const payload = (await response.json().catch(() => null)) as
    | (T & { error?: string; code?: string })
    | null;

  if (!response.ok) {
    throw new ServiceError(
      response.status,
      payload?.error ?? `The request failed (${response.status}).`,
      payload?.code,
    );
  }

  return payload as T;
}
