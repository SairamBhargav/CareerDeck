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

import Constants from 'expo-constants';

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
/**
 * The port `server/` listens on. Matches `PORT` in `server/.env`.
 *
 * Only used by the dev fallback below — an explicit `EXPO_PUBLIC_API_URL` carries its own port.
 */
const DEV_API_PORT = process.env.EXPO_PUBLIC_API_PORT ?? '8787';

/**
 * In development, the API service is assumed to be on the same machine as the Metro bundler.
 *
 * This exists because a hardcoded LAN IP is wrong the moment the laptop changes network, and
 * the failure is both silent and misleading: the bundle still loads (the device has the
 * bundler's *real* address), resumes still upload (that goes straight to Supabase), and only
 * the calls that need `server/` fail — surfacing as "Could not reach CareerDeck", which reads
 * like the phone is offline when in fact the app is dialling an address that no longer exists.
 * That cost three separate debugging sessions.
 *
 * The device necessarily already knows the right host: it is where the bundle came from.
 * `hostUri` is that address, so deriving from it cannot go stale — switch Wi-Fi, restart, and
 * it is correct again with nothing to edit.
 *
 * Dev only, deliberately. `hostUri` is not present in a release build, and a production app
 * guessing its own API host from the bundler would be nonsense — there `EXPO_PUBLIC_API_URL`
 * is the answer.
 */
function bundlerHostApiUrl(): string | undefined {
  if (!__DEV__) return undefined;

  // "192.168.1.5:8081", or "192.168.1.5:8081/..." — take the host, drop the bundler's port.
  const hostUri = Constants.expoConfig?.hostUri;
  const host = hostUri?.split('/')[0]?.split(':')[0];

  // A tunnel gives a public hostname the API service is not reachable on, so it is not a
  // usable base for this. Only a bare IPv4 LAN address is.
  if (host === undefined || !/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return undefined;

  return `http://${host}:${DEV_API_PORT}`;
}

const explicitApiUrl = process.env.EXPO_PUBLIC_API_URL?.replace(/\/+$/, '');

/**
 * The API service — phase 3's one new piece of configuration, still optional.
 *
 * An explicit `EXPO_PUBLIC_API_URL` always wins: that is how a deployed service, a tunnel or a
 * non-default port is named. With it unset, development falls back to the bundler's host, which
 * is the common case and the one that used to need hand-editing.
 */
export const API_URL: string | undefined =
  explicitApiUrl !== undefined && explicitApiUrl.length > 0
    ? explicitApiUrl
    : bundlerHostApiUrl();

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
