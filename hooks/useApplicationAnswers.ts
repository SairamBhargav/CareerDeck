import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  EMPTY_APPLICATION_ANSWERS,
  fetchApplicationAnswers,
  saveApplicationAnswers,
  type ApplicationAnswers,
} from '@/lib/api';

/**
 * Profile's Application answers section — docs/PHASE8.md §5. Saved optimistically and rolled
 * back on failure, the same way notification preferences are.
 */
export function useApplicationAnswers(userId: string | null) {
  const queryClient = useQueryClient();
  const key = ['application-answers', userId ?? 'anonymous'] as const;

  const query = useQuery({
    queryKey: key,
    queryFn: () => fetchApplicationAnswers(userId!),
    enabled: userId !== null,
  });

  const save = useMutation({
    mutationFn: (next: ApplicationAnswers) => saveApplicationAnswers(userId!, next),
    onMutate: (next) => {
      const previous = queryClient.getQueryData<ApplicationAnswers>(key);
      queryClient.setQueryData(key, next);
      return previous;
    },
    onError: (_error, _next, previous) => queryClient.setQueryData(key, previous),
  });

  return {
    answers: query.data ?? EMPTY_APPLICATION_ANSWERS,
    loading: query.isPending && userId !== null,
    save: save.mutate,
    saving: save.isPending,
    error: save.error,
  };
}
