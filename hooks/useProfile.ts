import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useRef } from 'react';

import { DEFAULT_WEEKLY_GOAL } from '@/constants/goal';
import { mockUser } from '@/data/mockUser';
import { SKIP_AUTH } from '@/lib/env';
import { supabase } from '@/lib/supabase';
import type { User, UserIdentityEdit } from '@/types';

/**
 * The signed-in user's identity and preferences, read from Postgres.
 *
 * This is `GET /v1/me` from §11. It talks to Supabase directly rather than to the API
 * service because every row it touches is reachable through RLS alone — §2.1's rule of
 * thumb. Nothing here needs a secret.
 *
 * The two tables are fetched separately rather than as one embedded select: they were
 * split in §3.1 precisely because they have different read patterns, and asking
 * PostgREST to infer the one-to-one relationship back out of the foreign key is a
 * fragile way to undo that.
 *
 * SKIP_AUTH (lib/env.ts) replaces both reads and both mutations' writes with a `mockRef`
 * held for the life of the hook — unlike useViewerState and useApplicationRecords, this
 * one has to persist across a refetch: both mutations call `settle()` unconditionally on
 * success, and a queryFn returning a fixed constant would silently revert whatever an
 * edit had just written, the moment the sheet that made it closed.
 */

export interface Profile {
  user: User;
  /** Lives in user_preferences, but the UI has always treated it as its own thing. */
  weeklyGoal: number;
}

interface PreferencesPatch {
  preferredRoles?: string[];
  preferredLocations?: string[];
  weeklyGoal?: number;
}

const PROFILE_COLUMNS = 'id, first_name, last_name, school_name_raw, major, graduation_year, location';
const PREFERENCE_COLUMNS = 'preferred_roles, preferred_locations, weekly_goal';

export function profileKey(userId: string) {
  return ['profile', userId] as const;
}

async function fetchProfile(userId: string): Promise<Profile> {
  const [profileResult, preferencesResult] = await Promise.all([
    supabase.from('profiles').select(PROFILE_COLUMNS).eq('id', userId).maybeSingle(),
    supabase.from('user_preferences').select(PREFERENCE_COLUMNS).eq('user_id', userId).maybeSingle(),
  ]);

  if (profileResult.error) throw profileResult.error;
  if (preferencesResult.error) throw preferencesResult.error;

  const profile = profileResult.data;
  const preferences = preferencesResult.data;

  if (!profile || !preferences) {
    // Both rows are written by handle_auth_user_change() inside the signup transaction,
    // so a session without them means the trigger is missing — almost always an account
    // created before the phase 0 migration ran.
    throw new Error(
      'This account has no profile row. It was most likely created before the phase 0 ' +
        'migration; delete the user in Supabase Auth and sign in again.',
    );
  }

  const firstName = profile.first_name ?? '';
  const lastName = profile.last_name ?? '';

  return {
    user: {
      id: profile.id,
      firstName,
      lastName,
      // Recomputed rather than read: `profiles.display_name` is a generated column with
      // exactly this expression, and deriving it here keeps an optimistic edit and a
      // server round trip producing the same string.
      displayName: `${firstName} ${lastName}`.trim(),
      // The free-text school, never the verified one. `school_id` is set by §3.2's
      // verification flow and drives the comment badge; this is what they typed.
      school: profile.school_name_raw ?? '',
      major: profile.major ?? '',
      graduationYear: profile.graduation_year ?? 0,
      location: profile.location ?? '',
      preferredRoles: preferences.preferred_roles ?? [],
      preferredLocations: preferences.preferred_locations ?? [],
    },
    weeklyGoal: preferences.weekly_goal ?? DEFAULT_WEEKLY_GOAL,
  };
}

