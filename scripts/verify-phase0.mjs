/*
 * Checks phase 0's exit condition against the local stack:
 * "sign in on a device, edit your profile, it survives a restart".
 *
 * It drives the same calls the app does — context/AuthContext.tsx to sign in,
 * hooks/useProfile.ts to read and write — so a regression in the migration, the
 * provisioning trigger, the RLS policies or the column grants fails here rather than on
 * a device. It also checks the things that are meant to be impossible: escalating your
 * own verification tier, forging a comment badge, reading someone else's profile.
 *
 *   npm run db:start
 *   npm run verify:phase0
 *
 * Local only. It reads the fixed CLI demo keys and the local mail catcher, and it
 * creates throwaway users — never point it at a real project.
 *
 * Each run signs up two accounts, and GoTrue rate-limits sign-ups and OTP verifications
 * per five-minute window (`[auth.rate_limit]` in config.toml). Several runs back to back
 * will eventually trip it and fail at the sign-in step. That is the limiter working, not
 * the schema breaking — wait a minute and run it again.
 */

import { createClient } from '@supabase/supabase-js';

const API = 'http://127.0.0.1:54721';
const MAILPIT = 'http://127.0.0.1:54724';
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

let failures = 0;

function check(label, passed, detail = '') {
  if (!passed) failures += 1;
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
}

/** A stand-in for lib/supabase.ts's LargeSecureStore: same contract, plain Map behind it. */
function clientWithStore(store) {
  return createClient(API, ANON, {
    auth: {
      storage: {
        getItem: (k) => store.get(k) ?? null,
        setItem: (k, v) => void store.set(k, v),
        removeItem: (k) => void store.delete(k),
      },
      autoRefreshToken: false,
      persistSession: true,
      detectSessionInUrl: false,
      flowType: 'pkce',
    },
  });
}

async function signInByEmailCode(email) {
  const store = new Map();
  const client = clientWithStore(store);

  const sent = await client.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
  check(`signInWithOtp accepted (${email})`, !sent.error, sent.error?.message ?? '');

  // Mailpit takes a moment to receive what GoTrue just sent.
  await new Promise((resolve) => setTimeout(resolve, 1500));

  const { messages } = await fetch(`${MAILPIT}/api/v1/messages`).then((r) => r.json());
  const message = messages?.find((m) => m.To?.some((t) => t.Address === email));
  check('sign-in email delivered', Boolean(message));
  if (!message) return null;

  const body = await fetch(`${MAILPIT}/api/v1/message/${message.ID}`).then((r) => r.json());
  const code = `${body.Text ?? ''}\n${body.HTML ?? ''}`.match(/\b(\d{6})\b/)?.[1];
  check(
    'email carries a six-digit code, not a link',
    Boolean(code),
    code ? '' : 'check supabase/templates/magic-link.html is wired up in config.toml',
  );
  if (!code) return null;

  const verified = await client.auth.verifyOtp({ email, token: code, type: 'email' });
  check('verifyOtp returns a session', Boolean(verified.data.session), verified.error?.message ?? '');

  return { client, store, userId: verified.data.user?.id };
}

const stamp = Date.now();
const primary = await signInByEmailCode(`verify-${stamp}@example.com`);
if (!primary?.userId) {
  console.error('\nCould not sign in. Is `npm run db:start` running?');
  process.exit(1);
}

const { client, store, userId } = primary;

// ── provisioning ───────────────────────────────────────────────────────────────

const [seededProfile, seededPrefs] = await Promise.all([
  client.from('profiles').select('id, verification_tier').eq('id', userId).maybeSingle(),
  client.from('user_preferences').select('weekly_goal, open_to_remote').eq('user_id', userId).maybeSingle(),
]);

check('handle_auth_user_change created a profile', seededProfile.data !== null);
check('handle_auth_user_change created preferences', seededPrefs.data !== null);
check(
  'a confirmed email lifts the tier to `email`',
  seededProfile.data?.verification_tier === 'email',
  String(seededProfile.data?.verification_tier),
);
check('weekly_goal defaults to 7', seededPrefs.data?.weekly_goal === 7, String(seededPrefs.data?.weekly_goal));

// ── editing ────────────────────────────────────────────────────────────────────

const identity = await client
  .from('profiles')
  .update({
    first_name: 'Aswaanth',
    last_name: 'Karuppasamy',
    school_name_raw: 'University of Texas at Dallas',
    major: 'Computer Science',
    graduation_year: 2027,
    location: 'Dallas, TX',
  })
  .eq('id', userId);
