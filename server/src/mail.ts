/**
 * The one email this service sends: the six-digit code that confirms a `.edu` address.
 *
 * Over `fetch` rather than through an SDK, and through Resend rather than SMTP, for the same
 * reason the ingest crawlers are hand-written HTTP — one POST does not earn a dependency, and
 * an SMTP client would.
 *
 * ── Why this is not Supabase Auth ─────────────────────────────────────────────
 *
 * Supabase already sends a six-digit code at sign-in, with a template in
 * `supabase/templates/magic-link.html`, and reusing it would have cost nothing. It cannot be
 * reused: Auth sends to the *account's* address, and the whole point of §3.2's edu path is to
 * prove control of a **second** address the account does not sign in with. The only way to
 * make Auth do it is `updateUser({ email })`, which changes the address they log in with —
 * a student who verifies with a university address they lose at graduation would then lose
 * the account too.
 *
 * ── Without a provider ────────────────────────────────────────────────────────
 *
 * In development the code is returned in the response and logged, so the flow is testable on a
 * clone of this repo with no accounts anywhere. In production that path is refused outright:
 * a verification code in an HTTP response is not a verification, it is a formality, and the
 * tier it grants is what unlocks commenting.
 */

import { env } from './env.ts';

export interface EduCodeEmail {
  to: string;
  code: string;
  /** "Purdue", so the subject line names the school and does not read as phishing. */
  schoolName: string;
  /** Minutes until the code expires, stated in the body because it is the next question. */
  expiresInMinutes: number;
}

export class MailNotConfigured extends Error {
  constructor() {
    super(
      'RESEND_API_KEY is not set, so verification codes cannot be delivered. Set it, or run ' +
        'with NODE_ENV=development, where the code is returned in the response instead.',
    );
    this.name = 'MailNotConfigured';
  }
}

function body(email: EduCodeEmail): { subject: string; html: string; text: string } {
  const subject = `Your CareerDeck code for ${email.schoolName}`;

  /*
   * Deliberately plain, and deliberately explicit about what the code does. A student who
   * asked for this thirty seconds ago should recognise it instantly; a student who did not
   * should be able to tell that ignoring it costs them nothing.
   */
  const text = [
    `${email.code}`,
    '',
    `Enter this code in CareerDeck to confirm your ${email.schoolName} email address.`,
    `It expires in ${email.expiresInMinutes} minutes and can only be used once.`,
    '',
    'Confirming lets you comment on job postings. Your comments never show your name or your',
    'email address — only your major, school and graduation year.',
    '',
    'If you did not ask for this, ignore it. Nothing happens until the code is entered.',
  ].join('\n');

  const html = `<!doctype html>
<html lang="en"><body style="margin:0;padding:32px 16px;background:#f6f6f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:420px;background:#ffffff;border-radius:18px;padding:32px;">
      <tr><td style="font-size:20px;font-weight:700;color:#111114;letter-spacing:-0.4px;padding-bottom:8px;">CareerDeck</td></tr>
      <tr><td style="font-size:15px;color:#5c5c68;line-height:22px;padding-bottom:24px;">
        Enter this code in CareerDeck to confirm your ${escapeHtml(email.schoolName)} email address.
        It expires in ${email.expiresInMinutes} minutes.
      </td></tr>
      <tr><td align="center" style="padding-bottom:24px;">
        <div style="font-size:34px;font-weight:700;letter-spacing:8px;color:#111114;">${escapeHtml(email.code)}</div>
      </td></tr>
      <tr><td style="font-size:13px;color:#8a8a96;line-height:20px;">
        Confirming lets you comment on job postings. Your comments never show your name or your
        email address — only your major, school and graduation year.
        <br><br>
        If you did not ask for this, ignore it. Nothing happens until the code is entered.
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;

  return { subject, html, text };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      default: return '&#39;';
    }
  });
}

/**
 * Sends the code, or returns it.
 *
 * `delivered: false` means the caller must hand the code back to the client, and only happens
 * outside production. Returning the code from a production build would be a way to verify any
 * address in the world.
 */
export async function sendEduCode(email: EduCodeEmail): Promise<{ delivered: boolean }> {
  if (!env.resendApiKey) {
    if (env.isProduction) throw new MailNotConfigured();
    console.log(`[verify] code for ${email.to}: ${email.code}`);
    return { delivered: false };
  }

  const { subject, html, text } = body(email);

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.resendApiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ from: env.verificationFromEmail, to: [email.to], subject, html, text }),
    // A verification email is a foreground action with a person waiting on it. Ten seconds is
    // already past the point where they will press the button again.
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    /*
     * The provider's own message, truncated. It is the difference between "email failed" and
     * "this domain is not verified with Resend", and the second one is the actual bug in
     * every case this will hit in practice.
     */
    const detail = await response.text().catch(() => '');
    throw new Error(`Resend refused the message (${response.status}): ${detail.slice(0, 300)}`);
  }

  return { delivered: true };
}
