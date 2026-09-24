-- Phase 2 — Interactions and tracking.
--
-- Implements docs/README.md §3.5 (the interaction graph), §3.6 (impressions) and §3.7
-- (applications). Design and deviations: docs/PHASE2.md.
--
-- Everything here is *what the user did*. Phase 0 established who they are, phase 1
-- established what there is to look at, and until now every like, save, follow and
-- tracked application lived in a React state hook that a cold start threw away.
--
-- Nothing in phase 1 is altered. `jobs`, `companies` and the read API are untouched, and
-- `feed_jobs` still returns the shared entity with no viewer fields on it — §1.3(a) is
-- explicit that a feed row must stay cacheable and identical for every reader. The
-- viewer's half of the envelope is served by `viewer_state()` below, as one small read
-- per session rather than a per-viewer assembly of every page.

-- ── enums ──────────────────────────────────────────────────────────────────────

/*
 * §3.5. One table with a `kind` discriminator rather than likes/saves/hides tables:
 * identical shape, identical access pattern, and the ranking engine wants to read all of
 * them together.
 *
 * `hide` and `not_interested` have no UI yet. They are in the enum because they are the
 * cheapest negative signal there is and adding an enum value later means a migration
 * that cannot run inside a transaction with anything that uses it.
 */
create type public.interaction_kind as enum ('like', 'save', 'hide', 'not_interested');

-- §3.7. Deliberately coarse: an OA, a recruiter screen and an onsite are all `interview`,
-- because the user maintains this by hand and a longer list is a longer chore. Mirrors
-- ApplicationStatus in types/application.ts.
create type public.application_status as enum ('applied', 'interview', 'offer', 'closed');

-- Where the application was actually submitted. CareerDeck hands off to the employer's
-- ATS and cannot post on anyone's behalf, so this records where the user went.
create type public.application_source as enum ('greenhouse', 'workday', 'lever', 'ashby', 'company');

-- §3.6. Which surface showed the card. 'story' has no job attached yet (news is phase 7)
-- but the enum is the same one that table will use.
create type public.feed_surface as enum ('reels', 'home', 'search', 'company', 'collection', 'story');

-- ── company_follows ────────────────────────────────────────────────────────────

create table public.company_follows (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, company_id)
);

-- The primary key serves "what do I follow"; this serves "who follows this company",
-- which is what the reconcile pass and any future follower list reads.
create index company_follows_company_idx on public.company_follows (company_id);

/*
 * `companies.follower_count` is denormalized (§3.5) because the suggestion rail renders it
 * on every card. Counting live would be a scan over the largest join table in the system
 * for a number that is decorative.
 *
 * security definer because the follower count is not the follower's to write: an
 * authenticated user has no update grant on `companies`, and this trigger is the only
 * thing that moves the number.
 */
create or replace function public.sync_follower_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.companies
       set follower_count = follower_count + 1
     where id = new.company_id;
    return new;
  else
    -- greatest(...) rather than a bare subtraction: a count that has drifted below the
    -- truth must not be able to go negative and render as "-1 followers".
    update public.companies
       set follower_count = greatest(follower_count - 1, 0)
     where id = old.company_id;
    return old;
  end if;
end;
$$;

create trigger company_follows_sync_count
  after insert or delete on public.company_follows
  for each row execute function public.sync_follower_count();

-- ── job_interactions ───────────────────────────────────────────────────────────

create table public.job_interactions (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  job_id     uuid not null references public.jobs (id) on delete cascade,
  kind       public.interaction_kind not null,
  created_at timestamptz not null default now(),
  primary key (user_id, job_id, kind)
);

-- "Everything I saved, newest first" — the Saved and Liked collections.
create index job_interactions_user_kind_idx on public.job_interactions (user_id, kind, created_at desc);
-- "Who liked this posting" — the signal side, for phase 5's ranker.
create index job_interactions_job_kind_idx on public.job_interactions (job_id, kind);

-- ── applications ───────────────────────────────────────────────────────────────

