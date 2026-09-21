import { serve } from '@hono/node-server';
import * as Sentry from '@sentry/node';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { logger } from 'hono/logger';

import { adminClient, requireAuth, type AuthedUser } from './auth.ts';
import { env } from './env.ts';

/**
 * The CareerDeck API service — §2.1's "real API service alongside Supabase, not instead
 * of it".
 *
 * Phase 0 is the skeleton: a health check, authentication, error handling and
 * observability, with one real route to prove the wiring. Supabase's own REST interface
 * serves everything the app currently needs, because everything the app currently needs
 * is expressible in RLS.
 *
 * What lands here in later phases is the set that isn't: the ranked feed (§5), Auto Apply
 * orchestration (§6), the credit ledger (§7), RevenueCat webhooks (§8) and the moderation
 * write path (§10) — everything that needs a secret, a model, or a transaction RLS can't
 * describe.
 */

if (env.sentryDsn) {
  Sentry.init({ dsn: env.sentryDsn, environment: env.nodeEnv, tracesSampleRate: 0.1 });
}

const app = new Hono<{ Variables: { user: AuthedUser } }>();

app.use('*', logger());

/**
 * Unauthenticated on purpose: Fly's health checks have no token, and a health endpoint
 * that can fail for authentication reasons tells you nothing about health.
 */
app.get('/health', (c) => c.json({ ok: true, service: 'careerdeck-api', env: env.nodeEnv }));

const v1 = app.basePath('/v1');

v1.use('*', requireAuth);

/**
 * §11's `GET /v1/me`.
 *
 * The app reads its profile straight from Supabase — this is the same data through the
 * service, which is what phase 1 needs in place before the feed can hang off it. Note
 * the explicit `.eq('id', user.id)`: the admin client has no RLS behind it, so scoping
 * is this handler's job and nothing else's.
 */
v1.get('/me', async (c) => {
  const user = c.get('user');

  const [profile, preferences] = await Promise.all([
    adminClient
      .from('profiles')
      .select('id, first_name, last_name, display_name, school_name_raw, major, graduation_year, location, verification_tier, comment_badge')
      .eq('id', user.id)
      .maybeSingle(),
    adminClient
      .from('user_preferences')
      .select('preferred_roles, preferred_locations, preferred_employment_types, weekly_goal, open_to_remote, min_salary_annual')
      .eq('user_id', user.id)
      .maybeSingle(),
  ]);

  if (profile.error) throw profile.error;
  if (preferences.error) throw preferences.error;
  if (!profile.data || !preferences.data) {
    throw new HTTPException(404, { message: 'No profile for this account.' });
  }

  return c.json({ email: user.email, profile: profile.data, preferences: preferences.data });
});

app.onError((error, c) => {
  if (error instanceof HTTPException) {
    return c.json({ error: error.message }, error.status);
  }

  // Anything unhandled is a bug. It goes to Sentry with the account attached, and the
  // caller gets a generic message — an internal error's text is for us, not for them.
  Sentry.captureException(error, { user: { id: c.get('user')?.id } });
  console.error(error);
  return c.json({ error: 'Internal error.' }, 500);
});

serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(`careerdeck-api listening on http://localhost:${info.port}`);
});

export { app };
