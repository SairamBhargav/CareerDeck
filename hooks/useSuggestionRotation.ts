import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import { useAuth } from '@/context/AuthContext';
import {
  readSuggestionShownAt,
  recordSuggestionsShown,
  type SuggestionShownAt,
} from '@/lib/suggestionRotation';

const EMPTY: SuggestionShownAt = {};

function rotationKey(userId: string | null) {
  return ['suggestions', 'shownAt', userId ?? 'anonymous'] as const;
}

/**
 * When each suggested company took its slot, and a way to stamp the ones on screen now.
 *
 * `record` is safe to call with the same slugs repeatedly — a company holding a live slot
 * keeps its original time, so calling this on every render of the row cannot keep pushing
 * its retirement back.
 */
export function useSuggestionRotation() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  const key = useMemo(() => rotationKey(userId), [userId]);

  const query = useQuery({
    queryKey: key,
    queryFn: () => readSuggestionShownAt(userId as string),
    enabled: userId !== null,
    // Only this device writes it, and every write lands in the cache directly.
    staleTime: Infinity,
  });

  const { mutate } = useMutation({
    mutationFn: (slugs: string[]) => recordSuggestionsShown(userId as string, slugs),
    onSuccess: (next) => queryClient.setQueryData<SuggestionShownAt>(key, next),
  });

  /*
   * No optimistic write here, unlike the dismissals.
   *
   * A dismissal has to show immediately because the tap has no other feedback. This has no
   * tap behind it at all — it is the row telling storage what it just rendered — and
   * writing a guess into the cache would reorder the cards under the reader's eyes a frame
   * after they appeared. The disk answer arriving a moment later is soon enough.
   */
  const record = useCallback(
    (slugs: string[]) => {
      if (userId === null || slugs.length === 0) return;
      mutate(slugs);
    },
    /*
     * `mutate`, not the mutation object. useSuggestedCompanies runs an effect keyed on
     * this callback to stamp whatever ended up on screen — so an identity that changed
     * every time a write settled meant the effect re-ran, recorded again, and settled
     * again. `mutate` is stable for the life of the hook.
     */
    [userId, mutate],
  );

  return { shownAt: query.data ?? EMPTY, isLoading: query.isPending, record };
}
