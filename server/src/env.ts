/**
 * Server configuration. Unlike the app's lib/env.ts, nothing here is public.
 *
 * The service-role key bypasses RLS entirely — it is the credential that lets this
 * process read every user's applications and write every user's credit ledger. It lives
 * in the environment, never in the repo, and never leaves this process.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. Copy server/.env.example to server/.env and fill it in.`);
  }
  return value;
}

function optional(name: string): string | undefined {
  return process.env[name] || undefined;
}

export const env = {
  port: Number(process.env.PORT ?? 8787),
  nodeEnv: process.env.NODE_ENV ?? 'development',

  supabaseUrl: required('SUPABASE_URL'),
  /** The public key. Used only to verify user tokens, never to read data. */
  supabaseAnonKey: required('SUPABASE_ANON_KEY'),
  /** Bypasses RLS. Guard it accordingly. */
  supabaseServiceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),

  sentryDsn: optional('SENTRY_DSN'),
} as const;
