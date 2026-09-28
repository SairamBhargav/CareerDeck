-- Phase 6 — Money and Auto Apply.
--
-- Implements docs/README.md §6 (Auto Apply), §7 (the credit ledger) and §8 (subscriptions).
-- Design and deviations: docs/PHASE6.md.
--
-- Until this file, the Auto Apply balance was a `useState` seeded with one credit, the streak
-- bonus was paid by a `useRef<Set>` that forgot every week it had paid on restart, and tapping
-- Auto Apply decremented a number and opened the same hand-off sheet a plain Apply opens. The
-- credit bought nothing. This is the phase where it buys a draft.
--
-- Four properties hold this file together:
--
--  * **Balance is a sum, never a column.** §7. Every credit that exists is a row in
--    `credit_transactions` with an idempotency key, and every write that can race another
--    takes the same per-user row lock first. There is no stored balance to drift.
--  * **Entitlements come from webhooks, never from a client claim.** §8. The app can show a
--    paywall and complete a purchase; it cannot write a single row that changes what it is
--    allowed to do. `apply_revenuecat_event()` is `service_role`-only.
--  * **Every gate reads `entitlements`, not `subscriptions`.** §8 again. The plan a reader is
--    on is derived by one function, `viewer_plan()`, and every number the plan changes —
--    daily grant, bank cap, resume shelf — lives in `plans`, not in code.
--  * **The model never sees a contact field, and a draft never stores one.** §6 + §13.2.
--    Name, email and phone are resolved from the sealed columns in the API service at read
--    time and are never written to `auto_apply_runs`. The draft a row holds is P1 data.
--
-- Phases 0–5 are untouched except in two places, both predicted by the code they replace:
-- `applications.auto_apply_run_id` (phase 2 left a comment saying it would arrive here) and
-- `register_resume`'s `max_live` (migration 20260928000000 left a comment saying it would
-- become a select "the day a plan column exists").

-- ── enums ──────────────────────────────────────────────────────────────────────

create type public.credit_kind as enum
  ('daily_grant', 'streak_bonus', 'spend', 'refund', 'purchase', 'subscription_grant', 'adjustment');

/*
 * §6's six states, verbatim. Two things about them worth knowing before reading the functions:
 *
 *  - `reviewed` is where the credit is **committed**. It means the reader has been shown every
 *    field and has been handed off to the employer's form. PHASE6.md §5.3 argues why the
 *    commit point is the hand-off and not §6's "user confirms they submitted".
 *  - `failed` and `abandoned` are the two states that refund, and each refunds at most once
 *    because the refund's idempotency key is the run id.
 */
create type public.auto_apply_status as enum
  ('pending', 'ready', 'reviewed', 'used', 'abandoned', 'failed');

-- ── plans ──────────────────────────────────────────────────────────────────────

/*
 * Every number a subscription changes, in one table.
 *
 * `constants/goal.ts` said of its own numbers: "Every number here is a guess. The point of
 * this file is that they're all in one place." This is the same idea one layer down — and the
 * same move phase 5 made with `ranking_weights`: tunable without a deploy.
 *
 * `id` doubles as the entitlement identifier. A reader is on plan `pro` exactly when they hold
 * an unexpired `entitlements` row whose `feature` is `pro` — which is also what RevenueCat calls
 * the entitlement, so the identifier configured in its dashboard, the row the webhook writes and
 * the plan the gate reads are one string. `free` is the plan of everybody with no such row.
 *
 * `rank` breaks ties if a reader somehow holds two paid entitlements (a promo and a
 * subscription to different tiers): the higher rank wins.
 */
create table public.plans (
  id                 text primary key check (id ~ '^[a-z][a-z0-9_]*$'),
  rank               smallint not null unique,
  daily_grant        smallint not null check (daily_grant >= 0),
  bank_cap           smallint not null check (bank_cap > 0),
  resume_limit       smallint not null check (resume_limit > 0),
  streak_bonus       smallint not null check (streak_bonus >= 0),
  long_streak_bonus  smallint not null check (long_streak_bonus >= 0),
  long_streak_weeks  smallint not null check (long_streak_weeks > 0),
  -- The ceiling `constants/goal.ts` calls "the number that keeps faking a week from being
  -- worth the trouble". Enforced here as well, so a mistyped long_streak_bonus cannot lift it.
  max_weekly_bonus   smallint not null check (max_weekly_bonus >= 0),
  notes              text
);

insert into public.plans
  (id, rank, daily_grant, bank_cap, resume_limit, streak_bonus, long_streak_bonus,
   long_streak_weeks, max_weekly_bonus, notes)
values
  ('free', 0, 1, 5, 3, 1, 2, 4, 3,
   'constants/goal.ts''s AUTO_APPLY_ECONOMY and constants/limits.ts''s FREE_RESUME_LIMIT, moved server-side.'),
  ('pro', 1, 5, 25, 10, 1, 2, 4, 3,
   'Five a day, a bank of five days, and the shelf phase 4 originally allowed. Priced only after cost_usd has real data behind it (§6).');

comment on table public.plans is
  'Every number a plan changes. `id` is also the entitlement identifier that selects it.';

-- ── the ledger ─────────────────────────────────────────────────────────────────

/*
 * §7, with one column added and one constraint made explicit.
 *
 * `grant_period` is the added column. The daily grant is claimed lazily (PHASE6.md §3.1) and
 * counts 24-hour periods since the account was created rather than calendar dates, so the key
 * is `grant:{user}:{period}` rather than §7's `grant:{user}:{YYYY-MM-DD}`. Storing the period
 * as an integer as well as inside the key lets the next claim find "the last period paid" with
 * a max() rather than by parsing strings.
 *
 * The sign check is the explicit constraint. §7 says "signed: grants positive, spends negative"
 * and a ledger whose whole integrity is a sum should not rely on every writer remembering that.
 * Grants may be **zero**: a grant swallowed by a full bank is still recorded, because the next
 * claim has to know that period was consumed — otherwise a reader who sat at the cap for ten
 * days would be paid all ten the moment they spent down. §3.1.
 */
