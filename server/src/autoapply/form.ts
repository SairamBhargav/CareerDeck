/**
 * The questions an Auto Apply draft answers — §6's "fetch the ATS form schema for this posting".
 *
 * ── Where they come from ──────────────────────────────────────────────────────
 *
 * **Greenhouse** publishes each posting's real application form through the same public
 * Job Board API the crawler already reads: `GET /v1/boards/{token}/jobs/{id}?questions=true`
 * returns the standard contact block, every custom question with its type and options, and the
 * EEOC and demographic blocks. That is the form, so the draft answers the form.
 *
 * **Everybody else gets the standard set** below. Ashby's documented posting API returns no
 * form at all (checked against a live board while this phase was built; PHASE6.md §5.1),
 * Lever's v0 postings API does not either, and Workday's forms live behind a per-tenant account
 * system. Ashby does run an undocumented GraphQL endpoint with the form in it — and §4.3 is
 * explicit that the crawler reads published APIs and nothing else. A draft is not worth
 * changing the legal posture for.
 *
 * ── What is never drafted ─────────────────────────────────────────────────────
 *
 * Three roles are filled without the model or not at all:
 *
 *  - `contact` — name, email, phone. Resolved by the service from the sealed resume columns at
 *    read time, never stored in the draft and never sent to the model.
 *  - `attachment` — resume and cover-letter uploads. The reader attaches the file themselves.
 *  - `self_identify` — EEOC and demographic questions: gender, race, veteran and disability
 *    status, pronouns. Always left for the reader, always optional to them, and never shown to
 *    a model. Guessing a protected characteristic from a resume is both the worst fabrication
 *    §6 forbids and a thing nobody should build.
 */

import { adminClient } from '../auth.ts';
import { USER_AGENT } from '../ingest/http.ts';

export type FieldKind = 'text' | 'long_text' | 'select' | 'multi_select' | 'file';
export type FieldRole = 'contact' | 'attachment' | 'answer' | 'self_identify';
export type ContactPart = 'first_name' | 'last_name' | 'full_name' | 'email' | 'phone';

export interface FormField {
  /** Stable within one form — Greenhouse's own field name where there is one. */
  key: string;
  label: string;
  description: string | null;
  required: boolean;
  kind: FieldKind;
  /** The only values a select may take. Null for free text. */
  options: string[] | null;
  role: FieldRole;
  /** Which contact detail, when `role` is `contact`. */
  contact: ContactPart | null;
}

export interface ApplicationForm {
  source: 'greenhouse' | 'standard';
  fields: FormField[];
}

interface JobForForm {
  id: string;
  company_name: string;
  apply_url: string;
  external_id: string | null;
  source_id: string | null;
}

const YES_NO = ['Yes', 'No'];

function field(
  key: string,
  label: string,
  kind: FieldKind,
  role: FieldRole,
  extra: Partial<Pick<FormField, 'required' | 'options' | 'contact' | 'description'>> = {},
): FormField {
  return {
    key,
    label,
    kind,
    role,
    description: extra.description ?? null,
    required: extra.required ?? false,
    options: extra.options ?? null,
    contact: extra.contact ?? null,
  };
}

/**
 * The fields almost every application asks for, in the order they are usually asked.
 *
 * Work authorization and sponsorship are here because nearly every US form asks them and a
 * student cannot skip them — and they are exactly the questions the drafter must never
 * answer from inference. They arrive as `null` with a prompt every time, and that is the
 * correct draft.
 */
export function standardForm(companyName: string): ApplicationForm {
  return {
    source: 'standard',
    fields: [
      field('first_name', 'First name', 'text', 'contact', { required: true, contact: 'first_name' }),
      field('last_name', 'Last name', 'text', 'contact', { required: true, contact: 'last_name' }),
      field('email', 'Email', 'text', 'contact', { required: true, contact: 'email' }),
      field('phone', 'Phone', 'text', 'contact', { contact: 'phone' }),
      field('resume', 'Resume', 'file', 'attachment', { required: true }),
      field('location', 'Where are you based?', 'text', 'answer'),
      field('school', 'School', 'text', 'answer'),
      field('degree', 'Degree and field of study', 'text', 'answer'),
      field('graduation', 'Graduation date', 'text', 'answer'),
      field('linkedin', 'LinkedIn profile', 'text', 'answer'),
      field('website', 'Website or portfolio', 'text', 'answer'),
      field('work_authorization', 'Are you legally authorized to work in the United States?', 'select',
        'answer', { required: true, options: YES_NO }),
      field('sponsorship', 'Will you now or in the future require visa sponsorship?', 'select',
        'answer', { required: true, options: YES_NO }),
      field('start_date', 'When could you start?', 'text', 'answer'),
      field('why_company', `Why do you want to work at ${companyName}?`, 'long_text', 'answer'),
    ],
  };
}

// ── greenhouse ─────────────────────────────────────────────────────────────────

const CONTACT_FIELDS: Record<string, ContactPart> = {
  first_name: 'first_name',
  last_name: 'last_name',
  email: 'email',
  phone: 'phone',
};

const GREENHOUSE_KIND: Record<string, FieldKind> = {
  input_text: 'text',
  textarea: 'long_text',
  multi_value_single_select: 'select',
  multi_value_multi_select: 'multi_select',
  input_file: 'file',
};

type Json = Record<string, unknown>;

