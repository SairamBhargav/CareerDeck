/*
 * Fit the corpus inside the free plan: 500 MB of database and a small daily Disk IO budget.
 *
 * Measured on the hosted project on 2026-09-29, at 21,260 open jobs:
 *   - the database was 558 MB, over the cap; jobs was 426 MB of it, 342 MB of that TOAST
 *   - description_html held 92 MB and nothing reads it: the app and Auto Apply read
 *     description_text, and raw_postings keeps the source HTML for a replay
 *   - search_vector held 125 MB, most of it word positions for the description
 *   - 8,387 updates to jobs, 0 of them HOT. last_seen_at is indexed, so the daily "still
 *     open" touch wrote a fresh entry into every index, including a GIN entry for each of
 *     ~500 lexemes per posting. That churn is what drained the Disk IO budget.
 */

set lock_timeout = '10s';
-- One rewrite of a few hundred MB on the smallest compute; the API's inherited timeout
-- would cancel it halfway.
set statement_timeout = '20min';

/*
 * The sweep is one query a night joined through job_sources; it does not need its own
 * index. Dropping this one is what lets a last_seen_at-only update be HOT, which rewrites
 * no index at all.
 */
drop index if exists public.jobs_stale_idx;

/*
 * One rewrite does three things:
 *   - fillfactor 80 leaves room on each page for the HOT version of a touched row
 *   - description_html is emptied (USING null forces the rewrite that actually frees it;
 *     an UPDATE would leave dead TOAST behind and write it all to WAL first)
 *   - the description's contribution to search_vector keeps its lexemes but drops their
 *     positions, roughly 40% of the column
 *
 * What stripping costs, checked against Postgres before shipping: an unquoted word still
 * matches anywhere in the description. A quoted phrase ("payment systems") matches only in
 * the title or skills, and a description-only match ranks 0 from ts_rank_cd. The
 * description was already weighted D, the lowest weight.
 */
alter table public.jobs
  set (fillfactor = 80),
  alter column description_html type text using null::text,
  alter column search_vector set expression as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(public.text_array_to_string(skills, ' '), '')), 'B') ||
    strip(to_tsvector('english', coalesce(description_text, '')))
  );

comment on column public.jobs.description_html is
  'Not stored (always null) since 20261002000000. The source HTML lives in raw_postings.payload.';

/*
 * ingest_upsert_job, unchanged except for two things:
 *   - description_html is never written
 *   - a posting whose content did not change only has last_seen_at and run_id refreshed.
 *     That update is HOT. A full rewrite re-TOASTs the description and re-indexes every
 *     lexeme even when every value is identical.
 */
create or replace function public.ingest_upsert_job(p jsonb)
returns text
language plpgsql
as $$
declare
  v_company_id   uuid := (p ->> 'company_id')::uuid;
  v_title_norm   text := p ->> 'title_normalized';
  v_city         text := p ->> 'location_city';
  v_source_id    uuid := nullif(p ->> 'source_id', '')::uuid;
  v_external_id  text := p ->> 'external_id';
  v_seniority    public.seniority_level := nullif(p ->> 'seniority', '')::public.seniority_level;
  v_key          text := public.job_dedup_key(v_company_id, v_title_norm, v_city, v_seniority);
  v_existing     public.jobs%rowtype;
  v_new_id       uuid;
  v_near_id      uuid;
  v_near_score   real;
  v_requirements text[] := coalesce(array(select jsonb_array_elements_text(p -> 'requirements')), '{}');
  v_skills       text[] := coalesce(array(select jsonb_array_elements_text(p -> 'skills')), '{}');
  v_apply_url    text;
