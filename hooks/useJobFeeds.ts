import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { useCareerDeck } from '@/context/CareerDeckContext';
import {
  fetchCompanyJobs,
  fetchFeed,
  fetchJob,
  fetchJobsByIds,
  fetchSuggestedCompanies,
  type FeedSort,
  type JobEnvelope,
  type Page,
} from '@/lib/api';
import type { Company, Job } from '@/types';

/**
 * The feeds, paginated — Appendix A's first named exception to "only `CareerDeckContext`
 * changes".
 *
 * `forYouJobs: Job[]` is gone. The corpus is a few hundred thousand rows and the client
 * holds one page of it at a time, so every feed here is an infinite query over
 * `lib/api.ts`.
 *
 * The one thing that has *not* changed is what a component receives: a `Job` with
 * `isSaved` and `isLiked` already on it. The server sends the shared entity and a
 * `viewer` object (§1.3a); the merge below folds them together, exactly as
 * `CareerDeckContext` used to in its `useMemo`. When phase 2 starts filling `viewer`
 * server-side, this merge is deleted and no card notices.
 */

export type ReelFeed = 'following' | 'forYou';
export type JobSort = FeedSort;

/** Everything a screen needs to render a paginated feed. */
export interface JobFeed {
  jobs: Job[];
  isLoading: boolean;
  isFetchingNextPage: boolean;
  hasNextPage: boolean;
  fetchNextPage: () => void;
  refetch: () => void;
  error: Error | null;
}

type EnvelopePage = Page<JobEnvelope>;

function pageParams() {
  return {
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage: EnvelopePage) => lastPage.nextCursor,
  };
}

/**
 * Folds the viewer's own state onto the shared entity.
 *
 * `saved` and `liked` come from the client's in-memory sets in phase 1 and from the
 * server's `viewer` object in phase 2 — `viewer.saved || savedIds.has(id)` reads correctly
 * in both worlds, which is what makes the changeover a deletion rather than a rewrite.
 */
function mergeViewer(pages: EnvelopePage[] | undefined, saved: Set<string>, liked: Set<string>): Job[] {
  if (!pages) return [];
  return pages.flatMap((page) =>
    page.items.map(({ job, viewer }) => ({
      ...job,
      isSaved: viewer.saved || saved.has(job.id),
      isLiked: viewer.liked || liked.has(job.id),
    })),
  );
}

/** The viewer's like and save sets as `Set`s, stable while the underlying arrays are. */
function useViewerSets() {
  const { savedJobIds, likedJobIds } = useCareerDeck();
  return useMemo(
    () => ({ saved: new Set(savedJobIds), liked: new Set(likedJobIds) }),
    [savedJobIds, likedJobIds],
  );
}

function toFeed(
  query: {
    data?: { pages: EnvelopePage[] };
    isPending: boolean;
    isFetchingNextPage: boolean;
    hasNextPage: boolean;
    fetchNextPage: () => unknown;
    refetch: () => unknown;
    error: Error | null;
  },
  jobs: Job[],
): JobFeed {
  return {
    jobs,
    isLoading: query.isPending,
    isFetchingNextPage: query.isFetchingNextPage,
    hasNextPage: query.hasNextPage,
    // Wrapped so callers can pass them straight to `onEndReached` without React Native
    // handing the event object in as an argument.
    fetchNextPage: () => void query.fetchNextPage(),
    refetch: () => void query.refetch(),
    error: query.error,
  };
}

/**
 * The main feed. `sort` is served by the database, not by the client — sorting a page of
 * twenty and calling it a sorted feed would be a lie once there are more than twenty.
 */
export function useJobFeed(sort: JobSort = 'recent'): JobFeed {
  const sets = useViewerSets();

  const query = useInfiniteQuery({
    queryKey: ['feed', 'all', sort],
    queryFn: ({ pageParam }) => fetchFeed({ sort, cursor: pageParam }),
    ...pageParams(),
  });

  return toFeed(query, mergeViewer(query.data?.pages, sets.saved, sets.liked));
}

/**
 * Postings from the companies the viewer follows.
 *
 * The slugs are sent as a filter because `company_follows` does not exist until phase 2 —
 * PHASE1.md §7.3. When it does, this hook drops the argument and the server reads the
 * join; the query key already includes the slugs so the cache is correct either way.
 */
