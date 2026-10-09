import type { MatchCapReason, MatchScore } from '@/types';

/**
 * The client's half of scorer v3 (20261024000000_match_score_v3.sql): what the breakdown sheet
 * needs to take a score apart and to say what would raise it.
 *
 * The database is the scorer. Everything here is derived from the components it stored, and the
 * weights, ceiling and caps are copied from the migration so the sheet's arithmetic adds up to the
 * number on the ring. Change one side and change the other.
 */

export const MATCH_WEIGHTS = {
  skills: 0.4,
  experience: 0.25,
  field: 0.2,
  seniority: 0.15,
} as const;

export type MatchPart = keyof typeof MATCH_WEIGHTS;

export const MATCH_PART_LABELS: Record<MatchPart, string> = {
  skills: 'Skills',
  experience: 'Experience',
  field: 'Field',
  seniority: 'Level',
};

export const FAMILY_LABELS: Record<string, string> = {
  software: 'Software',
  data_ml: 'Data & ML',
  hardware: 'Hardware',
  product: 'Product',
  design: 'Design',
  business: 'Business & finance',
  sales_marketing: 'Sales & marketing',
  operations: 'Operations',
};

/** Above 85, each point counts 0.8, so 100 becomes 97. No resume is a perfect match. */
export function curveScore(raw: number): number {
  return raw > 85 ? Math.round(85 + (raw - 85) * 0.8) : raw;
}

export const MATCH_CEILING = curveScore(100);

interface Inputs {
  skills?: number;
  experience?: number;
  field?: number;
  seniority?: number;
  /** Sponsorship, citizenship or graduation: fixed by the posting and the reader, not the resume. */
  eligibilityCap?: number;
}

/**
 * compute_match_v3's arithmetic over already-computed components. Used only to price a change
 * ("what if the resume had these skills"): the sheet shows the difference between two runs of
 * this, never this in place of the stored score, so the components' two-decimal rounding cancels.
 */
export function rescore(parts: Inputs): number | null {
  const { skills, experience, field, seniority } = parts;
  let total = 0;
  let coverage = 0;
  for (const key of Object.keys(MATCH_WEIGHTS) as MatchPart[]) {
    const value = parts[key];
    if (typeof value !== 'number') continue;
    total += value * MATCH_WEIGHTS[key];
    coverage += MATCH_WEIGHTS[key];
  }
  if (coverage === 0 || (skills === undefined && field === undefined && experience === undefined)) return null;

  const caps = [curveScore(Math.round((100 * total) / coverage))];
  if (field !== undefined && field <= 0.1) caps.push(35);
  if (field !== undefined && field <= 0.35) caps.push(60);
  if (seniority !== undefined && seniority <= 0.3) caps.push(40);
  if (skills === undefined) caps.push(field === undefined ? 55 : field <= 0.35 ? 45 : 70);
  if (parts.eligibilityCap !== undefined) caps.push(parts.eligibilityCap);
  return Math.max(0, Math.min(...caps));
}

export interface BreakdownRow {
  part: MatchPart;
  /** 0–1, as the scorer wrote it. */
  value: number;
  /** What this part contributed to the raw score. The rows sum to `raw`. */
  points: number;
  /** The most it could have contributed, given which parts were answerable. */
  max: number;
}

export interface Breakdown {
  rows: BreakdownRow[];
  /** Parts the scorer had nothing to judge, so they were left out and the rest reweighted. */
  skipped: MatchPart[];
  raw: number;
  /** Points the 97 ceiling took off. */
  ceilingCut: number;
  /** Points a cap took off, and which one. */
  capCut: number;
  cap?: { at: number; reason: MatchCapReason };
}

/**
 * The score as points that add up: each part's share of the raw score, then what the ceiling and
 * any cap took off, ending at the number on the ring.
 */
export function breakdown(match: MatchScore): Breakdown {
  const { components } = match;
  const coverage = match.coverage > 0 ? match.coverage : 1;

  const rows: BreakdownRow[] = [];
  const skipped: MatchPart[] = [];
  for (const part of Object.keys(MATCH_WEIGHTS) as MatchPart[]) {
    const value = components[part];
    if (typeof value !== 'number') {
      skipped.push(part);
      continue;
    }
    const max = (100 * MATCH_WEIGHTS[part]) / coverage;
    rows.push({ part, value, points: value * max, max });
  }

  const raw = components.raw ?? Math.round(rows.reduce((sum, row) => sum + row.points, 0));
  roundToTotal(rows, raw);

  const curved = curveScore(raw);
  const ceilingCut = Math.max(0, raw - curved);
  const capCut = Math.max(0, curved - match.score);
  return { rows, skipped, raw, ceilingCut, capCut, cap: components.cap };
}

/** Rounds each row so the rows still sum to `total`: largest remainder first. */
function roundToTotal(rows: BreakdownRow[], total: number) {
  const floored = rows.map((row) => ({ row, points: Math.floor(row.points), rem: row.points % 1 }));
  let left = total - floored.reduce((sum, entry) => sum + entry.points, 0);
  for (const entry of [...floored].sort((a, b) => b.rem - a.rem)) {
    if (left <= 0) break;
    entry.points += 1;
    left -= 1;
  }
  for (const { row, points } of floored) {
    row.points = Math.max(0, points);
    row.max = Math.round(row.max);
  }
}

