/*
 * Checks phase 6's exit condition against the local stack, as far as phase 6 was built:
 * "a user subscribes, generates a draft, reviews it, applies, and the ledger balances."
 *
 *   npm run db:start
 *   npm run db:reset
 *   npm run verify:phase6
 *
 * Two thirds of that sentence are deliberately out of scope — subscriptions are cut
 * (PHASE6.md decision A) and draft generation is not built yet — so what this asserts is
 * the third: **the ledger balances**, and nothing can make it not balance.
 *
 * Deterministic and self-cleaning, like phases 2–5: it creates its own company, postings
 * and accounts, drives every path, and removes what it made. It passes on a database that
 * has just been reset, and needs no API service — phase 6 adds no routes yet.
 *
 * Four kinds of check, mixed on purpose:
 *
 *  - **It works.** A balance reads, a grant lands, a run opens, a refund returns.
 *  - **The arithmetic is right.** The bank cap clamps, `grant_credits` reports what it
 *    actually awarded rather than what was asked for, and refunds ignore the cap.
 *  - **It cannot be replayed.** Every idempotency key is exercised twice. This is the
 *    whole design (§7) and the durable replacement for the `paidWeeks` ref, so a second
 *    call that pays out again is the single most expensive bug this phase could ship.
 *  - **It cannot be subverted or leak.** Nobody reads another user's ledger, nobody can
 *    write one directly, and `grant_credits` — which takes a kind and a cap — is not
 *    callable by a client.
 *
 * Local only. It reads the fixed CLI demo keys and writes throwaway rows through the
 * service role — never point it at a real project.
 */

import { createClient } from '@supabase/supabase-js';

const API = 'http://127.0.0.1:54721';
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const admin = createClient(API, SERVICE, { auth: { persistSession: false } });

/*
 * Mirrors constants/goal.ts. Duplicated rather than imported: this script runs under plain
 * node with no bundler, and a check that reads its expectations from the same file the app
 * reads them from cannot catch the two drifting apart.
 */
const DAILY_GRANT = 1;
const BANK_CAP = 5;
const MAX_WEEKLY = 3;

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

/** Balance straight from the table, bypassing the RPC the app uses. */
async function ledgerSum(userId) {
  const { data, error } = await admin
    .from('credit_transactions')
    .select('amount')
    .eq('user_id', userId);
  if (error) throw new Error(`ledgerSum: ${error.message}`);
  return (data ?? []).reduce((total, row) => total + row.amount, 0);
}

