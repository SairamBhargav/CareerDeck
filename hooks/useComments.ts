import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  fetchMyComments,
  CLOSED_GATE,
  acceptContentPolicy,
  deleteOwnComment,
  fetchCommentGate,
  fetchCommentReplies,
  fetchCommentCounts,
  fetchLikeCounts,
  fetchJobComments,
  postComment,
  type Page,
  reportComment,
  setBlockFromComment,
} from '@/lib/api';
import { reportError } from '@/lib/observability';
import { supabase } from '@/lib/supabase';
import type { CommentGate, CommentThread, JobComment, MyComment, ReportReason } from '@/types';

/**
 * One posting's comments — README §3.8, now real rows.
 *
 * Through phase 2 this hook filtered a fixture array in memory. What replaces it is three reads
 * with quite different shapes, and the shapes are the design:
 *
 *  - **Roots are paginated**, newest first, like every other feed in the app.
 *  - **Replies are fetched per thread, on demand.** The sheet shows "View 3 replies" and only
 *    fetches when it is tapped. A posting where one comment attracted a 200-reply argument
 *    otherwise makes opening the sheet download the argument.
 *  - **The viewer's own likes are not here at all.** They arrive with the rest of the viewer's
 *    relationship graph in `useViewerState`, because §1.3(b) asks for the stored count and the
 *    viewer's flag to travel separately, and phase 2 already built the vehicle.
 *
 * ── Realtime ──────────────────────────────────────────────────────────────────
 *
 * §15 asks for realtime on threads. It arrives as a *broadcast* on a private per-posting topic
 * rather than a table changefeed, because a changefeed row carries `author_id` and the entire read
 * path exists to keep that column away from a client. What the trigger sends is the same public
 * projection these reads return, so the payload drops straight into the cache. PHASE3.md §3.2.
 */

export function commentsKey(jobId: string) {
  return ['comments', jobId] as const;
}

export function repliesKey(commentId: string) {
  return ['comments', 'replies', commentId] as const;
}

export function myCommentsKey() {
  return ['comments', 'mine'] as const;
}

export function commentGateKey() {
  return ['comments', 'gate'] as const;
}

/** Shape of the broadcast payload. Mirrors `comment_card` minus the viewer-specific fields. */
interface BroadcastComment {
  id: string;
  job_id: string;
  parent_id: string | null;
  body: string;
  gif_id: string | null;
  like_count: number;
  reply_count: number;
  created_at: string;
  edited_at: string | null;
  author_handle: string;
  author_badge: string | null;
  author_color: string;
}

interface UseJobCommentsResult {
  threads: CommentThread[];
  /** Replies included — it's the number the rail shows, and a reply is a comment. */
  total: number;
  isLoading: boolean;
  error: Error | null;
  hasMore: boolean;
  loadMore: () => void;
  /** Fetches (and caches) one thread's replies. Called when the reader opens it. */
  openThread: (commentId: string) => void;
  openThreadIds: Set<string>;
  closeThread: (commentId: string) => void;
}

