/**
 * Salary parsing — docs/README.md §4.4.
 *
 * "Parse `$120,000 - $150,000`, `$58/hr`, `120k-150k`, and the many postings where pay is
 * buried in a compliance paragraph at the bottom of the description."
 *
 * That last one is the highest-yield source in US postings and the reason this reads the
 * description at all: several states now require a posted range, so employers add a
 * paragraph rather than filling in the ATS field.
 *
 * **`isEstimated` is always false.** Nothing here infers a salary. README §16 question 5
 * — show an inferred range, or show nothing? — is open, and shipping an inference before
 * it is answered is how a guess ends up reading as a disclosure. The field exists so that
 * the day it is decided, there is somewhere to record which is which.
 */

import type { StructuredSalary } from '../sources/types.ts';

export interface ParsedSalary {
  min: number | null;
  max: number | null;
  period: 'hour' | 'year';
  currency: string;
  isEstimated: false;
}

/**
 * Bounds that reject a parse rather than store nonsense.
 *
 * A posting that opens with "we raised $500,000,000" must not come out with a salary.
 * Everything outside these ranges is treated as a number that happened to sit near a
 * dollar sign, which is what it almost always is.
 */
const ANNUAL_MIN = 15_000;
const ANNUAL_MAX = 1_200_000;
const HOURLY_MIN = 10;
const HOURLY_MAX = 400;

/** Above this, a bare number in a pay context is annual rather than hourly. */
const HOURLY_CEILING_GUESS = 2_000;

const CURRENCY_SYMBOLS: Record<string, string> = {
  $: 'USD',
  '£': 'GBP',
  '€': 'EUR',
  '₹': 'INR',
  '¥': 'JPY',
  C$: 'CAD',
  A$: 'AUD',
};

/**
 * The paragraph employers add to satisfy pay-transparency law. Finding it first and
 * parsing only its neighbourhood avoids matching a "$10M Series B" three paragraphs up.
 */
const COMPLIANCE_CUE =
  /\b(base (pay|salary|compensation) (range|for this)|salary range|compensation range|pay range|expected (base )?(pay|salary|compensation)|the (annual|hourly) (base )?(salary|rate|pay)|target (base )?(salary|compensation)|anticipated salary)\b/i;

const HOURLY_CUE = /\b(per hour|an hour|hourly|\/\s*(hr|hour)|hr\b)/i;
const ANNUAL_CUE = /\b(per year|annually|annualized|per annum|\/\s*(yr|year)|yearly)\b/i;
const MONTHLY_CUE = /\b(per month|monthly|\/\s*(mo|month))\b/i;

