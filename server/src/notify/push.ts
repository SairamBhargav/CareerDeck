/**
 * Push delivery through Expo's push service — §15's "push notifications (job alerts, deadlines,
 * replies)".
 *
 * Two-phase, the way Expo's API is:
 *
 *  1. **Send.** `claim_push_batch()` hands over pending notifications with the reader's live
 *     tokens, already filtered for preferences, deleted accounts and staleness. Each becomes one
 *     message per device, posted in chunks of 100. Expo answers with a *ticket* per message.
 *  2. **Receipts.** Roughly fifteen minutes later Expo knows whether Apple or Google accepted each
 *     one. `DeviceNotRegistered` at either phase retires the token, which is how an uninstalled
 *     app stops being sent to.
 *
 * No SDK: two POST endpoints with a documented JSON shape do not earn a dependency, the same call
 * `mail.ts` made about Resend.
 *
 * ── What a push says ──────────────────────────────────────────────────────────
 *
 * Only what the inbox row already says — the pseudonym, the reply's first line, a posting title.
 * A lock screen is a public place, so nothing goes on it that the anonymity contract would not put
 * in the thread itself. Every push carries a route in `data.url` so a tap lands on the thing.
 */

import { adminClient } from '../auth.ts';
import { env } from '../env.ts';

interface PushJob {
  notification_id: string;
  user_id: string;
  kind: 'comment_reply' | 'comment_like' | 'moderation' | 'verification' | 'job_alert' | 'deadline';
  subject_type: string | null;
  subject_id: string | null;
  payload: Record<string, unknown> | null;
  token_ids: string[] | null;
  tokens: string[] | null;
}

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data: { url: string; notificationId: string };
  sound: 'default';
  priority: 'default' | 'high';
}

function str(payload: Record<string, unknown> | null, key: string): string | null {
  const value = payload?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}

/** The words and the destination for one notification. Exported for verification. */
export function messageFor(job: Pick<PushJob, 'kind' | 'payload' | 'notification_id'>): Omit<PushMessage, 'to'> {
  const p = job.payload;
  const jobId = str(p, 'job_id');
  const jobRoute = jobId ? `/job/${jobId}` : '/activity';

  const base = { sound: 'default' as const, priority: 'default' as const };

  switch (job.kind) {
    case 'comment_reply':
      return {
        ...base,
        priority: 'high',
        title: `${str(p, 'actor_handle') ?? 'Someone'} replied to you`,
        body: clip(str(p, 'reply_body') ?? 'Open the thread to read it.', 140),
        data: { url: jobRoute, notificationId: job.notification_id },
      };
    case 'job_alert':
      return {
        ...base,
        title: clip(str(p, 'headline') ?? 'New roles at companies you follow', 80),
        body: clip(str(p, 'detail') ?? 'Tap to see them.', 140),
        data: { url: Number(p?.count ?? 0) === 1 && jobId ? jobRoute : '/activity', notificationId: job.notification_id },
      };
    case 'deadline':
      return {
        ...base,
        priority: 'high',
        title: clip(str(p, 'headline') ?? 'A saved posting closes soon', 80),
        body: clip(str(p, 'detail') ?? 'Apply before it closes.', 140),
        data: { url: jobRoute, notificationId: job.notification_id },
      };
    default:
      return {
        ...base,
        title: clip(str(p, 'headline') ?? 'An update about your account', 80),
        body: clip(str(p, 'detail') ?? 'Open CareerDeck to see it.', 140),
        data: { url: '/activity', notificationId: job.notification_id },
      };
  }
}

function headers(): Record<string, string> {
  return {
    accept: 'application/json',
    'content-type': 'application/json',
    ...(env.expoAccessToken ? { authorization: `Bearer ${env.expoAccessToken}` } : {}),
  };
}

interface Ticket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

/** One pass: claim, send, record. Returns how many messages went out. */
export async function sendPendingPushes(limit = 100): Promise<{ notifications: number; messages: number; errors: number }> {
  const { data, error } = await adminClient.rpc('claim_push_batch', { p_limit: limit });
  if (error) throw error;
  const jobs = (data ?? []) as PushJob[];
  if (jobs.length === 0) return { notifications: 0, messages: 0, errors: 0 };

  const outgoing: { job: PushJob; tokenId: string; message: PushMessage }[] = [];
  for (const job of jobs) {
    const content = messageFor(job);
    (job.tokens ?? []).forEach((token, i) => {
      const tokenId = job.token_ids?.[i];
      if (tokenId) outgoing.push({ job, tokenId, message: { to: token, ...content } });
    });
  }

  const results: Record<string, unknown>[] = [];
  for (let start = 0; start < outgoing.length; start += 100) {
    const chunk = outgoing.slice(start, start + 100);
    let tickets: Ticket[] = [];
    let chunkError: string | null = null;

    try {
      const response = await fetch(`${env.expoPushUrl}/send`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(chunk.map((c) => c.message)),
        signal: AbortSignal.timeout(15_000),
      });
      const body = (await response.json().catch(() => null)) as { data?: Ticket[]; errors?: { message?: string }[] } | null;
      if (!response.ok || !Array.isArray(body?.data)) {
        chunkError = body?.errors?.[0]?.message ?? `Expo answered ${response.status}`;
      } else {
        tickets = body.data;
      }
    } catch (failure) {
      chunkError = failure instanceof Error ? failure.message : String(failure);
    }

    chunk.forEach((c, i) => {
      const ticket = tickets[i];
      results.push({
        notification_id: c.job.notification_id,
        token_id: c.tokenId,
        status: ticket?.status === 'ok' ? 'ok' : 'error',
        ticket_id: ticket?.id ?? null,
        error: ticket?.status === 'ok' ? null : ticket?.details?.error ?? ticket?.message ?? chunkError ?? 'no ticket',
      });
    });
  }

  const recorded = await adminClient.rpc('record_push_results', { p_results: results });
  if (recorded.error) throw recorded.error;

  return {
    notifications: jobs.length,
    messages: outgoing.length,
    errors: results.filter((r) => r.status !== 'ok').length,
  };
}

/** Fetches receipts for tickets old enough to have one, and records them. */
export async function checkPushReceipts(limit = 300): Promise<number> {
  const { data, error } = await adminClient.rpc('push_receipts_due', { p_limit: limit });
  if (error) throw error;
  const due = (data ?? []) as { delivery_id: number; ticket_id: string }[];
  if (due.length === 0) return 0;

  const response = await fetch(`${env.expoPushUrl}/getReceipts`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ ids: due.map((d) => d.ticket_id) }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await response.json().catch(() => null)) as
    | { data?: Record<string, { status: 'ok' | 'error'; message?: string; details?: { error?: string } }> }
    | null;
  if (!response.ok || !body?.data) throw new Error(`Expo receipts answered ${response.status}`);

  const receipts = due.flatMap((d) => {
    const receipt = body.data?.[d.ticket_id];
    // No receipt yet is normal for a slow provider; the next pass asks again.
    return receipt
      ? [{ delivery_id: d.delivery_id, status: receipt.status, error: receipt.details?.error ?? receipt.message ?? null }]
      : [];
  });
  if (receipts.length === 0) return 0;

  const recorded = await adminClient.rpc('record_push_receipts', { p_receipts: receipts });
  if (recorded.error) throw recorded.error;
  return receipts.length;
}
