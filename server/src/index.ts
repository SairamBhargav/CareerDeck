import { serve } from '@hono/node-server';
import * as Sentry from '@sentry/node';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { logger } from 'hono/logger';

import { adminClient, requireAuth, type AuthedUser } from './auth.ts';
import { comments } from './comments.ts';
import { capabilities, env } from './env.ts';
import { moderation, reviewPage } from './moderation/review.ts';
import { resumes } from './resumes.ts';
import { verification, webhooks } from './verification.ts';

/**
 * The CareerDeck API service — §2.1's "real API service alongside Supabase, not instead of it".
 *
 * Phase 0 was the skeleton, and it predicted what would eventually land here: "the ranked feed
 * (§5), Auto Apply orchestration (§6), the credit ledger (§7), RevenueCat webhooks (§8) and the
 * moderation write path (§10) — everything that needs a secret, a model, or a transaction RLS
 * can't describe."
 *
 * Phase 3 is the first of those to arrive, and it is three things rather than one:
 *
 *  - **`POST /v1/comments`** — the moderation write path. Needs a model. §10.
 *  - **`/v1/verify/*` and `/webhooks/persona`** — both verification paths. Need an email
 *    provider and a vendor's signing secret. §3.2.
 *  - **`/v1/moderation/*` and `/moderation`** — the human review queue. Needs to read what the
 *    anonymity contract hides from users. §10.
 *
 * Phase 4 adds `/v1/resumes/*`, and one of its three routes breaks the pattern the other six
 * follow. Parsing needs a model and sealing a contact field needs an encryption key, so those
 * two arrive for the established reason. `GET /v1/resumes/:id/url` needs no secret at all and
 * is here anyway, because §3.9 requires every read of a resume to be logged and a read the
 * client performs against storage by itself cannot be. PHASE4.md §4.2.
 *
 * Everything else the app does still goes straight to Supabase, because RLS still expresses it.
 * Phase 1's decision B is unchanged for *jobs*: the feed is not here, and the seam that would
 * move it is still `lib/api.ts`.
 */

if (env.sentryDsn) {
  Sentry.init({ dsn: env.sentryDsn, environment: env.nodeEnv, tracesSampleRate: 0.1 });
}

const app = new Hono<{ Variables: { user: AuthedUser } }>();

app.use('*', logger());

/**
 * Unauthenticated on purpose: Fly's health checks have no token, and a health endpoint that can
 * fail for authentication reasons tells you nothing about health.
 *
 * `capabilities` is reported because phase 3's features each depend on a credential that may not
 * be set, and "is the classifier actually running in production" is otherwise a question you
 * answer by reading a deploy log. Nothing here names a secret's value — only whether one exists.
 */
app.get('/health', (c) =>
  c.json({ ok: true, service: 'careerdeck-api', env: env.nodeEnv, capabilities }),
);

/** §3.2's ID path calls back here. Outside `/v1` because a vendor has no Supabase session. */
app.route('/webhooks', webhooks);

/** §10's review queue, for a human with a browser. Its own auth is inside the page. */
app.route('/moderation', reviewPage);

const v1 = app.basePath('/v1');

v1.use('*', requireAuth);

/**
 * §11's `GET /v1/me`.
 *
 * The app reads its profile straight from Supabase — this is the same data through the service,
 * which is what phase 1 needed in place before the feed could hang off it. Note the explicit
 * `.eq('id', user.id)`: the admin client has no RLS behind it, so scoping is this handler's job
 * and nothing else's.
 */
v1.get('/me', async (c) => {
  const user = c.get('user');

  const [profile, preferences] = await Promise.all([
    adminClient
      .from('profiles')
      .select('id, first_name, last_name, display_name, handle, school_name_raw, major, graduation_year, location, verification_tier, comment_badge, content_policy_accepted_at')
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

v1.route('/comments', comments);
v1.route('/verify', verification);
v1.route('/moderation', moderation);
v1.route('/resumes', resumes);

app.onError((error, c) => {
  if (error instanceof HTTPException) {
    /*
     * `cause` carries the machine-readable code the verification routes attach, so the client can
     * branch on "this domain is not a registered school" versus "that code is wrong" without
     * parsing prose.
     */
    const code = typeof error.cause === 'string' ? error.cause : undefined;
    return c.json({ error: error.message, ...(code ? { code } : {}) }, error.status);
  }

  // Anything unhandled is a bug. It goes to Sentry with the account attached, and the caller gets
  // a generic message — an internal error's text is for us, not for them.
  Sentry.captureException(error, { user: { id: c.get('user')?.id } });
  console.error(error);
  return c.json({ error: 'Internal error.' }, 500);
});

serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(`careerdeck-api listening on http://localhost:${info.port}`);
  if (!capabilities.classifier) {
    /*
     * Loud, every boot. A deployment without a classifier still accepts comments — they post as
     * `flagged` and wait for a human — and that is a deliberate design choice for local
     * development, not a state to launch in. Silence here is how it would reach production.
     */
    console.warn(
      '[moderation] ANTHROPIC_API_KEY is not set. Comments will be published as flagged and ' +
        'queued for review instead of classified. Do not run this way with real users.',
    );
  }
});

export { app };
