import { useInfiniteQuery, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useCareerDeck } from '@/context/CareerDeckContext';
import { flushImpressions } from '@/lib/impressions';
import { useCompanyDirectory } from '@/hooks/useCompanies';
import { useSuggestionDismissals } from '@/hooks/useSuggestionDismissals';
import { useSuggestionRotation } from '@/hooks/useSuggestionRotation';
import { isRetired } from '@/lib/suggestionRotation';
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
 * `isLiked` already on it. The server sends the shared entity and the
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
  /**
   * Builds the next session in the background, so the next refresh is a cache swap.
   *
   * A no-op unless the feed was created with `warm`. Safe to call repeatedly — a build
   * already in flight or already finished is not started again.
   */
  warmNext: () => void;
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
function mergeViewer(pages: EnvelopePage[] | undefined, liked: Set<string>): Job[] {
  if (!pages) return [];
  return pages.flatMap((page) =>
    page.items.map(({ job, viewer }) => ({
      ...job,
      isLiked: viewer.liked || liked.has(job.id),
    })),
  );
}

/** The viewer's like set as a `Set`, stable while the underlying array is. */
function useViewerSets() {
  const { likedJobIds } = useCareerDeck();
  return useMemo(() => ({ liked: new Set(likedJobIds) }), [likedJobIds]);
}

/**
 * The pages flattened into what a screen renders, plus the scores that arrived with them.
 *
 * Memoized on the pages: an unmemoized merge handed the Deck's FlatList a new `data` array on
 * every render of the screen, which re-rendered every mounted card.
 */
function useFeedItems(pages: EnvelopePage[] | undefined): FeedItems {
  const { liked } = useViewerSets();
  return useMemo(() => {
    const matches = new Map<string, MatchScore>();
    for (const page of pages ?? []) {
      for (const { job, viewer } of page.items) {
        if (viewer.match) matches.set(job.id, viewer.match);
      }
    }
    return { jobs: mergeViewer(pages, liked), matches };
  }, [pages, liked]);
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
    // Overridden by the feeds that support warming; a plain feed has nothing to warm.
    warmNext: () => {},
    error: query.error,
  };
}

/**
 * The main feed. `sort` is served by the database, not by the client — sorting a page of
 * twenty and calling it a sorted feed would be a lie once there are more than twenty.
 */
