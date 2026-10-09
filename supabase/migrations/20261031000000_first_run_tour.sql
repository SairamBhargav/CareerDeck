/*
 * The first-run tour, and the three Auto Applies it pays (2026-10-09).
 *
 * A new account lands on a practice run of the Deck, Home and Activity before the app proper,
 * and finishing it is what pays the welcome credits. Two pieces:
 *
 *  - `profiles.tutorial_completed_at`. Null means the tour is still owed. Every account that
 *    exists today is stamped as done, so the tour is for accounts created from here on; the
 *    client gates on this column and nothing else.
 *
 *  - `complete_tour()`. Pays the bonus once per account and stamps the column, in one ledger
 *    transaction like every other grant: `lock_ledger()` first, the lazy daily grant claimed
 *    before the balance is read, and an idempotency key so a retried call, a second device or
 *    a reinstall can never pay twice.
 *
 * The bonus is an `adjustment` rather than a new `credit_kind`. A new enum value cannot be used
 * in the transaction that adds it, and this is exactly what `adjustment` is for: a grant the
 * daily and streak rules do not describe. `ref_type = 'tour'` says which one.
 *
 * It is not clipped to the plan's bank cap the way a streak bonus is. The tour promises three,
 * by name, on its last screen; a free account starts at one, so it lands at four, under the cap
 * of five either way.
 */

set lock_timeout = '10s';

alter table public.profiles add column tutorial_completed_at timestamptz;

comment on column public.profiles.tutorial_completed_at is
  'When the first-run tour was finished (and its bonus paid). Null: the tour is still owed.';

-- Accounts from before the tour existed never see it.
update public.profiles
   set tutorial_completed_at = coalesce(onboarding_completed_at, created_at, now())
 where tutorial_completed_at is null;

/*
 * `select` on profiles is a table grant, so the new column is readable by its owner already.
 * It is deliberately absent from the column-scoped `update` grant: the only way to set it is
 * through the function below, which is also the only way to be paid for it.
 */

create or replace function public.complete_tour()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  bonus     constant integer := 3;
  uid       uuid := (select auth.uid());
  born      timestamptz;
  claim_key text;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = 'CD401';
  end if;

  claim_key := format('tour:%s', uid);

  born := public.lock_ledger(uid);
  perform public.claim_daily_grant(uid, born);

  -- Stamped either way, so a client that lost the first answer still leaves the tour.
  update public.profiles
     set tutorial_completed_at = coalesce(tutorial_completed_at, now())
   where id = uid;

  if exists (select 1 from public.credit_transactions where idempotency_key = claim_key) then
    return 0;
  end if;

  insert into public.credit_transactions (user_id, kind, amount, ref_type, idempotency_key)
  values (uid, 'adjustment', bonus, 'tour', claim_key);

  return bonus;
end;
$fn$;

comment on function public.complete_tour() is
  'Finishes the first-run tour: stamps profiles.tutorial_completed_at and pays its Auto Apply bonus once. Returns what it paid (0 on a repeat).';

revoke all on function public.complete_tour() from public, anon;
grant execute on function public.complete_tour() to authenticated;
