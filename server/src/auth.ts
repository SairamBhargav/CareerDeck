import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';

import { env } from './env.ts';

/**
 * Turns the caller's Supabase access token into a user id, or refuses the request.
 *
 * Verification goes through Supabase Auth rather than checking the signature locally.
 * That costs a network call per request, which is the wrong trade for the ranked feed
 * and will be replaced by local JWKS verification when there is a hot path worth
 * optimising — but it is correct for every project configuration without knowing whether
 * that project signs with a symmetric secret or an asymmetric key, and a skeleton that
 * is subtly wrong about who the caller is has no value at all.
 */

/** Never used to read data — only to ask Auth who a token belongs to. */
const authClient = createClient(env.supabaseUrl, env.supabaseAnonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/**
 * Bypasses RLS. Only reachable from a handler that has already established who the
 * caller is, and every query made with it must scope itself to that user by hand —
 * there is no policy behind it to catch a mistake.
 */
export const adminClient: SupabaseClient = createClient(
  env.supabaseUrl,
  env.supabaseServiceRoleKey,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

export interface AuthedUser {
  id: string;
  email: string | null;
}

type AuthedEnv = { Variables: { user: AuthedUser } };

export const requireAuth = createMiddleware<AuthedEnv>(async (c, next) => {
  const header = c.req.header('Authorization');
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : null;

  if (!token) {
    throw new HTTPException(401, { message: 'Missing bearer token.' });
  }

  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data.user) {
    throw new HTTPException(401, { message: 'Invalid or expired token.' });
  }

  c.set('user', { id: data.user.id, email: data.user.email ?? null });
  await next();
});
