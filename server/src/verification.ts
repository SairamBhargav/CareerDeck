/**
 * §3.2's two verification paths, as routes.
 *
 * Both live here rather than in the app for the same reason the comment write path does: each
 * needs a credential. The edu path needs an email provider; the ID path needs a vendor account
 * and a webhook nobody can forge. The database holds every rule that decides whether a
 * verification is legitimate — domain matching, the blocklist, attempt counting, expiry — and
 * these handlers carry secrets and nothing else.
 *
 * ── The one thing to get right ────────────────────────────────────────────────
 *
 * The government-ID path stores a provider reference and a boolean outcome. Not an image, not a
 * document number, not a date of birth, not the name on the document. The schema has nowhere to
 * put them (see the `verifications_result_is_minimal` constraint), and this file is careful not
 * to try: the webhook picks named fields out of the vendor payload rather than forwarding it.
 * §3.2 calls that non-negotiable, and the reason is blunt — the moment an ID image is stored,
 * a breach-notification obligation has been inherited.
 */

import { createHmac, randomInt, timingSafeEqual, createHash } from 'node:crypto';

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';

import { adminClient, type AuthedUser } from './auth.ts';
import { capabilities, env } from './env.ts';
import { MailNotConfigured, sendEduCode } from './mail.ts';

type Env = { Variables: { user: AuthedUser } };

export const verification = new Hono<Env>();
/** Mounted outside `/v1` — a vendor has no Supabase session to authenticate with. */
export const webhooks = new Hono();

/** Minutes a code is good for. Long enough to find the email, short enough to be worth guessing once. */
const CODE_TTL_MINUTES = 30;

/**
 * Six digits from a CSPRNG.
 *
 * `randomInt` rather than `Math.random`: this is the single factor protecting a tier that
 * unlocks writing under a school's name, and a predictable code is not a factor at all.
 */
function newCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/**
 * What goes in `token_hash`.
 *
 * The code is salted with the account id, so the same six digits issued to two accounts hash
 * differently and a stolen digest cannot be replayed against someone else's pending
 * verification.
 */
function hashCode(userId: string, code: string): string {
  return createHash('sha256').update(`${env.verificationPepper}:${userId}:${code}`).digest('hex');
}

/**
 * What goes in `verification_blocklist` when an account is banned.
 *
 * Deliberately **not** salted with the account id — the entire purpose is that the same `.edu`
 * address under a different account is recognised. Must match the expression in `apply_strike()`,
 * which computes the same digest in SQL.
 */
function credentialHash(identifier: string): string {
  return createHash('sha256').update(`${env.verificationPepper}:${identifier}`).digest('hex');
}

/** The SQLSTATEs the verification functions raise. Same discipline as the comment route. */
const STATUS_BY_CODE: Record<string, { status: 403 | 404 | 409 | 422 | 429; code: string }> = {
  CD004: { status: 429, code: 'too_many_attempts' },
  CD007: { status: 403, code: 'credential_blocked' },
  CD008: { status: 422, code: 'domain_not_recognised' },
  CD009: { status: 409, code: 'address_in_use' },
  CD010: { status: 422, code: 'bad_code' },
  '22P02': { status: 422, code: 'invalid' },
  23503: { status: 404, code: 'not_found' },
};

function rethrow(error: { code?: string; message: string }): never {
  const mapped = error.code ? STATUS_BY_CODE[error.code] : undefined;
  if (mapped) {
    throw new HTTPException(mapped.status, { message: error.message, cause: mapped.code });
  }
  throw error as unknown as Error;
}

// ── the .edu path ──────────────────────────────────────────────────────────────

verification.post('/edu/start', async (c) => {
  const user = c.get('user');
  const { email } = (await c.req.json().catch(() => ({}))) as { email?: unknown };

  if (typeof email !== 'string' || email.trim().length === 0) {
    throw new HTTPException(422, { message: 'An email address is required.' });
  }

  const address = email.trim().toLowerCase();
  const code = newCode();

  const { data, error } = await adminClient.rpc('start_edu_verification', {
    p_user_id: user.id,
    p_email: address,
    p_token_hash: hashCode(user.id, code),
    p_identifier_hash: credentialHash(address),
    p_ttl_minutes: CODE_TTL_MINUTES,
  });

  if (error) rethrow(error);

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new HTTPException(500, { message: 'The verification could not be started.' });

  /*
   * The row exists before the email is sent, which is the right order: a code that was stored
   * and not delivered is a user pressing the button again, and a code that was delivered and not
   * stored is a user typing a valid code that does not work.
   */
  try {
    const { delivered } = await sendEduCode({
      to: address,
      code,
      schoolName: row.school_name,
      expiresInMinutes: CODE_TTL_MINUTES,
    });

    return c.json({
      school: row.school_name,
      expiresInMinutes: CODE_TTL_MINUTES,
      delivered,
      // Only ever present outside production — see server/src/mail.ts on why that line exists
      // and why it is refused when it matters.
      devCode: delivered ? undefined : code,
    });
  } catch (mailError) {
    if (mailError instanceof MailNotConfigured) {
      throw new HTTPException(503, { message: mailError.message });
    }
    throw mailError;
  }
});

