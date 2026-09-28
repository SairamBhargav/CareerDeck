/**
 * The weekly digest email — §15's "digest emails".
 *
 * One email a week, Monday afternoon UTC (Monday morning across the US), to readers who have
 * something worth a line: new postings at companies they follow, or saved postings about to close.
 * `claim_digest_batch()` decides who and what; this file renders and sends.
 *
 * ── The law, which is most of the design ──────────────────────────────────────
 *
 * A digest is commercial email under CAN-SPAM, so every send carries:
 *
 *  - a working unsubscribe link, honoured without a login — HMAC-signed, so it needs no session
 *    and cannot be forged for somebody else's account;
 *  - `List-Unsubscribe` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058), which
 *    Gmail and Yahoo require of bulk senders and which put the button in the mail client itself;
 *  - a physical postal address (`DIGEST_POSTAL_ADDRESS`), required in production.
 *
 * `capabilities.digest` is false unless all of those can be met, and nothing sends while it is.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

import { adminClient } from '../auth.ts';
import { capabilities, env } from '../env.ts';
import { escapeHtml } from '../mail.ts';

export interface DigestContent {
  new_jobs: { id: string; title: string; company: string; location: string | null }[];
  closing: { id: string; title: string; company: string; closes_at: string }[];
  goal: { target: number; last_week: number };
  credits: number;
}

// ── unsubscribe tokens ─────────────────────────────────────────────────────────

function sign(userId: string, scope: string): string {
  return createHmac('sha256', env.unsubscribeSecret).update(`${userId}:${scope}`).digest('base64url');
}

export function unsubscribeUrl(userId: string, scope = 'email.digest'): string {
  const base = (env.publicApiUrl ?? 'http://localhost:8787').replace(/\/$/, '');
  return `${base}/unsubscribe?u=${encodeURIComponent(userId)}&s=${encodeURIComponent(scope)}&t=${sign(userId, scope)}`;
}

export function verifyUnsubscribe(userId: string, scope: string, token: string): boolean {
  const expected = Buffer.from(sign(userId, scope));
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

// ── rendering ──────────────────────────────────────────────────────────────────

/** Monday of the current UTC week, as YYYY-MM-DD. */
export function currentWeekStart(now = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

function closesIn(iso: string): string {
  const days = Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
  return days <= 1 ? 'closes within a day' : `closes in ${days} days`;
}

/** Subject, HTML and text for one reader. Pure — exported so verification can read what it says. */
export function renderDigest(input: { firstName: string | null; content: DigestContent; unsubscribe: string }) {
  const { content } = input;
  const hello = input.firstName ? `Hi ${input.firstName},` : 'Hi,';

  const subject =
    content.closing.length > 0
      ? `${content.closing.length} saved ${content.closing.length === 1 ? 'role closes' : 'roles close'} this week`
      : `${content.new_jobs.length} new ${content.new_jobs.length === 1 ? 'role' : 'roles'} at companies you follow`;

  const goalLine = content.goal.last_week >= content.goal.target
    ? `Last week you hit your goal: ${content.goal.last_week} of ${content.goal.target} applications.`
    : `Last week: ${content.goal.last_week} of ${content.goal.target} applications. A fresh week starts now.`;

  const footer = [
    'You get this because weekly digests are on in CareerDeck.',
    `Unsubscribe: ${input.unsubscribe}`,
    env.digestPostalAddress ?? '',
  ].filter(Boolean);

  const text = [
    hello,
    '',
    ...(content.closing.length > 0
      ? ['Closing soon — you saved these:', ...content.closing.map((j) => `- ${j.title}, ${j.company} (${closesIn(j.closes_at)})`), '']
      : []),
    ...(content.new_jobs.length > 0
      ? ['New at companies you follow:', ...content.new_jobs.map((j) => `- ${j.title}, ${j.company}${j.location ? ` · ${j.location}` : ''}`), '']
      : []),
    goalLine,
    `You have ${content.credits} Auto ${content.credits === 1 ? 'Apply' : 'Applies'} ready.`,
    '',
    ...footer,
  ].join('\n');

  const row = (title: string, sub: string) =>
    `<tr><td style="padding:10px 0;border-bottom:1px solid #eeeef1;"><div style="font-size:15px;font-weight:600;color:#111114;">${escapeHtml(title)}</div><div style="font-size:13px;color:#6b6b78;padding-top:2px;">${escapeHtml(sub)}</div></td></tr>`;
  const section = (heading: string, rows: string) =>
    `<tr><td style="font-size:12px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;color:#8a8a96;padding:20px 0 4px;">${escapeHtml(heading)}</td></tr>${rows}`;

  const html = `<!doctype html>
<html lang="en"><body style="margin:0;padding:32px 16px;background:#f6f6f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:18px;padding:28px;">
      <tr><td style="font-size:20px;font-weight:700;color:#111114;letter-spacing:-0.4px;padding-bottom:6px;">CareerDeck</td></tr>
      <tr><td style="font-size:15px;color:#5c5c68;line-height:22px;">${escapeHtml(hello)}</td></tr>
      ${content.closing.length > 0 ? section('Closing soon — you saved these', content.closing.map((j) => row(j.title, `${j.company} · ${closesIn(j.closes_at)}`)).join('')) : ''}
      ${content.new_jobs.length > 0 ? section('New at companies you follow', content.new_jobs.map((j) => row(j.title, [j.company, j.location].filter(Boolean).join(' · '))).join('')) : ''}
      <tr><td style="font-size:14px;color:#5c5c68;line-height:21px;padding-top:20px;">${escapeHtml(goalLine)}<br>You have ${content.credits} Auto ${content.credits === 1 ? 'Apply' : 'Applies'} ready.</td></tr>
      <tr><td style="font-size:12px;color:#9a9aa6;line-height:18px;padding-top:24px;">
        You get this because weekly digests are on in CareerDeck.
        <a href="${escapeHtml(input.unsubscribe)}" style="color:#6b6b78;">Unsubscribe</a>.
        ${env.digestPostalAddress ? `<br>${escapeHtml(env.digestPostalAddress)}` : ''}
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;

  return { subject, html, text };
}

// ── sending ────────────────────────────────────────────────────────────────────

/**
 * Sends one batch of this week's digests. Resumable and safe to run concurrently: readers are
 * claimed in the database before anything is sent, so a crash leaves a `sending` row and never a
 * second email.
 */
export async function sendDigestBatch(limit = 50, weekStart = currentWeekStart()): Promise<{ sent: number; failed: number }> {
  if (!capabilities.digest) return { sent: 0, failed: 0 };

  const { data, error } = await adminClient.rpc('claim_digest_batch', { p_week_start: weekStart, p_limit: limit });
  if (error) throw error;
  const jobs = (data ?? []) as { user_id: string; email: string; first_name: string | null; content: DigestContent }[];

  let sent = 0;
  let failed = 0;
  for (const job of jobs) {
    const unsubscribe = unsubscribeUrl(job.user_id);
    const { subject, html, text } = renderDigest({ firstName: job.first_name, content: job.content, unsubscribe });

    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${env.resendApiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          from: env.digestFromEmail,
          to: [job.email],
          subject,
          html,
          text,
          headers: {
            'List-Unsubscribe': `<${unsubscribe}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
        }),
        signal: AbortSignal.timeout(15_000),
      });
      const body = (await response.json().catch(() => null)) as { id?: string; message?: string } | null;
      if (!response.ok) throw new Error(`Resend ${response.status}: ${body?.message ?? ''}`);

      await adminClient.rpc('record_digest_result', {
        p_user_id: job.user_id, p_week_start: weekStart, p_status: 'sent', p_provider_id: body?.id ?? null,
      });
      sent += 1;
    } catch (failure) {
      failed += 1;
      await adminClient.rpc('record_digest_result', {
        p_user_id: job.user_id, p_week_start: weekStart, p_status: 'failed',
        p_error: failure instanceof Error ? failure.message : String(failure),
      });
    }
  }
  return { sent, failed };
}
