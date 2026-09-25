/*
 * Checks phase 4's exit condition against the local stack:
 * "the match ring shows a real, explainable number."
 *
 *   npm run db:start
 *   npm run db:reset
 *   npm run server:dev        # in another terminal — the parse path is HTTP
 *   npm run verify:phase4
 *
 * Deterministic and self-cleaning, like phases 2 and 3: it creates its own company, postings,
 * accounts and resume, drives every path, and removes what it made. It passes on a database
 * that has just been reset.
 *
 * Half of it needs `npm run server:dev`, because parsing needs a model and issuing a signed URL
 * needs to write an audit row first. If the service is unreachable the script says so, skips
 * that half, and still fails on anything wrong with the database half.
 *
 * The real PDF it parses is `assets/resumes/engineering.pdf` — one of the two documents that
 * used to be compiled into the app as a fixture. It is a genuine two-column resume, which makes
 * it a better parser test than anything that could be generated here.
 *
 * Four kinds of check are mixed on purpose:
 *
 *  - **It works.** A resume uploads, parses, scores, and the score has ingredients.
 *  - **It cannot be subverted.** Nobody reads another account's resume, writes a profile, forges
 *    an audit row, or puts an object in somebody else's folder.
 *  - **It does not leak.** `storage_path`, the encrypted contact fields and `raw_parse` are
 *    hunted for in every shape a client can obtain — the same treatment phase 3 gave `author_id`.
 *  - **The number means something.** A matching resume scores far above a non-matching one
 *    against the same posting, `components` is populated, and the arithmetic is reproducible.
 *
 * Local only. It reads the fixed CLI demo keys and writes throwaway rows through the service
 * role — never point it at a real project.
 */

import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = 'http://127.0.0.1:54721';
const SERVICE_API = process.env.CAREERDECK_API_URL ?? 'http://127.0.0.1:8787';
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const anon = createClient(API, ANON, { auth: { persistSession: false } });
const admin = createClient(API, SERVICE, { auth: { persistSession: false } });

const here = dirname(fileURLToPath(import.meta.url));
const SAMPLE_PDF = join(here, '..', 'assets', 'resumes', 'engineering.pdf');

let failures = 0;
let skipped = 0;
/**
 * Set only when a real PDF actually went through the model.
 *
 * The closing line reads it rather than asserting it, because "a real resume parses" is the
 * headline claim of this phase and a run with no model credential has not established it. A
 * summary that says so anyway is how a phase gets recorded as proven on the strength of its
 * SQL alone.
 */
