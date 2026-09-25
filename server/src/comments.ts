/**
 * `POST /v1/comments` — §11's one write that could never have gone straight to Postgres.
 *
 * Every other write in this app is an RLS-shaped statement the client makes for itself: phase 2
 * settled likes, follows and applications that way and PHASE2.md argued the rule of thumb
 * ("talk to Supabase directly when RLS can express it"). A comment cannot be, for exactly one
 * reason: §10 puts a moderation classifier in the write path, the classifier needs a secret,
 * and a secret in the app bundle is not a secret.
 *
 * ── What this handler is, and is not ──────────────────────────────────────────
 *
 * It is: the classifier, and the translation from a database error to a status code.
 *
 * It is **not** the place where the rules live. Tier, strikes, the rate limit, thread depth,
 * policy acceptance, and idempotency are all enforced by `post_comment()` in SQL, which is
 * granted to `service_role` alone. That split is deliberate and it is the thing to preserve if
 * this file is ever rewritten: a bug here — a forgotten check, a mis-parsed body, a route added
 * in a hurry — cannot produce a comment the database would have refused. The service is
 * trusted to say what the classifier decided and nothing else. PHASE3.md §4.
 */

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';

import { adminClient, type AuthedUser } from './auth.ts';
import { classify } from './moderation/classifier.ts';

type Env = { Variables: { user: AuthedUser } };

export const comments = new Hono<Env>();

interface PostBody {
  jobId?: unknown;
  parentId?: unknown;
  body?: unknown;
  gifId?: unknown;
  idempotencyKey?: unknown;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidOrThrow(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw new HTTPException(422, { message: `${field} must be a uuid.` });
  }
  return value;
}

/**
 * The SQLSTATEs `post_comment()` raises, mapped to what the client should do about them.
 *
 * Matching on codes rather than on message text is what lets the SQL reword an explanation
 * without breaking the API. The codes are declared next to the function that raises them, in the
 * phase 3 migration.
 */
const STATUS_BY_CODE: Record<string, { status: 403 | 404 | 422 | 428 | 429; code: string }> = {
  CD001: { status: 403, code: 'not_verified' },
  CD002: { status: 403, code: 'restricted' },
  CD003: { status: 428, code: 'policy_not_accepted' },
  CD004: { status: 429, code: 'rate_limited' },
  CD005: { status: 403, code: 'blocked' },
  23503: { status: 404, code: 'not_found' },
  23514: { status: 422, code: 'invalid' },
  22001: { status: 422, code: 'invalid' },
};

comments.post('/', async (c) => {
  const user = c.get('user');
  const payload = (await c.req.json().catch(() => ({}))) as PostBody;

  const jobId = uuidOrThrow(payload.jobId, 'jobId');
  const parentId = payload.parentId === null || payload.parentId === undefined
    ? null
    : uuidOrThrow(payload.parentId, 'parentId');

  const body = typeof payload.body === 'string' ? payload.body : '';
  const gifId = typeof payload.gifId === 'string' && payload.gifId.length > 0 ? payload.gifId : null;

  if (body.trim().length === 0 && gifId === null) {
    throw new HTTPException(422, { message: 'A comment needs text or a GIF.' });
  }

  /*
   * Length is checked here as well as by the constraint, because 500 characters is the
   * composer's own limit and a request that overshoots it is a client bug worth naming rather
   * than a database error worth translating. It also keeps oversized text out of the classifier.
   */
  if (body.length > 500) {
    throw new HTTPException(422, { message: 'A comment cannot be longer than 500 characters.' });
  }

  const idempotencyKey =
    typeof payload.idempotencyKey === 'string' && payload.idempotencyKey.length > 0
      ? payload.idempotencyKey.slice(0, 64)
      : null;

  /*
   * The classifier runs before the insert and after nothing.
   *
   * That ordering costs a model call on a comment the database was going to refuse anyway — a
   * muted account's post is classified and then rejected for being muted. The alternative is
   * two round trips to Postgres with the classifier in between, which doubles the latency of
   * every legitimate comment to save money on the illegitimate ones. The rate limit is what
   * bounds the waste: ten an hour per account.
   */
  const verdict = await classify(body);

  if (verdict.decision === 'block') {
    /*
     * 422 with a reason the user can act on — §10's own wording. The message comes from the
     * classifier and names what to change; it never quotes the offending text back, and it
     * never cites a policy section, because neither helps somebody rewrite a sentence.
     */
    return c.json(
      {
        error: verdict.message ?? 'This comment breaks the content policy.',
        code: 'rejected',
        category: verdict.category,
      },
      422,
    );
  }

  const { data, error } = await adminClient.rpc('post_comment', {
    p_author_id: user.id,
    p_job_id: jobId,
    p_body: body,
    p_parent_id: parentId,
    p_gif_id: gifId,
    p_status: verdict.decision === 'flag' ? 'flagged' : 'approved',
    p_scores: verdict.scores,
    p_reason: verdict.decision === 'flag' ? `${verdict.source}: ${verdict.category}` : null,
    p_idempotency_key: idempotencyKey,
  });

  if (error) {
    const mapped = error.code ? STATUS_BY_CODE[error.code] : undefined;
    if (mapped) {
      return c.json({ error: error.message, code: mapped.code }, mapped.status);
    }
    // Anything unmapped is a bug in this service or in the migration, not something the caller
    // did. It goes to the error handler, which reports it and says nothing useful to the client.
    throw error;
  }

  if (!data) {
    throw new HTTPException(500, { message: 'The comment was written but could not be read back.' });
  }

  /*
   * `flagged` is returned as a normal success and the client is not told.
   *
   * Telling somebody their comment is under review teaches the small number of people who are
   * probing the classifier exactly where its threshold is, and tells the much larger number who
   * tripped it accidentally that they are suspected of something. It is published, it is
   * visible, and a human will read it. §10's flag is a queue entry, not a punishment.
   */
  return c.json({ comment: data }, 201);
});