export function useJobFeed(
  sort: JobSort = 'recent',
  surface: 'reels' | 'home' = 'reels',
  options: { warm?: boolean } = {},
): JobFeed {
  // The Deck shows a match ring on every card; Home shows none, so it skips the scoring call.
  const withMatch = surface === 'reels';
  const queryClient = useQueryClient();

  // The surface is only in the key for the ranked sort: the explicit sorts are one list
  // wherever they're shown, while each ranked surface pages through its own session.
  // `withMatch` is in it because a scored page and an unscored one are different data.
  const queryKey = useMemo(
    () => ['feed', 'all', sort, sort === 'recommended' ? surface : null, withMatch],
    [sort, surface, withMatch],
  );

  const query = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => fetchFeed({ sort, cursor: pageParam, surface, withMatch }),
    ...pageParams(),
  });

  /*
   * Refresh means "back to the top with a fresh feed", not "fetch everything again".
   *
   * react-query's `refetch` on an infinite query refetches *every page currently loaded*,
   * sequentially — its own loop is `do { fetchPage } while (currentPage < oldPages.length)`.
   * So pulling down after scrolling five pages fired five requests one after another, and
   * the first of them, having a null cursor, rebuilt the whole ranked session at half a
   * second to a second. The indicator stayed up for all of it, and the further the reader
   * had scrolled the longer the wait — which is the shape of the problem reported.
   *
   * Trimming the cache to the first page before refetching makes it one request. Trimming
   * rather than resetting, because `resetQueries` empties the data first and the feed
   * blinks out from under the reader mid-gesture.
   */
  /*
   * Where a pre-built next session waits.
   *
   * Its own key rather than a ref, so it survives a remount of the screen and so
   * react-query dedupes two warm-ups into one request.
   */
  const warmKey = useMemo(() => [...queryKey, 'warm'] as const, [queryKey]);

  /*
   * Build the next session now, so the next pull does not have to.
   *
   * The wait on a refresh is not the network — a page is about 250ms — it is
   * `build_feed_session`, measured between 490ms and 1032ms, which scores the candidate
   * pool and walks it for diversity. That cost cannot be removed, only moved: this pays it
   * while the reader is still reading.
   *
   * Flushes first, which is the part that makes the warmed deck worth having. A session
   * built before the current one's impressions have landed is scored against stale counts
   * and comes back looking much like the deck it is meant to replace.
   */
  const warmNext = useCallback(() => {
    if (!options.warm) return;
    /*
     * Already warm, so there is nothing to do.
     *
     * This is what lets the caller be naive and just say "warm" whenever it feels like it,
     * rather than tracking whether it has. `fetchQuery` would dedupe the request anyway,
     * but the flush in front of it would not — and a flush per scroll event is exactly the
     * kind of quiet waste that is hard to notice later.
     */
    if (queryClient.getQueryData<EnvelopePage>(warmKey)) return;
    void (async () => {
      await flushImpressions();
      await queryClient.fetchQuery({
        queryKey: warmKey,
        queryFn: () => fetchFeed({ sort, cursor: null, surface, withMatch }),
        // The whole point is to keep it until it is used; refetching it would pay the cost
        // again for nothing.
        staleTime: Infinity,
      });
    })();
  }, [options.warm, queryClient, warmKey, sort, surface, withMatch]);

  const refresh = useCallback(async () => {
    const warmed = options.warm ? queryClient.getQueryData<EnvelopePage>(warmKey) : undefined;

    if (warmed && warmed.items.length > 0) {
      // Straight in, with no request at all — the session behind this was built minutes
      // ago while the reader was still scrolling.
      queryClient.setQueryData<InfiniteData<EnvelopePage, string | null>>(queryKey, {
        pages: [warmed],
        pageParams: [null],
      });
      queryClient.removeQueries({ queryKey: warmKey });
      // And start the next one, so the refresh after this is instant too.
      warmNext();
      return;
    }

    /*
     * Nothing warmed — the first refresh of a session, or one that came faster than a
     * build. Trim to the first page before refetching: react-query's `refetch` on an
     * infinite query refetches every page currently loaded, sequentially, so without this
     * a pull after five pages is five requests.
     */
    queryClient.setQueryData<InfiniteData<EnvelopePage, string | null>>(queryKey, (current) =>
      current && current.pages.length > 1
        ? { pages: current.pages.slice(0, 1), pageParams: current.pageParams.slice(0, 1) }
        : current,
    );
    const result = await query.refetch();
    warmNext();
    return result;
  }, [options.warm, queryClient, warmKey, queryKey, query, warmNext]);

  return { ...toFeed(query, useFeedItems(query.data?.pages)), refetch: refresh, warmNext };
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
 *
 * Fifty is the ceiling `suggested_companies()` will serve, and it is asked for all of it
 * because the pool arrives *before* the two client-side exclusions rather than after. The
 * function does not know who is asking, so a reader's follows come out of the fetched
 * list: at thirty, an account following twenty-eight of the big employers had thirteen
 * companies left — three in reserve behind ten on screen, which ran dry after three
 * dismissals and looked like the X doing nothing. At fifty the same account has
 * twenty-eight eligible, which is twenty on screen and eight behind them.
 *
 * The pending personalization migration moves that exclusion into SQL, after which the
 * pool comes back already filtered and this arithmetic stops applying.
 */
const SUGGESTION_POOL = 50;

/** How many of the pool are on screen. The row scrolls, so this is a judgement about how
 *  far anyone wants to scroll sideways, not about what fits. */
