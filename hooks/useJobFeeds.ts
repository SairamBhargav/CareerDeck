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
  /** Shorter slice used by the Home "Your Feed" list. */
  homeJobs: Job[];
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
      homeJobs: forYouJobs,
      suggestedCompanies,
    };
  }, [jobs, companies, followedCompanyIds]);
}

export function useJobById(jobId: string | undefined): Job | undefined {
  const { jobs } = useCareerDeck();
  return useMemo(() => jobs.find((job) => job.id === jobId), [jobs, jobId]);
}
