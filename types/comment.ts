/**
 * One comment on a job posting.
 *
 * Replies are flat rather than a tree: `parentId` points at a top-level comment and never at
 * another reply, matching how Reels and TikTok cap threads at a single level — deeper nesting
 * costs horizontal room a phone doesn't have and gives people somewhere to hide an argument. The
 * database enforces it now rather than trusting this comment to be read.
 *
 * ── What changed in phase 3, and why it changed the type ──────────────────────
 *
 * Through phase 2 a comment carried `authorName` and `authorInitials`, because the fixtures had
 * names in them. Real comments never can: README §3.8's contract is that users are anonymous to
 * each other and identified only to us, so what arrives is a generated pseudonym and a badge
 * composed from a *verified* school. There is no name field to fill, which is the point — a shape
 * that cannot hold a name cannot leak one.
 *
 * `likeCount` is now the true stored total and does not include the viewer's own like. §1.3(b)
 * asked for exactly that ("store the true count; send `viewerHasLiked` separately") and phase 2
 * deferred it for want of a stored count to be right about. The viewer's own likes arrive with
 * the rest of their relationship graph, in `viewer_state()`.
 */
export interface JobComment {
  id: string;
  jobId: string;
  /** Null on a top-level comment; the comment this one answers otherwise. */
  parentId: string | null;
  /** The generated pseudonym — `quiet-otter-4821`. Never chosen by the user, never a real name. */
  authorHandle: string;
  /**
   * `CS @ Purdue '27`, composed by the database from the school the account actually verified.
   * Null on an account verified by government ID, which claims personhood and no school.
   */
  authorBadge: string | null;
  authorColor: string;
  /** The signed-in user's own comment — tagged "You" and swipeable to delete. */
  isYou: boolean;
  body: string;
  /**
   * A reaction GIF posted instead of (or alongside) text — an id into `reactionGifs` rather than
   * a URL, so the fixtures stay readable and swapping the picker's backing store later doesn't
   * rewrite every comment.
   */
  gifId?: string;
  /** ISO timestamp. */
  createdAt: string;
  editedAt: string | null;
  /** Everybody's likes, including the viewer's. The viewer's own flag travels separately. */
  likeCount: number;
  /** Replies under this comment. Always 0 on a reply, since threads are one level deep. */
  replyCount: number;
  /**
   * Set on a comment this device has written but the server has not confirmed. The row renders
   * dimmed and cannot be liked or replied to until it lands. Absent on everything read back.
   */
  pending?: boolean;
}

/** A top-level comment and the replies under it, oldest reply first. */
export interface CommentThread {
  comment: JobComment;
  replies: JobComment[];
  /** True while this thread's replies are being fetched, so the toggle can show it. */
  loadingReplies?: boolean;
}

/**
 * Everything the composer needs to know before the user starts typing — `comment_gate()`.
 *
 * Assembled by the database rather than by three client-side checks, because the write path
 * enforces exactly these rules and two implementations of one rule drift. The reason it exists at
 * all is that the alternative is letting somebody write four hundred characters and *then*
 * telling them their account cannot comment.
 */
export interface CommentGate {
  canComment: boolean;
  tier: 'none' | 'email' | 'edu' | 'identity';
  handle: string | null;
  badge: string | null;
  /** Which version of the content policy this account has accepted, if any. */
  policyVersion: string | null;
  policyAccepted: boolean;
  /** Set while a 7-day mute is in force, so the UI can say when it lifts. */
  mutedUntil: string | null;
  banned: boolean;
  /** What is left of §10's 10/hour and 40/day. */
  remainingHour: number;
  remainingDay: number;
}

/** Why somebody is reporting a comment. Short, closed, and shown as a list. */
export type ReportReason =
  | 'harassment'
  | 'threat'
  | 'sexual'
  | 'doxxing'
  | 'spam'
  | 'false information'
  | 'something else';
