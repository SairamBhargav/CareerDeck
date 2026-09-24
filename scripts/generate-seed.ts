/*
 * Writes supabase/seed.sql from the app's own fixtures plus the curated reference data.
 *
 * §2.2: "The mock fixtures become the seed script. They're good fixtures — keep them
 * working so local dev never needs a crawler."
 *
 * Phase 0 emitted schools. Phase 1 adds the skills dictionary (§4.4), the companies from
 * both data/mockCompanies.ts and scripts/board-list.ts, the `job_sources` rows the crawler
 * reads, and the mock postings themselves — so `npm run db:reset` produces an app with
 * content in it and `npm run ingest` is an enhancement rather than a prerequisite.
 *
 * The fixture postings go through the *same* normalizers the crawler uses rather than
 * being mapped field-for-field. That is deliberate: it means a bug in title
 * normalization, seniority extraction or skill matching shows up in local dev on data
 * someone actually looks at, instead of only in a corpus nobody reads closely.
 *
 * Run with `npm run seed:generate`. Node strips the types, so this imports the very same
 * fixture and normalizer modules the app and the crawler do, rather than copies that can
 * drift from them.
 */

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { mockCompanies } from '../data/mockCompanies.ts';
import { mockJobs } from '../data/mockJobs.ts';
import { mockUser } from '../data/mockUser.ts';
import { BOARDS, boardUrlFor, logoUrlFor, monogramFor, type BoardEntry } from './board-list.ts';
import { SKILLS } from './skills-dictionary.ts';

import { parseLocations } from '../server/src/ingest/normalize/location.ts';
import { scoreQuality } from '../server/src/ingest/normalize/quality.ts';
import { extractSeniority, normalizeTitle } from '../server/src/ingest/normalize/seniority.ts';
import { compileDictionary, extractSkills } from '../server/src/ingest/normalize/skills.ts';

// ── SQL helpers ────────────────────────────────────────────────────────────────

function quote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function nullable(value: string | null | undefined): string {
  return value === null || value === undefined || value === '' ? 'null' : quote(value);
}

function textArray(values: string[]): string {
  if (values.length === 0) return `'{}'::text[]`;
  return `array[${values.map(quote).join(', ')}]::text[]`;
}

function citextArray(values: string[]): string {
  if (values.length === 0) return `'{}'::extensions.citext[]`;
  return `array[${values.map(quote).join(', ')}]::extensions.citext[]`;
}

function numeric(value: number | null): string {
  return value === null ? 'null' : String(value);
}

// ── schools (phase 0) ──────────────────────────────────────────────────────────

interface SchoolSeed {
  name: string;
  shortName: string;
  emailDomains: string[];
}

/*
 * Enough US schools to exercise the .edu matching in §3.2 and to make the school field
 * feel real in local dev. This is not the production list — that one gets imported from
 * IPEDS in phase 3, when `.edu` verification actually needs full coverage.
 */
const SCHOOLS: SchoolSeed[] = [
  { name: 'University of Texas at Dallas', shortName: 'UT Dallas', emailDomains: ['utdallas.edu'] },
  { name: 'University of Texas at Austin', shortName: 'UT Austin', emailDomains: ['utexas.edu'] },
  { name: 'Purdue University', shortName: 'Purdue', emailDomains: ['purdue.edu'] },
  { name: 'Georgia Institute of Technology', shortName: 'Georgia Tech', emailDomains: ['gatech.edu'] },
  { name: 'University of Illinois Urbana-Champaign', shortName: 'UIUC', emailDomains: ['illinois.edu'] },
  { name: 'University of Michigan', shortName: 'Michigan', emailDomains: ['umich.edu'] },
  { name: 'Carnegie Mellon University', shortName: 'CMU', emailDomains: ['cmu.edu', 'andrew.cmu.edu'] },
  { name: 'Massachusetts Institute of Technology', shortName: 'MIT', emailDomains: ['mit.edu'] },
  { name: 'Stanford University', shortName: 'Stanford', emailDomains: ['stanford.edu'] },
  { name: 'University of California, Berkeley', shortName: 'Berkeley', emailDomains: ['berkeley.edu'] },
  { name: 'University of Washington', shortName: 'UW', emailDomains: ['uw.edu'] },
  { name: 'Arizona State University', shortName: 'ASU', emailDomains: ['asu.edu'] },
];

