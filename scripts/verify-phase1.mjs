/*
 * Checks phase 1's exit condition against the local stack:
 * "10k+ real postings from 100+ companies, feed and search work, dedup rate < 2%."
 *
 * Two kinds of check, deliberately separated:
 *
 *  - **Pipeline and authorization** run against fixtures and the live schema. They are
 *    deterministic, need no network, and pass on a freshly reset database. A regression in
 *    the migration, the RLS policies, the normalizers or the read API fails here.
 *  - **Corpus** checks query whatever is actually in the database. They fail on a fresh
 *    reset and pass after `npm run ingest`, which is the honest reading of the exit
 *    condition: the machinery is verifiable any time, the claim about 10,000 postings is
 *    only true once it has run.
 *
 *   npm run db:start
 *   npm run db:reset
 *   npm run ingest        # for the corpus half
 *   npm run verify:phase1
 *
 * Local only. It reads the fixed CLI demo keys and writes throwaway rows through the
 * service role — never point it at a real project.
 */

import { createClient } from '@supabase/supabase-js';

import { parseLocations } from '../server/src/ingest/normalize/location.ts';
import { parseSalary } from '../server/src/ingest/normalize/salary.ts';
import {
  extractEmploymentType,
  extractSeniority,
  normalizeTitle,
} from '../server/src/ingest/normalize/seniority.ts';
import { compileDictionary, extractSkills } from '../server/src/ingest/normalize/skills.ts';
import { scoreQuality } from '../server/src/ingest/normalize/quality.ts';
import { extractRequirements, htmlToText } from '../server/src/ingest/normalize/html.ts';
import { contentHash } from '../server/src/ingest/pipeline.ts';
import { ashby, greenhouse, lever } from '../server/src/ingest/sources/index.ts';
import { SKILLS } from './skills-dictionary.ts';

const API = 'http://127.0.0.1:54721';
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const anon = createClient(API, ANON, { auth: { persistSession: false } });
const admin = createClient(API, SERVICE, { auth: { persistSession: false } });

let failures = 0;
let softFailures = 0;

function check(label, passed, detail = '') {
  if (!passed) failures += 1;
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
}

/** A corpus claim. Reported, but does not fail the run before a crawl has happened. */
function corpus(label, passed, detail = '') {
  if (!passed) softFailures += 1;
  console.log(`${passed ? 'PASS' : 'MISS'}  ${label}${detail ? `  — ${detail}` : ''}`);
}

