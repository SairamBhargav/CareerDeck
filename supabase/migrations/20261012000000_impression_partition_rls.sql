/*
 * Lock down every job_impressions partition, including the ones maintenance creates
 * (2026-10-06 health check).
 *
 * ensure_impression_partitions() runs nightly and creates next months' partitions with a bare
 * `create table … partition of`. A partition is its own table: it does not inherit the parent's
 * row-level security, and Supabase's default privileges grant anon and authenticated full rights
 * on every new table in `public`. The partitions phase 2 created were locked down by that
 * migration; the first one maintenance created on its own, job_impressions_2027_01, was not —
 * RLS off and SELECT/INSERT/UPDATE/DELETE open to anyone with the anon key through PostgREST.
 * It is empty until 2027-01-01, which is the only reason nothing has leaked: impressions are
 * which postings each reader looked at.
 *
 * Impressions are written and read only through security-definer functions, so no client role
 * needs a grant on any partition. Every existing partition gets RLS and loses the client grants,
 * and the function now does the same to each partition it creates.
 */

do $$
declare
  part regclass;
begin
  for part in
    select c.oid::regclass
      from pg_inherits i
      join pg_class c on c.oid = i.inhrelid
     where i.inhparent = 'public.job_impressions'::regclass
  loop
    execute format('alter table %s enable row level security', part);
    execute format('revoke all on %s from anon, authenticated', part);
  end loop;
end;
$$;

create or replace function public.ensure_impression_partitions(p_months_ahead integer default 3)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  month_start date := date_trunc('month', now())::date;
  offset_months integer;
  starts   date;
  ends     date;
  part     text;
  created  integer := 0;
begin
  for offset_months in 0 .. greatest(coalesce(p_months_ahead, 3), 0) loop
    starts := (month_start + (offset_months || ' months')::interval)::date;
    ends   := (starts + interval '1 month')::date;
    part   := 'job_impressions_' || to_char(starts, 'YYYY_MM');

    if to_regclass('public.' || part) is null then
      execute format(
        'create table public.%I partition of public.job_impressions for values from (%L) to (%L)',
        part, starts, ends);
      -- A partition does not inherit the parent's RLS, and default privileges hand anon and
      -- authenticated everything on a new table. Neither may stand. (20261012000000)
      execute format('alter table public.%I enable row level security', part);
      execute format('revoke all on public.%I from anon, authenticated', part);
      created := created + 1;
    end if;
  end loop;

  return created;
end;
$$;
