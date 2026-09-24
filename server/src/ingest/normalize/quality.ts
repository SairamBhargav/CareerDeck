/**
 * Quality scoring — docs/README.md §3.4.
 *
 * "`quality_score` is set at ingest and is the junk filter. Staffing-agency spam, postings
 * with a 40-word description, 'Work From Home $$$' — score them low once at write time
 * rather than filtering them on every feed read."
 *
 * The write-time framing is the point. A feed that evaluates junk heuristics per read
 * pays for them on every scroll of every user forever; a column pays once per posting.
 *
 * §5.1's candidate filter is `quality_score > 0.3`, and phase 1's feed uses the same
 * threshold so the number is exercised and tuned before ranking depends on it.
 */

import type { SeniorityLevel } from './seniority.ts';

export interface QualityInput {
  title: string;
  descriptionText: string;
  requirements: string[];
  skills: string[];
  hasStructuredSalary: boolean;
  /** Open postings this company already has. A real board scores better than a one-off. */
  companyOpenPostings: number;
  seniority: SeniorityLevel | null;
  hasCompanyDomain: boolean;
}

/** Staffing-agency and reseller markers. These are near-perfectly precise in this corpus. */
const AGENCY =
  /\b(c2c|corp[- ]to[- ]corp|w2 only|w-2 only|third party|no c2c|1099 only|multiple positions|urgent(ly)? (hiring|required)|immediate joiner|walk[- ]in|apply now!!|hot requirement|rate:\s*\$?\d)\b/i;

const SHOUTY_PUNCTUATION = /[!$*]/g;

/**
 * Deliberately a short additive table rather than a model.
 *
 * Every term is independently explainable, which matters when a company asks why their
 * posting is not showing: "your description is 90 characters long" is an answer; "the
 * model scored it 0.21" is not.
 */
export function scoreQuality(input: QualityInput): number {
  let score = 0.5;

  const length = input.descriptionText.length;
  if (length < 400) score -= 0.25;
  if (length < 150) score -= 0.2;

  if (AGENCY.test(input.title) || AGENCY.test(input.descriptionText.slice(0, 600))) score -= 0.3;

  const letters = input.title.replace(/[^a-zA-Z]/g, '');
  const isShouting = letters.length >= 8 && letters === letters.toUpperCase();
  const punctuation = (input.title.match(SHOUTY_PUNCTUATION) ?? []).length;
  if (isShouting || punctuation >= 3) score -= 0.2;

  // "Work from home" is a legitimate arrangement; "work from home" from an employer with
  // no verifiable domain is the oldest posting scam there is.
  if (/\bwork from home\b/i.test(input.title) && !input.hasCompanyDomain) score -= 0.25;

  if (input.hasStructuredSalary) score += 0.1;
  if (input.skills.length >= 3) score += 0.1;
  if (input.requirements.length > 0) score += 0.05;
  if (input.companyOpenPostings >= 3) score += 0.1;

  /*
   * Seniority is NOT scored down. A Staff Engineer posting is not junk — it is simply not
   * for this audience, and §5.1 filters it at read time using the `seniority` column.
   * Suppressing it at write time would mean a student searching "staff engineer" finds
   * nothing, and would quietly make the corpus unusable for any future audience.
   */

  return Math.min(1, Math.max(0, Number(score.toFixed(3))));
}
