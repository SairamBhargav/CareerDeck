/*
 * Checks phase 6's exit condition against the local stack:
 * "a user subscribes, generates a draft, reviews it, applies, and the ledger balances."
 *
 *   npm run db:start
 *   npm run db:reset
 *   npm run server:dev          (pointed at the local stack, with REVENUECAT_WEBHOOK_AUTH set)
 *   npm run verify:phase6
 *
 * Deterministic and self-cleaning like phases 2–5: it creates its own companies, postings and
 * accounts, drives every path, and removes what it made.
 *
 * **It spends real money, once.** The exit condition is a *generated* draft, so one run goes
 * through the model named by `AUTO_APPLY_MODEL` (Sonnet 5 by default, about a cent). Every other
 * run is driven through the service-role functions directly, which is where the ledger rules
 * live anyway. Without `ANTHROPIC_API_KEY` in the service, the one live draft is skipped and the
 * closing line says the phase is not proven, exactly as phase 4's did for the parse.
 *
 * Five kinds of check:
 *
 *  - **The ledger balances.** Every credit is a row, every row has a reason, the sum is the
 *    balance, and no sequence of retries, races or redeliveries moves it by more than it should.
 *  - **Grants are what a nightly job would pay.** Lazy claiming, backfill, and the bank cap.
 *  - **Entitlements come only from the webhook.** A client cannot write one, a redelivery is a
 *    no-op, an old event cannot resurrect a lapsed plan, and a lapse deletes nothing.
 *  - **The draft never invents and never stores identity.** Work authorization is null, contact
 *    fields are resolved at read time and absent from the stored row, and every read is logged.
 *  - **It cannot be subverted.** The service's functions are not callable by a client, nobody
 *    reads another reader's run, and a reviewed run's credit does not come back.
 *
 * Local only. It reads the fixed CLI demo keys and writes throwaway rows through the service
 * role — never point it at a real project.
 */

import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClient } from '@supabase/supabase-js';

const API = 'http://127.0.0.1:54721';
const SERVICE_API = process.env.CAREERDECK_API_URL ?? 'http://127.0.0.1:8787';
const WEBHOOK_AUTH = process.env.REVENUECAT_WEBHOOK_AUTH;
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const admin = createClient(API, SERVICE, { auth: { persistSession: false } });
const here = dirname(fileURLToPath(import.meta.url));

let failures = 0;
let skipped = 0;
let liveDraft = false;

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

/* ── helpers ──────────────────────────────────────────────────────────────── */

/** Monday of the UTC week containing `date`, as YYYY-MM-DD. */
function mondayOf(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const offset = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}