const SUGGESTION_SHOWN = 20;

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
  const { shownAt, record: recordShown } = useSuggestionRotation();
  // Already fetched and cached for Home's story rings, so this is a read, not a request.
  const directory = useCompanyDirectory();

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
   * The ranked fifty, then the directory behind them.
   *
   * Fifty is all `suggested_companies()` will serve, and a reader's follows come out of
   * that fifty rather than being excluded by the query — so following the row empties it.
   * Following twenty in one sitting emptied it completely, and the section hid itself,
   * which is the correct response to an empty row and the wrong thing to have happened.
   *
   * The directory is already in the cache — Home loads it for the story rings and the
   * company lookups — and holds two hundred companies in the same order. Appending it
   * costs no request and makes the tail four times deeper, which is the difference between
   * a row that can be exhausted in one sitting and one that cannot.
   *
   * Order matters: the ranked fifty stay in front, so once the personalization migration
   * lands and those fifty are chosen *for* this reader, the directory is only ever the
   * part nobody reaches.
   */
  const pool = useMemo(() => {
    const seen = new Set<string>();
    const out: Company[] = [];

    for (const company of query.data ?? []) {
      if (seen.has(company.slug)) continue;
      seen.add(company.slug);
      out.push(company);
    }
    for (const company of directory.companies) {
      // `suggested_companies()` only offers companies that are hiring, and a suggestion to
      // follow somebody with nothing posted is a worse suggestion.
      if (company.openJobCount <= 0 || seen.has(company.slug)) continue;
      seen.add(company.slug);
      out.push(company);
    }
    return out;
  }, [query.data, directory.companies]);

  /*
   * Both exclusions are applied before the slice, which is what makes the row refill:
   * removing one company promotes the next out of the reserve rather than leaving nine
   * cards.
   *
   * `suggested_companies()` itself has no idea who is asking — it is a plain
   * top-by-openings query over every active company, the same list for everybody — so
   * excluding follows is the client's job for now.
   */
  const eligible = useMemo(
    () =>
      pool
        .filter((company) => !hidden.has(company.slug))
        .filter((company) => !followed.has(company.slug) || justFollowed.includes(company.slug)),
    [pool, followed, hidden, justFollowed],
  );

  /*
   * The turnover, in two passes: who is in the row, and then what order they sit in.
   *
   * Three tiers decide *who*:
   *
   *   0. still inside its term — the row's current members, who keep their slots
   *   1. never shown — fills whatever a dismissal, a follow or a retirement freed, best
   *      suggestion first
   *   2. retired — longest-retired first, so the pool cycles rather than running out
   *
   * Tier 2 existing at all is the point: a hard expiry would drain the pool in a
   * fortnight and then leave the row empty for good.
   *
   * ── Why the order is a separate question ──────────────────────────────────────
   *
   * Sorting by those tiers and rendering the result put an arrival on the *right*, behind
   * everything already there, and it only slid left a frame later once the rotation
   * stamped it. Reordering the tiers instead — new before held — does not work either: on
   * any row with reserve behind it, every never-shown company would outrank every current
   * one and the whole row would turn over at once.
   *
   * So selection stays as it was, and the chosen twenty are then ordered with arrivals
   * leading. A company that just took a freed slot has no stamp yet, which is exactly what
   * identifies it as new. The effect below stamps it with `now` immediately after, making
   * it the newest held company — so it stays leftmost and never visibly moves.
   */
  const companies = useMemo(() => {
    const now = Date.now();
    const tierOf = (slug: string) => {
      const at = shownAt[slug];
      if (at === undefined) return 1;
      return isRetired(at, now) ? 2 : 0;
    };

    const ranked = eligible.map((company, index) => ({
      company,
      index,
      tier: tierOf(company.slug),
    }));

    // Who is in the row.
    const chosen = ranked
      .sort((a, b) => {
        if (a.tier !== b.tier) return a.tier - b.tier;
        // Held: newest first. Retired: longest ago first. Never shown: the server's order.
        if (a.tier === 0) return (shownAt[b.company.slug] ?? 0) - (shownAt[a.company.slug] ?? 0);
        if (a.tier === 2) return (shownAt[a.company.slug] ?? 0) - (shownAt[b.company.slug] ?? 0);
        return a.index - b.index;
      })
      .slice(0, SUGGESTION_SHOWN);

    // What order they appear in.
    return chosen
      .sort((a, b) => {
        const arrivedA = a.tier === 1 ? 0 : 1;
        const arrivedB = b.tier === 1 ? 0 : 1;
        if (arrivedA !== arrivedB) return arrivedA - arrivedB;
        if (a.tier === 1) return a.index - b.index;
        return (shownAt[b.company.slug] ?? 0) - (shownAt[a.company.slug] ?? 0);
      })
      .map(({ company }) => ({ ...company, isFollowing: followed.has(company.slug) }));
  }, [eligible, shownAt, followed]);

  /*
   * Stamp whatever ended up on screen.
   *
   * Keyed on membership rather than order, so the reshuffle this very write causes — a
   * newly stamped company sorts to the left — does not fire it again. Companies already
   * holding a live slot keep their original time, so this cannot push a retirement back.
   */
  const shownSlugs = companies.map((company) => company.slug);
  const membership = useMemo(() => [...shownSlugs].sort().join(','), [shownSlugs]);
  useEffect(() => {
    if (membership.length === 0) return;
    recordShown(membership.split(','));
  }, [membership, recordShown]);

  return {
    companies,
    isLoading: query.isPending,
    dismiss,
    noteFollowed,
    refetch: query.refetch,
  };
}