create table public.credit_transactions (
  id              bigint generated always as identity primary key,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  kind            public.credit_kind not null,
  amount          integer not null,
  ref_type        text,
  ref_id          uuid,
  grant_period    integer,
  idempotency_key text not null unique,
  created_at      timestamptz not null default now(),

  constraint credit_transactions_sign check (
    case kind
      when 'spend'              then amount < 0
      when 'refund'             then amount > 0
      when 'purchase'           then amount > 0
      when 'daily_grant'        then amount >= 0
      when 'streak_bonus'       then amount >= 0
      when 'subscription_grant' then amount >= 0
      else true                 -- 'adjustment': support can move a balance either way
    end
  ),
  constraint credit_transactions_period check ((kind = 'daily_grant') = (grant_period is not null))
);

create index credit_transactions_user_idx on public.credit_transactions (user_id, created_at desc);
-- The claim's "last period paid" lookup.
create index credit_transactions_grant_idx on public.credit_transactions (user_id, grant_period desc)
  where kind = 'daily_grant';

comment on table public.credit_transactions is
  'The Auto Apply credit ledger (§7). Balance is sum(amount); nothing stores it.';

-- ── subscriptions and entitlements ─────────────────────────────────────────────

/*
 * §8's table, with `provider` widened. RevenueCat reports the store the purchase came through
 * and §8's two-value check would reject a Stripe purchase or a promotional grant made from
 * RevenueCat's dashboard at the database, turning a support action into a webhook 500.
 *
 * `last_event_at` is the out-of-order guard. RevenueCat does not promise delivery order, and a
 * RENEWAL retried after an EXPIRATION would otherwise resurrect a lapsed subscription.
 */
create table public.subscriptions (
  user_id                 uuid primary key references public.profiles (id) on delete cascade,
  provider                text not null check (provider in
                            ('app_store', 'mac_app_store', 'play_store', 'amazon', 'stripe',
                             'rc_billing', 'promotional', 'test_store', 'other')),
  product_id              text not null,
  tier                    text not null references public.plans (id),
  status                  text not null check (status in
                            ('active', 'grace', 'on_hold', 'paused', 'expired', 'refunded')),
  original_transaction_id text not null,
  period_end              timestamptz,
  auto_renew              boolean,
  environment             text not null default 'production' check (environment in ('production', 'sandbox')),
  revenuecat_id           text,
  last_event_at           timestamptz not null,
  updated_at              timestamptz not null default now()
);

/*
 * §8's table, verbatim apart from the foreign key's absence on `feature`.
 *
 * `feature` is not a reference to `plans` on purpose: §8 names features that are not plans
 * (`advanced_filters`, `early_access`), and a promo that grants one of those must not need a
 * plan row to exist. `viewer_plan()` joins the two and ignores entitlements that name no plan.
 */
create table public.entitlements (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  feature    text not null,
  value      jsonb not null default '{}',
  source     text not null check (source in ('subscription', 'promo', 'grandfathered')),
  expires_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, feature)
);

/*
 * Every webhook delivery, kept.
 *
 * Two jobs. The primary key is RevenueCat's event id, so a redelivered event is a no-op by
 * construction — the same idempotency §7 gets from its keys. And when somebody writes in to
 * say "I paid and nothing happened", this table is the only record of what the store actually
 * told us, including the deliveries that matched no account.
 */
create table public.billing_events (
  id           text primary key,
  type         text not null,
  app_user_id  text,
  user_id      uuid references public.profiles (id) on delete set null,
  outcome      text,
  payload      jsonb not null,
  received_at  timestamptz not null default now()
);

create index billing_events_user_idx on public.billing_events (user_id, received_at desc);

-- ── auto apply runs ────────────────────────────────────────────────────────────

/*
 * §6's table, plus the columns the flow turned out to need.
 *
 *  - `form_source` / `form` — the questions the draft answers, and where they came from.
 *    Greenhouse publishes each posting's real form; every other host gets a standard set.
 *    Stored because a draft is meaningless without the questions it answers, and because
 *    Greenhouse can change a form after the draft was made.
 *  - `edited_fields` — which keys the reader changed during review. The content is not kept
 *    (a reviewed answer can contain anything the reader typed); the *fact* of an edit is, and
 *    it is the accuracy measure for the drafter the way `raw_parse` is for the parser.
 *  - `error` — why a run failed, for the reader and for whoever reads the logs.
 *
 * **What is not here:** a name, an email address or a phone number. `draft` holds a
 * placeholder with `source: "contact"` for each, and the API service resolves them from
 * `resume_profiles`' sealed columns every time a run is read. PHASE6.md §5.2.
 */
create table public.auto_apply_runs (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles (id) on delete cascade,
  job_id         uuid not null references public.jobs (id) on delete cascade,
  resume_id      uuid not null references public.resumes (id),
  status         public.auto_apply_status not null default 'pending',
  form_source    text check (form_source in ('greenhouse', 'standard')),
  form           jsonb,
  draft          jsonb,
  edited_fields  text[],
  model          text,
  prompt_version text,
  tokens_in      integer,
  tokens_out     integer,
  cost_usd       numeric(8,4),
  error          text,
  created_at     timestamptz not null default now(),
  reviewed_at    timestamptz,
  completed_at   timestamptz
);

create index auto_apply_runs_user_idx on public.auto_apply_runs (user_id, created_at desc);
/*
 * One live run per reader per posting. Tapping Auto Apply twice, or tapping it on a posting
 * whose draft is sitting reviewed-but-unconfirmed, resumes that run instead of charging again.
 * Same partial-unique device as `resumes.is_default`.
 */
create unique index auto_apply_runs_live_idx on public.auto_apply_runs (user_id, job_id)
  where status in ('pending', 'ready', 'reviewed');
-- The sweep's scan.
create index auto_apply_runs_open_idx on public.auto_apply_runs (created_at)
  where status in ('pending', 'ready');

-- Phase 2's promised column. `set null`, not cascade: an application outlives its draft.
alter table public.applications
  add column auto_apply_run_id uuid references public.auto_apply_runs (id) on delete set null;

-- ── internals ──────────────────────────────────────────────────────────────────

/*
 * The plan a reader is on right now: the highest-ranked plan they hold an unexpired
 * entitlement for, or `free`.
 *
 * This is the only place the answer is computed. §8: "Every gate checks `entitlements`, not
 * `subscriptions`" — so a promo, a grandfathered account and a paying subscriber are the same
 * row shape here, and none of them needs a special case anywhere downstream.
 */
create or replace function public.viewer_plan(p_user_id uuid)
returns public.plans
language sql
stable
security definer
set search_path = ''
as $fn$
  select p.*
    from public.plans p
   where p.id = 'free'
      or exists (
        select 1 from public.entitlements e
         where e.user_id = p_user_id
           and e.feature = p.id
           and (e.expires_at is null or e.expires_at > now())
      )
   order by p.rank desc
   limit 1;
