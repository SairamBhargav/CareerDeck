/**
 * `POST /webhooks/revenuecat` — §8: "Entitlements are derived from webhooks, never from a
 * client claim."
 *
 * This file authenticates a delivery and forwards the event. It does not interpret it: the
 * state machine — which event types grant, which lapse, what happens out of order, what a
 * redelivery does — is `apply_revenuecat_event()` in the phase 6 migration, in one transaction,
 * `service_role`-only. The same split `post_comment()` and `save_resume_profile()` keep.
 *
 * ── Authentication ────────────────────────────────────────────────────────────
 *
 * RevenueCat does not sign webhook bodies. It sends back an `Authorization` header whose value
 * you set in its dashboard, so the whole scheme is a long random shared secret over TLS. It is
 * compared in constant time, and an unset secret refuses everything — the Persona handler's rule
 * for the same reason: an unauthenticated route that grants a paid plan is the worst thing this
 * file could be.
 *
 * ── Status codes ──────────────────────────────────────────────────────────────
 *
 * RevenueCat retries anything that is not a 2xx, for a while. So: 401 for a bad secret (the
 * retry will be just as wrong, but a misconfigured dashboard should look broken, not quiet),
 * 200 for everything the database understood — including duplicates, stale events and events
 * for an account that does not exist — and 500 only when the database itself failed, which is
 * the one case a retry can fix.
 */

import { timingSafeEqual } from 'node:crypto';

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';

import { adminClient } from './auth.ts';
import { env } from './env.ts';

export const billingWebhooks = new Hono();

function authorized(header: string | undefined): boolean {
  if (!env.revenuecatWebhookAuth || !header) return false;

  // Accept the value bare or as a bearer token — the dashboard field takes either shape.
  const presented = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : header;
  const a = Buffer.from(presented, 'utf8');
  const b = Buffer.from(env.revenuecatWebhookAuth, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

billingWebhooks.post('/revenuecat', async (c) => {
  if (!env.revenuecatWebhookAuth) {
    throw new HTTPException(503, { message: 'REVENUECAT_WEBHOOK_AUTH is not set.' });
  }
  if (!authorized(c.req.header('Authorization'))) {
    throw new HTTPException(401, { message: 'Bad authorization.' });
  }

  const body = (await c.req.json().catch(() => null)) as { event?: Record<string, unknown> } | null;
  const event = body?.event;
  if (!event || typeof event.id !== 'string') {
    // Malformed is not retryable. 200 so it is not redelivered, and logged so it is not lost.
    console.warn('[billing] a RevenueCat delivery with no event id', body);
    return c.json({ ok: true, ignored: true });
  }

  const { data, error } = await adminClient.rpc('apply_revenuecat_event', { p_event: event });
  if (error) throw error;

  return c.json({ ok: true, outcome: data as string });
});
