export type NewsCategory = 'company' | 'industry';

export type NewsTopic = 'hiring' | 'layoffs' | 'funding' | 'product' | 'engineering' | 'other';

/**
 * One story in the Home stories row — README §3.11, from `news_feed()`.
 *
 * Phase 7 replaced `body: string[]` (full article paragraphs, fine for fixtures we wrote) with
 * `summary` and `url`. §9: redisplaying a publisher's article is infringement; a headline, the
 * publisher's name, our own two or three sentences and a link out are not. There is deliberately
 * no field that could hold article text.
 */
export interface NewsItem {
  id: string;
  category: NewsCategory;
  /** The company's **slug**, for `company` items — follows and the directory key on it. */
  companyId?: string;
  companyName?: string;
  /** Soft tinted card background, e.g. "#EAF3E4". */
  accentColor: string;
  /** Small label above the headline, e.g. "Stripe · Hiring" or "Industry Pulse · Layoffs". */
  tag: string;
  /** The publisher's headline, verbatim and attributed. */
  headline: string;
  subtext: string;
  /** CareerDeck's own summary: at most three sentences, never the article. */
  summary: string[];
  topic: NewsTopic;
  /** Where "Read at …" goes. */
  url: string;
  /** Always shown — attribution is mandatory (§9). */
  publisher: string;
  /** ISO timestamp. */
  publishedAt: string;
  /** Whether this reader has watched it, from `news_seen`. */
  seen: boolean;
}
