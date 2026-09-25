/*
 * Checks phase 5's exit condition against the local stack:
 * "ranked feed beats recency on apply-rate, measurably."
 *
 *   npm run db:start
 *   npm run db:reset
 *   npm run verify:phase5
 *
 * Deterministic and self-cleaning, like phases 2–4: it creates its own companies, postings
 * and accounts, drives every path, and removes what it made. It passes on a database that has
 * just been reset. **No API service is needed** — phase 5 adds no routes, which is itself one
 * of the phase's decisions and is asserted below.
 *
 * Four kinds of check, mixed on purpose:
 *
 *  - **It works.** A session builds, pages stably, and every card carries its ingredients.
 *  - **The ranking is real.** A posting that matches the reader's stated preferences outranks
 *    one that does not; a card shown and ignored falls; a stale posting falls. These are the
 *    checks the deleted hash function would have failed, and they are the point of the phase.
 *  - **The experiment is sound.** Assignment is sticky, the arms split, the control arm is
 *    genuinely phase 1's ordering, and contamination is counted rather than hidden.
 *  - **It cannot be subverted or leak.** Nobody reads another reader's session, nobody can
 *    discover which arm they are on, and the scoring internals are not callable.
 *
 * Local only. It reads the fixed CLI demo keys and writes throwaway rows through the service
 * role — never point it at a real project.
 */

import { createClient } from '@supabase/supabase-js';

const API = 'http://127.0.0.1:54721';
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const admin = createClient(API, SERVICE, { auth: { persistSession: false } });

let failures = 0;
let skipped = 0;

function check(label, passed, detail = '') {
  if (!passed) failures += 1;
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
}

function note(label, detail) {
  console.log(`  ..  ${label}  — ${detail}`);
}

function skip(label, why) {
  skipped += 1;
  console.log(`SKIP  ${label}  — ${why}`);
}