function schoolsSql(): string {
  const schools = [...SCHOOLS];

  // The fixture user has to be able to pick their own school, or local dev diverges from
  // the app the moment someone opens Profile.
  if (!schools.some((school) => school.name === mockUser.school)) {
    schools.push({ name: mockUser.school, shortName: mockUser.school, emailDomains: [] });
  }
  schools.sort((a, b) => a.name.localeCompare(b.name));

  const rows = schools
    .map((s) => `  (${quote(s.name)}, ${quote(s.shortName)}, ${citextArray(s.emailDomains)})`)
    .join(',\n');

  return [
    '-- Reference data for §3.2 verification. Idempotent on the natural key.',
    'insert into public.schools (name, short_name, email_domains) values',
    rows,
    'on conflict (name) do update set',
    '  short_name = excluded.short_name,',
    '  email_domains = excluded.email_domains;',
  ].join('\n');
}

// ── skills (§4.4) ──────────────────────────────────────────────────────────────

function skillsSql(): string {
  const rows = SKILLS.map(
    (skill) =>
      `  (${quote(skill.slug)}, ${quote(skill.label)}, ${citextArray(skill.aliases)}, ${quote(skill.category)})`,
  ).join(',\n');

  return [
    '-- §4.4: the dictionary is the only authority on what a skill is called. Extraction',
    '-- matches slug + aliases and always emits `label`, so react / ReactJS / react.js all',
    '-- land as "React" and the filters keep working.',
    'insert into public.skills (slug, label, aliases, category) values',
    rows,
    'on conflict (slug) do update set',
    '  label = excluded.label,',
    '  aliases = excluded.aliases,',
    '  category = excluded.category;',
  ].join('\n');
}

// ── companies ──────────────────────────────────────────────────────────────────

interface CompanySeed {
  slug: string;
  name: string;
  domain: string;
  logoUrl: string;
  monogram: string;
  logoColor: string | null;
  industry: string | null;
  followerCount: number;
}

/*
 * Domains for the fixture companies, which carry a logo and a follower count but no
 * identifier a crawler could match on.
 *
 * §3.3: `domain` is THE cross-crawler dedup key, and it is unique. Giving these rows their
 * real domains now means that when one of them later gets a source — a Workday adapter, or
 * a career-site scraper — the crawl merges into the existing company rather than creating
 * a second NVIDIA with a different logo.
 */
const FIXTURE_DOMAINS: Record<string, string> = {
  nvidia: 'nvidia.com',
  google: 'google.com',
  amazon: 'amazon.com',
  citadel: 'citadel.com',
  apple: 'apple.com',
  spacex: 'spacex.com',
  microsoft: 'microsoft.com',
  meta: 'meta.com',
  netflix: 'netflix.com',
  twosigma: 'twosigma.com',
  boeing: 'boeing.com',
  lockheed: 'lockheedmartin.com',
  blueorigin: 'blueorigin.com',
  tesla: 'tesla.com',
  caterpillar: 'caterpillar.com',
};

