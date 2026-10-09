import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';

import { fetchNotificationPrefs, normalizePrefs, saveNotificationPrefs, type NotificationPrefs } from '@/lib/api';
import { disablePush, enablePush, pushPermissionGranted, type PushOutcome } from '@/lib/push';

/**
 * Settings' notification section. Two different switches that look alike, kept apart on purpose:
 *
 *  - **Push on this device** is the OS permission plus a registered token. Turning it off
 *    unregisters the token; it cannot revoke the OS permission, which only Settings can.
 *  - **The per-kind switches** are `user_preferences.notification_prefs`, account-wide, read by
 *    the server's `claim_push_batch()` and `claim_digest_batch()`. They apply on every device.
 */
export function useNotificationSettings(userId: string | null) {
  const queryClient = useQueryClient();
  const key = ['notification-prefs', userId ?? 'anonymous'] as const;

  const prefs = useQuery({
    queryKey: key,
    queryFn: () => fetchNotificationPrefs(userId!),
    enabled: userId !== null,
  });

  const device = useQuery({ queryKey: ['push-permission'], queryFn: pushPermissionGranted });
  const [lastOutcome, setLastOutcome] = useState<PushOutcome | null>(null);

  const save = useMutation({
    mutationFn: (next: NotificationPrefs) => saveNotificationPrefs(userId!, next),
    onMutate: (next) => {
      const previous = queryClient.getQueryData<NotificationPrefs>(key);
      queryClient.setQueryData(key, next);
      return previous;
    },
    onError: (_error, _next, previous) => queryClient.setQueryData(key, previous),
  });

  /*
   * Memoized because `setPref` depends on it, and `normalizePrefs(null)` builds a fresh
   * object on every render before the query has answered.
   */
  const current = useMemo(() => prefs.data ?? normalizePrefs(null), [prefs.data]);

  const setPref = useCallback(
    (channel: 'push' | 'email', name: string, value: boolean) => {
      const next = normalizePrefs({ ...current, [channel]: { ...current[channel], [name]: value } });
      save.mutate(next);
    },
    // `save.mutate` rather than `save`: react-query replaces the mutation object on every
    // state change, and `mutate` is stable for the life of the hook. Nothing keys an
    // effect on this one, so it was only costing re-renders — but it is the same shape as
    // the suggestion-row cycle, and the next person to add an effect here would find out
    // the hard way.
    [current, save.mutate],
  );

  const setDevicePush = useCallback(
    async (on: boolean) => {
      if (on) {
        const outcome = await enablePush();
        setLastOutcome(outcome);
      } else {
        await disablePush();
        setLastOutcome(null);
      }
      await queryClient.invalidateQueries({ queryKey: ['push-permission'] });
    },
    [queryClient],
  );

  return {
    prefs: current,
    devicePush: device.data === true && lastOutcome !== 'no_project' && lastOutcome !== 'failed',
    lastOutcome,
    setPref,
    setDevicePush,
  };
}
