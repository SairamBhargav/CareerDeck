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
  const { followedCompanyIds } = useCareerDeck();

  return useMemo(() => {
    const followed = new Set(followedCompanyIds);
    const isRelevant = (item: NewsItem) =>
      item.category === 'industry' || (item.companyId !== undefined && followed.has(item.companyId));

    const relevant = mockNews.filter(isRelevant).sort(byNewest);
    const other = mockNews.filter((item) => !isRelevant(item)).sort(byNewest);

    return [...relevant, ...other];
  }, [followedCompanyIds]);
}
