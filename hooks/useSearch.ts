import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

import { useCareerDeck } from '@/context/CareerDeckContext';
import { searchCompanies, searchJobs } from '@/lib/api';
import type { Company, Job } from '@/types';

/**
 * Search — Appendix A's second named exception, and §1.2's "moves to server".
 *
 * The old implementation scanned every job and company array on every keystroke. That was
 * correct at thirty fixtures and is not a thing you can do to a corpus of hundreds of
 * thousands of postings on a phone. Ranking now happens in Postgres —
 * `search_jobs()` / `search_companies()` in the phase 1 migration — and this hook is a
 * debounced query in front of it.
 *
 * What is preserved, deliberately, is the *behaviour* the overlay depends on:
 * `MIN_QUERY_LENGTH`, the `isActive` flag that decides between results and recents, and
 * the rule that a prefix match on a title beats a match buried in a skills list. The last
 * one now lives in SQL (short queries take a prefix path) rather than in `scoreFields`.
 */

export type SearchScope = 'jobs' | 'companies';

/** Below this a query matches too much to be worth ranking — the overlay shows recents instead. */
export const MIN_QUERY_LENGTH = 2;

/**
 * §11: "Debounce 250ms client-side."
 *
 * Long enough that typing a word is one request rather than seven, short enough that it
 * still feels like it is keeping up.
 */
const DEBOUNCE_MS = 250;

interface SearchResults {
  jobs: Job[];
  companies: Company[];
  /** True once the query is long enough that the lists above mean anything. */
  isActive: boolean;
  /** True while the first results for a *new* query are in flight. */
  isLoading: boolean;
  error: Error | null;
}

/** Holds `value` steady until it has stopped changing for `delayMs`. */
function useDebounced<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return settled;
}

export function useSearch(query: string): SearchResults {
  const { savedJobIds, likedJobIds, followedCompanySlugs } = useCareerDeck();

  const normalized = query.trim();
  const debounced = useDebounced(normalized, DEBOUNCE_MS);

  // The *current* input decides whether the overlay is in results mode, not the debounced
  // one — otherwise clearing the box leaves stale results on screen for a quarter second.
  const isActive = normalized.length >= MIN_QUERY_LENGTH;
  const enabled = debounced.length >= MIN_QUERY_LENGTH;

  const jobsQuery = useQuery({
    queryKey: ['search', 'jobs', debounced],
    queryFn: () => searchJobs(debounced),
    enabled,
    // Without this the list blanks between every keystroke's two requests, which reads as
    // the app losing the results rather than refining them.
    placeholderData: keepPreviousData,
  });

  const companiesQuery = useQuery({
    queryKey: ['search', 'companies', debounced],
    queryFn: () => searchCompanies(debounced),
    enabled,
    placeholderData: keepPreviousData,
  });

  const viewer = useMemo(
    () => ({
      saved: new Set(savedJobIds),
      liked: new Set(likedJobIds),
      followed: new Set(followedCompanySlugs),
    }),
    [savedJobIds, likedJobIds, followedCompanySlugs],
  );

  return useMemo(() => {
    if (!isActive) {
      return { jobs: [], companies: [], isActive: false, isLoading: false, error: null };
    }

    return {
      jobs: (jobsQuery.data?.items ?? []).map(({ job, viewer: state }) => ({
        ...job,
        isSaved: state.saved || viewer.saved.has(job.id),
        isLiked: state.liked || viewer.liked.has(job.id),
      })),
      companies: (companiesQuery.data ?? []).map((company) => ({
        ...company,
        isFollowing: viewer.followed.has(company.slug),
      })),
      isActive: true,
      // `isPending` rather than `isFetching`: with keepPreviousData a refinement is a
      // fetch, and showing a spinner over results that are already on screen is worse
      // than showing them a moment stale.
      isLoading: jobsQuery.isPending || companiesQuery.isPending,
      error: jobsQuery.error ?? companiesQuery.error,
    };
  }, [isActive, jobsQuery.data, jobsQuery.isPending, jobsQuery.error, companiesQuery.data, companiesQuery.isPending, companiesQuery.error, viewer]);
}
