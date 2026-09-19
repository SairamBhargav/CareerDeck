import { useMemo } from 'react';

import { useCareerDeck } from '@/context/CareerDeckContext';
import type { Company, Job } from '@/types';

export type SearchScope = 'jobs' | 'companies';

/** Below this a query matches too much to be worth ranking — the overlay shows recents instead. */
export const MIN_QUERY_LENGTH = 2;

interface SearchResults {
  jobs: Job[];
  companies: Company[];
  /** True once the query is long enough that the lists above mean anything. */
  isActive: boolean;
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Ranks a hit by *where* the query landed rather than just whether it did: a prefix
 * match on the main title beats a match buried in a skills list, so typing "de" puts
 * "Design Engineer" above a backend role that merely lists "dev tools".
 */
function scoreFields(query: string, primary: string, secondary: string[]): number {
  const target = normalize(primary);
  if (target.startsWith(query)) return 0;
  if (target.includes(query)) return 1;
  return secondary.some((field) => normalize(field).includes(query)) ? 2 : -1;
}

/**
 * Local, in-memory search over the mock job and company fixtures. There's no backend
 * yet, so this runs synchronously against the full arrays on every keystroke — fine at
 * fixture size, and the seam to replace with a debounced request later is this hook.
 */
export function useSearch(query: string): SearchResults {
  const { jobs, companies } = useCareerDeck();

  return useMemo(() => {
    const normalized = normalize(query);
    if (normalized.length < MIN_QUERY_LENGTH) {
      return { jobs: [], companies: [], isActive: false };
    }

    const rank = <T,>(items: T[], score: (item: T) => number): T[] =>
      items
        .map((item) => ({ item, score: score(item) }))
        .filter((entry) => entry.score >= 0)
        .sort((a, b) => a.score - b.score)
        .map((entry) => entry.item);

    return {
      jobs: rank(jobs, (job) =>
        scoreFields(normalized, job.title, [job.companyName, job.location, ...job.skills]),
      ),
      companies: rank(companies, (company) => scoreFields(normalized, company.name, [company.industry])),
      isActive: true,
    };
  }, [query, jobs, companies]);
}
