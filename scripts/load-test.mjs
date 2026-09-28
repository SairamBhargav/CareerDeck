/*
 * Load test — §15's last phase 7 item, against the local stack.
 *
 *   npm run load-test                        # 50 virtual readers for 60 s
 *   VUS=200 DURATION=120 npm run load-test   # bigger
 *
 * Each virtual reader is a real account doing what the app does on open and while scrolling, in
 * the proportions the app does them: build a ranked feed session, page through it, read viewer
 * state, batch impressions, read the stories row, the inbox and the credit balance. Latency is
 * measured per operation and checked against budgets.
 *
 * ── What this can and cannot tell you ─────────────────────────────────────────
 *
 * It runs against Postgres in Docker on a laptop, with the laptop also generating the load. That
 * makes it a **regression and contention test**, not a capacity number: it finds queries that
 * degrade under concurrency (a missing index, a lock held too long, a session build that scales
 * with the corpus), and it fails if one gets worse. It does not say how many users the hosted
 * project on a given compute size will carry. That run needs a staging project — never production,
 * since every virtual reader writes impressions — and PHASE7.md §6 says how to point this at one.
 *
 * Self-cleaning: the accounts it creates are deleted at the end (their rows cascade).
 */

import { createClient } from '@supabase/supabase-js';

const API = process.env.LOAD_SUPABASE_URL ?? 'http://127.0.0.1:54721';
const ANON = process.env.LOAD_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE = process.env.LOAD_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

if (!API.includes('127.0.0.1') && process.env.LOAD_I_UNDERSTAND !== 'staging') {
  console.error('Refusing to load-test a non-local project without LOAD_I_UNDERSTAND=staging. Never point this at production.');
  process.exit(2);
}

const VUS = Number(process.env.VUS ?? 50);
const DURATION_S = Number(process.env.DURATION ?? 60);
/** A reader's pause between actions — the time spent looking at a card. */
const THINK_MS = Number(process.env.THINK_MS ?? 400);

/**
 * p95 budgets in milliseconds, per operation. §14 asks for feed p50/p95 on a dashboard; these are
 * the numbers this repository commits to locally. A session build is the expensive one by design
 * (PHASE5.md: once per session, not per page) so it gets the widest budget.
 */
const BUDGET_P95 = {
  'feed: build session': 1500,
  'feed: next page': 300,
  'viewer_state': 300,
  'log_impressions (20)': 300,
  'news_feed': 300,
  'notifications': 250,
  'my_credits': 250,
};

const admin = createClient(API, SERVICE, { auth: { persistSession: false } });
const samples = new Map();
let errors = 0;
const errorKinds = new Map();

async function timed(name, fn) {
  const t0 = performance.now();
  try {
    const result = await fn();
    if (result?.error) throw result.error;
    return result;
  } catch (error) {
    errors += 1;
    const key = `${name}: ${error?.message ?? error}`.slice(0, 120);
    errorKinds.set(key, (errorKinds.get(key) ?? 0) + 1);
    return null;
  } finally {
    const list = samples.get(name) ?? [];
    list.push(performance.now() - t0);
    samples.set(name, list);
  }
}

function pct(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms * (0.5 + Math.random())));

async function reader(client, deadline) {
  const session = crypto.randomUUID();
  while (Date.now() < deadline) {
    // App open: the four reads the shell and Home make.
    await Promise.all([
      timed('viewer_state', () => client.rpc('viewer_state')),
      timed('my_credits', () => client.rpc('my_credits')),
      timed('news_feed', () => client.rpc('news_feed', { p_days: 14, p_limit: 120 })),
      timed('notifications', () => client.from('notifications_public').select('*').order('created_at', { ascending: false }).limit(200)),
    ]);

    // Reels: a fresh ranked session, then a few pages with impressions flushed per page.
    const first = await timed('feed: build session', () => client.rpc('ranked_feed', { p_limit: 20, p_surface: 'reels' }));
    let rows = first?.data ?? [];
    for (let page = 0; page < 3 && rows.length === 20 && Date.now() < deadline; page += 1) {
      await sleep(THINK_MS);
      await timed('log_impressions (20)', () => client.rpc('log_impressions', {
        p_rows: rows.map((r, i) => ({
          job_id: r.id, surface: 'reels', session_id: session, position: page * 20 + i,
          dwell_ms: 800 + Math.floor(Math.random() * 4000), completed: true, shown_at: new Date().toISOString(),
        })),
      }));
      const cursor = rows[rows.length - 1]?.page_cursor;
      const next = await timed('feed: next page', () => client.rpc('ranked_feed', { p_cursor: cursor, p_limit: 20, p_surface: 'reels' }));
      rows = next?.data ?? [];
    }
    await sleep(THINK_MS * 2);
  }
}

async function main() {
  const jobs = await admin.from('jobs').select('id', { count: 'exact', head: true }).eq('status', 'open');
  console.log(`corpus: ${jobs.count} open postings · ${VUS} readers · ${DURATION_S}s · think ${THINK_MS}ms\n`);

  const stamp = Date.now();
  const users = [];
  console.log('creating readers…');
  for (let i = 0; i < VUS; i += 1) {
    const email = `load-${stamp}-${i}@example.com`;
    const password = `load-${stamp}-${i}-pw`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error) throw created.error;
    const client = createClient(API, ANON, { auth: { persistSession: false } });
    await client.auth.signInWithPassword({ email, password });
    users.push({ id: created.data.user.id, client });
  }

  try {
    const deadline = Date.now() + DURATION_S * 1000;
    const started = Date.now();
    await Promise.all(users.map((u, i) => sleep(i * 20).then(() => reader(u.client, deadline))));
    const seconds = (Date.now() - started) / 1000;

    let total = 0;
    let breaches = 0;
    console.log('\noperation                  count     rps     p50     p95     p99   budget');
    for (const [name, list] of [...samples.entries()].sort()) {
      const sorted = [...list].sort((a, b) => a - b);
      total += sorted.length;
      const p95 = pct(sorted, 95);
      const budget = BUDGET_P95[name];
      const over = budget !== undefined && p95 > budget;
      if (over) breaches += 1;
      console.log(`${name.padEnd(24)} ${String(sorted.length).padStart(7)} ${(sorted.length / seconds).toFixed(1).padStart(7)} ${pct(sorted, 50).toFixed(0).padStart(7)} ${p95.toFixed(0).padStart(7)} ${pct(sorted, 99).toFixed(0).padStart(7)} ${String(budget ?? '—').padStart(8)}${over ? '  OVER' : ''}`);
    }
    const errorRate = total ? errors / total : 0;
    console.log(`\n${total} requests in ${seconds.toFixed(0)}s (${(total / seconds).toFixed(0)} rps), ${errors} errors (${(errorRate * 100).toFixed(2)}%)`);
    for (const [kind, n] of errorKinds) console.log(`  ${n} × ${kind}`);

    const passed = breaches === 0 && errorRate < 0.01;
    console.log(passed ? '\nLoad test passed: every p95 inside budget, errors under 1%.' : `\nLoad test FAILED: ${breaches} budget breach(es), ${(errorRate * 100).toFixed(2)}% errors.`);
    process.exitCode = passed ? 0 : 1;
  } finally {
    console.log('removing readers…');
    for (const u of users) await admin.auth.admin.deleteUser(u.id).catch(() => null);
  }
}

await main();