/** `$120,000`, `120k`, `$1.2M`, `58.50`. Captures the number and its magnitude suffix. */
const AMOUNT = /(C\$|A\$|[$£€₹¥])?\s*(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s*([kKmM])?/g;

interface Amount {
  value: number;
  currency: string | null;
  /** Position in the source string, so a range's two halves can be checked as adjacent. */
  index: number;
  end: number;
  hadSuffix: boolean;
  hadSymbol: boolean;
  hadSeparator: boolean;
}

function readAmounts(text: string): Amount[] {
  const found: Amount[] = [];
  AMOUNT.lastIndex = 0;

  for (let match = AMOUNT.exec(text); match !== null; match = AMOUNT.exec(text)) {
    const [whole, symbol, digits, suffix] = match;
    if (!digits) continue;

    const base = Number.parseFloat(digits.replace(/,/g, ''));
    if (!Number.isFinite(base)) continue;

    const multiplier = suffix?.toLowerCase() === 'k' ? 1_000 : suffix?.toLowerCase() === 'm' ? 1_000_000 : 1;

    found.push({
      value: base * multiplier,
      currency: symbol ? (CURRENCY_SYMBOLS[symbol] ?? null) : null,
      index: match.index,
      end: match.index + whole.length,
      hadSuffix: suffix !== undefined,
      hadSymbol: symbol !== undefined,
      hadSeparator: digits.includes(','),
    });
  }

  return found;
}

/**
 * A bare `2026` in "Summer 2026 Internship" is a year, and `40` in "40 hours per week" is
 * a workload. Both sit next to words that give them away.
 */
function looksLikePay(text: string, amount: Amount): boolean {
  if (amount.hadSymbol || amount.hadSuffix || amount.hadSeparator) return true;

  const context = text.slice(Math.max(0, amount.index - 30), Math.min(text.length, amount.end + 30));
  if (/\b(hours?|hrs?|weeks?|months?|years? of|days?|%|percent|employees|people|gpa|credits?)\b/i.test(context)) {
    return false;
  }
  return HOURLY_CUE.test(context) || ANNUAL_CUE.test(context);
}

/**
 * Always answers. Where the text states a cadence that is taken; otherwise the magnitude
 * decides, because nobody is paid $95,000 an hour and nobody is paid $60 a year.
 */
function periodFor(text: string, value: number): 'hour' | 'year' {
  if (HOURLY_CUE.test(text)) return 'hour';
  if (ANNUAL_CUE.test(text)) return 'year';
  if (MONTHLY_CUE.test(text)) return 'year'; // converted by the caller
  return value > 0 && value < HOURLY_CEILING_GUESS ? 'hour' : 'year';
}

function inBounds(value: number, period: 'hour' | 'year'): boolean {
  return period === 'hour'
    ? value >= HOURLY_MIN && value <= HOURLY_MAX
    : value >= ANNUAL_MIN && value <= ANNUAL_MAX;
}

function build(min: number | null, max: number | null, period: 'hour' | 'year', currency: string): ParsedSalary | null {
  const low = min !== null && inBounds(min, period) ? min : null;
  const high = max !== null && inBounds(max, period) ? max : null;

  if (low === null && high === null) return null;
  if (low !== null && high !== null && low > high) return null;

  return {
    min: low,
    max: high ?? low,
    period,
    currency,
    isEstimated: false,
  };
}

/** Normalizes a window of text to one line so cues and amounts sit near each other. */
function flatten(value: string): string {
  return value.replace(/\s+/g, ' ');
}

/**
 * Reads pay out of one window of text. Used on the compliance paragraph first, then on
 * the whole description as a fallback.
 */
function parseWindow(rawWindow: string): ParsedSalary | null {
  const window = flatten(rawWindow);
  const amounts = readAmounts(window).filter((amount) => looksLikePay(window, amount));
  if (amounts.length === 0) return null;

  const currency = amounts.find((amount) => amount.currency)?.currency ?? 'USD';
  const monthly = MONTHLY_CUE.test(window) && !HOURLY_CUE.test(window) && !ANNUAL_CUE.test(window);

  // A range is two amounts separated by a dash or "to" and nothing else.
  for (let index = 0; index < amounts.length - 1; index += 1) {
    const left = amounts[index];
    const right = amounts[index + 1];
    if (!left || !right) continue;

    const between = window.slice(left.end, right.index);
    if (!/^\s*(-|–|—|to|and|up to)\s*$/i.test(between)) continue;

    // "120k - 150k" often writes the symbol once; the suffix likewise. Inherit the left
    // side's magnitude when the right side is a bare number smaller than it.
    const rightValue = !right.hadSuffix && left.hadSuffix && right.value < left.value ? right.value * 1000 : right.value;

    const period = periodFor(window, Math.max(left.value, rightValue));
    const scale = monthly ? 12 : 1;
    const parsed = build(left.value * scale, rightValue * scale, monthly ? 'year' : period, currency);
    if (parsed) return parsed;
  }

  // No range: take the most plausible single figure.
  for (const amount of amounts) {
    const period = periodFor(window, amount.value);
    const scale = monthly ? 12 : 1;
    const parsed = build(amount.value * scale, amount.value * scale, monthly ? 'year' : period, currency);
    if (parsed) return parsed;
  }

  return null;
}

/**
 * Structured ATS pay first, description text second.
 *
 * The structured field is what the employer typed into a form with a currency and an
 * interval beside it. The description is a paragraph someone wrote. When both exist the
 * form wins, and when only the paragraph exists it is still the employer's own statement
 * — which is what keeps `isEstimated` honestly false in both cases.
 */
export function parseSalary(structured: StructuredSalary | null, description: string): ParsedSalary | null {
  if (structured && (structured.min !== null || structured.max !== null)) {
    const parsed = build(structured.min, structured.max, structured.period, structured.currency);
    if (parsed) return parsed;
  }

  if (description === '') return null;

  const cue = COMPLIANCE_CUE.exec(description);
  if (cue) {
    // A window around the cue rather than the sentence: the figures sometimes precede the
    // phrase ("$120,000 — $150,000 is the base pay range for this role").
    const start = Math.max(0, cue.index - 160);
    const fromCue = parseWindow(description.slice(start, cue.index + 400));
    if (fromCue) return fromCue;
  }

  // Last resort: the tail of the description, where pay disclosures live when there is no
  // recognisable cue phrase. Scanning the whole body would match funding rounds,
  // revenue figures and customer counts in the company blurb at the top.
  return parseWindow(description.slice(-1200));
}