export function useJobComments(jobId: string | undefined): UseJobCommentsResult {
  const queryClient = useQueryClient();
  const [openThreadIds, setOpenThreadIds] = useState<Set<string>>(() => new Set<string>());

  const query = useInfiniteQuery({
    queryKey: commentsKey(jobId ?? 'none'),
    enabled: jobId !== undefined,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => fetchJobComments(jobId as string, pageParam),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });

  /*
   * Subscribe to the posting's topic while the sheet is open.
   *
   * Only `comment_added` is merged here. A `comment_changed` or `comment_removed` invalidates
   * instead of patching: those arrive from moderation, they are rare, and re-reading is simpler
   * than reconciling a removal against an infinite query's pages.
   */
  useEffect(() => {
    if (jobId === undefined) return;

    const channel = supabase.channel(`job:${jobId}:comments`, { config: { private: true } });

    channel
      .on('broadcast', { event: 'comment_added' }, ({ payload }) => {
        const row = payload as BroadcastComment;

        // A reply lands in its thread's cache, and only if that thread has been opened — nothing
        // is gained by holding replies for a thread nobody has looked at.
        if (row.parent_id !== null) {
          queryClient.invalidateQueries({ queryKey: repliesKey(row.parent_id) });
          queryClient.invalidateQueries({ queryKey: commentsKey(jobId) });
          return;
        }

        queryClient.invalidateQueries({ queryKey: commentsKey(jobId) });
      })
      .on('broadcast', { event: 'comment_changed' }, () => {
        void queryClient.invalidateQueries({ queryKey: commentsKey(jobId) });
      })
      .on('broadcast', { event: 'comment_removed' }, () => {
        void queryClient.invalidateQueries({ queryKey: commentsKey(jobId) });
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [jobId, queryClient]);

  const roots = useMemo(
    () => (query.data?.pages ?? []).flatMap((page) => page.items),
    [query.data],
  );

  /*
   * Replies are read out of the cache rather than through a hook per thread, because the number of
   * open threads is not known at render time and hooks cannot be called in a loop.
   */
  const threads = useMemo<CommentThread[]>(
    () =>
      roots.map((comment) => {
        const open = openThreadIds.has(comment.id);
        const cached = open
          ? queryClient.getQueryData<JobComment[]>(repliesKey(comment.id))
          : undefined;

        return {
          comment,
          replies: cached ?? [],
          loadingReplies: open && cached === undefined,
        };
      }),
    // `query.dataUpdatedAt` is in here on purpose: the replies live in a different cache entry, and
    // without a dependency that changes when it does, an opened thread would render empty until
    // something else re-rendered the sheet. The rule cannot see that link, hence the disable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [roots, openThreadIds, queryClient, query.dataUpdatedAt],
  );

  const total = useMemo(
    () => roots.reduce((sum, comment) => sum + 1 + comment.replyCount, 0),
    [roots],
  );

  const openThread = useCallback(
    (commentId: string) => {
      setOpenThreadIds((current) => {
        if (current.has(commentId)) return current;
        return new Set(current).add(commentId);
      });

      void queryClient.fetchQuery({
        queryKey: repliesKey(commentId),
        queryFn: () => fetchCommentReplies(commentId),
        staleTime: 30_000,
      });
    },
    [queryClient],
  );

  const closeThread = useCallback((commentId: string) => {
    setOpenThreadIds((current) => {
      if (!current.has(commentId)) return current;
      const next = new Set(current);
      next.delete(commentId);
      return next;
    });
  }, []);

  const { fetchNextPage, hasNextPage, isFetchingNextPage } = query;
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  return {
    threads,
    total,
    isLoading: query.isPending && jobId !== undefined,
    error: query.error,
    hasMore: hasNextPage,
    loadMore,
    openThread,
    openThreadIds,
    closeThread,
  };
}

/**
 * Comment totals for a set of postings — the number on a reel's comment action.
 *
 * Takes the ids rather than reading a global store, because the caller is the only thing that knows
 * which page of the feed it is holding. Deliberately a separate read from the feed itself:
 * PHASE3.md §3 on why a volatile counter must not ride inside a cacheable feed page.
 */
export function useCommentCounts(jobIds: string[]): Map<string, number> {
  // Sorted and joined so a re-render that produces an equal-but-new array does not refetch.
  const key = useMemo(() => [...jobIds].sort().join(','), [jobIds]);

  const query = useQuery({
    queryKey: ['comments', 'counts', key],
    queryFn: () => fetchCommentCounts(jobIds),
    enabled: jobIds.length > 0,
    // Counts are decoration. Re-reading them on every page change would cost a request per scroll
    // for a number that changes by one.
    staleTime: 60_000,
  });

  const empty = useMemo(() => new Map<string, number>(), []);
  return query.data ?? empty;
}

/**
 * Whether this account can comment, and what to tell them if not.
 *
 * Read once per session and refreshed after anything that could change the answer: a verification,
 * accepting the policy, posting (which spends the hourly budget), or a moderation notice arriving.
 */
export function useCommentGate(): {
  gate: CommentGate;
  isLoading: boolean;
  refresh: () => void;
  acceptPolicy: (version: string) => Promise<void>;
} {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: commentGateKey(),
    queryFn: fetchCommentGate,
    staleTime: 60_000,
  });

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: commentGateKey() });
  }, [queryClient]);

  const acceptPolicy = useCallback(
    async (version: string) => {
      await acceptContentPolicy(version);
      /*
       * Written into the cache rather than refetched. The user accepted the policy to get back to a
       * composer they were already looking at; a round trip here is a visible pause in the middle
       * of a sentence they were trying to write.
       */
      queryClient.setQueryData<CommentGate>(commentGateKey(), (current) =>
        current
          ? {
              ...current,
              policyAccepted: true,
              policyVersion: version,
              canComment:
                current.tier === 'edu' || current.tier === 'identity'
                  ? !current.banned && current.mutedUntil === null && current.remainingHour > 0
                  : false,
            }
          : current,
      );
    },
    [queryClient],
  );

  return { gate: query.data ?? CLOSED_GATE, isLoading: query.isPending, refresh, acceptPolicy };
}