async function main() {
  // ── fixtures ─────────────────────────────────────────────────────────────────

  section('fixtures');

  const company = await admin
    .from('companies')
    .insert({ slug: `p6-acme-${stamp}`, name: `P6 Acme ${stamp}`, industry: 'Software' })
    .select('id, slug')
    .single();
  if (company.error) {
    console.error(`\nCould not create the fixture company: ${company.error.message}`);
    console.error('Is `npm run db:start` running, and has `npm run db:reset` been applied?');
    process.exit(1);
  }
  cleanup.push(() => admin.from('companies').delete().eq('id', company.data.id));

  // Three postings, because several checks need a *different* job to open a second run
  // against — the live-run rule is per posting, not per user.
  const jobRows = [0, 1, 2].map((i) => ({
    company_id: company.data.id,
    company_name: `P6 Acme ${stamp}`,
    title: `Phase Six Engineer ${i}`,
    title_normalized: `phase six engineer ${i}`,
    seniority: 'intern',
    location_type: 'Remote',
    location_city: 'Denver',
    location_region: 'CO',
    employment_type: 'Internship',
    skills: ['python'],
    quality_score: 0.8,
    posted_at: new Date().toISOString(),
    description_text: 'A posting that exists only for verify:phase6.',
    apply_url: `https://example.invalid/${stamp}/${i}`,
  }));

  const jobs = await admin.from('jobs').insert(jobRows).select('id');
  if (jobs.error) {
    console.error(`\nCould not create the fixture postings: ${jobs.error.message}`);
    process.exit(1);
  }
  for (const j of jobs.data) cleanup.push(() => admin.from('jobs').delete().eq('id', j.id));
  const [jobA, jobB, jobC] = jobs.data;

  async function signIn(label) {
    const email = `p6-${label}-${stamp}@example.invalid`;
    const password = `verify-phase6-${stamp}`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error) throw new Error(`createUser(${label}): ${created.error.message}`);
    const client = createClient(API, ANON, { auth: { persistSession: false } });
    const session = await client.auth.signInWithPassword({ email, password });
    if (session.error) throw new Error(`signIn(${label}): ${session.error.message}`);
    cleanup.push(() => admin.auth.admin.deleteUser(created.data.user.id));
    return { id: created.data.user.id, client };
  }

  const alice = await signIn('alice');
  const mallory = await signIn('mallory');
  check('two accounts exist', Boolean(alice.id && mallory.id));

  // ── the daily grant ──────────────────────────────────────────────────────────

  section('the daily grant, and why it is lazy');

  const first = await alice.client.rpc('credit_state', {
    p_daily_grant: DAILY_GRANT,
    p_cap: BANK_CAP,
  });
  check('credit_state returns a balance', !first.error, first.error?.message ?? '');
  check('a fresh account gets the daily grant on first read', first.data === DAILY_GRANT,
    `got ${first.data}`);

  const second = await alice.client.rpc('credit_state', {
    p_daily_grant: DAILY_GRANT,
    p_cap: BANK_CAP,
  });
  /*
   * The check the whole lazy-grant decision rests on (§3.1). If the second call of the day
   * also granted, opening the app twice would mint a credit, and the feature would pay out
   * proportional to how often somebody switched tabs.
   */
  check('a second read the same day grants nothing', second.data === DAILY_GRANT,
    `got ${second.data}`);

  const grantRows = await admin
    .from('credit_transactions')
    .select('idempotency_key')
    .eq('user_id', alice.id)
    .eq('kind', 'daily_grant');
  check('exactly one daily_grant row exists', (grantRows.data ?? []).length === 1,
    `got ${(grantRows.data ?? []).length}`);
  check('the grant key is dated', /^grant:.+:\d{4}-\d{2}-\d{2}$/.test(
    grantRows.data?.[0]?.idempotency_key ?? ''), grantRows.data?.[0]?.idempotency_key ?? 'none');

  // ── the streak bonus ─────────────────────────────────────────────────────────

  section('the streak bonus, and the paidWeeks ref it replaces');

  const weekKey = `${stamp}-W01`;
  const paid = await alice.client.rpc('award_streak_bonus', {
    p_week_key: weekKey,
    p_amount: 2,
    p_cap: BANK_CAP,
    p_max_weekly: MAX_WEEKLY,
  });
  check('a week at goal pays', paid.data === 2, `got ${paid.data}`);

  const paidAgain = await alice.client.rpc('award_streak_bonus', {
    p_week_key: weekKey,
    p_amount: 2,
    p_cap: BANK_CAP,
    p_max_weekly: MAX_WEEKLY,
  });
  /*
   * This is the durable `paidWeeks`. In the client version, force-quitting the app emptied
   * that Set and the same week could be collected again; here the unique index is what
   * refuses, and it refuses across devices and reinstalls too.
   */
  check('the same week cannot be paid twice', paidAgain.data === 0, `got ${paidAgain.data}`);

  const overMax = await alice.client.rpc('award_streak_bonus', {
    p_week_key: `${stamp}-W02`,
    p_amount: 99,
    p_cap: BANK_CAP,
    p_max_weekly: MAX_WEEKLY,
  });
  // The tracker is self-reported, so the amount is a client-supplied number and gets
  // clamped server-side regardless of what the client computed. §7's actual defence.
  check('a week cannot pay more than maxWeeklyBonus', overMax.data <= MAX_WEEKLY,
    `got ${overMax.data}`);

  const atCap = await ledgerSum(alice.id);
  check('the bank cap holds', atCap <= BANK_CAP, `balance is ${atCap}`);
  note('balance after grants', `${atCap} of a ${BANK_CAP} cap`);

  const capped = await alice.client.rpc('award_streak_bonus', {
    p_week_key: `${stamp}-W03`,
    p_amount: 3,
    p_cap: BANK_CAP,
    p_max_weekly: MAX_WEEKLY,
  });
  const afterCapped = await ledgerSum(alice.id);
  check('a full bank awards only what fits', afterCapped <= BANK_CAP, `balance is ${afterCapped}`);
  check('the award reports what was actually paid, not what was asked',
    capped.data === afterCapped - atCap, `reported ${capped.data}, balance moved ${afterCapped - atCap}`);

  // ── spending ─────────────────────────────────────────────────────────────────

  section('reserving a credit against a run');

  const before = await ledgerSum(alice.id);
  const run = await alice.client.rpc('start_auto_apply_run', {
    p_job_id: jobA.id,
    p_resume_id: null,
  });
  check('a run opens', !run.error && typeof run.data === 'string', run.error?.message ?? '');
  const runId = run.data;
  check('a credit was taken', (await ledgerSum(alice.id)) === before - 1);

  const runRow = await admin
    .from('auto_apply_runs')
    .select('id, status, user_id, resume_id')
    .eq('id', runId)
    .single();
  check('the run row exists and is pending', runRow.data?.status === 'pending',
    runRow.data?.status ?? 'missing');
  check('a run may have no resume', runRow.data?.resume_id === null);

  const runAgain = await alice.client.rpc('start_auto_apply_run', {
    p_job_id: jobA.id,
    p_resume_id: null,
  });
  /*
   * A double tap on a slow network is one run. Without this, the second tap reserves a
   * second credit for a posting the user is already drafting.
   */
  check('tapping the same posting again returns the same run', runAgain.data === runId);
  check('and does not charge again', (await ledgerSum(alice.id)) === before - 1);

  const spends = await admin
    .from('credit_transactions')
    .select('amount, idempotency_key')
    .eq('user_id', alice.id)
    .eq('kind', 'spend');
  check('exactly one spend row for that run', (spends.data ?? []).length === 1,
    `got ${(spends.data ?? []).length}`);
  check('the spend is negative', (spends.data ?? []).every((r) => r.amount < 0));

  // ── refunding ────────────────────────────────────────────────────────────────

  section('backing out, and the one asymmetry');

  const beforeRefund = await ledgerSum(alice.id);
  const closed = await alice.client.rpc('close_auto_apply_run', {
    p_run_id: runId,
    p_failed: false,
  });
  check('closing a run refunds it', closed.data === true);
  check('the credit came back', (await ledgerSum(alice.id)) === beforeRefund + 1);

  const closedAgain = await alice.client.rpc('close_auto_apply_run', {
    p_run_id: runId,
    p_failed: false,
  });
  check('a retried close does not pay twice', closedAgain.data === false);
  check('and the balance did not move', (await ledgerSum(alice.id)) === beforeRefund + 1);

  const abandoned = await admin
    .from('auto_apply_runs')
    .select('status, completed_at')
    .eq('id', runId)
    .single();
  check('the run is marked abandoned', abandoned.data?.status === 'abandoned',
    abandoned.data?.status ?? 'missing');
  check('and stamped', Boolean(abandoned.data?.completed_at));

  /*
   * §3.2's asymmetry, and the reason it exists: a user at the cap who backs out must not be
   * charged for changing their mind, because that is exactly the pressure that gets someone
   * to submit a draft they have not read.
   */
  const atCapNow = await ledgerSum(alice.id);
  if (atCapNow === BANK_CAP) {
    const runB = await alice.client.rpc('start_auto_apply_run', { p_job_id: jobB.id });
    await alice.client.rpc('close_auto_apply_run', { p_run_id: runB.data, p_failed: false });
    check('a refund at the cap still returns the credit', (await ledgerSum(alice.id)) === BANK_CAP,
      `balance is ${await ledgerSum(alice.id)}`);
  } else {
    skip('a refund at the cap', `balance is ${atCapNow}, not the ${BANK_CAP} cap`);
  }

  // ── failing closed ───────────────────────────────────────────────────────────

  section('an empty balance');

  // Drain whatever is left, one posting at a time.
  let guard = 0;
  while ((await ledgerSum(alice.id)) > 0 && guard < 10) {
    const job = await admin
      .from('jobs')
      .insert({ ...jobRows[0], title: `Drain ${guard}`, title_normalized: `drain ${guard}`,
                apply_url: `https://example.invalid/${stamp}/drain/${guard}` })
      .select('id')
      .single();
    if (job.error) break;
    cleanup.push(() => admin.from('jobs').delete().eq('id', job.data.id));
    await alice.client.rpc('start_auto_apply_run', { p_job_id: job.data.id });
    guard += 1;
  }

  const emptied = await ledgerSum(alice.id);
  check('the balance drains to zero and stops', emptied === 0, `balance is ${emptied}`);

  const refused = await alice.client.rpc('start_auto_apply_run', { p_job_id: jobC.id });
  // Fails closed, and says so as a null rather than an error: "no credits" is an answer the
  // UI shows a paywall for, not an exception it reports.
  check('an empty balance refuses to open a run', refused.data === null, `got ${refused.data}`);
  check('and nothing was written', (await ledgerSum(alice.id)) === 0);

  const orphan = await admin
    .from('auto_apply_runs')
    .select('id')
    .eq('user_id', alice.id)
    .eq('job_id', jobC.id);
  check('no run row was left behind', (orphan.data ?? []).length === 0);

  const neverBelowZero = await admin
    .from('credit_transactions')
    .select('amount')
    .eq('user_id', alice.id)
    // Ordered explicitly: a running total over rows in arbitrary order is not a running
    // total, and this check would pass or fail depending on how Postgres felt.
    .order('id', { ascending: true });
  const runningTotals = (neverBelowZero.data ?? []).reduce(
    (acc, row) => [...acc, (acc[acc.length - 1] ?? 0) + row.amount],
    [],
  );
  check('the ledger never goes negative', runningTotals.every((t) => t >= 0),
    `low-water mark ${Math.min(0, ...runningTotals)}`);

  // ── isolation and grants ─────────────────────────────────────────────────────

  section('what a client cannot do');

  const mallorySees = await mallory.client
    .from('credit_transactions')
    .select('id')
    .eq('user_id', alice.id);
  check("another user cannot read Alice's ledger", (mallorySees.data ?? []).length === 0,
    `saw ${(mallorySees.data ?? []).length} rows`);

  const mallorysRuns = await mallory.client
    .from('auto_apply_runs')
    .select('id')
    .eq('user_id', alice.id);
  check("another user cannot read Alice's runs", (mallorysRuns.data ?? []).length === 0,
    `saw ${(mallorysRuns.data ?? []).length} rows`);

  const forged = await mallory.client
    .from('credit_transactions')
    .insert({ user_id: mallory.id, kind: 'purchase', amount: 1000, idempotency_key: `forge:${stamp}` });
  // The point of having no table grants at all. A client that could insert here could
  // simply write itself a thousand credits.
  check('a client cannot write its own ledger row', Boolean(forged.error),
    forged.error?.message ?? 'the insert succeeded');

  const minted = await mallory.client.rpc('grant_credits', {
    p_kind: 'purchase',
    p_amount: 1000,
    p_cap: null,
    p_idempotency_key: `mint:${stamp}`,
  });
  // `grant_credits` takes a kind and a cap, which is exactly why it is the one function in
  // the file not granted to `authenticated`.
  check('grant_credits is not callable by a client', Boolean(minted.error),
    minted.error?.message ?? 'the call succeeded');

  const stolen = await mallory.client.rpc('close_auto_apply_run', { p_run_id: runId });
  check("another user cannot close Alice's run", stolen.data !== true);

  const balanceLeak = await mallory.client.rpc('credit_balance');
  check('credit_balance answers for the caller only', balanceLeak.data === (await ledgerSum(mallory.id)),
    `mallory saw ${balanceLeak.data}`);

  // ── the history read ─────────────────────────────────────────────────────────

  section('the receipt list');

  const history = await alice.client.rpc('credit_history', { p_limit: 10 });
  check('credit_history returns rows', !history.error && Array.isArray(history.data),
    history.error?.message ?? '');
  check('newest first', (history.data ?? []).every((row, i, all) =>
    i === 0 || new Date(all[i - 1].created_at) >= new Date(row.created_at)));
  check('it is capped', (history.data ?? []).length <= 10, `got ${(history.data ?? []).length}`);

  const huge = await alice.client.rpc('credit_history', { p_limit: 100000 });
  check('an absurd limit is clamped, not honoured', (huge.data ?? []).length <= 200,
    `got ${(huge.data ?? []).length}`);

  // ── what phase 6 deliberately did not build ──────────────────────────────────

  section('scope');

  const subs = await admin.from('subscriptions').select('user_id').limit(1);
  check('there is no subscriptions table (decision A)', Boolean(subs.error));

  const ents = await admin.from('entitlements').select('user_id').limit(1);
  check('there is no entitlements table (decision A)', Boolean(ents.error));

  const drafted = await admin
    .from('auto_apply_runs')
    .select('id')
    .not('draft', 'is', null)
    .limit(1);
  check('nothing generates a draft yet', (drafted.data ?? []).length === 0);

  const submitted = await admin
    .from('auto_apply_runs')
    .select('id')
    .eq('status', 'used')
    .limit(1);
  // Decision B. If this ever fails, something started claiming an application was sent —
  // which nothing in this system can observe.
  check('nothing marks a run as submitted (decision B)', (submitted.data ?? []).length === 0);

}

try {
  await main();
} catch (error) {
  failures += 1;
  console.error(`
FAIL  the run itself — ${error instanceof Error ? error.message : String(error)}`);
} finally {
  /*
   * In `finally`, not at the end of `main`: a check that throws halfway through would
   * otherwise leave its company, postings and two accounts behind, and the next run
   * would be measuring a database somebody else's failure polluted.
   */
  for (const step of cleanup.reverse()) {
    try {
      await step();
    } catch {
      // Leftover p6- rows are noise in a local database, not a failure of the phase.
    }
  }
}

if (failures > 0) {
  console.log(`\n${failures} check${failures === 1 ? '' : 's'} failed.\n`);
} else {
  console.log(
    `\nPhase 6 verified as far as it is built: the ledger balances, every key is replay-safe, ` +
      `and no client can mint, read or spend what is not theirs.` +
      (skipped > 0 ? ` (${skipped} check${skipped === 1 ? '' : 's'} skipped.)\n` : '\n'),
  );
}

process.exit(failures === 0 ? 0 : 1);
