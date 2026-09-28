/**
 * `/unsubscribe` — the digest's opt-out, honoured without a login (CAN-SPAM) and in one click from
 * the mail client (RFC 8058).
 *
 * GET shows a confirmation page and changes nothing: mail security scanners follow every link in
 * an email, and an unsubscribe that fired on GET would quietly unsubscribe everyone whose employer
 * scans their inbox. POST is the change — it is what the page's button sends and what Gmail and
 * Yahoo send for `List-Unsubscribe-Post: List-Unsubscribe=One-Click`.
 */

import { Hono } from 'hono';

import { adminClient } from './auth.ts';
import { escapeHtml } from './mail.ts';
import { verifyUnsubscribe } from './notify/digest.ts';

export const unsubscribe = new Hono();

const SCOPES: Record<string, { channel: string; key: string; label: string }> = {
  'email.digest': { channel: 'email', key: 'digest', label: 'the weekly CareerDeck digest' },
};

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:48px 16px;background:#f6f6f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111114;">
<div style="max-width:420px;margin:0 auto;background:#fff;border-radius:18px;padding:28px;">${body}</div></body></html>`;
}

function params(url: string, form?: Record<string, unknown>) {
  const q = new URL(url).searchParams;
  const pick = (k: string) => (typeof form?.[k] === 'string' ? (form[k] as string) : q.get(k) ?? '');
  return { u: pick('u'), s: pick('s') || 'email.digest', t: pick('t') };
}

unsubscribe.get('/', (c) => {
  const { u, s, t } = params(c.req.url);
  const scope = SCOPES[s];
  if (!scope || !verifyUnsubscribe(u, s, t)) {
    return c.html(page('Link not valid', '<h2>This link is not valid</h2><p>Turn off emails in CareerDeck → Settings instead.</p>'), 400);
  }
  return c.html(page('Unsubscribe', `<h2 style="margin-top:0">Stop ${escapeHtml(scope.label)}?</h2>
<form method="post"><input type="hidden" name="u" value="${escapeHtml(u)}"><input type="hidden" name="s" value="${escapeHtml(s)}"><input type="hidden" name="t" value="${escapeHtml(t)}">
<button type="submit" style="font-size:15px;padding:12px 20px;border-radius:12px;border:0;background:#111114;color:#fff;">Unsubscribe</button></form>`));
});

unsubscribe.post('/', async (c) => {
  const form = await c.req.parseBody().catch(() => ({}));
  const { u, s, t } = params(c.req.url, form as Record<string, unknown>);
  const scope = SCOPES[s];
  if (!scope || !verifyUnsubscribe(u, s, t)) {
    return c.html(page('Link not valid', '<h2>This link is not valid</h2>'), 400);
  }

  const { error } = await adminClient.rpc('set_notification_pref', {
    p_user_id: u, p_channel: scope.channel, p_key: scope.key, p_value: false,
  });
  if (error) throw error;

  return c.html(page('Unsubscribed', `<h2 style="margin-top:0">Done</h2><p>You won't get ${escapeHtml(scope.label)} any more. You can turn it back on in Settings.</p>`));
});