function buildCompanies(): CompanySeed[] {
  const bySlug = new Map<string, CompanySeed>();

  // Fixtures first: they carry the hand-picked brand colour, industry and follower count,
  // and a board entry should enrich one of these rather than replace it.
  for (const company of mockCompanies) {
    const domain = FIXTURE_DOMAINS[company.id] ?? `${company.id}.example`;
    bySlug.set(company.id, {
      slug: company.id,
      name: company.name,
      domain,
      logoUrl: company.logo,
      monogram: monogramFor(company.name),
      logoColor: company.logoColor,
      industry: company.industry,
      followerCount: company.followerCount,
    });
  }

  for (const board of BOARDS) {
    const existing = bySlug.get(board.slug);
    if (existing) {
      // Keep the fixture's identity, take the board's real domain.
      existing.domain = board.domain;
      existing.logoUrl = logoUrlFor(board.domain);
      continue;
    }

    bySlug.set(board.slug, {
      slug: board.slug,
      name: board.name,
      domain: board.domain,
      logoUrl: logoUrlFor(board.domain),
      monogram: monogramFor(board.name),
      logoColor: board.logoColor ?? null,
      industry: board.industry,
      // Fabricating a follower count would be inventing social proof. Zero is true: nobody
      // follows anyone yet, because follows are phase 2.
      followerCount: 0,
    });
  }

  // `domain` is unique. A collision here would fail the insert halfway through the seed,
  // which is a confusing way to discover a one-character typo in board-list.ts.
  const domains = new Map<string, string>();
  for (const company of bySlug.values()) {
    const owner = domains.get(company.domain.toLowerCase());
    if (owner) {
      throw new Error(`Duplicate domain ${company.domain}: claimed by both "${owner}" and "${company.slug}"`);
    }
    domains.set(company.domain.toLowerCase(), company.slug);
  }

  return [...bySlug.values()].sort((a, b) => a.slug.localeCompare(b.slug));
}

function companiesSql(companies: CompanySeed[]): string {
  const rows = companies
    .map(
      (c) =>
        `  (${quote(c.slug)}, ${quote(c.name)}, ${quote(c.domain)}, ${quote(c.logoUrl)}, ` +
        `${quote(c.monogram)}, ${nullable(c.logoColor)}, ${nullable(c.industry)}, ${c.followerCount})`,
    )
    .join(',\n');

  return [
    '-- §3.3. Fixture companies keep their hand-picked brand colour and follower count;',
    '-- board companies arrive with the domain that lets a crawler find them again.',
    'insert into public.companies (slug, name, domain, logo_url, logo_monogram, logo_color, industry, follower_count) values',
    rows,
    'on conflict (slug) do update set',
    '  name = excluded.name,',
    '  domain = excluded.domain,',
    '  logo_url = excluded.logo_url,',
    '  logo_monogram = excluded.logo_monogram,',
    '  logo_color = excluded.logo_color,',
    '  industry = excluded.industry;',
    '-- follower_count is deliberately not updated: phase 2 owns it, and a re-seed must not',
    '-- roll real follows back to the fixture number.',
  ].join('\n');
}

// ── job_sources ────────────────────────────────────────────────────────────────

function sourcesSql(boards: BoardEntry[]): string {
  const rows = boards
    .map(
      (board) =>
        `  (${quote(board.slug)}, ${quote(board.kind)}::public.ats_kind, ` +
        `${quote(boardUrlFor(board))}, ${quote(board.token)})`,
    )
    .join(',\n');

  return [
    '-- §4.2. The board list is a table, not a constant: §4.3 needs adding a company to be',
    '-- an insert and a takedown to be `enabled = false` plus a note.',
    'insert into public.job_sources (company_id, kind, board_url, board_token)',
    'select c.id, v.kind, v.board_url, v.board_token',
    '  from (values',
    rows,
    '  ) as v(company_slug, kind, board_url, board_token)',
    '  join public.companies c on c.slug = v.company_slug',
    'on conflict (kind, board_url) do update set',
    '  company_id = excluded.company_id,',
    '  board_token = excluded.board_token;',
    '-- `enabled` and `notes` are deliberately NOT updated. Re-running the seed must never',
    '-- re-enable a source that was switched off in response to a takedown request.',
  ].join('\n');
}

// ── fixture postings ───────────────────────────────────────────────────────────

const dictionary = compileDictionary(SKILLS.map((s) => ({ slug: s.slug, label: s.label, aliases: s.aliases })));

