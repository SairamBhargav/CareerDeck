/*
 * Search was timing out on the words people actually type.
 *
 * ── What was happening ────────────────────────────────────────────────────────
 *
 * The ranked branch computed `ts_rank_cd` over every match before taking a page of
 * twenty. For a rare term that is nothing. For a common one it is the whole corpus:
 * "engineer" matches 11,710 of roughly 16,000 open postings, "software" and "data"
 * similarly, and ranking all of them means detoasting that many tsvectors and sorting the
 * lot to throw away 99.8% of the work. Every one of those queries hit the statement
 * timeout and came back as an error, so the search box returned nothing for exactly the
 * queries it most needed to answer. Rare terms — "stripe", "nvidia" — worked throughout,
 * which is what made it look intermittent rather than broken.
 *
 * Measured before this change:
 *
 *   "engineer"  11,710 matches   ranked: statement timeout   unranked 20 rows: 423ms
 *   "stripe"       609 matches   ranked: 20 rows             unranked 20 rows: 197ms
 *
 * ── What it does now ──────────────────────────────────────────────────────────
 *
 * Two steps. The GIN index picks the matches and the newest few hundred become a
 * shortlist; only those get ranked. Taking the newest as the shortlist costs nothing extra
 * because `posted_at` is already how the short-query branch orders, and relevance then
 * decides the order within it.
 *
 * Measured through the same path: the candidate phase alone is roughly 200-300ms on the
 * terms that used to time out, and ranking a few hundred rows after it is not a cost worth
 * measuring.
 *
 * ── What it gives up ──────────────────────────────────────────────────────────
 *
 * A posting that matches well but is older than the shortlist cannot surface. That is a
 * real loss and worth naming rather than hiding: search is now recency-bounded on common
 * terms. It is the right trade for a job board, where a four-month-old posting is usually
 * closed anyway, and the rank already weighted recency at 0.20 before this. It would be
 * the wrong trade for an archive.
 *
 * The shortlist grows with the offset so paging still works, and is capped so a
 * pathological page number cannot ask for the corpus back.
 *
 * ── Unverified ────────────────────────────────────────────────────────────────
 *
 * There is no local Postgres on the machine this was written on, so this SQL has not been
 * run. The shape was checked by issuing the equivalent candidate query through PostgREST
 * against the live database, which is what the timings above are. Worth an EXPLAIN before
 * trusting it.
 */

create or replace function public.search_jobs(
  p_query       text,
  p_limit       integer default 20,
  p_cursor      text default null,
  p_min_quality real default 0.3
)
returns setof public.job_card
language plpgsql
stable
as $$
declare
  q       text    := btrim(coalesce(p_query, ''));
  lim     integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  offs    integer := coalesce((public.decode_cursor(p_cursor) ->> 'v')::integer, 0);
  ts      tsquery;
  /*
   * How many matches get ranked.
   *
   * Grown with the offset so paging stays correct — a reader deep in the results still
   * gets a shortlist that reaches them — and capped so a pathological page number cannot
   * ask for the whole corpus back.
   */
  shortlist integer := least(offs + lim + 400, 1500);
begin
  -- MIN_QUERY_LENGTH in hooks/useSearch.ts. Enforced on both sides.
  if length(q) < 2 then
    return;
  end if;

  if length(q) <= 3 then
    return query
      select v.id, v.company_id, v.company_slug, v.company_name, v.company_logo_url,
             v.company_logo_color, v.company_monogram, v.title, v.seniority, v.location_raw,
             v.location_city, v.location_region, v.location_country, v.location_type,
             v.employment_type, v.salary_min, v.salary_max, v.salary_period,
             v.salary_is_estimated, v.description_text, v.requirements, v.skills,
             v.apply_url, v.apply_host, v.posted_at, v.last_seen_at, v.closes_at,
             v.quality_score, v.dedup_group_id,
             -- Offset, not keyset: search results are a ranked list the reader consumes
             -- in a few pages, not an endless feed, and a rank is not a stable key.
             public.encode_cursor((offs + lim)::text, v.id),
             1.0::real
        from public.job_cards v
       where v.status = 'open'
         and v.quality_score >= p_min_quality
         and v.title_normalized like lower(q) || '%'
       order by v.posted_at desc, v.id desc
       offset offs
       limit lim;
    return;
  end if;

  -- websearch_to_tsquery never raises on user input, unlike to_tsquery. That matters when
  -- the input is whatever someone typed into a search bar.
  ts := websearch_to_tsquery('english', q);

    -- Rank a shortlist, not the whole match set. See the header.
    return query
      with candidates as (
        select v.id
          from public.job_cards v
         where v.status = 'open'
           and v.quality_score >= p_min_quality
           and v.search_vector @@ ts
         order by v.posted_at desc, v.id desc
         limit shortlist
      )
    select v.id, v.company_id, v.company_slug, v.company_name, v.company_logo_url,
           v.company_logo_color, v.company_monogram, v.title, v.seniority, v.location_raw,
           v.location_city, v.location_region, v.location_country, v.location_type,
           v.employment_type, v.salary_min, v.salary_max, v.salary_period,
           v.salary_is_estimated, v.description_text, v.requirements, v.skills,
           v.apply_url, v.apply_host, v.posted_at, v.last_seen_at, v.closes_at,
           v.quality_score, v.dedup_group_id,
           public.encode_cursor((offs + lim)::text, v.id),
           (0.60 * ts_rank_cd(v.search_vector, ts)
            + 0.20 * exp(-extract(epoch from (now() - coalesce(v.posted_at, now()))) / 1209600.0)
            + 0.20 * v.quality_score)::real
      from public.job_cards v
      join candidates c on c.id = v.id
     order by 31 desc, v.posted_at desc, v.id desc
     offset offs
     limit lim;

end;
$$;