function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function service(path, { token, method = 'POST', body, headers = {} } = {}) {
  const response = await fetch(`${SERVICE_API}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(120_000),
  });
  const json = await response.json().catch(() => null);
  return { status: response.status, json };
}

async function balanceOf(userId) {
  const { data, error } = await admin.rpc('credit_balance', { p_user_id: userId });
  if (error) throw error;
  return data;
}

async function ledgerOf(userId) {
  const { data, error } = await admin
    .from('credit_transactions')
    .select('kind, amount, ref_id, grant_period, idempotency_key, created_at')
    .eq('user_id', userId)
    .order('id');
  if (error) throw error;
  return data;
}

async function runRow(runId) {
  const { data, error } = await admin.from('auto_apply_runs').select('*').eq('id', runId).single();
  if (error) throw error;
  return data;
}

/** A RevenueCat-shaped event. Only the fields `apply_revenuecat_event` reads. */
function rcEvent(type, userId, extra = {}) {
  const now = Date.now();
  return {
    id: `verify-${stamp}-${type}-${Math.random().toString(36).slice(2)}`,
    type,
    app_user_id: userId,
    original_app_user_id: userId,
    aliases: [userId],
    product_id: 'careerdeck_pro_monthly',
    entitlement_ids: ['pro'],
    store: 'APP_STORE',
    environment: 'SANDBOX',
    original_transaction_id: `verify-otx-${userId}`,
    transaction_id: `verify-tx-${now}`,
    purchased_at_ms: now,
    expiration_at_ms: now + 30 * 86_400_000,
    event_timestamp_ms: now,
    ...extra,
  };
}

async function webhook(event, auth = WEBHOOK_AUTH) {
  return service('/webhooks/revenuecat', {
    body: { api_version: '1.0', event },
    headers: auth ? { authorization: auth } : {},
  });
}

async function main() {
  // ── preflight ──────────────────────────────────────────────────────────────

  section('preflight');

  const health = await fetch(`${SERVICE_API}/health`).then((r) => r.json()).catch(() => null);
  if (!health?.ok) {
    console.error(`\nThe API service is not answering at ${SERVICE_API}. Start it against the local stack.`);
    process.exit(1);
  }
  check('the API service is up', true, SERVICE_API);
  check('the service reports the auto-apply capability', 'autoApply' in (health.capabilities ?? {}));
  check('the service reports the billing-webhook capability', 'billingWebhook' in (health.capabilities ?? {}));

  const canDraft = health.capabilities?.autoApply === true;
  const canBill = health.capabilities?.billingWebhook === true && Boolean(WEBHOOK_AUTH);
  if (!canDraft) note('no live draft', 'ANTHROPIC_API_KEY is not set in the service');
  if (!canBill) note('no webhook', 'REVENUECAT_WEBHOOK_AUTH must be set in the service and in this shell');

  // ── fixtures ───────────────────────────────────────────────────────────────

  section('fixtures');

  const companyInsert = await admin
    .from('companies')
    .insert({ slug: `verify-phase6-${stamp}`, name: `Verify Phase 6 ${stamp}`, industry: 'Testing' })
    .select('id')
    .single();
  if (companyInsert.error) {
    console.error(`\nCould not create the fixture company: ${companyInsert.error.message}`);
    console.error('Is `npm run db:start` running, and has `npm run db:reset` been applied?');
    process.exit(1);
  }
  const companyId = companyInsert.data.id;
  cleanup.push(() => admin.from('companies').delete().eq('id', companyId));

  const posting = (title, extra = {}) => ({
    company_id: companyId,
    company_name: `Verify Phase 6 ${stamp}`,
    title,
    title_normalized: title.toLowerCase(),
    seniority: 'intern',
    location_type: 'Remote',
    employment_type: 'Internship',
    skills: ['python', 'react', 'sql'],
    description_text:
      'Verify Co builds tools for students. As a software engineering intern you will ship ' +
      'features in React and Python, write SQL against Postgres, and work with a mentor on a ' +
      'real project for twelve weeks. Requirements: currently enrolled in a CS degree.',
    apply_url: `https://example.invalid/${stamp}/${encodeURIComponent(title)}`,
    // Explicit: a bulk insert takes the union of every row's columns, so one row with a
    // status makes every row without one an explicit null.
    status: 'open',
    ...extra,
  });

  // Filler postings are what applications attach to; `applications` is unique per posting.
  const jobRows = [
    posting('Verify Software Engineer Intern'),
    posting('Verify Data Intern'),
    posting('Verify Closed Posting', { status: 'closed' }),
    ...Array.from({ length: 30 }, (_, i) => posting(`Verify Filler ${i}`)),
  ];
  const jobsInsert = await admin.from('jobs').insert(jobRows).select('id, title');
  if (jobsInsert.error) {
    console.error(`\nCould not create the fixture postings: ${jobsInsert.error.message}`);
    process.exit(1);
  }
  const jobId = (title) => jobsInsert.data.find((j) => j.title === title).id;
  const jobA = jobId('Verify Software Engineer Intern');
  const jobB = jobId('Verify Data Intern');
  const jobClosed = jobId('Verify Closed Posting');
  const fillers = jobsInsert.data.filter((j) => j.title.startsWith('Verify Filler')).map((j) => j.id);
  check('33 fixture postings', jobsInsert.data.length === 33);

  async function signIn(label) {
    const email = `verify-phase6-${label}-${stamp}@example.com`;
    const password = `verify-phase6-${stamp}-${label}`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error) throw new Error(`createUser(${label}): ${created.error.message}`);
    const client = createClient(API, ANON, { auth: { persistSession: false } });
    const session = await client.auth.signInWithPassword({ email, password });
    if (session.error) throw new Error(`signIn(${label}): ${session.error.message}`);
    cleanup.push(() => admin.auth.admin.deleteUser(created.data.user.id));
    return { id: created.data.user.id, email, client, token: session.data.session.access_token };
  }

  // alice walks the exit condition; the others each own one corner of the rules.
  const [alice, bob, carol, dave, eve, frank] = await Promise.all(
    ['alice', 'bob', 'carol', 'dave', 'eve', 'frank'].map(signIn),
  );
  check('six accounts exist', [alice, bob, carol, dave, eve, frank].every((u) => u.id));

  // ── the daily grant ────────────────────────────────────────────────────────

  section('the daily grant');

  const first = await alice.client.rpc('my_credits');
  check('my_credits() answers a signed-in reader', !first.error, first.error?.message);
  check('the first read pays the day\'s grant', first.data?.granted_now === 1 && first.data?.balance === 1,
    `granted ${first.data?.granted_now}, balance ${first.data?.balance}`);
  check('a new account is on the free plan with the free plan\'s numbers',
    first.data?.plan === 'free' && first.data?.daily_grant === 1 && first.data?.bank_cap === 5 && first.data?.resume_limit === 3);
  check('the next grant is a day after sign-up, not at UTC midnight',
    first.data?.next_grant_at && new Date(first.data.next_grant_at) > new Date());

  const again = await Promise.all([1, 2, 3, 4, 5].map(() => alice.client.rpc('my_credits')));
  check('five more reads — even in parallel — pay nothing more',
    again.every((r) => !r.error && r.data.granted_now === 0) && (await balanceOf(alice.id)) === 1,
    `balance ${await balanceOf(alice.id)}`);

  /*
   * Backfill. Age alice's account by ten days: a nightly job would have paid her up to the cap
   * of five (she holds one), so the lazy claim must pay exactly four.
   */
  const aged = await admin.from('profiles')
    .update({ created_at: new Date(Date.now() - 10.5 * 86_400_000).toISOString() })
    .eq('id', alice.id);
  check('(fixture) alice\'s account is ten days old', !aged.error, aged.error?.message);

  const backfill = await alice.client.rpc('my_credits');
  check('ten missed days pay up to the bank cap and no further',
    backfill.data?.granted_now === 4 && backfill.data?.balance === 5,
    `granted ${backfill.data?.granted_now}, balance ${backfill.data?.balance}`);

  // At the cap, more elapsed days must be *consumed*, not banked for later.
  await admin.from('profiles')
    .update({ created_at: new Date(Date.now() - 14.5 * 86_400_000).toISOString() })
    .eq('id', alice.id);
  const atCap = await alice.client.rpc('my_credits');
  const zeroRow = (await ledgerOf(alice.id)).filter((r) => r.kind === 'daily_grant' && r.amount === 0);
  check('days passed at the cap are recorded as a zero grant, not banked',
    atCap.data?.granted_now === 0 && atCap.data?.balance === 5 && zeroRow.length === 1);

  // ── the ledger's own rules ──────────────────────────────────────────────────

  section('the ledger\'s own rules');

  const badSign = await admin.from('credit_transactions').insert({
    user_id: alice.id, kind: 'spend', amount: 1, idempotency_key: `verify-bad-${stamp}`,
  });
  check('a positive spend is refused by the table itself', Boolean(badSign.error), badSign.error?.code);

  const dupKey = await admin.from('credit_transactions').insert({
    user_id: alice.id, kind: 'adjustment', amount: 1,
    idempotency_key: (await ledgerOf(alice.id))[0].idempotency_key,
  });
  check('an idempotency key cannot be written twice', Boolean(dupKey.error), dupKey.error?.code);

  const clientWrite = await alice.client.from('credit_transactions').insert({
    user_id: alice.id, kind: 'purchase', amount: 100, idempotency_key: `verify-free-money-${stamp}`,
  });
  check('a reader cannot write their own ledger', Boolean(clientWrite.error), clientWrite.error?.code);

  /*
   * Bob has no ledger rows yet, so anything he can see is somebody else's. (Filtering on
   * `user_id` would prove nothing: the column is not granted, so the query errors before RLS
   * is ever asked — which is what the first version of this check measured.)
   */
  const ownRows = await alice.client.from('credit_transactions').select('kind, amount');
  const bobSees = await bob.client.from('credit_transactions').select('id, kind, amount');
  check('a reader sees their own receipts', !ownRows.error && ownRows.data.length >= 2);
  check('…and nobody else\'s', !bobSees.error && bobSees.data.length === 0, `${bobSees.data?.length} rows`);

  const leakKey = await alice.client.from('credit_transactions').select('idempotency_key');
  check('idempotency keys are not selectable — they embed user ids', Boolean(leakKey.error));

  for (const fn of [
    ['credit_balance', { p_user_id: alice.id }],
    ['start_auto_apply', { p_user_id: alice.id, p_job_id: jobA }],
    ['save_auto_apply_draft', { p_run_id: alice.id, p_form_source: 'standard', p_form: {}, p_draft: {}, p_model: 'x', p_prompt_version: 'x', p_tokens_in: 0, p_tokens_out: 0, p_cost_usd: 0 }],
    ['fail_auto_apply', { p_run_id: alice.id, p_reason: 'x' }],
    ['apply_revenuecat_event', { p_event: { id: 'x', type: 'INITIAL_PURCHASE' } }],
    ['expire_auto_apply_runs', {}],
  ]) {
    const attempt = await alice.client.rpc(fn[0], fn[1]);
    check(`a reader cannot call ${fn[0]}()`, Boolean(attempt.error), attempt.error?.code);
  }

  // ── the streak bonus ────────────────────────────────────────────────────────

  section('the streak bonus');

  await bob.client.rpc('my_credits'); // balance 1
  await admin.from('user_preferences').update({ weekly_goal: 3 }).eq('user_id', bob.id);

  const thisMonday = mondayOf(new Date());
  // Three applications in each of the last four weeks, this one included: a four-week streak.
  const bobApps = [];
  for (let back = 0; back < 4; back += 1) {
    for (let i = 0; i < 3; i += 1) {
      bobApps.push({
        user_id: bob.id,
        job_id: fillers[back * 3 + i],
        source: 'company',
        applied_at: addDays(thisMonday, -7 * back + i),
      });
    }
  }
  const bobInsert = await admin.from('applications').insert(bobApps);
  check('(fixture) twelve applications across four weeks', !bobInsert.error, bobInsert.error?.message);

  const streak = await bob.client.rpc('claim_streak_bonus', { p_week_start: thisMonday });
  check('a four-week streak pays the long-streak bonus of two',
    streak.data?.outcome === 'paid' && streak.data?.earned === 2 && streak.data?.awarded === 2 && streak.data?.streak_weeks === 4,
    JSON.stringify(streak.data ?? streak.error?.message));
  check('…and it reached the balance', (await balanceOf(bob.id)) === 3);

  const repeat = await Promise.all([1, 2, 3].map(() => bob.client.rpc('claim_streak_bonus', { p_week_start: thisMonday })));
  check('claiming the same week again — in parallel — pays nothing',
    repeat.every((r) => r.data?.outcome === 'already_paid') && (await balanceOf(bob.id)) === 3);

  const tuesday = await bob.client.rpc('claim_streak_bonus', { p_week_start: addDays(thisMonday, 1) });
  check('a week key that is not a Monday is refused', Boolean(tuesday.error));

  const ancient = await bob.client.rpc('claim_streak_bonus', { p_week_start: addDays(thisMonday, -35) });
  check('a week from five weeks ago cannot be claimed now', Boolean(ancient.error));

  const unmet = await alice.client.rpc('claim_streak_bonus', { p_week_start: thisMonday });
  check('a week below the goal pays nothing', unmet.data?.outcome === 'not_met' && unmet.data?.awarded === 0);

  // §7's anomaly rule: twenty applications inside ninety seconds.
  await dave.client.rpc('my_credits');
  await admin.from('user_preferences').update({ weekly_goal: 3 }).eq('user_id', dave.id);
  await admin.from('applications').insert(
    fillers.slice(0, 20).map((job) => ({ user_id: dave.id, job_id: job, source: 'company', applied_at: thisMonday })),
  );
  const burst = await dave.client.rpc('claim_streak_bonus', { p_week_start: thisMonday });
  check('twenty applications logged in a burst hold the bonus rather than pay it',
    burst.data?.outcome === 'held' && (await balanceOf(dave.id)) === 1, burst.data?.outcome);

  // ── subscribing ─────────────────────────────────────────────────────────────

  section('subscribing — the webhook');

  if (!canBill) {
    skip('the webhook', 'REVENUECAT_WEBHOOK_AUTH is not configured');
  } else {
    const noAuth = await webhook(rcEvent('INITIAL_PURCHASE', alice.id), null);
    const wrongAuth = await webhook(rcEvent('INITIAL_PURCHASE', alice.id), 'not-the-secret');
    check('a delivery without the secret is refused', noAuth.status === 401);
    check('a delivery with the wrong secret is refused', wrongAuth.status === 401);
    check('…and granted nothing', (await alice.client.rpc('my_credits')).data?.plan === 'free');

    const forged = await alice.client.from('entitlements').insert({ user_id: alice.id, feature: 'pro', source: 'promo' });
    check('a reader cannot grant themselves an entitlement', Boolean(forged.error), forged.error?.code);

    const purchase = rcEvent('INITIAL_PURCHASE', alice.id);
    const bought = await webhook(purchase);
    check('INITIAL_PURCHASE is accepted', bought.status === 200 && bought.json?.outcome === 'initial_purchase',
      JSON.stringify(bought.json));

    const afterBuy = await alice.client.rpc('my_credits');
    check('alice is on Pro, with Pro\'s numbers',
      afterBuy.data?.plan === 'pro' && afterBuy.data?.daily_grant === 5 && afterBuy.data?.bank_cap === 25 && afterBuy.data?.resume_limit === 10,
      JSON.stringify(afterBuy.data));
    check('a new subscriber gets a Pro day immediately (5 → 10)', afterBuy.data?.balance === 10, `balance ${afterBuy.data?.balance}`);

    const redelivered = await webhook(purchase);
    check('a redelivered event is a no-op', redelivered.json?.outcome === 'duplicate' && (await balanceOf(alice.id)) === 10);

    const sub = await alice.client.from('subscriptions').select('tier, status, auto_renew, period_end').single();
    check('a reader sees their subscription row', !sub.error && sub.data.tier === 'pro' && sub.data.status === 'active');
    const hidden = await alice.client.from('subscriptions').select('original_transaction_id');
    check('…but not the store\'s transaction ids', Boolean(hidden.error));
  }

  // ── the draft ───────────────────────────────────────────────────────────────

  section('the draft');

  const noResume = await service('/v1/auto-apply', { token: alice.token, body: { jobId: jobA } });
  if (canDraft) {
    check('without a parsed resume there is no draft', noResume.status === 409 && noResume.json?.code === 'no_resume',
      `${noResume.status} ${noResume.json?.code}`);
  } else {
    check('without a model there is no draft', noResume.status === 503 && noResume.json?.code === 'unavailable');
  }
  const balanceBeforeDraft = await balanceOf(alice.id);
  check('…and nothing was charged for asking', balanceBeforeDraft === (canBill ? 10 : 5));

  // Alice's resume: a parsed profile with sealed contact fields, sealed by the server's own module.
  const sealProbe = [
    "import { seal, canEncrypt } from './src/resumes/crypto.ts';",
    'const hex = (v) => { const b = seal(v); return b ? "\\\\x" + b.toString("hex") : null; };',
    'console.log(JSON.stringify(canEncrypt()',
    '  ? { name: hex("Ada Lovelace"), email: hex("ada@example.edu"), phone: hex("+1 555 0100") }',
    '  : {}));',
  ].join('\n');
  let sealed = {};
  try {
    const out = execFileSync(process.execPath, ['--env-file-if-exists=.env', '--input-type=module', '--eval', sealProbe],
      { cwd: join(here, '..', 'server'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    sealed = JSON.parse(out.trim().split('\n').pop());
  } catch (error) {
    note('sealing', String(error.message ?? error).slice(0, 160));
  }
  const hasSeal = Boolean(sealed.name);

  const resumeInsert = await admin.from('resumes').insert({
    user_id: alice.id,
    name: 'Verify Resume.pdf',
    storage_path: `${alice.id}/verify-${stamp}.pdf`,
    is_default: true,
    parse_status: 'parsed',
  }).select('id').single();
  const resumeId = resumeInsert.data?.id;
  const profileSave = await admin.rpc('save_resume_profile', {
    p_resume_id: resumeId,
    p_parser_version: 'verify-phase6',
    p_full_name_enc: sealed.name ?? null,
    p_email_enc: sealed.email ?? null,
    p_phone_enc: sealed.phone ?? null,
    p_location: 'Boulder, CO',
    p_skills: ['python', 'react', 'sql', 'git'],
    p_education: [{ school: 'University of Colorado Boulder', degree: 'BS', field: 'Computer Science', graduationYear: 2027 }],
    p_experience: [{ company: 'Campus IT', title: 'Student Developer', startDate: '2025-01', endDate: null, isCurrent: true }],
    p_years: null,
    p_seniority: 'intern',
  });
  check('(fixture) alice has a parsed default resume', !resumeInsert.error && !profileSave.error,
    resumeInsert.error?.message ?? profileSave.error?.message);
  if (!hasSeal) note('contact fields', 'RESUME_ENCRYPTION_KEY is not set — contact checks fall back to the account');

  let run = null;
  let runId = null;

  if (canDraft) {
    const t0 = Date.now();
    const started = await service('/v1/auto-apply', { token: alice.token, body: { jobId: jobA } });
    const ms = Date.now() - t0;
    run = started.json?.run;
    runId = run?.id;
    liveDraft = started.status === 200 && run?.status === 'ready';

    check('a draft is generated', liveDraft, `${started.status} ${run?.status ?? ''} ${run?.error ?? started.json?.error ?? ''} in ${ms}ms`);
    check('one credit was reserved for it', started.json?.charged === true && (await balanceOf(alice.id)) === balanceBeforeDraft - 1);

    if (liveDraft) {
      const field = (key) => run.fields.find((f) => f.key === key);
      const answers = run.fields.filter((f) => f.role === 'answer');

      check('the standard form was used for a non-Greenhouse posting', run.formSource === 'standard');
      check('work authorization is not guessed', field('work_authorization')?.value === null && Boolean(field('work_authorization')?.prompt),
        JSON.stringify(field('work_authorization')?.value));
      check('sponsorship is not guessed', field('sponsorship')?.value === null);
      check('a LinkedIn URL is not invented', field('linkedin')?.value === null);
      check('every null answer carries a prompt', answers.filter((f) => f.value === null).every((f) => Boolean(f.prompt)));
      check('every select answer is one of its options',
        answers.filter((f) => f.options && f.value !== null).every((f) => f.options.includes(f.value)));
      check('every inferred answer is flagged below high confidence',
        answers.filter((f) => f.source === 'inferred' && f.value !== null).every((f) => f.confidence !== 'high'));
      check('the school came from the resume', /Colorado/i.test(String(field('school')?.value ?? '')),
        String(field('school')?.value));
      note('why_company', `${field('why_company')?.confidence ?? 'null'} — ${String(field('why_company')?.value ?? '').slice(0, 90)}…`);

      if (hasSeal) {
        check('contact fields are resolved from the sealed resume',
          field('first_name')?.value === 'Ada' && field('last_name')?.value === 'Lovelace' && field('email')?.value === 'ada@example.edu');
      } else {
        check('contact fields fall back to the account', field('email')?.value === alice.email);
      }

      const stored = await runRow(runId);
      const storedText = JSON.stringify(stored.draft) + JSON.stringify(stored.form);
      check('the stored draft holds no name, email or phone',
        !/Ada|Lovelace|ada@example\.edu|555 0100/.test(storedText) && !storedText.includes(alice.email));
      check('the run logged its model, tokens and cost',
        stored.model === (process.env.AUTO_APPLY_MODEL ?? 'claude-sonnet-5') && stored.tokens_in > 0 && stored.tokens_out > 0 && Number(stored.cost_usd) > 0,
        `${stored.model} ${stored.tokens_in}+${stored.tokens_out} tok = $${stored.cost_usd}`);

      const logged = await admin.from('pii_access_log').select('purpose, actor_type').eq('subject_user_id', alice.id).eq('purpose', 'autoapply');
      check('reading the profile for a draft is logged as autoapply', (logged.data ?? []).length >= (hasSeal ? 2 : 1),
        `${logged.data?.length} rows`);

      const resumed = await service('/v1/auto-apply', { token: alice.token, body: { jobId: jobA } });
      check('tapping Auto Apply again resumes the run instead of charging',
        resumed.json?.charged === false && resumed.json?.run?.id === runId && (await balanceOf(alice.id)) === balanceBeforeDraft - 1);

      const peek = await service(`/v1/auto-apply/${runId}`, { token: bob.token, method: 'GET' });
      check('another reader cannot read the run', peek.status === 404);

      const direct = await alice.client.from('auto_apply_runs').select('id');
      check('runs are not readable around the service', Boolean(direct.error) || direct.data.length === 0);
    }
  } else {
    skip('the live draft', 'ANTHROPIC_API_KEY is not set in the service');
  }

  // Without a live draft, the rest of the exit flow runs on a draft written through the service role.
  if (!liveDraft) {
    const started = await admin.rpc('start_auto_apply', { p_user_id: alice.id, p_job_id: jobA }).single();
    runId = started.data?.run_id;
    await admin.rpc('save_auto_apply_draft', {
      p_run_id: runId, p_form_source: 'standard',
      p_form: { source: 'standard', fields: [{ key: 'why_company', role: 'answer' }] },
      p_draft: { version: 1, fields: { why_company: { value: 'x', confidence: 'low', source: 'inferred', prompt: 'p' } } },
      p_model: 'none', p_prompt_version: 'verify', p_tokens_in: 0, p_tokens_out: 0, p_cost_usd: 0,
    });
    run = { fields: [{ key: 'why_company' }] };
  }

  // ── review, hand off, apply ─────────────────────────────────────────────────

  section('review, hand off, apply');

  const keys = run.fields.map((f) => f.key);
  const partial = await alice.client.rpc('review_auto_apply', { p_run_id: runId, p_seen: keys.slice(1), p_edited: [] });
  check('a review that skipped a field is refused', partial.error?.code === 'CD026', partial.error?.code);

  const premature = await alice.client.rpc('complete_auto_apply', { p_run_id: runId, p_applied_on: thisMonday });
  check('"I applied" before review is refused', premature.error?.code === 'CD025');

  const reviewed = await alice.client.rpc('review_auto_apply', { p_run_id: runId, p_seen: keys, p_edited: [keys[keys.length - 1], 'not-a-field'] });
  const afterReview = await runRow(runId);
  check('a full review hands off', !reviewed.error && afterReview.status === 'reviewed', reviewed.error?.message);
  check('edited fields are recorded, and only real ones', JSON.stringify(afterReview.edited_fields) === JSON.stringify([keys[keys.length - 1]]));

  const balanceAtHandOff = await balanceOf(alice.id);
  const lateAbandon = await alice.client.rpc('abandon_auto_apply', { p_run_id: runId });
  check('abandoning after the hand-off returns nothing — the credit is committed',
    lateAbandon.data === false && (await balanceOf(alice.id)) === balanceAtHandOff);
  // That closed the run; reopen it for the rest of the flow the way a reader would reach it.
  await admin.from('auto_apply_runs').update({ status: 'reviewed', completed_at: null }).eq('id', runId);

  const today = new Date().toISOString().slice(0, 10);
  const applied = await alice.client.rpc('complete_auto_apply', { p_run_id: runId, p_applied_on: today });
  const appRow = await admin.from('applications').select('id, auto_apply_run_id, source, applied_at').eq('user_id', alice.id).eq('job_id', jobA).single();
  check('"I applied" writes the tracker row, linked to its draft',
    !applied.error && appRow.data?.id === applied.data && appRow.data?.auto_apply_run_id === runId, applied.error?.message);
  check('…and the run is used', (await runRow(runId)).status === 'used');

  const appliedAgain = await alice.client.rpc('complete_auto_apply', { p_run_id: runId, p_applied_on: today });
  check('confirming twice is the same application', appliedAgain.data === applied.data);

  const wrongDay = await alice.client.rpc('complete_auto_apply', { p_run_id: runId, p_applied_on: addDays(today, -9) });
  check('(idempotent return wins over the date check on a used run)', !wrongDay.error);

  if (canDraft) {
    const afterApply = await service('/v1/auto-apply', { token: alice.token, body: { jobId: jobA } });
    check('a posting already in the tracker cannot be drafted again', afterApply.status === 409 && afterApply.json?.code === 'already_applied');

    const closed = await service('/v1/auto-apply', { token: alice.token, body: { jobId: jobClosed } });
    check('a closed posting cannot be drafted', closed.status === 410 && closed.json?.code === 'job_closed');
  }

  // ── refunds ────────────────────────────────────────────────────────────────

  section('refunds');

  const beforeB = await balanceOf(alice.id);
  const startB = await admin.rpc('start_auto_apply', { p_user_id: alice.id, p_job_id: jobB }).single();
  const runB = startB.data?.run_id;
  check('a second run reserves a credit', startB.data?.charged === true && (await balanceOf(alice.id)) === beforeB - 1);
  await admin.rpc('save_auto_apply_draft', {
    p_run_id: runB, p_form_source: 'standard', p_form: { source: 'standard', fields: [] },
    p_draft: { version: 1, fields: {} }, p_model: 'none', p_prompt_version: 'verify',
    p_tokens_in: 0, p_tokens_out: 0, p_cost_usd: 0,
  });

  const bobAbandons = await bob.client.rpc('abandon_auto_apply', { p_run_id: runB });
  check('another reader cannot abandon it', bobAbandons.error?.code === 'CD024');

  const abandons = await Promise.all([1, 2, 3].map(() => alice.client.rpc('abandon_auto_apply', { p_run_id: runB })));
  const refunds = (await ledgerOf(alice.id)).filter((r) => r.kind === 'refund' && r.ref_id === runB);
  check('abandoning before the hand-off refunds — once, however many times it is sent',
    refunds.length === 1 && (await balanceOf(alice.id)) === beforeB && abandons.filter((a) => a.data === true).length >= 1,
    `${refunds.length} refund rows`);

  const startFail = await admin.rpc('start_auto_apply', { p_user_id: alice.id, p_job_id: jobB }).single();
  check('an abandoned run frees the posting for a new one', startFail.data?.charged === true && startFail.data?.run_id !== runB);
  await admin.rpc('fail_auto_apply', { p_run_id: startFail.data.run_id, p_reason: 'verify', p_model: 'claude-sonnet-5', p_tokens_in: 1000, p_tokens_out: 10, p_cost_usd: 0.0021 });
  await admin.rpc('fail_auto_apply', { p_run_id: startFail.data.run_id, p_reason: 'verify again' });
  const failedRun = await runRow(startFail.data.run_id);
  check('a failed draft refunds, once', failedRun.status === 'failed' && (await balanceOf(alice.id)) === beforeB);
  check('a failed draft still records what the model cost', Number(failedRun.cost_usd) === 0.0021);

  // ── an empty balance ────────────────────────────────────────────────────────

  section('an empty balance');

  await eve.client.rpc('my_credits'); // 1
  const eveOne = await admin.rpc('start_auto_apply', { p_user_id: eve.id, p_job_id: jobA }).single();
  // Eve has no resume, so the reservation must fail on that before it ever looks at money.
  check('no resume is refused before any credit moves', eveOne.error?.code === 'CD022' && (await balanceOf(eve.id)) === 1);

  const eveResume = await admin.from('resumes').insert({
    user_id: eve.id, name: 'Eve.pdf', storage_path: `${eve.id}/verify-${stamp}.pdf`, is_default: true, parse_status: 'parsed',
  }).select('id').single();
  await admin.rpc('save_resume_profile', { p_resume_id: eveResume.data.id, p_parser_version: 'verify-phase6' });

  const eveSpend = await admin.rpc('start_auto_apply', { p_user_id: eve.id, p_job_id: jobA }).single();
  const eveBroke = await admin.rpc('start_auto_apply', { p_user_id: eve.id, p_job_id: jobB }).single();
  check('the last credit can be spent', eveSpend.data?.charged === true && (await balanceOf(eve.id)) === 0);
  check('with none left, the reservation fails closed', eveBroke.error?.code === 'CD020' && (await balanceOf(eve.id)) === 0,
    eveBroke.error?.code);

  // ── races ──────────────────────────────────────────────────────────────────

  section('races');

  await frank.client.rpc('my_credits'); // 1
  const frankResume = await admin.from('resumes').insert({
    user_id: frank.id, name: 'Frank.pdf', storage_path: `${frank.id}/verify-${stamp}.pdf`, is_default: true, parse_status: 'parsed',
  }).select('id').single();
  await admin.rpc('save_resume_profile', { p_resume_id: frankResume.data.id, p_parser_version: 'verify-phase6' });

  const race = await Promise.all(
    fillers.slice(20, 28).map((job) => admin.rpc('start_auto_apply', { p_user_id: frank.id, p_job_id: job }).single()),
  );
  const won = race.filter((r) => r.data?.charged === true).length;
  const frankBalance = await balanceOf(frank.id);
  check('eight simultaneous drafts on one credit: exactly one is charged', won === 1, `${won} charged`);
  check('…and the balance never goes below zero', frankBalance === 0, `balance ${frankBalance}`);

  const samePosting = await Promise.all(
    [1, 2, 3, 4].map(() => admin.rpc('start_auto_apply', { p_user_id: alice.id, p_job_id: fillers[29] }).single()),
  );
  const distinctRuns = new Set(samePosting.map((r) => r.data?.run_id).filter(Boolean));
  check('four simultaneous taps on one posting make one run and one charge',
    distinctRuns.size === 1 && samePosting.filter((r) => r.data?.charged).length === 1);

  // ── the sweep ──────────────────────────────────────────────────────────────

  section('the sweep');

  const sweepRun = [...distinctRuns][0];
  const staleBalance = await balanceOf(alice.id);
  await admin.from('auto_apply_runs').update({ created_at: new Date(Date.now() - 20 * 60_000).toISOString() }).eq('id', sweepRun);
  const reviewedAged = await admin.from('auto_apply_runs').update({ created_at: new Date(Date.now() - 30 * 86_400_000).toISOString() }).eq('id', runId);
  const swept = await admin.rpc('expire_auto_apply_runs', { p_ready_days: 7, p_stuck_minutes: 15 });
  check('a draft stuck pending for twenty minutes is failed and refunded',
    !swept.error && (await runRow(sweepRun)).status === 'failed' && (await balanceOf(alice.id)) === staleBalance + 1);
  check('a used run is never touched by the sweep', !reviewedAged.error && (await runRow(runId)).status === 'used');

  // ── the plan, over time ─────────────────────────────────────────────────────

  section('the plan, over time');

  if (!canBill) {
    skip('plan lifecycle', 'REVENUECAT_WEBHOOK_AUTH is not configured');
  } else {
    await carol.client.rpc('my_credits');
    const t = Date.now();
    await webhook(rcEvent('INITIAL_PURCHASE', carol.id, { event_timestamp_ms: t - 60_000 }));

    // Pro's shelf: a fourth resume is allowed.
    const shelf = [];
    for (let i = 0; i < 4; i += 1) {
      shelf.push(await carol.client.rpc('register_resume', { p_name: `Carol ${i}.pdf`, p_storage_path: `${carol.id}/verify-${stamp}-${i}.pdf` }));
    }
    check('Pro keeps more than three resumes', shelf.every((r) => !r.error), shelf.find((r) => r.error)?.error?.message);

    const cancel = await webhook(rcEvent('CANCELLATION', carol.id, { cancel_reason: 'UNSUBSCRIBE', event_timestamp_ms: t - 30_000 }));
    const cancelled = await carol.client.rpc('my_credits');
    const carolSub = await carol.client.from('subscriptions').select('status, auto_renew').single();
    check('turning off auto-renew keeps Pro to the end of the period',
      cancel.json?.outcome === 'cancellation' && cancelled.data?.plan === 'pro' && carolSub.data?.auto_renew === false);

    const expire = await webhook(rcEvent('EXPIRATION', carol.id, { expiration_at_ms: t - 1_000, event_timestamp_ms: t }));
    const expired = await carol.client.rpc('my_credits');
    check('expiry returns the reader to Free', expire.json?.outcome === 'expiration' && expired.data?.plan === 'free');

    const stale = await webhook(rcEvent('RENEWAL', carol.id, { event_timestamp_ms: t - 10_000 }));
    check('a RENEWAL delivered late cannot resurrect a lapsed plan',
      stale.json?.outcome === 'stale' && (await carol.client.rpc('my_credits')).data?.plan === 'free');

    const keptResumes = await carol.client.rpc('my_resumes');
    const keptEntitlement = await admin.from('entitlements').select('expires_at').eq('user_id', carol.id).eq('feature', 'pro').single();
    check('a lapse deletes nothing — all four resumes stay', keptResumes.data?.length === 4);
    check('…and the entitlement row stays, expired', keptEntitlement.data && new Date(keptEntitlement.data.expires_at) < new Date());
    check('…and the credits stay', (await balanceOf(carol.id)) > 0);

    const fifth = await carol.client.rpc('register_resume', { p_name: 'Carol 5.pdf', p_storage_path: `${carol.id}/verify-${stamp}-5.pdf` });
    check('but Free\'s limit applies to the next one', fifth.error?.code === 'CD011' && /keep 3/.test(fifth.error.message), fifth.error?.message);

    const refund = await webhook(rcEvent('INITIAL_PURCHASE', dave.id));
    await dave.client.rpc('my_credits');
    const refunded = await webhook(rcEvent('CANCELLATION', dave.id, { cancel_reason: 'CUSTOMER_SUPPORT', expiration_at_ms: Date.now() - 1000, event_timestamp_ms: Date.now() + 1000 }));
    check('a refund ends Pro immediately',
      refund.json?.outcome === 'initial_purchase' && refunded.json?.outcome === 'cancellation' && (await dave.client.rpc('my_credits')).data?.plan === 'free');

    // A promo outranks billing: a store expiry must not take away a grant support made.
    await admin.from('entitlements').upsert({ user_id: dave.id, feature: 'pro', source: 'promo', expires_at: null });
    await webhook(rcEvent('EXPIRATION', dave.id, { expiration_at_ms: Date.now() - 1000, event_timestamp_ms: Date.now() + 5000 }));
    check('a promotional Pro survives a store expiry', (await dave.client.rpc('my_credits')).data?.plan === 'pro');

    const orphan = await webhook(rcEvent('INITIAL_PURCHASE', '$RCAnonymousID:nobody', { aliases: ['$RCAnonymousID:nobody'], original_app_user_id: '$RCAnonymousID:nobody' }));
    check('an event for no known account is accepted and recorded, not retried', orphan.status === 200 && orphan.json?.outcome === 'unmatched');

    const aliased = await webhook(rcEvent('INITIAL_PURCHASE', '$RCAnonymousID:frank', {
      original_app_user_id: '$RCAnonymousID:frank', aliases: ['$RCAnonymousID:frank', frank.id],
    }));
    check('a purchase made before login resolves through its aliases',
      aliased.json?.outcome === 'initial_purchase' && (await frank.client.rpc('my_credits')).data?.plan === 'pro');

    const test = await webhook({ id: `verify-test-${stamp}`, type: 'TEST', app_user_id: 'x' });
    check('RevenueCat\'s dashboard test event is acknowledged and ignored', test.json?.outcome === 'ignored');
  }

  // ── the ledger balances ─────────────────────────────────────────────────────

  section('the ledger balances');

  const ledger = await ledgerOf(alice.id);
  const sum = ledger.reduce((total, row) => total + row.amount, 0);
  const balance = await balanceOf(alice.id);
  const credits = (await alice.client.rpc('my_credits')).data;
  check('the balance is exactly the sum of the ledger', sum === balance && credits.balance === balance, `sum ${sum}, balance ${balance}`);

  const { data: runs } = await admin.from('auto_apply_runs').select('id, status').eq('user_id', alice.id);
  const spends = ledger.filter((r) => r.kind === 'spend');
  const refundRows = ledger.filter((r) => r.kind === 'refund');
  const runById = new Map(runs.map((r) => [r.id, r]));

  check('every spend belongs to exactly one run, and every run was charged once',
    spends.every((s) => runById.has(s.ref_id)) && new Set(spends.map((s) => s.ref_id)).size === spends.length && spends.length === runs.length,
    `${spends.length} spends, ${runs.length} runs`);
  check('every refund is for a failed or abandoned run, and only those',
    refundRows.every((r) => ['failed', 'abandoned'].includes(runById.get(r.ref_id)?.status)) &&
      runs.filter((r) => ['failed', 'abandoned'].includes(r.status)).every((r) => refundRows.some((f) => f.ref_id === r.id)));
  check('the used run kept its credit', !refundRows.some((r) => r.ref_id === runId) && runById.get(runId)?.status === 'used');

  const kinds = ledger.reduce((acc, r) => ({ ...acc, [r.kind]: (acc[r.kind] ?? 0) + r.amount }), {});
  note('alice\'s ledger', Object.entries(kinds).map(([k, v]) => `${k} ${v > 0 ? '+' : ''}${v}`).join(', ') + ` = ${balance}`);

  const others = await Promise.all([bob, carol, dave, eve, frank].map(async (user) => {
    const total = (await ledgerOf(user.id)).reduce((t, r) => t + r.amount, 0);
    return { total, balance: await balanceOf(user.id) };
  }));
  check('every other account balances too, and none is negative',
    others.every((o) => o.total === o.balance && o.balance >= 0),
    others.map((o) => o.balance).join(', '));
}

try {
  await main();
} catch (error) {
  failures += 1;
  console.error('\nUnexpected error:', error);
} finally {
  for (const undo of cleanup.reverse()) {
    try {
      await undo();
    } catch {
      // Best effort — a leftover fixture is visible and harmless on a local stack.
    }
  }
}

console.log('');
if (failures > 0) {
  console.log(`${failures} check(s) failed.`);
  process.exit(1);
}
if (!liveDraft || skipped > 0) {
  console.log(`All checks passed, ${skipped} skipped — but the exit condition is NOT proven: ${
    liveDraft ? 'the webhook was not exercised' : 'no draft was generated by a model'}.`);
  process.exit(0);
}
console.log('Phase 6 exit condition met: a user subscribed, generated a draft, reviewed it, applied, and the ledger balances.');
