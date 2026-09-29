-- Ingestion first resolves (source, external id, city) before fuzzy/dedup fallback.
-- jobs_source_idx alone scans every posting on the board for every incoming row.
-- On the hosted corpus a missing OpenAI id scanned 1,009 rows and took ~1 second;
-- a 50-row reconcile then competes with the API's inherited 8-second timeout.
-- This also supports touchSeen's source + external-id batch updates.
set local lock_timeout = '5s';

create index if not exists jobs_source_external_city_open_idx
  on public.jobs (source_id, external_id, (coalesce(location_city, '*')))
  where status = 'open';
