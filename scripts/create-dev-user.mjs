/*
 * Provisions (or re-confirms) the dev-only test account that app/sign-in.tsx's
 * "Sign in as test user" shortcut signs in as.
 *
 *   npm run dev:create-test-user
 *
 * Reads four env vars — SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from server/.env,
 * EXPO_PUBLIC_DEV_TEST_EMAIL and EXPO_PUBLIC_DEV_TEST_PASSWORD from .env.local — so the
 * account this script creates and the credentials the app signs in with come from the
 * same two lines. Point SUPABASE_URL at whichever project .env.local's
 * EXPO_PUBLIC_SUPABASE_URL names, local or hosted; the service role key is the one
 * secret this script needs and the app never sees.
 *
 * Idempotent: running it again against an account that already exists resets its
 * password and re-confirms its email rather than failing, which is what you want after
 * rotating EXPO_PUBLIC_DEV_TEST_PASSWORD or on a second machine.
 *
 * This account is a real row in `profiles`, provisioned by the same
 * handle_auth_user_change() trigger every other sign-up goes through — it is not a
 * mock, and it is not exempt from RLS. It exists only so a developer with SMTP unset up
 * can exercise the rest of the app without waiting on email.
 */

import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.env.EXPO_PUBLIC_DEV_TEST_EMAIL;
const password = process.env.EXPO_PUBLIC_DEV_TEST_PASSWORD;

function missing(name) {
  console.error(`${name} is not set.`);
}

let ok = true;
if (!url) { missing('SUPABASE_URL'); ok = false; }
if (!serviceKey) { missing('SUPABASE_SERVICE_ROLE_KEY'); ok = false; }
if (!email) { missing('EXPO_PUBLIC_DEV_TEST_EMAIL'); ok = false; }
if (!password) { missing('EXPO_PUBLIC_DEV_TEST_PASSWORD'); ok = false; }

if (!ok) {
  console.error(
    '\nSUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY belong in server/.env (never committed).\n' +
      'EXPO_PUBLIC_DEV_TEST_EMAIL / EXPO_PUBLIC_DEV_TEST_PASSWORD belong in .env.local, ' +
      'next to EXPO_PUBLIC_SUPABASE_URL — pick any email and password, they only need ' +
      'to exist. See .env.example for both.',
  );
  process.exit(1);
}

if (password.length < 6) {
  // Supabase's own floor (config.toml's minimum_password_length on local, and the
  // hosted default). Failing here is a clearer message than the one the API gives.
  console.error('EXPO_PUBLIC_DEV_TEST_PASSWORD must be at least 6 characters.');
  process.exit(1);
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

const created = await admin.auth.admin.createUser({
  email,
  password,
  // Skips email confirmation entirely — the whole point is not depending on mail
  // delivery working.
  email_confirm: true,
});

if (!created.error) {
  console.log(`Created ${email} and confirmed it. Sign in from the app's dev shortcut.`);
  process.exit(0);
}

// already registered → find it and bring it in line with the current env values,
// rather than treating "it already exists" as a failure.
const alreadyExists =
  created.error.message?.toLowerCase().includes('already been registered') ||
  created.error.message?.toLowerCase().includes('already registered') ||
  created.error.status === 422;

if (!alreadyExists) {
  console.error(`Could not create ${email}: ${created.error.message}`);
  process.exit(1);
}

console.log(`${email} already exists — resetting its password and confirming it instead.`);

// admin.createUser doesn't return an id on the "already registered" path, so the
// account has to be looked up by email before it can be updated.
let page = 1;
let existing = null;

while (existing === null) {
  const listed = await admin.auth.admin.listUsers({ page, perPage: 200 });
  if (listed.error) {
    console.error(`Could not list users to find ${email}: ${listed.error.message}`);
    process.exit(1);
  }

  existing = listed.data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase()) ?? null;
  if (existing !== null || listed.data.users.length < 200) break;
  page += 1;
}

if (existing === null) {
  console.error(
    `Supabase says ${email} is already registered but listUsers() cannot find it. ` +
      'Check Authentication → Users in the dashboard by hand.',
  );
  process.exit(1);
}

const updated = await admin.auth.admin.updateUserById(existing.id, {
  password,
  email_confirm: true,
});

if (updated.error) {
  console.error(`Could not update ${email}: ${updated.error.message}`);
  process.exit(1);
}

console.log(`${email} is ready — password reset and email confirmed. Sign in from the app's dev shortcut.`);
