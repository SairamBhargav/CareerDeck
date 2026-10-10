import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import { useAuth } from '@/context/AuthContext';
import type { TrackedApplication } from '@/hooks/useApplications';
import { readCheckInSnoozes, snoozeCheckIn, type CheckInSnoozes } from '@/lib/checkInSnoozes';
import { parseLocalDate } from '@/utils/week';

/**
 * Days without a stage change before Activity asks about an application.
 *
 * Two weeks is roughly when an employer that is going to reply has replied. Earlier and the
 * card nags about applications that are simply still being read; later and the tracker has
 * already drifted from what the reader knows.
 */
export const QUIET_DAYS = 14;

/** How long "Not yet" holds the question off. */
const SNOOZE_DAYS = 7;

const MS_PER_DAY = 86_400_000;
const EMPTY: CheckInSnoozes = {};

/**
 * Whole days since the application's stage last moved.
 *
 * Read as a local date: a status change writes `updatedAt` as the reader's own YYYY-MM-DD,
 * which `new Date()` would take as UTC midnight and file under yesterday west of Greenwich.
 */
export function daysQuiet(entry: TrackedApplication, now: number = Date.now()): number {
  const moved = parseLocalDate(entry.application.updatedAt)?.getTime();
  if (moved === undefined) return 0;
  return Math.max(0, Math.floor((now - moved) / MS_PER_DAY));
}

/** Still open (applied or interviewing) and quiet for at least QUIET_DAYS. */
export function isQuiet(entry: TrackedApplication, now: number = Date.now()): boolean {
  const { status } = entry.application;
  return (status === 'applied' || status === 'interview') && daysQuiet(entry, now) >= QUIET_DAYS;
}

/**
 * The applications Activity's check-in asks about, quietest first.
 *
 * The tracker is self-reported, so it is only as current as the reader keeps it — and nothing
 * used to ask them to. This is the asking: an open application that has not moved in two
 * weeks gets one card with the likely answers on it. "Not yet" snoozes the card for a week;
 * answering with a stage moves the application, which resets `updatedAt` and takes it out of
 * the queue on its own.
 */
export function useCheckIns(applications: TrackedApplication[]) {
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  const key = useMemo(() => ['checkins', 'snoozed', userId ?? 'anonymous'] as const, [userId]);

  const query = useQuery({
    queryKey: key,
    queryFn: () => readCheckInSnoozes(userId as string),
    enabled: userId !== null,
    // Only a tap on this device changes it, and that tap writes the cache itself.
    staleTime: Infinity,
  });
  const snoozes = query.data ?? EMPTY;

  const queue = useMemo(() => {
    const now = Date.now();
    return applications
      .filter((entry) => {
        if (!isQuiet(entry, now)) return false;
        const until = snoozes[entry.application.id];
        return until === undefined || new Date(until).getTime() <= now;
      })
      .sort((a, b) => daysQuiet(b, now) - daysQuiet(a, now));
  }, [applications, snoozes]);

  const { mutate } = useMutation({
    mutationFn: ({ id, until }: { id: string; until: Date }) => snoozeCheckIn(userId as string, id, until),
    onSuccess: (next) => queryClient.setQueryData<CheckInSnoozes>(key, next),
  });

  const snooze = useCallback(
    (applicationId: string) => {
      if (userId === null) return;
      const until = new Date(Date.now() + SNOOZE_DAYS * MS_PER_DAY);
      // Optimistic: the card leaving is the whole acknowledgement.
      queryClient.setQueryData<CheckInSnoozes>(key, (current) => ({
        ...(current ?? {}),
        [applicationId]: until.toISOString(),
      }));
      mutate({ id: applicationId, until });
    },
    [userId, queryClient, key, mutate],
  );

  return { queue, snooze };
}
