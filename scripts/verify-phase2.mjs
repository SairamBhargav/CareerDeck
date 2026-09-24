/*
 * Checks phase 2's exit condition against the local stack:
 * "every existing UI interaction persists; impressions logging at volume."
 *
 * Unlike phase 1 this is entirely deterministic. There is no corpus half and no crawl to
 * wait on — the script creates its own throwaway company, postings and users, drives
 * every write path the app has, and cleans up after itself. It passes on a database that
 * has just been reset and has never ingested anything.
 *
 *   npm run db:start
 *   npm run db:reset
 *   npm run verify:phase2
 *
 * Two kinds of check are mixed here on purpose:
 *
 *  - **It works.** A follow persists, a like is idempotent, a status change writes an
 *    event row, a batch of impressions lands.
 *  - **It cannot be subverted.** Anonymous readers cannot touch any of it, one user
 *    cannot see another's rows, and a client cannot author a `user_id`, escalate
 *    `self_reported`, or write to `job_interactions` except through the function.
 *
 * The second kind is the reason this file is long. Every one of those is a policy or a
 * column grant, and a policy nobody tests is a policy that silently stops applying the
 * first time someone adds a convenience grant.
 *
 * Local only. It reads the fixed CLI demo keys and writes throwaway rows through the
 * service role — never point it at a real project.
 */

import { createClient } from '@supabase/supabase-js';

const API = 'http://127.0.0.1:54721';
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const anon = createClient(API, ANON, { auth: { persistSession: false } });
const admin = createClient(API, SERVICE, { auth: { persistSession: false } });

let failures = 0;

function check(label, passed, detail = '') {
  if (!passed) failures += 1;
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
}

/** Reported, but not a failure — timings depend on the machine, not on the schema. */
function note(label, detail) {
  console.log(`  ..  ${label}  — ${detail}`);
}

