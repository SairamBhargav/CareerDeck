/**
 * Reading a resume — docs/README.md §3.9, the step that makes `resume_profiles` exist.
 *
 * One model call. The PDF goes up as a `document` content block and a forced tool call comes
 * back holding the structured profile, which is the same shape phase 3's classifier uses and
 * for the same reason: there is no conversational answer wanted here, only a record.
 *
 * ── Why the PDF goes up whole ─────────────────────────────────────────────────
 *
 * The obvious cheaper design extracts text with a PDF library and sends the text. It is
 * rejected because resumes are the worst case for text extraction: two-column layouts
 * interleave into nonsense, skills live in tables and sidebars, and dates sit in a right-hand
 * gutter that a text extractor emits fifty lines away from the job title they belong to. The
 * model reads the rendered page, so a two-column resume parses like a two-column resume.
 *
 * It also means no PDF parsing library in the dependency tree, which matters more than it
 * sounds: a PDF parser is a decoder for a hostile file format running in the same process as
 * the service-role key. Not having one is a real reduction in attack surface.
 *
 * ── What it is asked for, and what it is told not to do ───────────────────────
 *
 * The prompt's whole job is to prevent the two failure modes that make a parsed profile worse
 * than none:
 *
 *  1. **Inventing.** A model asked for `years_experience` will produce a number for a resume
 *    that does not state one. §6's Auto Apply rule — "never fabricate a fact" — starts here,
 *    because this is the row Auto Apply will read from. Every field is nullable and the prompt
 *    says absence is a valid answer.
 *  2. **Free-form skills.** §4.5's warning, arriving from the resume side: left alone the model
 *    returns `React`, `ReactJS`, `React.js` and `react` for one fact, and the Jaccard in
 *    `compute_match()` then scores an exact match as a partial one. The prompt pins the
 *    vocabulary to the same dictionary phase 1 normalizes job skills against.
 */

import Anthropic from '@anthropic-ai/sdk';

import { env } from '../env.ts';

/** Matches `public.seniority_level`. */
export type Seniority = 'intern' | 'new_grad' | 'mid' | 'senior' | 'staff_plus';

export interface ParsedEducation {
  school: string | null;
  degree: string | null;
  field: string | null;
  graduationYear: number | null;
}

export interface ParsedExperience {
  company: string | null;
  title: string | null;
  startDate: string | null;
  endDate: string | null;
  isCurrent: boolean;
}

export interface ParsedResume {
  fullName: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  skills: string[];
  education: ParsedEducation[];
  experience: ParsedExperience[];
  yearsExperience: number | null;
  seniority: Seniority | null;
  pageCount: number | null;
}

/**
 * Bumped whenever the prompt, the schema or the model default changes in a way that would make
 * a re-parse produce a different answer.
 *
 * Stored on every row so a sweep can find everything parsed by a version with a known bug.
 * That is not hypothetical — the first thing to go wrong with an extractor is a field it reads
 * subtly wrong on one resume layout, discovered a month later, and the fix is worthless
 * without a way to enumerate the affected rows.
 */
export const PARSER_VERSION = 'resume-extract-1';

const SYSTEM = `You extract structured data from a resume PDF. You are a parser, not an assistant.

Return exactly one call to the \`profile\` tool. Never add commentary.

## The rule that matters most

**Every field is optional, and absence is a valid answer.** If the resume does not state
something, return null (or an empty array). Do not infer, estimate, round, or fill a field
because it looks like it should have a value. A null is correct and useful; a plausible
invention is neither, and this data is later used to fill in job applications on the person's
behalf.

Specifically:
- \`yearsExperience\`: only when the resume states it or when dated roles let you total it
  exactly. Do not estimate from a graduation year.
- \`seniority\`: only when the resume's own titles and dates support it. A student with two
  internships is \`intern\` or \`new_grad\`, never \`mid\`.
- Dates you cannot read: null. A wrong date is worse than a missing one.

## Skills

Return skills as lowercase slugs from the controlled vocabulary style below, one concept per
entry, and canonicalize aggressively:

- \`React\`, \`ReactJS\`, \`React.js\` → \`react\`
- \`Node\`, \`Node.js\`, \`NodeJS\` → \`node\`
- \`Postgres\`, \`PostgreSQL\` → \`postgresql\`
- \`AWS\`, \`Amazon Web Services\` → \`aws\`
- Multi-word: hyphenate — \`machine-learning\`, \`data-analysis\`, \`c-plus-plus\`

Include technologies, languages, frameworks, tools and named methodologies. Exclude soft
skills ("team player", "communication"), spoken languages, and anything that is a job title
rather than a skill. Cap at 60 entries, most prominent first.

## Seniority

Pick the one that describes what this person is applying *as*:
- \`intern\` — currently a student, seeking internships, or only internship experience
- \`new_grad\` — graduated within about a year, or under ~1 year of full-time experience
- \`mid\` — roughly 2–5 years
- \`senior\` — roughly 5–10 years, or the title says Senior
- \`staff_plus\` — Staff, Principal, Distinguished, or engineering management

## Location

City and region only — "Boulder, CO", "London, UK". Never a street address, even though one
may be printed on the page. This field is used for matching, not for identifying anyone.`;