function section(title) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 66 - title.length))}`);
}

// ── schema and authorization ───────────────────────────────────────────────────

section('authorization');

{
  const [companies, jobs, skills] = await Promise.all([
    anon.from('companies').select('id').limit(1),
    anon.from('jobs').select('id').limit(1),
    anon.from('skills').select('slug').limit(1),
  ]);
  check('anon can read companies', !companies.error, companies.error?.message ?? '');
  check('anon can read jobs', !jobs.error, jobs.error?.message ?? '');
  check('anon can read skills', !skills.error, skills.error?.message ?? '');
}

for (const table of ['raw_postings', 'job_sources', 'crawl_runs', 'job_dedup_review']) {
  const result = await anon.from(table).select('*').limit(1);
  check(`anon cannot read ${table}`, Boolean(result.error), result.error?.code ?? 'no error');
}

{
  const insert = await anon.from('jobs').insert({ title: 'Hacked' });
  check('anon cannot insert a job', Boolean(insert.error), insert.error?.code ?? 'no error');

  const update = await anon.from('companies').update({ name: 'Hacked' }).eq('slug', 'stripe');
  check('anon cannot rename a company', Boolean(update.error), update.error?.code ?? 'no error');
}

// ── the closed-posting rule ────────────────────────────────────────────────────

section('closed postings');

{
  // A throwaway company so nothing here depends on, or disturbs, the real corpus.
  const stamp = Date.now();
  const { data: company, error: companyError } = await admin
    .from('companies')
    .insert({ slug: `verify-${stamp}`, name: `Verify Co ${stamp}`, domain: `verify-${stamp}.test` })
    .select('id')
    .single();
  check('service role can create a company', !companyError, companyError?.message ?? '');

  if (company) {
    const base = {
      company_id: company.id,
      company_name: `Verify Co ${stamp}`,
      location_type: 'Remote',
      employment_type: 'Internship',
      description_text: 'A verification posting.',
      apply_url: 'https://example.com/apply',
    };

    const { data: open } = await admin
      .from('jobs')
      .insert({ ...base, title: 'Open Role', title_normalized: `verify open ${stamp}` })
      .select('id, dedup_key')
      .single();

    const { data: closed } = await admin
      .from('jobs')
      .insert({
        ...base,
        title: 'Closed Role',
        title_normalized: `verify closed ${stamp}`,
        status: 'closed',
      })
      .select('id')
      .single();

    check('dedup_key is generated by the database', Boolean(open?.dedup_key), open?.dedup_key?.slice(0, 12) ?? '');

    const visible = await anon.from('jobs').select('id').eq('id', open?.id ?? '').maybeSingle();
    check('an open posting is visible to a reader', visible.data !== null);

    const hidden = await anon.from('jobs').select('id').eq('id', closed?.id ?? '').maybeSingle();
    check('a closed posting is invisible to a reader', hidden.data === null);

    const bySerice = await admin.from('jobs').select('id').eq('id', closed?.id ?? '').maybeSingle();
    check('the service role still resolves a closed posting', bySerice.data !== null);

    // Two open postings that differ only by seniority must both survive: the collision
    // that cost Anduril 523 real requisitions before seniority joined the dedup key.
    const intern = await admin.from('jobs').insert({
      ...base,
      title: 'Platform Engineer Intern',
      title_normalized: `verify platform ${stamp}`,
      seniority: 'intern',
    });
    const senior = await admin.from('jobs').insert({
      ...base,
      title: 'Senior Platform Engineer',
      title_normalized: `verify platform ${stamp}`,
      seniority: 'senior',
    });
    check('same title, different seniority → two rows', !intern.error && !senior.error, senior.error?.message ?? '');

    const clash = await admin.from('jobs').insert({
      ...base,
      title: 'Platform Engineer Intern (duplicate)',
      title_normalized: `verify platform ${stamp}`,
      seniority: 'intern',
    });
    check('same title, same seniority, same city → refused', Boolean(clash.error), clash.error?.code ?? 'no error');

    await admin.from('companies').delete().eq('id', company.id);
  }
}

// ── adapters, against recorded payloads ────────────────────────────────────────

section('adapters');

{
  const greenhouseBody = JSON.stringify({
    jobs: [
      {
        id: 4001,
        title: 'Software Engineer Intern, Compilers',
        updated_at: '2026-09-01T00:00:00Z',
        first_published: '2026-08-20T00:00:00Z',
        location: { name: 'Seattle, San Francisco, New York City' },
        offices: [{ name: 'US' }],
        absolute_url: 'https://boards.greenhouse.io/acme/jobs/4001',
        content: '&lt;p&gt;Build LLVM passes.&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Pursuing a BS in CS&lt;/li&gt;&lt;li&gt;Familiar with C++ and Rust&lt;/li&gt;&lt;/ul&gt;',
        pay_input_ranges: [{ min_cents: 5000, max_cents: 6500, currency_type: 'USD' }],
        departments: [{ name: 'Engineering' }],
      },
      { id: 4002, title: 'No location role', absolute_url: 'https://x.test/2', content: '&lt;p&gt;Hi&lt;/p&gt;' },
    ],
  });

  const ghPostings = greenhouse.extract(greenhouseBody);
  check('greenhouse extracts every posting', ghPostings.length === 2, String(ghPostings.length));

  const gh = greenhouse.parse(ghPostings[0]);
  check('greenhouse unescapes double-encoded HTML', gh.descriptionHtml?.startsWith('<p>') === true);
  check('greenhouse reads pay_input_ranges as cents', gh.salary?.min === 50 && gh.salary?.period === 'hour', JSON.stringify(gh.salary));
  check('greenhouse prefers first_published over updated_at', gh.postedAt?.startsWith('2026-08-20') === true, String(gh.postedAt));

  const leverBody = JSON.stringify([
    {
      id: 'lev-1',
      text: 'New Grad Software Engineer',
      hostedUrl: 'https://jobs.lever.co/acme/lev-1',
      applyUrl: 'https://jobs.lever.co/acme/lev-1/apply',
      createdAt: 1_756_000_000_000,
      categories: { commitment: 'Full-time', location: 'Austin, TX', team: 'Core', allLocations: ['Austin, TX', 'Remote'] },
      workplaceType: 'hybrid',
      descriptionPlain: 'Work on the core platform.',
      lists: [{ text: 'Requirements', content: '<li>Graduating in 2027</li><li>Comfortable with Go</li>' }],
      salaryRange: { min: 10000, max: 12000, currency: 'USD', interval: 'per-month-salary' },
    },
  ]);

  const lvPostings = lever.extract(leverBody);
  const lv = lever.parse(lvPostings[0]);
  check('lever reads a bare array', lvPostings.length === 1);
  check('lever trusts its own workplaceType', lv.workplaceHint === 'Hybrid', String(lv.workplaceHint));
  check('lever annualizes a monthly range', lv.salary?.min === 120000 && lv.salary?.period === 'year', JSON.stringify(lv.salary));
  check('lever reassembles description + lists', lv.descriptionText?.includes('Requirements') === true);

  const ashbyBody = JSON.stringify({
    jobs: [
      {
        id: 'ash-1',
        title: 'Staff Security Engineer',
        location: 'Remote',
        isRemote: true,
        isListed: true,
        employmentType: 'FullTime',
        publishedAt: '2026-09-10T00:00:00Z',
        descriptionPlain: 'Own cloud security.',
        applyUrl: 'https://jobs.ashbyhq.com/acme/ash-1/application',
        compensation: {
          compensationTiers: [
            {
              components: [
                { compensationType: 'Salary', interval: 'PER_YEAR', currencyCode: 'USD', minValue: 200000, maxValue: 280000 },
                { compensationType: 'EquityPercentage', minValue: 0.1, maxValue: 0.3 },
              ],
            },
          ],
        },
      },
      { id: 'ash-2', title: 'Unpublished', isListed: false },
    ],
  });

  const ashPostings = ashby.extract(ashbyBody);
  check('ashby drops unlisted postings', ashPostings.length === 1, String(ashPostings.length));

  const ash = ashby.parse(ashPostings[0]);
  check('ashby ignores the equity component', ash.salary?.max === 280000, JSON.stringify(ash.salary));
  check('ashby maps its own employment vocabulary', ash.employmentTypeHint === 'Full-time', String(ash.employmentTypeHint));
}

// ── content hashing ────────────────────────────────────────────────────────────

section('content hash');

{
  const a = { id: 1, title: 'Engineer', updated_at: '2026-01-01T00:00:00Z', nested: { b: 2, a: 1 } };
  const b = { nested: { a: 1, b: 2 }, title: 'Engineer', id: 1, updated_at: '2026-06-06T00:00:00Z' };
  const c = { ...a, title: 'Engineer II' };

  check('key order does not change the hash', contentHash(a) === contentHash(b));
  check('a volatile updated_at does not change the hash', contentHash(a) === contentHash(b));
  check('a real change does change the hash', contentHash(a) !== contentHash(c));
}

// ── normalizers ────────────────────────────────────────────────────────────────

section('locations');

const LOCATION_CASES = [
  ['Austin, TX', null, ['Austin, TX'], 'Onsite'],
  ['Seattle, San Francisco, New York City', null, ['Seattle', 'San Francisco', 'New York, NY'], null],
  ['SF NYC SEA CHI', null, ['San Francisco, CA', 'New York, NY', 'Seattle, WA', 'Chicago, IL'], null],
  ['Remote - US', null, ['Remote'], 'Remote'],
  ['Remote', null, ['Remote'], 'Remote'],
  ['Hybrid - Boston, MA', null, ['Boston, MA'], 'Hybrid'],
  ['Multiple Locations', null, null, 'Onsite'],
  ['Washington, D.C.', null, ['Washington, DC'], null],
  ['Dublin, Ireland', null, ['Dublin'], null],
  ['London', null, ['London'], null],
  ['Singapore Locations', null, ['Singapore'], null],
  ['San Francisco / New York', null, ['San Francisco', 'New York, NY'], null],
  ['Bay Area', null, ['San Francisco, CA'], null],
  ['United States', null, null, 'Onsite'],
];

for (const [input, hint, expectedLabels, expectedType] of LOCATION_CASES) {
  const parsed = parseLocations(input, [], hint);
  const labels = parsed.map((entry) => entry.raw);
  const okLabels = expectedLabels === null || expectedLabels.every((label) => labels.includes(label));
  const okType = expectedType === null || parsed[0]?.type === expectedType;
  check(`location: ${input}`, okLabels && okType, labels.join(' | '));
}

check(
  'multi-location fan-out is capped at 6',
  parseLocations('A, B, C, D, E, F, G, H', []).length <= 6,
  String(parseLocations('A, B, C, D, E, F, G, H', []).length),
);
check(
  'a city-level row wins over a country-level one',
  parseLocations('Dublin', ['Ireland']).length === 1,
  parseLocations('Dublin', ['Ireland']).map((l) => l.raw).join(' | '),
);
check(
  'an unparseable location still yields a row',
  parseLocations('Somewhere Peculiar Indeed Truly', []).length === 1,
);

section('salaries');

const SALARY_CASES = [
  ['The base pay range for this position is $120,000 - $150,000 per year.', 120000, 150000, 'year'],
  ['Salary range: 120k-150k annually', 120000, 150000, 'year'],
  ['Compensation: $58/hr', 58, 58, 'hour'],
  ['The hourly rate is $45 - $62 per hour for this internship.', 45, 62, 'hour'],
  ['Expected salary $140,000 per year', 140000, 140000, 'year'],
  ['We raised $500,000,000 in Series C funding.', null, null, null],
  ['You will work 40 hours per week alongside 200 employees.', null, null, null],
  ['Applications close in 2026. Summer 2026 internship.', null, null, null],
];

for (const [text, min, max, period] of SALARY_CASES) {
  const parsed = parseSalary(null, text);
  const ok =
    min === null
      ? parsed === null
      : parsed !== null && parsed.min === min && parsed.max === max && parsed.period === period;
  check(`salary: ${text.slice(0, 52)}`, ok, parsed ? `${parsed.min}-${parsed.max}/${parsed.period}` : 'null');
}

check('a structured range beats the description', parseSalary({ min: 90, max: 110, period: 'hour', currency: 'USD' }, 'Base pay range is $1 - $2 per year.')?.min === 90);
check('salary_is_estimated is never true in phase 1', parseSalary(null, 'The base pay range is $120,000 - $150,000.')?.isEstimated === false);

section('seniority, employment type and titles');

const SENIORITY_CASES = [
  ['Software Engineer Intern', 'intern'],
  ['2027 Summer Analyst', 'intern'],
  ['Engineering Co-op (Winter 2027)', 'intern'],
  ['New Grad Software Engineer', 'new_grad'],
  ['Software Engineer I', 'new_grad'],
  ['Senior Backend Engineer', 'senior'],
  ['Staff Machine Learning Engineer', 'staff_plus'],
  ['VP of Engineering', 'staff_plus'],
  ['Software Engineer II', 'mid'],
];

for (const [title, expected] of SENIORITY_CASES) {
  const actual = extractSeniority(title, '');
  check(`seniority: ${title}`, actual === expected, String(actual));
}

check('an intern title forces Internship', extractEmploymentType('Full-time', 'SWE Intern', 'intern') === 'Internship');
check('an ATS hint is trusted', extractEmploymentType('Contract', 'Data Analyst', null) === 'Contract');
check('an unlabelled role defaults to Full-time', extractEmploymentType(null, 'Data Analyst', null) === 'Full-time');

const TITLE_CASES = [
  ['Senior Software Engineer II, Platform (Remote) - Req #12345', 'software engineer platform'],
  ['Software Engineer Intern', 'software engineer'],
  ['Intern', 'intern'],
];

for (const [title, expected] of TITLE_CASES) {
  const actual = normalizeTitle(title);
  check(`title: ${title}`, actual === expected, actual);
}

check(
  'the year survives normalization (cohorts are different jobs)',
  normalizeTitle('2026 Early Career Engineer') !== normalizeTitle('2027 Early Career Engineer'),
  `${normalizeTitle('2026 Early Career Engineer')} vs ${normalizeTitle('2027 Early Career Engineer')}`,
);

section('skills and quality');

{
  const dictionary = compileDictionary(SKILLS);

  const tagged = extractSkills(dictionary, 'Machine Learning Intern', ['Experience with Go and React.js'], 'You will train models in PyTorch.');
  check('an alias resolves to its label', tagged.includes('React'), tagged.join(','));
  check('a phrase beats its parts', tagged.includes('Machine Learning'), tagged.join(','));
  check('an ambiguous word matches in the requirements', tagged.includes('Go'), tagged.join(','));

  const prose = extractSkills(dictionary, 'Account Executive', [], 'You will go to market, excel at outreach, and drive net new revenue.');
  check('an ambiguous word does NOT match in prose', !prose.includes('Go') && !prose.includes('Excel') && !prose.includes('.NET'), prose.join(','));

  const embedded = extractSkills(dictionary, 'Product Manager', [], 'We build embedded finance products with strong performance.');
  check('a slug is not a search term', !embedded.includes('Embedded Systems'), embedded.join(','));

  const junk = scoreQuality({
    title: 'WORK FROM HOME $$$ MULTIPLE POSITIONS',
    descriptionText: 'Apply now!',
    requirements: [],
    skills: [],
    hasStructuredSalary: false,
    companyOpenPostings: 1,
    seniority: null,
    hasCompanyDomain: false,
  });
  check('spam scores below the feed floor', junk <= 0.3, String(junk));

  const good = scoreQuality({
    title: 'Software Engineer Intern',
    descriptionText: 'x'.repeat(1200),
    requirements: ['a', 'b'],
    skills: ['Python', 'Go', 'SQL'],
    hasStructuredSalary: true,
    companyOpenPostings: 40,
    seniority: 'intern',
    hasCompanyDomain: true,
  });
  check('a real posting scores well above it', good > 0.6, String(good));

  const staff = scoreQuality({
    title: 'Staff Engineer',
    descriptionText: 'x'.repeat(1200),
    requirements: ['a'],
    skills: ['Go', 'Kubernetes', 'AWS'],
    hasStructuredSalary: true,
    companyOpenPostings: 40,
    seniority: 'staff_plus',
    hasCompanyDomain: true,
  });
  check('seniority is not scored down — it is filtered at read time', staff > 0.6, String(staff));
}

section('html');

{
  const text = htmlToText('<p>Intro</p><ul><li>Pursuing a BS in Computer Science</li><li>Comfortable with Python</li></ul><script>alert(1)</script>');
  check('block elements become line breaks', text.includes('\n• Pursuing'), JSON.stringify(text.slice(0, 40)));
  check('script content is dropped', !text.includes('alert'), text);

  const requirements = extractRequirements(
    'About us\n\nRequirements\n• Pursuing a BS in Computer Science\n• Comfortable with Python and Go\n\nBenefits\n• Free lunch every day',
  );
  check('requirements come from the right list', requirements.length === 2, JSON.stringify(requirements));
  check('benefits are not mistaken for requirements', !requirements.join(' ').includes('lunch'));
}

// ── feed and search ────────────────────────────────────────────────────────────

section('feed');

{
  const page1 = await anon.rpc('feed_jobs', { p_sort: 'recent', p_limit: 5 });
  check('the feed returns rows', !page1.error && (page1.data?.length ?? 0) > 0, page1.error?.message ?? `${page1.data?.length} rows`);

  if ((page1.data?.length ?? 0) === 5) {
    const cursor = page1.data.at(-1).page_cursor;
    const page2 = await anon.rpc('feed_jobs', { p_sort: 'recent', p_limit: 5, p_cursor: cursor });

    const ids1 = new Set(page1.data.map((row) => row.id));
    const overlap = (page2.data ?? []).filter((row) => ids1.has(row.id));
    check('page 2 does not repeat page 1', overlap.length === 0, `${overlap.length} repeated`);
    check('page 2 continues in order', new Date(page2.data?.[0]?.posted_at ?? 0) <= new Date(page1.data.at(-1).posted_at));

    const garbage = await anon.rpc('feed_jobs', { p_sort: 'recent', p_limit: 5, p_cursor: 'not-a-cursor' });
    check('a mangled cursor pages from the start', !garbage.error && garbage.data?.[0]?.id === page1.data[0].id);
  }

  const envelope = page1.data?.[0];
  check(
    'the job payload carries its company',
    Boolean(envelope?.company_slug && envelope?.company_name),
    `${envelope?.company_slug}`,
  );

  const recent = await anon.rpc('feed_jobs', { p_sort: 'recent', p_limit: 20 });
  const dates = (recent.data ?? []).map((row) => new Date(row.posted_at).getTime());
  check('recent sort is ordered', dates.every((value, index) => index === 0 || dates[index - 1] >= value));

  const salary = await anon.rpc('feed_jobs', { p_sort: 'salary', p_limit: 20 });
  const pay = (salary.data ?? []).map((row) =>
    row.salary_max === null && row.salary_min === null
      ? -1
      : Number(row.salary_max ?? row.salary_min) * (row.salary_period === 'hour' ? 2080 : 1),
  );
  check('salary sort annualizes hourly rates', pay.every((value, index) => index === 0 || pay[index - 1] >= value), pay.slice(0, 3).join(' > '));

  const byCompany = await anon.rpc('feed_jobs', { p_sort: 'company', p_limit: 20 });
  const names = (byCompany.data ?? []).map((row) => row.company_name);
  check('company sort is alphabetical', names.every((value, index) => index === 0 || names[index - 1] <= value), names.slice(0, 3).join(' < '));

  const filtered = await anon.rpc('feed_jobs', { p_sort: 'recent', p_limit: 20, p_company_slugs: ['stripe'] });
  check(
    'the company filter filters',
    (filtered.data ?? []).every((row) => row.company_slug === 'stripe'),
    `${filtered.data?.length} rows`,
  );

  const lowQuality = await admin
    .from('jobs')
    .select('id', { count: 'exact', head: true })
    .lte('quality_score', 0.3)
    .eq('status', 'open');
  const inFeed = await anon.rpc('feed_jobs', { p_sort: 'recent', p_limit: 50 });
  check(
    'junk is below the feed floor',
    (inFeed.data ?? []).every((row) => row.quality_score > 0.3),
    `${lowQuality.count ?? 0} low-quality rows exist and none are in the feed`,
  );
}

section('search');

{
  const engineer = await anon.rpc('search_jobs', { p_query: 'software engineer', p_limit: 10 });
  check('a full-text query returns ranked rows', !engineer.error && (engineer.data?.length ?? 0) > 0, engineer.error?.message ?? `${engineer.data?.length} rows`);
  check('search results carry a rank', typeof engineer.data?.[0]?.rank === 'number');

  const short = await anon.rpc('search_jobs', { p_query: 'en', p_limit: 5 });
  check('a two-character query takes the prefix path', !short.error, short.error?.message ?? `${short.data?.length} rows`);

  const tooShort = await anon.rpc('search_jobs', { p_query: 'e', p_limit: 5 });
  check('a one-character query returns nothing', (tooShort.data?.length ?? 0) === 0);

  const nonsense = await anon.rpc('search_jobs', { p_query: '!!! "" &&& |', p_limit: 5 });
  check('punctuation does not raise', !nonsense.error, nonsense.error?.message ?? '');

  const typo = await anon.rpc('search_companies', { p_query: 'stipe' });
  check(
    'company search tolerates a transposed character',
    (typo.data ?? []).some((row) => row.slug === 'stripe'),
    (typo.data ?? []).map((row) => row.slug).join(',') || 'no rows',
  );

  const exact = await anon.rpc('search_companies', { p_query: 'Databricks' });
  check('an exact company name ranks first', exact.data?.[0]?.slug === 'databricks', String(exact.data?.[0]?.slug));

  const suggested = await anon.rpc('suggested_companies', { p_limit: 12 });
  check('suggested companies all have open roles', (suggested.data ?? []).every((row) => row.open_job_count > 0), `${suggested.data?.length} rows`);
}

// ── staleness ──────────────────────────────────────────────────────────────────

section('staleness');

{
  const stamp = Date.now();
  const { data: company } = await admin
    .from('companies')
    .insert({ slug: `stale-${stamp}`, name: `Stale Co ${stamp}`, domain: `stale-${stamp}.test` })
    .select('id')
    .single();

  const { data: healthy } = await admin
    .from('job_sources')
    .insert({
      company_id: company.id,
      kind: 'greenhouse',
      board_url: `https://boards.greenhouse.io/stale-${stamp}-ok`,
      last_success_at: new Date().toISOString(),
      consecutive_failures: 0,
    })
    .select('id')
    .single();

  const { data: broken } = await admin
    .from('job_sources')
    .insert({
      company_id: company.id,
      kind: 'lever',
      board_url: `https://jobs.lever.co/stale-${stamp}-bad`,
      last_success_at: new Date().toISOString(),
      consecutive_failures: 3,
    })
    .select('id')
    .single();

  const threeDaysAgo = new Date(Date.now() - 72 * 3_600_000).toISOString();
  const base = {
    company_id: company.id,
    company_name: `Stale Co ${stamp}`,
    location_type: 'Remote',
    employment_type: 'Full-time',
    description_text: 'x',
    apply_url: 'https://example.com',
    last_seen_at: threeDaysAgo,
  };

  const { data: doomed } = await admin
    .from('jobs')
    .insert({ ...base, source_id: healthy.id, title: 'Gone', title_normalized: `stale gone ${stamp}` })
    .select('id')
    .single();

  const { data: spared } = await admin
    .from('jobs')
    .insert({ ...base, source_id: broken.id, title: 'Spared', title_normalized: `stale spared ${stamp}` })
    .select('id')
    .single();

  const { data: orphan } = await admin
    .from('jobs')
    .insert({ ...base, source_id: null, title: 'Fixture', title_normalized: `stale fixture ${stamp}` })
    .select('id')
    .single();

  await admin.rpc('close_stale_jobs', { p_unseen_hours: 48 });

  const after = await admin.from('jobs').select('id, status').in('id', [doomed.id, spared.id, orphan.id]);
  const statusOf = (id) => after.data?.find((row) => row.id === id)?.status;

  check('a posting unseen for 72h is closed', statusOf(doomed.id) === 'closed', String(statusOf(doomed.id)));
  check('a failing source does not close its board', statusOf(spared.id) === 'open', String(statusOf(spared.id)));
  check('a sourceless fixture is never swept', statusOf(orphan.id) === 'open', String(statusOf(orphan.id)));

  await admin.from('companies').delete().eq('id', company.id);
  await admin.rpc('refresh_open_job_counts');
}

