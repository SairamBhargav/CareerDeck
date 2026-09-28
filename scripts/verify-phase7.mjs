/*
 * Checks phase 7 against the local stack: news, delivery, and the privacy rights.
 *
 *   npm run db:reset
 *   (the API service on the local stack — see PHASE7.md §7)
 *   npm run verify:phase7
 *
 * The background jobs are run for real, as child processes of `server/src/jobs.ts`, against the
 * local database. Push goes to a stand-in for Expo's API that this script serves on a local port,
 * so the real sender — batching, tickets, receipts, dead-token retirement — is what is exercised,
 * and nothing reaches a phone.
 *
 * **It spends a fraction of a cent**: one news source is ingested live, at most three stories,
 * through `NEWS_MODEL` (Haiku). Without ANTHROPIC_API_KEY that section is skipped and said so.
 *
 * Local only — fixed CLI demo keys, throwaway rows through the service role.
 */

import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClient } from '@supabase/supabase-js';

const API = 'http://127.0.0.1:54721';
const SERVICE_API = process.env.CAREERDECK_API_URL ?? 'http://127.0.0.1:8787';
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const admin = createClient(API, SERVICE, { auth: { persistSession: false } });
const here = dirname(fileURLToPath(import.meta.url));
const serverDir = join(here, '..', 'server');

let failures = 0;
let skipped = 0;

function check(label, passed, detail = '') {
  if (!passed) failures += 1;
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
}
function note(label, detail) { console.log(`  ..  ${label}  — ${detail}`); }
function skip(label, why) { skipped += 1; console.log(`SKIP  ${label}  — ${why}`); }
function section(title) { console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 66 - title.length))}`); }

const stamp = Date.now();
const cleanup = [];

// ── a stand-in for Expo's push API ──────────────────────────────────────────────
const expo = { sent: [], receiptAsks: [] };
const DEAD = 'ExponentPushToken[dead-device]';
const mock = createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const body = raw ? JSON.parse(raw) : null;
    res.setHeader('content-type', 'application/json');
    if (req.url.endsWith('/send')) {
      expo.sent.push(...body);
      res.end(JSON.stringify({ data: body.map((m, i) => m.to === DEAD
        ? { status: 'error', message: 'not registered', details: { error: 'DeviceNotRegistered' } }
        : { status: 'ok', id: `ticket-${stamp}-${expo.sent.length}-${i}` }) }));
    } else if (req.url.endsWith('/getReceipts')) {
      expo.receiptAsks.push(...body.ids);
      res.end(JSON.stringify({ data: Object.fromEntries(body.ids.map((id, i) => [id,
        i === 0 ? { status: 'error', details: { error: 'DeviceNotRegistered' } } : { status: 'ok' }])) }));
    } else {
      res.statusCode = 404;
      res.end('{}');
    }
  });
});
await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve));
const MOCK_URL = `http://127.0.0.1:${mock.address().port}`;

/**
 * Runs one job exactly as production does, against the local stack and the mock.
 *
 * Asynchronous on purpose: the mock is served from *this* process, and a synchronous child would
 * block the event loop that has to answer it — every push then times out, and the sender, correctly,
 * records them all as failures. The first version of this check did exactly that.
 */
async function job(name, extraEnv = {}) {
  const { stdout: out } = await execFileAsync(process.execPath, ['--env-file-if-exists=.env', 'src/jobs.ts', name], {
    cwd: serverDir,
    encoding: 'utf8',
    env: {
      ...process.env,
      SUPABASE_URL: API, SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: SERVICE,
      EXPO_PUSH_URL: MOCK_URL, BACKGROUND_JOBS: 'off', SENTRY_DSN: '', NODE_ENV: 'development',
      ...extraEnv,
    },
    timeout: 180_000,
  });
  const last = out.trim().split('\n').pop();
  try { return JSON.parse(last); } catch { return last; }
}

