import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import { useAuth } from '@/context/AuthContext';
import { dismissSuggestion, readDismissedSuggestions } from '@/lib/suggestionDismissals';

const EMPTY: string[] = [];

function dismissalsKey(userId: string | null) {
  return ['suggestions', 'dismissed', userId ?? 'anonymous'] as const;
}

/**
 * The slugs the reader has dismissed from the suggestions row.
 *
 * Through react-query rather than component state, so the carousel and anything else that
 * cares read one answer, and so the optimistic write lands before AsyncStorage has
 * finished — the card has to leave on the tap, not a round trip later.
 */
export function useSuggestionDismissals() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  // Memoized because it is a dependency below, and a fresh array each render would make
  // every callback that closes over it fresh too.
  const key = useMemo(() => dismissalsKey(userId), [userId]);

  const query = useQuery({
    queryKey: key,
    queryFn: () => readDismissedSuggestions(userId as string),
    enabled: userId !== null,
    // The only thing that changes this is a tap on this device, and that tap writes the
    // answer into the cache itself. Re-reading on mount would cost a disk read per screen.
    staleTime: Infinity,
  });

  const { mutate } = useMutation({
    mutationFn: (slug: string) => dismissSuggestion(userId as string, slug),
    onSuccess: (next) => queryClient.setQueryData<string[]>(key, next),
  });

  const dismiss = useCallback(
    (slug: string) => {
      if (userId === null) return;
      // Optimistic, because the card leaving is the entire feedback for the tap.
      queryClient.setQueryData<string[]>(key, (current) =>
        current?.includes(slug) ? current : [slug, ...(current ?? [])],
      );
      mutate(slug);
    },
    // `mutate` rather than the mutation object: the object is replaced on every state
    // change, which would make this callback new on every settle.
    [userId, queryClient, key, mutate],
  );

  return { dismissed: query.data ?? EMPTY, dismiss };
}
