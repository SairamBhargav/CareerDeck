/**
 * What happened to something the user wrote, or to their account — README §3.8's
 * "derived, aggregated feed".
 *
 * This replaces `CommentActivity`, which through phase 2 described only replies and likes because
 * those were the only two things the fixtures contained. The table it now reads is wider: a
 * removal, a strike, an expiring `.edu` address and (from phase 7) a job alert all arrive here,
 * because they are all "a thing that happened that the user has to be told about", and giving each
 * one its own inbox would give the user four places to look.
 *
 * **`actorId` is not in this type and never will be.** A like notification that named the account
 * behind it would undo the anonymity contract from the other end — it is the one place where the
 * system knows both parties and could accidentally introduce them. What travels instead is the
 * actor's pseudonym, which is a name you can reply to rather than a name you can look up.
 */
export type NotificationKind =
  | 'comment_reply'
  | 'comment_like'
  | 'moderation'
  | 'verification'
  | 'job_alert'
  | 'deadline';

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  /** The comment or posting this concerns, when there is one to open. */
  subjectId: string | null;
  /**
   * How many people this one row stands for. §3.8: the third person to like your comment bumps
   * this rather than inserting another notification, so the card can read "and 4 others".
   */
  aggregateCount: number;
  /** ISO timestamp. */
  createdAt: string;
  read: boolean;

  /*
   * ── The denormalized display fields ──────────────────────────────────────────
   *
   * Written into the row when it was created rather than joined at read time, and that is
   * deliberate: a notification is read days after the thread it describes, which by then may have
   * been deleted by its author or removed by a moderator. Joining would produce a blank card where
   * a sentence should be.
   */

  /** The posting the thread sits on, so the card can name where this happened. */
  jobId: string | null;
  /** Who replied or liked, as their pseudonym. Absent on moderation and verification notices. */
  actorHandle: string | null;
  actorColor: string | null;
  /** What the user wrote, quoted back so the notification makes sense on its own. */
  yourComment: string | null;
  /** Present on replies: what they actually said. */
  replyBody: string | null;
  /** Present on moderation and verification notices, which speak for themselves. */
  headline: string | null;
  detail: string | null;
}
