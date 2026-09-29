/*
 * Closed jobs stop accumulating.
 *
 * The staleness sweep closes a posting 48 hours after its board stops listing it, and until
 * now nothing ever removed one. Every job that ever existed stayed at roughly 8 KB of
 * description and search vector, which on the free plan's 500 MB is a slow way back to
 * read-only mode (flagged 2026-09-29).
 *
 * Kept: any job a person has touched — liked, saved, hidden, applied to, commented on, or
 * drafted with Auto Apply. Those rows are somebody's history; `applications` would refuse the
 * delete anyway, and the others would cascade it away. Everything else closed for
 * p_closed_days is deleted, with its stored payloads, so the next crawl does not treat a
 * posting that reappears as already imported.
 */

set lock_timeout = '10s';

create or replace function public.prune_closed_jobs(p_closed_days integer default 30)
returns integer
language plpgsql
set search_path = ''
as $fn$
declare
  removed integer;
begin
  with doomed as (
    select j.id, j.source_id, j.external_id
      from public.jobs j
     where j.status <> 'open'
       -- updated_at moves when the sweep closes a row, and nothing touches a closed row after.
       and j.updated_at < now() - make_interval(days => p_closed_days)
       and not exists (select 1 from public.job_interactions i where i.job_id = j.id)
       and not exists (select 1 from public.applications a where a.job_id = j.id)
       and not exists (select 1 from public.comments c where c.job_id = j.id)
       and not exists (select 1 from public.auto_apply_runs r where r.job_id = j.id)
  ),
  gone as (
    delete from public.jobs j using doomed d where j.id = d.id
    returning d.source_id, d.external_id
  ),
  -- Only when no other row (an open one, or a kept closed one) still comes from that posting.
  raw_gone as (
    delete from public.raw_postings r
     using gone g
     where r.source_id = g.source_id and r.external_id = g.external_id
       and r.processed_at is not null
       and not exists (
         select 1 from public.jobs j
          where j.source_id = g.source_id and j.external_id = g.external_id
            and j.id not in (select d.id from doomed d))
    returning 1
  )
  select count(*) into removed from gone;

  return removed;
end;
$fn$;

revoke all on function public.prune_closed_jobs(integer) from public, anon, authenticated;
grant execute on function public.prune_closed_jobs(integer) to service_role;
