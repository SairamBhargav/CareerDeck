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

/**
 * The API service — phase 3's one new piece of configuration, and deliberately optional.
 *
 * Reads still go to Postgres (PHASE1.md decision B), and phase 2's writes still go through RLS.
 * What needs this is the half of phase 3 that cannot: posting a comment runs through a moderation
 * classifier, and verifying an address needs an email provider. Both need a secret, so both live
 * behind `server/`.
 *
 * Unset, the app runs. Feeds, search, saves, follows, the tracker and every collection work
 * exactly as they did, and the comment composer says commenting is unavailable instead of failing
 * a request nobody can diagnose. That is the honest behaviour for a clone of this repo with no
 * service deployed — and `required()` would instead have made the whole app refuse to start over a
 * feature on one screen. PHASE3.md §8.
 */
export const API_URL: string | undefined = process.env.EXPO_PUBLIC_API_URL?.replace(/\/+$/, '');

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
