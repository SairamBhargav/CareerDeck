/**
 * Where an application was actually submitted. CareerDeck cannot post to an applicant
 * tracking system on the user's behalf — every one of these is a site the user was
 * handed off to — so the source is recorded and shown rather than hidden.
 */
export type ApplicationSource = 'greenhouse' | 'workday' | 'lever' | 'ashby' | 'company';

/**
 * Stages a student's application moves through. Deliberately coarse: an online
 * assessment, a recruiter screen and an onsite are all `interview` here, because the
 * user is the one maintaining this and a longer list is a longer chore.
 */
export type ApplicationStatus = 'applied' | 'interview' | 'offer' | 'closed';

export interface Application {
  id: string;
  jobId: string;
  status: ApplicationStatus;
  source: ApplicationSource;
  /** ISO date the user submitted it. */
  appliedAt: string;
  /** ISO date the status last moved — what the list sorts on. */
  updatedAt: string;
  /**
   * True when the user told us they applied rather than us observing it. Always true
   * today: there is no integration that can confirm a submission, so the tracker is
   * self-reported by construction and the UI shouldn't imply otherwise.
   */
  selfReported: boolean;
}
