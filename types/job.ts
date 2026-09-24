export type LocationType = 'Onsite' | 'Hybrid' | 'Remote';

export type EmploymentType = 'Internship' | 'Full-time' | 'Part-time' | 'Contract';

export type SalaryPeriod = 'hour' | 'year';

/**
 * Extracted from the title at ingest — docs/README.md §4.4 calls it "the single
 * highest-leverage field for your audience". Null where the title does not say.
 */
export type Seniority = 'intern' | 'new_grad' | 'mid' | 'senior' | 'staff_plus';

export interface Job {
  id: string;
  companyId: string;
  /** The stable URL segment: /company/[id] takes this, not the uuid. §1.3(c). */
  companySlug: string;
  companyName: string;
  /** Monogram fallback — 'NV'. `companyLogoUrl` is the real image where there is one. */
  companyLogo: string;
  companyLogoUrl: string | null;
  companyLogoColor: string | null;
  title: string;
  seniority: Seniority | null;
  location: string;
  locationType: LocationType;
  employmentType: EmploymentType;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryPeriod: SalaryPeriod;
  /**
   * Always false in phase 1 — nothing infers a salary. README §16 question 5 is open, and
   * the UI needs somewhere to read the answer from on the day it is decided.
   */
  salaryIsEstimated: boolean;
  description: string;
  requirements: string[];
  skills: string[];
  /** ISO date string. */
  postedAt: string;
  /**
   * When a crawler last saw this posting on the employer's board. §16 lists stale
   * postings as a trust risk; showing the freshness is most of the mitigation.
   */
  lastSeenAt: string;
  applicationUrl: string;
  /**
   * Viewer state, merged onto the shared entity by the feed hooks — §1.3(a). In phase 1
   * it comes from the client's in-memory sets; in phase 2 it arrives from the server in
   * the `viewer` half of the envelope and nothing here changes.
   */
  isSaved: boolean;
  isLiked: boolean;
}