verification.post('/edu/confirm', async (c) => {
  const user = c.get('user');
  const { code } = (await c.req.json().catch(() => ({}))) as { code?: unknown };

  if (typeof code !== 'string' || !/^\d{6}$/.test(code.trim())) {
    throw new HTTPException(422, { message: 'That is not a six-digit code.' });
  }

  const { data, error } = await adminClient.rpc('confirm_edu_verification', {
    p_user_id: user.id,
    p_token_hash: hashCode(user.id, code.trim()),
  });

  if (error) rethrow(error);

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new HTTPException(422, { message: 'That code is wrong or has expired.' });

  return c.json({ school: row.school_name, badge: row.badge, tier: 'edu' });
});

// ── the government-ID path ─────────────────────────────────────────────────────

/**
 * Hands the client a hosted inquiry URL to open.
 *
 * The vendor's flow runs entirely in their web view: the document, the selfie and the liveness
 * check never touch this process, which is the whole point of using one. What comes back is a
 * webhook saying pass or fail.
 *
 * `reference-id` is the account id, and it is the only thing that links the inquiry to a
 * CareerDeck user. It is also why the webhook can be trusted to know who it is about without us
 * storing anything the vendor holds.
 */
verification.post('/identity/start', (c) => {
  const user = c.get('user');

  if (!capabilities.identityVerification) {
    throw new HTTPException(503, {
      message:
        'Identity verification is not configured on this server. Set PERSONA_TEMPLATE_ID and ' +
        'PERSONA_WEBHOOK_SECRET to enable it.',
    });
  }

  const url = new URL('https://withpersona.com/verify');
  url.searchParams.set('inquiry-template-id', env.personaTemplateId as string);
  if (env.personaEnvironmentId) {
    url.searchParams.set('environment-id', env.personaEnvironmentId);
  }
  url.searchParams.set('reference-id', user.id);

  return c.json({ url: url.toString(), provider: 'persona' });
});

/**
 * Verifies Persona's HMAC over the raw body.
 *
 * Over the **raw** body, not the parsed one — re-serializing JSON changes bytes and every
 * signature check written against a parsed object is a signature check that passes for the
 * wrong reasons or fails for none. `timingSafeEqual` because comparing a signature with `===`
 * leaks it a byte at a time.
 */
function verifySignature(rawBody: string, header: string | undefined): boolean {
  if (!env.personaWebhookSecret || !header) return false;

  // Persona sends `t=<unix>,v1=<hex>`, with the digest taken over `<t>.<body>`.
  const parts = new Map(
    header.split(',').map((part) => {
      const [key, ...rest] = part.trim().split('=');
      return [key ?? '', rest.join('=')] as const;
    }),
  );

  const timestamp = parts.get('t');
  const signature = parts.get('v1');
  if (!timestamp || !signature) return false;

  // Five minutes. A valid signature replayed a day later is a replay, and the outcome it
  // carries may since have been revoked.
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) return false;

  const expected = createHmac('sha256', env.personaWebhookSecret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');

  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(signature, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

interface PersonaEvent {
  data?: {
    attributes?: {
      name?: string;
      payload?: {
        data?: {
          id?: string;
          attributes?: {
            status?: string;
            'reference-id'?: string;
          };
          relationships?: unknown;
        };
      };
    };
  };
}

webhooks.post('/persona', async (c) => {
  if (!env.personaWebhookSecret) {
    // Refusing outright rather than accepting unsigned events. An unauthenticated endpoint that
    // grants a verification tier is the single worst thing this service could expose.
    throw new HTTPException(503, { message: 'PERSONA_WEBHOOK_SECRET is not set.' });
  }

  const raw = await c.req.text();
  if (!verifySignature(raw, c.req.header('Persona-Signature'))) {
    throw new HTTPException(401, { message: 'Bad signature.' });
  }

  const event = JSON.parse(raw) as PersonaEvent;
  const inquiry = event.data?.attributes?.payload?.data;
  const userId = inquiry?.attributes?.['reference-id'];
  const inquiryId = inquiry?.id;
  const status = inquiry?.attributes?.status;

  if (!userId || !inquiryId || !status) {
    // 200, not 400. A shape we do not handle is not a failure the vendor should retry for an
    // hour — it is an event type we did not subscribe to, or a field they renamed.
    return c.json({ ok: true, ignored: true });
  }

  // Only terminal outcomes. `created`, `pending` and `expired` say nothing about personhood.
  if (status !== 'approved' && status !== 'declined' && status !== 'failed') {
    return c.json({ ok: true, ignored: true });
  }

  const passed = status === 'approved';

  const { error } = await adminClient.rpc('record_identity_verification', {
    p_user_id: userId,
    p_provider: 'persona',
    p_provider_ref: inquiryId,
    p_passed: passed,
    /*
     * The outcome and nothing else. Persona's payload also contains the name on the document,
     * the date of birth and URLs to the captured images; none of it is read here, and the
     * constraint on `provider_result` would reject it if it were.
     */
    p_result: { status, provider: 'persona' },
    p_identifier_hash: credentialHash(inquiryId),
  });

  if (error) {
    // CD007: this identity belongs to a banned account. The vendor does not need to know that,
    // and it must not retry — the answer will not change.
    if (error.code === 'CD007') return c.json({ ok: true, refused: true });
    throw error;
  }

  return c.json({ ok: true });
});
