/**
 * The internal review queue — §10: *"Human review queue: a small internal web view over
 * `reports` and flagged comments. Build it before launch, not after the first incident."*
 *
 * Before launch, so it is here. Small, so it is one HTML page with no build step, no framework
 * and no bundler: a `<script type="module">` that signs in against Supabase with the publishable
 * key and calls the two JSON routes below. A review tool that needs its own deploy pipeline is a
 * review tool that is broken on the evening it is first needed.
 *
 * ── Who gets in ───────────────────────────────────────────────────────────────
 *
 * A row in `moderators`, checked by `is_moderator()` on every request. Not a claim in a JWT, not
 * an environment variable holding a shared password: a real account, revocable by deleting a
 * row, and attributable — `moderation_actions` would be pointless if two people shared a login.
 * Moderator accounts are made by hand with the service role (see docs/PHASE3.md §7), because
 * granting yourself moderator is exactly the escalation this is guarding.
 *
 * ── What a reviewer can see that nobody else can ──────────────────────────────
 *
 * `author_id`, the account's tier, and its strike count. §3.8's projection hides those from
 * *users*, not from us — the whole anonymity bargain is that we know who wrote it. Deciding
 * between a warning and a ban is impossible without the history, and a reviewer who cannot see
 * that a handle is on its third strike will warn them a third time.
 */

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { createMiddleware } from 'hono/factory';

import { adminClient, type AuthedUser } from '../auth.ts';
import { env } from '../env.ts';

type Env = { Variables: { user: AuthedUser } };

export const moderation = new Hono<Env>();
/** The page itself, served outside `/v1` because a browser arrives with no bearer token. */
export const reviewPage = new Hono();

const requireModerator = createMiddleware<Env>(async (c, next) => {
  const user = c.get('user');
  const { data, error } = await adminClient.rpc('is_moderator', { p_user_id: user.id });
  if (error) throw error;
  if (data !== true) {
    // 404, not 403. An endpoint that admits to existing is an endpoint worth probing.
    throw new HTTPException(404, { message: 'Not found.' });
  }
  await next();
});

moderation.use('*', requireModerator);

moderation.get('/queue', async (c) => {
  const limit = Number.parseInt(c.req.query('limit') ?? '50', 10);
  const { data, error } = await adminClient.rpc('moderation_queue', {
    p_limit: Number.isFinite(limit) ? limit : 50,
  });
  if (error) throw error;
  return c.json({ items: data ?? [] });
});

moderation.post('/resolve', async (c) => {
  const user = c.get('user');
  const payload = (await c.req.json().catch(() => ({}))) as {
    commentId?: unknown;
    status?: unknown;
    reason?: unknown;
    strike?: unknown;
    severity?: unknown;
  };

  const commentId = typeof payload.commentId === 'string' ? payload.commentId : null;
  const status = payload.status;

  if (!commentId || (status !== 'approved' && status !== 'removed' && status !== 'flagged')) {
    throw new HTTPException(422, { message: 'commentId and a status of approved/removed/flagged are required.' });
  }

  const strike = payload.strike === true;
  const severity =
    typeof payload.severity === 'number' && payload.severity >= 1 && payload.severity <= 3
      ? payload.severity
      : null;

  /*
   * A ban is the one action that is not simply reversible: it burns the `.edu` address or the
   * vendor reference, so the person cannot come back on the same credential. `moderators.can_ban`
   * gates it separately from the rest of the queue, so a new reviewer can work reports on their
   * first day without being able to permanently remove somebody.
   */
  if (strike && severity === 3) {
    const { data: canBan } = await adminClient
      .from('moderators')
      .select('can_ban')
      .eq('user_id', user.id)
      .maybeSingle();

    if (canBan?.can_ban !== true) {
      throw new HTTPException(403, { message: 'This account cannot issue bans.' });
    }
  }

  const { data, error } = await adminClient.rpc('moderation_resolve', {
    p_comment_id: commentId,
    p_status: status,
    p_reason: typeof payload.reason === 'string' ? payload.reason : '',
    p_moderator: user.id,
    p_strike: strike,
    p_severity: severity,
  });

  if (error) throw error;
  return c.json({ resolved: Array.isArray(data) ? data[0] : data });
});

