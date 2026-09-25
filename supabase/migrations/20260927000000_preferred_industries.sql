-- Onboarding — the sectors a user picks on their second run-in with the app.
--
-- README §3.1's `user_preferences` was written before onboarding existed, so it carries
-- roles, locations and employment types but nothing for the "Pick what fills your feed"
-- step. This is that column.
--
-- Sector keys, not `companies.industry` values. The industry column in the corpus holds
-- ~100 hyper-narrow labels straight off each company's own positioning — "Model
-- Inference", "Corporate Spend", "Vector Databases" — which are right for a company page
-- and useless as a thing to ask a nineteen-year-old to pick from. The keys stored here
-- are the nine curated sectors in constants/industries.ts, and that file is also what maps
-- a sector to the companies inside it. Keeping the mapping on the client is deliberate for
-- now: it changes when the board list changes, and the board list is a client-side
-- constant too (scripts/board-list.ts).
--
-- Phase 5's ranker is the first thing that will want this server-side. When it does, the
-- mapping becomes a `sector` column on `companies` written at ingest, and this column
-- stays exactly as it is.

alter table public.user_preferences
  add column preferred_industries text[] not null default '{}';

-- The phase 0 grant enumerates columns, so a new one is unreachable until it is named.
-- Without this the onboarding write fails with a permission error on this column alone,
-- which is a confusing way to find out.
grant update (preferred_industries) on public.user_preferences to authenticated;

comment on column public.user_preferences.preferred_industries is
  'Curated sector keys from constants/industries.ts, chosen during onboarding. Not companies.industry values.';
