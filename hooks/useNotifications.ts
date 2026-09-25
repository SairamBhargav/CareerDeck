import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import { fetchNotifications, markNotificationsRead } from '@/lib/api';
import type { AppNotification } from '@/types';

/**
 * The Activity tab's inbox — README §3.8's `notifications`, replacing the `commentActivity`
 * fixture `CareerDeckContext` held through phase 2.
 *
 * The table is written by triggers in the same transaction as the thing it describes, so there is
 * nothing to poll and nothing to reconcile: a reply cannot exist without its notification and a
 * rolled-back comment cannot leave one behind. This hook is a read and two ways to mark things read.
 *
 * Read from `notifications_public`, which is the view that drops `actor_id`. That is worth knowing
 * here rather than only in the migration: it is why `AppNotification` has an `actorHandle` and no
 * identifier, and why a "reply to this" affordance can address a pseudonym but can never look
 * anybody up.
 */

export function notificationsKey(userId: string | null) {
  return ['notifications', userId ?? 'anonymous'] as const;
}

export interface NotificationsState {
  notifications: AppNotification[];
  unreadCount: number;
  isLoading: boolean;
  error: Error | null;
  markRead: (id: string) => void;
  markAllRead: () => void;
}

export function useNotifications(userId: string | null): NotificationsState {
  const queryClient = useQueryClient();
  const key = useMemo(() => notificationsKey(userId), [userId]);

  const query = useQuery({
    queryKey: key,
    queryFn: () => fetchNotifications(),
    enabled: userId !== null,
    /*
     * Refetched on focus rather than held indefinitely. Phase 2 wired `focusManager` to `AppState`
     * for exactly this: the inbox is the one read where a stale answer is the whole feature failing,
     * because "did anyone reply" is the question the tab exists to answer.
     */
    staleTime: 30_000,
  });

  const mark = useMutation({
    mutationFn: (ids: string[] | undefined) => markNotificationsRead(ids),
    onMutate: (ids) => {
      /*
       * Optimistic, and not rolled back on failure.
       *
       * The consequence of a failed mark-read is a badge that comes back on the next refetch, which
       * is a strictly better outcome than a badge that clears and then reappears because a rollback
       * raced a refetch. Appendix A's "a toggle that flickers feels broken" applies to a badge too.
       */
      const previous = queryClient.getQueryData<AppNotification[]>(key);
      queryClient.setQueryData<AppNotification[]>(key, (current) =>
        (current ?? []).map((entry) =>
          ids === undefined || ids.includes(entry.id) ? { ...entry, read: true } : entry,
        ),
      );
      return previous;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });

  const notifications = query.data ?? EMPTY;

  const markRead = useCallback((id: string) => mark.mutate([id]), [mark]);

  const markAllRead = useCallback(() => {
    // Nothing unread means nothing to write. Opening the tab twice should not cost a round trip.
    if (!notifications.some((entry) => !entry.read)) return;
    mark.mutate(undefined);
  }, [mark, notifications]);

  return {
    notifications,
    unreadCount: useMemo(() => notifications.filter((entry) => !entry.read).length, [notifications]),
    isLoading: query.isPending && userId !== null,
    error: query.error,
    markRead,
    markAllRead,
  };
}

/** Stable empty array, so an unloaded inbox does not give every consumer a new identity per render. */
const EMPTY: AppNotification[] = [];
