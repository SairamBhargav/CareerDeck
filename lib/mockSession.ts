import type { Session } from '@supabase/supabase-js';

/**
 * The identity `SKIP_AUTH` mode runs as — README §12 (`lib/env.ts`).
 *
 * Not a real Supabase user: there is no row for this id in `auth.users`, and nothing
 * here is ever sent to the database as a bearer token. `AuthContext` holds this as its
 * `session` purely to satisfy the app's own "am I signed in" check
 * (`app/_layout.tsx`'s `isSignedIn = session !== null`) and to give the per-user hooks
 * a stable, non-null key to branch on. Every read that table grants actually require a
 * real JWT — `profiles`, `applications`, `job_interactions`, `company_follows` — still
 * gets a permission error if attempted, which is exactly why those three hooks each
 * skip their real query in this mode rather than trying it and swallowing the error.
 *
 * Reads that don't require a session at all — `jobs`, `companies`, search — are
 * unaffected. They're granted to `anon` (phase 1 §2.10) and go out on the real Supabase
 * client, whose own internal auth state was never touched by any of this.
 */
export const MOCK_USER_ID = 'skip-auth-dev-user';

/** A structurally valid Session — every field the type requires, none of it real. */
export const MOCK_SESSION: Session = {
  access_token: 'skip-auth',
  refresh_token: 'skip-auth',
  expires_in: 60 * 60 * 24 * 365,
  token_type: 'bearer',
  user: {
    id: MOCK_USER_ID,
    aud: 'authenticated',
    app_metadata: {},
    user_metadata: {},
    created_at: new Date(0).toISOString(),
  },
};
