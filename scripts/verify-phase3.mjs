/*
 * Checks phase 3's exit condition against the local stack:
 * "verified users comment, moderation blocks the obvious, review queue staffed, content policy
 * published."
 *
 *   npm run db:start
 *   npm run db:reset
 *   npm run server:dev        # in another terminal — half of this phase is HTTP
 *   npm run verify:phase3
 *
 * Like phase 2 this is deterministic and self-cleaning: it creates its own company, postings,
 * accounts and moderator, drives every path, and removes what it made. It passes on a database
 * that has just been reset.
 *
 * Unlike phase 2, some of it is over HTTP. The comment write path and both verification paths
 * live in the API service by necessity (a classifier and an email provider each need a secret),
 * so those checks need `npm run server:dev` running. If the service is unreachable the script
 * says so, skips that half, and still fails on anything wrong with the database half — the same
 * arrangement phase 1 used for its corpus checks.
 *
 * Three kinds of check are mixed here on purpose:
 *
 *  - **It works.** A verified account comments, a reply notifies, a like aggregates, a
 *    moderator removes something and the author is told.
 *  - **It cannot be subverted.** An unverified account cannot comment, a muted one cannot
 *    either, nobody can write `comments` directly, and a non-moderator cannot reach the queue.
 *  - **It does not leak.** This is the one phase where a working feature and a broken promise
 *    look identical from the outside, so `author_id` and `actor_id` are hunted for explicitly in
 *    every shape the client can obtain.
 *
 * Local only. It reads the fixed CLI demo keys and writes throwaway rows through the service
 * role — never point it at a real project.
 */

import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';

const API = 'http://127.0.0.1:54721';
const SERVICE_API = process.env.CAREERDECK_API_URL ?? 'http://127.0.0.1:8787';
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const anon = createClient(API, ANON, { auth: { persistSession: false } });
const admin = createClient(API, SERVICE, { auth: { persistSession: false } });

/** Must match VERIFICATION_PEPPER in server/.env and the expression in apply_strike(). */
const PEPPER = process.env.VERIFICATION_PEPPER ?? 'careerdeck-verification';

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

/**
 * Walks an arbitrary response looking for a forbidden key at any depth.
 *
 * Written as a deep search rather than a field list because the failure this guards against is
 * somebody adding a column, a join or an embedded select six months from now — and that change
 * would pass every check that only inspects the keys it already knows about.
 */
function findForbiddenKey(value, forbidden, path = '$') {
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      const hit = findForbiddenKey(entry, forbidden, `${path}[${index}]`);
      if (hit) return hit;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      if (forbidden.includes(key)) return `${path}.${key}`;
      const hit = findForbiddenKey(entry, forbidden, `${path}.${key}`);
      if (hit) return hit;
    }
  }
  return null;
}

const stamp = Date.now();
const cleanup = [];

