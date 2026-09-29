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
  R$: 'BRL',
  '₱': 'PHP',
  '₩': 'KRW',
  '₪': 'ILS',
  '₺': 'TRY',
  '₫': 'VND',
  '₦': 'NGN',
};

/**
 * Any other currency sign is still a currency, just not dollars. Coinbase's Manila roles say
 * "₱849,800 — ₱849,800 PHP"; with ₱ unrecognised the figure fell back to USD and 849,800 pesos
 * (≈ $15k) was stored as $849,800 a year. ISO 4217 reserves XXX for "no specific currency".
 */
const UNKNOWN_CURRENCY = 'XXX';

/**
 * The paragraph employers add to satisfy pay-transparency law. Finding it first and
 * parsing only its neighbourhood avoids matching a "$10M Series B" three paragraphs up.
 */
const COMPLIANCE_CUE =
  /\b(base (pay|salary|compensation) (range|for this)|salary range|compensation range|pay range|expected (base )?(pay|salary|compensation)|the (annual|hourly) (base )?(salary|rate|pay)|target (base )?(salary|compensation)|anticipated salary)\b/i;

const HOURLY_CUE = /\b(per hour|an hour|hourly|\/\s*(hr|hour)|hr\b)/i;
const ANNUAL_CUE = /\b(per year|annually|annualized|per annum|\/\s*(yr|year)|yearly)\b/i;
/*
 * `(?<!-)` so "semi-monthly payroll" and "bi-monthly" are not a pay cadence. That exact phrase,
 * in a payroll job's description one line under "$70,000 - $83,000", made this parser multiply
 * by twelve and store $840k–$996k.
 */
const MONTHLY_CUE = /(?<!-)\b(per month|monthly|\/\s*(mo|month))\b/i;

/**
 * How far either side of a figure its cadence words are looked for. The cadence belongs to the
 * words next to the number ("$45 – $62 per hour"), not to anything else in the paragraph — a
 * window-wide test is what let "semi-monthly payroll" and "hourly employees" re-label a range.
 */
const CADENCE_REACH = 40;

/**
 * A currency written after the figure — "226,000 zł - 346,000 zł", "€139.000—€170.000 EUR",
 * "$120,000 CAD". It overrides a bare `$`, which Canadian and Australian postings also use.
 * Affirm's Warsaw roles were stored as USD before this, so 226,000 złoty (≈ $57k) read as $226k.
 */
const CURRENCY_CODE = /(zł|\b(?:USD|EUR|GBP|CAD|AUD|INR|PLN|CHF|SEK|NOK|DKK|JPY|SGD|ILS|BRL|MXN|NZD|HKD|CZK|HUF|RON)\b)/;

function currencyIn(context: string): string | null {
  const match = CURRENCY_CODE.exec(context);
  if (!match?.[1]) return null;
  return match[1] === 'zł' ? 'PLN' : match[1];
}

/** A monthly figure is only believed within this range before it is multiplied by twelve. */
const MONTHLY_MIN = 1_000;
const MONTHLY_MAX = 40_000;

/** `$120,000`, `120k`, `$1.2M`, `58.50`. Captures the number and its magnitude suffix. */
/*
 * The suffix must end the word: without the lookahead, "$110,000 monthly" read the "m" of
 * "monthly" as millions and produced $110 billion — rejected by the bounds, which is why it
 * surfaced only as a range that silently lost its top end.
 */
const AMOUNT = /(C\$|A\$|R\$|\p{Sc})?\s*(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d{1,3}(?:\.\d{3})+(?![\d,])|\d+(?:\.\d+)?)(?:\s*([kKmM])(?![a-zA-Z]))?/gu;

/**
 * European grouping — "€139.000", "€51.450" — where the dot separates thousands. Algolia's EU
 * postings write pay this way, and reading "139.000" as a decimal stored €139,000 a year as
 * $139 an hour. A dot followed by exactly three digits is taken as grouping; "58.50" and
 * "139.5" stay decimals.
 */
const DOT_GROUPED = /^\d{1,3}(?:\.\d{3})+$/;

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

    const base = Number.parseFloat(DOT_GROUPED.test(digits) ? digits.replace(/\./g, '') : digits.replace(/,/g, ''));
    if (!Number.isFinite(base)) continue;

    const multiplier = suffix?.toLowerCase() === 'k' ? 1_000 : suffix?.toLowerCase() === 'm' ? 1_000_000 : 1;

    found.push({
      value: base * multiplier,
      currency: symbol ? (CURRENCY_SYMBOLS[symbol] ?? UNKNOWN_CURRENCY) : null,
      index: match.index,
      end: match.index + whole.length,
      hadSuffix: suffix !== undefined,
      hadSymbol: symbol !== undefined,
      hadSeparator: digits.includes(',') || DOT_GROUPED.test(digits),
    });
  }

  return found;
}

/**
 * A bare `2026` in "Summer 2026 Internship" is a year, and `40` in "40 hours per week" is
 * a workload. Both sit next to words that give them away.
 */
