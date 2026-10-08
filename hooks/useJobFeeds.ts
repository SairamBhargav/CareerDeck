import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';

import { useCareerDeck } from '@/context/CareerDeckContext';
import { useSuggestionDismissals } from '@/hooks/useSuggestionDismissals';
import {
  fetchCompanyJobs,
  fetchDeckProfile,
  fetchFeed,
  type DeckProfile,
  fetchJob,
  fetchJobsByIds,
  fetchSuggestedCompanies,
  type FeedSort,
  type JobEnvelope,
  type Page,
} from '@/lib/api';
import type { Company, Job, MatchScore } from '@/types';

/**
 * The feeds, paginated — Appendix A's first named exception to "only `CareerDeckContext`
 * changes".
 *
 * `forYouJobs: Job[]` is gone. The corpus is a few hundred thousand rows and the client
 * holds one page of it at a time, so every feed here is an infinite query over
 * `lib/api.ts`.
 *
 * The one thing that has *not* changed is what a component receives: a `Job` with
 * `isSaved` and `isLiked` already on it. The server sends the shared entity and the
 * viewer's relationship to it arrives separately (§1.3a); the merge below folds them
 * together, exactly as `CareerDeckContext` used to in its `useMemo`.
 *
 * Phase 1 expected phase 2 to fill `viewer` per row and delete this merge. It did the
 * opposite — PHASE2.md §3 — because per-row viewer flags are what make a feed page
 * uncacheable, which is the problem §1.3(a) was written about. So the merge stays and its
 * *source* changed: `useViewerState` reads `job_interactions` and `company_follows`
 * instead of the context's in-memory sets.
 */

export type ReelFeed = 'following' | 'forYou';
export type JobSort = FeedSort;

/** Everything a screen needs to render a paginated feed. */
export interface JobFeed {
  jobs: Job[];
  /**
   * Each loaded posting's match score, keyed by job id. Empty unless the feed was fetched with
   * `withMatch`, and missing a posting the scorer had nothing to say about.
   */
  matches: ReadonlyMap<string, MatchScore>;
  isLoading: boolean;
  isFetchingNextPage: boolean;
  hasNextPage: boolean;
  fetchNextPage: () => void;
  /** Awaitable, so a pull-to-refresh can keep its spinner up until the page arrives. */
  refetch: () => Promise<unknown>;
  error: Error | null;
}

type EnvelopePage = Page<JobEnvelope>;

interface FeedItems {
  jobs: Job[];
  matches: ReadonlyMap<string, MatchScore>;
}

function pageParams() {
  return {
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage: EnvelopePage) => lastPage.nextCursor,
  };
}

/**
 * Folds the viewer's own state onto the shared entity.
 *
 * `viewer` is still the envelope's default half — nothing fills it per row — and the sets
 * carry the answer. `viewer.saved || saved.has(id)` is written to read correctly either
 * way, so the day a page does arrive pre-decorated this line is already right.
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

/**
 * The pages flattened into what a screen renders, plus the scores that arrived with them.
 *
 * Memoized on the pages: an unmemoized merge handed the Deck's FlatList a new `data` array on
 * every render of the screen, which re-rendered every mounted card.
 */
function useFeedItems(pages: EnvelopePage[] | undefined): FeedItems {
  const { saved, liked } = useViewerSets();
  return useMemo(() => {
    const matches = new Map<string, MatchScore>();
    for (const page of pages ?? []) {
      for (const { job, viewer } of page.items) {
        if (viewer.match) matches.set(job.id, viewer.match);
      }
    }
    return { jobs: mergeViewer(pages, saved, liked), matches };
  }, [pages, saved, liked]);
}

function toFeed(
  query: {
    data?: { pages: EnvelopePage[] };
    isPending: boolean;
    isFetchingNextPage: boolean;
    hasNextPage: boolean;
    fetchNextPage: () => unknown;
    refetch: () => Promise<unknown>;
    error: Error | null;
  },
  { jobs, matches }: FeedItems,
): JobFeed {
  return {
    jobs,
    matches,
    isLoading: query.isPending,
    isFetchingNextPage: query.isFetchingNextPage,
    hasNextPage: query.hasNextPage,
    // Wrapped so callers can pass them straight to `onEndReached` without React Native
    // handing the event object in as an argument.
    fetchNextPage: () => void query.fetchNextPage(),
    refetch: () => query.refetch(),
    error: query.error,
  };
}

/**
 * The main feed. `sort` is served by the database, not by the client — sorting a page of
 * twenty and calling it a sorted feed would be a lie once there are more than twenty.
 */
export function useJobFeed(sort: JobSort = 'recent', surface: 'reels' | 'home' = 'reels'): JobFeed {
  // The Deck shows a match ring on every card; Home shows none, so it skips the scoring call.
  const withMatch = surface === 'reels';

  const query = useInfiniteQuery({
    // The surface is only in the key for the ranked sort: the explicit sorts are one list
    // wherever they're shown, while each ranked surface pages through its own session.
    // `withMatch` is in it because a scored page and an unscored one are different data.
    queryKey: ['feed', 'all', sort, sort === 'recommended' ? surface : null, withMatch],
    queryFn: ({ pageParam }) => fetchFeed({ sort, cursor: pageParam, surface, withMatch }),
    ...pageParams(),
  });

  return toFeed(query, useFeedItems(query.data?.pages));
}

