/**
 * What happened to something the user wrote. Comments themselves live on a posting;
 * this type is only the notification side — the reason Activity has anything to show.
 */
export type CommentActivityType = 'reply' | 'like';

export interface CommentActivity {
  id: string;
  type: CommentActivityType;
  /** The posting the thread is on, so the card can name where this happened. */
  jobId: string;
  /** What the user wrote, quoted back so the notification makes sense on its own. */
  yourComment: string;
  /** Who replied or liked. Display-only — there are no real accounts yet. */
  actorName: string;
  actorInitials: string;
  actorColor: string;
  /** Present on replies: what they actually said. */
  replyBody?: string;
  /**
   * Present on likes: how many people liked it in total. A like notification is
   * aggregated — "Priya and 4 others" — rather than one row per like.
   */
  likeCount?: number;
  /** ISO date. */
  createdAt: string;
  read: boolean;
}
