/**
 * §13.2 and §13.3 — the two CCPA rights that need the service: export, and the purge half of
 * deletion.
 *
 * Requesting and cancelling a deletion are plain RPCs from the app (they need no secret), so they
 * are not here. What is here needs something the app must never hold:
 *
 *  - **`POST /v1/me/export`** opens the sealed resume contact fields, which only this process can
 *    do, and logs that it did with purpose `export`.
 *  - **`purgeDueAccounts()`** deletes storage objects and the auth user. Both need the service-role
 *    key, and the second is irreversible.
 *
 * ── Why the export is returned, not linked ────────────────────────────────────
 *
 * §13.2 says "delivered via a signed URL, ≤30 days". A signed URL is the answer for an export
 * built by a background job. This one is built in a single request — it is one SQL function over
 * one account — so the bundle goes back in the response, as a download, and never sits in a
 * bucket waiting to be leaked by a URL in somebody's history. PHASE7.md §4.2.
 */

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';

import { adminClient, type AuthedUser } from './auth.ts';
import { env } from './env.ts';
import { canEncrypt, open } from './resumes/crypto.ts';
import { logAccess } from './resumes.ts';

type Env = { Variables: { user: AuthedUser } };

export const privacy = new Hono<Env>();

function bytes(value: unknown): Buffer | null {
  if (typeof value !== 'string' || !value.startsWith('\\x') || value.length <= 2) return null;
  return Buffer.from(value.slice(2), 'hex');
}

/** Name, email and phone parsed from each of the reader's resumes, opened and logged. */
async function contactDetails(user: AuthedUser): Promise<unknown[]> {
  const { data } = await adminClient
    .from('resumes')
    .select('id, name, resume_profiles(full_name_enc, email_enc, phone_enc)')
    .eq('user_id', user.id);

  const out: unknown[] = [];
  for (const resume of data ?? []) {
    const sealed = (resume as { resume_profiles: Record<string, unknown> | Record<string, unknown>[] | null }).resume_profiles;
    const profile = Array.isArray(sealed) ? sealed[0] : sealed;
    if (!profile || !canEncrypt()) continue;

    await logAccess({
      actorType: 'user', actorId: user.id, subject: user.id, resource: 'resume_profile',
      resourceId: resume.id as string, purpose: 'export', detail: 'data export',
    });

    try {
      out.push({
        resume: resume.name,
        full_name: open(bytes(profile.full_name_enc)),
        email: open(bytes(profile.email_enc)),
        phone: open(bytes(profile.phone_enc)),
      });
    } catch {
      out.push({ resume: resume.name, error: 'These details could not be decrypted.' });
    }
  }
  return out;
}

privacy.post('/export', async (c) => {
  const user = c.get('user');

  const { data, error } = await adminClient.rpc('export_account', { p_user_id: user.id });
  if (error) {
    if (error.code === 'CD030') throw new HTTPException(429, { message: error.message, cause: 'rate_limited' });
    throw error;
  }

  const bundle = {
    ...(data as Record<string, unknown>),
    email: user.email,
    resume_contact_details: await contactDetails(user),
  };
  const body = JSON.stringify(bundle, null, 2);
  await adminClient.rpc('record_export_size', { p_user_id: user.id, p_bytes: Buffer.byteLength(body) });

  return c.body(body, 200, {
    'content-type': 'application/json; charset=utf-8',
    'content-disposition': `attachment; filename="careerdeck-export-${new Date().toISOString().slice(0, 10)}.json"`,
    'cache-control': 'no-store',
  });
});

// ── the purge ──────────────────────────────────────────────────────────────────

const TOMBSTONE_EMAIL = 'deleted-account@careerdeck.invalid';

/**
 * The account deleted readers' comments are moved to — §13.2's "`author_id` → a tombstone
 * account". Created on first use through the Auth admin API rather than by a migration, because a
 * migration that writes into the `auth` schema is one the hosted platform may refuse. It cannot
 * sign in: it has no password, no identity provider, and a century-long ban.
 */
export async function ensureTombstone(): Promise<string> {
  const existing = await adminClient.from('system_accounts').select('user_id').eq('role', 'tombstone').maybeSingle();
  if (existing.data?.user_id) return existing.data.user_id as string;

  let id: string | undefined;
  const created = await adminClient.auth.admin.createUser({
    email: TOMBSTONE_EMAIL,
    email_confirm: false,
    ban_duration: '876000h',
    user_metadata: { tombstone: true },
  });
  id = created.data.user?.id;

  if (!id) {
    // Created by an earlier run that died before recording it.
    const listed = await adminClient.auth.admin.listUsers({ perPage: 1000 });
    id = listed.data.users.find((u) => u.email === TOMBSTONE_EMAIL)?.id;
  }
  if (!id) throw new Error(`Could not create the tombstone account: ${created.error?.message ?? 'unknown'}`);

  await adminClient.from('profiles')
    .update({ handle: 'deleted-account', first_name: null, last_name: null, comment_badge: null })
    .eq('id', id);
  const recorded = await adminClient.from('system_accounts').upsert({ role: 'tombstone', user_id: id });
  if (recorded.error) throw recorded.error;
  return id;
}

/**
 * §13.2 phase two for one account. The order matters and each step is safe to repeat:
 * anonymize and collect in SQL → remove storage objects → delete the RevenueCat customer →
 * delete the auth user (the cascade takes everything keyed on the profile) → close the request.
 * A crash anywhere leaves the request open, so the next run finishes the job.
 */
export async function purgeAccount(userId: string, force = false): Promise<Record<string, unknown>> {
  await ensureTombstone();

  const begun = await adminClient.rpc('begin_account_purge', { p_user_id: userId, p_force: force });
  if (begun.error) throw begun.error;
  const objects = (begun.data ?? []) as { bucket: string; path: string }[];

  const byBucket = new Map<string, string[]>();
  for (const o of objects) byBucket.set(o.bucket, [...(byBucket.get(o.bucket) ?? []), o.path]);
  let removed = 0;
  for (const [bucket, paths] of byBucket) {
    const { data, error } = await adminClient.storage.from(bucket).remove(paths);
    if (error) console.error(`[privacy] storage removal in ${bucket} failed for ${userId}`, error.message);
    removed += data?.length ?? 0;
  }

  let billing = 'not configured';
  if (env.revenuecatSecretKey) {
    const response = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${env.revenuecatSecretKey}` },
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    billing = response?.ok || response?.status === 404 ? 'deleted' : `failed (${response?.status ?? 'network'})`;
  }

  const deleted = await adminClient.auth.admin.deleteUser(userId);
  if (deleted.error && !/not.?found/i.test(deleted.error.message)) throw deleted.error;

  const closed = await adminClient.rpc('complete_account_purge', { p_user_id: userId });
  if (closed.error) throw closed.error;

  return { userId, objectsRemoved: removed, objectsListed: objects.length, billing };
}

/** Every account whose grace has run out. */
export async function purgeDueAccounts(limit = 20): Promise<number> {
  const { data, error } = await adminClient.rpc('due_account_purges', { p_limit: limit });
  if (error) throw error;

  let done = 0;
  for (const userId of (data ?? []) as string[]) {
    try {
      const outcome = await purgeAccount(userId);
      console.log('[privacy] purged', JSON.stringify(outcome));
      done += 1;
    } catch (failure) {
      console.error(`[privacy] purge of ${userId} failed; it will be retried`, failure);
    }
  }
  return done;
}