begin
  -- Identity lookup, two tiers: see 20260922000000_phase1_jobs.sql for why this order.
  if v_source_id is not null and v_external_id is not null then
    select * into v_existing
      from public.jobs
     where source_id = v_source_id
       and external_id = v_external_id
       and coalesce(location_city, '*') = coalesce(v_city, '*')
       and status = 'open'
     limit 1;
  end if;

  if not found then
    select * into v_existing
      from public.jobs
     where dedup_key = v_key and status = 'open'
     limit 1;
  end if;

  if found then
    -- Only the source that owns this posting may repoint where it applies.
    v_apply_url := case
                     when v_existing.source_id is null or v_existing.source_id = v_source_id
                     then p ->> 'apply_url' else v_existing.apply_url end;

    if (v_existing.title, v_existing.description_text, v_existing.requirements, v_existing.skills,
        v_existing.salary_min, v_existing.salary_max, v_existing.salary_period, v_existing.salary_currency,
        v_existing.seniority, v_existing.employment_type, v_existing.location_type,
        v_existing.quality_score, v_existing.closes_at, v_existing.apply_url,
        v_existing.description_html, v_existing.source_id, v_existing.external_id)
       is not distinct from
       (p ->> 'title', p ->> 'description_text', v_requirements, v_skills,
        (p ->> 'salary_min')::numeric(12,2), (p ->> 'salary_max')::numeric(12,2),
        nullif(p ->> 'salary_period', '')::public.salary_period,
        coalesce(p ->> 'salary_currency', 'USD')::char(3),
        v_seniority, (p ->> 'employment_type')::public.employment_type,
        (p ->> 'location_type')::public.location_type,
        (p ->> 'quality_score')::real, nullif(p ->> 'closes_at', '')::timestamptz, v_apply_url,
        null::text, coalesce(v_existing.source_id, v_source_id), coalesce(v_existing.external_id, v_external_id))
    then
      update public.jobs
         set last_seen_at = now(),
             run_id       = nullif(p ->> 'run_id', '')::uuid
       where id = v_existing.id;
    else
      update public.jobs j
         set last_seen_at     = now(),
             title            = p ->> 'title',
             description_text = p ->> 'description_text',
             description_html = null,
             requirements     = v_requirements,
             skills           = v_skills,
             salary_min       = (p ->> 'salary_min')::numeric,
             salary_max       = (p ->> 'salary_max')::numeric,
             salary_period    = nullif(p ->> 'salary_period', '')::public.salary_period,
             salary_currency  = coalesce(p ->> 'salary_currency', 'USD'),
             seniority        = v_seniority,
             employment_type  = (p ->> 'employment_type')::public.employment_type,
             location_type    = (p ->> 'location_type')::public.location_type,
             quality_score    = (p ->> 'quality_score')::real,
             closes_at        = nullif(p ->> 'closes_at', '')::timestamptz,
             run_id           = nullif(p ->> 'run_id', '')::uuid,
             apply_url        = v_apply_url,
             source_id        = coalesce(j.source_id, v_source_id),
             external_id      = coalesce(j.external_id, v_external_id)
       where j.id = v_existing.id;
    end if;

    if v_existing.source_id is not distinct from v_source_id then
      if v_existing.external_id is not distinct from v_external_id then
        return 'updated';
      end if;
      return 'collapsed';
    end if;
    return 'duplicate';
  end if;

  insert into public.jobs (
    company_id, source_id, run_id, external_id, title, title_normalized, seniority,
    company_name, location_raw, location_city, location_region, location_country,
    location_type, employment_type, salary_min, salary_max, salary_period, salary_currency,
    description_text, requirements, skills, apply_url, apply_host,
    posted_at, closes_at, dedup_group_id, quality_score
  )
  values (
    v_company_id,
    v_source_id,
    nullif(p ->> 'run_id', '')::uuid,
    v_external_id,
    p ->> 'title',
    v_title_norm,
    v_seniority,
    p ->> 'company_name',
    p ->> 'location_raw',
    v_city,
    p ->> 'location_region',
    nullif(p ->> 'location_country', ''),
    (p ->> 'location_type')::public.location_type,
    (p ->> 'employment_type')::public.employment_type,
    (p ->> 'salary_min')::numeric,
    (p ->> 'salary_max')::numeric,
    nullif(p ->> 'salary_period', '')::public.salary_period,
    coalesce(p ->> 'salary_currency', 'USD'),
    p ->> 'description_text',
    v_requirements,
    v_skills,
    p ->> 'apply_url',
    p ->> 'apply_host',
    coalesce(nullif(p ->> 'posted_at', '')::timestamptz, now()),
    nullif(p ->> 'closes_at', '')::timestamptz,
    coalesce(nullif(p ->> 'dedup_group_id', '')::uuid, gen_random_uuid()),
    (p ->> 'quality_score')::real
  )
  returning id into v_new_id;

  -- Near-miss detection: files a review, never merges. See the phase 1 migration.
  select o.id, extensions.similarity(o.title_normalized, v_title_norm)
    into v_near_id, v_near_score
    from public.jobs o
   where o.company_id = v_company_id
     and o.status = 'open'
     and o.id <> v_new_id
     and o.seniority is not distinct from v_seniority
     and o.dedup_group_id is distinct from (select dedup_group_id from public.jobs where id = v_new_id)
     and coalesce(o.location_city, '*') = coalesce(v_city, '*')
     and extensions.similarity(o.title_normalized, v_title_norm) > 0.85
   order by 2 desc
   limit 1;

  if v_near_id is not null then
    insert into public.job_dedup_review (job_id, other_job_id, similarity, signal)
    values (v_new_id, v_near_id, v_near_score, 'title_trigram')
    on conflict (job_id, other_job_id) do nothing;
  end if;

  return 'created';
end;
$$;

revoke all on function public.ingest_upsert_job(jsonb) from public, anon, authenticated;

/*
 * raw_postings keeps every version of every payload forever, and a version is the full
 * posting (about 6 KB). This drops what can never be needed again:
 *   - a version superseded by a newer version of the same posting that has already been
 *     imported. Replay would only overwrite it with the newer one anyway.
 *   - every version of a posting whose jobs are all closed, the last closed at least
 *     p_closed_days ago
 * Nothing unprocessed is touched, so an interrupted import is still retried.
 */
create or replace function public.prune_raw_postings(p_closed_days integer default 30)
returns integer
language plpgsql
as $$
declare
  superseded integer;
  closed     integer;
begin
  delete from public.raw_postings r
   where r.processed_at is not null
     and exists (
       select 1 from public.raw_postings newer
        where newer.source_id = r.source_id
          and newer.external_id = r.external_id
          and newer.id > r.id
          and newer.processed_at is not null);
  get diagnostics superseded = row_count;

  delete from public.raw_postings r
   where r.processed_at is not null
     and exists (
       select 1 from public.jobs j
        where j.source_id = r.source_id and j.external_id = r.external_id)
     and not exists (
       select 1 from public.jobs j
        where j.source_id = r.source_id and j.external_id = r.external_id
          and (j.status = 'open' or j.updated_at > now() - make_interval(days => p_closed_days)));
  get diagnostics closed = row_count;

  return superseded + closed;
end;
$$;

revoke all on function public.prune_raw_postings(integer) from public, anon, authenticated;

-- A crawl killed mid-board leaves its run open forever.
update public.crawl_runs
   set status = 'failed', finished_at = now(), error = 'abandoned: process exited mid-run'
 where status = 'running' and started_at < now() - interval '2 hours';

reset statement_timeout;
reset lock_timeout;