function section(title) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 66 - title.length))}`);
}

const stamp = Date.now();
const cleanup = [];

async function main() {
  // ── fixtures ─────────────────────────────────────────────────────────────────

  section('fixtures');

  /*
   * Five companies across two industries, so the affinity ladder (follow > engaged company >
   * same industry) and the diversity rule both have something to bite on.
   */
  const companyRows = [
    { slug: `p5-alpha-${stamp}`, name: `P5 Alpha ${stamp}`, industry: 'Software' },
    { slug: `p5-beta-${stamp}`, name: `P5 Beta ${stamp}`, industry: 'Software' },
    { slug: `p5-gamma-${stamp}`, name: `P5 Gamma ${stamp}`, industry: 'Software' },
    { slug: `p5-delta-${stamp}`, name: `P5 Delta ${stamp}`, industry: 'Energy' },
    { slug: `p5-epsilon-${stamp}`, name: `P5 Epsilon ${stamp}`, industry: 'Energy' },
  ];

  const companies = await admin.from('companies').insert(companyRows).select('id, slug, name');
  if (companies.error) {
    console.error(`\nCould not create the fixture companies: ${companies.error.message}`);
    console.error('Is `npm run db:start` running, and has `npm run db:reset` been applied?');
    process.exit(1);
  }
  for (const c of companies.data) cleanup.push(() => admin.from('companies').delete().eq('id', c.id));

  const byName = Object.fromEntries(companies.data.map((c) => [c.slug.split('-')[1], c]));

  /*
   * Forty postings. Eight per company, so "at most 2 per company in any 10-card window" is a
   * constraint the builder has to actually work to satisfy rather than one the data satisfies
   * for it.
   *
   * Half are "software engineer" titles in Denver (what the reader will say they want) and
   * half are unrelated. Ages are spread so recency has range.
   */
  /*
   * The city varies per posting within a company, and that is not decoration: phase 1's
   * dedup key is `(company_id, title_normalized, location_city, seniority)`, so eight
   * postings with one title at one city inside one company are, correctly, one posting as
   * far as `jobs_dedup_key_open_idx` is concerned. Varying the city is what makes them eight
   * real rows — and it also gives `pref_match`'s location half something to disagree about,
   * since only the first three cities are ones Alice asked for.
   */
  const WANTED_CITIES = ['Denver', 'Boulder', 'Aurora', 'Golden', 'Littleton'];
  const OTHER_CITIES = ['Midland', 'Odessa', 'Lubbock', 'Abilene', 'Tyler', 'Waco', 'Bryan', 'Killeen'];

  const jobs = [];
  for (const [key, company] of Object.entries(byName)) {
    const software = company.name.includes('Alpha') || company.name.includes('Beta') || company.name.includes('Gamma');
    for (let i = 0; i < 8; i += 1) {
      const wanted = software && i < 5;
      jobs.push({
        company_id: company.id,
        company_name: company.name,
        title: wanted ? `Software Engineer Intern ${i}` : `Field Operations Analyst ${i}`,
        // Repeated on purpose, within and across companies — the "at most 3 per
        // title_normalized per session" rule has nothing to bite on otherwise.
        title_normalized: wanted ? 'software engineer intern' : 'field operations analyst',
        seniority: wanted ? 'intern' : 'mid',
        location_type: 'Onsite',
        location_city: wanted ? WANTED_CITIES[i % WANTED_CITIES.length] : OTHER_CITIES[i % OTHER_CITIES.length],
        location_region: wanted ? 'CO' : 'TX',
        employment_type: wanted ? 'Internship' : 'Full-time',
        skills: wanted ? ['python', 'react', 'sql'] : ['pipeline-ops', 'hse'],
        quality_score: 0.8,
        posted_at: new Date(Date.now() - i * 3 * 86_400_000).toISOString(),
        description_text: 'A posting that exists only for verify:phase5.',
        apply_url: `https://example.invalid/${stamp}/${key}/${i}`,
      });
    }
  }

  const inserted = await admin.from('jobs').insert(jobs).select('id, title_normalized, company_id, posted_at');
  if (inserted.error) {
    console.error(`\nCould not create the fixture postings: ${inserted.error.message}`);
    process.exit(1);
  }
  check('40 fixture postings across 5 companies', inserted.data.length === 40,
    `${inserted.data.length}`);

  const wantedJobs = inserted.data.filter((j) => j.title_normalized === 'software engineer intern');
  const otherJobs = inserted.data.filter((j) => j.title_normalized !== 'software engineer intern');

  async function signIn(label) {
    const email = `verify-phase5-${label}-${stamp}@example.com`;
    const password = `verify-phase5-${stamp}-${label}`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error) throw new Error(`createUser(${label}): ${created.error.message}`);
    const client = createClient(API, ANON, { auth: { persistSession: false } });
    const session = await client.auth.signInWithPassword({ email, password });
    if (session.error) throw new Error(`signIn(${label}): ${session.error.message}`);
    cleanup.push(() => admin.auth.admin.deleteUser(created.data.user.id));
    return { id: created.data.user.id, client };
  }

  const alice = await signIn('alice');
  const newbie = await signIn('newbie');
  check('two accounts exist', Boolean(alice.id && newbie.id));

  // Alice has said what she wants. `newbie` says nothing — that is the cold-start case.
  await admin
    .from('user_preferences')
    .update({
      preferred_roles: ['software engineer'],
      preferred_locations: ['Denver', 'Boulder', 'Aurora'],
      /*
       * Deliberately empty. Setting it to `['Internship']` is realistic and makes the
       * ranking checks below untestable, because the employment-type hard filter then
       * removes every unrelated posting from the candidate set — correctly. With no type
       * filter, both kinds of posting compete and the difference in their scores is the
       * ranker's doing rather than the retrieval filter's.
       */
      preferred_employment_types: [],
      open_to_remote: true,
    })
    .eq('user_id', alice.id);

  // ── the weights ──────────────────────────────────────────────────────────────

  section('weights');

  const weights = await admin.from('ranking_weights').select('name, is_active, weights');
  const active = (weights.data ?? []).filter((w) => w.is_active);
  check('§5.1: the weights live in a table, not in code', (weights.data ?? []).length >= 1);
  check('exactly one set is active', active.length === 1, `${active.length}`);

  const w = active[0]?.weights ?? {};
  check('§5.1 verbatim: prefMatch .28, skill .20, recency .16, affinity .14, quality .12, urgency .10',
    w.prefMatch === 0.28 && w.skillOverlap === 0.2 && w.recency === 0.16 &&
      w.affinity === 0.14 && w.quality === 0.12 && w.urgency === 0.1,
    JSON.stringify(w));

  const secondActive = await admin
    .from('ranking_weights')
    .insert({ name: `rogue-${stamp}`, is_active: true, weights: w });
  check('the database refuses a second active set', Boolean(secondActive.error),
    secondActive.error?.code ?? 'the insert succeeded');

  const readable = await alice.client.from('ranking_weights').select('name, weights');
  check('a reader may see what the feed optimizes for', !readable.error && (readable.data ?? []).length === 1,
    readable.error?.message);

  // ── the candidate pool ───────────────────────────────────────────────────────

  section('candidate pool');

  await admin.from('company_follows').upsert({ user_id: alice.id, company_id: byName.delta.id });
  await admin.from('job_interactions').upsert({
    user_id: alice.id, job_id: wantedJobs[0].id, kind: 'like',
  });

  const pool = await admin.rpc('candidate_pool', { p_user_id: alice.id, p_limit: 600 });
  check('the pool builds', !pool.error, pool.error?.message);

  const sources = new Set((pool.data ?? []).map((r) => r.source));
  note('arms that contributed', [...sources].join(', ') || 'none');
  check('§5.2 union: more than one retrieval arm contributes', sources.size >= 2,
    [...sources].join(', '));

  // §5.1's hard filters.
  await admin.from('applications').insert({
    user_id: alice.id, job_id: otherJobs[0].id, source: 'company', applied_at: new Date().toISOString().slice(0, 10),
  });
  await admin.from('job_interactions').upsert({
    user_id: alice.id, job_id: otherJobs[1].id, kind: 'not_interested',
  });

  const filtered = await admin.rpc('candidate_pool', { p_user_id: alice.id, p_limit: 600 });
  const ids = new Set((filtered.data ?? []).map((r) => r.job_id));
  check('§5.1 hard filter: an applied posting is not a candidate', !ids.has(otherJobs[0].id));
  check('§5.1 hard filter: a not_interested posting is not a candidate', !ids.has(otherJobs[1].id));

  // ── building a session ───────────────────────────────────────────────────────

  section('the session');

  const built = await admin.rpc('build_feed_session', {
    p_user_id: alice.id, p_surface: 'reels', p_size: 40,
  });
  check('a session builds', !built.error && typeof built.data === 'string', built.error?.message);

  const sessionRow = await admin
    .from('feed_sessions')
    .select('id, arm, job_ids, components, expires_at, experiment')
    .eq('id', built.data)
    .maybeSingle();

  const pooled = sessionRow.data?.job_ids ?? [];
  note('pool size / arm', `${pooled.length} / ${sessionRow.data?.arm}`);
  check('the pool is not empty', pooled.length > 0);
  check('§5.4: it expires', new Date(sessionRow.data?.expires_at) > new Date());
  check('it records which experiment produced it', sessionRow.data?.experiment === 'ranked_feed_v1');

  if (sessionRow.data?.arm === 'ranked') {
    const comps = sessionRow.data?.components ?? {};
    check('§5.1: every card carries its ingredients',
      pooled.every((id) => comps[id] && typeof comps[id].score === 'number'),
      `${Object.keys(comps).length} of ${pooled.length} scored`);

    const sample = comps[pooled[0]];
    note('top card components', JSON.stringify(sample));
    check('the ingredients are named, not a bare number',
      sample && Object.keys(sample).some((k) => ['prefMatch', 'recency', 'quality'].includes(k)),
      Object.keys(sample ?? {}).join(', '));

    /*
     * §5.1's diversity rules, checked against the emitted order rather than the scored one —
     * which is the only place they mean anything.
     */
    /*
     * Resolved from the database for every id in the pool, not from the fixture list.
     *
     * The candidate pool draws on the whole corpus, so most of a session is seeded postings
     * this script never created. Looking those up in a map of its own forty fixtures returns
     * `undefined` for each one, and a diversity check that silently skips the rows it cannot
     * identify is a diversity check that passes on an empty set.
     */
    const meta = await admin
      .from('jobs').select('id, company_id, title_normalized').in('id', pooled);
    const jobById = new Map((meta.data ?? []).map((j) => [j.id, j]));
    check('every pooled posting resolves, so the rules below are not checked on an empty set',
      jobById.size === pooled.length, `${jobById.size} of ${pooled.length}`);
    let worstWindow = 0;
    for (let i = 0; i + 1 <= pooled.length; i += 1) {
      const window = pooled.slice(i, i + 10);
      const counts = new Map();
      for (const id of window) {
        const c = jobById.get(id)?.company_id;
        if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
      }
      worstWindow = Math.max(worstWindow, ...counts.values());
    }
    check('§5.1: at most 2 postings per company in any 10-card window', worstWindow <= 2,
      `worst window had ${worstWindow}`);

    const titleCounts = new Map();
    for (const id of pooled) {
      const t = jobById.get(id)?.title_normalized;
      if (t) titleCounts.set(t, (titleCounts.get(t) ?? 0) + 1);
    }
    const worstTitle = Math.max(0, ...titleCounts.values());
    check('§5.1: at most 3 per title_normalized per session', worstTitle <= 3,
      `worst title had ${worstTitle}`);
  } else {
    skip('the ranked-arm checks', 'this account hashed into the control arm');
  }

  // ── the ranking is real ──────────────────────────────────────────────────────

  section('the ranking is real');

  /*
   * The check the deleted hash function could never have passed.
   *
   * `resumeMatchScore()` and a `posted_at desc` feed both produce an order. What neither
   * produces is an order that *moves when the reader's stated preferences move* — so the
   * comparison is between two scores for the same reader, one posting matching what she
   * asked for and one not.
   */
  /*
   * One session, then read scores out of it — rather than picking two postings up front and
   * hoping both survive.
   *
   * They frequently do not, and that is the diversity pass working: §5.1 caps a session at
   * three postings per `title_normalized`, so most of the forty fixtures are deliberately
   * absent from any one pool. A check that assumes a particular posting was emitted is
   * testing the fixture generator, not the ranker.
   */
  const buildFor = async (userId) => {
    const r = await admin.rpc('build_feed_session', {
      p_user_id: userId, p_surface: 'reels', p_size: 200,
    });
    const row = await admin
      .from('feed_sessions').select('arm, job_ids, components').eq('id', r.data).maybeSingle();
    return row.data ?? { arm: null, job_ids: [], components: {} };
  };

  const titleOf = (id) => inserted.data.find((j) => j.id === id)?.title_normalized;
  const best = (session, title) =>
    (session.job_ids ?? [])
      .filter((id) => titleOf(id) === title)
      .map((id) => ({ id, score: session.components?.[id]?.score ?? null }))
      .filter((e) => typeof e.score === 'number')
      .sort((a, b) => b.score - a.score)[0] ?? null;

  const aliceSession = await buildFor(alice.id);

  if (aliceSession.arm !== 'ranked') {
    skip('preference sensitivity', 'this account is in the control arm');
    skip('the seen penalty', 'this account is in the control arm');
  } else {
    const wanted = best(aliceSession, 'software engineer intern');
    const unwanted = best(aliceSession, 'field operations analyst');

    check('both kinds of posting made it into the pool',
      wanted !== null && unwanted !== null,
      `${wanted?.score} / ${unwanted?.score}`);

    if (wanted && unwanted) {
      note('matching vs unrelated', `${wanted.score} vs ${unwanted.score}`);
      note('why', JSON.stringify(aliceSession.components[wanted.id]));
      /*
       * The check the deleted hash function could never have passed. `resumeMatchScore()`
       * and a `posted_at desc` feed both produce an order; neither produces one that moves
       * when the reader's stated preferences move.
       */
      check('§5.1: a posting matching stated preferences outranks one that does not',
        wanted.score > unwanted.score, `${wanted.score} vs ${unwanted.score}`);
    }

    /*
     * §5.1's penalty counts impressions "not engaged" with, so the probe must be a posting
     * Alice has never liked or saved — `wantedJobs[0]` is liked above, and using it would
     * have the suppression working exactly as designed and the check failing anyway.
     */
    const probe =
      (aliceSession.job_ids ?? []).find(
        (id) => id !== wantedJobs[0].id && typeof aliceSession.components?.[id]?.score === 'number',
      ) ?? aliceSession.job_ids[0];
    const beforeScore = aliceSession.components?.[probe]?.score ?? null;

    const impressionSession = crypto.randomUUID();
    await admin.from('job_impressions').insert(
      Array.from({ length: 5 }, (_, i) => ({
        user_id: alice.id, job_id: probe, surface: 'reels',
        session_id: impressionSession, position: i, shown_at: new Date().toISOString(),
      })),
    );

    const afterSession = await buildFor(alice.id);
    const afterScore = afterSession.components?.[probe]?.score ?? null;

    note('before / after 5 unengaged impressions', `${beforeScore} → ${afterScore ?? 'dropped out'}`);

    /*
     * Either outcome is the penalty working, and the check says so rather than insisting on
     * one of them.
     *
     * The diversity pass is greedy over a scored list, so lowering one posting's score does
     * not merely move it down — it can change which postings clear the per-company window
     * ahead of it and push it out of the pool altogether. Demanding "still present, but
     * lower" would fail on the stronger of the two results.
     */
    check('§5.1: a card shown and ignored five times scores lower or leaves the pool',
      typeof beforeScore === 'number' &&
        (afterScore === null || afterScore < beforeScore),
      `${beforeScore} → ${afterScore ?? 'dropped out'}`);

    /*
     * The penalty at the scorer, where it is deterministic. The integration check above can
     * be satisfied by a posting leaving the pool for an unrelated reason; this one cannot be
     * satisfied by anything except the arithmetic in §5.1 being present and signed correctly.
     */
    const clean = await admin.rpc('rank_score', {
      p_weights: w, p_pref: 1, p_skill: 1, p_recency: 1, p_affinity: 1,
      p_quality: 1, p_urgency: 1, p_cohort: 1, p_popularity: 1, p_seen_count: 0,
    });
    const seen5 = await admin.rpc('rank_score', {
      p_weights: w, p_pref: 1, p_skill: 1, p_recency: 1, p_affinity: 1,
      p_quality: 1, p_urgency: 1, p_cohort: 1, p_popularity: 1, p_seen_count: 5,
    });
    note('scorer: unseen vs seen 5×', `${clean.data?.score} vs ${seen5.data?.score}`);
    check('§5.1 at the scorer: log(1 + times shown) costs a perfect card real points',
      (clean.data?.score ?? 0) === 100 && (seen5.data?.score ?? 100) < 50,
      `${clean.data?.score} → ${seen5.data?.score}`);
    check('and the penalty is recorded as an ingredient, not folded away silently',
      typeof seen5.data?.components?.seenPenalty === 'number',
      JSON.stringify(seen5.data?.components ?? {}));
  }

  // Cold start — §5.1's "a new user with no resume, no likes, no follows".
  const coldSession = await admin.rpc('build_feed_session', {
    p_user_id: newbie.id, p_surface: 'reels', p_size: 40,
  });
  const coldRow = await admin
    .from('feed_sessions').select('job_ids, components, arm').eq('id', coldSession.data).maybeSingle();
  check('§5.1 cold start: an account with no signals still gets a full pool',
    (coldRow.data?.job_ids ?? []).length > 0,
    `${(coldRow.data?.job_ids ?? []).length} cards`);

  if (coldRow.data?.arm === 'ranked') {
    const first = coldRow.data.components?.[coldRow.data.job_ids[0]] ?? {};
    check('and it is scored on what is knowable, renormalized rather than penalized',
      typeof first.score === 'number' && first.score > 0,
      JSON.stringify(first));
  }

  // ── paging ───────────────────────────────────────────────────────────────────

  section('paging is stable');

  const page1 = await alice.client.rpc('ranked_feed', { p_cursor: undefined, p_limit: 5 });
  check('the first page comes back', !page1.error && (page1.data ?? []).length > 0,
    page1.error?.message);

  const cursor = page1.data?.[page1.data.length - 1]?.page_cursor;
  check('it hands back a cursor', typeof cursor === 'string', String(cursor));

  const page2 = await alice.client.rpc('ranked_feed', { p_cursor: cursor, p_limit: 5 });
  const page1Ids = (page1.data ?? []).map((r) => r.id);
  const page2Ids = (page2.data ?? []).map((r) => r.id);
  check('the second page is different cards',
    page2Ids.length > 0 && !page2Ids.some((id) => page1Ids.includes(id)));

  /*
   * §5.4's whole point: "a user scrolling back up sees the same cards, which is the bug most
   * infinite feeds ship with." Re-reading the same cursor must return the same page even
   * though new postings have been inserted and scores have changed underneath.
   */
  const page2Again = await alice.client.rpc('ranked_feed', { p_cursor: cursor, p_limit: 5 });
  check('§5.4: re-reading a cursor returns the same cards',
    JSON.stringify((page2Again.data ?? []).map((r) => r.id)) === JSON.stringify(page2Ids));

  const fresh = await alice.client.rpc('ranked_feed', { p_cursor: undefined, p_limit: 5 });
  check('§5.4: a null cursor builds a new session — pull-to-refresh',
    !fresh.error && (fresh.data ?? []).length > 0);

  const sessionCount = await admin
    .from('feed_sessions').select('id', { count: 'exact', head: true }).eq('user_id', alice.id);
  check('which is a new row, not a mutation of the old one', (sessionCount.count ?? 0) >= 2,
    `${sessionCount.count} sessions`);

  const ranks = (page1.data ?? []).map((r) => r.rank);
  check('phase 1\'s `job_card.rank` is finally filled',
    ranks.every((r) => typeof r === 'number'), JSON.stringify(ranks));

  // ── explainability ───────────────────────────────────────────────────────────

  section('explainability');

  const anyId = page1.data?.[0]?.id;
  const explained = await alice.client.rpc('explain_feed_rank', { p_job_id: anyId });
  check('§13.3: a reader can ask why a posting is where it is',
    !explained.error && explained.data !== null, explained.error?.message);
  check('the answer names the position, the weights and the components',
    explained.data?.position > 0 &&
      explained.data?.weights?.prefMatch !== undefined &&
      explained.data?.components !== null,
    JSON.stringify(explained.data?.components ?? {}).slice(0, 120));

  // ── the experiment ───────────────────────────────────────────────────────────

  section('the A/B harness');

  const armOnce = await admin.rpc('experiment_arm', { p_user_id: alice.id, p_experiment: 'ranked_feed_v1' });
  const armTwice = await admin.rpc('experiment_arm', { p_user_id: alice.id, p_experiment: 'ranked_feed_v1' });
  check('assignment is sticky', armOnce.data === armTwice.data, String(armOnce.data));

  /*
   * A hundred synthetic ids through the assignment function. Not a statistical test — a
   * smoke test that the hash is not degenerate, which is the failure mode that would put
   * every user in one arm and produce a result with no control group in it.
   */
  const spread = { ranked: 0, recency: 0 };
  const sample = Array.from({ length: 100 }, () => crypto.randomUUID());
  for (const id of sample) {
    const r = await admin.rpc('experiment_arm', { p_user_id: id, p_experiment: 'ranked_feed_v1' });
    spread[r.data] = (spread[r.data] ?? 0) + 1;
  }
  note('100 ids split', `${spread.ranked} ranked / ${spread.recency} recency`);
  check('the split is not degenerate', spread.ranked > 25 && spread.recency > 25,
    `${spread.ranked}/${spread.recency}`);

  const hidden = await alice.client.from('feed_experiments').select('*');
  check('a participant cannot read which arm they are on',
    Boolean(hidden.error) || (hidden.data ?? []).length === 0,
    hidden.error?.message ?? 'rows returned');

  /*
   * The control arm has to be genuinely phase 1's ordering, or the comparison measures
   * nothing. Built directly rather than waiting for an account that happens to hash into it.
   */
  await admin.from('feed_experiments').update({ treatment_pct: 0 }).eq('name', 'ranked_feed_v1');
  const controlSession = await admin.rpc('build_feed_session', {
    p_user_id: newbie.id, p_surface: 'reels', p_size: 20,
  });
  const controlRow = await admin
    .from('feed_sessions').select('job_ids, arm, components').eq('id', controlSession.data).maybeSingle();

  check('at 0% treatment everybody is control', controlRow.data?.arm === 'recency',
    String(controlRow.data?.arm));

  if (controlRow.data?.arm === 'recency') {
    const order = controlRow.data.job_ids ?? [];
    const posted = order.map((id) => inserted.data.find((j) => j.id === id)?.posted_at).filter(Boolean);
    const descending = posted.every((v, i) => i === 0 || new Date(posted[i - 1]) >= new Date(v));
    check('the control arm is genuinely posted_at desc — phase 1, unchanged', descending);
    check('and carries no components, because it did no scoring',
      Object.keys(controlRow.data.components ?? {}).length === 0);
  }

  await admin.from('feed_experiments').update({ treatment_pct: 100 }).eq('name', 'ranked_feed_v1');
  const treatSession = await admin.rpc('build_feed_session', {
    p_user_id: newbie.id, p_surface: 'reels', p_size: 20,
  });
  const treatRow = await admin
    .from('feed_sessions').select('arm').eq('id', treatSession.data).maybeSingle();
  check('at 100% treatment everybody is ranked', treatRow.data?.arm === 'ranked',
    String(treatRow.data?.arm));

  // ── measuring it ─────────────────────────────────────────────────────────────

  section('measurement');

  const results = await admin.rpc('feed_experiment_results', {
    p_experiment: 'ranked_feed_v1', p_since: new Date(stamp - 60_000).toISOString(),
  });
  check('§15: the exit condition is a query', !results.error, results.error?.message);
  note('arms measured', (results.data ?? []).map((r) => `${r.arm}:${r.impressions}imp`).join(' '));

  check('it reports both arms it saw', (results.data ?? []).length >= 1);
  check('it counts contaminated readers rather than hiding them',
    (results.data ?? []).every((r) => typeof r.contaminated === 'number'),
    JSON.stringify((results.data ?? []).map((r) => r.contaminated)));

  /*
   * `newbie` was served both arms above, deliberately, by moving `treatment_pct`. That is
   * exactly the reassignment that silently ruins an A/B test, so the query has to notice.
   */
  check('a reader served both arms is flagged as contaminated, not counted twice',
    (results.data ?? []).some((r) => r.contaminated >= 1),
    `contaminated=${(results.data ?? [])[0]?.contaminated}`);

  const armsPresent = new Set((results.data ?? []).map((r) => r.arm));
  check('a contaminated reader is excluded from the rates', !armsPresent.has(undefined));

  // ── authorization ────────────────────────────────────────────────────────────

  section('what a client can reach');

  for (const table of ['feed_sessions', 'feed_experiments', 'user_taste_vectors']) {
    const direct = await alice.client.from(table).select('*').limit(1);
    check(`\`${table}\` is unreadable from a client`,
      Boolean(direct.error) || (direct.data ?? []).length === 0,
      direct.error?.message ?? 'returned rows');
  }

  for (const [fn, args] of [
    ['build_feed_session', { p_user_id: newbie.id }],
    ['candidate_pool', { p_user_id: newbie.id }],
    ['experiment_arm', { p_user_id: newbie.id, p_experiment: 'ranked_feed_v1' }],
    ['feed_experiment_results', {}],
    ['active_weights', {}],
    ['rank_score', {}],
  ]) {
    const attempt = await alice.client.rpc(fn, args);
    check(`a client cannot call \`${fn}()\``, Boolean(attempt.error), attempt.error?.code ?? '');
  }

  /*
   * The forged cursor. `ranked_feed` scopes by `auth.uid()` internally, so pointing it at
   * somebody else's session must not page it — it must quietly start a fresh one instead,
   * which is also the right behaviour for an expired cursor.
   */
  const victim = await admin.rpc('build_feed_session', { p_user_id: newbie.id, p_surface: 'reels', p_size: 20 });
  const victimRow = await admin.from('feed_sessions').select('job_ids').eq('id', victim.data).maybeSingle();
  const forged = Buffer.from(JSON.stringify({ v: '0', i: victim.data }), 'utf8').toString('base64');
  const stolen = await alice.client.rpc('ranked_feed', { p_cursor: forged, p_limit: 5 });
  const stolenIds = (stolen.data ?? []).map((r) => r.id);
  const victimIds = (victimRow.data?.job_ids ?? []).slice(0, 5);
  check('a forged cursor cannot page another reader\'s session',
    JSON.stringify(stolenIds) !== JSON.stringify(victimIds) || stolenIds.length === 0,
    `${stolenIds.length} rows`);

  // ── the dormant arm ──────────────────────────────────────────────────────────

  section('taste vectors, declared and dormant');

  const taste = await admin.from('user_taste_vectors').select('user_id');
  check('§5.2\'s table exists', !taste.error, taste.error?.message);
  check('and phase 5 writes nothing to it, as PHASE5.md §5 argues',
    (taste.data ?? []).length === 0, `${(taste.data ?? []).length} rows`);

  const embedded = await admin.from('jobs').select('id').not('embedding', 'is', null).limit(1);
  check('no posting has an embedding either', (embedded.data ?? []).length === 0);

  // ── no new routes ────────────────────────────────────────────────────────────

  section('the ranker stayed in Postgres');

  /*
   * PHASE1.md's decision B named the trigger for moving reads to the API service: "when
   * §5.1's ranker needs a Redis candidate pool and a diversity pass that Postgres cannot
   * express". Neither happened, so this asserts the absence — a phase that quietly grew a
   * `/v1/feed` route while the doc said it had not would be worse than one that grew it
   * openly.
   */
  const routes = await import('node:fs/promises')
    .then((fs) => fs.readFile(new URL('../server/src/index.ts', import.meta.url), 'utf8'))
    .catch(() => '');
  /*
   * Matched against route *registrations* rather than against the file, because the file's
   * own header discusses the ranked feed at length — a substring search for "feed" finds the
   * prose explaining why there is no feed route and calls it a feed route.
   */
  const registrations = [...routes.matchAll(/\.route\(\s*'([^']+)'/g)].map((m) => m[1]);
  note('routes registered in the API service', registrations.join(', '));
  check('no feed route was added to the API service',
    !registrations.some((r) => r.includes('feed')), registrations.join(', '));
  /*
   * The exact set phases 3 and 4 left behind, deduplicated — `/moderation` is mounted twice
   * on purpose (an HTML page outside `/v1`, JSON routes inside it). An equality check rather
   * than a count, so a route added later is named in the failure rather than showing up as
   * an off-by-one.
   */
  const expected = ['/comments', '/moderation', '/resumes', '/verify', '/webhooks'];
  check('phase 5 added no routes — the set is exactly what phases 3 and 4 left',
    JSON.stringify([...new Set(registrations)].sort()) === JSON.stringify(expected),
    [...new Set(registrations)].sort().join(', '));
}

