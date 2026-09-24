import { useMemo } from 'react';

import { useCareerDeck } from '@/context/CareerDeckContext';
import { useCompanyDirectory } from '@/hooks/useCompanies';
import { useNewsFeed } from '@/hooks/useNewsFeed';
import type { NewsItem, StoryGroup } from '@/types';

/** The one circle that isn't a company — everything tagged `industry` collects here. */
export const INDUSTRY_GROUP_ID = 'industry';
const INDUSTRY_GROUP_NAME = 'Industry Pulse';

/**
 * Collapses the news feed into Instagram-style story rings: one per company, plus a
 * single Industry Pulse circle. Groups keep the relevance order `useNewsFeed()` already
 * establishes (followed companies and industry news first), then unwatched rings float
 * ahead of fully-watched ones so there's always something new at the front of the row.
 */
export function useStoryGroups(): StoryGroup[] {
  const newsFeed = useNewsFeed();
  const { seenNewsIds } = useCareerDeck();
  const directory = useCompanyDirectory();

  return useMemo(() => {
    // News items name a company by slug, which is what the directory is keyed on.
    const companyById = directory.bySlug;
    const seen = new Set(seenNewsIds);

    // Insertion order of `order` is what preserves the feed's own ranking.
    const order: string[] = [];
    const itemsByGroup = new Map<string, NewsItem[]>();

    for (const item of newsFeed) {
      const key = item.category === 'industry' ? INDUSTRY_GROUP_ID : item.companyId ?? INDUSTRY_GROUP_ID;
      const existing = itemsByGroup.get(key);
      if (existing) {
        existing.push(item);
      } else {
        itemsByGroup.set(key, [item]);
        order.push(key);
      }
    }

    const groups = order.map<StoryGroup>((key) => {
      const items = itemsByGroup.get(key) ?? [];
      const isIndustry = key === INDUSTRY_GROUP_ID;
      const company = isIndustry ? undefined : companyById.get(key);

      return {
        id: key,
        name: company?.name ?? INDUSTRY_GROUP_NAME,
        logo: company?.logo ?? '',
        logoColor: company?.logoColor,
        isIndustry,
        items,
        hasUnseen: items.some((item) => !seen.has(item.id)),
      };
    });

    return [...groups.filter((group) => group.hasUnseen), ...groups.filter((group) => !group.hasUnseen)];
  }, [newsFeed, directory, seenNewsIds]);
}

/** Where a ring should open: its first unwatched story, or the start if it's all been seen. */
export function firstUnseenIndex(group: StoryGroup, seenNewsIds: string[]): number {
  const seen = new Set(seenNewsIds);
  const index = group.items.findIndex((item) => !seen.has(item.id));
  return index === -1 ? 0 : index;
}