function jobsSql(companies: CompanySeed[]): string {
  const known = new Set(companies.map((company) => company.slug));

  const rows = mockJobs.flatMap((job) => {
    if (!known.has(job.companyId)) {
      throw new Error(`Fixture job ${job.id} points at unknown company "${job.companyId}"`);
    }

    const seniority = extractSeniority(job.title, job.description);
    const skills = extractSkills(dictionary, job.title, job.requirements, job.description);
    const quality = scoreQuality({
      title: job.title,
      descriptionText: job.description,
      requirements: job.requirements,
      skills,
      hasStructuredSalary: job.salaryMin !== null || job.salaryMax !== null,
      companyOpenPostings: mockJobs.filter((other) => other.companyId === job.companyId).length,
      seniority,
      hasCompanyDomain: true,
    });

    // The fixture states its own location type, which is more reliable than re-reading it
    // out of a string we wrote ourselves.
    const locations = parseLocations(job.location, [], job.locationType);

    return locations.map(
      (location) =>
        `  (${quote(job.companyId)}, ${quote(job.title)}, ${quote(normalizeTitle(job.title))}, ` +
        `${nullable(seniority)}, ${quote(location.raw)}, ${nullable(location.city)}, ` +
        `${nullable(location.region)}, ${nullable(location.country)}, ${quote(location.type)}, ` +
        `${quote(job.employmentType)}, ${numeric(job.salaryMin)}, ${numeric(job.salaryMax)}, ` +
        `${quote(job.salaryPeriod)}, ${quote(job.description)}, ${textArray(job.requirements)}, ` +
        `${textArray(skills)}, ${quote(job.applicationUrl)}, ${quote(job.postedAt)}, ${quality})`,
    );
  });

  return [
    '-- §2.2: "keep the fixtures working so local dev never needs a crawler".',
    '--',
    '-- These are the only jobs with a null `source_id`, which is what makes the delete',
    '-- below safe and what keeps the staleness sweep away from them: nothing crawls them,',
    '-- so their absence from a crawl means nothing.',
    'delete from public.jobs where source_id is null;',
    '',
    'insert into public.jobs (',
    '  company_id, company_name, title, title_normalized, seniority, location_raw,',
    '  location_city, location_region, location_country, location_type, employment_type,',
    '  salary_min, salary_max, salary_period, description_text, requirements, skills,',
    '  apply_url, posted_at, quality_score',
    ')',
    'select c.id, c.name, v.title, v.title_normalized,',
    '       nullif(v.seniority, \'\')::public.seniority_level, v.location_raw,',
    '       v.location_city, v.location_region, v.location_country,',
    '       v.location_type::public.location_type, v.employment_type::public.employment_type,',
    '       v.salary_min, v.salary_max, v.salary_period::public.salary_period,',
    '       v.description_text, v.requirements, v.skills, v.apply_url,',
    '       v.posted_at::timestamptz, v.quality_score',
    '  from (values',
    rows.join(',\n'),
    '  ) as v(company_slug, title, title_normalized, seniority, location_raw, location_city,',
    '         location_region, location_country, location_type, employment_type, salary_min,',
    '         salary_max, salary_period, description_text, requirements, skills, apply_url,',
    '         posted_at, quality_score)',
    '  join public.companies c on c.slug = v.company_slug',
    // Two fixtures at one company with the same normalized title and city would collide on
    // the partial unique index. Skipping the second is right: that is what the index means.
    'on conflict do nothing;',
  ].join('\n');
}

// ── write ──────────────────────────────────────────────────────────────────────

const companies = buildCompanies();

const header = [
  '-- Generated by scripts/generate-seed.ts — do not edit by hand.',
  '-- Regenerate with `npm run seed:generate`.',
  '--',
  '-- Loaded by `supabase db reset`. Everything here is reference data or fixture content:',
  '-- profiles and preferences are provisioned per signup by handle_auth_user_change(), and',
  '-- real postings come from `npm run ingest`.',
  '',
].join('\n');

const body = [
  schoolsSql(),
  skillsSql(),
  companiesSql(companies),
  sourcesSql(BOARDS),
  jobsSql(companies),
  [
    '-- open_job_count is maintained by the ingest run rather than by a trigger (see the',
    '-- migration), so the seed has to bring it up to date itself or suggested_companies()',
    '-- returns nothing on a freshly reset database.',
    'select public.refresh_open_job_counts();',
  ].join('\n'),
].join('\n\n');

const outputPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'seed.sql');
writeFileSync(outputPath, `${header}${body}\n`, 'utf8');

console.log(
  `Wrote ${outputPath}\n` +
    `  ${SKILLS.length} skills, ${companies.length} companies, ${BOARDS.length} job sources, ` +
    `${mockJobs.length} fixture postings`,
);
