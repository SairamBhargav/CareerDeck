/*
 * "Your comments" — the Activity tab's Comments list (2026-10-07).
 *
 * Until now that tab was the notifications inbox only, so somebody who had commented and had no
 * replies yet saw "Nothing yet" — reported as "comments don't show up". This is the reader's own
 * comments, newest first, with the posting each one sits on.
 *
 * Their own, so the projection can say more than comments_public does:
 *  - `status` is the author's view of moderation. `live` covers approved and flagged, which are
 *    both published. `under_review` is a takedown awaiting a human (`pending`): the author was
 *    told, and the row says so instead of the comment silently vanishing. `removed` is final.
 *  - Blocks are not applied. Somebody you blocked cannot hide your own words from you.
 *
 * The posting is joined rather than resolved by the client: a closed posting that the feed no
 * longer returns still has a title worth showing, and prune_closed_jobs keeps any posting with a
 * comment on it, so the join always finds one.
 *
 * Keyset-paged on (created_at, id) like job_comments, over comments_author_recent_idx.
 */

create or replace function public.my_comments(
  p_cursor text default null,
  p_limit  integer default 30
)
returns table (
  id            uuid,
  job_id        uuid,
  parent_id     uuid,
  body          text,
  gif_id        text,
  like_count    integer,
  reply_count   integer,
  created_at    timestamptz,
  status        text,
  job_title     text,
  company_name  text,
  company_logo  text,
  next_cursor   text
)
language sql
stable
security definer
set search_path = ''
as $fn$
  with args as (
    select (select auth.uid())                           as uid,
           least(greatest(coalesce(p_limit, 30), 1), 50) as lim,
           public.decode_cursor(p_cursor)                as cur
  )
  select c.id,
         c.job_id,
         c.parent_id,
         c.body,
         c.gif_id,
         c.like_count,
         c.reply_count,
         c.created_at,
         case c.moderation_status
           when 'pending' then 'under_review'
           when 'removed' then 'removed'
           else 'live'
         end,
         j.title,
         co.name,
         co.logo_url,
         public.encode_cursor(to_char(c.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.USOF'), c.id)
    from public.comments c
   cross join args a
    join public.jobs j       on j.id = c.job_id
    join public.companies co on co.id = j.company_id
   where a.uid is not null
     and c.author_id = a.uid
     and c.deleted_at is null
     and (a.cur is null
          or (c.created_at, c.id) < ((a.cur ->> 'v')::timestamptz, (a.cur ->> 'i')::uuid))
   order by c.created_at desc, c.id desc
   limit (select lim from args);
$fn$;

revoke all on function public.my_comments(text, integer) from public, anon;
grant execute on function public.my_comments(text, integer) to authenticated;
