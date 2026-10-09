/*
 * What scorer v3 reads beyond skills, titles and levels (2026-10-08).
 *
 * ── posting side: job_signals ──────────────────────────────────────────────────────
 *
 * Four facts a posting states in prose, read by `server/src/ingest/normalize/eligibility.ts`:
 * which of its skills are only nice to have, whether it sponsors visas, whether it is open only to
 * citizens, and which graduation dates it wants.
 *
 * A table of their own rather than columns on `jobs`, for three reasons. `jobs` rows are rewritten
 * by every crawl and these change only when a description does. `ingest_upsert_job` stays exactly
 * as it is, so a parser bug here can never fail a crawl. And `npm run ingest:signals` fills it
 * after each night's crawl (.github/workflows/ingest.yml), which also backfills every posting
 * already in the corpus the first time it runs.
 *
 * `source_updated_at` is the `jobs.updated_at` the row was read from: when a posting changes,
 * its signals are read again. match_scores() recomputes a cached score when its posting's
 * signals are newer than the score.
 *
 * ── resume side: projects ──────────────────────────────────────────────────────────
 *
 * The parser now returns each role's skills (inside `experience`, no schema change) and the
 * resume's projects with theirs. A skill a student used on a project or at an internship counts
 * the same as one in their skills list; until now only the list was read, and a resume that
 * says "built a Kubernetes operator" under Projects scored as if it had never heard of it.
 */

-- ── job_signals ────────────────────────────────────────────────────────────────

create table public.job_signals (
  job_id            uuid primary key references public.jobs (id) on delete cascade,
  -- Labels from jobs.skills that the posting names only under a nice-to-have heading.
  preferred_skills  text[] not null default '{}',
  sponsorship       text check (sponsorship in ('none_ever', 'none', 'offered')),
  citizenship       text check (citizenship in ('citizen', 'us_person')),
  grad_from         date,
  grad_to           date,
  source_updated_at timestamptz not null,
  computed_at       timestamptz not null default now(),
  constraint job_signals_grad_order check (grad_from is null or grad_to is null or grad_from <= grad_to)
);

-- Server-written, server-read: match_scores() is security definer, and nothing on the client
-- reads this table directly.
alter table public.job_signals enable row level security;
revoke all on public.job_signals from anon, authenticated;

-- ── resume projects ────────────────────────────────────────────────────────────

alter table public.resume_profiles add column projects jsonb not null default '[]';

/*
 * Phase 4's function with `p_projects` added at the end. A new argument makes a new overload in
 * Postgres, so the old signature is dropped first; every caller passes arguments by name, and an
 * older server that does not send `p_projects` gets the default.
 */
drop function public.save_resume_profile(uuid, text, bytea, bytea, bytea, text, text[], jsonb,
  jsonb, numeric, public.seniority_level, smallint, jsonb);

create function public.save_resume_profile(
  p_resume_id      uuid,
  p_parser_version text,
  p_full_name_enc  bytea default null,
  p_email_enc      bytea default null,
  p_phone_enc      bytea default null,
  p_location       text default null,
  p_skills         text[] default '{}',
  p_education      jsonb default '[]',
  p_experience     jsonb default '[]',
  p_years          numeric default null,
  p_seniority      public.seniority_level default null,
  p_page_count     smallint default null,
  p_raw_parse      jsonb default null,
  p_projects       jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  owner uuid;
begin
  select user_id into owner from public.resumes
   where id = p_resume_id and deleted_at is null;

  if owner is null then
    raise exception 'no such resume' using errcode = '23503';
  end if;

  insert into public.resume_profiles (
    resume_id, full_name_enc, email_enc, phone_enc, location, skills, education,
    experience, projects, years_experience, seniority, raw_parse, parser_version, parsed_at
  ) values (
    p_resume_id, p_full_name_enc, p_email_enc, p_phone_enc,
    nullif(btrim(coalesce(p_location, '')), ''), coalesce(p_skills, '{}'),
    coalesce(p_education, '[]'::jsonb), coalesce(p_experience, '[]'::jsonb),
    coalesce(p_projects, '[]'::jsonb),
    p_years, p_seniority, p_raw_parse, p_parser_version, now()
  )
  on conflict (resume_id) do update
    set full_name_enc    = excluded.full_name_enc,
        email_enc        = excluded.email_enc,
        phone_enc        = excluded.phone_enc,
        location         = excluded.location,
        skills           = excluded.skills,
        education        = excluded.education,
        experience       = excluded.experience,
        projects         = excluded.projects,
        years_experience = excluded.years_experience,
        seniority        = excluded.seniority,
        raw_parse        = excluded.raw_parse,
        parser_version   = excluded.parser_version,
        parsed_at        = now(),
        -- A re-parse is a new set of facts, so a previous confirmation no longer applies.
        user_confirmed_at = null,
        confirmed_fields  = '{}';

  update public.resumes
     set parse_status = 'parsed',
         parse_error  = null,
         page_count   = coalesce(p_page_count, page_count),
         -- The parse names the document if the user did not.
         focus        = coalesce(focus, p_seniority::text),
         updated_at   = now()
   where id = p_resume_id;

  -- Every score for this user was computed against an older reading of this document.
  perform public.invalidate_match_scores(owner);
  return owner;
end;
$fn$;

revoke all on function public.save_resume_profile(uuid, text, bytea, bytea, bytea, text, text[], jsonb,
  jsonb, numeric, public.seniority_level, smallint, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.save_resume_profile(uuid, text, bytea, bytea, bytea, text, text[], jsonb,
  jsonb, numeric, public.seniority_level, smallint, jsonb, jsonb)
  to service_role;
