/**
 * What a posting says about who can take it, beyond skills: which skills are only nice to have,
 * whether it sponsors visas, whether it is open only to citizens, and which graduation dates it
 * wants. Scorer v3 reads all four (20261024000000_match_score_v3.sql) through `job_signals`.
 *
 * Every rule here is a phrase an employer writes, matched conservatively. A posting that says
 * nothing gets nulls, and a null never moves a score: being wrong about "we won't sponsor" costs
 * a reader a job they could have had, so the bar for reading one is a sentence that says it.
 */

import { parseJobSections } from '../../../../utils/jobSections.ts';
import { extractSkills, type SkillDictionary } from './skills.ts';

/**
 * `none_ever`: the reader must be able to work without sponsorship now *and in the future*, which
 * shuts out F-1 students on CPT or OPT as well. `none`: the employer won't sponsor, said without
 * the future clause, which for an internship usually still admits a student on CPT.
 */
export type Sponsorship = 'none_ever' | 'none' | 'offered';

/** `citizen`: citizens only, usually for a clearance. `us_person`: ITAR's citizens or permanent residents. */
export type CitizenshipRule = 'citizen' | 'us_person';

export interface PostingSignals {
  /** Labels from the posting's skills that appear only under its nice-to-have heading. */
  preferredSkills: string[];
  sponsorship: Sponsorship | null;
  citizenship: CitizenshipRule | null;
  /** Inclusive, `YYYY-MM`. Either end may be open. */
  gradFrom: string | null;
  gradTo: string | null;
}

export function postingSignals(
  dictionary: SkillDictionary,
  job: { title: string; companyName: string; skills: string[]; descriptionText: string | null },
): PostingSignals {
  const text = job.descriptionText ?? '';
  const grad = graduationWindow(text);
  return {
    preferredSkills: preferredSkills(dictionary, job),
    sponsorship: sponsorship(text),
    citizenship: citizenship(text),
    gradFrom: grad?.from ?? null,
    gradTo: grad?.to ?? null,
  };
}

// ── required vs preferred ──────────────────────────────────────────────────────

/**
 * The posting's skills that only its "nice to have" section names. A skill named under both is
 * required, and one named in neither section (in prose, say) stays required too: the posting
 * listed it, and nothing said it was optional. Limited to `job.skills` so the scorer can treat
 * this as a subset of what it already compares.
 */
export function preferredSkills(
  dictionary: SkillDictionary,
  job: { title: string; companyName: string; skills: string[]; descriptionText: string | null },
): string[] {
  if (job.skills.length === 0) return [];
  const sections = parseJobSections(job.descriptionText, { title: job.title, companyName: job.companyName });
  if (sections.preferred.length === 0) return [];

  const preferred = new Set(extractSkills(dictionary, '', sections.preferred, sections.preferred.join('\n')));
  const required = new Set(
    extractSkills(
      dictionary,
      job.title,
      sections.requirements,
      [...sections.requirements, ...sections.responsibilities, ...sections.overview].join('\n'),
    ),
  );
  return job.skills.filter((skill) => preferred.has(skill) && !required.has(skill));
}

// ── sponsorship and citizenship ────────────────────────────────────────────────

const VISA = String.raw`(?:visa|immigration|work (?:visa|permit|authori[sz]ation)|h-?1b|employment|sponsorship)`;

/** "...now or in the future", in its many spellings: the clause that also excludes CPT and OPT. */
const FUTURE = /\b(?:now or in the future|now or at any (?:point|time) in the future|current(?:ly)? or (?:in the )?future|at any time in the future|future sponsorship|in the future)\b/i;