const PROFILE_TOOL: Anthropic.Tool = {
  name: 'profile',
  description: 'The structured contents of the resume.',
  /*
   * `strict: true` with `additionalProperties: false` throughout, so the tool input can be
   * read without re-validating every field. The one thing it cannot guarantee is semantic
   * sanity — a model can return a well-typed `yearsExperience` of 300 — so `normalize()` below
   * still clamps. Schema validity and plausibility are different properties.
   */
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      fullName: { type: ['string', 'null'], description: 'As printed on the resume.' },
      email: { type: ['string', 'null'] },
      phone: { type: ['string', 'null'] },
      location: { type: ['string', 'null'], description: 'City and region only.' },
      skills: { type: 'array', items: { type: 'string' }, description: 'Lowercase slugs.' },
      education: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            school: { type: ['string', 'null'] },
            degree: { type: ['string', 'null'] },
            field: { type: ['string', 'null'] },
            graduationYear: { type: ['integer', 'null'] },
          },
          required: ['school', 'degree', 'field', 'graduationYear'],
        },
      },
      experience: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            company: { type: ['string', 'null'] },
            title: { type: ['string', 'null'] },
            startDate: { type: ['string', 'null'], description: 'YYYY-MM when known.' },
            endDate: { type: ['string', 'null'], description: 'YYYY-MM, or null if current.' },
            isCurrent: { type: 'boolean' },
          },
          required: ['company', 'title', 'startDate', 'endDate', 'isCurrent'],
        },
      },
      yearsExperience: { type: ['number', 'null'] },
      /*
       * `anyOf`, not `type: ['string', 'null']` + `enum`. The latter is what every other
       * nullable field on this tool uses, and it is what the strict-mode validator rejects
       * the moment an `enum` is added to it — a live 400 read "Enum value 'intern' does not
       * match declared type '['string', 'null']'", which is Anthropic's strict schema
       * checker refusing to reconcile an array `type` against an `enum` that only covers one
       * of its branches. Splitting the two branches into their own subschemas is what strict
       * mode actually validates: a real enum on the string side, and a bare null branch.
       */
      seniority: {
        anyOf: [
          { type: 'string', enum: ['intern', 'new_grad', 'mid', 'senior', 'staff_plus'] },
          { type: 'null' },
        ],
      },
      pageCount: { type: ['integer', 'null'], description: 'Pages in the document.' },
    },
    required: [
      'fullName', 'email', 'phone', 'location', 'skills', 'education',
      'experience', 'yearsExperience', 'seniority', 'pageCount',
    ],
  },
};

let cached: Anthropic | null = null;

function client(): Anthropic | null {
  if (!env.anthropicApiKey) return null;
  if (!cached) {
    cached = new Anthropic({
      apiKey: env.anthropicApiKey,
      /*
       * Far longer than the classifier's 2.5s, because this is a different kind of wait. A
       * comment blocks a user staring at a composer; a parse runs behind a progress state on
       * the review screen and the user has just spent thirty seconds picking a file. Reading
       * several rendered pages is genuinely slower than reading one sentence.
       */
      timeout: env.resumeParseTimeoutMs,
      maxRetries: 1,
    });
  }
  return cached;
}

const SENIORITIES: readonly Seniority[] = ['intern', 'new_grad', 'mid', 'senior', 'staff_plus'];

/** One skill slug, or null if what came back is not usable as one. */
function slug(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9+#.\- ]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');
  // One character is noise, and forty is a sentence that lost a fight with the slug rule.
  return cleaned.length >= 2 && cleaned.length <= 40 ? cleaned : null;
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, max) : null;
}

/**
 * Everything `strict: true` cannot promise.
 *
 * The schema guarantees shapes and types. It does not guarantee that the years are a number a
 * human could have accumulated, that the skills are slugs rather than sentences, or that the
 * list is 60 long rather than 600 — and each of those reaches a database constraint or a
 * Jaccard denominator if it is not caught here.
 */