function looksLikePay(text: string, amount: Amount): boolean {
  // "401(k)" and "403(b)" are retirement plans. Alloy's benefits paragraph ("401k matching")
  // otherwise parsed as a $401,000 salary sitting next to the real $130,000–$160,000 range.
  const literal = text.slice(amount.index, amount.end + 4);
  if (/^\s*40[13]\s*\(?\s*[kb]\b/i.test(literal) || /^\s*40[13]\s*\(\s*[kb]\s*\)/i.test(literal)) return false;

  /*
   * Money that is not pay. Affirm lists "New hire equity: $16,000-$24,000" and "Reward equity"
   * in the same block as base pay; funding rounds, relocation and signing bonuses sit beside it
   * elsewhere. The label is in the few words before the figure.
   */
  const before = text.slice(Math.max(0, amount.index - 32), amount.index);
  if (/\b(equity|rsus?|stock|shares|options|refresh|sign[- ]?on|signing|relocation|stipend|reimburse\w*|bonus|raised|funding|series [a-h]|valuation|revenue|401)\b[^$€£\d]*$/i.test(before)) {
    return false;
  }

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
  const byMagnitude = value > 0 && value < HOURLY_CEILING_GUESS ? 'hour' : 'year';
  // A stated cadence wins only when the figure is plausible for it. "$95,000 … hourly" is an
  // annual salary next to an unrelated word, not a $95,000 hourly rate.
  if (HOURLY_CUE.test(text)) return inBounds(value, 'hour') ? 'hour' : byMagnitude;
  if (ANNUAL_CUE.test(text)) return inBounds(value, 'year') ? 'year' : byMagnitude;
  if (MONTHLY_CUE.test(text)) return 'year'; // converted by the caller
  return byMagnitude;
}

function inBounds(value: number, period: 'hour' | 'year'): boolean {
  return period === 'hour'
    ? value >= HOURLY_MIN && value <= HOURLY_MAX
    : value >= ANNUAL_MIN && value <= ANNUAL_MAX;
}

/**
 * A form's filler, not a range. SambaNova posts "Base Pay Range $1 — $999,999 USD"; the $1
 * failed the bounds and $999,999 alone was stored as the salary.
 */
function isPlaceholder(value: number | null): boolean {
  return value !== null && value >= 9_999 && /^9+$/.test(String(Math.trunc(value)));
}

function build(min: number | null, max: number | null, period: 'hour' | 'year', currency: string): ParsedSalary | null {
  if (isPlaceholder(min) || isPlaceholder(max)) return null;
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

  const symbolCurrency = amounts.find((amount) => amount.currency)?.currency ?? null;
  const currencyFor = (context: string) => currencyIn(context) ?? symbolCurrency ?? 'USD';

  /**
   * The words around a figure or a range — where its cadence is actually stated. The reach after
   * it stops at the end of the sentence or list item: "$95,000 - $120,000. We also employ hourly
   * staff" is two statements, and only the first is about this salary.
   */
  const near = (from: number, to: number) => {
    const after = window.slice(to, Math.min(window.length, to + CADENCE_REACH));
    const stop = after.search(/[.;•]\s|\s[•|]\s/);
    return window.slice(Math.max(0, from - CADENCE_REACH), to + (stop === -1 ? after.length : stop));
  };
  const isMonthly = (context: string, value: number) =>
    MONTHLY_CUE.test(context) && !HOURLY_CUE.test(context) && !ANNUAL_CUE.test(context) &&
    value >= MONTHLY_MIN && value <= MONTHLY_MAX;

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

    const context = near(left.index, right.end);
    const top = Math.max(left.value, rightValue);
    const monthly = isMonthly(context, top);
    const period = periodFor(context, top);
    const scale = monthly ? 12 : 1;
    const parsed = build(left.value * scale, rightValue * scale, monthly ? 'year' : period, currencyFor(context));
    if (parsed) return parsed;
  }

  // No range: take the most plausible single figure.
  for (const amount of amounts) {
    const context = near(amount.index, amount.end);
    const monthly = isMonthly(context, amount.value);
    const period = periodFor(context, amount.value);
    const scale = monthly ? 12 : 1;
    const parsed = build(amount.value * scale, amount.value * scale, monthly ? 'year' : period, currencyFor(context));
    if (parsed) return parsed;
  }

  return null;
}

/**
 * Moves a cut point forward to the end of the word it lands in, so a window never ends inside a
 * number. A fixed-length cut once turned Algolia's "$130,500" into "$130,50", which read as
 * "$130" — stored as $130 an hour for a $130k-a-year role.
 */
function tokenEnd(text: string, at: number): number {
  let end = Math.min(at, text.length);
  while (end < text.length && /[\w.,\p{Sc}]/u.test(text[end]!)) end += 1;
  // …and if that figure opens a range, keep its other half too.
  const rest = /^\s*(?:-|–|—|to)\s*(?:C\$|A\$|R\$|\p{Sc})?\s*[\d,.]+(?:\s*[kKmM](?![a-zA-Z]))?/u.exec(text.slice(end));
  return rest ? end + rest[0].length : end;
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

  /*
   * Every cue, in order, not just the first. Postings often open the section with a sentence
   * that names "the base compensation range" and states no figures, then give the actual range
   * further down under a second cue ("USA base pay range … $195,000 - 255,000") — which a
   * first-cue-only reading never reached.
   */
  const cues = new RegExp(COMPLIANCE_CUE.source, 'gi');
  for (const cue of description.matchAll(cues)) {
    // A window around the cue rather than the sentence: the figures sometimes precede the
    // phrase ("$120,000 — $150,000 is the base pay range for this role").
    const start = Math.max(0, cue.index - 160);
    const fromCue = parseWindow(description.slice(start, tokenEnd(description, cue.index + 400)));
    if (fromCue) return fromCue;
  }

  // Last resort: the tail of the description, where pay disclosures live when there is no
  // recognisable cue phrase. Scanning the whole body would match funding rounds,
  // revenue figures and customer counts in the company blurb at the top.
  return parseWindow(description.slice(-1200));
}
