import type { NewsItem } from './news';

/**
 * One ring in Home's stories row: every news item from a single company, or all
 * industry news collected under one "Industry Pulse" circle. Derived from the news
 * feed by `useStoryGroups()` — nothing declares these directly.
 */
export interface StoryGroup {
  /** The company's id, or `industry` for the non-company circle. */
  id: string;
  name: string;
  /** Company logo URL or monogram; empty for the industry circle, which uses an icon. */
  logo: string;
  logoColor?: string;
  isIndustry: boolean;
  /** Newest first, the same order the news carousel uses. */
  items: NewsItem[];
  /** False once every item in the group has been viewed — the ring goes quiet. */
  hasUnseen: boolean;
}
