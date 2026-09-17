export type NewsCategory = 'company' | 'industry';

export interface NewsItem {
  id: string;
  category: NewsCategory;
  /** Present for `company` items; used to look up follow state and brand color. */
  companyId?: string;
  companyName?: string;
  companyLogo?: string;
  /** Soft tinted card background, e.g. "#EAF3E4". Kept per-item so industry cards can differ from brand cards. */
  accentColor: string;
  /** Small label above the headline, e.g. "NVIDIA · Hiring" or "Industry Pulse". */
  tag: string;
  headline: string;
  subtext: string;
  /** ISO date string. */
  publishedAt: string;
}
