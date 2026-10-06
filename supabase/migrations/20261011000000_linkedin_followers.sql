/*
 * A company's LinkedIn follower count, shown until CareerDeck's own count means something
 * (2026-10-06).
 *
 * Every company page read "0 followers" or "1 follower" — the app's own follows, which are real
 * but tiny this early (18 companies have any; the most is 2). Until they grow, a company shows
 * the audience it has on LinkedIn, **labelled as LinkedIn's** ("412K on LinkedIn"), so nobody
 * reads it as 412 thousand CareerDeck users.
 *
 * `follower_count` is untouched and keeps counting every Follow tap. The app switches a company
 * over to it on its own once it passes a threshold (utils/format.ts, `companyAudience`), so
 * there is no day on which anything has to be migrated back.
 *
 * Where the numbers come from: each company's public LinkedIn figure as a web search shows it,
 * entered through scripts/import-linkedin-followers.mjs with the date it was read. Not a
 * scraper — LinkedIn's terms forbid automated collection at any frequency — so the figures are
 * a snapshot and `linkedin_followers_as_of` says how old.
 */

alter table public.companies
  add column linkedin_follower_count integer check (linkedin_follower_count >= 0),
  add column linkedin_followers_as_of date;

alter type public.company_card add attribute linkedin_follower_count integer;

-- Both functions that return company_card list their columns, so both gain the new one (last,
-- after `rank`, so search_companies' `order by 13` still means rank).

create or replace function public.search_companies(
  p_query text,
  p_limit integer default 10
)
returns setof public.company_card
language plpgsql
stable
as $$
declare
  q   text    := btrim(coalesce(p_query, ''));
  lim integer := least(greatest(coalesce(p_limit, 10), 1), 50);
begin
  if length(q) < 2 then
    return;
  end if;

  return query
    select c.id, c.slug, c.name, c.domain, c.logo_url, c.logo_monogram, c.logo_color,
           c.industry, c.hq_location, c.description, c.follower_count, c.open_job_count,
           (extensions.similarity(c.name, q)
            + case when c.name ilike q || '%' then 0.5 else 0 end)::real,
           c.linkedin_follower_count
      from public.companies c
     where c.is_active
       and (c.name ilike q || '%' or extensions.similarity(c.name, q) > 0.2)
     order by 13 desc, (c.open_job_count > 0) desc, c.open_job_count desc, c.name
     limit lim;
end;
$$;

create or replace function public.suggested_companies(p_limit integer default 12)
returns setof public.company_card
language sql
stable
as $$
  select c.id, c.slug, c.name, c.domain, c.logo_url, c.logo_monogram, c.logo_color,
         c.industry, c.hq_location, c.description, c.follower_count, c.open_job_count,
         null::real, c.linkedin_follower_count
    from public.companies c
   where c.is_active
     and c.open_job_count > 0
   order by c.open_job_count desc, c.follower_count desc, c.name
   limit least(greatest(coalesce(p_limit, 12), 1), 50);
$$;
