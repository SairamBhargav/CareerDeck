import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { useAuth } from '@/context/AuthContext';
import { useCareerDeck } from '@/context/CareerDeckContext';
import { fetchNews } from '@/lib/api';
import type { NewsItem } from '@/types';

function byNewest(a: NewsItem, b: NewsItem): number {
  return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
}

export function newsKey(userId: string | null) {
  return ['news', userId ?? 'anonymous'] as const;
}

/**
 * The stories row's content — `news_feed()` since phase 7, replacing `data/mockNews.ts`.
 *
 * Ordering stays here rather than in SQL because it needs the follow set, which the client already
 * holds: updates from followed companies and industry news first, everything else behind, newest
 * first within each. Stories refresh every half hour at most — the feeds behind them are fetched
 * every three hours, so polling harder would only re-read the same rows.
 */
export function useNewsFeed(): NewsItem[] {
  const { userId } = useAuth();
  const { followedCompanySlugs } = useCareerDeck();

  const query = useQuery({
    queryKey: newsKey(userId),
    queryFn: fetchNews,
    enabled: userId !== null,
    staleTime: 30 * 60_000,
  });

  return useMemo(() => {
    const items = query.data ?? [];
    const followed = new Set(followedCompanySlugs);
    const isRelevant = (item: NewsItem) =>
      item.category === 'industry' || (item.companyId !== undefined && followed.has(item.companyId));

    const relevant = items.filter(isRelevant).sort(byNewest);
    const other = items.filter((item) => !isRelevant(item)).sort(byNewest);
    return [...relevant, ...other];
  }, [query.data, followedCompanySlugs]);
}
