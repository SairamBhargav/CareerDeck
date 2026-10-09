/*
 * Old postings go, and launch seed comments stop pinning jobs in place (2026-10-09).
 *
 * The database passed the free plan's 500 MB. Two changes:
 *
 * 1. `prune_old_jobs()`: postings first published more than p_days ago are deleted, open or
 *    not. The crawl stops storing them too (MAX_POSTING_AGE_DAYS in ingest/pipeline.ts), so
 *    they do not come back. The deck's fit arm reaches back only 30–60 days, so these are
 *    almost never shown.
 *
 * 2. `prune_closed_jobs()` kept any job with a comment. Since the launch seed
 *    (server/scripts/seed-comments.mjs) almost every feed job has seed comments, so nothing
 *    closed would ever be pruned again. A comment now counts only when a real person wrote
 *    it. Seed accounts are the ones whose email is on SEED_DOMAIN.
 *
 * Both functions keep any job somebody has touched, the same rule as before plus two:
 * liked, saved, hidden, applied to, drafted with Auto Apply, commented on by a real person,
 * opened in the match breakdown (match_looks, which counts a free reader's weekly looks), or
 * named by a notification (job alerts and deadlines link to the posting).
 */

set lock_timeout = '10s';

create or replace function public.job_is_kept(p_job_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $fn$
  select exists (select 1 from public.job_interactions i where i.job_id = p_job_id)
      or exists (select 1 from public.applications a where a.job_id = p_job_id)
      or exists (select 1 from public.auto_apply_runs r where r.job_id = p_job_id)
      or exists (select 1 from public.match_looks m where m.job_id = p_job_id)
      or exists (select 1 from public.notifications n
                  where n.subject_type = 'job' and n.subject_id = p_job_id)
      or exists (select 1 from public.comments c
                   join auth.users u on u.id = c.author_id
                  where c.job_id = p_job_id
                    and coalesce(u.email, '') not like '%@seed.careerdeck.invalid');
$fn$;

/*
 * Deletes the given jobs, and the stored payloads no remaining job comes from, so a posting
 * that reappears is imported fresh rather than treated as already seen.
 */
create or replace function public.delete_jobs_and_payloads(p_ids uuid[])
returns integer
language plpgsql
set search_path = ''
as $fn$
declare
  removed integer;
begin
  with gone as (
    delete from public.jobs j where j.id = any (p_ids)
    returning j.source_id, j.external_id
  ),
  raw_gone as (
    delete from public.raw_postings r
     using gone g
     where r.source_id = g.source_id and r.external_id = g.external_id
       and r.processed_at is not null
       and not exists (
         select 1 from public.jobs j
          where j.source_id = g.source_id and j.external_id = g.external_id
            and not (j.id = any (p_ids)))
    returning 1
  )
  select count(*) into removed from gone;
  return removed;
end;
$fn$;

create or replace function public.prune_closed_jobs(p_closed_days integer default 30)
returns integer
language plpgsql
set search_path = ''
as $fn$
begin
  return public.delete_jobs_and_payloads(array(
    select j.id from public.jobs j
     where j.status <> 'open'
       -- updated_at moves when the sweep closes a row, and nothing touches a closed row after.
       and j.updated_at < now() - make_interval(days => p_closed_days)
       and not public.job_is_kept(j.id)));
end;
$fn$;

create or replace function public.prune_old_jobs(p_days integer default 90)
returns integer
language plpgsql
set search_path = ''
as $fn$
begin
  return public.delete_jobs_and_payloads(array(
    select j.id from public.jobs j
     where j.posted_at < now() - make_interval(days => greatest(coalesce(p_days, 90), 30))
       and not public.job_is_kept(j.id)));
end;
$fn$;

revoke all on function public.job_is_kept(uuid)                  from public, anon, authenticated;
revoke all on function public.delete_jobs_and_payloads(uuid[])   from public, anon, authenticated;
revoke all on function public.prune_closed_jobs(integer)         from public, anon, authenticated;
revoke all on function public.prune_old_jobs(integer)            from public, anon, authenticated;
grant execute on function public.job_is_kept(uuid)                to service_role;
grant execute on function public.delete_jobs_and_payloads(uuid[]) to service_role;
grant execute on function public.prune_closed_jobs(integer)       to service_role;
grant execute on function public.prune_old_jobs(integer)          to service_role;
