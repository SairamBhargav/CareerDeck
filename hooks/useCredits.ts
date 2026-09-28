import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import { AUTO_APPLY_ECONOMY } from '@/constants/goal';
import { FREE_RESUME_LIMIT } from '@/constants/limits';
import { fetchCredits, type Credits } from '@/lib/api';

/**
 * The Auto Apply balance and the reader's plan — §7's ledger, read through `my_credits()`.
 *
 * Replaces the `useState` seeded with one credit that `CareerDeckContext` held through phase 5.
 * The balance is `sum(amount)` over the ledger and nothing on the client ever computes it: after
 * any spend, refund or bonus this query is invalidated and the server answers again. There is no
 * optimistic decrement, and that is §6's rule rather than an omission — "never decremented
 * optimistically".
 *
 * Reading it is also what pays the day's grant, so the refetch on foreground that
 * `lib/query-client.ts` wires up is load-bearing here: opening the app in the morning is when
 * the morning's Auto Apply arrives.
 */

export function creditsKey(userId: string | null) {
  return ['credits', userId ?? 'anonymous'] as const;
}

/**
 * What to show before the first answer arrives, and if it never does: the free plan's own
 * numbers, from the constants that mirror the `free` row in `plans`. A balance of zero rather
 * than one, because showing a credit the reader might not have is the one wrong direction.
 */
const FALLBACK: Credits = {
  balance: 0,
  plan: 'free',
  dailyGrant: AUTO_APPLY_ECONOMY.dailyGrant,
  bankCap: AUTO_APPLY_ECONOMY.bankCap,
  resumeLimit: FREE_RESUME_LIMIT,
  nextGrantAt: null,
  grantedNow: 0,
};

export interface CreditsState extends Credits {
  isLoading: boolean;
  isPro: boolean;
  /** Re-read the ledger — after a spend, a refund, a bonus or a purchase. */
  refresh: () => Promise<void>;
}

export function useCredits(userId: string | null): CreditsState {
  const queryClient = useQueryClient();
  const key = useMemo(() => creditsKey(userId), [userId]);

  const query = useQuery({
    queryKey: key,
    queryFn: fetchCredits,
    enabled: userId !== null,
    // Short: a balance is the one number here a reader acts on, and a grant can land any time.
    staleTime: 15_000,
  });

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: key });
  }, [queryClient, key]);

  const credits = query.data ?? FALLBACK;

  return {
    ...credits,
    isLoading: query.isLoading,
    isPro: credits.plan !== 'free',
    refresh,
  };
}
