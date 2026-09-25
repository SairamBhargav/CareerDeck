/**
 * `/v1/resumes/*` — the two resume operations that cannot go straight to Postgres, and the
 * one that could but must not.
 *
 * ── The three routes, and why each is here ────────────────────────────────────
 *
 *  - **`POST /:id/parse`** needs a model. Same argument as phase 3's comment write path: §3.9
 *    puts an extractor between the upload and the profile, the extractor needs a secret, and a
 *    secret in the app bundle is not a secret.
 *
 *  - **`POST /:id/contact`** needs the encryption key. Nothing else can produce the `bytea`
 *    that `resume_profiles.full_name_enc` promises to hold.
 *
 *  - **`GET /:id/url`** needs *nothing* the client lacks — and that is the point. Supabase
 *    storage would happily sign this URL for the owner under an RLS policy, exactly as phase 1
 *    reads the feed straight from Postgres. It goes through here anyway, because §3.9 requires
 *    every read of a resume to be logged and a read the client performs by itself cannot be.
 *    PHASE4.md §4.2 argues it properly. This is the first place in four phases where a read is
 *    routed through the service for a reason that is not performance or a secret.
 *
 * ── What this file is not ─────────────────────────────────────────────────────
 *
 * It is not where the rules live. Ownership, the ten-resume cap, the single-default invariant
 * and the storage-path check are all in SQL, and `save_resume_profile()` is `service_role`-only
 * for the same reason `post_comment()` is: a bug here should be able to produce a *wrong*
 * profile and never an illegitimate one. Preserve that split if this is ever rewritten.
 */

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { createHash } from 'node:crypto';

import { adminClient, type AuthedUser } from './auth.ts';
import { capabilities, env } from './env.ts';
import { canEncrypt, seal } from './resumes/crypto.ts';
import {
  ExtractorRefused,
  ExtractorUnavailable,
  extractResume,
  PARSER_VERSION,
} from './resumes/extract.ts';

type Env = { Variables: { user: AuthedUser } };

export const resumes = new Hono<Env>();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function resumeIdOrThrow(raw: string | undefined): string {
  if (!raw || !UUID.test(raw)) {
    throw new HTTPException(422, { message: 'That is not a resume id.' });
  }
  return raw;
}

interface ServiceResume {
  resume_id: string;
  user_id: string;
  storage_path: string;
  parse_status: 'pending' | 'parsing' | 'parsed' | 'failed';
  content_hash: string | null;
}

/**
 * Resolves a resume id to its row, refusing anything the caller does not own.
 *
 * The ownership check is here rather than in a policy because the admin client has no RLS
 * behind it — `auth.ts` says so and means it. Every query in this file scopes itself by hand.
 *
 * 404 and not 403 for somebody else's resume, deliberately: "that resume exists but is not
 * yours" is a membership oracle over a table of documents, and the caller has no business
 * learning which ids are real.
 */
async function ownedResume(resumeId: string, userId: string): Promise<ServiceResume> {
  const { data, error } = await adminClient
    .rpc('resume_for_service', { p_resume_id: resumeId })
    .maybeSingle<ServiceResume>();

  if (error) throw error;
  if (!data || data.user_id !== userId) {
    throw new HTTPException(404, { message: 'No such resume.' });
  }
  return data;
}

/** One `pii_access_log` row. Never throws — a failed log must not fail the request it describes. */
async function logAccess(input: {
  actorType: 'user' | 'service' | 'staff';
  actorId: string | null;
  subject: string;
  resource: 'resume_pdf' | 'resume_profile';
  resourceId: string;
  purpose: 'parse' | 'match' | 'user_download' | 'autoapply' | 'support' | 'export';
  detail?: string;
}): Promise<void> {
  const { error } = await adminClient.rpc('log_pii_access', {
    p_actor_type: input.actorType,
    p_actor_id: input.actorId,
    p_subject: input.subject,
    p_resource: input.resource,
    p_resource_id: input.resourceId,
    p_purpose: input.purpose,
    p_detail: input.detail ?? null,
  });

  if (error) {
    /*
     * Loud, and not fatal. An audit row that cannot be written is a real problem — it is the
     * one thing this table exists to prevent — but refusing the user's own download because
     * the log is unavailable trades a data-protection property for an outage. It goes to the
     * console (and therefore Sentry's breadcrumbs) and the request proceeds.
     */
    console.error('[pii] failed to write an access log row', error);
  }
}

/**
 * `GET /v1/resumes/:id/url` — a short-lived signed URL for the owner's own PDF, logged.
 *
 * Five minutes. Long enough to open a document, short enough that a URL captured from a log,
 * a screenshot or a shared debugging session is dead before anyone can use it. A signed
 * storage URL carries its own authorization, so its lifetime is the only control left.
 */