create table public.applications (
  id                uuid primary key default gen_random_uuid(),
  -- Defaulted rather than sent. The insert grant below does not include this column, so
  -- a client physically cannot author a row for somebody else even before RLS looks.
  user_id           uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  -- §3.7: `restrict`, not `cascade`. A user's application history must not evaporate
  -- because a crawler decided a posting was gone. Jobs are closed, never deleted.
  job_id            uuid not null references public.jobs (id) on delete restrict,
  status            public.application_status not null default 'applied',
  source            public.application_source not null,
  applied_at        date not null default current_date,
  status_changed_at timestamptz not null default now(),
  -- Always true today: nothing can observe a real submission, so the tracker is
  -- self-reported by construction. Not writable by the client — see the grants.
  self_reported     boolean not null default true,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- §3.7: enforces at the database what logApplication did with a `.some()` check.
  -- Re-applying to something already tracked is the same application, not a second one.
  unique (user_id, job_id)
);

-- Phase 6 adds `auto_apply_run_id uuid references auto_apply_runs(id)`. §3.7 lists it
-- here, but `auto_apply_runs` is phase 6's table and §15 is explicit: don't build phase
-- N+1's schema during phase N. A nullable FK column is a one-line migration when it has
-- something to point at.

-- The tracker's own list: everything the viewer has, most recent activity first.
create index applications_user_activity_idx on public.applications (user_id, status_changed_at desc);
-- The weekly goal counts by `applied_at` over a rolling window of weeks.
create index applications_user_applied_idx on public.applications (user_id, applied_at desc);
create index applications_job_idx on public.applications (job_id);

create table public.application_events (
  id             bigint generated always as identity primary key,
  application_id uuid not null references public.applications (id) on delete cascade,
  from_status    public.application_status,
  to_status      public.application_status not null,
  created_at     timestamptz not null default now()
);

create index application_events_application_idx
  on public.application_events (application_id, created_at desc);

/*
 * §3.7: history, so "how long until you heard back" is answerable later and a disputed
 * streak can be audited.
 *
 * Written by a trigger rather than by the client, for the reason most audit trails are:
 * a client that has to remember to write the event row is a client that will eventually
 * forget, and the gap is invisible until someone asks a question of the data.
 *
 * security definer because `authenticated` has no insert grant on `application_events` —
 * the trigger is the only writer, which is what makes the trail trustworthy.
 */
create or replace function public.record_application_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.application_events (application_id, from_status, to_status)
    values (new.id, null, new.status);
  elsif new.status is distinct from old.status then
    insert into public.application_events (application_id, from_status, to_status)
    values (new.id, old.status, new.status);
  end if;

  return new;
end;
$$;

/* Stamped here rather than accepted from the client, so "last activity" means what the
 * database saw and not what a device's clock claimed. */
create or replace function public.stamp_status_changed_at()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status then
    new.status_changed_at := now();
  end if;
  return new;
end;
$$;

create trigger applications_stamp_status
  before update on public.applications
  for each row execute function public.stamp_status_changed_at();

create trigger applications_set_updated_at
  before update on public.applications
  for each row execute function public.set_updated_at();

create trigger applications_record_event
  after insert or update of status on public.applications
  for each row execute function public.record_application_event();

-- ── job_impressions ────────────────────────────────────────────────────────────

/*
 * §3.6 — the highest-volume table in the system, and the one that buys a phase 3 ranker.
 * If it isn't logged from day one there is nothing to train on later.
 *
 * Three deliberate departures from §3.6's sketch, all in the same direction:
 *
 *  - **No foreign keys.** `user_id` and `job_id` are bare uuids. An FK is a lookup on
 *    every insert on a table taking ~3M rows a day, in exchange for referential tidiness
 *    on data nothing reads in a request path. The join is done at analysis time against
 *    whatever still exists.
 *  - **No key of any kind, not even a surrogate id.** A unique index on a partitioned
 *    table has to include the partition key, so a primary key would cost an index per
 *    partition to enforce a property nobody asks about — nothing looks a row up by id,
 *    and a row is identified for debugging by (user, session, job, shown_at) anyway.
 *    Dropping the identity column also drops a single shared sequence from the write path
 *    of the busiest table in the system, and eight bytes from three million rows a day.
 *  - **One index**, `(user_id, shown_at desc)`, which is what a seen-penalty in phase 5
 *    and any per-user debugging both read. Indexes here are paid for on every insert.
 *
 * Partitioned monthly and dropped at 13 months (§13.2 retention). Partitions are created
 * ahead by `ensure_impression_partitions()`, which the nightly maintenance job calls.
 */
