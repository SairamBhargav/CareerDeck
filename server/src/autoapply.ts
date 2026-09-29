/**
 * `/v1/auto-apply/*` — §6, the two halves of Auto Apply that need the service.
 *
 *  - **`POST /`** starts a run: reserve a credit, fetch the form, draft it. Needs a model.
 *  - **`GET /:id`** reads a run back with its contact fields filled in. Needs the encryption
 *    key, and every read is logged to `pii_access_log` with purpose `autoapply` — the purpose
 *    phase 4 put in that enum for this route.
 *
 * Reviewing, completing and abandoning a run need neither, so the app calls those straight to
 * Postgres (`review_auto_apply`, `complete_auto_apply`, `abandon_auto_apply`). Phase 1's decision
 * B, unchanged: the service is for secrets and models, not for everything.
 *
 * ── Why the draft is written inside the request ───────────────────────────────
 *
 * §6 draws it as a job. It is synchronous here for phase 4's reason about parsing: there is no
 * queue in this system yet, the reader is watching a "drafting" state and wants the answer, and
 * `auto_apply_runs.status` already carries the state a worker would need — so moving it to one
 * later changes this file and not the client. If the connection drops mid-draft, the run
 * finishes anyway and `GET /:id` returns it; if the process dies, `expire_auto_apply_runs()`
 * fails and refunds it within fifteen minutes.
 *
 * As in `resumes.ts`, the rules are not here. The reservation, the balance check, the one-run-
 * per-posting rule and the refund all live in SQL; a bug in this file can produce a bad draft
 * and never a free or double-charged one.
 */

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';

import { adminClient, type AuthedUser } from './auth.ts';
import { capabilities } from './env.ts';
import {
  DrafterRefused,
  DrafterUnavailable,
  PROMPT_VERSION,
  draftApplication,
  type Draft,
  type DraftAnswer,
} from './autoapply/draft.ts';
import { formForJob, type ApplicationForm, type FormField } from './autoapply/form.ts';
import { canEncrypt, open } from './resumes/crypto.ts';
import { logAccess } from './resumes.ts';

type Env = { Variables: { user: AuthedUser } };

export const autoApply = new Hono<Env>();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidOrThrow(raw: unknown, name: string): string {
  if (typeof raw !== 'string' || !UUID.test(raw)) {
    throw new HTTPException(422, { message: `${name} is not an id.` });
  }
  return raw;
}

/** `start_auto_apply`'s SQLSTATEs, mapped to what the client does about each. */
const STATUS_BY_CODE: Record<string, { status: 402 | 404 | 409 | 410; code: string }> = {
  CD020: { status: 402, code: 'no_credits' },
  CD021: { status: 410, code: 'job_closed' },
  CD022: { status: 409, code: 'no_resume' },
  CD023: { status: 409, code: 'already_applied' },
  CD024: { status: 404, code: 'not_found' },
};

function rethrow(error: { code?: string; message: string }): never {
  const mapped = error.code ? STATUS_BY_CODE[error.code] : undefined;
  if (mapped) throw new HTTPException(mapped.status, { message: error.message, cause: mapped.code });
  throw error;
}

interface RunRow {
  id: string;
  user_id: string;
  job_id: string;
  resume_id: string;
  status: 'pending' | 'ready' | 'reviewed' | 'used' | 'abandoned' | 'failed';
  form_source: 'greenhouse' | 'standard' | null;
  form: ApplicationForm | null;
  draft: Draft | null;
  error: string | null;
  created_at: string;
}

/** PostgREST returns `bytea` as the `\x…` hex escape form. */
function bytes(value: unknown): Buffer | null {
  if (typeof value !== 'string' || !value.startsWith('\\x') || value.length <= 2) return null;
  return Buffer.from(value.slice(2), 'hex');
}

interface Contact {
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  /** Where the values came from — the resume's sealed fields, or the account as a fallback. */
  source: 'resume' | 'profile';
}