resumes.get('/:id/url', async (c) => {
  const user = c.get('user');
  const resumeId = resumeIdOrThrow(c.req.param('id'));
  const row = await ownedResume(resumeId, user.id);

  await logAccess({
    actorType: 'user',
    actorId: user.id,
    subject: row.user_id,
    resource: 'resume_pdf',
    resourceId: resumeId,
    purpose: 'user_download',
  });

  const { data, error } = await adminClient.storage
    .from('resumes')
    .createSignedUrl(row.storage_path, 300);

  if (error || !data) {
    throw new HTTPException(502, { message: 'Could not sign a URL for that file.' });
  }

  return c.json({ url: data.signedUrl, expiresIn: 300 });
});

/**
 * `POST /v1/resumes/:id/parse` — read the PDF, write the profile.
 *
 * Synchronous, and that is a choice worth naming. The natural shape is a queue: return 202,
 * parse in a worker, push the result over realtime. It is not built, because the client is
 * already sitting on a review screen waiting for exactly this answer, a parse is one call of a
 * few seconds, and a queue would add a worker, a job table and a delivery path to a phase that
 * needs none of them. `parse_status` carries the state regardless, so the day this does move
 * to a worker the client does not change — it is already polling a status rather than
 * believing a response.
 */
resumes.post('/:id/parse', async (c) => {
  const user = c.get('user');
  const resumeId = resumeIdOrThrow(c.req.param('id'));

  if (!capabilities.resumeParsing) {
    throw new HTTPException(503, {
      message: 'Resume parsing is not configured on this server (ANTHROPIC_API_KEY).',
      cause: 'parser_unavailable',
    });
  }

  const row = await ownedResume(resumeId, user.id);

  if (row.parse_status === 'parsing') {
    // Not an error. A user who double-taps, or whose phone retried the request, should see
    // the parse they already started rather than a second one against the same document.
    return c.json({ status: 'parsing', alreadyRunning: true }, 202);
  }

  await adminClient.rpc('set_parse_status', { p_resume_id: resumeId, p_status: 'parsing' });

  try {
    /*
     * Downloaded with the service key, which is the only credential that can read this bucket
     * — the storage policies grant insert and delete to the owner and select to nobody. The
     * log row goes in before the read, not after: an audit trail written only on success is
     * an audit trail that misses exactly the accesses worth investigating.
     */
    await logAccess({
      actorType: 'service',
      actorId: user.id,
      subject: row.user_id,
      resource: 'resume_pdf',
      resourceId: resumeId,
      purpose: 'parse',
      detail: PARSER_VERSION,
    });

    const download = await adminClient.storage.from('resumes').download(row.storage_path);
    if (download.error || !download.data) {
      throw new HTTPException(404, { message: 'The uploaded file is missing from storage.' });
    }

    const pdf = Buffer.from(await download.data.arrayBuffer());
    const parsed = await extractResume(pdf);

    /*
     * Seal what can be sealed. A deployment with no encryption key still gets a usable
     * profile — skills, seniority, education and dates are what the matcher reads, and none of
     * them are contact details. Dropping the three P0 fields is strictly safer than storing
     * them in the clear, and refusing the whole parse would make the key mandatory for a
     * feature that does not need it.
     */
    const sealable = canEncrypt();
    if (!sealable) {
      console.warn(
        '[resumes] RESUME_ENCRYPTION_KEY is not set. Parsing without storing contact fields.',
      );
    }

    const { error } = await adminClient.rpc('save_resume_profile', {
      p_resume_id: resumeId,
      p_parser_version: PARSER_VERSION,
      p_full_name_enc: sealable ? encoded(seal(parsed.fullName)) : null,
      p_email_enc: sealable ? encoded(seal(parsed.email)) : null,
      p_phone_enc: sealable ? encoded(seal(parsed.phone)) : null,
      p_location: parsed.location,
      p_skills: parsed.skills,
      p_education: parsed.education,
      p_experience: parsed.experience,
      p_years: parsed.yearsExperience,
      p_seniority: parsed.seniority,
      p_page_count: parsed.pageCount,
      /*
       * `raw_parse` holds the model's own output including the contact fields in plaintext,
       * which would defeat the encryption two columns to the left. Stripped before it is
       * stored: what is kept is the part worth re-deriving a field from, and the contact
       * details are the part that is not.
       */
      p_raw_parse: { ...parsed, fullName: null, email: null, phone: null },
    });
    if (error) throw error;

    return c.json({
      status: 'parsed',
      profile: {
        location: parsed.location,
        skills: parsed.skills,
        education: parsed.education,
        experience: parsed.experience,
        yearsExperience: parsed.yearsExperience,
        seniority: parsed.seniority,
        pageCount: parsed.pageCount,
        /*
         * Whether the three contact fields were found, never what they were. The review screen
         * says "we read your contact details" and the user can believe it or re-upload; it has
         * no reason to display a phone number back to the person whose phone it is, and every
         * reason not to put one on the wire. PHASE4.md §4.4.
         */
        contactFound: {
          fullName: parsed.fullName !== null,
          email: parsed.email !== null,
          phone: parsed.phone !== null,
        },
      },
    });
  } catch (error) {
    const message =
      error instanceof ExtractorUnavailable || error instanceof ExtractorRefused
        ? error.message
        : error instanceof HTTPException
          ? error.message
          : 'The parser could not read this document.';

    await adminClient.rpc('set_parse_status', {
      p_resume_id: resumeId,
      p_status: 'failed',
      p_error: message,
    });

    if (error instanceof HTTPException) throw error;
    // 422 rather than 500: the overwhelmingly likely cause is the document — a scan with no
    // text layer, a password-protected file, forty pages of something that is not a resume.
    throw new HTTPException(422, { message, cause: 'parse_failed' });
  }
});