const NO_SPONSOR: RegExp[] = [
  new RegExp(String.raw`\b(?:not|unable to|cannot|can['’]?t|won['’]?t|will not|do(?:es)? not|are not able to|is not able to)\s+(?:be able to\s+)?(?:provide|offer|sponsor|support|consider)\w*\s+(?:\w+\s+){0,4}?${VISA}`, 'i'),
  /\b(?:not|unable to|cannot|won['’]?t|will not|do(?:es)? not)\s+sponsor\b/i,
  /\bsponsorship\s+(?:is\s+)?(?:not\s+(?:available|offered|provided|possible)|unavailable)\b/i,
  /\bno\s+(?:visa\s+|h-?1b\s+)?sponsorship\b/i,
  // "not currently able to sponsor", "unable at this time to sponsor": an adverb or two between.
  /\b(?:not|unable)\b(?:\s+\w+){0,3}?\s+(?:able\s+)?to\s+sponsor\b/i,
  /\bnot\s+eligible\s+for\s+(?:visa\s+)?sponsorship\b/i,
  /\bwithout\s+(?:the\s+)?(?:need\s+for|requiring|requirement of)?\s*(?:current\s+or\s+future\s+|future\s+)?(?:visa\s+|employer\s+|employment\s+|company\s+)?sponsorship\b/i,
];

const SPONSORS: RegExp[] = [
  /\b(?:visa|h-?1b)\s+sponsorship\s+(?:is\s+)?(?:available|offered|provided)\b/i,
  /\bsponsorship\s+(?:is\s+)?(?:available|offered|provided)\b/i,
  /\b(?:we|will|can|able to)\s+(?:provide\s+|offer\s+)?(?:visa\s+)?sponsor(?:ship)?\b(?!\s+(?:events?|a\b))/i,
  /\bopen to (?:candidates|applicants) (?:who )?(?:require|requiring|need(?:ing)?) (?:visa )?sponsorship\b/i,
];

export function sponsorship(text: string): Sponsorship | null {
  for (const sentence of sentences(text)) {
    if (NO_SPONSOR.some((pattern) => pattern.test(sentence))) {
      return FUTURE.test(sentence) ? 'none_ever' : 'none';
    }
  }
  // Only after every sentence had its chance to say no: "we sponsor events" is not a visa, and a
  // posting that says both has said no. A sentence about another country's visa ("we can sponsor
  // visas to Germany") or a security clearance ("sponsor you through the clearance process") is
  // not an offer to sponsor a US or Canadian work visa.
  return sentences(text).some(
    (sentence) => SPONSORS.some((pattern) => pattern.test(sentence)) && !NOT_A_VISA_HERE.test(sentence),
  )
    ? 'offered'
    : null;
}

const NOT_A_VISA_HERE =
  /\bclearance\b|\bto\s+(?:germany|the uk|uk|united kingdom|ireland|the netherlands|netherlands|france|spain|poland|portugal|india|singapore|japan|australia|israel|switzerland|sweden|denmark)\b/i;

const CITIZEN_ONLY: RegExp[] = [
  /\b(?:must|required to|need to)\s+be\s+(?:a\s+)?(?:u\.?\s?s\.?|united states|american)\s+citizen/i,
  /\b(?:u\.?\s?s\.?|united states)\s+citizenship\s+(?:is\s+)?(?:required|mandatory)/i,
  /\b(?:u\.?\s?s\.?|united states)\s+citizens?\s+only\b/i,
  /\brequires?\s+(?:u\.?\s?s\.?|united states)\s+citizenship\b/i,
  /\b(?:active|current|ability to obtain|able to obtain|eligib\w+ (?:to obtain|for))\s+(?:and maintain\s+)?(?:an?\s+)?(?:us\s+)?(?:government\s+|dod\s+)?(?:(?:secret|top secret|ts\/sci|ts)\s+)?(?:security\s+)?clearance\b/i,
  /\b(?:secret|top secret|ts\/sci|security)\s+clearance\s+(?:is\s+)?required\b/i,
];

const US_PERSON: RegExp[] = [
  /\bu\.?\s?s\.?\s+persons?\b/i,
  /\bitar\b/i,
  /\b(?:u\.?\s?s\.?\s+)?citizens?\s+or\s+(?:lawful\s+)?permanent\s+residents?\b/i,
  /\bgreen card holders?\b/i,
];

export function citizenship(text: string): CitizenshipRule | null {
  const all = sentences(text);
  if (all.some((sentence) => CITIZEN_ONLY.some((pattern) => pattern.test(sentence)))) {
    // "Citizen or permanent resident" in the same breath is the looser rule, not the stricter.
    const loose = all.some((sentence) => /permanent resident|green card/i.test(sentence) && CITIZEN_ONLY.some((p) => p.test(sentence)));
    return loose ? 'us_person' : 'citizen';
  }
  return all.some((sentence) => US_PERSON.some((pattern) => pattern.test(sentence))) ? 'us_person' : null;
}

// ── graduation window ──────────────────────────────────────────────────────────

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
// Graduation seasons, as universities mean them: spring is May, fall is December.
const SEASONS: Record<string, number> = { spring: 5, summer: 8, fall: 12, autumn: 12, winter: 12 };

const DATE = String.raw`(?:(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?,?\s+|(spring|summer|fall|autumn|winter)\s+(?:of\s+)?|(?:0?([1-9]|1[0-2])\/))?((?:20)\d{2})`;
const ANCHOR = /\b(?:graduat\w*|grad date|class of|degree (?:completion|conferral)|complet\w+ (?:your|their|a) (?:degree|bachelor|master)|expected to graduate)\b/gi;

interface MonthYear {
  year: number;
  month: number | null;
}

function readDate(match: RegExpExecArray, offset: number): MonthYear | null {
  const [month, season, numeric, year] = [match[offset], match[offset + 1], match[offset + 2], match[offset + 3]];
  const y = Number(year);
  if (!Number.isFinite(y) || y < 2020 || y > 2035) return null;
  if (month) return { year: y, month: MONTHS[month.toLowerCase().slice(0, 3)] ?? null };
  if (season) return { year: y, month: SEASONS[season.toLowerCase()] ?? null };
  if (numeric) return { year: y, month: Number(numeric) };
  return { year: y, month: null };
}

const fmt = (date: MonthYear, end: 'from' | 'to') =>
  `${date.year}-${String(date.month ?? (end === 'from' ? 1 : 12)).padStart(2, '0')}`;

/**
 * The graduation dates a posting asks for, read from the 120 characters after a phrase about
 * graduating: "graduating between December 2026 and June 2027", "Class of 2027", "expected
 * graduation date of Spring 2027", "graduating no later than May 2026". Null when no such phrase
 * names a year.
 */
export function graduationWindow(text: string): { from: string | null; to: string | null } | null {
  const range = new RegExp(String.raw`${DATE}\s*(?:-|–|—|to|and|through|thru|or)\s*${DATE}`, 'i');
  const single = new RegExp(DATE, 'i');

  for (const anchor of text.matchAll(ANCHOR)) {
    const after = text.slice(anchor.index ?? 0, (anchor.index ?? 0) + anchor[0].length + 120);

    const pair = range.exec(after);
    if (pair) {
      const a = readDate(pair, 1);
      const b = readDate(pair, 5);
      if (a && b) {
        const [lo, hi] = a.year * 12 + (a.month ?? 1) <= b.year * 12 + (b.month ?? 12) ? [a, b] : [b, a];
        return { from: fmt(lo, 'from'), to: fmt(hi, 'to') };
      }
    }

    const one = single.exec(after);
    if (one) {
      const date = readDate(one, 1);
      if (!date) continue;
      const before = after.slice(0, one.index).toLowerCase();
      const following = after.slice(one.index + one[0].length).toLowerCase();
      if (/\b(?:by|before|no later than|prior to|on or before)\s*$/.test(before)) return { from: null, to: fmt(date, 'to') };
      if (/\b(?:after|no earlier than|on or after|from)\s*$/.test(before)) return { from: fmt(date, 'from'), to: null };
      // "December 2027 or later" is a floor, not a month; "or earlier" a ceiling.
      if (/^\s*,?\s*(?:or|and)\s+(?:later|after|beyond|onwards?|thereafter)\b/.test(following)) return { from: fmt(date, 'from'), to: null };
      if (/^\s*,?\s*(?:or)\s+(?:earlier|before|sooner)\b/.test(following)) return { from: null, to: fmt(date, 'to') };
      return { from: fmt(date, 'from'), to: fmt(date, 'to') };
    }
  }
  return null;
}

/** Sentences and bullet lines: the unit every rule above reads, so one clause can't borrow another's "not". */
function sentences(text: string): string[] {
  return text
    // "U.S." would otherwise end a sentence in the middle of "must be a U.S. citizen".
    .replace(/\bU\.\s?S\.(?:\s?A\.)?/gi, 'US')
    .split(/(?<=[.!?])\s+|\n+|•/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
