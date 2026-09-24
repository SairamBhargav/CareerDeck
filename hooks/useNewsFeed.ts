import { useMemo } from 'react';

import { useCareerDeck } from '@/context/CareerDeckContext';
import { mockNews } from '@/data/mockNews';
import type { NewsItem } from '@/types';

function byNewest(a: NewsItem, b: NewsItem): number {
  return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
}

/**
 * Orders the news carousel so it reads like a feed curated for this user:
 * updates from companies they follow and general industry news float to the front,
 * news from companies they don't follow yet trails behind. Newest first within each group.
 */
export function useNewsFeed(): NewsItem[] {
  // Follows are keyed by company slug in phase 1, and a news item names its company
  // the same way — so the two line up without a lookup. See CareerDeckContext.
  const { followedCompanySlugs } = useCareerDeck();

  return useMemo(() => {
    const followed = new Set(followedCompanySlugs);
    const isRelevant = (item: NewsItem) =>
      item.category === 'industry' || (item.companyId !== undefined && followed.has(item.companyId));

    const relevant = mockNews.filter(isRelevant).sort(byNewest);
    const other = mockNews.filter((item) => !isRelevant(item)).sort(byNewest);

    return [...relevant, ...other];
  }, [followedCompanySlugs]);
}