moderation.post('/reports/resolve', async (c) => {
  const user = c.get('user');
  const payload = (await c.req.json().catch(() => ({}))) as { reportId?: unknown; status?: unknown };

  const reportId = typeof payload.reportId === 'string' ? payload.reportId : null;
  const status = payload.status;

  if (!reportId || (status !== 'actioned' && status !== 'dismissed')) {
    throw new HTTPException(422, { message: 'reportId and a status of actioned/dismissed are required.' });
  }

  const { data, error } = await adminClient.rpc('resolve_report', {
    p_report_id: reportId,
    p_status: status,
    p_moderator: user.id,
  });

  if (error) throw error;
  return c.json({ resolved: data === true });
});

// ── the page ───────────────────────────────────────────────────────────────────

/*
 * One file, inlined, with the publishable key substituted in. The key is designed to be public —
 * it is in the app bundle already — and everything behind it is RLS plus `is_moderator()`, so
 * putting it in a page changes nothing about who can do what.
 *
 * Deliberately ugly-but-legible rather than designed. The reviewer's job is to read a sentence and
 * make a decision in a few seconds; what that needs is the text at a readable size, the strike
 * count next to it, and buttons that cannot be confused with each other.
 */
function page(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>CareerDeck review queue</title>
<style>
  :root { color-scheme: light dark; --bg:#f6f6f7; --card:#fff; --text:#111114; --muted:#6b6b76;
          --line:#e4e4e9; --danger:#b3261e; --ok:#1f6f43; --warn:#8a5a00; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#0e0e11; --card:#17171c; --text:#f2f2f5; --muted:#9a9aa6; --line:#2a2a33;
            --danger:#f2b8b5; --ok:#7fd1a4; --warn:#e8c266; }
  }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:15px/1.5 -apple-system,
         BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; padding:24px 16px 64px; }
  main { max-width: 780px; margin: 0 auto; }
  h1 { font-size:20px; letter-spacing:-0.4px; margin:0 0 4px; }
  .sub { color:var(--muted); font-size:13px; margin:0 0 24px; }
  form.signin { background:var(--card); border:1px solid var(--line); border-radius:14px;
                padding:20px; display:grid; gap:10px; max-width:360px; }
  input, textarea, button, select { font:inherit; }
  input, textarea { padding:10px 12px; border:1px solid var(--line); border-radius:10px;
                    background:var(--bg); color:var(--text); width:100%; }
  button { padding:9px 14px; border-radius:10px; border:1px solid var(--line);
           background:var(--card); color:var(--text); cursor:pointer; }
  button.primary { background:var(--text); color:var(--bg); border-color:var(--text); }
  button.danger { color:var(--danger); border-color:var(--danger); }
  button:disabled { opacity:.5; cursor:default; }
  .item { background:var(--card); border:1px solid var(--line); border-radius:14px;
          padding:16px; margin-bottom:14px; }
  .meta { display:flex; flex-wrap:wrap; gap:8px; align-items:center; font-size:12px;
          color:var(--muted); margin-bottom:10px; }
  .tag { border:1px solid var(--line); border-radius:999px; padding:2px 8px; }
  .tag.report { color:var(--danger); border-color:var(--danger); }
  .tag.strikes { color:var(--warn); border-color:var(--warn); }
  .body { font-size:16px; white-space:pre-wrap; overflow-wrap:anywhere; margin:0 0 12px; }
  .reasons { font-size:13px; color:var(--muted); margin:0 0 12px; }
  .actions { display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
  .actions textarea { min-height:38px; }
  .empty { color:var(--muted); padding:32px 0; text-align:center; }
  .error { color:var(--danger); font-size:13px; }
  label.check { display:flex; gap:6px; align-items:center; font-size:13px; color:var(--muted); }
</style>
</head>
<body>
<main>
  <h1>Review queue</h1>
  <p class="sub">Reported comments first, then flagged. Target: 24h on reports, 1h on threats.</p>
  <div id="root"></div>
</main>
<script type="module">
const SUPABASE_URL = ${JSON.stringify(env.supabaseUrl)};
const SUPABASE_KEY = ${JSON.stringify(env.supabaseAnonKey)};
const root = document.getElementById('root');
let token = sessionStorage.getItem('careerdeck.review.token') || null;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);

