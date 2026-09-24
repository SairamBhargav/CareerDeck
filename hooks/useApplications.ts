import { useMemo } from 'react';

import { useCareerDeck } from '@/context/CareerDeckContext';
import { useJobsByIds } from '@/hooks/useJobFeeds';
import type { Application, ApplicationStatus, Job } from '@/types';

/** An application with the job it points at already resolved. */
export interface TrackedApplication {
  application: Application;
  job: Job;
}

export interface PipelineCounts {
  applied: number;
  interview: number;
  offer: number;
  closed: number;
  /** Everything still in play — the figure that actually answers "how am I doing". */
  active: number;
  total: number;
}

/**
 * Stage order for display. `closed` sits last deliberately: a rejection is still worth
 * keeping (it's a record of where you've been) but it shouldn't lead the list.
 */
const STATUS_RANK: Record<ApplicationStatus, number> = {
  offer: 0,
  interview: 1,
  applied: 2,
  closed: 3,
};

function byRecentActivity(a: Application, b: Application): number {
  return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
}

/**
 * The tracker's list, joined to the postings it points at and ordered the way a student
 * actually reads it: whatever is furthest along first, then most recently touched.
 *
 * Jobs are fetched by id rather than looked up in a loaded feed. The old version searched
 * the whole in-memory corpus; with a paginated one, "the page currently loaded" is not a
 * place an application's job can be assumed to be.
 *
 * The company is gone from the return type — a `Job` now carries its company's name, logo
 * and brand colour, because the feed query joins them to build the card anyway.
 *
 * **Phase 1 note (PHASE1.md §8.6):** `mockApplications` points at fixture job ids that no
 * longer exist, so this correctly resolves to nothing and the Activity tab reads empty
 * until phase 2 builds the real `applications` table. That is the intended outcome, not a
 * regression — the alternative kept two definitions of what a Job is alive for a phase.
 */
export function useTrackedApplications(): TrackedApplication[] {
  const { applications } = useCareerDeck();

  const jobIds = useMemo(() => applications.map((application) => application.jobId), [applications]);
  const { jobs } = useJobsByIds(jobIds);

  return useMemo(() => {
    const jobById = new Map(jobs.map((job) => [job.id, job]));

    return applications
      .map((application) => {
        const job = jobById.get(application.jobId);
        return job ? { application, job } : null;
      })
      .filter((entry): entry is TrackedApplication => entry !== null)
      .sort(
        (a, b) =>
          STATUS_RANK[a.application.status] - STATUS_RANK[b.application.status] ||
          byRecentActivity(a.application, b.application),
      );
  }, [applications, jobs]);
}

/** Stage tallies for the summary strip at the top of Activity. */
export function usePipelineCounts(): PipelineCounts {
  const { applications } = useCareerDeck();

  return useMemo(() => {
    const count = (status: ApplicationStatus) =>
      applications.filter((application) => application.status === status).length;

    const applied = count('applied');
    const interview = count('interview');
    const offer = count('offer');
    const closed = count('closed');

    return {
      applied,
      interview,
      offer,
      closed,
      active: applied + interview + offer,
      total: applications.length,
    };
  }, [applications]);
}
