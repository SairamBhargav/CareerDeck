/**
 * A stored resume — README §3.9, now a real document rather than a bundled asset.
 *
 * Phase 3 and earlier, this type described two PDFs compiled into the app: `pdf: number` was
 * a Metro asset handle from `require()`, and `thumbnail` was an `ImageSourcePropType`. Neither
 * survives, because neither can describe a file the user chose this afternoon.
 *
 * What replaced them is the shape of the change: there is **no file handle on this type at
 * all**. A resume the client holds is metadata and a parsed profile; the bytes live in a
 * private bucket and are reachable only through a signed URL the API service issues one
 * request at a time, because §3.9 requires every read of a resume to be logged. A path or a
 * handle sitting on this object would be a way to read the document without saying so.
 */

/** Matches `public.resume_parse_status`. */
export type ResumeParseStatus = 'pending' | 'parsing' | 'parsed' | 'failed';

/** Matches `public.seniority_level`, and the same union `Job.seniority` uses. */
export type ResumeSeniority = 'intern' | 'new_grad' | 'mid' | 'senior' | 'staff_plus';

export interface ResumeEducation {
  school: string | null;
  degree: string | null;
  field: string | null;
  graduationYear: number | null;
}

export interface ResumeExperience {
  company: string | null;
  title: string | null;
  /** `YYYY-MM` when the parser could read one. */
  startDate: string | null;
  endDate: string | null;
  isCurrent: boolean;
}

/**
 * What the parser read, as the review screen shows it.
 *
 * Contact details are deliberately absent. The extractor finds them and seals them, and
 * nothing in this phase decrypts them — PHASE4.md §4.4. `contactFound` is how the screen says
 * "we have your email" without the email making the trip.
 */
export interface ResumeProfile {
  skills: string[];
  education: ResumeEducation[];
  experience: ResumeExperience[];
  yearsExperience: number | null;
  location: string | null;
  seniority: ResumeSeniority | null;
  /** Null until the parse lands. */
  parsedAt: string | null;
  /** Null until the user has looked at the parse and pressed the button. */
  confirmedAt: string | null;
}

export interface Resume {
  id: string;
  name: string;
  /** Short subtitle on the shelf, e.g. "Software Engineering". User-set, or from the parse. */
  focus: string | null;
  fileSize: number | null;
  pageCount: number | null;
  isDefault: boolean;
  parseStatus: ResumeParseStatus;
  /** Why the parse failed, in words worth showing. Null unless `parseStatus` is `failed`. */
  parseError: string | null;
  profile: ResumeProfile;
  createdAt: string;
  updatedAt: string;
}

/**
 * One posting's match against the default resume — README §3.10.
 *
 * `components` is the reason this is an object rather than a number. §13.3: ranking somebody's
 * employment opportunities is automated decision-making, and "why is this 43%" has to have an
 * answer. Each value is 0–1 under the name the scorer wrote it with.
 */
export interface MatchScore {
  score: number;
  /** Scorer v3 (20261020000000_match_score_v3.sql). */
  components: {
    /** Share of the posting's core skills the resume has, 0–1, with 60% scored as full marks. */
    skills?: number;
    /** What the resume's past roles say about this posting, 0–1. 0 when none are relevant. */
    experience?: number;
    /** The posting's field against the reader's degree, major, or relevant roles, 0–1. */
    field?: number;
    /** Whether `field` came from what the reader studied or from where they have worked. */
    fieldSource?: 'degree' | 'experience';
    seniority?: number;
    /** The posting's skills the resume has, and the core ones it does not, as the posting labels them. */
    matched: string[];
    missing: string[];
    /** The past roles that counted, strongest first. `index` points into the resume's `experience`. */
    roles: MatchRole[];
    jobFamily?: string;
    /** No core skills to compare, so the score is capped and an estimate. */
    limited: boolean;
    /** Which side had no skills: the posting listed none, or the resume did. */
    limitedReason?: 'posting' | 'resume';
    /** The weighted score before any cap or the ceiling, 0–100. */
    raw?: number;
    /** The cap that held the score down, when one did. */
    cap?: { at: number; reason: MatchCapReason };
  };
  /**
   * How much of the formula had an input, 0–1: the sum of the weights that were answerable.
   * Each component's points are `100 × weight × value / coverage`.
   */
  coverage: number;
  computedAt: string;
}

export type MatchCapReason = 'off_field' | 'adjacent_field' | 'level' | 'no_skills';

export interface MatchRole {
  index: number;
  family: string;
  months: number | null;
  /** How close the role's field is to the posting's, 0–1. */
  relevance: number;
}