/**
 * Posting, deleting, reporting and blocking.
 *
 * ── Why posting is not in the outbox ──────────────────────────────────────────
 *
 * Every write phase 2 added goes through `lib/outbox.ts`: a like queued on a subway platform lands
 * when the train surfaces. A comment does not, and the reason is not inconsistency — it is that the
 * two failures are different. A queued like that fails can be retried silently because setting a
 * state twice is setting it once. A queued comment that fails cannot: the classifier may refuse it,
 * the account may be rate-limited, and either way the person needs to know *while they still have
 * the text*. Queueing it would mean showing them a posted comment and dropping it an hour later.
 *
 * So a post is a foreground write with a visible failure, and the optimistic row it inserts is
 * marked `pending` until the server confirms it. PHASE3.md §5.
 */
/**
 * The reader's own comments, newest first — the Activity tab's Comments list. Refetched whenever
 * the reader posts or deletes (`useCommentActions` invalidates it) and when the app returns.
 */
export function useMyComments(enabled: boolean) {
  const query = useInfiniteQuery({
    queryKey: myCommentsKey(),
    queryFn: ({ pageParam }) => fetchMyComments(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled,
    staleTime: 30_000,
  });

  const comments = useMemo<MyComment[]>(
    () => query.data?.pages.flatMap((page) => page.items) ?? [],
    [query.data],
  );

  return {
    comments,
    isLoading: query.isLoading,
    hasMore: query.hasNextPage,
    loadMore: () => {
      if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
    },
    refresh: () => query.refetch(),
  };
}

export function useCommentActions(jobId: string | undefined) {
  const queryClient = useQueryClient();
  /*
   * One key per composer session, not per attempt.
   *
   * It is what makes a retried POST return the existing comment instead of writing a second one —
   * so it has to survive the retry and change only once the comment has landed.
   */
  const idempotencyKeys = useRef(new Map<string, string>());

  /*
   * Per comment, not per sheet: two different comments sent back to back must not share a key
   * (the second would come back as the first), and the same comment resent after a failure must
   * keep its key (a POST that landed but whose answer was lost must not land twice). So the key
   * is tied to what is being sent, and dropped once that comment has landed.
   */
  const keyFor = (input: { body: string; parentId: string | null; gifId?: string }) =>
    `${input.parentId ?? ''}|${input.gifId ?? ''}|${input.body}`;
  const idempotencyKeyFor = (input: { body: string; parentId: string | null; gifId?: string }) => {
    const content = keyFor(input);
    let key = idempotencyKeys.current.get(content);
    if (key === undefined) {
      key = newKey();
      idempotencyKeys.current.set(content, key);
    }
    return key;
  };

  const invalidate = useCallback(() => {
    if (jobId !== undefined) void queryClient.invalidateQueries({ queryKey: commentsKey(jobId) });
    void queryClient.invalidateQueries({ queryKey: commentGateKey() });
    // The number on the reel's comment button, and the Activity tab's list of your comments.
    void queryClient.invalidateQueries({ queryKey: ['comments', 'counts'] });
    void queryClient.invalidateQueries({ queryKey: myCommentsKey() });
  }, [queryClient, jobId]);

  const post = useMutation({
    mutationFn: (input: { body: string; parentId: string | null; gifId?: string }) =>
      postComment({
        jobId: jobId as string,
        body: input.body,
        parentId: input.parentId,
        gifId: input.gifId ?? null,
        idempotencyKey: idempotencyKeyFor(input),
      }),
    /*
     * The comment appears the moment Send is tapped, looking already posted. The server's answer
     * takes a couple of seconds (the moderation classifier is in the write path by design), and
     * a composer that empties and shows nothing for that long reads as a lost comment.
     */
    onMutate: async (input) => {
      if (jobId === undefined) return { tempId: null };
      const tempId = `pending-${idempotencyKeyFor(input)}`;
      const temp = pendingComment(queryClient, jobId, tempId, input);

      if (input.parentId === null) {
        await queryClient.cancelQueries({ queryKey: commentsKey(jobId) });
        // Newest first, so a new comment leads the first page.
        queryClient.setQueryData<CommentPages>(commentsKey(jobId), (data) =>
          data ? { ...data, pages: data.pages.map((page, i) => (i === 0 ? { ...page, items: [temp, ...page.items] } : page)) } : data,
        );
      } else {
        const parentId = input.parentId;
        await queryClient.cancelQueries({ queryKey: repliesKey(parentId) });
        // Oldest first, so a reply joins the end of its thread.
        queryClient.setQueryData<JobComment[]>(repliesKey(parentId), (replies) => [...(replies ?? []), temp]);
        bumpReplyCount(queryClient, jobId, parentId, 1);
      }
      return { tempId };
    },
    onSuccess: ({ comment, takenDown }, input, context) => {
      idempotencyKeys.current.delete(keyFor(input));

      if (jobId !== undefined && context?.tempId) {
        // Taken down: the comment that appeared on send goes, and the notice explaining why
        // lands in Updates. Otherwise the stand-in is swapped for the real row in place, so
        // nothing jumps while the refetch runs.
        replaceComment(queryClient, jobId, input.parentId, context.tempId, takenDown ? null : comment);
        if (takenDown && input.parentId !== null) bumpReplyCount(queryClient, jobId, input.parentId, -1);
      }
      if (takenDown) void queryClient.invalidateQueries({ queryKey: ['notifications'] });
      if (comment.parentId !== null) {
        void queryClient.invalidateQueries({ queryKey: repliesKey(comment.parentId) });
      }
      invalidate();
    },
    onError: (error, input, context) => {
      // The composer puts the draft back with the reason; the dimmed row has to go with it.
      if (jobId !== undefined && context?.tempId) {
        replaceComment(queryClient, jobId, input.parentId, context.tempId, null);
        if (input.parentId !== null) bumpReplyCount(queryClient, jobId, input.parentId, -1);
      }
      // Reported, and also rethrown to the caller — the composer needs to keep the draft and say
      // what happened, and the log is what tells us the classifier is misbehaving at scale.
      reportError(error, { where: 'postComment', jobId });
    },
  });

  const remove = useMutation({
    mutationFn: (commentId: string) => deleteOwnComment(commentId),
    onSettled: invalidate,
  });

  const report = useMutation({
    mutationFn: (input: { commentId: string; reason: ReportReason; detail?: string; blockToo: boolean }) =>
      (async () => {
        await reportComment(input.commentId, input.reason, input.detail);
        /*
         * Reporting and blocking together, when asked for.
         *
         * They are separate rows and separate decisions — a report goes to a human, a block is
         * immediate and personal — but somebody reporting harassment almost always wants both, and
         * making them find a second menu to stop seeing the person is a bad half-minute.
         */
        if (input.blockToo) await setBlockFromComment(input.commentId, true);
      })(),
    onSettled: invalidate,
  });

  const block = useMutation({
    mutationFn: (input: { commentId: string; on: boolean }) =>
      setBlockFromComment(input.commentId, input.on),
    onSettled: invalidate,
  });

  return {
    post: post.mutateAsync,
    isPosting: post.isPending,
    remove: remove.mutate,
    report: report.mutateAsync,
    block: block.mutate,
  };
}

type CommentPages = InfiniteData<Page<JobComment>, string | null>;

/** Used for the dimmed row until the server's answer brings the account's real colour. */
const PENDING_COLOR = '#8A8AA0';

/**
 * The row drawn before the server answers: the account's own pseudonym and badge from the gate,
 * and its colour from any comment of its own already on screen.
 */
function pendingComment(
  queryClient: QueryClient,
  jobId: string,
  id: string,
  input: { body: string; parentId: string | null; gifId?: string },
): JobComment {
  const gate = queryClient.getQueryData<CommentGate>(commentGateKey());
  const own = queryClient
    .getQueryData<CommentPages>(commentsKey(jobId))
    ?.pages.flatMap((page) => page.items)
    .find((comment) => comment.isYou);

  return {
    id,
    jobId,
    parentId: input.parentId,
    authorHandle: gate?.handle ?? own?.authorHandle ?? 'You',
    authorBadge: gate?.badge ?? own?.authorBadge ?? null,
    authorColor: own?.authorColor ?? PENDING_COLOR,
    isYou: true,
    body: input.body,
    ...(input.gifId === undefined ? {} : { gifId: input.gifId }),
    createdAt: new Date().toISOString(),
    editedAt: null,
    likeCount: 0,
    replyCount: 0,
    pending: true,
  };
}

/** Puts `next` where the pending row was, or removes the row when `next` is null. */
function replaceComment(
  queryClient: QueryClient,
  jobId: string,
  parentId: string | null,
  tempId: string,
  next: JobComment | null,
) {
  const swap = (items: JobComment[]) =>
    next === null
      ? items.filter((item) => item.id !== tempId)
      : items.map((item) => (item.id === tempId ? next : item));

  if (parentId === null) {
    queryClient.setQueryData<CommentPages>(commentsKey(jobId), (data) =>
      data ? { ...data, pages: data.pages.map((page) => ({ ...page, items: swap(page.items) })) } : data,
    );
  } else {
    queryClient.setQueryData<JobComment[]>(repliesKey(parentId), (replies) => (replies ? swap(replies) : replies));
  }
}

/** Keeps "View n replies" honest while a reply is pending, and puts it back if the post fails. */
function bumpReplyCount(queryClient: QueryClient, jobId: string, parentId: string, by: number) {
  queryClient.setQueryData<CommentPages>(commentsKey(jobId), (data) =>
    data
      ? {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            items: page.items.map((item) =>
              item.id === parentId ? { ...item, replyCount: Math.max(0, item.replyCount + by) } : item,
            ),
          })),
        }
      : data,
  );
}

function newKey(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Likes per posting, from everybody.
 *
 * Alongside `useCommentCounts` because it is the same read with a different table behind
 * it, and the Deck wants both for the same twenty cards — two batched calls rather than
 * forty.
 *
 * Unlike comments, these cannot be counted by the client at all: `job_interactions` is
 * readable only by its owner, so the aggregate comes from a security-definer function that
 * publishes the number without the rows.
 */
export function useLikeCounts(jobIds: string[]): Map<string, number> {
  const key = useMemo(() => [...jobIds].sort().join(','), [jobIds]);

  const query = useQuery({
    queryKey: ['likes', 'counts', key],
    queryFn: () => fetchLikeCounts(jobIds),
    enabled: jobIds.length > 0,
    // Decoration, like the comment counts. A number that moves by one does not justify a
    // request per scroll.
    staleTime: 60_000,
  });

  const empty = useMemo(() => new Map<string, number>(), []);
  return query.data ?? empty;
}
