/**
 * One comment on a job posting. Replies are flat rather than a tree: `parentId` points
 * at a top-level comment and never at another reply, matching how Reels and TikTok cap
 * threads at a single level — deeper nesting costs horizontal room a phone doesn't have
 * and gives people somewhere to hide an argument.
 */
export interface JobComment {
  id: string;
  jobId: string;
  /** Null on a top-level comment; the comment this one answers otherwise. */
  parentId: string | null;
  authorName: string;
  authorInitials: string;
  authorColor: string;
  /** The signed-in user's own comment — tagged "You" instead of carrying a name. */
  isYou: boolean;
  body: string;
  /**
   * A reaction GIF posted instead of (or alongside) text — an id into `reactionGifs`
   * rather than a URL, so the fixtures stay readable and swapping the picker's backing
   * store later doesn't rewrite every comment.
   */
  gifId?: string;
  /** ISO date. */
  createdAt: string;
  /** Likes from everyone else. The viewer's own like lives in context, not here. */
  likeCount: number;
}

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
