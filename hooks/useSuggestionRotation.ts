import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

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
  const key = rotationKey(userId);

  const query = useQuery({
    queryKey: key,
    queryFn: () => readSuggestionShownAt(userId as string),
    enabled: userId !== null,
    // Only this device writes it, and every write lands in the cache directly.
    staleTime: Infinity,
  });

  const mutation = useMutation({
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
      mutation.mutate(slugs);
    },
    [userId, mutation],
  );

  return { shownAt: query.data ?? EMPTY, isLoading: query.isPending, record };
}