async function service(path, { token, method = 'POST', body } = {}) {
  const response = await fetch(`${SERVICE_API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* html */ }
  return { status: response.status, json, text, headers: response.headers };
}

async function main() {
  section('preflight');
  const health = await fetch(`${SERVICE_API}/health`).then((r) => r.json()).catch(() => null);
  if (!health?.ok) {
    console.error(`\nThe API service is not answering at ${SERVICE_API}.`);
    process.exit(1);
  }
  check('the API service is up and reports the phase 7 capabilities',
    ['news', 'push', 'digest', 'backgroundJobs'].every((k) => k in health.capabilities), JSON.stringify(health.capabilities));
  check('background jobs are off in development unless asked for', health.capabilities.backgroundJobs === false);

  // ── fixtures ───────────────────────────────────────────────────────────────
  section('fixtures');
  const company = await admin.from('companies')
    .insert({ slug: `verify-phase7-${stamp}`, name: `Verify Seven ${stamp}`, industry: 'Testing' })
    .select('id, slug, name').single();
  if (company.error) { console.error(company.error.message); process.exit(1); }
  cleanup.push(() => admin.from('companies').delete().eq('id', company.data.id));

  const posting = (title, extra = {}) => ({
    company_id: company.data.id, company_name: company.data.name, title, title_normalized: title.toLowerCase(),
    seniority: 'intern', location_type: 'Remote', employment_type: 'Internship', skills: ['python'],
    description_text: 'verify:phase7', apply_url: `https://example.invalid/${stamp}/${encodeURIComponent(title)}`,
    status: 'open', closes_at: null, ...extra,
  });
  const jobs = await admin.from('jobs').insert([
    posting('Seven Closing Soon', { closes_at: new Date(Date.now() + 2 * 86_400_000).toISOString() }),
    posting('Seven Closing Later', { closes_at: new Date(Date.now() + 20 * 86_400_000).toISOString() }),
    posting('Seven Fresh A'),
    posting('Seven Fresh B'),
  ]).select('id, title');
  const jobId = (t) => jobs.data.find((j) => j.title === t).id;

  async function signIn(label) {
    const email = `verify-phase7-${label}-${stamp}@example.com`;
    const password = `verify-phase7-${stamp}-${label}`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error) throw new Error(created.error.message);
    const client = createClient(API, ANON, { auth: { persistSession: false } });
    const session = await client.auth.signInWithPassword({ email, password });
    cleanup.push(() => admin.auth.admin.deleteUser(created.data.user.id).catch(() => null));
    return { id: created.data.user.id, email, client, token: session.data.session.access_token };
  }
  const [ana, ben, cy, dee] = await Promise.all(['ana', 'ben', 'cy', 'dee'].map(signIn));
  check('four accounts exist', [ana, ben, cy, dee].every((u) => u.id));

  // ── news ───────────────────────────────────────────────────────────────────
  section('news: the parser');
  const probe = [
    "import { parseFeed, canonicalUrl, urlHash } from './src/news/feed.ts';",
    "const rss = `<rss><channel><item><title><![CDATA[Stripe &amp; friends hire 50 interns]]></title><link>https://www.stripe.com/blog/interns?utm_source=rss#top</link><pubDate>Mon, 28 Sep 2026 10:00:00 GMT</pubDate><description>&lt;p&gt;Big &lt;b&gt;news&lt;/b&gt;&lt;/p&gt;</description></item><item><title>No link</title></item></channel></rss>`;",
    "const atom = `<feed><entry><title>Atom one</title><link rel=\"alternate\" href=\"https://example.com/a/\"/><updated>2026-09-27T00:00:00Z</updated><summary>S</summary></entry></feed>`;",
    'const a = parseFeed(rss), b = parseFeed(atom);',
    "console.log(JSON.stringify({ rssCount: a.length, title: a[0]?.title, blurb: a[0]?.blurb, canon: canonicalUrl(a[0].url), atomUrl: b[0]?.url, atomDate: b[0]?.publishedAt,",
    "  sameHash: urlHash('https://www.example.com/x/?utm_medium=e&b=2&a=1#f') === urlHash('https://example.com/x?a=1&b=2') }));",
  ].join('\n');
  const parsed = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '--eval', probe], { cwd: serverDir, encoding: 'utf8' }).trim());
  check('RSS items are read, and an item with no link is dropped', parsed.rssCount === 1);
  check('CDATA and entities are decoded in titles', parsed.title === 'Stripe & friends hire 50 interns', parsed.title);
  check('escaped HTML in a description becomes plain text', parsed.blurb === 'Big news', parsed.blurb);
  check('tracking parameters, fragments and www. are stripped from the URL', parsed.canon === 'https://stripe.com/blog/interns', parsed.canon);
  check('Atom entries are read, alternate link and all', parsed.atomUrl === 'https://example.com/a/' && Boolean(parsed.atomDate));
  check('syndicated copies of one URL hash the same', parsed.sameHash === true);

  section('news: the table enforces §9');
  const tooLong = await admin.from('news_items').insert({
    category: 'industry', url: 'https://example.com/long', url_hash: `verify-long-${stamp}`, publisher: 'X', tag: 't',
    headline: 'h', summary: ['a', 'b', 'c', 'd'], published_at: new Date().toISOString(),
  });
  check('a summary of four sentences is refused', Boolean(tooLong.error), tooLong.error?.code);
  const bodyCol = await admin.from('news_items').select('body').limit(1);
  check('there is no column that could hold an article body', Boolean(bodyCol.error));

  section('news: a live ingest');
  if (!health.capabilities.news) {
    skip('live ingest', 'ANTHROPIC_API_KEY is not set');
  } else {
    const src = await admin.from('news_sources').select('id, name').eq('url', 'https://techcrunch.com/tag/layoffs/feed/').single();
    const t0 = Date.now();
    const run = JSON.parse(execFileSync(process.execPath, ['--env-file-if-exists=.env', '--input-type=module', '--eval',
      `import { ingestNews } from './src/news/ingest.ts'; console.log(JSON.stringify(await ingestNews({ sourceId: '${src.data.id}', perSource: 3, maxAgeDays: 60, ignoreEtag: true })));`],
      { cwd: serverDir, encoding: 'utf8', env: { ...process.env, SUPABASE_URL: API, SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: SERVICE, SENTRY_DSN: '' } }).trim().split('\n').pop());
    note('ingest', `${JSON.stringify(run)} in ${Date.now() - t0}ms`);
    const items = await admin.from('news_items').select('*').eq('source_id', src.data.id);
    check('stories were fetched and summarized', run.failed === 0 && items.data.length > 0, `${items.data.length} stories`);
    check('every story has 1–3 summary sentences and an attributed publisher',
      items.data.every((i) => i.summary.length >= 1 && i.summary.length <= 3 && i.publisher === 'TechCrunch'));
    check('each summary costs well under a cent, and says so',
      items.data.every((i) => Number(i.cost_usd) > 0 && Number(i.cost_usd) < 0.01 && i.model === (process.env.NEWS_MODEL ?? 'claude-haiku-4-5')),
      items.data.map((i) => `$${i.cost_usd}`).join(', '));
    note('a card', `${items.data[0]?.status} ${items.data[0]?.relevance_score} [${items.data[0]?.topic}] ${items.data[0]?.headline} → ${items.data[0]?.summary?.[0]}`);

    const again = JSON.parse(execFileSync(process.execPath, ['--env-file-if-exists=.env', '--input-type=module', '--eval',
      `import { ingestNews } from './src/news/ingest.ts'; console.log(JSON.stringify(await ingestNews({ sourceId: '${src.data.id}', perSource: 3, maxAgeDays: 60, ignoreEtag: true })));`],
      { cwd: serverDir, encoding: 'utf8', env: { ...process.env, SUPABASE_URL: API, SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: SERVICE, SENTRY_DSN: '' } }).trim().split('\n').pop());
    check('a second run summarizes nothing already seen — no story is paid for twice',
      again.published + again.suppressed === 0 || (await admin.from('news_items').select('id').eq('source_id', src.data.id)).data.length === items.data.length + again.published + again.suppressed,
      JSON.stringify(again));
  }

  section('news: what a reader sees');
  const published = await admin.from('news_items').insert({
    category: 'company', company_id: company.data.id, url: `https://example.com/${stamp}`, url_hash: `verify-pub-${stamp}`,
    publisher: 'Verify Wire', tag: 'Verify · Hiring', headline: 'Verify hires', summary: ['One.', 'Two.'],
    published_at: new Date().toISOString(), status: 'published', relevance_score: 0.9, topic: 'hiring',
  }).select('id').single();
  const suppressed = await admin.from('news_items').insert({
    category: 'industry', url: `https://example.com/s-${stamp}`, url_hash: `verify-sup-${stamp}`,
    publisher: 'Verify Wire', tag: 'x', headline: 'Webinar recap', summary: ['Meh.'],
    published_at: new Date().toISOString(), status: 'suppressed', relevance_score: 0.05,
  }).select('id').single();
  cleanup.push(() => admin.from('news_items').delete().in('id', [published.data.id, suppressed.data.id]));

  const feed = await ana.client.rpc('news_feed', { p_days: 14, p_limit: 300 });
  const ids = new Set((feed.data ?? []).map((r) => r.id));
  check('the feed carries published stories', ids.has(published.data.id));
  check('…and never suppressed ones', !ids.has(suppressed.data.id));
  const row = feed.data.find((r) => r.id === published.data.id);
  check('a company story names its company by slug', row?.company_slug === company.data.slug);
  const costCol = await ana.client.from('news_items').select('cost_usd').limit(1);
  check('model cost columns are not readable by clients', Boolean(costCol.error));

  const seen1 = await ana.client.rpc('mark_news_seen', { p_ids: [published.data.id, published.data.id] });
  const seen2 = await ana.client.rpc('mark_news_seen', { p_ids: [published.data.id] });
  const after = await ana.client.rpc('news_feed', { p_days: 14, p_limit: 300 });
  check('watching a story is durable, and idempotent',
    seen1.data === 1 && seen2.data === 0 && after.data.find((r) => r.id === published.data.id)?.seen === true);
  const benFeed = await ben.client.rpc('news_feed', { p_days: 14, p_limit: 300 });
  check('…and per reader', benFeed.data.find((r) => r.id === published.data.id)?.seen === false);

  // ── delivery ───────────────────────────────────────────────────────────────
  section('push: tokens');
  const bad = await ana.client.rpc('register_push_token', { p_token: 'not-a-token', p_platform: 'ios' });
  check('a malformed token is refused', Boolean(bad.error));
  const tokA = `ExponentPushToken[verify-${stamp}-ana]`;
  await ana.client.rpc('register_push_token', { p_token: tokA, p_platform: 'ios' });
  await ben.client.rpc('register_push_token', { p_token: DEAD, p_platform: 'android' });
  const moved = await ben.client.rpc('register_push_token', { p_token: tokA, p_platform: 'ios' });
  const owner = await admin.from('push_tokens').select('user_id').eq('token', tokA).single();
  check('a device that signs into another account moves to it', !moved.error && owner.data.user_id === ben.id);
  await ana.client.rpc('register_push_token', { p_token: tokA, p_platform: 'ios' });
  const unreg = await ben.client.rpc('unregister_push_token', { p_token: tokA });
  check('an account cannot unregister a device that is not its own', unreg.data === false);
  const direct = await ana.client.from('push_tokens').select('token');
  check('tokens are not readable by clients', Boolean(direct.error));

  section('push: delivery');
  const before = await admin.from('notifications').select('id').eq('push_state', 'pending');
  note('pending before', `${before.data.length}`);

  // A reply to Ana: pushed. A like: never pushed. A reply to Cy, who has no device: skipped.
  const insertN = (user, kind, payload) =>
    admin.from('notifications').insert({ user_id: user, kind, payload }).select('id, push_state').single();
  const reply = await insertN(ana.id, 'comment_reply', { job_id: jobId('Seven Fresh A'), actor_handle: 'quiet-otter-1234', reply_body: 'Good luck with the interview!' });
  const like = await insertN(ana.id, 'comment_like', { actor_handle: 'x' });
  const noDevice = await insertN(cy.id, 'comment_reply', { reply_body: 'hi' });
  const toDead = await insertN(ben.id, 'moderation', { headline: 'A comment was removed', detail: 'It broke the rules.' });
  const old = await insertN(ana.id, 'deadline', { headline: 'old' });
  await admin.from('notifications').update({ created_at: new Date(Date.now() - 2 * 86_400_000).toISOString() }).eq('id', old.data.id);
  check('a new notification is queued for push; a like is not', reply.data.push_state === 'pending' && like.data.push_state === 'none');

  const sent = await job('push');
  const state = async (id) => (await admin.from('notifications').select('push_state').eq('id', id).single()).data.push_state;
  check('the sender ran', typeof sent === 'number', JSON.stringify(sent));
  check('a reply reached Expo with its words and its route',
    expo.sent.some((m) => m.to === tokA && m.title === 'quiet-otter-1234 replied to you' && m.data.url === `/job/${jobId('Seven Fresh A')}`));
  check('…and is marked sent', (await state(reply.data.id)) === 'sent');
  check('a reader with no device is skipped, not sent', (await state(noDevice.data.id)) === 'skipped');
  check('a notification over a day old is skipped rather than pushed late', (await state(old.data.id)) === 'skipped');
  check('nothing on a lock screen names a real person', expo.sent.every((m) => !JSON.stringify(m).includes('@example.com')));
  const deadTok = await admin.from('push_tokens').select('disabled_at, disabled_reason').eq('token', DEAD).single();
  check('DeviceNotRegistered on the ticket retires the token', deadTok.data?.disabled_reason === 'DeviceNotRegistered',
    JSON.stringify({ tok: deadTok.data, err: deadTok.error?.message, deliveries: (await admin.from('push_deliveries').select('status, error, token_id')).data }));
  check('…and the push is recorded as failed', (await state(toDead.data.id)) === 'failed');

  // A preference is read at send time: Ana switches replies off, and the next one is skipped.
  await admin.rpc('set_notification_pref', { p_user_id: ana.id, p_channel: 'push', p_key: 'replies', p_value: false });
  const offReply = await insertN(ana.id, 'comment_reply', { reply_body: 'should not arrive' });
  const count = expo.sent.length;
  await job('push');
  check('a kind the reader switched off is skipped', (await state(offReply.data.id)) === 'skipped');
  check('running the sender again sends nothing twice', expo.sent.length === count);

  await admin.from('push_deliveries').update({ created_at: new Date(Date.now() - 20 * 60_000).toISOString() }).not('ticket_id', 'is', null);
  const receipts = await job('receipts');
  check('receipts are fetched for tickets old enough to have one', receipts >= 1 && expo.receiptAsks.length >= 1, String(receipts));
  const anaTok = await admin.from('push_tokens').select('disabled_reason').eq('token', tokA).single();
  check('a DeviceNotRegistered receipt retires that token too', anaTok.data.disabled_reason === 'DeviceNotRegistered');

  section('alerts and deadlines');
  await admin.from('company_follows').insert({ user_id: dee.id, company_id: company.data.id, created_at: new Date(Date.now() - 3 * 86_400_000).toISOString() });
  await admin.from('jobs').update({ first_seen_at: new Date(Date.now() - 3_600_000).toISOString() }).in('id', [jobId('Seven Fresh A'), jobId('Seven Fresh B')]);
  await admin.from('job_interactions').insert([
    { user_id: dee.id, job_id: jobId('Seven Closing Soon'), kind: 'save' },
    { user_id: dee.id, job_id: jobId('Seven Closing Later'), kind: 'save' },
  ]);
  await job('alerts');
  const deeN = await admin.from('notifications').select('kind, payload, subject_id').eq('user_id', dee.id);
  const alert = deeN.data.filter((n) => n.kind === 'job_alert');
  const deadlines = deeN.data.filter((n) => n.kind === 'deadline');
  check('one job alert, however many new postings', alert.length === 1 && alert[0].payload.count >= 2, JSON.stringify(alert[0]?.payload?.headline));
  check('a deadline reminder for the saved posting closing in two days', deadlines.length === 1 && deadlines[0].subject_id === jobId('Seven Closing Soon'));
  check('…and none for the one closing in twenty', !deadlines.some((d) => d.subject_id === jobId('Seven Closing Later')));
  await job('alerts');
  const deeN2 = await admin.from('notifications').select('id').eq('user_id', dee.id);
  check('running the generators again adds nothing — at most one alert a day', deeN2.data.length === deeN.data.length);

  section('the digest');
  const week = (() => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); })();
  const claim = await admin.rpc('claim_digest_batch', { p_week_start: week, p_limit: 500 });
  const deeDigest = (claim.data ?? []).find((d) => d.user_id === dee.id);
  check('a reader with news is claimed, with their address and their news',
    deeDigest && deeDigest.email === dee.email && deeDigest.content.closing.length === 1 && deeDigest.content.new_jobs.length >= 2);
  const reclaim = await admin.rpc('claim_digest_batch', { p_week_start: week, p_limit: 500 });
  check('a claimed reader is never claimed twice in a week', !(reclaim.data ?? []).some((d) => d.user_id === dee.id));
  const anaSend = await admin.from('digest_sends').select('status').eq('user_id', ana.id).eq('week_start', week).maybeSingle();
  check('a reader with nothing to say is skipped, not emailed', anaSend.data?.status === 'skipped');

  const rendered = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '--eval',
    `import { renderDigest, unsubscribeUrl, verifyUnsubscribe } from './src/notify/digest.ts';
     const u = unsubscribeUrl('${dee.id}');
     const r = renderDigest({ firstName: 'Dee', content: JSON.parse(${JSON.stringify(JSON.stringify(deeDigest?.content ?? {}))}), unsubscribe: u });
     const t = new URL(u).searchParams.get('t');
     console.log(JSON.stringify({ subject: r.subject, hasLink: r.html.includes('Unsubscribe') && r.text.includes(u), ok: verifyUnsubscribe('${dee.id}', 'email.digest', t), forged: verifyUnsubscribe('${ana.id}', 'email.digest', t), u }));`],
    { cwd: serverDir, encoding: 'utf8', env: { ...process.env, SUPABASE_URL: API, SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: SERVICE, PUBLIC_API_URL: SERVICE_API } }).trim().split('\n').pop());
  check('the email leads with what is closing', /closes this week/.test(rendered.subject), rendered.subject);
  check('every digest carries its unsubscribe link', rendered.hasLink);
  check('an unsubscribe token is valid for its reader and nobody else', rendered.ok === true && rendered.forged === false);

  const unsubGet = await service(`/unsubscribe${new URL(rendered.u).search}`, { method: 'GET' });
  const prefsAfterGet = await admin.from('user_preferences').select('notification_prefs').eq('user_id', dee.id).single();
  check('opening the link changes nothing — scanners follow links', unsubGet.status === 200 && prefsAfterGet.data.notification_prefs?.email?.digest !== false);
  const unsubPost = await service(`/unsubscribe${new URL(rendered.u).search}`, { method: 'POST' });
  const prefsAfter = await admin.from('user_preferences').select('notification_prefs').eq('user_id', dee.id).single();
  check('one click (POST) unsubscribes, with no login', unsubPost.status === 200 && prefsAfter.data.notification_prefs.email.digest === false);
  const forgedPost = await service(`/unsubscribe?u=${ana.id}&s=email.digest&t=${new URL(rendered.u).searchParams.get('t')}`, { method: 'POST' });
  check('a token for one reader cannot unsubscribe another', forgedPost.status === 400);

  // ── privacy ────────────────────────────────────────────────────────────────
  section('export');
  await ana.client.from('applications').insert({ job_id: jobId('Seven Fresh A'), source: 'company', applied_at: new Date().toISOString().slice(0, 10) });
  const exp = await service('/v1/me/export', { token: ana.token });
  check('a reader can export everything', exp.status === 200 && exp.json?.account_id === ana.id, `${exp.status}`);
  check('the export is a download, never cached', /attachment/.test(exp.headers.get('content-disposition') ?? '') && exp.headers.get('cache-control') === 'no-store');
  const keys = Object.keys(exp.json ?? {});
  check('it covers profile, applications, comments, credits, runs, devices and who accessed their data',
    ['profile', 'applications', 'comments', 'credits', 'auto_apply_runs', 'devices', 'who_accessed_your_data', 'email'].every((k) => keys.includes(k)),
    `${keys.length} sections`);
  check('it includes the application just made', exp.json?.applications?.some((a) => a.job_id === jobId('Seven Fresh A')));
  check('it does not include verification hashes or store transaction ids', !/token_hash|original_transaction_id/.test(exp.text));
  const again2 = await service('/v1/me/export', { token: ana.token });
  check('one export a day', again2.status === 429 && again2.json?.code === 'rate_limited');

  section('deletion');
  // Cy writes a comment, then asks to be deleted.
  const cyComment = await admin.from('comments').insert({ job_id: jobId('Seven Fresh A'), author_id: cy.id, body: 'Cy was here', moderation_status: 'approved' }).select('id').single();
  check('(fixture) Cy has a comment', !cyComment.error, cyComment.error?.message);
  await admin.from('job_impressions').insert({ user_id: cy.id, job_id: jobId('Seven Fresh A'), surface: 'reels', session_id: crypto.randomUUID() });

  const req = await cy.client.rpc('request_account_deletion');
  check('a reader can ask to be deleted, with 30 days to change their mind',
    !req.error && Math.round((new Date(req.data.purge_after) - new Date(req.data.deletion_requested_at)) / 86_400_000) === 30);
  const hidden = await cy.client.from('profiles').select('id').eq('id', cy.id);
  check('the account is disabled at once: the profile is no longer readable', !hidden.error && hidden.data.length === 0);
  const status = await cy.client.rpc('my_account_status');
  check('…but the app can still ask why', status.data?.purge_after === req.data.purge_after);
  const twice = await cy.client.rpc('request_account_deletion');
  check('asking twice is one request', twice.data?.purge_after === req.data.purge_after);

  const early = await job('purge');
  check('nothing is purged before the grace ends', early === 0 && (await admin.auth.admin.getUserById(cy.id)).data.user !== null);

  const cancel = await cy.client.rpc('cancel_account_deletion');
  const back = await cy.client.from('profiles').select('id').eq('id', cy.id);
  check('cancelling restores the account', cancel.data === true && back.data.length === 1);

  await cy.client.rpc('request_account_deletion');
  await admin.from('deletion_requests').update({ purge_after: new Date(Date.now() - 1000).toISOString() }).eq('user_id', cy.id).is('completed_at', null).is('cancelled_at', null);
  const purged = await job('purge');
  check('once the grace ends, the purge runs', purged === 1, JSON.stringify(purged));
  check('the auth account is gone', !(await admin.auth.admin.getUserById(cy.id)).data.user);
  check('the profile and everything keyed on it went with it',
    (await admin.from('profiles').select('id').eq('id', cy.id)).data.length === 0);
  const tomb = await admin.from('system_accounts').select('user_id').eq('role', 'tombstone').single();
  const kept = await admin.from('comments').select('author_id, body').eq('id', cyComment.data.id).single();
  check('the comment survives, anonymized to the tombstone', kept.data?.author_id === tomb.data?.user_id && kept.data?.body === 'Cy was here');
  const pub = await ana.client.from('comments_public').select('author_handle').eq('id', cyComment.data.id).single();
  check('…and reads as a deleted account in the thread', pub.data?.author_handle === 'deleted-account', pub.data?.author_handle);
  const imp = await admin.from('job_impressions').select('user_id').eq('user_id', cy.id);
  check('impressions are dissociated, not left pointing at the old id', imp.data.length === 0);
  const record = await admin.from('deletion_requests').select('completed_at, purge_detail').eq('user_id', cy.id).not('completed_at', 'is', null).single();
  check('the request survives as the record that deletion happened',
    Boolean(record.data?.completed_at) && record.data.purge_detail.comments_anonymized === 1, JSON.stringify(record.data?.purge_detail));
  const tombLogin = await createClient(API, ANON, { auth: { persistSession: false } }).auth.signInWithPassword({ email: 'deleted-account@careerdeck.invalid', password: 'anything' });
  check('the tombstone cannot sign in', Boolean(tombLogin.error));

  for (const fn of ['claim_push_batch', 'generate_job_alerts', 'claim_digest_batch', 'begin_account_purge', 'export_account', 'set_notification_pref']) {
    const r = await ana.client.rpc(fn, {});
    check(`a reader cannot call ${fn}()`, Boolean(r.error) && (r.error.code === '42501' || /permission|not find/i.test(r.error.message)), r.error?.code);
  }
}

try {
  await main();
} catch (error) {
  failures += 1;
  console.error('\nUnexpected error:', error);
} finally {
  for (const undo of cleanup.reverse()) { try { await undo(); } catch { /* best effort */ } }
  mock.close();
}

console.log('');
if (failures > 0) { console.log(`${failures} check(s) failed.`); process.exit(1); }
console.log(skipped > 0
  ? `All checks passed, ${skipped} skipped — the live news ingest was not exercised.`
  : 'Phase 7 verified: news is summarized and attributed, notifications reach devices once, and a reader can take their data or leave.');
