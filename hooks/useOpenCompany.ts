import { useQueryClient } from '@tanstack/react-query';

import { useCallback } from 'react';

import { fetchCompany, fetchCompanyJobs } from '@/lib/api';
import { useGuardedRouter } from '@/hooks/useGuardedRouter';

/**
 * Open a company's page, with its data already on the way.
 *
 * ── Why this is not just `router.push` ────────────────────────────────────────
 *
 * The company screen mounts two queries and shows an ActivityIndicator until the first
 * answers. For most companies that is unavoidable today: `useCompany` falls back to the
 * directory, but the directory holds only the top two hundred by openings, so 1,195 of
 * 1,395 active companies have no local copy at all. Tapping one of those meant a push, a
 * spinner, a round trip, and only then the page — and the openings list arriving after
 * that again.
 *
 * None of those requests are slow. Measured warm: the company row is about 95ms and its
 * first page of jobs about 190ms. The problem is purely that they started after the
 * navigation instead of alongside it.
 *
 * So both are warmed here, before the push. The screen's own `useQuery` calls then find
 * the cache populated, or a request already in flight that they join rather than
 * duplicate. The push animation and the fetch overlap, which is enough to cover both on
 * any reasonable connection.
 *
 * Deliberately not awaited. A tap must navigate immediately whatever the network is
 * doing; this makes the common case arrive full rather than making the slow case wait.
 * `prefetchQuery` swallows its own errors, so a failed warm-up is silent and the screen
 * simply fetches normally.
 */
export function useOpenCompany() {
  const router = useGuardedRouter();
  const queryClient = useQueryClient();

  return useCallback(
    (companySlug: string) => {
      // The keys have to match the screen's own exactly, or this fetches a second copy
      // into a cache entry nothing reads. See useCompanies.ts and useJobFeeds.ts.
      void queryClient.prefetchQuery({
        queryKey: ['company', companySlug],
        queryFn: () => fetchCompany(companySlug),
      });

      void queryClient.prefetchInfiniteQuery({
        queryKey: ['feed', 'company', companySlug],
        queryFn: ({ pageParam }) => fetchCompanyJobs(companySlug, pageParam as string | null),
        initialPageParam: null as string | null,
      });

      router.push({ pathname: '/company/[id]', params: { id: companySlug } });
    },
    [router, queryClient],
  );
}
