import { useMemo } from 'react';

import { useCareerDeck } from '@/context/CareerDeckContext';
import type { JobComment } from '@/types';

/** A top-level comment and everything answering it, oldest reply first. */
export interface CommentThread {
  comment: JobComment;
  replies: JobComment[];
}

interface JobComments {
  threads: CommentThread[];
  /** Replies included — it's the number the rail shows, and a reply is a comment. */
  total: number;
}

function byNewest(a: JobComment, b: JobComment): number {
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

function byOldest(a: JobComment, b: JobComment): number {
  return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
}

/**
 * One posting's thread list.
 *
 * Top-level comments run newest first, the way a feed does — but replies under each one
 * run *oldest* first, because a reply chain is a conversation and reading it backwards
 * makes no sense. A reply whose parent has gone is promoted to the top level rather than
 * dropped, so nothing a user wrote can silently vanish.
 */
export function useJobComments(jobId: string | undefined): JobComments {
  const { comments } = useCareerDeck();

  return useMemo(() => {
    if (!jobId) return { threads: [], total: 0 };

    const forJob = comments.filter((comment) => comment.jobId === jobId);
    const repliesByParent = new Map<string, JobComment[]>();
    const roots: JobComment[] = [];
    const ids = new Set(forJob.map((comment) => comment.id));

    for (const comment of forJob) {
      if (comment.parentId === null || !ids.has(comment.parentId)) {
        roots.push(comment);
        continue;
      }
      const existing = repliesByParent.get(comment.parentId);
      if (existing) existing.push(comment);
      else repliesByParent.set(comment.parentId, [comment]);
    }

    const threads = roots.sort(byNewest).map<CommentThread>((comment) => ({
      comment,
      replies: (repliesByParent.get(comment.id) ?? []).sort(byOldest),
    }));

    return { threads, total: forJob.length };
  }, [comments, jobId]);
}

/**
 * Comment totals for every posting at once, so the reel rail can label each card without
 * every card filtering the whole list itself.
 */
export function useCommentCounts(): Map<string, number> {
  const { comments } = useCareerDeck();

  return useMemo(() => {
    const counts = new Map<string, number>();
    for (const comment of comments) {
      counts.set(comment.jobId, (counts.get(comment.jobId) ?? 0) + 1);
    }
    return counts;
  }, [comments]);
}