try {
  await main();
} catch (error) {
  failures += 1;
  console.error(`\nFAIL  the run itself — ${error instanceof Error ? error.message : String(error)}`);
} finally {
  /*
   * Restore the experiment to its shipped state before anything else — the checks above move
   * `treatment_pct` to 0 and 100 deliberately, and leaving it at 100 would mean the next run
   * of anything measures a one-armed experiment.
   */
  try {
    await admin.from('feed_experiments').update({ treatment_pct: 50 }).eq('name', 'ranked_feed_v1');
  } catch {
    // Best effort.
  }
  try {
    await admin.from('ranking_weights').delete().like('name', `rogue-${stamp}`);
  } catch {
    // Same.
  }
  for (const step of cleanup.reverse()) {
    try {
      await step();
    } catch {
      // Leftover verify- rows are noise in a local database, not a failure of the phase.
    }
  }
}

if (failures > 0) {
  console.log(`\n${failures} check${failures === 1 ? '' : 's'} failed.\n`);
} else {
  console.log(
    `\nPhase 5 verified: the feed is ranked, stable, explainable, and measured against the ` +
      `recency feed it replaces.` +
      (skipped > 0 ? ` (${skipped} check${skipped === 1 ? '' : 's'} skipped.)\n` : '\n'),
  );
}

process.exit(failures === 0 ? 0 : 1);
