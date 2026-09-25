/**
 * Server configuration. Unlike the app's lib/env.ts, nothing here is public.
 *
 * The service-role key bypasses RLS entirely — it is the credential that lets this
 * process read every user's applications and write every user's credit ledger. It lives
 * in the environment, never in the repo, and never leaves this process.
 *
 * Phase 3 adds four groups of optional settings, and "optional" is doing real work in that
 * sentence. Commenting, `.edu` verification and the ID check each need a third-party account
 * that a person cloning this repo does not have, and a server that refuses to boot without
 * all three is a server nobody can run. So each capability reports its own readiness
 * (`capabilities` below), the routes that need one return 503 with an explanation naming the
 * variable, and everything else keeps working. PHASE3.md §6.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. Copy server/.env.example to server/.env and fill it in.`);
  }
  return value;
}

function optional(name: string): string | undefined {
  return process.env[name] || undefined;
}

function integer(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const nodeEnv = process.env.NODE_ENV ?? 'development';

export const env = {
  port: Number(process.env.PORT ?? 8787),
  nodeEnv,
  isProduction: nodeEnv === 'production',

  supabaseUrl: required('SUPABASE_URL'),
  /** The public key. Used only to verify user tokens, never to read data. */
  supabaseAnonKey: required('SUPABASE_ANON_KEY'),
  /** Bypasses RLS. Guard it accordingly. */
  supabaseServiceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),

  sentryDsn: optional('SENTRY_DSN'),

  // ── moderation (§10) ─────────────────────────────────────────────────────────

  /**
   * The classifier's credential. Without it the write path still runs, on the lexical pass
   * alone — see `server/src/moderation/classifier.ts` for exactly what that does and does not
   * catch, and why shipping to real users in that state is not acceptable.
   */
  anthropicApiKey: optional('ANTHROPIC_API_KEY'),
  /**
   * Overridable because the right answer depends on a number only the operator can measure.
   * §10 budgets 50–200ms for this call, and Opus with adaptive thinking does not fit that at
   * p95 — `claude-haiku-4-5` does, at a fraction of the cost and some accuracy. The default
   * is the more capable model; the trade is documented rather than made on the operator's
   * behalf. PHASE3.md §6.2.
   */
  moderationModel: process.env.MODERATION_MODEL ?? 'claude-opus-5',
  /**
   * How long to wait before giving up on the classifier and publishing the comment as
   * `flagged` instead. Fail-open-but-reviewed: a slow model must not stop a verified student
   * from answering a question, and it must not publish unchecked text either.
   */
  moderationTimeoutMs: integer('MODERATION_TIMEOUT_MS', 2_500),

  // ── verification (§3.2) ──────────────────────────────────────────────────────

  /** Delivers the `.edu` magic code. See server/src/mail.ts. */
  resendApiKey: optional('RESEND_API_KEY'),
  verificationFromEmail: process.env.VERIFICATION_FROM_EMAIL ?? 'CareerDeck <verify@example.invalid>',

  /** The personhood vendor. §3.2 names Persona or Stripe Identity; this wires Persona. */
  personaTemplateId: optional('PERSONA_TEMPLATE_ID'),
  personaEnvironmentId: optional('PERSONA_ENVIRONMENT_ID'),
  /** Verifies the webhook's HMAC. Without it the webhook refuses every request. */
  personaWebhookSecret: optional('PERSONA_WEBHOOK_SECRET'),

  /**
   * Pepper for the credential digests in `verification_blocklist`. A ban is only real if the
   * same `.edu` address cannot verify a second account, which means the digest has to be
   * comparable across accounts — so this is a fixed secret and not a per-row salt.
   *
   * Changing it un-bans everybody who was banned under the old one. That is a data migration,
   * not a config change.
   */
  verificationPepper: process.env.VERIFICATION_PEPPER ?? 'careerdeck-verification',

  // ── resumes (§3.9) ───────────────────────────────────────────────────────────

  /**
   * The extractor's model. Overridable for the same reason `moderationModel` is, but the
   * trade runs the other way: the classifier is in front of a user staring at a composer and
   * has a 2.5s budget, while a parse happens once per uploaded document behind a progress
   * state. Accuracy is worth more than latency here, so the default is the capable model and
   * there is no cheaper one recommended. PHASE4.md §5.
   */
  resumeParserModel: process.env.RESUME_PARSER_MODEL ?? 'claude-opus-5',
  /**
   * Generous compared to the classifier's 2.5s. Reading several rendered pages of a
   * two-column layout is a different task from reading one sentence, and the user is not
   * blocked on it in the same way.
   */
  resumeParseTimeoutMs: integer('RESUME_PARSE_TIMEOUT_MS', 90_000),
  /**
   * 32 bytes, base64. Seals `resume_profiles.full_name_enc` and its two siblings.
   *
   * **Rotating this destroys data.** Every field sealed under the old key becomes permanently
   * unreadable and nothing detects it — the rows are still there and still the right length.
   * Same class of hazard as `verificationPepper` above and strictly worse, because a lost
   * pepper un-bans people while a lost key loses the plaintext for good.
   *
   * Optional: without it a resume still parses and still matches, and the three contact
   * fields are dropped rather than stored in the clear. `server/src/resumes/crypto.ts` has
   * the layout and the rotation path it leaves room for.
   */
  resumeEncryptionKey: optional('RESUME_ENCRYPTION_KEY'),
} as const;

/**
 * What this process can actually do, given what it was configured with.
 *
 * Reported on `/health` so a deploy can be checked without reading the environment, and read
 * by the app so the composer can say "commenting is not available" instead of failing a POST.
 */
export const capabilities = {
  /** A comment can be posted. The lexical pass alone is enough to run; it is not enough to launch. */
  comments: true,
  classifier: env.anthropicApiKey !== undefined,
  eduVerification: env.resendApiKey !== undefined || !env.isProduction,
  identityVerification: env.personaTemplateId !== undefined && env.personaWebhookSecret !== undefined,

  /**
   * Phase 4. The same credential the classifier uses — one key, two features — so a
   * deployment that can moderate can also parse.
   */
  resumeParsing: env.anthropicApiKey !== undefined,
  /**
   * Reported separately from `resumeParsing` because they fail differently and the client
   * shows different things: without parsing there is no profile at all and no upload button;
   * without encryption there is a full profile and a match score, and only the three contact
   * fields phase 6 will want are missing.
   */
  resumeEncryption: env.resumeEncryptionKey !== undefined,
} as const;