function section(title) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 66 - title.length))}`);
}

const stamp = Date.now();
const cleanup = [];

async function main() {
  // ── fixtures ─────────────────────────────────────────────────────────────────

  const slug = `verify-phase2-${stamp}`;

  const companyInsert = await admin
    .from('companies')
    .insert({ slug, name: `Verify Phase 2 ${stamp}`, industry: 'Testing' })
    .select('id, slug, follower_count')
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
      [1, 2, 3].map((n) => ({
        company_id: company.id,
        company_name: `Verify Phase 2 ${stamp}`,
        title: `Verify Engineer ${n}`,
        title_normalized: `verify engineer ${n}`,
        location_type: 'Remote',
        employment_type: 'Internship',
        description_text: 'A posting that exists only for verify:phase2.',
        apply_url: `https://example.invalid/${stamp}/${n}`,
      })),
    )
    .select('id');

  if (jobsInsert.error) {
    console.error(`\nCould not create the fixture postings: ${jobsInsert.error.message}`);
    process.exit(1);
  }

  const jobs = jobsInsert.data.map((row) => row.id);
  const [jobA, jobB] = jobs;

  /** Creates a confirmed account and signs it in, without touching the email rate limit. */
  async function signIn(label) {
    const email = `verify-phase2-${label}-${stamp}@example.com`;
    const password = `verify-phase2-${stamp}-${label}`;

    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error) throw new Error(`createUser(${label}): ${created.error.message}`);

    const client = createClient(API, ANON, { auth: { persistSession: false } });
    const session = await client.auth.signInWithPassword({ email, password });
    if (session.error) throw new Error(`signIn(${label}): ${session.error.message}`);

    const userId = created.data.user.id;
    cleanup.push(() => admin.auth.admin.deleteUser(userId));
    return { client, userId };
  }

  const alice = await signIn('a');
  const bob = await signIn('b');

  // ── schema ───────────────────────────────────────────────────────────────────

  section('schema');

  for (const table of [
    'company_follows',
    'job_interactions',
    'applications',
    'application_events',
    'job_impressions',
  ]) {
    const result = await admin.from(table).select('*').limit(1);
    check(`${table} exists`, !result.error, result.error?.message ?? '');
  }

  {
    /*
     * Called twice. The first call is allowed to create something — a database that was
     * migrated last month legitimately needs this month's partition, which is exactly
     * what `npm run db:maintain` exists to do. The second must create nothing, because
     * the property worth testing is that it is idempotent and that the partitions
     * covering `now()` exist afterwards.
     */
    const created = await admin.rpc('ensure_impression_partitions', { p_months_ahead: 3 });
    check('impression partitions can be created', !created.error, created.error?.message ?? '');

    const again = await admin.rpc('ensure_impression_partitions', { p_months_ahead: 3 });
    check(
      'creating them again is a no-op',
      !again.error && again.data === 0,
      again.error?.message ?? `created ${again.data}`,
    );

    const dropped = await admin.rpc('drop_old_impression_partitions', { p_keep_months: 600 });
    check(
      'retention drops nothing it should not',
      !dropped.error && dropped.data === 0,
      dropped.error?.message ?? `dropped ${dropped.data}`,
    );
  }

  // ── authorization: anonymous ─────────────────────────────────────────────────

  section('authorization — anonymous');

  for (const table of [
    'company_follows',
    'job_interactions',
    'applications',
    'application_events',
    'job_impressions',
  ]) {
    const result = await anon.from(table).select('*').limit(1);
    check(`anon cannot read ${table}`, Boolean(result.error), result.error?.code ?? 'no error');
  }

  {
    const calls = await Promise.all([
      anon.rpc('viewer_state'),
      anon.rpc('set_job_interaction', { p_job_id: jobA, p_kind: 'like', p_on: true }),
      anon.rpc('set_company_follow', { p_company_slug: slug, p_on: true }),
      anon.rpc('log_impressions', { p_rows: [] }),
    ]);
    const names = ['viewer_state', 'set_job_interaction', 'set_company_follow', 'log_impressions'];
    calls.forEach((result, index) => {
      check(
        `anon cannot call ${names[index]}()`,
        Boolean(result.error),
        result.error?.code ?? 'no error',
      );
    });
  }

  // ── authorization: the write path is the only write path ─────────────────────

  section('authorization — signed in');

  {
    const direct = await alice.client
      .from('job_interactions')
      .insert({ user_id: alice.userId, job_id: jobA, kind: 'like' });
    check(
      'a user cannot insert a job_interaction directly',
      Boolean(direct.error),
      direct.error?.code ?? 'no error',
    );

    const follow = await alice.client
      .from('company_follows')
      .insert({ user_id: alice.userId, company_id: company.id });
    check(
      'a user cannot insert a company_follow directly',
      Boolean(follow.error),
      follow.error?.code ?? 'no error',
    );

    const counter = await alice.client
      .from('companies')
      .update({ follower_count: 9_999_999 })
      .eq('id', company.id);
    check(
      'a user cannot write companies.follower_count',
      Boolean(counter.error),
      counter.error?.code ?? 'no error',
    );
  }

  // ── follows ──────────────────────────────────────────────────────────────────

  section('follows');

  {
    const first = await alice.client.rpc('set_company_follow', { p_company_slug: slug, p_on: true });
    check('follow returns true', !first.error && first.data === true, first.error?.message ?? '');

    const again = await alice.client.rpc('set_company_follow', { p_company_slug: slug, p_on: true });
    check('following twice is still following', !again.error && again.data === true, again.error?.message ?? '');

    const rows = await admin
      .from('company_follows')
      .select('user_id', { count: 'exact', head: true })
      .eq('company_id', company.id);
    check('following twice wrote one row', rows.count === 1, `${rows.count} rows`);

    const counted = await admin
      .from('companies')
      .select('follower_count')
      .eq('id', company.id)
      .single();
    check(
      'the trigger moved follower_count to 1',
      counted.data?.follower_count === 1,
      `follower_count = ${counted.data?.follower_count}`,
    );

    const mine = await alice.client.from('company_follows').select('company_id');
    check('a user reads their own follows', !mine.error && mine.data?.length === 1, mine.error?.message ?? '');

    const theirs = await bob.client.from('company_follows').select('company_id');
    check(
      "a user cannot read someone else's follows",
      !theirs.error && theirs.data?.length === 0,
      theirs.error?.message ?? `${theirs.data?.length} rows`,
    );

    const missing = await alice.client.rpc('set_company_follow', {
      p_company_slug: `no-such-company-${stamp}`,
      p_on: true,
    });
    check('following a company that does not exist fails', Boolean(missing.error), missing.error?.code ?? 'no error');
  }

  // ── interactions ─────────────────────────────────────────────────────────────

  section('interactions');

  {
    for (const kind of ['like', 'save']) {
      const on = await alice.client.rpc('set_job_interaction', { p_job_id: jobA, p_kind: kind, p_on: true });
      check(`${kind} returns true`, !on.error && on.data === true, on.error?.message ?? '');

      const repeat = await alice.client.rpc('set_job_interaction', { p_job_id: jobA, p_kind: kind, p_on: true });
      check(`${kind} twice is idempotent`, !repeat.error && repeat.data === true, repeat.error?.message ?? '');
    }

    await alice.client.rpc('set_job_interaction', { p_job_id: jobB, p_kind: 'save', p_on: true });

    const rows = await admin
      .from('job_interactions')
      .select('job_id, kind')
      .eq('user_id', alice.userId);
    check('three interactions, no duplicates', rows.data?.length === 3, `${rows.data?.length} rows`);

    const off = await alice.client.rpc('set_job_interaction', { p_job_id: jobA, p_kind: 'like', p_on: false });
    check('unliking returns false', !off.error && off.data === false, off.error?.message ?? '');

    const offAgain = await alice.client.rpc('set_job_interaction', { p_job_id: jobA, p_kind: 'like', p_on: false });
    check('unliking twice is idempotent', !offAgain.error && offAgain.data === false, offAgain.error?.message ?? '');

    // The like/unlike/like sequence the outbox replays after a reconnect. It has to end
    // liked, which is the whole reason these are set-to-a-state rather than toggles.
    for (const on of [true, false, true]) {
      await alice.client.rpc('set_job_interaction', { p_job_id: jobA, p_kind: 'like', p_on: on });
    }
    const replayed = await admin
      .from('job_interactions')
      .select('kind', { count: 'exact', head: true })
      .eq('user_id', alice.userId)
      .eq('job_id', jobA)
      .eq('kind', 'like');
    check('like → unlike → like ends liked, once', replayed.count === 1, `${replayed.count} rows`);

    const theirs = await bob.client.from('job_interactions').select('job_id');
    check(
      "a user cannot read someone else's interactions",
      !theirs.error && theirs.data?.length === 0,
      theirs.error?.message ?? `${theirs.data?.length} rows`,
    );
  }

  // ── viewer state ─────────────────────────────────────────────────────────────

  section('viewer state');

  {
    const state = await alice.client.rpc('viewer_state');
    check('viewer_state() answers', !state.error, state.error?.message ?? '');

    const sets = state.data ?? {};
    check('liked set holds the liked posting', sets.liked_job_ids?.includes(jobA) === true);
    check('saved set holds both saved postings', sets.saved_job_ids?.length === 2, `${sets.saved_job_ids?.length} saved`);
    check('followed ids hold the company', sets.followed_company_ids?.includes(company.id) === true);
    check('followed slugs hold the slug', sets.followed_company_slugs?.includes(slug) === true);

    const empty = await bob.client.rpc('viewer_state');
    check(
      'a second user sees their own empty state, not the first',
      !empty.error &&
        empty.data?.liked_job_ids?.length === 0 &&
        empty.data?.followed_company_slugs?.length === 0,
      empty.error?.message ?? '',
    );
  }

  // ── applications ─────────────────────────────────────────────────────────────

  section('applications');

  let applicationId = null;

  {
    const created = await alice.client
      .from('applications')
      .insert({ job_id: jobA, source: 'greenhouse', applied_at: '2026-09-23' })
      .select('id, user_id, status, self_reported, status_changed_at')
      .single();

    check('an application is written', !created.error, created.error?.message ?? '');
    applicationId = created.data?.id ?? null;

    check(
      'user_id is the session, not the payload',
      created.data?.user_id === alice.userId,
      `${created.data?.user_id}`,
    );
    check('self_reported defaults to true', created.data?.self_reported === true);
    check('status defaults to applied', created.data?.status === 'applied');

    const forged = await alice.client
      .from('applications')
      .insert({ job_id: jobB, source: 'company', user_id: bob.userId });
    check(
      'a user cannot author an application for someone else',
      Boolean(forged.error),
      forged.error?.code ?? 'no error',
    );

    const lying = await alice.client
      .from('applications')
      .update({ self_reported: false })
      .eq('id', applicationId);
    check(
      'a user cannot claim an application was observed rather than self-reported',
      Boolean(lying.error),
      lying.error?.code ?? 'no error',
    );

    const duplicate = await alice.client
      .from('applications')
      .insert({ job_id: jobA, source: 'greenhouse' });
    check(
      're-applying to the same posting is refused by the unique constraint',
      duplicate.error?.code === '23505',
      duplicate.error?.code ?? 'no error',
    );

    const removed = await alice.client.from('applications').delete().eq('id', applicationId);
    check(
      'a user cannot delete a tracked application',
      Boolean(removed.error),
      removed.error?.code ?? 'no error',
    );
  }

  {
    const opened = await admin
      .from('application_events')
      .select('from_status, to_status')
      .eq('application_id', applicationId);
    check(
      'tracking an application writes its first event',
      opened.data?.length === 1 && opened.data[0].from_status === null && opened.data[0].to_status === 'applied',
      JSON.stringify(opened.data),
    );

    const before = await admin
      .from('applications')
      .select('status_changed_at')
      .eq('id', applicationId)
      .single();

    const moved = await alice.client
      .from('applications')
      .update({ status: 'interview' })
      .eq('job_id', jobA)
      .select('status, status_changed_at')
      .single();

    check('a stage change lands', !moved.error && moved.data?.status === 'interview', moved.error?.message ?? '');
    check(
      'status_changed_at is stamped by the database',
      new Date(moved.data?.status_changed_at ?? 0) > new Date(before.data?.status_changed_at ?? 0),
      `${before.data?.status_changed_at} → ${moved.data?.status_changed_at}`,
    );

    const history = await admin
      .from('application_events')
      .select('from_status, to_status')
      .eq('application_id', applicationId)
      .order('created_at', { ascending: true });
    check(
      'the stage change is in the history with where it came from',
      history.data?.length === 2 &&
        history.data[1].from_status === 'applied' &&
        history.data[1].to_status === 'interview',
      JSON.stringify(history.data),
    );

    // A no-op update must not manufacture history — a disputed streak is audited from
    // these rows, and an event per save would make them unreadable.
    await alice.client.from('applications').update({ status: 'interview' }).eq('job_id', jobA);
    const unchanged = await admin
      .from('application_events')
      .select('id', { count: 'exact', head: true })
      .eq('application_id', applicationId);
    check('re-setting the same stage writes no event', unchanged.count === 2, `${unchanged.count} events`);

    const theirs = await bob.client.from('applications').select('id');
    check(
      "a user cannot read someone else's applications",
      !theirs.error && theirs.data?.length === 0,
      theirs.error?.message ?? `${theirs.data?.length} rows`,
    );

    const theirEvents = await bob.client.from('application_events').select('id');
    check(
      "a user cannot read someone else's application history",
      !theirEvents.error && theirEvents.data?.length === 0,
      theirEvents.error?.message ?? `${theirEvents.data?.length} rows`,
    );
  }

  // ── impressions ──────────────────────────────────────────────────────────────

  section('impressions');

  const sessionId = '11111111-2222-3333-4444-555555555555';

  {
    const written = await alice.client.rpc('log_impressions', {
      p_rows: [
        { job_id: jobA, surface: 'reels', session_id: sessionId, position: 0, dwell_ms: 4200, completed: true },
        { job_id: jobB, surface: 'home', session_id: sessionId, position: 1 },
      ],
    });
    check('a batch is written', !written.error && written.data === 2, written.error?.message ?? `${written.data}`);

    const rows = await admin
      .from('job_impressions')
      .select('user_id, job_id, surface, position, dwell_ms, completed')
      .eq('session_id', sessionId)
      .order('position', { ascending: true });

    check('user_id is the session, not the payload', rows.data?.every((row) => row.user_id === alice.userId));
    check('dwell and completed survive the round trip', rows.data?.[0]?.dwell_ms === 4200 && rows.data[0].completed === true);
    check(
      'a surface with no dwell to report stores null rather than zero',
      rows.data?.[1]?.dwell_ms === null && rows.data[1].completed === null,
      JSON.stringify(rows.data?.[1]),
    );

    const own = await alice.client.from('job_impressions').select('job_id').limit(1);
    check(
      'a user cannot read their own impression log back',
      Boolean(own.error),
      own.error?.code ?? 'no error',
    );
  }

  {
    const junkSession = '66666666-7777-8888-9999-000000000000';
    const junk = await alice.client.rpc('log_impressions', {
      p_rows: [
        { surface: 'reels', session_id: junkSession },
        { job_id: jobA, session_id: junkSession },
        { job_id: jobA, surface: 'reels' },
        { job_id: jobA, surface: 'reels', session_id: junkSession, dwell_ms: 99_999_999 },
        { job_id: jobA, surface: 'reels', session_id: junkSession, shown_at: '2099-01-01T00:00:00Z' },
      ],
    });
    check(
      'malformed rows are dropped rather than failing the batch',
      !junk.error && junk.data === 2,
      junk.error?.message ?? `wrote ${junk.data} of 5`,
    );

    const rows = await admin
      .from('job_impressions')
      .select('dwell_ms, shown_at')
      .eq('session_id', junkSession)
      .order('dwell_ms', { ascending: false, nullsFirst: false });

    check(
      'an implausible dwell is clamped, not stored',
      rows.data?.[0]?.dwell_ms === 600_000,
      `${rows.data?.[0]?.dwell_ms}`,
    );
    check(
      'a shown_at from a wrong clock is clamped to now',
      rows.data?.every((row) => new Date(row.shown_at) <= new Date(Date.now() + 5_000)),
      JSON.stringify(rows.data?.map((row) => row.shown_at)),
    );

    const oversized = Array.from({ length: 250 }, (_, index) => ({
      job_id: jobA,
      surface: 'reels',
      session_id: '99999999-9999-9999-9999-999999999999',
      position: index,
    }));
    const capped = await alice.client.rpc('log_impressions', { p_rows: oversized });
    check(
      'a batch is capped rather than rejected',
      !capped.error && capped.data === 200,
      capped.error?.message ?? `wrote ${capped.data} of 250`,
    );
  }

  // ── impressions at volume ────────────────────────────────────────────────────

  section('impressions at volume');

  {
    /*
     * §3.6 sizes this at ~60 cards a session and ~3M rows/day across the userbase. What
     * matters for the exit condition is that the *shape* holds: one call per batch, a
     * multi-row insert behind it, and partitioned storage that does not degrade as the
     * batches pile up. Ten batches of two hundred is one heavy session's worth, run
     * through the same RPC the app calls.
     */
    const volumeSession = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const batches = 10;
    const perBatch = 200;

    const startedAt = Date.now();
    let written = 0;

    for (let batch = 0; batch < batches; batch += 1) {
      const rows = Array.from({ length: perBatch }, (_, index) => ({
        job_id: jobs[(batch * perBatch + index) % jobs.length],
        surface: 'reels',
        session_id: volumeSession,
        position: index,
        dwell_ms: 1_000 + index,
        completed: index % 3 !== 0,
      }));

      const result = await alice.client.rpc('log_impressions', { p_rows: rows });
      if (result.error) {
        check(`batch ${batch + 1} of ${batches}`, false, result.error.message);
        break;
      }
      written += result.data;
    }

    const elapsed = Date.now() - startedAt;

    check(
      `${batches * perBatch} impressions written in ${batches} calls`,
      written === batches * perBatch,
      `${written} rows`,
    );

    const stored = await admin
      .from('job_impressions')
      .select('job_id', { count: 'exact', head: true })
      .eq('session_id', volumeSession);
    check('every one of them is in the table', stored.count === batches * perBatch, `${stored.count} rows`);

    note(
      'throughput',
      `${elapsed}ms for ${batches * perBatch} rows — ${Math.round((batches * perBatch) / (elapsed / 1000))} rows/sec, ${Math.round(elapsed / batches)}ms per batch`,
    );

    cleanup.push(() =>
      admin
        .from('job_impressions')
        .delete()
        .in('session_id', [
          sessionId,
          '66666666-7777-8888-9999-000000000000',
          '99999999-9999-9999-9999-999999999999',
          volumeSession,
        ]),
    );
  }

  // ── reconciliation ───────────────────────────────────────────────────────────

  section('reconciliation');

  {
    // Knock the denormalized counter out of true, the way a missed trigger or a manual
    // fix-up would, and check the nightly pass notices.
    await admin.from('companies').update({ follower_count: 41 }).eq('id', company.id);

    const corrected = await admin.rpc('reconcile_follower_counts');
    check('the nightly reconcile corrects a drifted count', !corrected.error && corrected.data >= 1, corrected.error?.message ?? '');

    const after = await admin.from('companies').select('follower_count').eq('id', company.id).single();
    check('it is back to the real number', after.data?.follower_count === 1, `${after.data?.follower_count}`);

    await alice.client.rpc('set_company_follow', { p_company_slug: slug, p_on: false });
    const unfollowed = await admin.from('companies').select('follower_count').eq('id', company.id).single();
    check('unfollowing decrements it again', unfollowed.data?.follower_count === 0, `${unfollowed.data?.follower_count}`);
  }
}

try {
  await main();
} catch (error) {
  failures += 1;
  console.error(`\nFAIL  the run itself — ${error instanceof Error ? error.message : String(error)}`);
} finally {
  /*
   * Deleting the users cascades through profiles into their follows, interactions and
   * applications; impressions have no foreign key and are removed by session id. The
   * postings go last because `applications.job_id` is `on delete restrict` and would
   * otherwise refuse — which is the constraint working.
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
    ? '\nPhase 2 verified: every interaction persists, nobody can reach anyone else’s, and impressions batch at volume.\n'
    : `\n${failures} check${failures === 1 ? '' : 's'} failed.\n`,
);

process.exit(failures === 0 ? 0 : 1);