create table public.job_impressions (
  user_id    uuid not null,
  job_id     uuid not null,
  surface    public.feed_surface not null,
  -- One per app launch, generated on the client. It is what makes "impressions per
  -- session" and "position within this session's feed" answerable.
  session_id uuid not null,
  -- Rank within the feed when it was shown. smallint: a feed nobody scrolls 32,767 cards
  -- into does not need more, and the two bytes are paid 3M times a day.
  position   smallint,
  -- Reels only: how long the card was the active page. §3.6 calls this the strongest
  -- implicit signal there is, and the reason a Reels-style UI is worth the trouble.
  dwell_ms   integer,
  -- Scrolled past (true) vs. bounced back (false). Null where the surface cannot tell.
  completed  boolean,
  shown_at   timestamptz not null default now()
) partition by range (shown_at);

create index job_impressions_user_idx on public.job_impressions (user_id, shown_at desc);

/*
 * Creates this month's partition and the next `p_months_ahead`, skipping any that exist.
 *
 * A partitioned table with no partition for `now()` rejects every insert, and the failure
 * arrives at midnight on the first of a month. So this runs nightly *and* the default
 * partition below catches anything that still falls through — a device with a badly wrong
 * clock, or a month that arrived before the maintenance job did.
 *
 * security definer: only the service role calls it, and creating a table is not a
 * privilege the calling role should need to hold.
 */
create or replace function public.ensure_impression_partitions(p_months_ahead integer default 3)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  month_start date := date_trunc('month', now())::date;
  offset_months integer;
  starts   date;
  ends     date;
  part     text;
  created  integer := 0;
begin
  for offset_months in 0 .. greatest(coalesce(p_months_ahead, 3), 0) loop
    starts := (month_start + (offset_months || ' months')::interval)::date;
    ends   := (starts + interval '1 month')::date;
    part   := 'job_impressions_' || to_char(starts, 'YYYY_MM');

    if to_regclass('public.' || part) is null then
      execute format(
        'create table public.%I partition of public.job_impressions for values from (%L) to (%L)',
        part, starts, ends);
      created := created + 1;
    end if;
  end loop;

  return created;
end;
$$;

/*
 * §13.2: impressions are kept 13 months, then aggregated. Dropping a partition is the
 * only way to delete at this volume that does not leave the table needing a vacuum it
 * will never get.
 *
 * Never touches the default partition, and never drops a partition whose range has not
 * fully passed — the `ends` check is what stops a mis-set `p_keep_months` deleting the
 * month that is currently being written.
 */
create or replace function public.drop_old_impression_partitions(p_keep_months integer default 13)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  cutoff  date := (date_trunc('month', now()) - (greatest(coalesce(p_keep_months, 13), 1) || ' months')::interval)::date;
  part    record;
  starts  date;
  dropped integer := 0;
begin
  for part in
    select c.relname
      from pg_class c
      join pg_inherits i on i.inhrelid = c.oid
      join pg_class p on p.oid = i.inhparent
     where p.relname = 'job_impressions'
       and c.relname ~ '^job_impressions_[0-9]{4}_[0-9]{2}$'
  loop
    starts := to_date(right(part.relname, 7), 'YYYY_MM');
    if starts + interval '1 month' <= cutoff then
      execute format('drop table public.%I', part.relname);
      dropped := dropped + 1;
    end if;
  end loop;

  return dropped;
end;
$$;

-- This month and the next three, so a fresh database can log from the first launch.
select public.ensure_impression_partitions(3);

/*
 * The catch-all.
 *
 * Without it, an insert whose `shown_at` falls outside every range fails, and the client
 * flushing a buffer it queued before midnight on a month boundary is exactly that case.
 * The cost is that attaching a new partition has to scan the default for rows that belong
 * in it — which is cheap precisely because this partition should stay near-empty, and a
 * row landing here is itself worth noticing.
 */
create table public.job_impressions_default partition of public.job_impressions default;

-- ── read API ───────────────────────────────────────────────────────────────────

/*
 * The viewer half of the `{job, viewer}` envelope — §1.3(a).
 *
 * This is the phase 2 decision that took the most argument, and PHASE2.md §3 has the
 * long version. In short: the alternative was adding `viewer_liked` / `viewer_saved`
 * columns to `job_card` and filling them in `feed_jobs`, which reads well until you
 * notice it makes every feed response per-viewer — the precise thing §1.3(a) says not to
 * do, and the reason the envelope has two halves at all.
 *
 * So the viewer's relationships travel as one small read, once per session, and the
 * client merges them onto whatever pages it happens to hold. The sets are the same shape
 * the context already kept in memory, so the merge in useJobFeeds.ts does not change —
 * only where the sets come from.
 *
 * Bounded by `limit` per set rather than paginated. Two thousand saved postings is far
 * past any real user and still only ~72KB of uuids; a reader who somehow passes it loses
 * the oldest entries from their collections and nothing else. If that ever stops being
 * true the answer is per-page viewer decoration, not a bigger number here.
 */