/**
 * Supabase's PostgREST wire format has no bytes, so a `bytea` argument travels as the hex
 * escape form Postgres accepts back on input. Node's `toString('hex')` plus the `\x` prefix is
 * exactly that encoding, and it round-trips through `verify:phase4`.
 */
function encoded(value: Buffer | null): string | null {
  return value === null ? null : `\\x${value.toString('hex')}`;
}

/**
 * `POST /v1/resumes/:id/contact` — replace the sealed contact fields by hand.
 *
 * Deliberately narrow, and deliberately write-only. The parse-confirmation screen does not
 * call this: §4.4 argues that showing somebody their own phone number back costs a decryption,
 * a log row and a plaintext P0 field on the wire to confirm a fact they already know.
 *
 * It exists for the case the screen cannot cover — the resume where the extractor found no
 * email because it was rendered as an image, and phase 6 will otherwise have nothing to put on
 * an application. The user supplies the value; nothing is ever read back to them.
 */
resumes.post('/:id/contact', async (c) => {
  const user = c.get('user');
  const resumeId = resumeIdOrThrow(c.req.param('id'));

  if (!canEncrypt()) {
    throw new HTTPException(503, {
      message: 'Contact details cannot be stored on this server (RESUME_ENCRYPTION_KEY).',
      cause: 'encryption_unavailable',
    });
  }

  const row = await ownedResume(resumeId, user.id);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

  const field = (name: string): string | null => {
    const value = body[name];
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string') {
      throw new HTTPException(422, { message: `${name} must be a string.` });
    }
    return value;
  };

  const fullName = field('fullName');
  const email = field('email');
  const phone = field('phone');

  if (fullName === null && email === null && phone === null) {
    throw new HTTPException(422, { message: 'Nothing to update.' });
  }

  /*
   * A partial update through a function whose null arguments mean "clear" would silently wipe
   * the two fields the caller did not send. Read the row, overlay, write it back — the profile
   * is one row and this is not a hot path.
   */
  const existing = await adminClient
    .from('resume_profiles')
    .select('full_name_enc, email_enc, phone_enc, location, skills, education, experience, years_experience, seniority, parser_version, raw_parse')
    .eq('resume_id', resumeId)
    .maybeSingle();

  if (existing.error) throw existing.error;
  if (!existing.data) {
    throw new HTTPException(409, { message: 'That resume has not been parsed yet.' });
  }

  await logAccess({
    actorType: 'user',
    actorId: user.id,
    subject: row.user_id,
    resource: 'resume_profile',
    resourceId: resumeId,
    purpose: 'user_download',
    detail: 'contact fields replaced by the owner',
  });

  const keep = (sent: string | null, current: unknown): string | null =>
    sent === null ? (typeof current === 'string' ? current : null) : encoded(seal(sent));

  const { error } = await adminClient.rpc('save_resume_profile', {
    p_resume_id: resumeId,
    p_parser_version: existing.data.parser_version,
    p_full_name_enc: keep(fullName, existing.data.full_name_enc),
    p_email_enc: keep(email, existing.data.email_enc),
    p_phone_enc: keep(phone, existing.data.phone_enc),
    p_location: existing.data.location,
    p_skills: existing.data.skills,
    p_education: existing.data.education,
    p_experience: existing.data.experience,
    p_years: existing.data.years_experience,
    p_seniority: existing.data.seniority,
    p_page_count: null,
    p_raw_parse: existing.data.raw_parse,
  });
  if (error) throw error;

  return c.json({ ok: true });
});

/** What the client needs to know before it offers an upload button. */
resumes.get('/capabilities', (c) =>
  c.json({
    parsing: capabilities.resumeParsing,
    contactEncryption: capabilities.resumeEncryption,
    parserVersion: PARSER_VERSION,
    model: env.resumeParserModel,
  }),
);

/**
 * Not a route — the hash the client sends with `register_resume` so an identical re-upload can
 * skip the parse. Exported here because the shape of the hash is a contract between the two
 * sides and the app computes it over the same bytes.
 */
export function contentHash(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}