let parsedForReal = false;

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
 * Lifted from `verify-phase3.mjs`, where it hunted `author_id`. The reason it is a deep search
 * rather than a field list is the same: the failure it guards against is somebody adding a
 * column, a join or an embedded select six months from now, and that change would pass every
 * check that only inspects the keys it already knows about.
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

  const slug = `verify-phase4-${stamp}`;

  const companyInsert = await admin
    .from('companies')
    .insert({ slug, name: `Verify Phase 4 ${stamp}`, industry: 'Testing' })
    .select('id')
    .single();

  if (companyInsert.error) {
    console.error(`\nCould not create the fixture company: ${companyInsert.error.message}`);
    console.error('Is `npm run db:start` running, and has `npm run db:reset` been applied?');
    process.exit(1);
  }

  const company = companyInsert.data;
  cleanup.push(() => admin.from('companies').delete().eq('id', company.id));

  /*
   * Three postings chosen so the scorer has something to be right or wrong about:
   *
   *  - `match`  — the skills a software resume has, at the level a student applies at, remote.
   *  - `miss`   — nothing in common, three rungs up the ladder.
   *  - `thin`   — no skills listed at all, which is the renormalization case: it can only be
   *               scored on seniority and location, and `coverage` has to say so.
   */
  const jobsInsert = await admin
    .from('jobs')
    .insert([
      {
        company_id: company.id,
        company_name: `Verify Phase 4 ${stamp}`,
        title: 'Verify Software Engineer Intern',
        title_normalized: 'verify software engineer intern',
        seniority: 'intern',
        location_type: 'Remote',
        employment_type: 'Internship',
        skills: ['python', 'javascript', 'react', 'sql', 'git'],
        description_text: 'A posting that exists only for verify:phase4.',
        apply_url: `https://example.invalid/${stamp}/match`,
      },
      {
        company_id: company.id,
        company_name: `Verify Phase 4 ${stamp}`,
        title: 'Verify Principal Petroleum Geologist',
        title_normalized: 'verify principal petroleum geologist',
        seniority: 'staff_plus',
        location_type: 'Onsite',
        location_city: 'Midland',
        location_region: 'TX',
        employment_type: 'Full-time',
        skills: ['seismic-interpretation', 'petrophysics', 'reservoir-modelling'],
        description_text: 'A posting that exists only for verify:phase4.',
        apply_url: `https://example.invalid/${stamp}/miss`,
      },
      {
        company_id: company.id,
        company_name: `Verify Phase 4 ${stamp}`,
        title: 'Verify Unspecified Role',
        title_normalized: 'verify unspecified role',
        seniority: 'intern',
        location_type: 'Remote',
        employment_type: 'Internship',
        skills: [],
        description_text: 'A posting that exists only for verify:phase4.',
        apply_url: `https://example.invalid/${stamp}/thin`,
      },
    ])
    .select('id, title');

  if (jobsInsert.error) {
    console.error(`\nCould not create the fixture postings: ${jobsInsert.error.message}`);
    process.exit(1);
  }

  const jobMatch = jobsInsert.data.find((row) => row.title.includes('Software')).id;
  const jobMiss = jobsInsert.data.find((row) => row.title.includes('Geologist')).id;
  const jobThin = jobsInsert.data.find((row) => row.title.includes('Unspecified')).id;

  async function signIn(label) {
    const email = `verify-phase4-${label}-${stamp}@example.com`;
    const password = `verify-phase4-${stamp}-${label}`;

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

  check('two accounts exist', Boolean(alice.id && bob.id));

  const pdf = await readFile(SAMPLE_PDF);
  check('a real resume PDF is on hand to parse', pdf.length > 1000, `${pdf.length} bytes`);

  // ── the bucket ───────────────────────────────────────────────────────────────

  section('storage');

  const buckets = await admin.storage.listBuckets();
  const resumeBucket = (buckets.data ?? []).find((entry) => entry.id === 'resumes');
  check('the `resumes` bucket exists', Boolean(resumeBucket));
  check('it is private', resumeBucket?.public === false);
  check(
    'it accepts PDFs and nothing else',
    JSON.stringify(resumeBucket?.allowed_mime_types ?? []) === JSON.stringify(['application/pdf']),
    String(resumeBucket?.allowed_mime_types),
  );

  const thumbBucket = (buckets.data ?? []).find((entry) => entry.id === 'resume-thumbnails');
  check('the thumbnail bucket exists and is private too', thumbBucket?.public === false);

  // ── upload and register ──────────────────────────────────────────────────────

  section('upload');

  const aliceObject = `${alice.id}/${stamp}-alice.pdf`;
  const aliceUpload = await alice.client.storage
    .from('resumes')
    .upload(aliceObject, pdf, { contentType: 'application/pdf' });

  /*
   * A known defect in some local stacks, and not a phase 4 failure — so it is detected by name
   * rather than reported as one.
   *
   * Storage schema migration 72 (`drop-bucketid-objname-index`) removed the plain unique index
   * on `(bucket_id, name)` and replaced it with one that is partial on `where not is_versioned`.
   * A partial index cannot serve as an `on conflict` arbiter unless the statement repeats the
   * predicate, and storage-api v1.72.1 still issues a bare `on conflict (name, bucket_id)` — so
   * every upload to every bucket fails with 42P10 on that pairing. Nothing in this phase can
   * cause it and nothing in this phase can fix it; the cure is an aligned stack.
   */
  const stackBroken = /42P10/.test(aliceUpload.error?.message ?? '');

  if (stackBroken) {
    skip(
      'the storage round trip',
      'local stack defect: storage-api upserts on (name, bucket_id), an index migration 72 ' +
        'dropped. Every bucket is affected, so this is not about the resumes bucket.',
    );
  } else {
    check('an owner can put a file in their own folder', !aliceUpload.error, aliceUpload.error?.message);

    const intoBobsFolder = await alice.client.storage
      .from('resumes')
      .upload(`${bob.id}/${stamp}-stolen.pdf`, pdf, { contentType: 'application/pdf' });
    check("nobody can put a file in somebody else's folder", Boolean(intoBobsFolder.error));

    /*
     * The decision that makes the audit log complete rather than decorative — PHASE4.md §4.2.
     * If this ever starts failing because somebody added a select policy "for convenience", the
     * log has a hole in it exactly where the app's own reads are.
     */
    const directRead = await alice.client.storage.from('resumes').download(aliceObject);
    check('not even the owner can read the object directly', Boolean(directRead.error));
  }

  /*
   * The policies, read out of the catalogue rather than driven through a container.
   *
   * Weaker than exercising them, and still the check that matters most: decision C rests on
   * there being **no select policy** on this bucket, which is a statement about `pg_policies`
   * rather than about a round trip. Somebody adding one later trips this even on a stack whose
   * uploads are broken — which is precisely when it would otherwise go unnoticed.
   */
  const raw = await admin.from('pg_policies').select('policyname, cmd').eq('tablename', 'objects');
  if (raw.error) {
    skip('the policy catalogue', 'pg_policies is not reachable over PostgREST on this stack');
  } else {
    const mine = (raw.data ?? []).filter((row) => row.policyname.startsWith('resume_'));
    check('the resume buckets carry write policies', mine.length >= 4, `${mine.length} policies`);
    check('and no select policy anywhere near them — decision C',
      mine.length > 0 && !mine.some((row) => row.cmd === 'SELECT'),
      mine.map((row) => `${row.policyname}:${row.cmd}`).join(', '));
  }

  const registered = await alice.client.rpc('register_resume', {
    p_name: 'Verify Engineering Resume',
    p_storage_path: aliceObject,
  });
  check('registering the upload returns a card', !registered.error, registered.error?.message);

  const resumeId = registered.data?.id;
  check('the first resume is the default', registered.data?.is_default === true);
  check('it starts unparsed', registered.data?.parse_status === 'pending');

  const wrongPath = await alice.client.rpc('register_resume', {
    p_name: 'Not mine',
    p_storage_path: `${bob.id}/${stamp}-nope.pdf`,
  });
  check('a resume cannot be registered against another account\'s path', Boolean(wrongPath.error));

  // ── the anonymity-equivalent: what a client can see ──────────────────────────

  section('what a client can reach');

  const listed = await alice.client.rpc('my_resumes');
  check('the owner sees their own resume', (listed.data ?? []).length === 1);

  const leaked = findForbiddenKey(listed.data, [
    'storage_path',
    'full_name_enc',
    'email_enc',
    'phone_enc',
    'raw_parse',
    'user_id',
  ]);
  check('no storage path, sealed field or raw parse rides on the card', leaked === null, leaked ?? '');

  const bobsList = await bob.client.rpc('my_resumes');
  check('another account sees none of it', (bobsList.data ?? []).length === 0);

  for (const table of ['resumes', 'resume_profiles', 'pii_access_log']) {
    const direct = await alice.client.from(table).select('*').limit(1);
    check(
      `\`${table}\` is unreadable from a client`,
      Boolean(direct.error) || (direct.data ?? []).length === 0,
      direct.error?.message ?? 'returned rows',
    );
  }

  for (const [fn, args] of [
    ['save_resume_profile', { p_resume_id: resumeId, p_parser_version: 'forged' }],
    [
      'log_pii_access',
      {
        p_actor_type: 'staff',
        p_actor_id: null,
        p_subject: bob.id,
        p_resource: 'resume_pdf',
        p_resource_id: null,
        p_purpose: 'support',
      },
    ],
    ['set_parse_status', { p_resume_id: resumeId, p_status: 'parsed' }],
    ['resume_for_service', { p_resume_id: resumeId }],
    ['invalidate_match_scores', { p_user_id: bob.id }],
  ]) {
    const attempt = await alice.client.rpc(fn, args);
    check(`a client cannot call \`${fn}()\``, Boolean(attempt.error), attempt.error?.code ?? '');
  }

  // ── the parse (HTTP) ─────────────────────────────────────────────────────────

  section('parse');

  let serviceUp = false;
  try {
    const health = await fetch(`${SERVICE_API}/health`, { signal: AbortSignal.timeout(2000) });
    const body = await health.json();
    serviceUp = body?.ok === true;
    note('service capabilities', JSON.stringify(body?.capabilities ?? {}));
    if (!body?.capabilities?.resumeParsing) {
      note('ANTHROPIC_API_KEY', 'not set on the server — the parse will refuse with 503');
    }
    if (!body?.capabilities?.resumeEncryption) {
      note('RESUME_ENCRYPTION_KEY', 'not set — contact fields will be dropped rather than sealed');
    }
  } catch {
    serviceUp = false;
  }

  let parsed = false;

  if (!serviceUp) {
    skip('the parse path', `${SERVICE_API} is unreachable — run \`npm run server:dev\``);
  } else {
    const response = await fetch(`${SERVICE_API}/v1/resumes/${resumeId}/parse`, {
      method: 'POST',
      headers: { authorization: `Bearer ${alice.token}`, 'content-type': 'application/json' },
      signal: AbortSignal.timeout(180_000),
    });
    const payload = await response.json().catch(() => null);

    if (response.status === 503) {
      skip('the parse itself', payload?.error ?? 'the server has no model credential');
    } else {
      check('the parse returns 200', response.ok, `${response.status} ${payload?.error ?? ''}`);
      parsed = response.ok;
      parsedForReal = response.ok;

      if (parsed) {
        const profile = payload?.profile ?? {};
        note('skills read', (profile.skills ?? []).slice(0, 12).join(', '));
        note('seniority / years', `${profile.seniority} / ${profile.yearsExperience}`);

        check('it extracted at least a few skills', (profile.skills ?? []).length >= 3,
          `${(profile.skills ?? []).length} skills`);
        check('every skill is a slug, not a sentence',
          (profile.skills ?? []).every((s) => /^[a-z0-9][a-z0-9+#.-]{1,39}$/.test(s)),
          (profile.skills ?? []).filter((s) => !/^[a-z0-9][a-z0-9+#.-]{1,39}$/.test(s)).join(', '));
        check('it picked a seniority',
          ['intern', 'new_grad', 'mid', 'senior', 'staff_plus'].includes(profile.seniority),
          String(profile.seniority));

        /*
         * The contact fields are reported as found-or-not and never returned. This is the
         * response the review screen renders, so a plaintext email appearing here would be a
         * P0 field on the wire and on a device, which §4.4 exists to prevent.
         */
        const contactLeak = findForbiddenKey(payload, ['fullName', 'email', 'phone']);
        check('the response names no contact detail', contactLeak === null, contactLeak ?? '');
        check('it does say whether they were found',
          typeof payload?.profile?.contactFound?.email === 'boolean');

        const stored = await admin
          .from('resume_profiles')
          .select('skills, seniority, full_name_enc, email_enc, raw_parse, parser_version, user_confirmed_at')
          .eq('resume_id', resumeId)
          .maybeSingle();

        check('the profile landed in the database', !stored.error && Boolean(stored.data));
        check('with a parser version stamped on it', Boolean(stored.data?.parser_version),
          String(stored.data?.parser_version));
        check('and no confirmation yet', stored.data?.user_confirmed_at === null);

        /*
         * The contact fields are bytea. What arrives over PostgREST is the hex escape form, so
         * "is this ciphertext" is answered by: it is not the plaintext, and it starts with the
         * version byte the layout in `crypto.ts` specifies.
         */
        const sealedName = stored.data?.full_name_enc;
        if (sealedName === null || sealedName === undefined) {
          skip('contact fields are sealed', 'RESUME_ENCRYPTION_KEY is not set on the server');
        } else {
          check('the name is stored as ciphertext', /^\\x01/.test(String(sealedName)),
            String(sealedName).slice(0, 12));
          check('it is long enough to carry a nonce and a tag',
            String(sealedName).length > 2 + (1 + 12 + 16) * 2);
        }

        const raw = JSON.stringify(stored.data?.raw_parse ?? {});
        check('`raw_parse` keeps no plaintext contact detail',
          /"fullName":null/.test(raw) && /"email":null/.test(raw));
      }
    }
  }

  // ── the number ───────────────────────────────────────────────────────────────

  section('the match score');

  if (!parsed) {
    /*
     * The scorer is pure SQL and does not need the model, so it is still worth exercising when
     * the parse was skipped — a profile is written by hand and the arithmetic is checked
     * against it. What cannot be checked without the service is that a *real* resume produces
     * a sensible one, which is the part the skip is about.
     */
    note('no parse', 'writing a profile by hand so the scorer is still exercised');
    const written = await admin.rpc('save_resume_profile', {
      p_resume_id: resumeId,
      p_parser_version: 'verify-phase4-handwritten',
      p_skills: ['python', 'javascript', 'react', 'sql', 'docker'],
      p_seniority: 'intern',
      p_years: 1,
      p_location: 'Boulder, CO',
    });
    check('a profile can be written by the service role', !written.error, written.error?.message);
  }

  await alice.client.from('user_preferences').update({
    preferred_locations: ['Boulder, CO'],
    open_to_remote: true,
  }).eq('user_id', alice.id);

  const scores = await alice.client.rpc('match_scores', {
    p_job_ids: [jobMatch, jobMiss, jobThin],
  });
  check('scores come back', !scores.error, scores.error?.message);

  const byJob = new Map((scores.data ?? []).map((row) => [row.job_id, row]));
  const matchRow = byJob.get(jobMatch);
  const missRow = byJob.get(jobMiss);
  const thinRow = byJob.get(jobThin);

  note('scores', [...byJob.values()].map((r) => `${r.score}`).join(' / '));

  check('the matching posting scores', typeof matchRow?.score === 'number', String(matchRow?.score));
  check('the unrelated posting scores too', typeof missRow?.score === 'number', String(missRow?.score));

  /*
   * The exit condition, as a number. "Real" means it moves with the inputs — a resume that
   * matches has to beat one that does not by a wide margin, or the ring is decoration again.
   * The old `resumeMatchScore()` would have failed this: it was a hash, so the gap between
   * these two postings was whatever the hash happened to produce.
   */
  check('a matching posting beats an unrelated one by a mile',
    (matchRow?.score ?? 0) - (missRow?.score ?? 100) > 40,
    `${matchRow?.score} vs ${missRow?.score}`);

  check('every score carries its ingredients',
    [...byJob.values()].every((row) => row.components && Object.keys(row.components).length > 0),
    JSON.stringify(matchRow?.components));

  check('the ingredients are the three §3.10 names',
    ['skillOverlap', 'seniority', 'location'].every((key) => key in (matchRow?.components ?? {})),
    Object.keys(matchRow?.components ?? {}).join(', '));

  check('a posting with no skills is scored on what is left, and says so',
    typeof thinRow?.components?.coverage === 'number' &&
      thinRow.components.coverage < 1 &&
      !('skillOverlap' in (thinRow?.components ?? {})),
    JSON.stringify(thinRow?.components));

  check('a full-coverage score says that too', matchRow?.components?.coverage === 1,
    String(matchRow?.components?.coverage));

  /*
   * §3.10's "recomputed lazily on feed build for the candidate set only". The read writes, so
   * the second call must be a cache hit — a `computed_at` that moves would mean every scroll
   * rescores the whole page.
   */
  const again = await alice.client.rpc('match_scores', { p_job_ids: [jobMatch] });
  check('a second read is cached, not recomputed',
    again.data?.[0]?.computed_at === matchRow?.computed_at);

  const bobsScores = await bob.client.rpc('match_scores', { p_job_ids: [jobMatch, jobMiss] });
  check('an account with no resume gets no scores rather than zeros',
    (bobsScores.data ?? []).length === 0);

  const bobPeeking = await bob.client.from('job_match_scores').select('*');
  check('nobody reads another account\'s scores',
    (bobPeeking.data ?? []).every((row) => row.user_id === bob.id),
    `${(bobPeeking.data ?? []).length} rows`);

  // ── confirmation ─────────────────────────────────────────────────────────────

  section('the confirmation screen');

  const confirmed = await alice.client.rpc('confirm_resume_profile', {
    p_resume_id: resumeId,
    p_skills: ['python', 'javascript', 'react', 'sql', 'kubernetes'],
    p_seniority: 'new_grad',
  });
  check('confirming returns the updated card', !confirmed.error, confirmed.error?.message);
  check('it stamps `user_confirmed_at`', Boolean(confirmed.data?.user_confirmed_at));
  check('and takes the corrections',
    (confirmed.data?.skills ?? []).includes('kubernetes') && confirmed.data?.seniority === 'new_grad');

  const fields = await admin
    .from('resume_profiles')
    .select('confirmed_fields')
    .eq('resume_id', resumeId)
    .maybeSingle();
  check('§3.9\'s free accuracy data: it records which fields moved',
    (fields.data?.confirmed_fields ?? []).includes('skills') &&
      (fields.data?.confirmed_fields ?? []).includes('seniority'),
    (fields.data?.confirmed_fields ?? []).join(', '));

  const afterConfirm = await admin
    .from('job_match_scores')
    .select('job_id')
    .eq('user_id', alice.id);
  check('a correction invalidates every cached score',
    (afterConfirm.data ?? []).length === 0,
    `${(afterConfirm.data ?? []).length} left`);

  const bobsConfirm = await bob.client.rpc('confirm_resume_profile', { p_resume_id: resumeId });
  check('nobody confirms another account\'s parse', Boolean(bobsConfirm.error));

  // ── invalidation ─────────────────────────────────────────────────────────────

  section('invalidation');

  await alice.client.rpc('match_scores', { p_job_ids: [jobMatch, jobMiss] });
  const before = await admin.from('job_match_scores').select('job_id').eq('user_id', alice.id);
  check('scores repopulate on the next read', (before.data ?? []).length > 0);

  await alice.client
    .from('user_preferences')
    .update({ preferred_locations: ['Reykjavik'] })
    .eq('user_id', alice.id);

  const afterPrefs = await admin.from('job_match_scores').select('job_id').eq('user_id', alice.id);
  check('changing a preference invalidates them — §3.10, by trigger',
    (afterPrefs.data ?? []).length === 0,
    `${(afterPrefs.data ?? []).length} left`);

  // ── the default invariant ────────────────────────────────────────────────────

  section('exactly one default');

  const secondObject = `${alice.id}/${stamp}-second.pdf`;
  if (!stackBroken) {
    await alice.client.storage
      .from('resumes')
      .upload(secondObject, pdf, { contentType: 'application/pdf' });
  }
  const second = await alice.client.rpc('register_resume', {
    p_name: 'Verify Second Resume',
    p_storage_path: secondObject,
  });
  check('a second resume registers', !second.error, second.error?.message);
  check('and is not automatically the default', second.data?.is_default === false);

  const switched = await alice.client.rpc('set_default_resume', { p_resume_id: second.data?.id });
  check('the default can be switched', switched.data === true);

  const defaults = await admin
    .from('resumes')
    .select('id, is_default')
    .eq('user_id', alice.id)
    .is('deleted_at', null);
  check('exactly one is default, as an index rather than a convention',
    (defaults.data ?? []).filter((row) => row.is_default).length === 1);

  const forced = await admin
    .from('resumes')
    .update({ is_default: true })
    .eq('id', resumeId);
  check('the database refuses a second default outright', Boolean(forced.error),
    forced.error?.code ?? 'the update succeeded');

  const bobsSwitch = await bob.client.rpc('set_default_resume', { p_resume_id: resumeId });
  check('nobody sets a default on another account\'s resume', bobsSwitch.data === false);

  // ── the audit log ────────────────────────────────────────────────────────────

  section('pii_access_log');

  if (!serviceUp) {
    skip('signed URLs and their audit rows', `${SERVICE_API} is unreachable`);
  } else {
    const before = await admin
      .from('pii_access_log')
      .select('id')
      .eq('subject_user_id', alice.id);

    const signed = await fetch(`${SERVICE_API}/v1/resumes/${resumeId}/url`, {
      headers: { authorization: `Bearer ${alice.token}` },
      signal: AbortSignal.timeout(10_000),
    });
    const signedBody = await signed.json().catch(() => null);
    if (stackBroken) {
      /*
       * There is no object to sign, because the upload could not land. What is still worth
       * asserting is the ordering: the access row below is written *before* the signing is
       * attempted, so a failure to sign does not erase the record that somebody asked. An
       * audit trail written only on success is an audit trail that misses the interesting
       * accesses.
       */
      skip('the signed URL itself', 'no object was uploaded, so there is nothing to sign');
      check('asking still wrote the access row, before the signing was attempted',
        signed.status === 502, `${signed.status}`);
    } else {
      check('the service issues a signed URL', signed.ok && typeof signedBody?.url === 'string',
        `${signed.status}`);
    }

    const after = await admin
      .from('pii_access_log')
      .select('id, actor_type, actor_id, resource, purpose')
      .eq('subject_user_id', alice.id)
      .order('id', { ascending: false });

    check('§3.9: issuing it wrote an access row',
      (after.data ?? []).length > (before.data ?? []).length);
    check('the row names who, what and why',
      after.data?.[0]?.actor_id === alice.id &&
        after.data?.[0]?.resource === 'resume_pdf' &&
        after.data?.[0]?.purpose === 'user_download',
      JSON.stringify(after.data?.[0]));

    if (parsed) {
      check('the parse wrote one too',
        (after.data ?? []).some((row) => row.purpose === 'parse' && row.actor_type === 'service'));
    }

    const stolen = await fetch(`${SERVICE_API}/v1/resumes/${resumeId}/url`, {
      headers: { authorization: `Bearer ${bob.token}` },
      signal: AbortSignal.timeout(10_000),
    });
    check('somebody else\'s resume is a 404, not a 403', stolen.status === 404,
      `${stolen.status}`);

    const unauthenticated = await fetch(`${SERVICE_API}/v1/resumes/${resumeId}/url`, {
      signal: AbortSignal.timeout(10_000),
    });
    check('and an unauthenticated request is a 401', unauthenticated.status === 401);
  }

  const forgedLog = await alice.client.from('pii_access_log').insert({
    actor_type: 'staff',
    subject_user_id: bob.id,
    resource: 'resume_pdf',
    purpose: 'support',
  });
  check('an audit row cannot be forged from a client', Boolean(forgedLog.error));

  // ── deletion and retention ───────────────────────────────────────────────────

  section('deletion');

  const removed = await alice.client.rpc('delete_resume', { p_resume_id: second.data?.id });
  check('a resume soft-deletes', removed.data === true);

  const afterDelete = await alice.client.rpc('my_resumes');
  check('it leaves the shelf', (afterDelete.data ?? []).length === 1);
  check('and the survivor is promoted rather than leaving no default',
    afterDelete.data?.[0]?.is_default === true);

  const row = await admin
    .from('resumes')
    .select('deleted_at, storage_path')
    .eq('id', second.data?.id)
    .maybeSingle();
  check('the row survives with a tombstone — §13.2\'s 30-day grace',
    row.data?.deleted_at !== null);

  if (stackBroken) {
    skip('the file outliving the row until the sweep runs', 'no object was uploaded');
  } else {
    const stillThere = await admin.storage.from('resumes').download(row.data?.storage_path);
    check('the file is still in the bucket until the sweep runs', !stillThere.error);
  }

  /*
   * Backdated rather than swept with `p_grace_days: 0`.
   *
   * The function floors the grace period at one day (`greatest(..., 1)`), which is deliberate:
   * a zero passed by a misconfigured cron would destroy every resume deleted in the last
   * minute, including the ones whose owners are about to undo it. Testing the sweep therefore
   * means ageing the row, not disarming the guard.
   */
  await admin
    .from('resumes')
    .update({ deleted_at: new Date(Date.now() - 45 * 86_400_000).toISOString() })
    .eq('id', second.data?.id);

  const purged = await admin.rpc('prune_deleted_resumes', { p_grace_days: 30 });
  check('the sweep collects it and hands back the path to destroy',
    (purged.data ?? []).some((entry) => entry.storage_path === row.data?.storage_path),
    `${(purged.data ?? []).length} purged`);

  const logAfterPurge = await admin
    .from('pii_access_log')
    .select('id')
    .eq('subject_user_id', alice.id);
  check('the access log outlives the resume it describes',
    (logAfterPurge.data ?? []).length > 0,
    `${(logAfterPurge.data ?? []).length} rows`);

  // ── the seal ─────────────────────────────────────────────────────────────────

  section('contact-field encryption');

  /*
   * Run in a child process against the real module rather than reimplemented here.
   *
   * A verification that reimplements the thing it is verifying proves the two implementations
   * agree and nothing else. This imports `server/src/resumes/crypto.ts` itself, under the
   * server's own `.env`, so what is exercised is exactly what the parse path calls.
   *
   * It matters more here than anywhere else in this phase: an encryption bug is silent. A
   * resume with an unreadable name is indistinguishable from a resume with no name until phase
   * 6 tries to put it on a job application.
   */
  const probe = [
    "import { seal, open, canEncrypt } from './src/resumes/crypto.ts';",
    "const secret = 'Ada Lovelace <ada@example.edu> +1 555 0100';",
    'if (!canEncrypt()) { console.log(JSON.stringify({ configured: false })); }',
    'else {',
    '  const a = seal(secret);',
    '  const b = seal(secret);',
    '  console.log(JSON.stringify({',
    '    configured: true,',
    '    roundTrips: open(a) === secret,',
    '    noPlaintext: !a.toString("utf8").includes("Ada Lovelace"),',
    '    noncesDiffer: !a.equals(b),',
    '    versioned: a[0] === 1,',
    '    emptyIsNull: seal("") === null && seal(null) === null,',
    '    tamperThrows: (() => {',
    '      const bad = Buffer.from(a); bad[bad.length - 1] ^= 0xff;',
    '      try { open(bad); return false; } catch { return true; }',
    '    })(),',
    '  }));',
    '}',
  ].join('\n');

  let seal = null;
  try {
    const out = execFileSync(
      process.execPath,
      ['--env-file-if-exists=.env', '--input-type=module', '--eval', probe],
      { cwd: join(here, '..', 'server'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    seal = JSON.parse(out.trim().split('\n').pop());
  } catch (error) {
    check('the crypto module runs', false, String(error.message ?? error).slice(0, 200));
  }

  if (seal && seal.configured === false) {
    skip('contact-field encryption', 'RESUME_ENCRYPTION_KEY is not set in server/.env');
  } else if (seal) {
    check('a sealed value round-trips', seal.roundTrips === true);
    check('the ciphertext holds no plaintext', seal.noPlaintext === true);
    check('two seals of one value differ — a fresh nonce each time', seal.noncesDiffer === true);
    check('the layout carries a version byte for a future rotation', seal.versioned === true);
    check('an absent field seals to null rather than to empty ciphertext', seal.emptyIsNull === true);
    check('GCM: a tampered byte fails loudly instead of decrypting', seal.tamperThrows === true);
  }

  // ── phase 1's promise ────────────────────────────────────────────────────────

  section('jobs.embedding');

  const embeddingColumn = await admin.rpc('match_scores', { p_job_ids: [jobMatch] });
  check('the scorer still works with the column present', !embeddingColumn.error);

  const columnCheck = await admin
    .from('jobs')
    .select('id, embedding')
    .eq('id', jobMatch)
    .maybeSingle();
  check('PHASE1.md\'s promise: `jobs.embedding` exists', !columnCheck.error,
    columnCheck.error?.message);
  check('and phase 4 leaves it empty, as PHASE4.md §3 argues',
    columnCheck.data?.embedding === null);
}

try {
  await main();
} catch (error) {
  failures += 1;
  console.error(`\nFAIL  the run itself — ${error instanceof Error ? error.message : String(error)}`);
} finally {
  /*
   * Deleting the users cascades through profiles into their resumes, profiles and match scores.
   * `pii_access_log` has no foreign key — the record of who read a resume deliberately outlives
   * the account — so it is removed by hand. Postings go last, because `job_match_scores.job_id`
   * would otherwise refuse, which is the constraint working.
   */
  for (const step of cleanup.reverse()) {
    try {
      await step();
    } catch {
      // Leftover verify- rows are noise in a local database, not a failure of the phase.
    }
  }
  try {
    await admin.from('pii_access_log').delete().gte('created_at', new Date(stamp - 1000).toISOString());
  } catch {
    // Same.
  }
}

if (failures > 0) {
  console.log(`\n${failures} check${failures === 1 ? '' : 's'} failed.\n`);
} else {
  /*
   * The headline is conditional on purpose. "A real resume parses" is this phase's central
   * claim, and a run with no model credential has not established it — reporting it anyway is
   * how a phase ends up recorded as proven on the strength of its SQL alone.
   */
  const headline = parsedForReal
    ? 'a real resume parses, the match ring shows a number with ingredients, and every read of ' +
      'a resume is logged'
    : 'the match ring shows a number with ingredients, and every read of a resume is logged — ' +
      'but no PDF went through the model on this run, so the extractor itself is unproven';
  console.log(
    `\nPhase 4 verified: ${headline}.` +
      (skipped > 0 ? ` (${skipped} check${skipped === 1 ? '' : 's'} skipped.)\n` : '\n'),
  );
}

process.exit(failures === 0 ? 0 : 1);
