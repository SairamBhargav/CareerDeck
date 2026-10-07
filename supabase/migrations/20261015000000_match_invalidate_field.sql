/*
 * Drop cached match scores when what the reader studied changes.
 *
 * Scorer v2 (20261010000000) reads the field of study from three places: the default resume's
 * education, the profile's major, and, when neither exists, onboarding's sectors. Only the resume
 * and two location preferences invalidated `job_match_scores`, so editing a major or the sectors
 * left every cached score on the old field until the posting itself changed.
 *
 * This mattered less while the Deck fetched scores in a query of its own. The Deck now fetches
 * scores with each feed page, and a page refetched after a profile edit would serve the stale
 * rows straight back.
 */

create or replace function public.preferences_invalidate_matches()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if new.preferred_locations is distinct from old.preferred_locations
     or new.open_to_remote is distinct from old.open_to_remote
     or new.preferred_industries is distinct from old.preferred_industries then
    perform public.invalidate_match_scores(new.user_id);
  end if;
  return new;
end;
$fn$;

create or replace function public.profile_invalidate_matches()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if new.major is distinct from old.major then
    perform public.invalidate_match_scores(new.id);
  end if;
  return new;
end;
$fn$;

create trigger profiles_invalidate_matches
  after update of major on public.profiles
  for each row execute function public.profile_invalidate_matches();

revoke all on function public.profile_invalidate_matches() from public, anon, authenticated;
