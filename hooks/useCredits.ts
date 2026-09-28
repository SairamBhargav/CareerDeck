import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';

import { AUTO_APPLY_ECONOMY } from '@/constants/goal';
import {
  awardStreakBonusRemote,
  closeAutoApplyRun,
  fetchCreditState,
  startAutoApplyRun,
} from '@/lib/api';
import { reportError } from '@/lib/observability';

/**
 * The Auto Apply balance, read from the ledger rather than held in a ref.
 *
 * ── What this replaces ────────────────────────────────────────────────────────
 *
 * Three pieces of state in `CareerDeckContext`: `autoApplyCredits`, `creditsRef`, and the
 * `paidWeeks` `Set` in a `useRef`. All three lived only as long as the process, which is
 * why credits reset to a single day's grant on every restart and why force-quitting the
 * app made a week's streak bonus payable again. Neither was a bug in that file — it was
 * standing in for a table that did not exist.
 *
 * ── Why the writes are not optimistic ─────────────────────────────────────────
 *
 * Phase 2 established that a like writes to the cache first and reconciles later, because
 * a like that flickers feels broken. Credits are the opposite case and get the opposite
 * treatment.
 *
 * A balance is a number the user is being told about their account, and the server is the
 * only thing that knows it — the daily grant may have landed, a bank cap may have clamped
 * a bonus, another device may have spent one. Showing a guess and correcting it means
 * showing somebody "2 left" and then "1 left" a moment later, which reads as having been
 * charged twice. So every mutation here awaits the server and then takes what it says.
 *
 * The cost is a spinner's worth of latency on a tap. That is the right trade for the one
 * number in the app that behaves like money.
 */

/** Receipt for the most recent bonus: what was actually paid, and for which week. */
export interface StreakAward {
  weekKey: string;
  amount: number;
}

export interface CreditsState {
  /** Spendable right now. 0 while the first read is in flight, which renders as an empty bank. */
  balance: number;
  isLoading: boolean;
  /**
   * Opens a run against a posting and charges a credit for it. Resolves to the run id, or
   * `null` when there was nothing to spend — which is an answer, not an error.
   */
  startRun: (jobId: string, resumeId?: string | null) => Promise<string | null>;
  /** Back out of a run and take the credit back. */
  closeRun: (runId: string, failed?: boolean) => Promise<void>;
  /** Pays a week's bonus, at most once ever per week key. */
  awardStreak: (weekKey: string, amount: number) => Promise<number>;
  lastStreakAward: StreakAward | null;
}

export function creditsKey(userId: string | null) {
  return ['credits', 'balance', userId ?? 'anonymous'] as const;
}

export function useCredits(userId: string | null): CreditsState {
  const queryClient = useQueryClient();
  const key = useMemo(() => creditsKey(userId), [userId]);
  const [lastStreakAward, setLastStreakAward] = useState<StreakAward | null>(null);

  const query = useQuery({
    queryKey: key,
    queryFn: () => fetchCreditState(AUTO_APPLY_ECONOMY.dailyGrant, AUTO_APPLY_ECONOMY.bankCap),
    enabled: userId !== null,
    /*
     * Refetched on focus, unlike the viewer sets. Those only change because of something
     * this device did; this one changes because a day passed. Coming back to the app the
     * next morning should find the grant already taken, and that read is what takes it.
     */
    refetchOnWindowFocus: true,
    staleTime: 60_000,
  });

  const balance = query.data ?? 0;

  const write = useCallback(
    (next: number) => queryClient.setQueryData<number>(key, Math.max(0, next)),
    [queryClient, key],
  );

  const startRun = useCallback(
    async (jobId: string, resumeId: string | null = null) => {
      try {
        const runId = await startAutoApplyRun(jobId, resumeId);
        // A null run means the balance was empty. Writing 0 rather than leaving the stale
        // number up is the one place a local write is more truthful than what is on screen.
        write(runId === null ? 0 : balance - 1);
        return runId;
      } catch (error) {
        reportError(error, { where: 'useCredits.startRun', jobId });
        // Deliberately not swallowed into a `null`: "you have no credits" and "the request
        // failed" are different things to tell somebody, and only the caller knows which
        // surface is showing.
        throw error;
      }
    },
    [balance, write],
  );

  const closeRun = useCallback(
    async (runId: string, failed = false) => {
      try {
        const refunded = await closeAutoApplyRun(runId, failed);
        if (refunded) write(balance + 1);
      } catch (error) {
        // A failed refund is not worth interrupting anyone over — the run stays open and
        // the credit stays spent until something closes it. Logged, not raised.
        reportError(error, { where: 'useCredits.closeRun', runId });
      }
    },
    [balance, write],
  );

  const awardStreak = useCallback(
    async (weekKey: string, amount: number) => {
      if (amount <= 0) return 0;
      try {
        const awarded = await awardStreakBonusRemote(
          weekKey,
          amount,
          AUTO_APPLY_ECONOMY.bankCap,
          AUTO_APPLY_ECONOMY.maxWeeklyBonus,
        );
        // Zero is the normal answer for a week already paid, and the receipt is still set
        // so the card can say "already collected" rather than offering it again.
        setLastStreakAward({ weekKey, amount: awarded });
        if (awarded > 0) write(balance + awarded);
        return awarded;
      } catch (error) {
        reportError(error, { where: 'useCredits.awardStreak', weekKey });
        return 0;
      }
    },
    [balance, write],
  );

  return {
    balance,
    isLoading: query.isLoading,
    startRun,
    closeRun,
    awardStreak,
    lastStreakAward,
  };
}