function asRecord(value: unknown): Json {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function str(value: unknown): string | null {
  if (typeof value === 'number') return String(value);
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/** Greenhouse descriptions are HTML fragments; a draft sheet wants a sentence. */
function plain(html: string | null): string | null {
  if (!html) return null;
  const text = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length > 0 ? text.slice(0, 400) : null;
}

/**
 * One Greenhouse question. A question can carry several inputs — "Resume/CV" is a file input
 * *and* a paste-it-here textarea — and the form has one answer per question, so the first
 * input that is not a hidden one decides the field.
 */
function greenhouseQuestion(question: Json, role: FieldRole): FormField | null {
  const label = str(question.label);
  const inputs = asArray(question.fields).map(asRecord);
  const input = inputs.find((f) => str(f.type) !== 'input_hidden');
  if (!label || !input) return null;

  const name = str(input.name);
  const kind = GREENHOUSE_KIND[str(input.type) ?? ''];
  if (!name || !kind) return null;

  const options = asArray(input.values)
    .map((v) => str(asRecord(v).label))
    .filter((v): v is string => v !== null);

  const contact = role === 'self_identify' ? null : CONTACT_FIELDS[name] ?? null;
  const resolvedRole: FieldRole =
    role === 'self_identify' ? 'self_identify'
      : contact ? 'contact'
        : inputs.some((f) => str(f.type) === 'input_file') ? 'attachment'
          : role;

  return {
    key: name,
    label,
    description: plain(str(question.description)),
    required: question.required === true,
    kind: resolvedRole === 'attachment' ? 'file' : kind,
    options: options.length > 0 ? options : null,
    role: resolvedRole,
    contact,
  };
}

/** Greenhouse's newer demographic block has its own shape: `answer_options`, not `fields`. */
function demographicQuestion(question: Json): FormField | null {
  const id = str(question.id);
  const label = str(question.label);
  if (!id || !label) return null;

  const options = asArray(question.answer_options)
    .map((o) => str(asRecord(o).label))
    .filter((o): o is string => o !== null);

  return {
    key: `demographic_${id}`,
    label,
    description: null,
    required: question.required === true,
    kind: str(question.type) === 'multi_value_multi_select' ? 'multi_select' : 'select',
    options: options.length > 0 ? options : null,
    role: 'self_identify',
    contact: null,
  };
}

export function parseGreenhouseForm(payload: Json): ApplicationForm {
  const fields: FormField[] = [];
  const seen = new Set<string>();
  const push = (f: FormField | null) => {
    if (f && !seen.has(f.key)) {
      seen.add(f.key);
      fields.push(f);
    }
  };

  for (const q of asArray(payload.questions)) push(greenhouseQuestion(asRecord(q), 'answer'));
  // Location questions are mostly hidden latitude/longitude inputs; the visible ones are answers.
  for (const q of asArray(payload.location_questions)) push(greenhouseQuestion(asRecord(q), 'answer'));

  for (const block of asArray(payload.compliance)) {
    for (const q of asArray(asRecord(block).questions)) push(greenhouseQuestion(asRecord(q), 'self_identify'));
  }
  for (const q of asArray(asRecord(payload.demographic_questions).questions)) {
    push(demographicQuestion(asRecord(q)));
  }

  /*
   * Pronouns ride in the ordinary custom questions on most boards, not in the demographic
   * block. It is a self-identification question wherever it appears.
   */
  for (const f of fields) {
    if (f.role === 'answer' && /pronoun|gender|ethnic|race|veteran|disabilit|sexual orientation/i.test(f.label)) {
      f.role = 'self_identify';
    }
  }

  return { source: 'greenhouse', fields };
}

/**
 * Board token and posting id for a Greenhouse posting, from the crawl source when the posting
 * came from one and from the apply URL when it came through an aggregator.
 */
async function greenhouseRef(job: JobForForm): Promise<{ token: string; id: string } | null> {
  if (job.source_id && job.external_id) {
    const { data } = await adminClient
      .from('job_sources')
      .select('kind, board_token')
      .eq('id', job.source_id)
      .maybeSingle<{ kind: string; board_token: string | null }>();
    if (data?.kind === 'greenhouse' && data.board_token) {
      return { token: data.board_token, id: job.external_id };
    }
  }

  // boards.greenhouse.io/{token}/jobs/{id} and job-boards.greenhouse.io/{token}/jobs/{id}.
  const match = /greenhouse\.io\/(?:embed\/job_app\?for=)?([a-z0-9_-]+)\/jobs\/(\d+)/i.exec(job.apply_url);
  return match?.[1] && match[2] ? { token: match[1], id: match[2] } : null;
}

/**
 * The form for one posting. Never throws: a Greenhouse board that is down, slow or has
 * renamed a field falls back to the standard set, because a draft against the common
 * questions is still worth the credit and a failed run is not.
 */
export async function formForJob(job: JobForForm): Promise<ApplicationForm> {
  const ref = await greenhouseRef(job).catch(() => null);
  if (!ref) return standardForm(job.company_name);

  try {
    const response = await fetch(
      `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(ref.token)}/jobs/${encodeURIComponent(ref.id)}?questions=true`,
      { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(8_000) },
    );
    if (!response.ok) return standardForm(job.company_name);

    const form = parseGreenhouseForm(asRecord(await response.json()));
    // A form with nothing to answer is a parse that went wrong, not an empty application.
    return form.fields.some((f) => f.role === 'answer') ? form : standardForm(job.company_name);
  } catch {
    return standardForm(job.company_name);
  }
}