/**
 * Name, email and phone for a run, opened from the sealed columns and logged.
 *
 * Falls back to the account's own name and sign-in address when the resume had none or the
 * deployment has no key — both of which the reader typed into CareerDeck themselves, so filling
 * them in reveals nothing new. The log row is written before anything is opened: §3.9 audits
 * the read, and a read that fails half-way was still a read.
 */
async function contactFor(run: RunRow, user: AuthedUser): Promise<Contact> {
  const [sealed, profile] = await Promise.all([
    adminClient
      .from('resume_profiles')
      .select('full_name_enc, email_enc, phone_enc')
      .eq('resume_id', run.resume_id)
      .maybeSingle<{ full_name_enc: string | null; email_enc: string | null; phone_enc: string | null }>(),
    adminClient
      .from('profiles')
      .select('first_name, last_name')
      .eq('id', run.user_id)
      .maybeSingle<{ first_name: string | null; last_name: string | null }>(),
  ]);

  let fullName: string | null = null;
  let email: string | null = null;
  let phone: string | null = null;

  const hasSealed = sealed.data && (sealed.data.full_name_enc || sealed.data.email_enc || sealed.data.phone_enc);
  if (hasSealed && canEncrypt()) {
    await logAccess({
      actorType: 'user',
      actorId: user.id,
      subject: run.user_id,
      resource: 'resume_profile',
      resourceId: run.resume_id,
      purpose: 'autoapply',
      detail: `contact fields for auto_apply_run ${run.id}`,
    });

    try {
      fullName = open(bytes(sealed.data!.full_name_enc));
      email = open(bytes(sealed.data!.email_enc));
      phone = open(bytes(sealed.data!.phone_enc));
    } catch (error) {
      // A seal this key cannot open is the rotation hazard PHASE4.md warns about. Loud, and the
      // draft still works from the account's own details.
      console.error('[autoapply] could not open a sealed contact field', error);
    }
  }

  const accountName = [profile.data?.first_name, profile.data?.last_name].filter(Boolean).join(' ') || null;
  const [first, ...rest] = (fullName ?? '').split(/\s+/).filter(Boolean);

  return {
    first_name: first ?? profile.data?.first_name ?? null,
    last_name: rest.length > 0 ? rest.join(' ') : profile.data?.last_name ?? null,
    full_name: fullName ?? accountName,
    email: email ?? user.email,
    phone,
    source: fullName || email || phone ? 'resume' : 'profile',
  };
}

export interface RunField extends FormField, DraftAnswer {}

/** A run as the review sheet needs it: every form field with its answer beside it. */
async function runView(run: RunRow, user: AuthedUser) {
  const fields: RunField[] = [];

  if (run.form && run.draft) {
    const needsContact = run.form.fields.some((f) => f.role === 'contact');
    const contact = needsContact ? await contactFor(run, user) : null;

    for (const f of run.form.fields) {
      const answer: DraftAnswer = run.draft.fields[f.key] ?? {
        value: null, confidence: null, source: 'reader', prompt: null,
      };

      if (f.role === 'contact' && contact && f.contact) {
        const value = contact[f.contact];
        fields.push({
          ...f,
          value,
          confidence: value ? 'high' : null,
          source: 'contact',
          prompt: value
            ? contact.source === 'profile' ? 'From your CareerDeck account.' : null
            : 'Not on your resume — fill it in yourself.',
        });
      } else {
        fields.push({ ...f, ...answer });
      }
    }
  }

  return {
    id: run.id,
    jobId: run.job_id,
    resumeId: run.resume_id,
    status: run.status,
    formSource: run.form_source,
    error: run.error,
    createdAt: run.created_at,
    fields,
  };
}

const RUN_SELECT = 'id, user_id, job_id, resume_id, status, form_source, form, draft, error, created_at';

