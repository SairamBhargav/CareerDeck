/*
 * Make "Suggested for you" for you.
 *
 * ── What it was ───────────────────────────────────────────────────────────────
 *
 * `suggested_companies()` has been a plain top-by-openings query over every active
 * company since phase 1 — the same twelve names for every account, led by whoever happens
 * to be hiring most. It did not read the reader's preferences, their major or their resume,
 * and it did not know what they already follow, so a company stayed in the row after being
 * followed and the heading was a promise the query never kept.
 *
 * ── What it is now ────────────────────────────────────────────────────────────
 *
 * Two changes, both of which need to be here rather than on the client.
 *
 * Follows are excluded. The client could do this, and does today, but it is the kind of
 * thing that belongs next to the data: a suggestion the reader has already accepted is not
 * a suggestion, and every caller would otherwise have to remember that.
 *
 * Relevance comes from `user_job_families()` — onboarding's sectors, the major on the
 * profile, and every field of study on the parsed resume, already unioned for the ranker.
 * A company is relevant when it has an open posting in one of those families.
 *
 * `companies.industry` is not usable for this and was the first thing tried. Only about a
 * tenth of hiring companies have one, and the values are bespoke taglines rather than a
 * taxonomy — "CI/CD", "Search APIs", "Equity Management" — 93 distinct strings across 101
 * companies, so very nearly one per company. `jobs.job_family` is populated on 88% of open
 * postings and sorts them into eight families with hundreds of companies each, which is a
 * thing you can actually match against.
 *
 * ── Why relevance sorts rather than filters ───────────────────────────────────
 *
 * Relevant companies come first and the global list continues underneath, instead of
 * relevance being a hard filter. The row has a reserve behind it so that dismissing a card
 * can promote another without a round trip, and a hard filter would let a reader with one
 * narrow interest dismiss their way to an empty carousel. Sorting degrades; filtering
 * breaks.
 *
 * ── security definer ─────────────────────────────────────────────────────────
 *
 * `user_job_families` is deliberately revoked from `public`, `anon` and `authenticated`
 * (phase 8, line 929) and granted only to `service_role`, so a function running as its
 * caller cannot reach it. `my_deck_profile()` solves this by being `security definer` and
 * passing `(select auth.uid())`, and this follows it exactly.
 *
 * That makes the usual demand: because RLS is bypassed inside, the only identity this may
 * ever use is `(select auth.uid())`. It takes no user id and must never take one — a
 * `p_user_id` parameter here would be a way to read anybody's interests.
 *
 * Still granted to `anon`, which it was before. With no session `auth.uid()` is null, the
 * family list is null, nothing is excluded as followed, and the result is the global list it
 * always was.
 */

create or replace function public.suggested_companies(p_limit integer default 12)
returns setof public.company_card
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    -- Subselect form, as elsewhere: it is evaluated once per statement rather than per row.
    select (select auth.uid()) as uid
  ),
  mine as (
    select case
             when (select uid from me) is null then null
             else public.user_job_families((select uid from me))
           end as families
  ),
  relevant as (
    select distinct j.company_id
      from public.jobs j
     where j.status = 'open'
       and j.job_family is not null
       -- `= any (null)` is null, not an error, so a reader with no families on record
       -- simply has an empty relevant set and falls through to the global order.
       and j.job_family = any ((select families from mine))
  )
  select c.id, c.slug, c.name, c.domain, c.logo_url, c.logo_monogram, c.logo_color,
         c.industry, c.hq_location, c.description, c.follower_count, c.open_job_count,
         null::real, c.linkedin_follower_count
    from public.companies c
   where c.is_active
     and c.open_job_count > 0
     and not exists (select 1
                       from public.company_follows f
                      where f.user_id = (select uid from me)
                        and f.company_id = c.id)
   order by (c.id in (select company_id from relevant)) desc,
            c.open_job_count desc, c.follower_count desc, c.name
   limit least(greatest(coalesce(p_limit, 12), 1), 50);
$$;

comment on function public.suggested_companies(integer) is
  'Companies worth following: those hiring in the reader''s job families first, then the '
  'rest by openings, with anything they already follow left out. Falls back to the global '
  'list for a reader with no families on record, and for anon.';

-- `create or replace` keeps the existing grants; restated so the audience is visible here
-- rather than only in phase 1.
grant execute on function public.suggested_companies(integer) to anon, authenticated;