function normalize(input: Record<string, unknown>): ParsedResume {
  const rawSkills = Array.isArray(input.skills) ? input.skills : [];
  const skills = [...new Set(rawSkills.map(slug).filter((s): s is string => s !== null))].slice(0, 60);

  const rawYears = typeof input.yearsExperience === 'number' ? input.yearsExperience : null;
  const years =
    rawYears !== null && Number.isFinite(rawYears) && rawYears >= 0 && rawYears <= 60
      ? Math.round(rawYears * 10) / 10
      : null;

  const seniority =
    typeof input.seniority === 'string' && (SENIORITIES as readonly string[]).includes(input.seniority)
      ? (input.seniority as Seniority)
      : null;

  const education = (Array.isArray(input.education) ? input.education : [])
    .slice(0, 10)
    .map((entry): ParsedEducation => {
      const e = (entry ?? {}) as Record<string, unknown>;
      const year = typeof e.graduationYear === 'number' ? Math.trunc(e.graduationYear) : null;
      return {
        school: text(e.school, 200),
        degree: text(e.degree, 120),
        field: text(e.field, 120),
        // A graduation year outside this window is an OCR artefact, not a fact.
        graduationYear: year !== null && year >= 1950 && year <= 2100 ? year : null,
      };
    });

  const experience = (Array.isArray(input.experience) ? input.experience : [])
    .slice(0, 25)
    .map((entry): ParsedExperience => {
      const e = (entry ?? {}) as Record<string, unknown>;
      return {
        company: text(e.company, 200),
        title: text(e.title, 200),
        startDate: text(e.startDate, 10),
        endDate: text(e.endDate, 10),
        isCurrent: e.isCurrent === true,
      };
    });

  const pages = typeof input.pageCount === 'number' ? Math.trunc(input.pageCount) : null;

  return {
    fullName: text(input.fullName, 200),
    email: text(input.email, 320),
    phone: text(input.phone, 50),
    location: text(input.location, 200),
    skills,
    education,
    experience,
    yearsExperience: years,
    seniority,
    pageCount: pages !== null && pages > 0 && pages <= 100 ? pages : null,
  };
}

export class ExtractorUnavailable extends Error {}
export class ExtractorRefused extends Error {}

/**
 * Reads one resume.
 *
 * Unlike the classifier, this **throws**. The two sit at opposite ends of the same question:
 * the classifier guards a write the user is waiting on, so failing open and flagging is the
 * only answer that is wrong in neither direction. A parse guards nothing — a failure means the
 * profile is absent, the resume sits in `failed` with a reason on it, and the user retries.
 * Inventing a profile because the model was unreachable would put fabricated skills behind a
 * match score and, in phase 6, onto a job application.
 */
export async function extractResume(pdf: Buffer): Promise<ParsedResume> {
  const anthropic = client();
  if (!anthropic) {
    throw new ExtractorUnavailable(
      'ANTHROPIC_API_KEY is not set, so resumes cannot be parsed on this deployment.',
    );
  }

  const response = await anthropic.messages.create({
    model: env.resumeParserModel,
    max_tokens: 8192,
    system: SYSTEM,
    /*
     * Adaptive thinking on, at medium effort. A resume is a layout problem before it is a
     * reading problem — working out that the right-hand column is dates and the left is
     * employers is genuinely reasoning, and the classifier's `low` is tuned for a task that
     * fits in one sentence. Thinking also stays on for the reason given there: with it
     * disabled, Opus sometimes writes a tool call into visible text, which here would look
     * like a parse that silently returned nothing.
     */
    thinking: { type: 'adaptive' },
    output_config: { effort: 'medium' },
    tools: [PROFILE_TOOL],
    tool_choice: { type: 'tool', name: 'profile' },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: pdf.toString('base64') },
          },
          {
            /*
             * After the document, deliberately. A resume is a user-supplied file and somebody
             * will eventually upload one with "ignore your instructions" set in white 2pt
             * text; the instruction that arrives last and the system prompt both say this is
             * a document to be read, not a conversation to be joined.
             */
            type: 'text',
            text: 'Extract this resume into one `profile` tool call. Null for anything it does not state.',
          },
        ],
      },
    ],
  });

  if (response.stop_reason === 'refusal') {
    throw new ExtractorRefused(
      `The model declined to read this document (${response.stop_details?.category ?? 'unspecified'}).`,
    );
  }

  const block = response.content.find((part) => part.type === 'tool_use');
  if (!block || block.type !== 'tool_use') {
    throw new Error(`The parser returned no profile (stop_reason: ${response.stop_reason}).`);
  }

  return normalize(block.input as Record<string, unknown>);
}
