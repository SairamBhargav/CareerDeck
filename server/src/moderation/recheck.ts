/**
 * The second look at comments the classifier could not answer in time.
 *
 * The comment route gives the model 4 s, because somebody is waiting on the send. Past that the
 * comment is published as `flagged` with reason `unavailable: …` — an outage of the model must
 * not hold up, or take down, every comment written during it. Before this file existed nothing
 * ever looked at those comments again, and the timeout is common enough (four of the first eight
 * comments on hosted) that "Women are dumb" sat published, unchecked, until a human got to it.
 *
 * So: the route schedules a re-check as soon as it answers, with a longer deadline and retries,
 * and the background loop sweeps anything left over (the process restarted, or the model was
 * down for longer). The re-check applies the same rule the route does — a flag or a block takes
 * the comment down and tells its author, a pass approves it.
 *
 * Only a comment still in that exact state is touched. A moderator who has already ruled on it
 * wins, and so does an author who deleted it.
 */

import { adminClient } from '../auth.ts';
import { classify, type Category } from './classifier.ts';

/** Completes "It looked like …" in a takedown notice: plain words, never a policy citation. */
export const TAKEDOWN_REASON: Record<Category, string> = {
  harassment: 'harassment of a person',
  threat: 'a threat',
  sexual: 'sexual content',
  doxxing: 'personal information about someone',
  spam: 'spam or self-promotion',
  employer_claim: 'an unverified claim about a company or someone who works there',
  none: 'something against the content policy',
};

export const TAKEDOWN_HEADLINE = 'Your comment was flagged and taken down';

export function takedownDetail(category: Category): string {
  return `It looked like ${TAKEDOWN_REASON[category]}. A moderator will review it, and it comes back if it was flagged by mistake.`;
}

/** No one is waiting, so the model gets real time and a couple of tries. */
const RECHECK_TIMEOUT_MS = 20_000;
const RECHECK_RETRIES = 2;

const UNAVAILABLE = 'unavailable:%';

export type RecheckOutcome = 'approved' | 'taken_down' | 'still_unavailable' | 'skipped';

export async function recheckComment(commentId: string): Promise<RecheckOutcome> {
  const { data: row, error } = await adminClient
    .from('comments')
    .select('id, author_id, body, moderation_status, moderation_reason, deleted_at')
    .eq('id', commentId)
    .maybeSingle<{
      id: string;
      author_id: string;
      body: string;
      moderation_status: string;
      moderation_reason: string | null;
      deleted_at: string | null;
    }>();
  if (error) throw error;
  if (
    !row ||
    row.deleted_at !== null ||
    row.moderation_status !== 'flagged' ||
    !row.moderation_reason?.startsWith('unavailable:')
  ) {
    return 'skipped';
  }

  const verdict = await classify(row.body, { timeoutMs: RECHECK_TIMEOUT_MS, maxRetries: RECHECK_RETRIES });
  if (verdict.source === 'unavailable') return 'still_unavailable';

  const takeDown = verdict.decision !== 'pass';
  const update = await adminClient
    .from('comments')
    .update({
      // `pending` is the takedown state: hidden from every public read, still in the review queue.
      moderation_status: takeDown ? 'pending' : 'approved',
      moderation_reason: takeDown ? `${verdict.source}: ${verdict.category} (recheck)` : null,
      moderation_scores: { ...verdict.scores, recheck: true },
    })
    .eq('id', row.id)
    // Still exactly as the route left it: nobody else has ruled on it in the meantime.
    .eq('moderation_status', 'flagged')
    .like('moderation_reason', UNAVAILABLE)
    .is('deleted_at', null)
    .select('id');
  if (update.error) throw update.error;
  if (!update.data?.length) return 'skipped';

  if (takeDown) {
    const notified = await adminClient.rpc('notify_moderation', {
      p_user_id: row.author_id,
      p_headline: TAKEDOWN_HEADLINE,
      p_detail: takedownDetail(verdict.category),
      p_subject_id: row.id,
    });
    if (notified.error) console.error('[moderation] recheck takedown notice failed:', notified.error.message);
    return 'taken_down';
  }
  return 'approved';
}

/** Fire and forget, from the comment route. A failure here is picked up by the sweep. */
export function scheduleRecheck(commentId: string): void {
  void recheckComment(commentId).then(
    (outcome) => console.log(`[moderation] recheck ${commentId}: ${outcome}`),
    (error: unknown) => console.error(`[moderation] recheck ${commentId} failed:`, error),
  );
}

/**
 * Every comment still waiting on a verdict, oldest first. Skips the last minute, which belongs to
 * the re-check the route already scheduled.
 */
export async function sweepUnavailable(limit = 25): Promise<Record<RecheckOutcome, number>> {
  const tally: Record<RecheckOutcome, number> = { approved: 0, taken_down: 0, still_unavailable: 0, skipped: 0 };
  const { data, error } = await adminClient
    .from('comments')
    .select('id')
    .eq('moderation_status', 'flagged')
    .like('moderation_reason', UNAVAILABLE)
    .is('deleted_at', null)
    .lt('created_at', new Date(Date.now() - 60_000).toISOString())
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) throw error;

  for (const { id } of data ?? []) {
    try {
      tally[await recheckComment(id)] += 1;
    } catch (err) {
      console.error(`[moderation] sweep ${id} failed:`, err);
    }
  }
  return tally;
}