function signinView(message) {
  root.innerHTML = \`
    <form class="signin" id="signin">
      <input name="email" type="email" placeholder="Moderator email" autocomplete="username" required>
      <input name="password" type="password" placeholder="Password" autocomplete="current-password" required>
      <button class="primary" type="submit">Sign in</button>
      \${message ? '<p class="error">' + esc(message) + '</p>' : ''}
    </form>\`;

  document.getElementById('signin').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    const res = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ email: form.get('email'), password: form.get('password') }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.access_token) return signinView(json.error_description || json.msg || 'Sign-in failed.');
    token = json.access_token;
    sessionStorage.setItem('careerdeck.review.token', token);
    load();
  });
}

async function api(path, options = {}) {
  const res = await fetch('/v1/moderation' + path, {
    ...options,
    headers: { ...(options.headers || {}), authorization: 'Bearer ' + token,
               'content-type': 'application/json' },
  });
  if (res.status === 401) { token = null; sessionStorage.removeItem('careerdeck.review.token');
    signinView('That session expired.'); throw new Error('unauthenticated'); }
  if (res.status === 404) { signinView('That account is not a moderator.'); throw new Error('not a moderator'); }
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  return res.json();
}

function itemView(item) {
  const reasons = (item.reasons || []).filter(Boolean);
  const details = (item.details || []).filter(Boolean);
  return \`
  <div class="item" data-id="\${esc(item.comment_id)}">
    <div class="meta">
      <span class="tag \${item.kind === 'report' ? 'report' : ''}">\${esc(item.kind)}</span>
      <span class="tag">\${esc(item.author_handle)}</span>
      <span class="tag">\${esc(item.author_badge || item.author_tier)}</span>
      \${item.prior_strikes > 0 ? '<span class="tag strikes">' + item.prior_strikes + ' prior strike(s)</span>' : ''}
      \${item.report_count > 0 ? '<span class="tag report">' + item.report_count + ' report(s)</span>' : ''}
      <span>\${esc(new Date(item.created_at).toLocaleString())}</span>
    </div>
    <p class="body">\${esc(item.body) || '<em>GIF only</em>'}</p>
    \${item.moderation_reason ? '<p class="reasons">classifier: ' + esc(item.moderation_reason) + '</p>' : ''}
    \${reasons.length ? '<p class="reasons">reported for: ' + esc(reasons.join(', ')) + '</p>' : ''}
    \${details.length ? '<p class="reasons">' + details.map((d) => '“' + esc(d) + '”').join(' ') + '</p>' : ''}
    <div class="actions">
      <textarea placeholder="Reason (shown to the author on a removal)"></textarea>
      <label class="check"><input type="checkbox" class="strike"> strike</label>
      <select class="severity">
        <option value="">escalate</option>
        <option value="1">warn</option>
        <option value="2">7-day mute</option>
        <option value="3">ban</option>
      </select>
      <button data-act="approved">Keep</button>
      <button class="danger" data-act="removed">Remove</button>
    </div>
  </div>\`;
}

async function load() {
  if (!token) return signinView();
  let data;
  try { data = await api('/queue'); } catch { return; }

  if (!data.items.length) {
    root.innerHTML = '<p class="empty">Nothing waiting. Both targets are met.</p>';
    return;
  }

  root.innerHTML = data.items.map(itemView).join('');

  root.querySelectorAll('button[data-act]').forEach((button) => {
    button.addEventListener('click', async () => {
      const item = button.closest('.item');
      const severity = item.querySelector('.severity').value;
      button.disabled = true;
      try {
        await api('/resolve', { method: 'POST', body: JSON.stringify({
          commentId: item.dataset.id,
          status: button.dataset.act,
          reason: item.querySelector('textarea').value,
          strike: item.querySelector('.strike').checked,
          severity: severity ? Number(severity) : undefined,
        }) });
        item.remove();
        if (!root.querySelector('.item')) load();
      } catch (error) {
        button.disabled = false;
        const note = document.createElement('p');
        note.className = 'error';
        note.textContent = error.message;
        item.append(note);
      }
    });
  });
}

load();
</script>
</body>
</html>`;
}

reviewPage.get('/', (c) => {
  // No-store and noindex: the page embeds nothing secret, but a cached copy of a moderation tool
  // in a shared browser is still not something to leave lying around.
  c.header('cache-control', 'no-store');
  c.header('x-robots-tag', 'noindex, nofollow');
  return c.html(page());
});
