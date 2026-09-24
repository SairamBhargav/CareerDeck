/**
 * Public configuration, read once at startup.
 *
 * Expo inlines `process.env.EXPO_PUBLIC_*` at build time, so each one has to be written
 * out as a literal member expression — a computed lookup reads as undefined in a release
 * bundle. That is why these are not behind a helper that takes the name as an argument.
 *
 * Everything here ships inside the app binary and is readable by anyone who downloads
 * it. That is fine for the Supabase URL and the anon/publishable key, which are designed
 * to be public and are useless without a session and the RLS policies behind it. Nothing
 * that isn't safe to publish belongs in this file.
 */

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

/** Undefined unless a Sentry project exists — see lib/observability.ts. */
export const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;

function required(value: string | undefined, name: string): string {
  if (value === undefined || value.length === 0) {
    throw new Error(
      `${name} is not set. Copy .env.example to .env.local and fill it in ` +
        `(\`npx supabase status\` prints the local values), then restart the dev server ` +
        `with \`npx expo start --clear\` — env changes are baked into the bundle.`,
    );
  }
  return value;
}

export const SUPABASE_URL: string = required(supabaseUrl, 'EXPO_PUBLIC_SUPABASE_URL');
export const SUPABASE_ANON_KEY: string = required(supabaseAnonKey, 'EXPO_PUBLIC_SUPABASE_ANON_KEY');

/**
 * A password-auth test account for local development, entirely bypassing email
 * delivery — the shortcut on app/sign-in.tsx and scripts/create-dev-user.mjs, which
 * provisions the account these sign in as.
 *
 * Optional and non-throwing, unlike the pair above: most developers won't have this
 * set, and the app should run normally without it. `context/AuthContext.tsx` only
 * exposes the shortcut when both are present *and* `__DEV__` is true, so a value left
 * in a teammate's .env.local by accident can still never reach a release build —
 * `__DEV__` is false there regardless of what these hold.
 */
export const DEV_TEST_EMAIL = process.env.EXPO_PUBLIC_DEV_TEST_EMAIL;
export const DEV_TEST_PASSWORD = process.env.EXPO_PUBLIC_DEV_TEST_PASSWORD;