async function main() {
  // ── fixtures ─────────────────────────────────────────────────────────────────

  section('fixtures');

  const slug = `verify-phase3-${stamp}`;

  const companyInsert = await admin
    .from('companies')
    .insert({ slug, name: `Verify Phase 3 ${stamp}`, industry: 'Testing' })
    .select('id')
    .single();

  if (companyInsert.error) {
    console.error(`\nCould not create the fixture company: ${companyInsert.error.message}`);
    console.error('Is `npm run db:start` running, and has `npm run db:reset` been applied?');
    process.exit(1);
  }

  const company = companyInsert.data;
  cleanup.push(() => admin.from('companies').delete().eq('id', company.id));

  const jobsInsert = await admin
    .from('jobs')
    .insert(
      [1, 2].map((n) => ({
        company_id: company.id,
        company_name: `Verify Phase 3 ${stamp}`,
        title: `Verify Engineer ${n}`,
        title_normalized: `verify engineer ${n}`,
        location_type: 'Remote',
        employment_type: 'Internship',
        description_text: 'A posting that exists only for verify:phase3.',
        apply_url: `https://example.invalid/${stamp}/${n}`,
      })),
    )
    .select('id');

  if (jobsInsert.error) {
    console.error(`\nCould not create the fixture postings: ${jobsInsert.error.message}`);
    process.exit(1);
  }

  const [jobA, jobB] = jobsInsert.data.map((row) => row.id);

  /** A school whose domain nothing else in the seed owns, so the .edu match is unambiguous. */
  const eduDomain = `verify${stamp}.edu`;
  const schoolInsert = await admin
    .from('schools')
    .insert({
      name: `Verify University ${stamp}`,
      short_name: 'Verify U',
      email_domains: [eduDomain],
    })
    .select('id')
    .single();

  if (schoolInsert.error) {
    console.error(`\nCould not create the fixture school: ${schoolInsert.error.message}`);
    process.exit(1);
  }
  cleanup.push(() => admin.from('schools').delete().eq('id', schoolInsert.data.id));

  async function signIn(label) {
    const email = `verify-phase3-${label}-${stamp}@example.com`;
    const password = `verify-phase3-${stamp}-${label}`;

    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error) throw new Error(`createUser(${label}): ${created.error.message}`);

    const client = createClient(API, ANON, { auth: { persistSession: false } });
    const session = await client.auth.signInWithPassword({ email, password });
    if (session.error) throw new Error(`signIn(${label}): ${session.error.message}`);

    cleanup.push(() => admin.auth.admin.deleteUser(created.data.user.id));
    return {
      id: created.data.user.id,
      email,
      client,
      token: session.data.session.access_token,
    };
  }

  const alice = await signIn('alice');
  const bob = await signIn('bob');
  const mod = await signIn('mod');

  check('three accounts exist', Boolean(alice.id && bob.id && mod.id));

  const handles = await admin
    .from('profiles')
    .select('id, handle')
    .in('id', [alice.id, bob.id, mod.id]);

  const allHaveHandles = (handles.data ?? []).every(
    (row) => typeof row.handle === 'string' && row.handle.length > 0,
  );
  check('signup generated a pseudonym for each', allHaveHandles,
    (handles.data ?? []).map((row) => row.handle).join(', '));

  const generated = (handles.data ?? []).every((row) => /^[a-z]+-[a-z]+-\d{4}$/.test(row.handle));
  check('the pseudonyms come from the seeded vocabulary, not the uuid fallback', generated);

  // Alice will carry a school badge, so give her the fields the badge is composed from.
  await admin
    .from('profiles')
    .update({ major: 'CS', graduation_year: 2027 })
    .eq('id', alice.id);

  await admin.from('moderators').insert({ user_id: mod.id, email: mod.email, can_ban: true });

  // ── service reachability ─────────────────────────────────────────────────────

  let serviceUp = false;
  let capabilities = {};
  try {
    const health = await fetch(`${SERVICE_API}/health`, { signal: AbortSignal.timeout(2000) });
    const json = await health.json();
    serviceUp = json.ok === true;
    capabilities = json.capabilities ?? {};
  } catch {
    serviceUp = false;
  }

  if (serviceUp) {
    note('api service', `${SERVICE_API} — classifier ${capabilities.classifier ? 'live' : 'not configured'}`);
    if (!capabilities.classifier) {
      note(
        'classifier',
        'ANTHROPIC_API_KEY is unset, so comments post as flagged. The block checks below still ' +
          'run: the doxxing and threat passes do not need a model.',
      );
    }
  } else {
    note('api service', `${SERVICE_API} is not answering — the HTTP half will be skipped`);
  }

  async function service(path, { token, method = 'POST', body } = {}) {
    const response = await fetch(`${SERVICE_API}${path}`, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        'content-type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const json = await response.json().catch(() => ({}));
    return { status: response.status, json };
  }

  // ── verification (§3.2) ──────────────────────────────────────────────────────

  section('verification — the two-path ladder');

  {
    const gate = await alice.client.rpc('comment_gate');
    check('a fresh account is tier `email` and cannot comment',
      gate.data?.tier === 'email' && gate.data?.can_comment === false,
      `tier ${gate.data?.tier}`);
  }

  if (serviceUp) {
    const unknownDomain = await service('/v1/verify/edu/start', {
      token: alice.token,
      body: { email: `alice@not-a-registered-school-${stamp}.com` },
    });
    check('an unrecognised domain is refused with a code the client can route on',
      unknownDomain.status === 422 && unknownDomain.json.code === 'domain_not_recognised',
      `${unknownDomain.status} ${unknownDomain.json.code ?? ''}`);

    const started = await service('/v1/verify/edu/start', {
      token: alice.token,
      body: { email: `alice@${eduDomain}` },
    });
    check('starting the .edu path names the school back',
      started.status === 200 && started.json.school === 'Verify U',
      `${started.status} ${started.json.school ?? started.json.error ?? ''}`);

    check('with no mail provider in development the code is returned instead of sent',
      started.json.delivered === false && /^\d{6}$/.test(started.json.devCode ?? ''),
      `delivered ${started.json.delivered}`);

    const stored = await admin
      .from('verifications')
      .select('token_hash, status, edu_email')
      .eq('user_id', alice.id)
      .eq('kind', 'edu_email')
      .maybeSingle();

    check('the database stores a digest, never the code',
      stored.data?.token_hash !== started.json.devCode &&
        (stored.data?.token_hash ?? '').length === 64,
      `${(stored.data?.token_hash ?? '').slice(0, 12)}…`);

    const wrongCode = await service('/v1/verify/edu/confirm', {
      token: alice.token,
      body: { code: started.json.devCode === '000000' ? '111111' : '000000' },
    });
    check('a wrong code is refused', wrongCode.status === 422, `${wrongCode.status}`);

    const confirmed = await service('/v1/verify/edu/confirm', {
      token: alice.token,
      body: { code: started.json.devCode },
    });
    check('the right code verifies the account',
      confirmed.status === 200 && confirmed.json.tier === 'edu',
      `${confirmed.status} ${confirmed.json.error ?? ''}`);

    check('and composes the badge from the verified school, never the typed one',
      confirmed.json.badge === "CS @ Verify U '27",
      confirmed.json.badge ?? '');

    const reused = await service('/v1/verify/edu/start', {
      token: bob.token,
      body: { email: `alice@${eduDomain}` },
    });
    check('a second account cannot verify with the same address',
      reused.status === 409 && reused.json.code === 'address_in_use',
      `${reused.status} ${reused.json.code ?? ''}`);
  } else {
    skip('the .edu path end to end', 'the api service is not running');
    // Verify the same ladder through SQL so the rest of the script has a verified account.
    await admin.rpc('start_edu_verification', {
      p_user_id: alice.id,
      p_email: `alice@${eduDomain}`,
      p_token_hash: 'fallback-hash',
      p_identifier_hash: 'fallback-identifier',
      p_ttl_minutes: 30,
    });
    await admin.rpc('confirm_edu_verification', {
      p_user_id: alice.id,
      p_token_hash: 'fallback-hash',
    });
  }

  {
    // Bob takes the sibling path. §3.2: `edu` and `identity` both grant comment-write and differ
    // only in the badge — which is what makes the bootcamp grad and the .ac.uk student reachable.
    const identity = await admin.rpc('record_identity_verification', {
      p_user_id: bob.id,
      p_provider: 'persona',
      p_provider_ref: `inq_${stamp}`,
      p_passed: true,
      p_result: { status: 'approved', provider: 'persona' },
      p_identifier_hash: createHash('sha256').update(`${PEPPER}:inq_${stamp}`).digest('hex'),
    });
    check('the ID path grants the sibling tier', identity.data === 'identity', identity.error?.message ?? '');

    const badge = await admin.from('profiles').select('comment_badge').eq('id', bob.id).maybeSingle();
    check('and claims no school', badge.data?.comment_badge === null, String(badge.data?.comment_badge));

    // The non-negotiable, as a constraint rather than a promise.
    const leaky = await admin.from('verifications').insert({
      user_id: bob.id,
      kind: 'government_id',
      provider: 'persona',
      provider_ref: `inq_leak_${stamp}`,
      provider_result: { status: 'approved', birthdate: '1999-04-02' },
    });
    check('the schema refuses to store document data from the vendor',
      leaky.error !== null && leaky.error.code === '23514',
      leaky.error?.code ?? 'the insert was accepted');
  }

  // ── the comment gate ─────────────────────────────────────────────────────────

  section('the comment gate');

  {
    const gate = await alice.client.rpc('comment_gate');
    check('a verified account still cannot comment before accepting the policy',
      gate.data?.can_comment === false && gate.data?.policy_accepted === false,
      `can_comment ${gate.data?.can_comment}`);

    if (serviceUp) {
      const refused = await service('/v1/comments', {
        token: alice.token,
        body: { jobId: jobA, body: 'Before the policy.' },
      });
      check('and the write path says exactly why, with a status the client can act on',
        refused.status === 428 && refused.json.code === 'policy_not_accepted',
        `${refused.status} ${refused.json.code ?? ''}`);

      const unverified = await service('/v1/comments', {
        token: mod.token,
        body: { jobId: jobA, body: 'From an unverified account.' },
      });
      check('an unverified account is refused before the policy is even consulted',
        unverified.status === 403 && unverified.json.code === 'not_verified',
        `${unverified.status} ${unverified.json.code ?? ''}`);
    }

    const accepted = await alice.client.rpc('accept_content_policy', { p_version: '2026-09-24' });
    check('accepting the policy is recorded with its version', accepted.data !== null,
      accepted.error?.message ?? '');

    await bob.client.rpc('accept_content_policy', { p_version: '2026-09-24' });

    const after = await alice.client.rpc('comment_gate');
    check('now the gate opens', after.data?.can_comment === true, `can_comment ${after.data?.can_comment}`);
    check('and it reports the budget §10 enforces',
      after.data?.remaining_hour === 10 && after.data?.remaining_day === 40,
      `${after.data?.remaining_hour}/hour, ${after.data?.remaining_day}/day`);
  }

  // ── writing (§10) ────────────────────────────────────────────────────────────

  section('the write path');

  let rootId = null;

  if (serviceUp) {
    const posted = await service('/v1/comments', {
      token: alice.token,
      body: { jobId: jobA, body: 'Has anyone heard back after the OA?', idempotencyKey: `k-${stamp}-1` },
    });
    check('a verified account posts', posted.status === 201, `${posted.status} ${posted.json.error ?? ''}`);
    rootId = posted.json.comment?.id ?? null;

    check('the response carries the pseudonym and the badge, never a name',
      posted.json.comment?.author_handle?.length > 0 &&
        posted.json.comment?.author_badge === "CS @ Verify U '27",
      posted.json.comment?.author_badge ?? '');

    const leak = findForbiddenKey(posted.json, ['author_id', 'moderation_scores', 'actor_id']);
    check('and nothing the contract hides', leak === null, leak ?? '');

    const again = await service('/v1/comments', {
      token: alice.token,
      body: { jobId: jobA, body: 'Different text, same key.', idempotencyKey: `k-${stamp}-1` },
    });
    check('a retried POST returns the same comment rather than a second one',
      again.status === 201 && again.json.comment?.id === rootId,
      `${again.status}`);

    const reply = await service('/v1/comments', {
      token: bob.token,
      body: { jobId: jobA, parentId: rootId, body: 'Yes — took about two weeks for me.' },
    });
    check('somebody replies', reply.status === 201, `${reply.status} ${reply.json.error ?? ''}`);

    const nested = await service('/v1/comments', {
      token: alice.token,
      body: { jobId: jobA, parentId: reply.json.comment?.id, body: 'Nesting this deeper.' },
    });
    check('a reply to a reply is refused by the database, not hoped against by the client',
      nested.status === 422, `${nested.status}`);

    const empty = await service('/v1/comments', { token: alice.token, body: { jobId: jobA, body: '   ' } });
    check('an empty comment is refused', empty.status === 422, `${empty.status}`);

    // §10's doxxing pass. These do not need a model, which is why they are checked even on a
    // deployment with no classifier credential.
    const doxx = [
      ['an email address', 'mail me at alice@example.com and I will send the questions'],
      ['a phone number', 'my cell is 317-555-0148 if you want to talk'],
      ['a street address', 'the office is at 412 Oak Street if you want to drop in'],
      ['an invitation to move private', 'dm me on instagram and I will send the answers'],
      ['an obfuscated address', 'reach me at alice (at) example (dot) com'],
    ];

    for (const [what, text] of doxx) {
      const blocked = await service('/v1/comments', { token: alice.token, body: { jobId: jobA, body: text } });
      check(`${what} is blocked with a reason the user can act on`,
        blocked.status === 422 && typeof blocked.json.error === 'string' && blocked.json.error.length > 10,
        `${blocked.status} ${blocked.json.category ?? ''}`);
    }

    const threat = await service('/v1/comments', {
      token: alice.token,
      body: { jobId: jobA, body: 'kys, nobody wants your opinion' },
    });
    check('a self-harm directive is blocked without needing a model',
      threat.status === 422 && threat.json.category === 'threat',
      `${threat.status} ${threat.json.category ?? ''}`);

    /*
     * The category §10 says must never be blocked. On a deployment with no classifier this
     * passes trivially; with one, it is the check that catches a model being too eager and the
     * override in classifier.ts not working.
     */
    const criticism = await service('/v1/comments', {
      token: alice.token,
      body: { jobId: jobB, body: 'They ghosted me after the final round and the recruiter lied about the timeline.' },
    });
    check('criticism of an employer is published, not blocked',
      criticism.status === 201, `${criticism.status} ${criticism.json.error ?? ''}`);

    // Fill the hourly budget. Alice has used a handful; walk to the limit and past it.
    let limited = null;
    for (let n = 0; n < 12 && limited === null; n += 1) {
      const response = await service('/v1/comments', {
        token: alice.token,
        body: { jobId: jobB, body: `Filling the rate limit, message ${n}.` },
      });
      if (response.status === 429) limited = response;
    }
    check('the rate limit closes the door at §10’s ten an hour',
      limited !== null && limited.json.code === 'rate_limited',
      limited ? `${limited.status} ${limited.json.code}` : 'never hit the limit in 12 tries');

    const gate = await alice.client.rpc('comment_gate');
    check('and the gate agrees with the write path about it',
      gate.data?.remaining_hour === 0 && gate.data?.can_comment === false,
      `remaining ${gate.data?.remaining_hour}`);
  } else {
    skip('the write path over HTTP', 'the api service is not running');
    const posted = await admin.rpc('post_comment', {
      p_author_id: alice.id,
      p_job_id: jobA,
      p_body: 'Has anyone heard back after the OA?',
    });
    rootId = posted.data?.id ?? null;
    await admin.rpc('post_comment', {
      p_author_id: bob.id,
      p_job_id: jobA,
      p_parent_id: rootId,
      p_body: 'Yes — took about two weeks for me.',
    });
    check('the SQL write path still works without the service', rootId !== null,
      posted.error?.message ?? '');
  }

  // ── the client cannot write comments at all ──────────────────────────────────

  section('the write path is the only write path');

  {
    const direct = await alice.client
      .from('comments')
      .insert({ job_id: jobA, author_id: alice.id, body: 'Straight into the table.' });
    check('a signed-in client cannot insert a comment',
      direct.error !== null, direct.error?.code ?? 'the insert was accepted');

    const asAlice = await alice.client.rpc('post_comment', {
      p_author_id: bob.id,
      p_job_id: jobA,
      p_body: 'Posted as somebody else.',
    });
    check('and cannot call the write function to author one as somebody else',
      asAlice.error !== null, asAlice.error?.code ?? 'the call succeeded');

    const anonymous = await anon.rpc('job_comments', { p_job_id: jobA });
    check('an anonymous reader cannot read a thread',
      anonymous.error !== null, anonymous.error?.code ?? 'the read succeeded');
  }

  // ── reading, and what a read may not contain ─────────────────────────────────

  section('reads and the anonymity contract');

  {
    const base = await alice.client.from('comments').select('*').limit(1);
    check('the base comments table is unreadable, so `author_id` is not one grant away',
      base.error !== null, base.error?.code ?? 'the select succeeded');

    const thread = await alice.client.rpc('job_comments', { p_job_id: jobA });
    check('the thread read works', thread.error === null && (thread.data ?? []).length > 0,
      thread.error?.message ?? `${(thread.data ?? []).length} roots`);

    const leak = findForbiddenKey(thread.data, ['author_id', 'moderation_scores', 'moderation_reason']);
    check('and contains nothing that identifies an author', leak === null, leak ?? '');

    const own = (thread.data ?? []).find((row) => row.id === rootId);
    check('the reader is told which comments are theirs', own?.is_own === true, String(own?.is_own));
    check('and roots carry a reply count so the sheet can offer to open the thread',
      own?.reply_count === 1, String(own?.reply_count));

    const replies = await alice.client.rpc('comment_replies', { p_comment_id: rootId });
    check('the thread opens', (replies.data ?? []).length === 1, `${(replies.data ?? []).length} replies`);
    check("and somebody else's reply is not marked as the reader's own",
      replies.data?.[0]?.is_own === false, String(replies.data?.[0]?.is_own));

    const view = await alice.client.from('comments_public').select('*').eq('job_id', jobA).limit(5);
    check('the public projection is readable', view.error === null, view.error?.message ?? '');
    check('and is itself free of author identifiers',
      findForbiddenKey(view.data, ['author_id']) === null);

    const counts = await alice.client.rpc('comment_counts', { p_job_ids: [jobA, jobB] });
    const forJobA = (counts.data ?? []).find((row) => row.job_id === jobA);
    check('comment counts come back per posting, separately from the feed',
      (forJobA?.comment_count ?? 0) >= 2, `${forJobA?.comment_count} on the first posting`);
  }

  // ── likes, and §1.3(b) ───────────────────────────────────────────────────────

  section('comment likes — §1.3(b), finally');

  {
    const liked = await bob.client.rpc('set_comment_like', { p_comment_id: rootId, p_on: true });
    check('a like is set, not flipped', liked.data === true, liked.error?.message ?? '');

    const twice = await bob.client.rpc('set_comment_like', { p_comment_id: rootId, p_on: true });
    check('so replaying it cannot invert it', twice.data === true);

    const thread = await alice.client.rpc('job_comments', { p_job_id: jobA });
    const root = (thread.data ?? []).find((row) => row.id === rootId);
    check('the stored count is the true total', root?.like_count === 1, String(root?.like_count));

    const authorSets = await alice.client.rpc('viewer_state');
    const bobSets = await bob.client.rpc('viewer_state');
    check("the author's own viewer state does not contain a like they did not make",
      !(authorSets.data?.liked_comment_ids ?? []).includes(rootId));
    check('and the liker’s does',
      (bobSets.data?.liked_comment_ids ?? []).includes(rootId),
      `${(bobSets.data?.liked_comment_ids ?? []).length} liked`);

    note('§1.3(b)', 'the count and the viewer’s own like now travel separately, as it asked');

    const off = await bob.client.rpc('set_comment_like', { p_comment_id: rootId, p_on: false });
    check('unliking decrements to the right number', off.data === false);
    const after = await admin.from('comments').select('like_count').eq('id', rootId).maybeSingle();
    check('and the stored count follows', after.data?.like_count === 0, String(after.data?.like_count));

    // Put it back — the notification checks below read the aggregate it produced.
    await bob.client.rpc('set_comment_like', { p_comment_id: rootId, p_on: true });
  }

  // ── notifications (§3.8) ─────────────────────────────────────────────────────

  section('notifications');

  {
    const mine = await alice.client
      .from('notifications_public')
      .select('*')
      .order('created_at', { ascending: false });

    check('the author is notified of the reply and the like',
      (mine.data ?? []).some((row) => row.kind === 'comment_reply') &&
        (mine.data ?? []).some((row) => row.kind === 'comment_like'),
      (mine.data ?? []).map((row) => row.kind).join(', '));

    check('the notification never names the account that caused it',
      findForbiddenKey(mine.data, ['actor_id', 'user_id']) === null);

    const reply = (mine.data ?? []).find((row) => row.kind === 'comment_reply');
    check('but it does carry the pseudonym, which is a name you can reply to',
      typeof reply?.payload?.actor_handle === 'string' && reply.payload.actor_handle.length > 0,
      reply?.payload?.actor_handle ?? '');
    check('and quotes back what it answers, so it still reads if the thread is gone',
      typeof reply?.payload?.your_comment === 'string' && reply.payload.your_comment.length > 0);

    // §3.8's aggregation: "the third person to like your comment updates aggregate_count".
    const third = await signIn('carol');
    await admin.rpc('record_identity_verification', {
      p_user_id: third.id,
      p_provider: 'persona',
      p_provider_ref: `inq_c_${stamp}`,
      p_passed: true,
      p_result: { status: 'approved' },
      p_identifier_hash: createHash('sha256').update(`${PEPPER}:inq_c_${stamp}`).digest('hex'),
    });
    await third.client.rpc('set_comment_like', { p_comment_id: rootId, p_on: true });

    const aggregated = await alice.client
      .from('notifications_public')
      .select('kind, aggregate_count')
      .eq('kind', 'comment_like')
      .maybeSingle();

    check('a second like aggregates onto one row rather than inserting another',
      aggregated.data?.aggregate_count === 2, String(aggregated.data?.aggregate_count));

    /*
     * And the count is the number of people, not the number of times a button was pressed. Bob
     * liked, unliked and liked again above; an incrementing counter would read 3 here and the
     * sentence "and 2 others" would be a lie the database told itself.
     */
    const likers = await admin
      .from('comment_likes')
      .select('user_id', { count: 'exact', head: true })
      .eq('comment_id', rootId);
    check('and toggling a like cannot inflate it',
      aggregated.data?.aggregate_count === likers.count,
      `${aggregated.data?.aggregate_count} reported, ${likers.count} likers`);

    const bobsInbox = await bob.client.from('notifications_public').select('id');
    const alicesIds = new Set((mine.data ?? []).map((row) => row.id));
    check("nobody can read anybody else's notifications",
      (bobsInbox.data ?? []).every((row) => !alicesIds.has(row.id)));

    const marked = await alice.client.rpc('mark_notifications_read', { p_ids: null });
    check('marking everything read touches only unread rows', (marked.data ?? 0) >= 2,
      `${marked.data} rows`);

    const unread = await alice.client
      .from('notifications_public')
      .select('id', { count: 'exact', head: true })
      .is('read_at', null);
    check('and leaves nothing unread', unread.count === 0, `${unread.count}`);
  }

  // ── blocks and reports ───────────────────────────────────────────────────────

  section('blocks and reports');

  {
    const replies = await alice.client.rpc('comment_replies', { p_comment_id: rootId });
    const bobsReply = replies.data?.[0]?.id;

    const reported = await alice.client.rpc('report_content', {
      p_comment_id: bobsReply,
      p_reason: 'harassment',
      p_detail: 'this is about me',
    });
    check('a comment can be reported', reported.data !== null, reported.error?.message ?? '');

    const twice = await alice.client.rpc('report_content', {
      p_comment_id: bobsReply,
      p_reason: 'harassment',
      p_detail: 'and here is more detail',
    });
    check('reporting it again adds detail rather than raising',
      twice.error === null && twice.data === reported.data, twice.error?.message ?? '');

    const own = await alice.client.rpc('report_content', { p_comment_id: rootId, p_reason: 'spam' });
    check('a comment cannot be reported by its own author',
      own.error !== null && own.error.code === 'CD006', own.error?.code ?? 'accepted');

    const blocked = await alice.client.rpc('set_block_from_comment', {
      p_comment_id: bobsReply,
      p_on: true,
    });
    check('blocking is keyed by the comment, because the client holds no author id',
      blocked.data === true, blocked.error?.message ?? '');

    const afterBlock = await alice.client.rpc('comment_replies', { p_comment_id: rootId });
    check('the blocked account disappears from the thread', (afterBlock.data ?? []).length === 0,
      `${(afterBlock.data ?? []).length} replies`);

    const theirView = await bob.client.rpc('job_comments', { p_job_id: jobA });
    check('and the block runs both ways, so the blocker disappears for them too',
      !(theirView.data ?? []).some((row) => row.id === rootId));

    const likeBlocked = await alice.client.rpc('set_comment_like', {
      p_comment_id: bobsReply,
      p_on: true,
    });
    check('a blocked account’s comment cannot be liked either', likeBlocked.error !== null,
      likeBlocked.error?.code ?? 'accepted');

    if (serviceUp) {
      const reply = await service('/v1/comments', {
        token: bob.token,
        body: { jobId: jobA, parentId: rootId, body: 'Are you ignoring me?' },
      });
      check('a reply across a block is refused at write time, not hidden at read time',
        reply.status === 403 && reply.json.code === 'blocked',
        `${reply.status} ${reply.json.code ?? ''}`);
    }

    const blockedRows = await bob.client.from('blocks').select('*');
    check('nobody can find out that they have been blocked',
      (blockedRows.data ?? []).length === 0, `${(blockedRows.data ?? []).length} rows`);

    await alice.client.rpc('set_block_from_comment', { p_comment_id: bobsReply, p_on: false });
    const restored = await alice.client.rpc('comment_replies', { p_comment_id: rootId });
    check('unblocking restores the thread', (restored.data ?? []).length === 1);
  }

  // ── the review queue (§10) ───────────────────────────────────────────────────

  section('the review queue');

  {
    const flagged = await admin.rpc('post_comment', {
      p_author_id: bob.id,
      p_job_id: jobB,
      p_body: 'Something a classifier was unsure about.',
      p_status: 'flagged',
      p_scores: { harassment: 0.55 },
      p_reason: 'model: harassment',
    });
    const flaggedId = flagged.data?.id;
    check('a flagged comment is published, not hidden', flaggedId !== undefined,
      flagged.error?.message ?? '');

    const visible = await alice.client.rpc('job_comments', { p_job_id: jobB });
    check('§10: a flag queues it for a human without silencing it',
      (visible.data ?? []).some((row) => row.id === flaggedId));

    if (serviceUp) {
      const asUser = await service('/v1/moderation/queue', { token: alice.token, method: 'GET' });
      check('a non-moderator cannot find the queue, let alone read it',
        asUser.status === 404, `${asUser.status}`);

      const queue = await service('/v1/moderation/queue', { token: mod.token, method: 'GET' });
      check('a moderator can', queue.status === 200, `${queue.status} ${queue.json.error ?? ''}`);

      const items = queue.json.items ?? [];
      check('the queue puts reported items ahead of merely flagged ones',
        items.length >= 2 && items[0]?.kind === 'report',
        items.map((item) => item.kind).join(', '));

      const withHistory = items.find((item) => item.comment_id === flaggedId);
      check('and shows the reviewer what users are not allowed to see',
        typeof withHistory?.author_id === 'string' && typeof withHistory?.prior_strikes === 'number',
        `${withHistory?.prior_strikes} prior strikes`);

      const resolved = await service('/v1/moderation/resolve', {
        token: mod.token,
        body: { commentId: flaggedId, status: 'removed', reason: 'Targeted another user.', strike: true },
      });
      check('resolving removes the comment and issues the first strike',
        resolved.status === 200 && resolved.json.resolved?.strike_severity === 1,
        `${resolved.status} severity ${resolved.json.resolved?.strike_severity}`);
    } else {
      skip('the queue over HTTP', 'the api service is not running');
      await admin.rpc('moderation_resolve', {
        p_comment_id: flaggedId,
        p_status: 'removed',
        p_reason: 'Targeted another user.',
        p_moderator: mod.id,
        p_strike: true,
      });
    }

    const gone = await alice.client.rpc('job_comments', { p_job_id: jobB });
    check('the removed comment is gone from every read',
      !(gone.data ?? []).some((row) => row.id === flaggedId));

    const told = await bob.client
      .from('notifications_public')
      .select('kind, payload')
      .eq('kind', 'moderation');
    check('§10: the author is told rather than left guessing',
      (told.data ?? []).length >= 1, `${(told.data ?? []).length} notifications`);

    /*
     * Named columns, not `*`. The grant on `user_strikes` is column-level and omits `issued_by`,
     * so `select *` — which PostgREST expands to every column — is refused outright. That is the
     * grant working, and it is checked immediately below: §10's ladder is only a deterrent if the
     * person on it can see where they are, and a moderator's identity is still not theirs to have.
     */
    const strikes = await bob.client
      .from('user_strikes')
      .select('id, severity, reason, comment_id, expires_at, created_at');
    check('the account can see the strike it is on',
      (strikes.data ?? []).length === 1, strikes.error?.message ?? '');
    check('but not which moderator issued it',
      findForbiddenKey(strikes.data, ['issued_by']) === null);

    const wildcard = await bob.client.from('user_strikes').select('*');
    check('and asking for every column is refused rather than quietly filtered',
      wildcard.error !== null, wildcard.error?.code ?? 'the select succeeded');

    const named = await bob.client.from('user_strikes').select('issued_by');
    check('naming the withheld column directly is refused too',
      named.error !== null, named.error?.code ?? 'the select succeeded');

    const others = await alice.client
      .from('user_strikes')
      .select('id, severity, reason, comment_id, expires_at, created_at');
    check("and cannot see anybody else's", (others.data ?? []).length === 0);
  }

  // ── the strike ladder (§10) ──────────────────────────────────────────────────

  section('the strike ladder');

  {
    const mute = await admin.rpc('apply_strike', { p_user_id: bob.id, p_reason: 'again' });
    const muteRow = Array.isArray(mute.data) ? mute.data[0] : mute.data;
    check('the second strike escalates to a 7-day mute',
      muteRow?.severity === 2 && muteRow?.expires_at !== null,
      `severity ${muteRow?.severity}`);

    const gate = await bob.client.rpc('comment_gate');
    check('a muted account cannot comment, and is told when it can again',
      gate.data?.can_comment === false && gate.data?.muted_until !== null,
      `muted until ${gate.data?.muted_until}`);

    if (serviceUp) {
      const refused = await service('/v1/comments', {
        token: bob.token,
        body: { jobId: jobA, body: 'While muted.' },
      });
      check('and the write path refuses it', refused.status === 403 && refused.json.code === 'restricted',
        `${refused.status} ${refused.json.code ?? ''}`);
    }

    const ban = await admin.rpc('apply_strike', { p_user_id: bob.id, p_reason: 'and again' });
    const banRow = Array.isArray(ban.data) ? ban.data[0] : ban.data;
    check('the third is a ban', banRow?.severity === 3, `severity ${banRow?.severity}`);

    const tier = await admin.from('profiles').select('verification_tier').eq('id', bob.id).maybeSingle();
    check('which drops the account to `email` — it can still read, apply and track',
      tier.data?.verification_tier === 'email', tier.data?.verification_tier);

    const burned = await admin
      .from('verification_blocklist')
      .select('kind, identifier_hash')
      .eq('kind', 'government_id');
    check('§10: the credential is burned, so the ban is not a ten-second inconvenience',
      (burned.data ?? []).length >= 1, `${(burned.data ?? []).length} entries`);

    const again = await admin.rpc('record_identity_verification', {
      p_user_id: bob.id,
      p_provider: 'persona',
      p_provider_ref: `inq_${stamp}`,
      p_passed: true,
      p_result: { status: 'approved' },
      p_identifier_hash: createHash('sha256').update(`${PEPPER}:inq_${stamp}`).digest('hex'),
    });
    check('the same identity cannot verify an account again',
      again.error !== null && again.error.code === 'CD007',
      again.error?.code ?? 'it verified');

    cleanup.push(() => admin.from('verification_blocklist').delete().in('kind', ['government_id', 'edu_email']));
  }

  // ── realtime (§15) ───────────────────────────────────────────────────────────

  section('realtime on threads');

  {
    /*
     * Subscribed as a real client rather than by reading `realtime.messages`.
     *
     * The table is not exposed over PostgREST, and reading it would not have tested the thing that
     * actually breaks: whether a signed-in reader is *authorized* on a private topic. That is the
     * policy on `realtime.messages`, and the only way to exercise it is to subscribe.
     */
    const topic = `job:${jobA}:comments`;

    async function awaitBroadcast(client, event, trigger) {
      const channel = client.channel(topic, { config: { private: true } });
      let settle;
      const received = new Promise((resolve) => { settle = resolve; });
      channel.on('broadcast', { event }, (message) => settle(message.payload ?? message));

      const subscribed = await new Promise((resolve) => {
        channel.subscribe((status) => {
          if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            resolve(status);
          }
        });
        setTimeout(() => resolve('TIMED_OUT'), 8_000);
      });

      if (subscribed !== 'SUBSCRIBED') {
        await client.removeChannel(channel);
        return { status: subscribed, payload: null };
      }

      await trigger();

      const payload = await Promise.race([
        received,
        new Promise((resolve) => setTimeout(() => resolve(null), 8_000)),
      ]);

      await client.removeChannel(channel);
      return { status: subscribed, payload };
    }

    /*
     * A fresh account does the posting.
     *
     * Alice is rate-limited by this point in the script and Bob is banned, and either would make
     * `post_comment` raise — which would look exactly like a broadcast that never arrived. The
     * trigger's own error is checked below for the same reason: a silent write failure here
     * produces a passing-looking test of nothing at all.
     */
    const poster = await signIn('dave');
    await admin.rpc('record_identity_verification', {
      p_user_id: poster.id,
      p_provider: 'persona',
      p_provider_ref: `inq_d_${stamp}`,
      p_passed: true,
      p_result: { status: 'approved' },
    });
    await poster.client.rpc('accept_content_policy', { p_version: '2026-09-24' });

    let posted = null;
    const asReader = await awaitBroadcast(alice.client, 'comment_added', async () => {
      posted = await admin.rpc('post_comment', {
        p_author_id: poster.id,
        p_job_id: jobA,
        p_body: 'A comment posted while somebody was listening.',
      });
    });

    check('the comment the listener is waiting for was actually written',
      posted !== null && posted.error === null, posted?.error?.message ?? '');

    if (asReader.status !== 'SUBSCRIBED') {
      // Realtime is a separate container and is the one dependency here that can be down while
      // Postgres is fine. Worth distinguishing from a policy that refuses the subscription.
      skip('the thread broadcast', `could not subscribe (${asReader.status})`);
    } else {
      check('a signed-in reader is authorized on a posting’s private comment topic', true);
      check('and a comment posted while they listen reaches them',
        asReader.payload !== null, asReader.payload === null ? 'nothing arrived in 8s' : '');
      check('the broadcast carries the pseudonym the thread renders',
        typeof asReader.payload?.author_handle === 'string', asReader.payload?.author_handle ?? '');
      check('and is the public projection, not the row',
        findForbiddenKey(asReader.payload, ['author_id', 'moderation_scores']) === null);
    }

    /*
     * The other half of the policy: a client holding only the publishable key, with no session,
     * must not be able to listen in on a private topic. Without this check the feature could be
     * working perfectly and broadcasting every comment to the open internet.
     */
    const asStranger = await awaitBroadcast(anon, 'comment_added', async () => {});
    check('an anonymous client cannot subscribe to it at all',
      asStranger.status !== 'SUBSCRIBED', asStranger.status);
  }

  // ── operations ───────────────────────────────────────────────────────────────

  section('operations');

  {
    await admin.from('comments').update({ like_count: 41, reply_count: 7 }).eq('id', rootId);
    const fixed = await admin.rpc('reconcile_comment_counts');
    check('the nightly reconcile notices a drifted counter',
      !fixed.error && (fixed.data ?? 0) >= 1, fixed.error?.message ?? `${fixed.data} rows`);

    const after = await admin
      .from('comments')
      .select('like_count, reply_count')
      .eq('id', rootId)
      .maybeSingle();
    check('and puts both back to the real numbers',
      after.data?.like_count === 2 && after.data?.reply_count === 1,
      `${after.data?.like_count} likes, ${after.data?.reply_count} replies`);

    const pruned = await admin.rpc('prune_notifications', { p_keep_days: 90 });
    check('notification retention runs', pruned.error === null, pruned.error?.message ?? `${pruned.data} removed`);

    // §3.2's quarterly re-challenge. Age the verification past its expiry and check the first
    // pass notifies rather than revoking.
    await admin
      .from('verifications')
      .update({ expires_at: new Date(Date.now() - 86_400_000).toISOString() })
      .eq('user_id', alice.id)
      .eq('kind', 'edu_email');

    const expired = await admin.rpc('expire_edu_verifications', { p_grace_days: 30 });
    check('the expiry pass runs', expired.error === null, expired.error?.message ?? `${expired.data} touched`);

    const stillVerified = await admin
      .from('profiles')
      .select('verification_tier')
      .eq('id', alice.id)
      .maybeSingle();
    check('§3.2: it notifies first and does not silently revoke',
      stillVerified.data?.verification_tier === 'edu', stillVerified.data?.verification_tier);

    const warned = await alice.client
      .from('notifications_public')
      .select('kind, payload')
      .eq('kind', 'verification');
    check('with a notification offering the other path',
      (warned.data ?? []).some((row) => /government ID/i.test(row.payload?.detail ?? '')),
      `${(warned.data ?? []).length} verification notifications`);

    // Past the grace period, the badge lapses and nothing else does.
    await admin
      .from('verifications')
      .update({ expires_at: new Date(Date.now() - 40 * 86_400_000).toISOString() })
      .eq('user_id', alice.id)
      .eq('kind', 'edu_email');

    await admin.rpc('expire_edu_verifications', { p_grace_days: 30 });

    const downgraded = await admin
      .from('profiles')
      .select('verification_tier, school_id, comment_badge')
      .eq('id', alice.id)
      .maybeSingle();
    check('then the badge goes, and the account does not',
      downgraded.data?.verification_tier === 'email' &&
        downgraded.data?.school_id === null &&
        downgraded.data?.comment_badge === null,
      `${downgraded.data?.verification_tier}, badge ${downgraded.data?.comment_badge}`);

    const stillThere = await admin
      .from('comments')
      .select('id', { count: 'exact', head: true })
      .eq('author_id', alice.id)
      .is('deleted_at', null);
    check('and everything they wrote is still there',
      (stillThere.count ?? 0) > 0, `${stillThere.count} comments`);
  }

  // ── deleting your own ────────────────────────────────────────────────────────

  section('deleting your own comment');

  {
    const removed = await alice.client.rpc('delete_own_comment', { p_comment_id: rootId });
    check('a comment can be deleted by its author', removed.data === true, removed.error?.message ?? '');

    const gone = await alice.client.rpc('job_comments', { p_job_id: jobA });
    check('and disappears from the thread', !(gone.data ?? []).some((row) => row.id === rootId));

    const replies = await admin
      .from('comments')
      .select('deleted_at')
      .eq('parent_id', rootId);
    check('replies go with it rather than being orphaned into non sequiturs',
      (replies.data ?? []).every((row) => row.deleted_at !== null));

    const row = await admin.from('comments').select('deleted_at').eq('id', rootId).maybeSingle();
    check('the row survives as evidence, because a strike may depend on it',
      row.data?.deleted_at !== null);

    const someoneElses = await bob.client.rpc('delete_own_comment', {
      p_comment_id: (await admin.from('comments').select('id').eq('author_id', alice.id).limit(1)).data?.[0]?.id,
    });
    check("nobody can delete somebody else's", someoneElses.data === false || someoneElses.error !== null);
  }
}

try {
  await main();
} catch (error) {
  failures += 1;
  console.error(`\nFAIL  the run itself — ${error instanceof Error ? error.message : String(error)}`);
} finally {
  /*
   * Deleting the users cascades through profiles into their comments, likes, blocks, reports,
   * strikes and notifications. The blocklist has no foreign key — a burned credential deliberately
   * outlives the account it banned — so it is removed by hand. Postings go last, because
   * `comments.job_id` would otherwise refuse, which is the constraint working.
   */
  for (const step of cleanup.reverse()) {
    try {
      await step();
    } catch {
      // Leftover verify- rows are noise in a local database, not a failure of the phase.
    }
  }
}

console.log(
  failures === 0
    ? `\nPhase 3 verified: verified accounts comment, moderation blocks the obvious, the queue is ` +
        `staffed, and no read anywhere carries an author's identity.` +
        (skipped > 0 ? ` (${skipped} check${skipped === 1 ? '' : 's'} skipped.)\n` : '\n')
    : `\n${failures} check${failures === 1 ? '' : 's'} failed.\n`,
);

process.exit(failures === 0 ? 0 : 1);