async function ownedRun(runId: string, userId: string): Promise<RunRow> {
  const { data, error } = await adminClient
    .from('auto_apply_runs')
    .select(RUN_SELECT)
    .eq('id', runId)
    .eq('user_id', userId) // no RLS behind the admin client — scoping is this line's job
    .maybeSingle<RunRow>();

  if (error) throw error;
  if (!data) throw new HTTPException(404, { message: 'No such draft.', cause: 'not_found' });
  return data;
}

/** Everything the drafter reads, gathered for one run. The reader's identity is not in it. */
async function draftInputs(run: RunRow, user: AuthedUser) {
  const [job, resume, resumeProfile, profile, prefs, answers] = await Promise.all([
    adminClient
      .from('jobs')
      .select('id, title, company_name, location_raw, description_text, apply_url, external_id, source_id')
      .eq('id', run.job_id)
      .single(),
    adminClient.from('resumes').select('name').eq('id', run.resume_id).single(),
    adminClient
      .from('resume_profiles')
      .select('location, skills, education, experience, years_experience, seniority')
      .eq('resume_id', run.resume_id)
      .maybeSingle(),
    adminClient
      .from('profiles')
      .select('school_name_raw, major, graduation_year')
      .eq('id', run.user_id)
      .maybeSingle(),
    adminClient
      .from('user_preferences')
      .select('preferred_roles, preferred_locations')
      .eq('user_id', run.user_id)
      .maybeSingle(),
    adminClient
      .from('application_answers')
      .select('degree, field_of_study, work_authorized_us, needs_sponsorship, linkedin_url, github_url, portfolio_url, earliest_start, willing_to_relocate')
      .eq('user_id', run.user_id)
      .maybeSingle(),
  ]);
  if (answers.error) throw answers.error;

  if (job.error) throw job.error;
  if (resume.error) throw resume.error;
  if (!resumeProfile.data) throw new Error('The resume has no parsed profile.');

  // The drafter reads the parsed profile (not the PDF, not the contact fields). Still a read of
  // P0-adjacent data on the reader's behalf, so still logged.
  await logAccess({
    actorType: 'service',
    actorId: user.id,
    subject: run.user_id,
    resource: 'resume_profile',
    resourceId: run.resume_id,
    purpose: 'autoapply',
    detail: `draft for auto_apply_run ${run.id}`,
  });

  const rp = resumeProfile.data;
  return {
    job: job.data,
    input: {
      job: {
        title: job.data.title as string,
        companyName: job.data.company_name as string,
        location: (job.data.location_raw as string | null) ?? null,
        description: (job.data.description_text as string) ?? '',
      },
      resume: {
        name: resume.data.name as string,
        location: (rp.location as string | null) ?? null,
        skills: (rp.skills as string[]) ?? [],
        education: (rp.education as unknown[]) ?? [],
        experience: (rp.experience as unknown[]) ?? [],
        yearsExperience: rp.years_experience === null ? null : Number(rp.years_experience),
        seniority: (rp.seniority as string | null) ?? null,
      },
      profile: {
        school: (profile.data?.school_name_raw as string | null) ?? null,
        major: (profile.data?.major as string | null) ?? null,
        graduationYear: (profile.data?.graduation_year as number | null) ?? null,
        preferredRoles: (prefs.data?.preferred_roles as string[]) ?? [],
        preferredLocations: (prefs.data?.preferred_locations as string[]) ?? [],
        // The student's own saved answers — PHASE8.md §5. Renamed to what each one answers, so
        // the model maps "Will you require sponsorship?" without guessing at column names.
        applicationAnswers: {
          degree: answers.data?.degree ?? null,
          fieldOfStudy: answers.data?.field_of_study ?? null,
          authorizedToWorkInUS: answers.data?.work_authorized_us ?? null,
          requiresVisaSponsorship: answers.data?.needs_sponsorship ?? null,
          linkedinUrl: answers.data?.linkedin_url ?? null,
          githubUrl: answers.data?.github_url ?? null,
          portfolioUrl: answers.data?.portfolio_url ?? null,
          earliestStartDate: answers.data?.earliest_start ?? null,
          willingToRelocate: answers.data?.willing_to_relocate ?? null,
        },
      },
    },
  };
}