export function useProfile(userId: string | null) {
  const queryClient = useQueryClient();
  // Memoised because every callback below closes over it: a fresh array each render
  // would give them all new identities each render, and they are handed straight to
  // context consumers that memoise on them.
  const key = useMemo(
    () => (userId ? profileKey(userId) : (['profile', 'anonymous'] as const)),
    [userId],
  );

  // SKIP_AUTH's whole store. A ref rather than state: nothing here is ever rendered
  // directly, only read back by queryFn and written by the two mutations below — the
  // query cache is what the rest of the app actually reads.
  const mockRef = useRef<Profile>({ user: mockUser, weeklyGoal: DEFAULT_WEEKLY_GOAL });

  const query = useQuery({
    queryKey: key,
    queryFn: SKIP_AUTH ? () => mockRef.current : () => fetchProfile(userId as string),
    enabled: userId !== null,
  });

  /**
   * Applies an edit to the cache before the write lands, and puts the old value back if
   * it doesn't. Appendix A: a toggle that flickers feels broken, and the sheets here all
   * close the moment you tap Save.
   */
  const optimistic = useCallback(
    async (apply: (current: Profile) => Profile) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Profile>(key);
      if (previous) queryClient.setQueryData<Profile>(key, apply(previous));
      return previous;
    },
    [queryClient, key],
  );

  const rollback = useCallback(
    (previous: Profile | undefined) => {
      if (previous) queryClient.setQueryData<Profile>(key, previous);
    },
    [queryClient, key],
  );

  const settle = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: key });
  }, [queryClient, key]);

  const identityMutation = useMutation({
    mutationFn: async (edit: UserIdentityEdit) => {
      if (SKIP_AUTH) {
        // Written to the ref, not just the optimistic cache entry — the mutation's own
        // onSettled invalidates and refetches, and queryFn reads this back.
        mockRef.current = {
          ...mockRef.current,
          user: { ...mockRef.current.user, ...edit, displayName: `${edit.firstName} ${edit.lastName}`.trim() },
        };
        return;
      }

      const { error } = await supabase
        .from('profiles')
        .update({
          first_name: edit.firstName,
          last_name: edit.lastName,
          school_name_raw: edit.school,
          major: edit.major,
          graduation_year: edit.graduationYear,
          location: edit.location,
        })
        .eq('id', userId as string);
      if (error) throw error;
    },
    onMutate: (edit) =>
      optimistic((current) => ({
        ...current,
        user: {
          ...current.user,
          ...edit,
          displayName: `${edit.firstName} ${edit.lastName}`.trim(),
        },
      })),
    onError: (_error, _edit, previous) => rollback(previous),
    onSettled: settle,
  });

  const preferencesMutation = useMutation({
    mutationFn: async (patch: PreferencesPatch) => {
      if (SKIP_AUTH) {
        mockRef.current = {
          weeklyGoal: patch.weeklyGoal ?? mockRef.current.weeklyGoal,
          user: {
            ...mockRef.current.user,
            preferredRoles: patch.preferredRoles ?? mockRef.current.user.preferredRoles,
            preferredLocations: patch.preferredLocations ?? mockRef.current.user.preferredLocations,
          },
        };
        return;
      }

      const { error } = await supabase
        .from('user_preferences')
        .update({
          ...(patch.preferredRoles !== undefined ? { preferred_roles: patch.preferredRoles } : {}),
          ...(patch.preferredLocations !== undefined
            ? { preferred_locations: patch.preferredLocations }
            : {}),
          ...(patch.weeklyGoal !== undefined ? { weekly_goal: patch.weeklyGoal } : {}),
        })
        .eq('user_id', userId as string);
      if (error) throw error;
    },
    onMutate: (patch) =>
      optimistic((current) => ({
        ...current,
        weeklyGoal: patch.weeklyGoal ?? current.weeklyGoal,
        user: {
          ...current.user,
          preferredRoles: patch.preferredRoles ?? current.user.preferredRoles,
          preferredLocations: patch.preferredLocations ?? current.user.preferredLocations,
        },
      })),
    onError: (_error, _patch, previous) => rollback(previous),
    onSettled: settle,
  });

  // `refetch` is stable across renders; the query object it hangs off is not, and this
  // ends up in a context value that consumers memoise on.
  const { refetch } = query;
  const retry = useCallback(() => void refetch(), [refetch]);

  return {
    profile: query.data ?? null,
    isLoading: query.isPending && userId !== null,
    error: query.error,
    retry,
    updateIdentity: identityMutation.mutate,
    updatePreferences: preferencesMutation.mutate,
  };
}
