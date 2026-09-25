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
  components: {
    skillOverlap?: number;
    seniority?: number;
    location?: number;
  };
  /**
   * How much of the formula had an input, 0–1. A posting that lists no skills is scored on
   * seniority and location alone and renormalized, so a 90 at 0.45 coverage and a 90 at 1.0
   * are different claims — this is what lets the UI say so instead of showing both as 90.
   */
  coverage: number;
  computedAt: string;
}
