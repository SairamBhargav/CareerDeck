/*
 * A school address confirmed at signup *is* the `.edu` verification.
 *
 * sign-up.tsx asks for an email with the placeholder `you@school.edu`, tells the reader "a school
 * address unlocks commenting later", and then confirms that address with a six-digit emailed code
 * (`supabase.auth.verifyOtp`). That is, to the letter, the proof `verification_tier = 'edu'` asks
 * for: control of a mailbox at a known school domain, demonstrated by a code we sent there.
 *
 * It was then thrown away. `handle_auth_user_change` stamped the account `'email'`, `comment_gate`
 * requires `tier in ('edu','identity')`, and the student — who had just typed their university
 * address and read a code out of their university inbox — was told comments were locked and sent
 * to a screen asking them to type the same address and read a second code out of the same inbox.
 *
 * So the grant happens where the proof happens. The verification screen keeps its job for the case
 * it is actually for: somebody who signed up with a personal address and wants to add a school one.
 *
 * ── This weakens nothing ──────────────────────────────────────────────────────
 *
 * `start_edu_verification` / `confirm_edu_verification` establish exactly three things before they
 * grant the tier, and all three are checked here, against the same tables:
 *
 *   1. the domain is on `schools.email_domains`     — same lookup, same `citext` matching
 *   2. the credential is not on the ban blocklist   — same digest, see the note below
 *   3. no other account has verified that address   — `verifications_one_account_per_edu_email`
 *
 * What it does *not* re-do is send a code and check it, because Supabase has already done that to
 * the same address. A second code proves the same fact twice.
 *
 * The `verifications` row is written as `verified` with the same two-year `expires_at` the confirm
 * path uses, so §3.2's "`.edu` addresses die after graduation" still applies — this is a normal edu
 * verification that happened to be proved during signup, not a tier granted out of band.
 *
 * ── On the digest ─────────────────────────────────────────────────────────────
 *
 * The blocklist check recomputes the digest in SQL the way `ban_user` writes it: sha256 over
 * `'careerdeck-verification:' || address`. That is deliberate — matching the *writer* is what makes
 * the lookup find a ban.
 *
 * It is worth knowing that `ban_user` hardcodes that prefix while the service computes its own with
 * `env.verificationPepper`, so the two agree only while `VERIFICATION_PEPPER` is unset, as it is
 * today. Setting it would desynchronise `ban_user` from `start_edu_verification` as well; that is a
 * pre-existing crack and not one this file widens or can fix.
 */

/*
 * Does this account's own confirmed address earn the edu tier?
 *
 * Separate from the trigger for two reasons: the trigger body stays readable, and the backfill at
 * the bottom runs the identical code path rather than a second copy of these rules that could
 * drift from it.
 *
 * **Returns false instead of raising, always.** Its caller runs inside the signup transaction — see
 * `handle_auth_user_change`, where every statement has to be incapable of aborting a signup. A
 * student who cannot be auto-verified must still get an account; the worst outcome allowed here is
 * that they use the verification screen like anybody else.
 */