/**
 * `POST /v1/auto-apply` — §6's first five steps, from "reserve a credit" to "return a draft".
 *
 * Returns the run in whatever state it reached: `ready` with a draft, `failed` with a reason
 * (and the credit already back), or — when an earlier request for the same posting is still
 * drafting — `pending`, which the client polls with `GET /:id`.
 */
autoApply.post('/', async (c) => {
  const user = c.get('user');
  const body = (await c.req.json().catch(() => ({}))) as { jobId?: unknown; resumeId?: unknown };
  const jobId = uuidOrThrow(body.jobId, 'jobId');
  const resumeId = body.resumeId === undefined || body.resumeId === null ? null : uuidOrThrow(body.resumeId, 'resumeId');

  /*
   * Checked before the reservation, not after. Charging a credit and then refunding it because
   * this deployment has no model would be correct, and would put two ledger rows behind every
   * tap on a build that can never draft anything.
   */
  if (!capabilities.autoApply) {
    throw new HTTPException(503, {
      message: 'Auto Apply is not available on this deployment (ANTHROPIC_API_KEY is not set).',
      cause: 'unavailable',
    });
  }

  const started = await adminClient
    .rpc('start_auto_apply', { p_user_id: user.id, p_job_id: jobId, p_resume_id: resumeId })
    .single<{ run_id: string; status: RunRow['status']; charged: boolean; balance: number }>();
  if (started.error) rethrow(started.error);

  const { run_id: runId, charged } = started.data;
  let run = await ownedRun(runId, user.id);

  if (charged && run.status === 'pending') {
    let form: ApplicationForm | null = null;
    try {
      const gathered = await draftInputs(run, user);
      form = await formForJob({
        id: gathered.job.id as string,
        company_name: gathered.job.company_name as string,
        apply_url: gathered.job.apply_url as string,
        external_id: (gathered.job.external_id as string | null) ?? null,
        source_id: (gathered.job.source_id as string | null) ?? null,
      });

      const result = await draftApplication(form, gathered.input);

      const saved = await adminClient.rpc('save_auto_apply_draft', {
        p_run_id: runId,
        p_form_source: form.source,
        p_form: form,
        p_draft: result.draft,
        p_model: result.model,
        p_prompt_version: PROMPT_VERSION,
        p_tokens_in: result.tokensIn,
        p_tokens_out: result.tokensOut,
        p_cost_usd: result.costUsd,
      });
      if (saved.error) throw saved.error;
    } catch (error) {
      const usage = (error as { usage?: { model: string; tokensIn: number; tokensOut: number; costUsd: number | null } }).usage;
      const reason =
        error instanceof DrafterRefused ? 'The drafter declined this posting.'
          : error instanceof DrafterUnavailable ? error.message
            : 'The draft could not be written.';

      console.error('[autoapply] draft failed', runId, error);

      const failed = await adminClient.rpc('fail_auto_apply', {
        p_run_id: runId,
        p_reason: reason,
        p_model: usage?.model ?? null,
        p_tokens_in: usage?.tokensIn ?? null,
        p_tokens_out: usage?.tokensOut ?? null,
        p_cost_usd: usage?.costUsd ?? null,
      });
      if (failed.error) throw failed.error;
    }

    run = await ownedRun(runId, user.id);
  }

  return c.json({ run: await runView(run, user), charged, balance: await balanceOf(user.id) });
});

/** `GET /v1/auto-apply/:id` — a run, with its contact fields resolved and the read logged. */
autoApply.get('/:id', async (c) => {
  const user = c.get('user');
  const run = await ownedRun(uuidOrThrow(c.req.param('id'), 'id'), user.id);
  return c.json({ run: await runView(run, user) });
});

async function balanceOf(userId: string): Promise<number> {
  const { data, error } = await adminClient.rpc('credit_balance', { p_user_id: userId });
  if (error) throw error;
  return data as number;
}