export function useFollowingFeed(): JobFeed {
  const { followedCompanySlugs } = useCareerDeck();
  const sets = useViewerSets();

  // Sorted so that following A then B and following B then A share one cache entry.
  const slugs = useMemo(() => [...followedCompanySlugs].sort(), [followedCompanySlugs]);

  const query = useInfiniteQuery({
    queryKey: ['feed', 'following', slugs],
    queryFn: ({ pageParam }) => fetchFeed({ companySlugs: slugs, cursor: pageParam }),
    ...pageParams(),
    // Following nobody is not a query worth making: the answer is knowable here.
    enabled: slugs.length > 0,
  });

  const feed = toFeed(query, mergeViewer(query.data?.pages, sets.saved, sets.liked));
  return slugs.length === 0 ? { ...feed, isLoading: false, hasNextPage: false } : feed;
}

/** One company's openings — the list on its profile page. */
export function useCompanyJobs(slug: string | undefined): JobFeed {
  const sets = useViewerSets();

  const query = useInfiniteQuery({
    queryKey: ['feed', 'company', slug],
    queryFn: ({ pageParam }) => fetchCompanyJobs(slug as string, pageParam),
    ...pageParams(),
    enabled: slug !== undefined,
  });

  return toFeed(query, mergeViewer(query.data?.pages, sets.saved, sets.liked));
}

/**
 * One posting, by id.
 *
 * Opening a job that is already on screen must not show a spinner, so the feed caches are
 * searched for it first and used as `initialData`. The query still runs — a detail view is
 * where a stale salary or a closed posting matters most — but it revalidates behind
 * content rather than in front of a skeleton.
 */
export function useJobById(jobId: string | undefined): { job: Job | undefined; isLoading: boolean } {
  const sets = useViewerSets();

  const query = useQuery({
    queryKey: ['job', jobId],
    queryFn: () => fetchJob(jobId as string),
    enabled: jobId !== undefined,
  });

  const job = useMemo(() => {
    const envelope = query.data;
    if (!envelope) return undefined;
    return {
      ...envelope.job,
      isSaved: envelope.viewer.saved || sets.saved.has(envelope.job.id),
      isLiked: envelope.viewer.liked || sets.liked.has(envelope.job.id),
    };
  }, [query.data, sets]);

  return { job, isLoading: query.isPending && jobId !== undefined };
}

/**
 * Resolves a set of ids the screen holds but has no page for — the Saved and Liked
 * collections, whose ids live in memory rather than in any feed the app has loaded.
 */
export function useJobsByIds(ids: string[]): { jobs: Job[]; isLoading: boolean } {
  const sets = useViewerSets();
  // Sorted and joined so that the same set of ids in a different order is one cache entry.
  const key = useMemo(() => [...ids].sort(), [ids]);

  const query = useQuery({
    queryKey: ['jobs', 'byIds', key],
    queryFn: () => fetchJobsByIds(key),
    enabled: key.length > 0,
  });

  const jobs = useMemo(
    () =>
      (query.data ?? []).map(({ job, viewer }) => ({
        ...job,
        isSaved: viewer.saved || sets.saved.has(job.id),
        isLiked: viewer.liked || sets.liked.has(job.id),
      })),
    [query.data, sets],
  );

  return { jobs, isLoading: query.isPending && key.length > 0 };
}

/**
 * The "Suggested for you" rail. Replaces the hardcoded `suggestedCompanyIds` array with
 * companies that are actually hiring — see `suggested_companies()` in the migration.
 */
export function useSuggestedCompanies(): { companies: Company[]; isLoading: boolean } {
  const { followedCompanySlugs } = useCareerDeck();
  const followed = useMemo(() => new Set(followedCompanySlugs), [followedCompanySlugs]);

  const query = useQuery({
    queryKey: ['companies', 'suggested'],
    queryFn: () => fetchSuggestedCompanies(),
  });

  const companies = useMemo(
    () => (query.data ?? []).map((company) => ({ ...company, isFollowing: followed.has(company.slug) })),
    [query.data, followed],
  );

  return { companies, isLoading: query.isPending };
}