create or replace function public.grant_edu_from_signup(
  p_user_id uuid,
  p_email   text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  email  extensions.citext := lower(btrim(coalesce(p_email, '')))::extensions.citext;
  domain extensions.citext;
  school public.schools;
  hash   text;
begin
  if email::text = '' or position('@' in email::text) = 0 then
    return false;
  end if;

  domain := split_part(email::text, '@', 2)::extensions.citext;
  if domain::text = '' then
    return false;
  end if;

  -- (1) A school we know. Any other domain is simply a personal address.
  select s.* into school
    from public.schools s
   where domain = any (s.email_domains)
   limit 1;

  if school.id is null then
    return false;
  end if;

  /*
   * (2) The ban check, and the reason this function could not have been skipped.
   *
   * §10 binds escalation to the credential: "a banned user needs a new `.edu` address or a new
   * government ID to return." Granting the tier from a signup address without this would hand a
   * banned student their access back for the price of signing up again with the same inbox —
   * which is the precise thing `verification_blocklist` exists to prevent.
   */
  hash := encode(
    extensions.digest('careerdeck-verification:' || email::text, 'sha256'),
    'hex'
  );

  if exists (
    select 1 from public.verification_blocklist
     where kind = 'edu_email' and identifier_hash = hash
  ) then
    return false;
  end if;

  -- (3) One account per address, so a shared departmental alias cannot mint accounts. The partial
  -- unique index enforces it regardless; checking first keeps the insert from being the thing that
  -- discovers it.
  if exists (
    select 1 from public.verifications v
     where v.kind = 'edu_email'
       and v.status = 'verified'
       and v.edu_email = email
       and v.user_id <> p_user_id
  ) then
    return false;
  end if;

  insert into public.verifications
    (user_id, kind, status, edu_email, edu_domain, school_id, verified_at, expires_at)
  values
    (p_user_id, 'edu_email', 'verified', email, domain, school.id, now(), now() + interval '2 years')
  -- Re-running this for an account that already holds a verified edu row is a no-op, which is what
  -- makes the backfill below safe to run more than once.
  on conflict do nothing;

  /*
   * `school_id` is the *verified* link, and setting it is what produces the badge: the
   * `profiles_set_comment_badge` trigger fires on this column and builds "Major @ School '27".
   *
   * At signup time `major` and `graduation_year` are usually still null, because sign-up.tsx writes
   * them after `verifyEmailCode` resolves. That is fine — the same trigger also fires on those two
   * columns, so the badge fills itself in as the rest of the profile lands.
   *
   * `school_name_raw` is left alone on purpose. The schema calls it "what they typed at signup" and
   * it never feeds the badge, so the domain's opinion does not belong in it.
   *
   * `identity` is not a lower rung than `edu` — §3.2 makes them siblings — so an account that
   * already passed the ID check keeps that tier and simply gains the school badge.
   */
  update public.profiles
     set school_id         = coalesce(school_id, school.id),
         verification_tier = case when verification_tier = 'identity'
                              then 'identity'::public.verification_tier
                              else 'edu'::public.verification_tier end
   where id = p_user_id;

  return true;
exception
  when others then
    -- See the header: a signup must not fail because verification could not be inferred.
    return false;
end;
$fn$;

/*
 * **Not callable by a client, and this is the line that matters most in this file.**
 *
 * It takes a `user_id` and sets `verification_tier`, so an account that could reach it could verify
 * itself — or somebody else — by calling it with a hand-picked address. Phase 0 called out the same
 * hazard about letting a client PATCH its own tier. Only the trigger (`security definer`, running
 * as the owner) and the backfill below ever invoke it.
 */
revoke all on function public.grant_edu_from_signup(uuid, text) from public, anon, authenticated;

comment on function public.grant_edu_from_signup(uuid, text) is
  'Grants the edu tier when an account''s own confirmed signup address is at a known school domain, '
  'applying the same domain, blocklist and one-account-per-address rules as the code path. Returns '
  'false rather than raising, because it runs inside the signup transaction. Not client-callable.';

/*
 * Phase 3's provisioning trigger, with the grant appended.
 *
 * Reproduced in full rather than patched, because `create or replace function` has no other form.
 * Everything above `-- the school address` is phase 3's body unchanged.
 */
create or replace function public.handle_auth_user_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  meta      jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  full_name text;
  given     text;
  family    text;
begin
  full_name := nullif(btrim(coalesce(meta ->> 'full_name', meta ->> 'name', '')), '');
  given     := nullif(btrim(coalesce(meta ->> 'given_name', '')), '');
  family    := nullif(btrim(coalesce(meta ->> 'family_name', '')), '');

  if given is null and full_name is not null then
    given := nullif(split_part(full_name, ' ', 1), '');
  end if;

  if family is null and full_name is not null then
    family := nullif(btrim(substr(full_name, length(split_part(full_name, ' ', 1)) + 1)), '');
  end if;

  insert into public.profiles (id, first_name, last_name, handle)
  values (new.id, given, family, public.generate_handle())
  on conflict (id) do nothing;

  insert into public.user_preferences (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  if new.email_confirmed_at is not null then
    update public.profiles
       set verification_tier = 'email'
     where id = new.id
       and verification_tier = 'none';
  end if;

  -- the school address, if that is what it turns out to be. Runs after the `'email'` stamp above so
  -- the two cannot race over the same column, and swallows its own failures (see the function).
  if new.email_confirmed_at is not null then
    perform public.grant_edu_from_signup(new.id, new.email);
  end if;

  return new;
end;
$fn$;

/*
 * Everybody who already signed up with a school address and was told their comments were locked.
 *
 * Idempotent: the `verifications` insert conflicts away and the profile update is a no-op once the
 * tier is `edu`. Scoped to `none` and `email` so a verified or banned account is never touched —
 * and `grant_edu_from_signup` re-checks the blocklist for each one regardless, so a banned student
 * whose tier was reset cannot be restored by this loop.
 */
do $backfill$
declare
  r       record;
  granted integer := 0;
begin
  for r in
    select u.id, u.email
      from auth.users u
      join public.profiles p on p.id = u.id
     where u.email_confirmed_at is not null
       and u.email is not null
       and p.verification_tier in ('none', 'email')
  loop
    if public.grant_edu_from_signup(r.id, r.email) then
      granted := granted + 1;
    end if;
  end loop;

  raise notice 'signup-address edu grants: %', granted;
end
$backfill$;
