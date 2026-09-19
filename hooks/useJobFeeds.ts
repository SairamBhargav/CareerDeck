import { useMemo } from 'react';

import { useCareerDeck } from '@/context/CareerDeckContext';
import { suggestedCompanyIds } from '@/data/mockCompanies';
import type { Company, Job } from '@/types';

export type ReelFeed = 'following' | 'forYou';

interface JobFeeds {
  /** Every job, newest first. */
  forYouJobs: Job[];
  /** Jobs from companies the user currently follows. */
  followingJobs: Job[];
  suggestedCompanies: Company[];
}

function byNewest(a: Job, b: Job): number {
  return new Date(b.postedAt).getTime() - new Date(a.postedAt).getTime();
}

export function useJobFeeds(): JobFeeds {
  const { jobs, companies, followedCompanyIds } = useCareerDeck();

  return useMemo(() => {
    const forYouJobs = [...jobs].sort(byNewest);
    const followed = new Set(followedCompanyIds);

    const companyById = new Map(companies.map((company) => [company.id, company]));
    const suggestedCompanies = suggestedCompanyIds
      .map((id) => companyById.get(id))
      .filter((company): company is Company => company !== undefined);

    return {
      forYouJobs,
      followingJobs: forYouJobs.filter((job) => followed.has(job.companyId)),
      suggestedCompanies,
    };
  }, [jobs, companies, followedCompanyIds]);
}

export function useJobById(jobId: string | undefined): Job | undefined {
  const { jobs } = useCareerDeck();
  return useMemo(() => jobs.find((job) => job.id === jobId), [jobs, jobId]);
}

/** Every posting from one company, newest first — the openings list on its profile page. */
export function useCompanyJobs(companyId: string | undefined): Job[] {
  const { jobs } = useCareerDeck();
  return useMemo(
    () => (companyId ? jobs.filter((job) => job.companyId === companyId).sort(byNewest) : []),
    [jobs, companyId],
  );
}

export type JobSort = 'recent' | 'salary' | 'company';

/** Hours-per-year used to put an hourly rate on the same scale as a salary when sorting. */
const FULL_TIME_HOURS = 2080;

/**
 * A single comparable number for a posting's pay. Hourly roles are annualized so an
 * internship at $52/hr sorts against a new-grad salary rather than below every one of
 * them, and postings with no salary listed sort last instead of reading as $0.
 */
function payFloor(job: Job): number {
  const top = job.salaryMax ?? job.salaryMin;
  if (top === null) return -1;
  return job.salaryPeriod === 'hour' ? top * FULL_TIME_HOURS : top;
}

/** Sorts a copy — callers hold onto the original feed order. */
export function sortJobs(jobs: Job[], sort: JobSort): Job[] {
  const sorted = [...jobs];

  switch (sort) {
    case 'salary':
      // Newest first within an equal pay band, so the tie-break still surfaces fresh posts.
      return sorted.sort((a, b) => payFloor(b) - payFloor(a) || byNewest(a, b));
    case 'company':
      return sorted.sort((a, b) => a.companyName.localeCompare(b.companyName) || byNewest(a, b));
    case 'recent':
    default:
      return sorted.sort(byNewest);
  }
}

/** The Home feed under the user's chosen ordering. */
export function useSortedJobs(jobs: Job[], sort: JobSort): Job[] {
  return useMemo(() => sortJobs(jobs, sort), [jobs, sort]);
}