// ── the exit condition ─────────────────────────────────────────────────────────

section('corpus (needs `npm run ingest`)');

{
  const jobs = await admin.from('jobs').select('id', { count: 'exact', head: true }).eq('status', 'open');
  corpus('10,000+ open postings', (jobs.count ?? 0) >= 10_000, `${jobs.count ?? 0}`);

  const companies = await admin
    .from('companies')
    .select('id', { count: 'exact', head: true })
    .gt('open_job_count', 0);
  corpus('100+ companies with open roles', (companies.count ?? 0) >= 100, `${companies.count ?? 0}`);

  const { data: runs } = await admin
    .from('crawl_runs')
    .select('jobs_created, jobs_updated, collapsed, duplicates')
    .eq('status', 'success');

  const totals = (runs ?? []).reduce(
    (sum, run) => ({
      created: sum.created + run.jobs_created,
      updated: sum.updated + run.jobs_updated,
      collapsed: sum.collapsed + run.collapsed,
      duplicates: sum.duplicates + run.duplicates,
    }),
    { created: 0, updated: 0, collapsed: 0, duplicates: 0 },
  );

  const attempts = totals.created + totals.updated + totals.collapsed + totals.duplicates;
  const dedupRate = attempts > 0 ? (totals.duplicates / attempts) * 100 : 0;
  const collapseRate = attempts > 0 ? (totals.collapsed / attempts) * 100 : 0;

  corpus(
    'cross-source dedup rate < 2%',
    attempts === 0 || dedupRate < 2,
    `${dedupRate.toFixed(2)}% of ${attempts} reconcile attempts`,
  );
  console.log(
    `      employer re-posts collapsed by the key: ${collapseRate.toFixed(2)}% ` +
      `(${totals.collapsed}/${attempts}) — their behaviour, not a defect`,
  );

  // A head count, not a row fetch: `max_rows = 1000` in supabase/config.toml caps a
  // select, so counting the returned rows silently reports 1000 for anything larger and
  // this check quietly became "is the queue at least 1000 long".
  const review = await admin
    .from('job_dedup_review')
    .select('id', { count: 'exact', head: true })
    .eq('resolution', 'pending');
  const pending = review.count ?? 0;
  const openJobs = jobs.count ?? 1;
  corpus(
    'the near-miss review queue is not runaway',
    pending / Math.max(openJobs, 1) < 0.02,
    `${pending} pending over ${openJobs} postings`,
  );

  const { data: sources } = await admin.from('job_sources').select('enabled, consecutive_failures');
  const healthy = (sources ?? []).filter((s) => s.enabled && s.consecutive_failures === 0).length;
  corpus('most sources are healthy', healthy >= (sources?.length ?? 0) * 0.8, `${healthy}/${sources?.length ?? 0}`);
}

// ── result ─────────────────────────────────────────────────────────────────────

console.log('');
if (failures === 0 && softFailures === 0) {
  console.log('Phase 1 verified.');
} else if (failures === 0) {
  console.log(
    `Pipeline verified. ${softFailures} corpus claim(s) not yet met — run \`npm run ingest\` and re-run.`,
  );
} else {
  console.log(`${failures} check(s) failed.`);
}

process.exit(failures === 0 ? 0 : 1);