create type public.viewer_sets as (
  liked_job_ids          uuid[],
  saved_job_ids          uuid[],
  hidden_job_ids         uuid[],
  followed_company_ids   uuid[],
  followed_company_slugs text[]
);

create or replace function public.viewer_state(p_limit integer default 2000)
returns public.viewer_sets
language sql
stable
as $$
  select
    array(select i.job_id from public.job_interactions i
           where i.user_id = (select auth.uid()) and i.kind = 'like'
           order by i.created_at desc limit p_limit),
    array(select i.job_id from public.job_interactions i
           where i.user_id = (select auth.uid()) and i.kind = 'save'
           order by i.created_at desc limit p_limit),
    array(select i.job_id from public.job_interactions i
           where i.user_id = (select auth.uid()) and i.kind = 'hide'
           order by i.created_at desc limit p_limit),
    array(select f.company_id from public.company_follows f
           where f.user_id = (select auth.uid())
           order by f.created_at desc limit p_limit),
    -- Slugs as well as ids because that is what the Following feed filters on
    -- (`feed_jobs(p_company_slugs)`) and what every route segment carries. §1.3(c).
    array(select c.slug::text from public.company_follows f
            join public.companies c on c.id = f.company_id
           where f.user_id = (select auth.uid())
           order by f.created_at desc limit p_limit);
$$;

-- ── write API ──────────────────────────────────────────────────────────────────

/*
 * Toggles are set-to-a-state, never flip-what-is-there.
 *
 * §11: "Toggles are PUT/DELETE (idempotent by construction) rather than POST /toggle, so
 * a retry on a flaky connection can't invert the state — the failure mode where a user's
 * save silently un-saves itself." That matters more here than it does over HTTP, because
 * the offline outbox in lib/outbox.ts replays these, and a replay is a retry by another
 * name.
 *
 * security definer so `user_id` is the session's and not the argument's. `authenticated`
 * is granted execute on these functions and nothing else — no insert or delete grant on
 * either table — which makes this the only write path there is.
 */
