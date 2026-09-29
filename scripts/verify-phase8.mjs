/*
 * Checks phase 8's exit condition against the local stack — docs/PHASE8.md:
 * "a CS student looking for an internship sees software, data and ML internships posted in
 *  the last month, with room left for exploration."
 *
 *   npm run db:start
 *   npm run db:reset          (or `npx supabase migration up --local`)
 *   npm run verify:phase8
 *
 * Deterministic and self-cleaning, like phases 2–7. No API service is needed.
 *
 * Local only. It uses the fixed CLI demo keys and writes throwaway rows through the service
 * role — never point it at a real project.
 */

import { createClient } from '@supabase/supabase-js';
import { classifyFamily } from '../server/src/ingest/normalize/family.ts';

const API = 'http://127.0.0.1:54721';
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const admin = createClient(API, SERVICE, { auth: { persistSession: false } });

let failures = 0;
function check(label, passed, detail = '') {
  if (!passed) failures += 1;
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
}
function section(title) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 66 - title.length))}`);
}
const same = (a, b) => JSON.stringify([...(a ?? [])].sort()) === JSON.stringify([...(b ?? [])].sort());

const stamp = Date.now();
const cleanup = [];
const DAY = 86_400_000;
const thisYear = new Date().getFullYear();

async function main() {
  // ── the classifier ───────────────────────────────────────────────────────────

  section('job families (server/src/ingest/normalize/family.ts)');

  // Real titles from the hosted corpus on 2026-09-29, including the ones that exposed a rule order.
  const TITLES = [
    ['Software Engineer Intern', 'software'],
    ['Backend Engineer, Payments', 'software'],
    ['Data Science Intern', 'data_ml'],
    ['Machine Learning Engineer', 'data_ml'],
    ['Data Engineering Intern', 'data_ml'],
    ['Quantitative Trading Intern', 'data_ml'],
    ['Account Executive, AI Platform', 'sales_marketing'],      // the role, not the product
    ['Data Center Technician', 'hardware'],                      // not "data"
    ['FPGA Designer Co-op', 'hardware'],                         // chip design is EE
    ['Digital IC Design Intern', 'hardware'],
    ['Embedded Software Engineer Intern', 'hardware'],
    ['Mechanical Engineering Intern', 'hardware'],
    ['Product Designer', 'design'],                              // design before product
    ['Product Manager, Platform', 'product'],                    // product before software
    ['Technical Program Manager', 'product'],
    ['Strategic Finance Intern', 'business'],
    ['Product Marketing Manager, Payments', 'sales_marketing'],
    ['Recruiting Coordinator', 'operations'],
    ['Buyer, Commercial Hardware Procurement', 'operations'],
    ['Methods Engineering Intern', null],                        // "engineering" alone names no field
    ['Associate', null],
  ];
  for (const [title, expected] of TITLES) {
    const got = classifyFamily(title);
    check(`${title} → ${expected ?? 'unclassified'}`, got === expected, `${got}`);
  }
  check('skills break a tie only with two votes',
    classifyFamily('Technology Intern', ['python', 'react']) === 'software' &&
      classifyFamily('Technology Intern', ['excel']) === null);

  // ── fixtures ─────────────────────────────────────────────────────────────────

  section('fixtures');

  /*
   * Six companies, dealt round-robin. With one, phase 5's diversity rule (at most 2 cards per
   * company in any 10) would drop most of the fixtures from the session, and the ordering
   * checks below would be measuring the diversity pass rather than fieldMatch.
   */
  const companies = await admin.from('companies')
    .insert([0, 1, 2, 3, 4, 5].map((n) => ({ slug: `p8-co${n}-${stamp}`, name: `P8 Co${n} ${stamp}` })))
    .select('id, name');
  if (companies.error) {
    console.error(`\nCould not create the fixture companies: ${companies.error.message}`);
    console.error('Is `npm run db:start` running, with every migration applied?');
    process.exit(1);
  }
  for (const c of companies.data) cleanup.push(() => admin.from('companies').delete().eq('id', c.id));
  const company = { data: companies.data[0] };

  // One city per posting, so phase 1's dedup key keeps every one of them a separate row.
  let city = 0;
  const job = (title, family, seniority, ageDays, type = 'Internship') => ({
    company_id: companies.data[city % companies.data.length].id,
    company_name: companies.data[city % companies.data.length].name,
    title,
    title_normalized: title.toLowerCase(),
    seniority,
    job_family: family,
    location_type: 'Onsite',
    location_city: `P8 City ${stamp} ${city++}`,
    employment_type: type,
    quality_score: 0.8,
    posted_at: new Date(Date.now() - ageDays * DAY).toISOString(),
    description_text: 'A posting that exists only for verify:phase8.',
    apply_url: `https://example.invalid/${stamp}/${city}`,
  });

  const rows = [
    ...[1, 2, 3, 4, 5].map((d) => job(`P8 Software Engineer Intern ${d}`, 'software', 'intern', d)),
    ...[2, 4, 6].map((d) => job(`P8 Data Science Intern ${d}`, 'data_ml', 'intern', d)),
    ...[1, 3, 5, 7].map((d) => job(`P8 Marketing Intern ${d}`, 'sales_marketing', 'intern', d)),
    job('P8 Software Engineer Intern stale', 'software', 'intern', 90),       // outside even 60 days
    job('P8 Software Engineer Intern older', 'software', 'intern', 45),       // inside only once widened
    job('P8 Software Engineer mid', 'software', 'mid', 2, 'Full-time'),       // wrong level for a sophomore
    job('P8 Operations Intern unclassified', null, 'intern', 2),
  ];
  const inserted = await admin.from('jobs').insert(rows).select('id, title, job_family, seniority');
  if (inserted.error) {
    console.error(`\nCould not create the fixture postings: ${inserted.error.message}`);
    process.exit(1);
  }
  check(`${rows.length} fixture postings`, inserted.data.length === rows.length);
  const byTitle = Object.fromEntries(inserted.data.map((j) => [j.title, j]));

  async function account(label) {
    const email = `verify-phase8-${label}-${stamp}@example.com`;
    const password = `verify-phase8-${stamp}-${label}`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error) throw new Error(`createUser(${label}): ${created.error.message}`);
    cleanup.push(() => admin.auth.admin.deleteUser(created.data.user.id));
    const client = createClient(API, ANON, { auth: { persistSession: false } });
    const session = await client.auth.signInWithPassword({ email, password });
    if (session.error) throw new Error(`signIn(${label}): ${session.error.message}`);
    return { id: created.data.user.id, client };
  }

  const cs = await account('cs');          // says: student, CS major
  const mkt = await account('mkt');        // says: marketing, in onboarding
  const blank = await account('blank');    // says nothing
  const senior = await account('senior');  // graduation year only, three years out
  const switcher = await account('switch');// "Early in my career, looking to switch"

  await admin.from('profiles').update({ major: 'B.S. Computer Science' }).eq('id', cs.id);
  await admin.from('user_preferences')
    .update({ career_stage: 'student_intern', preferred_employment_types: ['Internship'] }).eq('user_id', cs.id);
  await admin.from('user_preferences').update({ preferred_industries: ['marketing'] }).eq('user_id', mkt.id);
  await admin.from('profiles').update({ graduation_year: thisYear + 3 }).eq('id', senior.id);
  await admin.from('user_preferences').update({ career_stage: 'early_career' }).eq('user_id', switcher.id);

  // ── what the deck knows about a student ──────────────────────────────────────

  section('fields and stage (PHASE8.md §3)');

  const fam = async (who) => (await admin.rpc('user_job_families', { p_user_id: who.id })).data;
  const sen = async (who) => (await admin.rpc('target_seniorities', { p_user_id: who.id })).data;

  check('a CS major means software and data', same(await fam(cs), ['data_ml', 'software']), JSON.stringify(await fam(cs)));
  check('onboarding\'s "Marketing" means sales and marketing', same(await fam(mkt), ['sales_marketing']),
    JSON.stringify(await fam(mkt)));
  check('saying nothing means no field filter (null, not empty)', (await fam(blank)) === null,
    JSON.stringify(await fam(blank)));

  check('"Student, looking for an internship" means interns', same(await sen(cs), ['intern']), JSON.stringify(await sen(cs)));
  check('a graduation year three years out means interns, with no stage set', same(await sen(senior), ['intern']),
    JSON.stringify(await sen(senior)));
  check('an early-career switcher sees new-grad and mid roles', same(await sen(switcher), ['new_grad', 'mid']),
    JSON.stringify(await sen(switcher)));
  check('saying nothing means no level filter', (await sen(blank)) === null, JSON.stringify(await sen(blank)));

  const mine = await cs.client.rpc('my_deck_profile');
  check('a student can read what the deck believes about them',
    !mine.error && same(mine.data?.families, ['data_ml', 'software']) && mine.data?.stage === 'student_intern',
    mine.error?.message ?? JSON.stringify(mine.data));
  const pry = await cs.client.rpc('user_job_families', { p_user_id: mkt.id });
  check('but not what it believes about anyone else', Boolean(pry.error), pry.error?.code ?? 'callable');

  // ── retrieval ────────────────────────────────────────────────────────────────

  section('candidate pool (PHASE8.md §4.1)');

  const pool = await admin.rpc('personal_candidate_pool', { p_user_id: cs.id, p_limit: 600 });
  check('the pool builds', !pool.error, pool.error?.message);
  const inPool = new Map((pool.data ?? []).map((r) => [r.job_id, r.source]));
  const has = (title) => inPool.has(byTitle[title].id);

  check('in-field internships from this month are in', [1, 2, 3, 4, 5].every((d) => has(`P8 Software Engineer Intern ${d}`)) &&
    [2, 4, 6].every((d) => has(`P8 Data Science Intern ${d}`)));
  check('a mid-level role is out for a sophomore', !has('P8 Software Engineer mid'));
  check('a 90-day-old posting is out', !has('P8 Software Engineer Intern stale'));
  check('the window widens to 60 days when fewer than 150 fit (a local stack is always thin)',
    has('P8 Software Engineer Intern older'));
  check('out-of-field internships still arrive, through the explore arm',
    [1, 3, 5, 7].some((d) => inPool.get(byTitle[`P8 Marketing Intern ${d}`].id) === 'explore'),
    [1, 3, 5, 7].map((d) => inPool.get(byTitle[`P8 Marketing Intern ${d}`].id) ?? 'absent').join(','));

  const control = await admin.rpc('candidate_pool', { p_user_id: cs.id, p_limit: 600 });
  check('phase 5\'s pool, which the A/B control reads, is untouched (no fit or explore arm)',
    !control.error && !(control.data ?? []).some((r) => r.source === 'fit' || r.source === 'explore'),
    control.error?.message);

  // ── the session ──────────────────────────────────────────────────────────────

  section('the deck (PHASE8.md §4.2)');

  // An experiment that does not exist is not running, and experiment_arm() then answers
  // "ranked" for everyone — so this builds the ranked arm whichever bucket the account hashed to.
  const built = await admin.rpc('build_feed_session', {
    p_user_id: cs.id, p_surface: 'reels', p_size: 200, p_experiment: `verify-phase8-${stamp}`,
  });
  check('a ranked session builds', !built.error, built.error?.message);

  const session = await admin.from('feed_sessions').select('job_ids, components, arm').eq('id', built.data).single();
  const ours = (session.data?.job_ids ?? []).filter((id) => inserted.data.some((j) => j.id === id));
  const familyOf = (id) => inserted.data.find((j) => j.id === id)?.job_family;
  const position = (id) => ours.indexOf(id);

  check('the session is the ranked arm', session.data?.arm === 'ranked', session.data?.arm);
  check('every card carries fieldMatch', ours.every((id) => session.data.components[id]?.fieldMatch !== undefined));

  const inField = ours.filter((id) => ['software', 'data_ml'].includes(familyOf(id)));
  const outField = ours.filter((id) => familyOf(id) === 'sales_marketing');
  const avg = (ids) => ids.reduce((s, id) => s + position(id), 0) / Math.max(ids.length, 1);
  check('the top of the deck is in-field', ours.slice(0, 5).every((id) => ['software', 'data_ml'].includes(familyOf(id))),
    ours.slice(0, 5).map(familyOf).join(','));
  check('in-field cards rank above out-of-field ones on average', avg(inField) < avg(outField),
    `${avg(inField).toFixed(1)} vs ${avg(outField).toFixed(1)}`);
  check('out-of-field cards are lowered, not removed', outField.length > 0, `${outField.length}`);

  const blankSession = await admin.rpc('build_feed_session', {
    p_user_id: blank.id, p_surface: 'reels', p_size: 200, p_experiment: `verify-phase8-${stamp}`,
  });
  const blankRow = await admin.from('feed_sessions').select('components').eq('id', blankSession.data).single();
  const anyCard = Object.values(blankRow.data?.components ?? {})[0] ?? {};
  check('a student with no fields is not scored on them (renormalized away)',
    !blankSession.error && anyCard.fieldMatch === undefined, JSON.stringify(anyCard));

  // ── the resume fills the blanks ──────────────────────────────────────────────

  section('major from the resume (decision A)');

  async function parsedResume(who, education) {
    const resume = await admin.from('resumes').insert({
      user_id: who.id, name: 'Verify Resume', storage_path: `${who.id}/verify-phase8-${stamp}.pdf`, is_default: true,
    }).select('id').single();
    if (resume.error) throw new Error(`resume: ${resume.error.message}`);
    const saved = await admin.rpc('save_resume_profile', {
      p_resume_id: resume.data.id, p_parser_version: 'verify-phase8', p_skills: ['python'],
      p_seniority: 'intern', p_education: education,
    });
    if (saved.error) throw new Error(`save_resume_profile: ${saved.error.message}`);
    return resume.data.id;
  }

  const blankResume = await parsedResume(blank, [
    { school: 'Old High', degree: null, field: null, graduationYear: 2022 },
    { school: 'State University', degree: 'B.S.', field: 'Statistics', graduationYear: thisYear + 2 },
  ]);
  const confirmed = await blank.client.rpc('confirm_resume_profile', { p_resume_id: blankResume });
  check('confirming works', !confirmed.error, confirmed.error?.message);

  const filled = await admin.from('profiles').select('major, graduation_year').eq('id', blank.id).single();
  check('a blank major is filled from the most recent degree', filled.data?.major === 'Statistics', filled.data?.major);
  check('and a blank graduation year with it', filled.data?.graduation_year === thisYear + 2,
    `${filled.data?.graduation_year}`);
  check('which the deck now reads: statistics means data', same(await fam(blank), ['data_ml']),
    JSON.stringify(await fam(blank)));

  const answers = await blank.client.from('application_answers').select('degree, field_of_study, sources').single();
  check('the application answers are prefilled and say where from',
    answers.data?.degree === 'B.S.' && answers.data?.field_of_study === 'Statistics' &&
      answers.data?.sources?.degree === 'resume',
    JSON.stringify(answers.data));

  const csResume = await parsedResume(cs, [
    { school: 'State University', degree: 'B.A.', field: 'Economics', graduationYear: thisYear + 2 },
  ]);
  await cs.client.rpc('confirm_resume_profile', { p_resume_id: csResume });
  const kept = await admin.from('profiles').select('major').eq('id', cs.id).single();
  check('a major the student typed is never overwritten', kept.data?.major === 'B.S. Computer Science', kept.data?.major);
  check('but the resume\'s field still counts toward the deck (a union, not a precedence)',
    same(await fam(cs), ['business', 'data_ml', 'software']), JSON.stringify(await fam(cs)));

  // ── application answers are private ──────────────────────────────────────────

  section('application answers (PHASE8.md §5)');

  const wrote = await cs.client.from('application_answers').upsert({
    user_id: cs.id, work_authorized_us: true, needs_sponsorship: false, linkedin_url: 'https://linkedin.com/in/cs',
  });
  check('a student saves their own answers', !wrote.error, wrote.error?.message);

  const peek = await mkt.client.from('application_answers').select('*').eq('user_id', cs.id);
  check('another student cannot read them', !peek.error && (peek.data ?? []).length === 0,
    peek.error?.message ?? `${(peek.data ?? []).length} rows`);

  const forge = await mkt.client.from('application_answers').insert({ user_id: cs.id, needs_sponsorship: true });
  check('or write them', Boolean(forge.error), forge.error?.code ?? 'the insert succeeded');

  const badLink = await cs.client.from('application_answers').update({ github_url: 'javascript:alert(1)' }).eq('user_id', cs.id);
  check('a link has to be a web link', Boolean(badLink.error), badLink.error?.code ?? 'accepted');

  const anonRead = await createClient(API, ANON, { auth: { persistSession: false } })
    .from('application_answers').select('*');
  check('and signed-out readers see nothing', Boolean(anonRead.error) || (anonRead.data ?? []).length === 0);

  // ── ingest carries the family ────────────────────────────────────────────────

  section('ingest (ingest_upsert_job)');

  const posting = {
    company_id: company.data.id, company_name: company.data.name, source_id: null,
    external_id: `p8-${stamp}`, title: 'P8 Ingested Data Science Intern',
    title_normalized: `p8 ingested data science intern ${stamp}`, seniority: 'intern',
    location_city: `P8 Ingest ${stamp}`, location_type: 'Onsite', employment_type: 'Internship',
    description_text: 'verify:phase8', requirements: [], skills: [], quality_score: 0.7,
    apply_url: `https://example.invalid/${stamp}/ingest`, job_family: 'data_ml',
  };
  const first = await admin.rpc('ingest_upsert_jobs', { p_rows: [posting] });
  check('a posting is stored', !first.error && first.data?.created === 1, first.error?.message ?? JSON.stringify(first.data));
  const stored = await admin.from('jobs').select('id, job_family').eq('title_normalized', posting.title_normalized).single();
  cleanup.push(() => admin.from('jobs').delete().eq('id', stored.data?.id));
  check('with its family', stored.data?.job_family === 'data_ml', stored.data?.job_family);

  const moved = await admin.rpc('ingest_upsert_jobs', { p_rows: [{ ...posting, job_family: 'software' }] });
  const after = await admin.from('jobs').select('job_family').eq('id', stored.data.id).single();
  check('a reclassification is a change, and is written', !moved.error && after.data?.job_family === 'software',
    moved.error?.message ?? after.data?.job_family);
}

try {
  await main();
} catch (error) {
  failures += 1;
  console.error(`\nFAIL  unexpected error — ${error instanceof Error ? error.stack : JSON.stringify(error)}`);
} finally {
  for (const undo of cleanup.reverse()) {
    try {
      await undo();
    } catch {
      // Best effort — a leftover fixture on a local stack is visible and harmless.
    }
  }
}

console.log(failures === 0 ? '\nPhase 8 verified: the deck leads with the student\'s field and level, and keeps room to explore.'
  : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