$fn$;

create or replace function public.credit_balance(p_user_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce(sum(amount), 0)::integer
    from public.credit_transactions
   where user_id = p_user_id;
$fn$;

/*
 * Serializes every ledger write for one reader.
 *
 * A balance that is a sum is only as good as the guarantee that two writers never both read
 * it before either inserts. The profile row is the natural lock: it exists for every reader,
 * it is one row, and nothing hot writes to it. Every function below that writes the ledger
 * takes this lock before it reads the balance.
 */
create or replace function public.lock_ledger(p_user_id uuid)
returns timestamptz
language sql
volatile
security definer
set search_path = ''
as $fn$
  select created_at from public.profiles where id = p_user_id for update;
$fn$;

/*
 * The 24-hour period a reader is in, counted from the moment their account was created.
 *
 * Periods rather than dates so that "one a day" needs no timezone: a UTC date would hand a
 * student in California their credit at 5pm, and a client-supplied date is a lever for
 * claiming tomorrow's today. PHASE6.md §3.1.
 */
create or replace function public.grant_period_at(p_created_at timestamptz, p_at timestamptz)
returns integer
language sql
immutable
set search_path = ''
as $fn$
  select floor(extract(epoch from (p_at - p_created_at)) / 86400)::integer;
$fn$;

/*
 * Pays any daily grant that is due, and returns what it paid.
 *
 * Lazy: nothing runs at midnight. Every function that reads or spends the balance calls this
 * first, under the ledger lock, so from the ledger's point of view no time passes between
 * claims — and that is what makes a lazy grant pay exactly what a nightly job would have.
 * A reader two credits below the cap who is away for ten days comes back to the cap, not to
 * twelve; a reader who was *at* the cap comes back to the cap and the ten periods are
 * recorded as consumed. PHASE6.md §3.1 walks through why both of those are the nightly job's
 * answer too.
 *
 * Caller must hold `lock_ledger(p_user_id)`.
 */
create or replace function public.claim_daily_grant(p_user_id uuid, p_created_at timestamptz)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  plan    public.plans := public.viewer_plan(p_user_id);
  period  integer := public.grant_period_at(p_created_at, now());
  last    integer;
  missed  integer;
  balance integer;
  grant_amount integer;
begin
  select max(grant_period) into last
    from public.credit_transactions
   where user_id = p_user_id and kind = 'daily_grant';

  if last is not null and last >= period then
    return 0;
  end if;

  missed  := case when last is null then 1 else period - last end;
  balance := public.credit_balance(p_user_id);
  grant_amount := greatest(0, least(missed * plan.daily_grant, plan.bank_cap - balance));

  insert into public.credit_transactions (user_id, kind, amount, grant_period, idempotency_key)
  values (p_user_id, 'daily_grant', grant_amount, period, format('grant:%s:%s', p_user_id, period))
  on conflict (idempotency_key) do nothing;

  return grant_amount;
end;
$fn$;

/* How many applications a reader logged in the week starting `p_week_start`. */
create or replace function public.applications_in_week(p_user_id uuid, p_week_start date)
returns integer
language sql
stable
security definer
set search_path = ''
as $fn$
  select count(*)::integer
    from public.applications
   where user_id = p_user_id
     and applied_at >= p_week_start
     and applied_at <  p_week_start + 7;
$fn$;

-- ── what a reader can call ─────────────────────────────────────────────────────

create type public.credit_summary as (
  balance        integer,
  plan           text,
  daily_grant    integer,
  bank_cap       integer,
  resume_limit   integer,
  next_grant_at  timestamptz,
  granted_now    integer
);

/*
 * §11's `GET /v1/me/credits`: balance and next grant time — and, because the grant is lazy,
 * the call that pays today's.
 *
 * Volatile, and a write, on purpose. A read that claims is the entire mechanism: the app asks
 * for its balance when it opens, and that is when "one a day" happens. `granted_now` lets the
 * UI say so.
 */
create or replace function public.my_credits()
returns public.credit_summary
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  uid     uuid := (select auth.uid());
  born    timestamptz;
  granted integer;
  plan    public.plans;
  result  public.credit_summary;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = 'CD401';
  end if;

  born := public.lock_ledger(uid);
  if born is null then
    raise exception 'no profile for this account' using errcode = 'CD401';
  end if;

  granted := public.claim_daily_grant(uid, born);
  plan    := public.viewer_plan(uid);

  result.balance       := public.credit_balance(uid);
  result.plan          := plan.id;
  result.daily_grant   := plan.daily_grant;
  result.bank_cap      := plan.bank_cap;
  result.resume_limit  := plan.resume_limit;
  result.next_grant_at := born + make_interval(days => public.grant_period_at(born, now()) + 1);
  result.granted_now   := granted;
  return result;
end;
$fn$;

comment on function public.my_credits() is
  'Balance, plan numbers and next grant time. Claims any daily grant that is due — it is a write.';

create type public.streak_award as (
  week_start   date,
  awarded      integer,
  earned       integer,
  streak_weeks integer,
  outcome      text      -- 'paid' | 'already_paid' | 'not_met' | 'held'
);

/*
 * §7: "The streak bonus must be paid server-side."
 *
 * The client says which week; the server decides whether it was met and what it is worth,
 * from the tracker it holds. The client's `awardStreakBonus(weekKey, amount)` passed an amount,
 * and that argument does not survive the move — a client that can name the amount can name 3.
 *
 * `earned` is what the week was worth and `awarded` is what fit under the bank cap, the
 * distinction `lastStreakAward` exists to render: "a full bank can pay less than a week was
 * worth and only the ledger knows the difference".
 *
 * The anomaly check is §7's "20 applications logged in 90 seconds", taken literally. A held
 * week is not rejected forever — the key is not written, so a support adjustment or a later
 * rule change can pay it. It is just not paid automatically.
 */
create or replace function public.claim_streak_bonus(p_week_start date)
returns public.streak_award
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  uid     uuid := (select auth.uid());
  born    timestamptz;
  plan    public.plans;
  goal    integer;
  streak  integer := 1;
  back    integer;
  burst   integer;
  earned  integer;
  balance integer;
  paid    integer;
  claim_key text;
  result  public.streak_award;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = 'CD401';
  end if;

  if p_week_start is null or extract(isodow from p_week_start) <> 1 then
    raise exception 'a week starts on a Monday' using errcode = '22023';
  end if;

  /*
   * Only this week and the last two. The upper bound allows a day of slack because the week
   * key is the reader's local Monday and `current_date` is UTC's; the lower bound is so a
   * reader cannot walk back through a year of weeks they never claimed at the time.
   */
  if p_week_start > current_date + 1 or p_week_start < current_date - 21 then
    raise exception 'that week cannot be claimed' using errcode = '22023';
  end if;

  result.week_start := p_week_start;
  claim_key := format('streak:%s:%s', uid, p_week_start);

  born := public.lock_ledger(uid);
  perform public.claim_daily_grant(uid, born);

  select amount into paid from public.credit_transactions where idempotency_key = claim_key;
  if found then
    result.awarded := paid;
    result.earned  := paid;
    result.outcome := 'already_paid';
    return result;
  end if;

  select weekly_goal into goal from public.user_preferences where user_id = uid;
  goal := coalesce(goal, 7);

  if public.applications_in_week(uid, p_week_start) < goal then
    result.awarded := 0;
    result.earned  := 0;
    result.outcome := 'not_met';
    return result;
  end if;

  select coalesce(max(n), 0) into burst from (
    select count(*) over (order by created_at
                          range between interval '90 seconds' preceding and current row) as n
      from public.applications
     where user_id = uid
       and applied_at >= p_week_start and applied_at < p_week_start + 7
  ) windows;

  if burst >= 20 then
    result.awarded := 0;
    result.earned  := 0;
    result.outcome := 'held';
    return result;
  end if;

  -- Consecutive met weeks before this one. Bounded, like the client's walk, by a year.
  for back in 1..52 loop
    exit when public.applications_in_week(uid, p_week_start - back * 7) < goal;
    streak := streak + 1;
  end loop;

  plan   := public.viewer_plan(uid);
  earned := least(
    case when streak >= plan.long_streak_weeks then plan.long_streak_bonus else plan.streak_bonus end,
    plan.max_weekly_bonus
  );
  balance := public.credit_balance(uid);
  paid    := greatest(0, least(earned, plan.bank_cap - balance));

  insert into public.credit_transactions (user_id, kind, amount, idempotency_key)
  values (uid, 'streak_bonus', paid, claim_key);

  result.awarded      := paid;
  result.earned       := earned;
  result.streak_weeks := streak;
  result.outcome      := 'paid';
  return result;
end;
$fn$;

-- ── auto apply: the service's half ─────────────────────────────────────────────

create type public.auto_apply_start as (
  run_id  uuid,
  status  public.auto_apply_status,
  charged boolean,
  balance integer
);

/*
 * §6's first two steps: "reserve a credit (atomic; fails closed if balance is 0)" and
 * "create auto_apply_runs row (status: pending)".
 *
 * The reservation **is** the spend row. §6 says credits are "reserved then committed or
 * refunded — never decremented optimistically", and the cleanest ledger form of that is: the
 * reservation writes `spend:{run}` at −1, commitment writes nothing, and a refund writes
 * `refund:{run}` at +1. The balance is right at every instant, and there is no third
 * "reserved" state for a sum to get wrong.
 *
 * `service_role` only. A reader cannot start a run without the service, because a run without
 * a draft is a credit spent on nothing — the service is what guarantees a draft follows or a
 * refund does.
 */
create or replace function public.start_auto_apply(
  p_user_id   uuid,
  p_job_id    uuid,
  p_resume_id uuid default null
)
returns public.auto_apply_start
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  born     timestamptz;
  existing public.auto_apply_runs;
  resume   uuid := p_resume_id;
  parsed   public.resume_parse_status;
  new_id   uuid;
  result   public.auto_apply_start;
begin
  born := public.lock_ledger(p_user_id);
  if born is null then
    raise exception 'no profile for this account' using errcode = 'CD401';
  end if;

  -- A live run for this posting is resumed, never charged twice.
  select * into existing from public.auto_apply_runs
   where user_id = p_user_id and job_id = p_job_id
     and status in ('pending', 'ready', 'reviewed');
  if found then
    result.run_id  := existing.id;
    result.status  := existing.status;
    result.charged := false;
    result.balance := public.credit_balance(p_user_id);
    return result;
  end if;

  if not exists (select 1 from public.jobs where id = p_job_id and status = 'open') then
    raise exception 'this posting is no longer open' using errcode = 'CD021';
  end if;

  if exists (select 1 from public.applications where user_id = p_user_id and job_id = p_job_id) then
    raise exception 'this one is already in your tracker' using errcode = 'CD023';
  end if;

  if resume is null then
    select id into resume from public.resumes
     where user_id = p_user_id and is_default and deleted_at is null;
  end if;

  select parse_status into parsed from public.resumes
   where id = resume and user_id = p_user_id and deleted_at is null;

  if parsed is null then
    raise exception 'add a resume first — Auto Apply fills the form from it' using errcode = 'CD022';
  elsif parsed <> 'parsed' then
    raise exception 'that resume has not finished reading yet' using errcode = 'CD022';
  end if;

  perform public.claim_daily_grant(p_user_id, born);

  if public.credit_balance(p_user_id) <= 0 then
    raise exception 'no Auto Applies left' using errcode = 'CD020';
  end if;

  insert into public.auto_apply_runs (user_id, job_id, resume_id)
  values (p_user_id, p_job_id, resume)
  returning id into new_id;

  insert into public.credit_transactions (user_id, kind, amount, ref_type, ref_id, idempotency_key)
  values (p_user_id, 'spend', -1, 'auto_apply_run', new_id, format('spend:%s', new_id));

  result.run_id  := new_id;
  result.status  := 'pending';
  result.charged := true;
  result.balance := public.credit_balance(p_user_id);
  return result;
end;
$fn$;

/* Refunds a run, at most once. Caller must hold the ledger lock. */
create or replace function public.refund_auto_apply(p_run public.auto_apply_runs)
returns void
language sql
volatile
security definer
set search_path = ''
as $fn$
  insert into public.credit_transactions (user_id, kind, amount, ref_type, ref_id, idempotency_key)
  select p_run.user_id, 'refund', 1, 'auto_apply_run', p_run.id, format('refund:%s', p_run.id)
   where exists (select 1 from public.credit_transactions
                  where idempotency_key = format('spend:%s', p_run.id))
  on conflict (idempotency_key) do nothing;
$fn$;

/*
 * The draft landed. `pending` → `ready`.
 *
 * Cost is recorded whatever the run's status, and that is deliberate: a reader who abandons
 * while the model is still writing has cost the model call all the same, and §6's rule is
 * "Cost per run is logged" — not "cost per run that finished".
 */
create or replace function public.save_auto_apply_draft(
  p_run_id         uuid,
  p_form_source    text,
  p_form           jsonb,
  p_draft          jsonb,
  p_model          text,
  p_prompt_version text,
  p_tokens_in      integer,
  p_tokens_out     integer,
  p_cost_usd       numeric
)
returns public.auto_apply_status
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  next_status public.auto_apply_status;
begin
  update public.auto_apply_runs
     set form_source    = p_form_source,
         form           = p_form,
         draft          = case when status = 'pending' then p_draft else draft end,
         model          = p_model,
         prompt_version = p_prompt_version,
         tokens_in      = p_tokens_in,
         tokens_out     = p_tokens_out,
         cost_usd       = p_cost_usd,
         status         = case when status = 'pending' then 'ready'::public.auto_apply_status else status end
   where id = p_run_id
  returning status into next_status;

  if next_status is null then
    raise exception 'no such run' using errcode = '23503';
  end if;
  return next_status;
end;
$fn$;

/*
 * The draft did not land. `pending` → `failed`, and the credit comes back.
 *
 * Token counts are optional because a failure can happen on either side of the model call —
 * a form fetch that fails costs nothing, a model refusal costs its input.
 */
create or replace function public.fail_auto_apply(
  p_run_id     uuid,
  p_reason     text,
  p_model      text default null,
  p_tokens_in  integer default null,
  p_tokens_out integer default null,
  p_cost_usd   numeric default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  run public.auto_apply_runs;
begin
  select * into run from public.auto_apply_runs where id = p_run_id;
  if not found then
    raise exception 'no such run' using errcode = '23503';
  end if;

  perform public.lock_ledger(run.user_id);

  update public.auto_apply_runs
     set status     = case when status = 'pending' then 'failed'::public.auto_apply_status else status end,
         error      = left(p_reason, 500),
         model      = coalesce(p_model, model),
         tokens_in  = coalesce(p_tokens_in, tokens_in),
         tokens_out = coalesce(p_tokens_out, tokens_out),
         cost_usd   = coalesce(p_cost_usd, cost_usd)
   where id = p_run_id
  returning * into run;

  if run.status = 'failed' then
    perform public.refund_auto_apply(run);
  end if;
end;
$fn$;

-- ── auto apply: the reader's half ──────────────────────────────────────────────
--
-- Review, complete and abandon need no secret and no model, so they are RPCs the app calls
-- straight to Postgres — phase 1's decision B, applied as it always has been. Only starting
-- a run (a model) and reading one (the sealed contact fields) go through the service.

create or replace function public.owned_run(p_run_id uuid)
returns public.auto_apply_runs
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  uid uuid := (select auth.uid());
  run public.auto_apply_runs;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = 'CD401';
  end if;

  select * into run from public.auto_apply_runs where id = p_run_id and user_id = uid;
  if not found then
    -- Not 403: whether somebody else's run id exists is not this caller's business.
    raise exception 'no such run' using errcode = 'CD024';
  end if;
  return run;
end;
$fn$;

/*
 * §6: "user reviews and edits EVERY field in a sheet". `ready` → `reviewed`, and the credit
 * is committed.
 *
 * `p_seen` must cover every key in the draft. A client can lie about that, and nothing here
 * pretends otherwise — this is a durable record that the product showed every field, in the
 * same spirit as `content_policy_accepted_at`. What it does catch is the honest bug: a sheet
 * that stopped rendering one field type would otherwise commit a credit on a draft the reader
 * never saw in full, and nobody would notice.
 */
create or replace function public.review_auto_apply(
  p_run_id uuid,
  p_seen   text[],
  p_edited text[] default '{}'
)
returns public.auto_apply_status
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  run     public.auto_apply_runs := public.owned_run(p_run_id);
  missing text[];
begin
  if run.status in ('reviewed', 'used') then
    return run.status;  -- a retried hand-off is the same hand-off
  end if;

  if run.status <> 'ready' then
    raise exception 'this draft is not ready for review' using errcode = 'CD025';
  end if;

  select coalesce(array_agg(k), '{}') into missing
    from jsonb_object_keys(coalesce(run.draft -> 'fields', '{}')) k
   where k <> all (coalesce(p_seen, '{}'));

  if cardinality(missing) > 0 then
    raise exception 'every field has to be reviewed (% not shown)', cardinality(missing)
      using errcode = 'CD026';
  end if;

  update public.auto_apply_runs
     set status        = 'reviewed',
         reviewed_at   = now(),
         edited_fields = (select coalesce(array_agg(distinct e), '{}')
                            from unnest(coalesce(p_edited, '{}')) e
                           where run.draft -> 'fields' ? e)
   where id = run.id;

  return 'reviewed';
end;
$fn$;

/*
 * §6: "user confirms they submitted → applications row". `reviewed` → `used`.
 *
 * Writes the tracker row itself rather than asking the client to make a second call, so a
 * run marked used always has an application behind it. `p_applied_on` is the reader's local
 * date, for the same reason `applications.applied_at` has always taken one from the client:
 * the weekly goal is counted in the reader's week. It is checked to within a day of the
 * server's, which is the most any timezone can differ.
 */
create or replace function public.complete_auto_apply(
  p_run_id     uuid,
  p_applied_on date default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  run     public.auto_apply_runs := public.owned_run(p_run_id);
  on_date date := coalesce(p_applied_on, current_date);
  host    text;
  app_source public.application_source;
  app_id  uuid;
begin
  if run.status = 'used' then
    select id into app_id from public.applications where auto_apply_run_id = run.id;
    return app_id;
  end if;

  if run.status <> 'reviewed' then
    raise exception 'review the draft before marking it applied' using errcode = 'CD025';
  end if;

  if on_date not between current_date - 1 and current_date + 1 then
    raise exception 'that is not today' using errcode = '22023';
  end if;

  select apply_host into host from public.jobs where id = run.job_id;
  app_source := case when host in ('greenhouse', 'workday', 'lever', 'ashby')
                 then host::public.application_source
                 else 'company'::public.application_source end;

  insert into public.applications (user_id, job_id, source, applied_at, auto_apply_run_id)
  values (run.user_id, run.job_id, app_source, on_date, run.id)
  on conflict (user_id, job_id) do update
     set auto_apply_run_id = coalesce(public.applications.auto_apply_run_id, excluded.auto_apply_run_id)
  returning id into app_id;

  update public.auto_apply_runs
     set status = 'used', completed_at = now()
   where id = run.id;

  return app_id;
end;
$fn$;

/*
 * §6: "user abandons → credit refunded (a ledger entry, not a decrement)".
 *
 * Refunds only before the hand-off. After it the reader has the draft's answers on their
 * clipboard and the employer's form open, which is exactly what the credit bought; PHASE6.md
 * §5.3. Abandoning a reviewed run is still allowed — it closes the run so a later Auto Apply
 * on the same posting starts fresh — it just returns nothing.
 */
create or replace function public.abandon_auto_apply(p_run_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  run      public.auto_apply_runs := public.owned_run(p_run_id);
  refunded boolean := false;
begin
  if run.status in ('abandoned', 'failed', 'used') then
    return false;
  end if;

  perform public.lock_ledger(run.user_id);

  if run.status in ('pending', 'ready') then
    perform public.refund_auto_apply(run);
    refunded := true;
  end if;

  update public.auto_apply_runs
     set status = 'abandoned', completed_at = now()
   where id = run.id;

  return refunded;
end;
$fn$;

-- ── billing ────────────────────────────────────────────────────────────────────

/*
 * §8: "Entitlements are derived from webhooks, never from a client claim."
 *
 * One RevenueCat event in, the subscription and entitlements it implies out, in one
 * transaction. The API service only authenticates the delivery and forwards it; every rule is
 * here, for the same reason `post_comment()` and `save_resume_profile()` hold theirs — a bug in
 * the service can drop an event, never invent one.
 *
 * The rules, most important first:
 *
 *  - **Redelivery is a no-op.** The event id is `billing_events`' primary key.
 *  - **Order is not trusted.** An event older than the last one applied to a reader is logged
 *    and ignored; a retried RENEWAL must not resurrect an EXPIRATION.
 *  - **A lapse never deletes.** §8: "A lapsed subscription downgrades entitlements but never
 *    deletes data." An expiry sets `expires_at`; the entitlement row, the subscription row and
 *    every application, resume and credit stay. Over-limit resumes stay on the shelf too — the
 *    limit only stops a new one being added.
 *  - **Promotions outrank billing.** A `promo` or `grandfathered` entitlement is never
 *    overwritten or expired by a store event.
 */
create or replace function public.apply_revenuecat_event(p_event jsonb)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  event_id    text := p_event ->> 'id';
  event_type  text := upper(coalesce(p_event ->> 'type', ''));
  event_at    timestamptz;
  expires     timestamptz;
  uid         uuid;
  candidate   text;
  current_sub public.subscriptions;
  store       text;
  next_status text;
  renews      boolean;
  product     text;
  plan_id     text;
  features    text[];
  feat        text;
  born        timestamptz;
  pro         public.plans;
  balance     integer;
  result_outcome text;
begin
  if event_id is null or event_id = '' then
    raise exception 'an event has an id' using errcode = '22023';
  end if;

  insert into public.billing_events (id, type, app_user_id, payload)
  values (event_id, event_type, p_event ->> 'app_user_id', p_event)
  on conflict (id) do nothing;
  if not found then
    return 'duplicate';
  end if;

  if event_type = 'TEST' then
    update public.billing_events set outcome = 'ignored' where id = event_id;
    return 'ignored';
  end if;

  event_at := to_timestamp(coalesce((p_event ->> 'event_timestamp_ms')::bigint,
                                    (extract(epoch from now()) * 1000)::bigint) / 1000.0);

  /*
   * TRANSFER moves a purchase between app user ids (a restore on a second account). It
   * carries no product, so it moves what the source account holds rather than deriving
   * anything.
   */
  if event_type = 'TRANSFER' then
    select p.id into uid from public.profiles p
     where p.id::text in (select jsonb_array_elements_text(coalesce(p_event -> 'transferred_to', '[]')))
     limit 1;

    if uid is null then
      update public.billing_events set outcome = 'unmatched' where id = event_id;
      return 'unmatched';
    end if;

    update public.subscriptions s set user_id = uid, updated_at = now()
     where s.user_id::text in (select jsonb_array_elements_text(coalesce(p_event -> 'transferred_from', '[]')))
       and not exists (select 1 from public.subscriptions t where t.user_id = uid);

    delete from public.entitlements e
     where e.user_id = uid and e.source = 'subscription'
       and exists (select 1 from public.entitlements f
                    where f.feature = e.feature and f.source = 'subscription'
                      and f.user_id::text in (select jsonb_array_elements_text(coalesce(p_event -> 'transferred_from', '[]'))));

    update public.entitlements e set user_id = uid, updated_at = now()
     where e.source = 'subscription'
       and e.user_id::text in (select jsonb_array_elements_text(coalesce(p_event -> 'transferred_from', '[]')))
       and not exists (select 1 from public.entitlements g where g.user_id = uid and g.feature = e.feature);

    update public.billing_events set user_id = uid, outcome = 'transferred' where id = event_id;
    return 'transferred';
  end if;

  /*
   * Which account. The app logs in to RevenueCat with the Supabase user id, so `app_user_id`
   * is normally it — but a purchase made before login is filed under an anonymous id and
   * aliased later, so every id RevenueCat knows this customer by is tried.
   */
  for candidate in
    select v from (
      select p_event ->> 'app_user_id' as v
      union all select p_event ->> 'original_app_user_id'
      union all select jsonb_array_elements_text(coalesce(p_event -> 'aliases', '[]'))
    ) ids where v ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  loop
    select id into uid from public.profiles where id = candidate::uuid;
    exit when uid is not null;
  end loop;

  if uid is null then
    update public.billing_events set outcome = 'unmatched' where id = event_id;
    return 'unmatched';
  end if;

  select * into current_sub from public.subscriptions where user_id = uid;
  if found and current_sub.last_event_at > event_at then
    update public.billing_events set user_id = uid, outcome = 'stale' where id = event_id;
    return 'stale';
  end if;

  expires := case when p_event ? 'expiration_at_ms' and p_event ->> 'expiration_at_ms' is not null
                  then to_timestamp((p_event ->> 'expiration_at_ms')::bigint / 1000.0) end;
  product := coalesce(nullif(p_event ->> 'new_product_id', ''), p_event ->> 'product_id', current_sub.product_id, 'unknown');
  store   := lower(coalesce(p_event ->> 'store', 'other'));
  if store not in ('app_store', 'mac_app_store', 'play_store', 'amazon', 'stripe',
                   'rc_billing', 'promotional', 'test_store') then
    store := 'other';
  end if;

  features := coalesce(
    (select array_agg(x) from jsonb_array_elements_text(p_event -> 'entitlement_ids') x),
    case when p_event ->> 'entitlement_id' is not null then array[p_event ->> 'entitlement_id'] end,
    '{}'
  );

  case event_type
    when 'INITIAL_PURCHASE', 'RENEWAL', 'UNCANCELLATION', 'PRODUCT_CHANGE',
         'SUBSCRIPTION_EXTENDED', 'TEMPORARY_ENTITLEMENT_GRANT' then
      next_status := 'active';  renews := true;
    when 'NON_RENEWING_PURCHASE' then
      next_status := 'active';  renews := false;
    when 'CANCELLATION' then
      /*
       * Two different things share this event. Turning off auto-renew keeps access to the
       * end of the paid period; a refund ends it now. RevenueCat marks the refund with
       * CUSTOMER_SUPPORT, and its expiration is already in the past.
       */
      if p_event ->> 'cancel_reason' = 'CUSTOMER_SUPPORT' then
        next_status := 'refunded';
        expires := least(coalesce(expires, event_at), event_at);
      else
        next_status := coalesce(current_sub.status, 'active');
      end if;
      renews := false;
    when 'BILLING_ISSUE' then
      next_status := 'grace';    renews := coalesce(current_sub.auto_renew, true);
    when 'SUBSCRIPTION_PAUSED' then
      next_status := 'paused';   renews := false;
    when 'EXPIRATION' then
      next_status := 'expired';  renews := false;
      expires := least(coalesce(expires, event_at), event_at);
    else
      update public.billing_events set user_id = uid, outcome = 'ignored' where id = event_id;
      return 'ignored';
  end case;

  -- The tier is the highest-ranked plan among the entitlements this purchase unlocks.
  select p.id into plan_id from public.plans p
   where p.id = any (features) order by p.rank desc limit 1;
  plan_id := coalesce(plan_id, current_sub.tier, 'free');

  insert into public.subscriptions as s
    (user_id, provider, product_id, tier, status, original_transaction_id, period_end,
     auto_renew, environment, revenuecat_id, last_event_at, updated_at)
  values
    (uid, store, product, plan_id, next_status,
     coalesce(p_event ->> 'original_transaction_id', p_event ->> 'transaction_id', event_id),
     expires, renews,
     case when upper(coalesce(p_event ->> 'environment', '')) = 'SANDBOX' then 'sandbox' else 'production' end,
     p_event ->> 'original_app_user_id', event_at, now())
  on conflict (user_id) do update
     set provider                = excluded.provider,
         product_id              = excluded.product_id,
         tier                    = excluded.tier,
         status                  = excluded.status,
         original_transaction_id = excluded.original_transaction_id,
         period_end              = excluded.period_end,
         auto_renew              = excluded.auto_renew,
         environment             = excluded.environment,
         revenuecat_id           = excluded.revenuecat_id,
         last_event_at           = excluded.last_event_at,
         updated_at              = now();

  foreach feat in array features loop
    insert into public.entitlements as e (user_id, feature, source, expires_at, updated_at)
    values (uid, feat, 'subscription', expires, now())
    on conflict (user_id, feature) do update
       set expires_at = excluded.expires_at, updated_at = now()
     where e.source = 'subscription';
  end loop;

  -- An ending event with no entitlement list still ends every subscription entitlement.
  if next_status in ('expired', 'refunded') and cardinality(features) = 0 then
    update public.entitlements
       set expires_at = least(coalesce(expires_at, expires), expires), updated_at = now()
     where user_id = uid and source = 'subscription';
  end if;

  /*
   * A new subscriber gets a day of their new plan immediately. Without this, the grant for
   * the current period has already been claimed at the free rate and a reader who has just
   * paid sees nothing change until tomorrow. Once per original transaction, capped like
   * every grant.
   */
  result_outcome := lower(event_type);
  if event_type = 'INITIAL_PURCHASE' and next_status = 'active' then
    born := public.lock_ledger(uid);
    perform public.claim_daily_grant(uid, born);
    pro := public.viewer_plan(uid);
    balance := public.credit_balance(uid);

    insert into public.credit_transactions (user_id, kind, amount, ref_type, idempotency_key)
    values (uid, 'subscription_grant', greatest(0, least(pro.daily_grant, pro.bank_cap - balance)),
            'subscription',
            format('subgrant:%s:%s', uid,
                   coalesce(p_event ->> 'original_transaction_id', p_event ->> 'transaction_id', event_id)))
    on conflict (idempotency_key) do nothing;
  end if;

  update public.billing_events set user_id = uid, outcome = result_outcome where id = event_id;
  return result_outcome;
end;
$fn$;

-- ── the resume shelf reads its plan ────────────────────────────────────────────
--
-- Migration 20260928000000, verbatim, except for the one line it said would change:
-- "Becomes a per-plan select the day a plan column exists."

create or replace function public.register_resume(
  p_name         text,
  p_storage_path text,
  p_file_size    integer default null,
  p_content_hash text default null,
  p_focus        text default null
)
returns public.resume_card
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  uid      uuid := (select auth.uid());
  new_id   uuid;
  is_first boolean;
  card     public.resume_card;
  max_live integer;
  live     integer;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = 'CD401';
  end if;

  if p_storage_path is null or p_storage_path not like (uid::text || '/%') then
    raise exception 'a resume must be stored under its owner' using errcode = 'CD010';
  end if;

  max_live := (public.viewer_plan(uid)).resume_limit;

  select count(*) into live
    from public.resumes
   where user_id = uid and deleted_at is null;

  if live >= max_live then
    raise exception 'you can keep % resumes at once. Delete one to add another.', max_live
      using errcode = 'CD011';
  end if;

  select not exists (
    select 1 from public.resumes where user_id = uid and deleted_at is null
  ) into is_first;

  insert into public.resumes (user_id, name, focus, storage_path, file_size, content_hash,
                              is_default, parse_status)
  values (uid, btrim(p_name), nullif(btrim(coalesce(p_focus, '')), ''), p_storage_path,
          p_file_size, nullif(btrim(coalesce(p_content_hash, '')), ''), is_first, 'pending')
  returning id into new_id;

  if is_first then
    perform public.invalidate_match_scores(uid);
  end if;

  select * into card from public.my_resumes() c where c.id = new_id;
  return card;
end;
$fn$;

-- ── operations ─────────────────────────────────────────────────────────────────

/*
 * Closes runs nobody finished, for `scripts/maintain.mjs`.
 *
 *  - `pending` for longer than `p_stuck_minutes`: the service died mid-draft. Failed, refunded.
 *  - `ready` for longer than `p_ready_days`: a draft the reader never opened. Abandoned,
 *    refunded — they never used what the credit bought.
 *
 * `reviewed` runs are left alone at any age. The credit is committed, and the reader may still
 * come back to say they applied; a run is the only link from the tracker row to its draft.
 */
create or replace function public.expire_auto_apply_runs(
  p_ready_days    integer default 7,
  p_stuck_minutes integer default 15
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  run   public.auto_apply_runs;
  total integer := 0;
begin
  for run in
    select * from public.auto_apply_runs
     where (status = 'pending' and created_at < now() - make_interval(mins => p_stuck_minutes))
        or (status = 'ready'   and created_at < now() - make_interval(days => p_ready_days))
     order by created_at
  loop
    perform public.lock_ledger(run.user_id);

    update public.auto_apply_runs
       set status       = case when status = 'pending' then 'failed'::public.auto_apply_status
                               else 'abandoned'::public.auto_apply_status end,
           error        = case when status = 'pending' then 'The draft never finished.' else error end,
           completed_at = now()
     where id = run.id and status in ('pending', 'ready');

    if found then
      perform public.refund_auto_apply(run);
      total := total + 1;
    end if;
  end loop;

  return total;
end;
$fn$;

-- ── grants ─────────────────────────────────────────────────────────────────────
--
-- | table                 | a reader can select            | a reader can write           |
-- |-----------------------|--------------------------------|------------------------------|
-- | `plans`               | all rows — they are the prices | nothing                      |
-- | `credit_transactions` | own rows — their receipts      | nothing; functions only      |
-- | `entitlements`        | own rows                       | nothing, ever — §8           |
-- | `subscriptions`       | own row, minus store ids       | nothing, ever — §8           |
-- | `billing_events`      | **nobody**                     | nothing                      |
-- | `auto_apply_runs`     | **nobody** — through the API   | functions only               |
--
-- `auto_apply_runs` is unreadable for the reason `resumes` is: a run is only meaningful
-- with its contact fields resolved, which only the service can do, and a second read path
-- that returns the same row with holes in it is a second thing to keep correct.

alter table public.plans               enable row level security;
alter table public.credit_transactions enable row level security;
alter table public.entitlements        enable row level security;
alter table public.subscriptions       enable row level security;
alter table public.billing_events      enable row level security;
alter table public.auto_apply_runs     enable row level security;

revoke all on public.plans               from anon, authenticated;
revoke all on public.credit_transactions from anon, authenticated;
revoke all on public.entitlements        from anon, authenticated;
revoke all on public.subscriptions       from anon, authenticated;
revoke all on public.billing_events      from anon, authenticated;
revoke all on public.auto_apply_runs     from anon, authenticated;

grant select on public.plans to authenticated;
create policy plans_select_all on public.plans for select to authenticated using (true);

grant select (id, kind, amount, ref_type, ref_id, created_at) on public.credit_transactions to authenticated;
create policy credit_transactions_select_own on public.credit_transactions
  for select to authenticated using (user_id = (select auth.uid()));

grant select (feature, value, source, expires_at) on public.entitlements to authenticated;
create policy entitlements_select_own on public.entitlements
  for select to authenticated using (user_id = (select auth.uid()));

grant select (provider, product_id, tier, status, period_end, auto_renew, updated_at)
  on public.subscriptions to authenticated;
create policy subscriptions_select_own on public.subscriptions
  for select to authenticated using (user_id = (select auth.uid()));

-- Internals and the service's half: nobody but service_role. Both PUBLIC and the roles are
-- revoked, because two different default grants are in play (phase 2's note on this).
revoke all on function public.viewer_plan(uuid)                          from public, anon, authenticated;
revoke all on function public.credit_balance(uuid)                       from public, anon, authenticated;
revoke all on function public.lock_ledger(uuid)                          from public, anon, authenticated;
revoke all on function public.grant_period_at(timestamptz, timestamptz)  from public, anon, authenticated;
revoke all on function public.claim_daily_grant(uuid, timestamptz)       from public, anon, authenticated;
revoke all on function public.applications_in_week(uuid, date)           from public, anon, authenticated;
revoke all on function public.start_auto_apply(uuid, uuid, uuid)         from public, anon, authenticated;
revoke all on function public.refund_auto_apply(public.auto_apply_runs)  from public, anon, authenticated;
revoke all on function public.save_auto_apply_draft(uuid, text, jsonb, jsonb, text, text, integer, integer, numeric)
                                                                         from public, anon, authenticated;
revoke all on function public.fail_auto_apply(uuid, text, text, integer, integer, numeric)
                                                                         from public, anon, authenticated;
revoke all on function public.owned_run(uuid)                            from public, anon, authenticated;
revoke all on function public.apply_revenuecat_event(jsonb)              from public, anon, authenticated;
revoke all on function public.expire_auto_apply_runs(integer, integer)   from public, anon, authenticated;

-- A reader's own calls.
revoke all on function public.my_credits()                               from public, anon;
revoke all on function public.claim_streak_bonus(date)                   from public, anon;
revoke all on function public.review_auto_apply(uuid, text[], text[])    from public, anon;
revoke all on function public.complete_auto_apply(uuid, date)            from public, anon;
revoke all on function public.abandon_auto_apply(uuid)                   from public, anon;

grant execute on function public.my_credits()                            to authenticated;
grant execute on function public.claim_streak_bonus(date)                to authenticated;
grant execute on function public.review_auto_apply(uuid, text[], text[]) to authenticated;
grant execute on function public.complete_auto_apply(uuid, date)         to authenticated;
grant execute on function public.abandon_auto_apply(uuid)                to authenticated;
