/*
 * How many people have liked a posting.
 *
 * The Deck's rail labelled its actions "Like", "Comment" and "More". Comments already
 * showed a count instead, because `comment_counts` exists; likes could not, because
 * nothing counts them and nothing is allowed to.
 *
 * `job_interactions` carries the policy `job_interactions_select_own`, which is correct —
 * who liked what is nobody else's business — but it also means a reader cannot see that
 * four hundred other people liked a posting, only whether they did. A count is the one
 * aggregate of that table worth publishing, and publishing it reveals nothing about who.
 *
 * Shaped exactly like `comment_counts`: same argument, same two hundred cap, same
 * security definer and empty search path, so the two reads behave identically and the
 * client can batch them the same way.
 *
 * ── Honestly, about the number ────────────────────────────────────────────────
 *
 * There are twenty likes in this database, spread across twenty postings — one each. So
 * this will return nothing for almost every card for a long while, which is why the rail
 * shows a count only when there is one and shows nothing otherwise, rather than a
 * confident "0" under every heart. The function is here so the number is real when the
 * volume is, not because the number is interesting today.
 *
 * ── Not a stored counter ──────────────────────────────────────────────────────
 *
 * `comments.like_count` is a column maintained by a trigger, because a comment's likes are
 * read on every row of a thread. These are read for twenty cards at a time and change far
 * less often, so an aggregate over an indexed column is cheaper than a column plus a
 * trigger plus the drift a counter eventually acquires.
 */

create or replace function public.like_counts(p_job_ids uuid[])
returns table (job_id uuid, like_count integer)
language sql
stable
security definer
set search_path = ''
as $fn$
  select i.job_id, count(*)::integer
    from public.job_interactions i
   where i.kind = 'like'
     and i.job_id = any (p_job_ids[1:200])
   group by i.job_id;
$fn$;

comment on function public.like_counts(uuid[]) is
  'Likes per posting, for up to two hundred at a time. security definer because '
  'job_interactions is readable only by its owner — the count is public, the rows are not.';

grant execute on function public.like_counts(uuid[]) to anon, authenticated;
