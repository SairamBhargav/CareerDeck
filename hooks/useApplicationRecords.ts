import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo } from 'react';

import { fetchApplications } from '@/lib/api';
import { enqueue, subscribeToOutbox } from '@/lib/outbox';
import type { Application, ApplicationSource, ApplicationStatus } from '@/types';

/**
 * The tracker, persisted — README §3.7.
 *
 * `useApplications.ts` derives the pipeline counts and the sorted list from this, and
 * `useWeeklyGoal.ts` derives the goal, the streak and the history from it. Both keep the
 * signatures they had when this was `useState(mockApplications)`; the rows are real now,
 * which is the whole of §15's "weekly goal reads real applications".
 *
 * One list, not a page of it. §11: "full list; client sorts and derives the goal" — the
 * streak walks backwards week by week and cannot do that over a window it has to ask for.
 *
 * ── Keyed by job, not by row id ───────────────────────────────────────────────
 *
 * Every write here names the *job*, never the application's own uuid. `unique (user_id,
 * job_id)` makes that a real key, and it is what lets the offline outbox queue "I applied"
 * and "I got an interview" back to back: the second operation does not need an id that the
 * first one has not been issued yet. Callers still pass the application id, because that is
 * what the UI holds; it is resolved to a job id here, against the list that is already in
 * hand.
 */

export function applicationsKey(userId: string | null) {
  return ['applications', userId ?? 'anonymous'] as const;
}

export interface ApplicationRecords {
  applications: Application[];
  isLoading: boolean;
  error: Error | null;
  hasApplied: (jobId: string) => boolean;
  /** Records that the user applied. Idempotent: telling us twice is not applying twice. */
  logApplication: (jobId: string, source: ApplicationSource) => void;
  setApplicationStatus: (applicationId: string, status: ApplicationStatus) => void;
}

const EMPTY: Application[] = [];

/**
 * Today, in the user's own timezone.
 *
 * `toISOString()` would be UTC, which puts an application submitted at 8pm in California
 * into tomorrow — and tomorrow can be a different week, which is the one place this
 * actually shows: a Sunday-evening application counting towards next week's goal.
 */
function localToday(): string {
  const now = new Date();
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

export function useApplicationRecords(userId: string | null): ApplicationRecords {
  const queryClient = useQueryClient();
  const key = useMemo(() => applicationsKey(userId), [userId]);

  const query = useQuery({
    queryKey: key,
    queryFn: fetchApplications,
    enabled: userId !== null,
    // Longer than the default because nothing changes this list except this device. The
    // refetch that matters is the one after an outbox flush, below.
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (userId === null) return;
    return subscribeToOutbox(({ sent }) => {
      if (sent.some((operation) => operation.kind.startsWith('application.'))) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    });
  }, [queryClient, key, userId]);

  const applications = query.data ?? EMPTY;

  const apply = useCallback(
    (change: (current: Application[]) => Application[]) => {
      queryClient.setQueryData<Application[]>(key, (current) => change(current ?? EMPTY));
    },
    [queryClient, key],
  );

  const logApplication = useCallback(
    (jobId: string, source: ApplicationSource) => {
      const today = localToday();

      apply((current) => {
        // The database enforces this too, and would hand back the existing row rather
        // than a second one. Checking here is what stops the *optimistic* list growing a
        // duplicate that only disappears on the next refetch.
        if (current.some((application) => application.jobId === jobId)) return current;

        return [
          {
            // Replaced by the server's uuid on the next read. Prefixed rather than
            // randomised so a stray one is recognisable in a log.
            id: `local:${jobId}`,
            jobId,
            status: 'applied',
            source,
            appliedAt: today,
            updatedAt: today,
            selfReported: true,
          },
          ...current,
        ];
      });

      void enqueue({ kind: 'application.create', jobId, source, appliedAt: today });
    },
    [apply],
  );

  const setApplicationStatus = useCallback(
    (applicationId: string, status: ApplicationStatus) => {
      const target = applications.find((application) => application.id === applicationId);
      if (!target) return;

      const today = localToday();
      apply((current) =>
        current.map((application) =>
          application.id === applicationId ? { ...application, status, updatedAt: today } : application,
        ),
      );

      void enqueue({ kind: 'application.status', jobId: target.jobId, status });
    },
    [apply, applications],
  );

  const appliedJobIds = useMemo(
    () => new Set(applications.map((application) => application.jobId)),
    [applications],
  );

  return {
    applications,
    isLoading: query.isPending && userId !== null,
    error: query.error,
    hasApplied: useCallback((jobId: string) => appliedJobIds.has(jobId), [appliedJobIds]),
    logApplication,
    setApplicationStatus,
  };
}