check('identity edit accepted', !identity.error, identity.error?.message ?? '');

const prefs = await client
  .from('user_preferences')
  .update({
    preferred_roles: ['Software Engineer Intern', 'Machine Learning Intern'],
    preferred_locations: ['Remote', 'Austin, TX'],
    weekly_goal: 14,
  })
  .eq('user_id', userId);
check('preferences edit accepted', !prefs.error, prefs.error?.message ?? '');

const generated = await client.from('profiles').select('display_name').eq('id', userId).maybeSingle();
check(
  'display_name is generated from the name fields',
  generated.data?.display_name === 'Aswaanth Karuppasamy',
  String(generated.data?.display_name),
);

// ── surviving a restart ────────────────────────────────────────────────────────

// A cold client, reading the session the first one persisted — what launching the app
// from scratch does.
const restarted = clientWithStore(new Map(JSON.parse(JSON.stringify([...store.entries()]))));

const { data: restored } = await restarted.auth.getSession();
check('session restored from storage', restored.session?.user.id === userId);

const after = await restarted
  .from('profiles')
  .select('first_name, last_name, major, graduation_year, location, school_name_raw')
  .eq('id', userId)
  .maybeSingle();
const afterPrefs = await restarted
  .from('user_preferences')
  .select('preferred_roles, preferred_locations, weekly_goal')
  .eq('user_id', userId)
  .maybeSingle();

check('name survived the restart', after.data?.first_name === 'Aswaanth');
check('school survived', after.data?.school_name_raw === 'University of Texas at Dallas');
check('major survived', after.data?.major === 'Computer Science');
check('graduation year survived', after.data?.graduation_year === 2027);
check('location survived', after.data?.location === 'Dallas, TX');
check('weekly goal survived', afterPrefs.data?.weekly_goal === 14, String(afterPrefs.data?.weekly_goal));
check('preferred roles survived', afterPrefs.data?.preferred_roles?.length === 2);
check('preferred locations survived', afterPrefs.data?.preferred_locations?.length === 2);

// ── things that must not be possible ───────────────────────────────────────────

const escalate = await restarted.from('profiles').update({ verification_tier: 'identity' }).eq('id', userId);
check('cannot raise your own verification tier', Boolean(escalate.error), escalate.error?.code ?? 'no error');

const forge = await restarted.from('profiles').update({ comment_badge: "CS @ MIT '27" }).eq('id', userId);
check('cannot forge a comment badge', Boolean(forge.error), forge.error?.code ?? 'no error');

const claimSchool = await restarted.from('profiles').update({ school_id: null }).eq('id', userId);
check('cannot set a verified school directly', Boolean(claimSchool.error), claimSchool.error?.code ?? 'no error');

const badGoal = await restarted.from('user_preferences').update({ weekly_goal: 99 }).eq('user_id', userId);
check('weekly_goal is bounded by the database', Boolean(badGoal.error), badGoal.error?.code ?? 'no error');

const writeSchools = await restarted.from('schools').insert({ name: `Fake University ${stamp}` });
check('cannot write to schools', Boolean(writeSchools.error), writeSchools.error?.code ?? 'no error');

// A second account, to check the isolation between them.
const other = await signInByEmailCode(`verify-other-${stamp}@example.com`);
if (other?.userId) {
  const peek = await restarted.from('profiles').select('id').eq('id', other.userId);
  check('cannot read another account’s profile', peek.data?.length === 0, JSON.stringify(peek.data));

  await restarted.from('profiles').update({ first_name: 'Hijacked' }).eq('id', other.userId);
  const victim = await other.client.from('profiles').select('first_name').eq('id', other.userId).maybeSingle();
  check('cannot write to another account’s profile', victim.data?.first_name !== 'Hijacked');
}

// ── schools reference data ─────────────────────────────────────────────────────

const schools = await restarted.from('schools').select('name, short_name, email_domains');
check('seeded schools are readable', (schools.data?.length ?? 0) >= 12, `${schools.data?.length} rows`);
check(
  'the fixture user’s school is seeded',
  schools.data?.some((s) => s.name === 'University of Texas at Dallas'),
);

// ── sign out ───────────────────────────────────────────────────────────────────

await restarted.auth.signOut();
const { data: gone } = await restarted.auth.getSession();
check('sign out clears the session', gone.session === null);

console.log(failures === 0 ? '\nPhase 0 verified.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
