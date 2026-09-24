import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { useCareerDeck } from '@/context/CareerDeckContext';
import { fetchCompany, fetchCompanyDirectory } from '@/lib/api';
import type { Company } from '@/types';

/**
 * The company directory — PHASE1.md §8.7.
 *
 * Three places need to resolve *a* company without knowing in advance which:
 * `useStoryGroups` maps a news item's company to a story ring, `SearchOverlay` colours a
 * result row, and the Following collection lists companies from an in-memory slug set.
 * Threading a fetch through each would mean three loading states for data that is a few
 * hundred small, shared, entirely public rows.
 *
 * So this is one cached query, held for the session. It is the one place in phase 1 where
 * keeping a client-side collection is still the right answer — and the exception proves
 * the rule, because the reason it works is exactly the reason it does not work for jobs:
 * the set is small, bounded, and the same for everyone.
 *
 * Phase 2 kept it for the Following list. `viewer_state()` answers *which* companies are
 * followed, as slugs; this answers *what they are* — name, logo, follower count — which
 * is a read of the same few hundred shared rows every other screen already holds.
 */

export interface CompanyDirectory {
  companies: Company[];
  /** Keyed by slug — what news items, routes and follow sets all use. */
  bySlug: Map<string, Company>;
  /** Keyed by uuid — what a `Job` carries as `companyId`. */
  byId: Map<string, Company>;
  isLoading: boolean;
}

const EMPTY: Company[] = [];

export function useCompanyDirectory(): CompanyDirectory {
  const { followedCompanySlugs } = useCareerDeck();
  const followed = useMemo(() => new Set(followedCompanySlugs), [followedCompanySlugs]);

  const query = useQuery({
    queryKey: ['companies', 'directory'],
    queryFn: () => fetchCompanyDirectory(),
    // Companies change on the timescale of a crawl, not a screen. Re-fetching this on
    // every mount would cost a request per tab switch for data that is effectively static.
    staleTime: 5 * 60 * 1000,
  });

  return useMemo(() => {
    const companies = (query.data ?? EMPTY).map((company) => ({
      ...company,
      isFollowing: followed.has(company.slug),
    }));

    return {
      companies,
      bySlug: new Map(companies.map((company) => [company.slug, company])),
      byId: new Map(companies.map((company) => [company.id, company])),
      isLoading: query.isPending,
    };
  }, [query.data, query.isPending, followed]);
}

/**
 * One company by slug, for its profile page.
 *
 * Falls back to the directory while the request is in flight, so arriving from a search
 * result or a suggestion card renders the header immediately instead of flashing a
 * spinner over data the app already has.
 */
export function useCompany(slug: string | undefined): { company: Company | undefined; isLoading: boolean } {
  const directory = useCompanyDirectory();
  const { followedCompanySlugs } = useCareerDeck();
  const followed = useMemo(() => new Set(followedCompanySlugs), [followedCompanySlugs]);

  const query = useQuery({
    queryKey: ['company', slug],
    queryFn: () => fetchCompany(slug as string),
    enabled: slug !== undefined,
  });

  const company = useMemo(() => {
    const resolved = query.data ?? (slug ? directory.bySlug.get(slug) : undefined);
    if (!resolved) return undefined;
    return { ...resolved, isFollowing: followed.has(resolved.slug) };
  }, [query.data, slug, directory, followed]);

  // Not loading once the directory has answered: there is something real on screen.
  return { company, isLoading: query.isPending && company === undefined };
}
