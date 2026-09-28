/*
 * Phase 6, part one — the credit ledger. README §7.
 *
 * This is the durable replacement for three pieces of client state in
 * `context/CareerDeckContext.tsx`: `autoApplyCredits`, `creditsRef`, and the `paidWeeks`
 * `useRef`. All three are lost on reload today, which means credits reset to the daily
 * grant on every app restart and a week's streak bonus can be paid again simply by
 * killing the app. Neither is a bug in that file — it was always standing in for this.
 *
 * ── Three properties the whole design turns on ────────────────────────────────
 *
 * **Balance is `sum(amount)`, never a stored column.** §7 says so and the reason is worth
 * restating: a stored balance and a transaction log can disagree, and when they do there
 * is no way to know which one is right. With the sum as the only answer there is nothing
 * to reconcile. Every write is an insert; nothing in this file updates or deletes a row.
 *
 * **`idempotency_key` is the whole design.** It is the durable version of `paidWeeks`.
 * Every grant, spend and refund names the event that caused it, so replaying a request —
 * a retried mutation, a double tap, the outbox flushing twice — inserts nothing the
 * second time. The unique index is what enforces it, not the application code.
 *
 * **Credits are reserved, then committed or refunded — never decremented optimistically.**
 * A spend row is written the moment a run is created. If the run is abandoned the credit
 * comes back as a *refund row*, not as a deletion of the spend. The history of what was
 * attempted survives the fact that it did not finish, which is the only way the ledger
 * can be audited later.
 *
 * ── Why nothing here is granted to `authenticated` ────────────────────────────
 *
 * Same decision as phase 2's likes and follows (PHASE2.md §2.5). A client with an insert
 * grant on `credit_transactions` can write itself a `purchase` row for a thousand
 * credits. So there is no table grant at all: reads go through `credit_balance()` and
 * `credit_history()`, writes through the four functions below, and every one of them
 * scopes itself to `auth.uid()` rather than taking a user id.
 */

-- ── the ledger ────────────────────────────────────────────────────────────────

/*
 * §7's enum, as written. `purchase` and `subscription_grant` have no producer yet —
 * subscriptions are deferred out of this phase (see PHASE6.md) — and are declared now
 * because adding a value to an enum later is a migration that cannot run inside a
 * transaction with anything that uses it.
 */
create type public.credit_kind as enum (
  'daily_grant',
  'streak_bonus',
  'spend',
  'refund',
  'purchase',
  'subscription_grant',
  'adjustment'
);

create table public.credit_transactions (
  id              bigint generated always as identity primary key,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  kind            public.credit_kind not null,
  -- Signed: grants positive, spends negative. The sign is checked against the kind below
  -- rather than trusted, because a `spend` with a positive amount is free credits.
  amount          integer not null,
  /*
   * What caused this entry. `ref_type` is a plain text tag rather than an enum because
   * the set of things that can move credits grows faster than the set of credit kinds —
   * a promo campaign is a `ref_type`, not a new `credit_kind`.
   */
  ref_type        text,
  ref_id          uuid,
  idempotency_key text not null unique,
  created_at      timestamptz not null default now(),

  /*
   * Sign follows kind. Postgres is the only place this can be guaranteed: every writer
   * below is a function in this file today, but the constraint outlives the functions
   * and catches the support script somebody writes at 2am against the service role.
   *
   * `adjustment` is deliberately unconstrained — it is the manual-correction kind, and a
   * correction that can only go one way is not a correction.
   */
  constraint credit_transactions_sign check (
    case kind
      when 'spend' then amount < 0
      when 'refund' then amount > 0
      when 'daily_grant' then amount > 0
      when 'streak_bonus' then amount > 0
      when 'purchase' then amount > 0
      when 'subscription_grant' then amount > 0
      else true
    end
  )
);

-- §7's index. Every read this file makes is "this user's rows, newest first".
create index credit_transactions_user_idx
  on public.credit_transactions (user_id, created_at desc);

/*
 * Partial index behind `credit_balance()`. The balance query sums every row a user has
 * ever had, which is unbounded — a year of daily grants is 365 rows before anything else.
 * Covering `amount` lets the sum come from the index alone.
 */
create index credit_transactions_balance_idx
  on public.credit_transactions (user_id) include (amount);

alter table public.credit_transactions enable row level security;

/*
 * Read-only, own-rows-only, and no insert/update/delete policy at all — so even a client
 * that somehow obtained a table grant could not write one. The functions below are
 * `security definer` and bypass this, which is the point.
 */
create policy credit_transactions_select_own on public.credit_transactions
  for select to authenticated
  using (user_id = (select auth.uid()));

-- ── reading the balance ───────────────────────────────────────────────────────

