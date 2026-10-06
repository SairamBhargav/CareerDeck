/*
 * Two boards that failed every nightly crawl from 2026-10-02 (2026-10-05).
 *
 * ── greenhouse:axon — 23505 on jobs_dedup_key_open_idx ─────────────────────────────
 *
 * dedup_key is generated from (company, title_normalized, city, seniority), and the update
 * branch of ingest_upsert_job rewrites `seniority`, so an update can move a row onto a key
 * that another open row already holds. The 2026-09-30 years parser made that routine: it
 * reclassified most of Axon's unranked roles as `mid`, and Axon posts one role under several
 * requisition ids, which the dedup key had collapsed into one row. In a batch:
 *
 *   1. requisition B (collapsed, no row of its own) looks up key (cew, *, mid), finds
 *      nothing — the one real row is still at (cew, *, null) — and inserts a new row;
 *   2. requisition A, that real row's own identity, is found by external id, its seniority
 *      goes null → mid, its key becomes (cew, *, mid), and the unique index rejects it.
 *
 * The batch rolls back, nothing on the board is reclassified, and the next night replays it
 * in the same order. Any classifier change that moves seniority can do this to any board.
 *
 * The fix: when an update is about to move a row onto a key another open row holds, those
 * two rows are now the same job by §3.4's own definition. Keep the row this posting's source
 * identity points at — it is the one with the history — and close the other, exactly as the
 * sweep would close a posting that stopped appearing. On the next crawl B's posting finds no
 * open row by its external id and collapses into A by key, so the result is stable.
 *
 * Note the new key is computed from the existing row's title_normalized and city, not the
 * incoming ones: the update branch writes seniority but never title_normalized or city.
 *
 * ── greenhouse:wayve — 404 ─────────────────────────────────────────────────────────
 *
 * Wayve moved from Greenhouse to Ashby (the Ashby posting API answers for `wayve`; every
 * Greenhouse token 404s). The source row moves with it. Its Greenhouse-era rows carry
 * Greenhouse external ids, so they either collapse into the Ashby postings by key or are
 * closed by the sweep 48 hours after the Ashby board's first success.
 */

-- ── ingest_upsert_job ──────────────────────────────────────────────────────────

/*
 * 20261004000000's version, plus the rekey check in the update branch. Nothing else differs.
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
  v_family       text := nullif(p ->> 'job_family', '');
  v_key          text := public.job_dedup_key(v_company_id, v_title_norm, v_city, v_seniority);
  v_existing     public.jobs%rowtype;
  v_rekey        text;
  v_new_id       uuid;
  v_near_id      uuid;
  v_near_score   real;
  v_requirements text[] := coalesce(array(select jsonb_array_elements_text(p -> 'requirements')), '{}');
  v_skills       text[] := coalesce(array(select jsonb_array_elements_text(p -> 'skills')), '{}');
  v_apply_url    text;
begin
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
    -- The update below writes seniority but not title_normalized or city, so this is the
    -- key the row is about to have. If another open row already holds it, the two are the
    -- same job now: close that one rather than let the unique index fail the whole batch.
    v_rekey := public.job_dedup_key(v_existing.company_id, v_existing.title_normalized,
                                    v_existing.location_city, v_seniority);
    if v_rekey is distinct from v_existing.dedup_key then
      update public.jobs
         set status = 'closed'
       where dedup_key = v_rekey
         and status = 'open'
         and id <> v_existing.id;
    end if;

    v_apply_url := case
                     when v_existing.source_id is null or v_existing.source_id = v_source_id
                     then p ->> 'apply_url' else v_existing.apply_url end;

    if (v_existing.title, v_existing.description_text, v_existing.requirements, v_existing.skills,
        v_existing.salary_min, v_existing.salary_max, v_existing.salary_period, v_existing.salary_currency,
        v_existing.seniority, v_existing.employment_type, v_existing.location_type,
        v_existing.quality_score, v_existing.closes_at, v_existing.apply_url,
        v_existing.description_html, v_existing.source_id, v_existing.external_id, v_existing.job_family)
       is not distinct from
       (p ->> 'title', p ->> 'description_text', v_requirements, v_skills,
        (p ->> 'salary_min')::numeric(12,2), (p ->> 'salary_max')::numeric(12,2),
        nullif(p ->> 'salary_period', '')::public.salary_period,
        coalesce(p ->> 'salary_currency', 'USD')::char(3),
        v_seniority, (p ->> 'employment_type')::public.employment_type,
        (p ->> 'location_type')::public.location_type,
        (p ->> 'quality_score')::real, nullif(p ->> 'closes_at', '')::timestamptz, v_apply_url,
        null::text, coalesce(v_existing.source_id, v_source_id), coalesce(v_existing.external_id, v_external_id),
        v_family)
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
             external_id      = coalesce(j.external_id, v_external_id),
             job_family       = v_family
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
    posted_at, closes_at, dedup_group_id, quality_score, job_family
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
    (p ->> 'quality_score')::real,
    v_family
  )
  returning id into v_new_id;

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

-- ── wayve: greenhouse → ashby ──────────────────────────────────────────────────

-- The Greenhouse ETag and failure streak describe a board that no longer exists.
update public.job_sources
   set kind                 = 'ashby',
       board_url            = 'https://jobs.ashbyhq.com/wayve',
       board_token          = 'wayve',
       etag                 = null,
       consecutive_failures = 0,
       last_crawled_at      = null,
       notes                = concat_ws(E'\n', notes,
                                '2026-10-05: moved from Greenhouse (404) to Ashby.')
 where kind = 'greenhouse'
   and board_token = 'wayve';
