/*
 * The job prunes, in batches, with the "kept" test as set-based anti-joins (2026-10-10).
 *
 * 20261030000000 added prune_old_jobs() and the nightly Maintain step has failed every night
 * since. The selection called job_is_kept() once per row — six correlated EXISTS probes for
 * each of 20,000 jobs — and took 38 s on hosted. Maintain calls through PostgREST, where the
 * authenticator's statement_timeout is 8 s, so the call died before deleting anything and the
 * 4,400 postings older than 90 days stayed put.
 *
 * Written as NOT EXISTS anti-joins against `jobs` itself the same selection takes 1.4 s and
 * returns the same rows (measured: 4,482, one kept). It has to be against the table: the same
 * anti-joins over `unnest()` of an id array took 68 s, because the planner cannot size an
 * array and falls back to nested loops. So the rule is written out in each function rather
 * than shared through a helper that takes ids.
 *
 * The delete cascades into comments, match scores and signals, so each call now removes at
 * most p_limit jobs and returns how many; scripts/maintain.mjs calls again until one removes
 * none. job_is_kept() stays: it is still the right test for a single job.
 */

set lock_timeout = '10s';

drop function if exists public.prune_old_jobs(integer);
drop function if exists public.prune_closed_jobs(integer);

create or replace function public.prune_old_jobs(p_days integer default 90, p_limit integer default 250)
returns integer
language plpgsql
set search_path = ''
as $fn$
begin
  return public.delete_jobs_and_payloads(array(
    select j.id from public.jobs j
     where j.posted_at < now() - make_interval(days => greatest(coalesce(p_days, 90), 30))
       -- job_is_kept(), as anti-joins. Keep the two in step.
       and not exists (select 1 from public.job_interactions i where i.job_id = j.id)
       and not exists (select 1 from public.applications a where a.job_id = j.id)
       and not exists (select 1 from public.auto_apply_runs r where r.job_id = j.id)
       and not exists (select 1 from public.match_looks m where m.job_id = j.id)
       and not exists (select 1 from public.notifications n
                        where n.subject_type = 'job' and n.subject_id = j.id)
       and not exists (select 1 from public.comments c
                         join auth.users u on u.id = c.author_id
                        where c.job_id = j.id
                          and coalesce(u.email, '') not like '%@seed.careerdeck.invalid')
     limit greatest(coalesce(p_limit, 250), 1)));
end;
$fn$;

create or replace function public.prune_closed_jobs(p_closed_days integer default 30, p_limit integer default 250)
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
       -- job_is_kept(), as anti-joins. Keep the two in step.
       and not exists (select 1 from public.job_interactions i where i.job_id = j.id)
       and not exists (select 1 from public.applications a where a.job_id = j.id)
       and not exists (select 1 from public.auto_apply_runs r where r.job_id = j.id)
       and not exists (select 1 from public.match_looks m where m.job_id = j.id)
       and not exists (select 1 from public.notifications n
                        where n.subject_type = 'job' and n.subject_id = j.id)
       and not exists (select 1 from public.comments c
                         join auth.users u on u.id = c.author_id
                        where c.job_id = j.id
                          and coalesce(u.email, '') not like '%@seed.careerdeck.invalid')
     limit greatest(coalesce(p_limit, 250), 1)));
end;
$fn$;

revoke all on function public.prune_old_jobs(integer, integer)    from public, anon, authenticated;
revoke all on function public.prune_closed_jobs(integer, integer) from public, anon, authenticated;
grant execute on function public.prune_old_jobs(integer, integer)    to service_role;
grant execute on function public.prune_closed_jobs(integer, integer) to service_role;