export type MatchTier = 'strong' | 'good' | 'fair' | 'stretch' | 'long';

export function matchTier(score: number): MatchTier {
  if (score >= 80) return 'strong';
  if (score >= 65) return 'good';
  if (score >= 45) return 'fair';
  if (score >= 30) return 'stretch';
  return 'long';
}

export const TIER_LABELS: Record<MatchTier, string> = {
  strong: 'Strong match',
  good: 'Good match',
  fair: 'Worth a shot',
  stretch: 'A stretch',
  long: 'Long shot',
};

/** One line under the score: what kind of application this is. */
export function tierLine(tier: MatchTier): string {
  switch (tier) {
    case 'strong':
      return 'Your resume lines up with most of what this role asks for. Apply early.';
    case 'good':
      return 'A solid fit with a gap or two. Worth applying to.';
    case 'fair':
      return 'Some real overlap, and some real gaps. Tailor before you apply.';
    case 'stretch':
      return 'Reachable if you can show what your resume does not yet say.';
    case 'long':
      return 'This role wants a different background from the one on your resume.';
  }
}

export function capLine(reason: MatchCapReason, at: number, jobFamily?: string): string {
  const family = jobFamily ? FAMILY_LABELS[jobFamily] ?? 'this field' : 'this field';
  switch (reason) {
    case 'off_field':
      return `${family} is outside what you studied and where you've worked, so this tops out at ${at}.`;
    case 'adjacent_field':
      return `${family} is next to your field rather than in it, so this tops out at ${at}.`;
    case 'level':
      return `This role is two or more levels from yours, so this tops out at ${at}.`;
    case 'no_skills':
      return `With no skills to compare, this is an estimate and tops out at ${at}.`;
    case 'sponsorship':
      return `This posting won't sponsor a visa and you've said you need one, so this tops out at ${at}.`;
    case 'sponsorship_soft':
      return `This posting won't sponsor a visa. Internships on CPT often still work, so this tops out at ${at} rather than lower.`;
    case 'citizenship':
      return `This role is for citizens only, so this tops out at ${at}.`;
    case 'graduation':
      return `You graduate outside the dates this posting asks for, so this tops out at ${at}.`;
  }
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `2026-12-01` → "Dec 2026". */
function monthYear(iso: string): string {
  const [year, month] = iso.split('-');
  return `${MONTH_NAMES[Number(month) - 1] ?? ''} ${year}`.trim();
}

export interface EligibilityRow {
  id: 'sponsorship' | 'citizenship' | 'graduation';
  title: string;
  line: string;
  /** `ok`: it fits. `blocked`: it caps the score. `ask`: the posting has a rule and we lack your answer. */
  status: 'ok' | 'blocked' | 'ask' | 'info';
}

/**
 * One row per rule the posting stated, with the reader's side of it. Postings that say nothing
 * produce no rows, so most sheets show no eligibility section at all.
 */
export function eligibilityRows(match: MatchScore): EligibilityRow[] {
  const e = match.components.eligibility;
  if (!e) return [];
  const rows: EligibilityRow[] = [];

  if (e.sponsorship === 'offered') {
    rows.push({ id: 'sponsorship', title: 'Sponsors visas', line: 'The posting says it offers visa sponsorship.', status: e.needsSponsorship ? 'ok' : 'info' });
  } else if (e.sponsorship) {
    const ever = e.sponsorship === 'none_ever';
    const said = ever ? 'won’t sponsor a visa, now or in the future' : 'won’t sponsor a visa';
    rows.push(
      e.needsSponsorship === undefined
        ? { id: 'sponsorship', title: 'No visa sponsorship', line: `The posting ${said}. Tell us in Profile whether you need sponsorship and the score will account for it.`, status: 'ask' }
        : e.needsSponsorship
          ? { id: 'sponsorship', title: 'No visa sponsorship', line: ever ? `The posting ${said}, and you've said you need it.` : `The posting ${said}. On CPT, an internship may still be open to you: ask the recruiter.`, status: 'blocked' }
          : { id: 'sponsorship', title: 'No visa sponsorship', line: `The posting ${said}. You've said you don't need it.`, status: 'ok' },
    );
  }

  if (e.citizenship) {
    const who = e.citizenship === 'citizen' ? 'US citizens only, usually for a security clearance' : 'US citizens and permanent residents (export rules)';
    const status: EligibilityRow['status'] =
      e.usCitizen === true ? 'ok'
        : e.usCitizen === undefined ? 'ask'
          : match.components.cap?.reason === 'citizenship' || (match.components.eligibilityCap ?? 100) <= 10 ? 'blocked' : 'info';
    rows.push({
      id: 'citizenship',
      title: e.citizenship === 'citizen' ? 'Citizens only' : 'US persons only',
      line: status === 'ask' ? `Open to ${who}. Answer "US citizen" in Profile to have this checked.` : `Open to ${who}.`,
      status,
    });
  }

  if (e.gradFrom || e.gradTo) {
    const window =
      e.gradFrom && e.gradTo
        ? e.gradFrom === e.gradTo ? monthYear(e.gradFrom) : `${monthYear(e.gradFrom)} – ${monthYear(e.gradTo)}`
        : e.gradTo ? `by ${monthYear(e.gradTo)}` : `from ${monthYear(e.gradFrom ?? '')}`;
    const yours = e.grad ? (e.grad.month ? `${MONTH_NAMES[e.grad.month - 1]} ${e.grad.year}` : String(e.grad.year)) : null;
    rows.push({
      id: 'graduation',
      title: `Graduating ${window}`,
      line: yours
        ? e.gradFits ? `You graduate ${yours}, inside the window.` : `You graduate ${yours}, outside the window.`
        : 'Add your graduation date in Profile to have this checked.',
      status: yours ? (e.gradFits ? 'ok' : 'blocked') : 'ask',
    });
  }
  return rows;
}

export interface Suggestion {
  id: string;
  title: string;
  body: string;
  /** Points the score would gain. Already net of caps and the ceiling. */
  gain: number;
}

/**
 * What would move this score, priced by rerunning the formula with one thing changed. Only
 * changes worth at least 2 points, biggest first. These are claims about the resume, not advice
 * to pad it: the skills one says so.
 */
export function suggestions(match: MatchScore): Suggestion[] {
  const c = match.components;
  const now: Inputs = {
    skills: c.skills,
    experience: c.experience,
    field: c.field,
    seniority: c.seniority,
    eligibilityCap: c.eligibilityCap,
  };
  const base = rescore(now);
  if (base === null) return [];
  const priced = (next: Inputs) => Math.max(0, (rescore(next) ?? base) - base);
  const out: Suggestion[] = [];
  const family = c.jobFamily ? FAMILY_LABELS[c.jobFamily] : undefined;

  if (c.limitedReason === 'resume') {
    // A resume with no readable skills, against a posting that lists some: the biggest lever.
    const gain = priced({ ...now, skills: 0.7 });
    if (gain >= 2) {
      out.push({
        id: 'skills-section',
        title: 'Add a skills section',
        body: 'We could not read any skills on your resume, so this posting\'s skills could not count for you.',
        gain,
      });
    }
  } else if (typeof c.skills === 'number' && c.skills < 1 && c.missing.length > 0) {
    // `missing` is required-first, so these are the ones worth the most.
    const shown = c.missing.slice(0, 3);
    const gain = priced({ ...now, skills: 1 });
    if (gain >= 2) {
      out.push({
        id: 'skills',
        title: `Show ${listJoin(shown)}${c.missing.length > shown.length ? ' and more' : ''}`,
        body: 'Only if you have them: a project or a skills line naming each one is enough for it to count.',
        gain,
      });
    }
  }

  if (typeof c.experience === 'number' && c.experience < 0.8 && c.jobFamily) {
    const experience = 1 - (1 - c.experience) * (1 - 0.81);
    const field = Math.max(c.field ?? 0, 0.85);
    const gain = priced({ ...now, experience, field });
    if (gain >= 2) {
      out.push({
        id: 'experience',
        title: `A ${family ?? 'relevant'} internship`,
        body:
          c.experience === 0
            ? 'Nothing on your resume is in this field yet. One internship or research role in it counts more than anything else here.'
            : 'You have some related experience. A role squarely in this field would count for more.',
        gain,
      });
    }
  }

  return out.sort((a, b) => b.gain - a.gain).slice(0, 3);
}

function listJoin(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

export function skillsLine(match: MatchScore): string {
  const c = match.components;
  if (c.limitedReason === 'resume') return 'We could not read any skills on your resume to compare.';
  if (c.limited) return 'This posting does not list specific skills, so the score leans on your field, experience and level.';
  const listed = c.matched.length + c.missing.length;
  const nice = c.preferred.length;
  const split = nice > 0 ? ` ${nice} of them ${nice === 1 ? 'is' : 'are'} only nice to have and count half.` : '';
  return `You have ${c.matched.length} of the ${listed} skills this role lists.${split} Having 60% counts as full marks.`;
}

export function fieldLine(field: number, source?: 'degree' | 'experience'): string {
  const from = source === 'experience' ? 'where you have worked' : 'what you studied';
  if (field >= 0.8) return `In your field, going by ${from}.`;
  if (field >= 0.5) return `Close to your field, going by ${from}.`;
  if (field >= 0.3) return `Next to your field: some overlap with ${from}.`;
  return `Outside ${from}.`;
}

/**
 * seniority_affinity's ladder (phase 4): a rung down costs 0.15, a rung up 0.35, so each value
 * names one distance. Matched to the hundredth because the scorer rounds to it.
 */
export function levelLine(seniority: number): string {
  switch (Math.round(seniority * 100)) {
    case 100:
      return 'The level you are at.';
    case 85:
      return 'One level below yours.';
    case 70:
      return 'Two levels below yours.';
    case 65:
      return 'One level above yours. A reach, but a normal one.';
    default:
      return seniority < 0.5 ? 'Two or more levels above yours.' : 'Well below your level.';
  }
}