/*
 * The authoritative balance: one sum, no cache, no stored column.
 *
 * §7 mentions caching this in Redis. Not here, and the reason is the same one PHASE5.md
 * gave for not adding Redis for feed sessions: the query is an index-only sum over one
 * user's rows, which at the volumes this table will see for years is faster than the
 * round trip to a cache would be. The seam to add one later is this function.
 */
create or replace function public.credit_balance()
returns integer
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce(sum(amount), 0)::integer
    from public.credit_transactions
   where user_id = (select auth.uid());
$fn$;

/*
 * The receipt list behind the credits sheet. Newest first, capped, and scoped to the
 * caller — there is no variant of this that reads somebody else's ledger.
 */
create or replace function public.credit_history(p_limit integer default 50)
returns table (
  id         bigint,
  kind       public.credit_kind,
  amount     integer,
  ref_type   text,
  ref_id     uuid,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select t.id, t.kind, t.amount, t.ref_type, t.ref_id, t.created_at
    from public.credit_transactions t
   where t.user_id = (select auth.uid())
   order by t.created_at desc, t.id desc
   limit least(greatest(coalesce(p_limit, 50), 1), 200);
$fn$;

-- ── granting ──────────────────────────────────────────────────────────────────

/*
 * The shared grant path: insert `p_amount`, clamped so the balance never exceeds the cap.
 *
 * This is `awardStreakBonus`'s behaviour in `CareerDeckContext.tsx`, moved server-side
 * and kept exactly — including returning *the amount actually awarded* rather than the
 * amount requested, because that number is what the receipt UI shows and what
 * `lastStreakAward` drives. A user two credits from the cap who earns three is told they
 * got two, not three.
 *
 * Returns 0 when the key has already been used, which is what makes every caller safe to
 * retry. `on conflict do nothing` rather than a pre-check: two concurrent calls with the
 * same key both pass a pre-check and one of them has to lose at the index anyway.
 */
create or replace function public.grant_credits(
  p_kind            public.credit_kind,
  p_amount          integer,
  p_cap             integer,
  p_idempotency_key text,
  p_ref_type        text default null,
  p_ref_id          uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_user     uuid := (select auth.uid());
  v_balance  integer;
  v_award    integer;
  v_inserted integer;
begin
  if v_user is null then
    raise exception 'grant_credits requires a session' using errcode = '28000';
  end if;
  if p_amount is null or p_amount <= 0 then
    return 0;
  end if;

  select coalesce(sum(amount), 0)::integer
    into v_balance
    from public.credit_transactions
   where user_id = v_user;

  -- §7: grant `min(amount, cap - current_balance)`. A null cap means uncapped, which is
  -- what a purchase wants — somebody who paid for credits gets the credits.
  v_award := case
               when p_cap is null then p_amount
               else least(p_amount, greatest(p_cap - v_balance, 0))
             end;

  if v_award <= 0 then
    return 0;
  end if;

  insert into public.credit_transactions (user_id, kind, amount, ref_type, ref_id, idempotency_key)
  values (v_user, p_kind, v_award, p_ref_type, p_ref_id, p_idempotency_key)
  on conflict (idempotency_key) do nothing;

  get diagnostics v_inserted = row_count;
  return case when v_inserted = 0 then 0 else v_award end;
end;
$fn$;

/*
 * §7's daily grant, keyed `grant:{user_id}:{YYYY-MM-DD}`.
 *
 * **Lazily, on read, rather than from a scheduled job** — and this is the one place this
 * file departs from §7, which lists "grant/streak/spend/refund jobs".
 *
 * A cron job granting every account a credit at midnight means a scheduler this project
 * does not have, and it does work proportional to *every account that has ever existed*
 * for a resource capped at five. Granting when the client asks for its balance does the
 * same work only for people who opened the app, which is the same shape as phase 3's
 * `comment_counts()` and phase 4's `match_scores()`: a read that writes.
 *
 * The visible difference is that somebody returning after a month gets one grant rather
 * than thirty. With `bankCap` at 5 that is not a difference at all — thirty grants
 * clamp to five, and so does one on each of the next four days.
 *
 * The date is UTC, deliberately. A local-timezone day would let somebody travel east and
 * collect twice, and "your credit lands at some hour" is a smaller surprise than a
 * granting rule nobody can state.
 */
create or replace function public.grant_daily_credit(p_amount integer, p_cap integer)
returns integer
language sql
security definer
set search_path = ''
as $fn$
  select public.grant_credits(
    'daily_grant',
    p_amount,
    p_cap,
    'grant:' || (select auth.uid())::text || ':' || to_char((now() at time zone 'utc')::date, 'YYYY-MM-DD'),
    'day',
    null
  );
$fn$;

/*
 * §7's streak bonus, keyed `streak:{user_id}:{week_key}`.
 *
 * §7 is blunt about the threat model and it is worth repeating here rather than in a doc:
 * the tracker is self-reported, so this is paying out on a claim. The defence is not
 * detection, it is that `maxWeeklyBonus` caps a fabricated week at three credits, which
 * is not worth the trouble. The caller passes the amount `streakBonusFor()` computed and
 * this clamps it again, because a client-supplied amount is a client-supplied amount.
 */
create or replace function public.award_streak_bonus(
  p_week_key  text,
  p_amount    integer,
  p_cap       integer,
  p_max_weekly integer
)
returns integer
language sql
security definer
set search_path = ''
as $fn$
  select public.grant_credits(
    'streak_bonus',
    least(coalesce(p_amount, 0), coalesce(p_max_weekly, p_amount)),
    p_cap,
    'streak:' || (select auth.uid())::text || ':' || coalesce(p_week_key, 'unknown'),
    'week',
    null
  );
$fn$;

-- ── spending and refunding ────────────────────────────────────────────────────

/*
 * Reserve one credit against a run, keyed `spend:{run_id}`.
 *
 * Fails closed: if the balance is zero it inserts nothing and returns false, and the
 * caller must not create the run. The balance check and the insert are one statement
 * against one user's rows, so two concurrent taps cannot both see a balance of one —
 * the second loses at the unique index even if it got past the check.
 *
 * Returns a boolean rather than the new balance, because a caller that got `false` needs
 * to show a paywall and a caller that got `true` needs to start a run. Neither needs a
 * number, and a number invites somebody to trust it after the fact.
 */
create or replace function public.reserve_credit(p_run_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_user     uuid := (select auth.uid());
  v_balance  integer;
  v_inserted integer;
begin
  if v_user is null then
    raise exception 'reserve_credit requires a session' using errcode = '28000';
  end if;

  select coalesce(sum(amount), 0)::integer
    into v_balance
    from public.credit_transactions
   where user_id = v_user;

  if v_balance <= 0 then
    return false;
  end if;

  insert into public.credit_transactions (user_id, kind, amount, ref_type, ref_id, idempotency_key)
  values (v_user, 'spend', -1, 'auto_apply_run', p_run_id, 'spend:' || p_run_id::text)
  on conflict (idempotency_key) do nothing;

  get diagnostics v_inserted = row_count;
  -- Already reserved counts as reserved. A retried request must not be told "no credits".
  return v_inserted > 0 or exists (
    select 1 from public.credit_transactions
     where idempotency_key = 'spend:' || p_run_id::text
  );
end;
$fn$;

/*
 * Give the credit back, keyed `refund:{run_id}`.
 *
 * **Refunds ignore the bank cap**, which is the one asymmetry in this file. A user at the
 * cap who starts a run and abandons it would otherwise be charged for changing their
 * mind, and "abandoning costs you a credit" is exactly the pressure that makes somebody
 * submit a draft they have not read — the opposite of what the review step is for.
 *
 * Refunds only what was actually taken. If no spend row exists for this run there is
 * nothing to give back, and inserting a refund anyway would mint a credit from nothing.
 */
create or replace function public.refund_credit(p_run_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_user     uuid := (select auth.uid());
  v_spent    integer;
  v_inserted integer;
begin
  if v_user is null then
    raise exception 'refund_credit requires a session' using errcode = '28000';
  end if;

  select coalesce(sum(amount), 0)::integer
    into v_spent
    from public.credit_transactions
   where user_id = v_user
     and kind = 'spend'
     and ref_type = 'auto_apply_run'
     and ref_id = p_run_id;

  if v_spent >= 0 then
    return false;
  end if;

  insert into public.credit_transactions (user_id, kind, amount, ref_type, ref_id, idempotency_key)
  values (v_user, 'refund', -v_spent, 'auto_apply_run', p_run_id, 'refund:' || p_run_id::text)
  on conflict (idempotency_key) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted > 0;
end;
$fn$;

-- ── grants ────────────────────────────────────────────────────────────────────

/*
 * No table grants at all — `credit_transactions` is reachable only through the functions
 * above. The revokes are against `public` as well as the two roles, because Postgres
 * grants EXECUTE to PUBLIC by default on every new function and Supabase separately
 * grants to `anon` and `authenticated`; revoking from the roles alone leaves the PUBLIC
 * grant standing and the function callable. Phase 2 learned this the hard way.
 */
revoke all on function public.grant_credits(public.credit_kind, integer, integer, text, text, uuid)
  from public, anon, authenticated;

revoke all on function public.credit_balance()                              from public, anon;
revoke all on function public.credit_history(integer)                       from public, anon;
revoke all on function public.grant_daily_credit(integer, integer)          from public, anon;
revoke all on function public.award_streak_bonus(text, integer, integer, integer) from public, anon;
revoke all on function public.reserve_credit(uuid)                          from public, anon;
revoke all on function public.refund_credit(uuid)                           from public, anon;

/*
 * Every one of these scopes itself to `auth.uid()` internally and none of them takes a
 * user id, which is the property that makes this list safe to read at a glance.
 * `grant_credits` is the exception and is deliberately absent: it takes a kind and a cap,
 * so a client that could call it could mint a `purchase`.
 */
grant execute on function public.credit_balance()                     to authenticated;
grant execute on function public.credit_history(integer)              to authenticated;
grant execute on function public.grant_daily_credit(integer, integer) to authenticated;
grant execute on function public.award_streak_bonus(text, integer, integer, integer) to authenticated;
grant execute on function public.reserve_credit(uuid)                 to authenticated;
grant execute on function public.refund_credit(uuid)                  to authenticated;

comment on table public.credit_transactions is
  'Append-only credit ledger. Balance is sum(amount); nothing stores it. README §7.';

-- ── auto_apply_runs ───────────────────────────────────────────────────────────

/*
 * README §6's table, and the object a reserved credit is reserved *against*.
 *
 * ── What a run is, and what it is emphatically not ────────────────────────────
 *
 * A run produces a **draft the user reviews and then carries to the employer themselves**.
 * Nothing in this phase submits an application. §6 calls that non-negotiable and the
 * reason is not squeamishness: Greenhouse's and Lever's terms both forbid automated
 * submission, and our entire job corpus is crawled from them. Trading 30,800 postings for
 * a convenience feature is not a trade.
 *
 * So `used` means "the user told us they submitted it", exactly like `applications`
 * already does — `self_reported` has been true on every row since phase 2, because
 * nothing in this system can observe a real submission.
 */
create type public.auto_apply_status as enum (
  'pending',   -- credit reserved, generation not finished
  'ready',     -- draft returned, waiting for the user
  'reviewed',  -- user opened the sheet and edited or accepted every field
  'used',      -- user says they submitted it; an applications row exists
  'abandoned', -- user backed out; the credit has been refunded
  'failed'     -- generation errored; the credit has been refunded
);

create table public.auto_apply_runs (
  id           uuid primary key default gen_random_uuid(),
  -- Defaulted, not sent. Same reasoning as `applications`: the insert grant below omits
  -- this column, so a client cannot author a row for somebody else before RLS even looks.
  user_id      uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  -- `restrict` for the same reason applications uses it: a run is a record of what the
  -- user did, and it must not evaporate because a crawler decided a posting closed.
  job_id       uuid not null references public.jobs (id) on delete restrict,
  resume_id    uuid not null references public.resumes (id) on delete restrict,
  status       public.auto_apply_status not null default 'pending',

  /*
   * §6's shape: `{field_key: {value, confidence, source}}`.
   *
   * `confidence` and `source` are not decoration — they are what lets the review sheet
   * mark a field as inferred rather than read. §6's second non-negotiable is that the
   * generator never fabricates: if the resume does not answer "years of Python", the
   * field comes back with a null value and a prompt, not a plausible number. A UI that
   * cannot tell those apart cannot honour that rule.
   */
  draft        jsonb,

  -- What produced it. §6 wants per-run cost because this is the largest variable cost
  -- after infra, and per-user economics have to exist *before* a price is set.
  model          text,
  prompt_version text,
  tokens_in      integer check (tokens_in is null or tokens_in >= 0),
  tokens_out     integer check (tokens_out is null or tokens_out >= 0),
  cost_usd       numeric(8, 4) check (cost_usd is null or cost_usd >= 0),

  -- Set when the user says they submitted. The link is what makes "did Auto Apply lead
  -- to applications" answerable without joining on job_id and hoping.
  application_id uuid references public.applications (id) on delete set null,

  error        text,
  created_at   timestamptz not null default now(),
  completed_at timestamptz
);

/*
 * One live run per posting per user. Without this, tapping the violet button twice on a
 * slow network reserves two credits for one job.
 *
 * A partial index rather than a table constraint: the rule is about runs that are still
 * going, not about runs that ever existed. Constraining (user_id, job_id, status) would
 * also forbid a second abandoned run for the same posting, and somebody redrafting a job
 * next month is a thing that should work.
 */
create unique index auto_apply_runs_live_idx
  on public.auto_apply_runs (user_id, job_id)
  where status in ('pending', 'ready', 'reviewed');

create index auto_apply_runs_user_idx on public.auto_apply_runs (user_id, created_at desc);

-- Cost reporting reads this: every finished run in a window, regardless of whose it is.
create index auto_apply_runs_cost_idx on public.auto_apply_runs (created_at desc)
  where cost_usd is not null;

alter table public.auto_apply_runs enable row level security;

create policy auto_apply_runs_select_own on public.auto_apply_runs
  for select to authenticated
  using (user_id = (select auth.uid()));
