import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo } from 'react';

import { EMPTY_VIEWER_SETS, fetchViewerState, type InteractionKind, type ViewerSets } from '@/lib/api';
import { enqueue, subscribeToOutbox } from '@/lib/outbox';

/**
 * Likes, saves and follows — README §3.5, now persisted.
 *
 * Through phase 1 these were three `Set`s in `CareerDeckContext` that a cold start threw
 * away. They are the same three sets, with the same shape, read from
 * `job_interactions` and `company_follows` instead of from memory. Every consumer of
 * `likedJobIds` / `savedJobIds` / `followedCompanySlugs` is unchanged.
 *
 * ── Why one query rather than per-row flags ───────────────────────────────────
 *
 * §1.3(a) separates the shared entity from the viewer's relationship to it so that a feed
 * page stays identical for every reader and can be cached as such. Filling `viewer_liked`
 * on each feed row would undo that: every page would become per-viewer, uncacheable, and
 * assembled three joins at a time. So the viewer's whole relationship graph arrives once
 * per session — a few kilobytes of uuids — and is merged onto whatever pages the client
 * happens to hold. PHASE2.md §3 has the long version.
 *
 * ── Optimistic, then durable, then true ───────────────────────────────────────
 *
 * A toggle writes the new state into the cache immediately (Appendix A: "a like that
 * flickers feels broken"), hands the operation to `lib/outbox.ts`, and returns. The outbox
 * gets it to Postgres whenever it can, in order, and this hook refetches once it lands so
 * the cache ends up holding what the database holds rather than what the device guessed.
 */

export function viewerStateKey(userId: string | null) {
  return ['viewer', 'state', userId ?? 'anonymous'] as const;
}

export interface ViewerState extends ViewerSets {
  isLoading: boolean;
  error: Error | null;
  isLiked: (jobId: string) => boolean;
  isSaved: (jobId: string) => boolean;
  isFollowing: (companySlug: string) => boolean;
  toggleLike: (jobId: string) => void;
  toggleSave: (jobId: string) => void;
  toggleFollow: (companySlug: string) => void;
}

function withId(ids: string[], id: string, present: boolean): string[] {
  const has = ids.includes(id);
  if (has === present) return ids;
  // Newest first, matching the order `viewer_state()` returns, so an optimistic entry
  // does not jump position when the real read replaces it.
  return present ? [id, ...ids] : ids.filter((entry) => entry !== id);
}

export function useViewerState(userId: string | null): ViewerState {
  const queryClient = useQueryClient();
  const key = useMemo(() => viewerStateKey(userId), [userId]);

  const query = useQuery({
    queryKey: key,
    queryFn: fetchViewerState,
    enabled: userId !== null,
    // These sets only change because of something this device did, and every one of those
    // changes is written into the cache as it happens. Re-reading them on every mount
    // would cost a request per screen for an answer the client already has.
    staleTime: 5 * 60 * 1000,
  });

  /*
   * Refetch when the outbox lands something.
   *
   * The optimistic update already put the right answer in the cache, so this is not about
   * the happy path — it is about the unhappy one. An operation dropped after too many
   * failures, or refused by the database, leaves the cache holding a state that never
   * happened, and this is what corrects it.
   */
  useEffect(() => {
    if (userId === null) return;
    return subscribeToOutbox(({ sent }) => {
      if (sent.some((operation) => operation.kind === 'interaction' || operation.kind === 'follow')) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    });
  }, [queryClient, key, userId]);

  const sets = query.data ?? EMPTY_VIEWER_SETS;

  const apply = useCallback(
    (change: (current: ViewerSets) => ViewerSets) => {
      // `current ?? EMPTY` rather than bailing out: the app shell waits for this query
      // before it renders, so an undefined cache here means something unusual happened,
      // and losing the user's tap on top of it would not help.
      queryClient.setQueryData<ViewerSets>(key, (current) => change(current ?? EMPTY_VIEWER_SETS));
    },
    [queryClient, key],
  );

  const toggleInteraction = useCallback(
    (jobId: string, kind: InteractionKind, ids: string[]) => {
      const on = !ids.includes(jobId);

      apply((current) => ({
        ...current,
        likedJobIds: kind === 'like' ? withId(current.likedJobIds, jobId, on) : current.likedJobIds,
        savedJobIds: kind === 'save' ? withId(current.savedJobIds, jobId, on) : current.savedJobIds,
        hiddenJobIds: kind === 'hide' ? withId(current.hiddenJobIds, jobId, on) : current.hiddenJobIds,
      }));

      void enqueue({ kind: 'interaction', jobId, interaction: kind, on });
    },
    [apply],
  );

  const toggleLike = useCallback(
    (jobId: string) => toggleInteraction(jobId, 'like', sets.likedJobIds),
    [toggleInteraction, sets.likedJobIds],
  );

  const toggleSave = useCallback(
    (jobId: string) => toggleInteraction(jobId, 'save', sets.savedJobIds),
    [toggleInteraction, sets.savedJobIds],
  );

  const toggleFollow = useCallback(
    (companySlug: string) => {
      const on = !sets.followedCompanySlugs.includes(companySlug);

      /*
       * Only the slug set moves optimistically; `followedCompanyIds` cannot, because the
       * uuid is not knowable here without the company directory being loaded. Nothing
       * reads the id set until the refetch fills it — the Following feed filters by slug
       * and every route segment carries the slug — so the two are briefly out of step and
       * the one that is briefly wrong is the one nobody is looking at.
       */
      apply((current) => ({
        ...current,
        followedCompanySlugs: withId(current.followedCompanySlugs, companySlug, on),
      }));

      void enqueue({ kind: 'follow', companySlug, on });
    },
    [apply, sets.followedCompanySlugs],
  );

  const liked = useMemo(() => new Set(sets.likedJobIds), [sets.likedJobIds]);
  const saved = useMemo(() => new Set(sets.savedJobIds), [sets.savedJobIds]);
  const followed = useMemo(() => new Set(sets.followedCompanySlugs), [sets.followedCompanySlugs]);

  return {
    ...sets,
    isLoading: query.isPending && userId !== null,
    error: query.error,
    isLiked: useCallback((jobId: string) => liked.has(jobId), [liked]),
    isSaved: useCallback((jobId: string) => saved.has(jobId), [saved]),
    isFollowing: useCallback((companySlug: string) => followed.has(companySlug), [followed]),
    toggleLike,
    toggleSave,
    toggleFollow,
  };
}