create or replace function public.set_job_interaction(
  p_job_id uuid,
  p_kind   public.interaction_kind,
  p_on     boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then
    raise exception 'set_job_interaction requires an authenticated user' using errcode = '28000';
  end if;

  if p_on then
    insert into public.job_interactions (user_id, job_id, kind)
    values (uid, p_job_id, p_kind)
    on conflict (user_id, job_id, kind) do nothing;
  else
    delete from public.job_interactions
     where user_id = uid and job_id = p_job_id and kind = p_kind;
  end if;

  -- The resulting state, not what was asked for. They are the same unless the row was
  -- removed underneath us, and a caller reconciling its cache wants the truth.
  return exists (
    select 1 from public.job_interactions
     where user_id = uid and job_id = p_job_id and kind = p_kind
  );
end;
$$;

/*
 * Keyed by slug rather than uuid, which is a change from §3.5's "phase 2 keys on the
 * uuid". The table does key on the uuid; the *argument* is the slug, because the slug is
 * what every caller already holds — a route segment, a news item's company, the
 * `p_company_slugs` filter the Following feed sends — and resolving it here is one join
 * against a few hundred rows rather than a directory lookup the client has to have
 * loaded first.
 */
create or replace function public.set_company_follow(
  p_company_slug text,
  p_on           boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  cid uuid;
begin
  if uid is null then
    raise exception 'set_company_follow requires an authenticated user' using errcode = '28000';
  end if;

  select c.id into cid
    from public.companies c
   where c.slug = p_company_slug::extensions.citext;

  if cid is null then
    raise exception 'no company with slug %', p_company_slug using errcode = '23503';
  end if;

  if p_on then
    insert into public.company_follows (user_id, company_id)
    values (uid, cid)
    on conflict (user_id, company_id) do nothing;
  else
    delete from public.company_follows where user_id = uid and company_id = cid;
  end if;

  return exists (select 1 from public.company_follows where user_id = uid and company_id = cid);
end;
$$;

/*
 * The impression batch — §3.6's `POST /v1/events`, as one RPC.
 *
 * "Never one request per card. The client buffers impressions in memory, flushes on a
 * 10-second timer / 25-item batch / app backgrounding, to a single POST that does one
 * multi-row insert. At 50k DAU and ~60 cards a session this is ~3M rows/day — entirely
 * fine for partitioned Postgres, catastrophic as 3M HTTP requests."
 *
 * `user_id` is the session's, never the payload's. `shown_at` is the client's, because
 * the whole point of buffering is that the row is written some seconds after the event
 * happened — but it is clamped to a window around now(), so a device with a wrong clock
 * cannot write rows into next year or into a partition that has been dropped.
 *
 * Rows beyond `max_rows` are dropped rather than rejected. A client bug that buffers
 * without bound should lose impressions, not lose the user's likes behind a failing
 * queue.
 */
create or replace function public.log_impressions(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid      uuid    := (select auth.uid());
  max_rows integer := 200;
  written  integer := 0;
begin
  if uid is null then
    raise exception 'log_impressions requires an authenticated user' using errcode = '28000';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    return 0;
  end if;

  insert into public.job_impressions
    (user_id, job_id, surface, session_id, position, dwell_ms, completed, shown_at)
  select
    uid,
    (e.item ->> 'job_id')::uuid,
    (e.item ->> 'surface')::public.feed_surface,
    (e.item ->> 'session_id')::uuid,
    nullif(e.item ->> 'position', '')::smallint,
    -- Clamped: a dwell of eleven hours is a phone left on a table, and left unbounded it
    -- would dominate every average the signal is used in.
    case when nullif(e.item ->> 'dwell_ms', '') is null then null
         else least(greatest((e.item ->> 'dwell_ms')::integer, 0), 600000) end,
    nullif(e.item ->> 'completed', '')::boolean,
    least(
      greatest(
        coalesce(nullif(e.item ->> 'shown_at', '')::timestamptz, now()),
        now() - interval '7 days'),
      now())
  from jsonb_array_elements(p_rows) with ordinality as e(item, ord)
  where e.ord <= max_rows
    and e.item ->> 'job_id' is not null
    and e.item ->> 'session_id' is not null
    and e.item ->> 'surface' is not null;

  get diagnostics written = row_count;
  return written;
end;
$$;

-- ── operational functions (service role only) ──────────────────────────────────

/*
 * §3.5: "maintained by a trigger, reconciled nightly". The trigger is exact under normal
 * operation; this exists because a denormalized counter that is never checked is a
 * denormalized counter that is eventually wrong, and nothing else in the system would
 * notice.
 */
create or replace function public.reconcile_follower_counts()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  corrected integer;
begin
  with truth as (
    select c.id, count(f.user_id)::integer as real_count
      from public.companies c
      left join public.company_follows f on f.company_id = c.id
     group by c.id
  )
  update public.companies c
     set follower_count = truth.real_count
    from truth
   where truth.id = c.id
     and c.follower_count is distinct from truth.real_count;

  get diagnostics corrected = row_count;
  return corrected;
end;
$$;

-- ── authorization ──────────────────────────────────────────────────────────────

/*
 * Every table here is user-scoped, which is the case RLS was built for. The shape from
 * §13.1 — `for all using (user_id = auth.uid())` — is the read half; the write half is
 * deliberately narrower than that.
 *
 * Likes, saves and follows have **no** insert or delete grant at all. They are written
 * only through set_job_interaction() and set_company_follow(), so there is exactly one
 * code path that can create one, it is idempotent, and it cannot be handed a user_id.
 *
 * Applications are written directly, because an insert that returns the created row is
 * worth more there than a single entry point — but the column grants stop a client from
 * authoring `user_id`, `self_reported`, `status_changed_at` or the timestamps. The three
 * things that make an application trustworthy are the three things it cannot set.
 */

alter table public.company_follows    enable row level security;
alter table public.job_interactions   enable row level security;
alter table public.applications       enable row level security;
alter table public.application_events enable row level security;
alter table public.job_impressions    enable row level security;

revoke all on public.company_follows    from anon, authenticated;
revoke all on public.job_interactions   from anon, authenticated;
revoke all on public.applications       from anon, authenticated;
revoke all on public.application_events from anon, authenticated;
revoke all on public.job_impressions    from anon, authenticated;

-- follows and interactions: read your own, write through the functions

grant select on public.company_follows  to authenticated;
grant select on public.job_interactions to authenticated;

create policy company_follows_select_own on public.company_follows
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy job_interactions_select_own on public.job_interactions
  for select to authenticated
  using ((select auth.uid()) = user_id);

-- applications: read and write your own, but only the columns that are yours to write

grant select on public.applications to authenticated;
grant insert (job_id, status, source, applied_at, notes) on public.applications to authenticated;
grant update (status, notes) on public.applications to authenticated;

create policy applications_select_own on public.applications
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy applications_insert_own on public.applications
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy applications_update_own on public.applications
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- No delete grant. Nothing in the UI removes a tracked application, and the weekly goal
-- and streak are derived from this table — a delete path arrives with the screen that
-- needs one, along with whatever the streak should do about it.

grant select on public.application_events to authenticated;

create policy application_events_select_own on public.application_events
  for select to authenticated
  using (exists (
    select 1 from public.applications a
     where a.id = application_id and a.user_id = (select auth.uid())
  ));

/*
 * Impressions are write-only from the client's side: `log_impressions` is the insert
 * path, and there is no select grant and no select policy, so a reader cannot page
 * through their own behavioural log — let alone anyone else's. §13.2 classes this P2, and
 * analysis runs as the service role.
 *
 * RLS is still enabled with no policy at all, which denies everything. That is the state
 * this table should be in: a future grant added by accident still hits a locked door.
 */

-- functions

/*
 * Revoked from `public` **and** from the named roles, which is belt and braces on
 * purpose, because two different default grants are in play and neither revoke covers
 * the other.
 *
 * PostgreSQL grants EXECUTE on every new function to PUBLIC. Supabase, separately, sets
 * `alter default privileges ... grant all on functions to anon, authenticated,
 * service_role`, which is a direct grant to each role. Revoking from PUBLIC leaves the
 * direct grants standing; revoking from the roles leaves the PUBLIC grant standing. Only
 * doing both actually closes the door.
 *
 * That matters more here than it did in phase 1: the write functions above are
 * `security definer`, so they run with the privileges of the role that owns them rather
 * than the caller's. A definer function reachable by `anon` is a hole straight through
 * RLS — which is also why each one starts by refusing a null `auth.uid()`.
 *
 * `service_role` is deliberately left alone on the maintenance functions: the nightly
 * job runs as it.
 */

revoke all on function public.ensure_impression_partitions(integer)   from public, anon, authenticated;
revoke all on function public.drop_old_impression_partitions(integer) from public, anon, authenticated;
revoke all on function public.reconcile_follower_counts()             from public, anon, authenticated;
revoke all on function public.sync_follower_count()                   from public, anon, authenticated;
revoke all on function public.record_application_event()              from public, anon, authenticated;
revoke all on function public.stamp_status_changed_at()               from public, anon, authenticated;

-- Signed out there is no viewer, nothing to follow and nothing to log.
revoke all on function public.viewer_state(integer)                                       from public, anon;
revoke all on function public.set_job_interaction(uuid, public.interaction_kind, boolean) from public, anon;
revoke all on function public.set_company_follow(text, boolean)                           from public, anon;
revoke all on function public.log_impressions(jsonb)                                      from public, anon;

grant execute on function public.viewer_state(integer)                                       to authenticated;
grant execute on function public.set_job_interaction(uuid, public.interaction_kind, boolean) to authenticated;
grant execute on function public.set_company_follow(text, boolean)                           to authenticated;
grant execute on function public.log_impressions(jsonb)                                      to authenticated;

/*
 * The PUBLIC half of the same fix, applied backwards to phase 1.
 *
 * `20260922000000_phase1_jobs.sql` revokes its operational functions from `anon,
 * authenticated` and stops there, so the PUBLIC grant on each of them is still in place.
 * Nothing escalates — every phase 1 function is `security invoker`, so `anon` calling
 * `close_stale_jobs()` still hits the missing update grant on `jobs` and fails — but an
 * ops function that answers the REST API at all is an invitation, and an applied
 * migration is not something to edit in place.
 */
revoke all on function public.refresh_open_job_counts()  from public;
revoke all on function public.close_stale_jobs(integer)  from public;
revoke all on function public.ingest_upsert_job(jsonb)   from public;
revoke all on function public.ingest_upsert_jobs(jsonb)  from public;
