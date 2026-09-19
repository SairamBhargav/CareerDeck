import { useMemo } from 'react';

import { useCareerDeck } from '@/context/CareerDeckContext';
import type { Application, ApplicationStatus, Company, Job } from '@/types';

/** An application with the job and company it points at already resolved. */
export interface TrackedApplication {
  application: Application;
  job: Job;
  company: Company | undefined;
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
 * The tracker's list, joined to jobs and companies and ordered the way a student
 * actually reads it: whatever is furthest along first, then most recently touched.
 * Applications whose job has fallen out of the feed are dropped rather than rendered
 * as an empty card.
 */
export function useTrackedApplications(): TrackedApplication[] {
  const { applications, jobs, companies } = useCareerDeck();

  return useMemo(() => {
    const jobById = new Map(jobs.map((job) => [job.id, job]));
    const companyById = new Map(companies.map((company) => [company.id, company]));

    return applications
      .map((application) => {
        const job = jobById.get(application.jobId);
        return job ? { application, job, company: companyById.get(job.companyId) } : null;
      })
      .filter((entry): entry is TrackedApplication => entry !== null)
      .sort(
        (a, b) =>
          STATUS_RANK[a.application.status] - STATUS_RANK[b.application.status] ||
          byRecentActivity(a.application, b.application),
      );
  }, [applications, jobs, companies]);
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