/**
 * Postings from the companies the viewer follows.
 *
 * The slugs come from `company_follows` now, by way of `viewer_state()`, but they are
 * still sent as a filter rather than read as a join on the server — PHASE2.md §9.2. The
 * query key includes them, so following a company invalidates exactly this feed and
 * nothing else.
 */
export function useFollowingFeed(): JobFeed {
  const { followedCompanySlugs } = useCareerDeck();

  // Sorted so that following A then B and following B then A share one cache entry.
  const slugs = useMemo(() => [...followedCompanySlugs].sort(), [followedCompanySlugs]);

  const query = useInfiniteQuery({
    queryKey: ['feed', 'following', slugs],
    // Only the Deck reads this feed, so its pages are always scored.
    queryFn: ({ pageParam }) => fetchFeed({ companySlugs: slugs, cursor: pageParam, withMatch: true }),
    ...pageParams(),
    // Following nobody is not a query worth making: the answer is knowable here.
    enabled: slugs.length > 0,
  });

  const feed = toFeed(query, useFeedItems(query.data?.pages));
  return slugs.length === 0 ? { ...feed, isLoading: false, hasNextPage: false } : feed;
}

/** One company's openings — the list on its profile page. */
export function useCompanyJobs(slug: string | undefined): JobFeed {
  const query = useInfiniteQuery({
    queryKey: ['feed', 'company', slug],
    queryFn: ({ pageParam }) => fetchCompanyJobs(slug as string, pageParam),
    ...pageParams(),
    enabled: slug !== undefined,
  });

  return toFeed(query, useFeedItems(query.data?.pages));
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
 * What the Relevant feed is personalized on. Refetched when the screen regains focus is not
 * needed: a new major or resume invalidates `['deckProfile']` where it is saved.
 */
export function useDeckProfile(): { profile: DeckProfile | undefined; isLoading: boolean } {
  const query = useQuery({ queryKey: ['deckProfile'], queryFn: fetchDeckProfile, staleTime: 60_000 });
  return { profile: query.data, isLoading: query.isPending };
}

/**
 * The "Suggested for you" rail. Replaces the hardcoded `suggestedCompanyIds` array with
 * companies that are actually hiring — see `suggested_companies()` in the migration.
 */
/**
 * Fetched, against {@link SUGGESTION_SHOWN} rendered.
 *
 * The surplus is the reserve: dismissing a card has to put a different company in its
 * place, and a round trip to find one would leave a hole in the row for as long as it took.
 * `suggested_companies()` caps `p_limit` at 50, so this is well inside what it will serve.
 */
const SUGGESTION_POOL = 30;

/** How many of the pool are on screen. The row scrolls, so this is a judgement about how
 *  far anyone wants to scroll sideways, not about what fits. */
const SUGGESTION_SHOWN = 10;

export function useSuggestedCompanies(): {
  companies: Company[];
  isLoading: boolean;
  dismiss: (companySlug: string) => void;
  noteFollowed: (companySlug: string) => void;
  refetch: () => Promise<unknown>;
} {
  const { followedCompanySlugs } = useCareerDeck();
  const followed = useMemo(() => new Set(followedCompanySlugs), [followedCompanySlugs]);
  const { dismissed, dismiss } = useSuggestionDismissals();
  const hidden = useMemo(() => new Set(dismissed), [dismissed]);

  /*
   * Companies followed from the row since the last time Home was focused.
   *
   * A suggestion you have accepted is not a suggestion any more, so a followed company has
   * no business in this row. But removing it on the tap would take the card away before the
   * reader saw the tap land, and leave them unsure whether it worked. So the card stays and
   * flips to Following, and the follow settles the next time the screen is focused: look
   * away, come back, it is gone and something else is in its place.
   *
   * Held as "recently followed" rather than "already followed as of some moment" on purpose.
   * The latter needs a snapshot taken once follows have loaded, which is a render or two
   * after mount — and anything followed before that would flash into the row on launch.
   * This way the default excludes every follow, and only the deliberate exceptions are kept.
   */
  const [justFollowed, setJustFollowed] = useState<string[]>([]);
  useFocusEffect(useCallback(() => setJustFollowed([]), []));

  const noteFollowed = useCallback((companySlug: string) => {
    setJustFollowed((current) =>
      current.includes(companySlug) ? current : [companySlug, ...current],
    );
  }, []);

  const query = useQuery({
    queryKey: ['companies', 'suggested'],
    queryFn: () => fetchSuggestedCompanies(SUGGESTION_POOL),
  });

  /*
   * Both exclusions are applied before the slice, which is what makes the row refill:
   * removing one company promotes the next out of the reserve rather than leaving nine
   * cards.
   *
   * `suggested_companies()` itself has no idea who is asking — it is a plain
   * top-by-openings query over every active company, the same list for everybody — so
   * excluding follows is the client's job for now.
   */
  const companies = useMemo(
    () =>
      (query.data ?? [])
        .filter((company) => !hidden.has(company.slug))
        .filter((company) => !followed.has(company.slug) || justFollowed.includes(company.slug))
        .slice(0, SUGGESTION_SHOWN)
        .map((company) => ({ ...company, isFollowing: followed.has(company.slug) })),
    [query.data, followed, hidden, justFollowed],
  );

  return {
    companies,
    isLoading: query.isPending,
    dismiss,
    noteFollowed,
    refetch: query.refetch,
  };
}
