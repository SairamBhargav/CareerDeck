-- Phase 7 — News, notifications, and the privacy obligations.
--
-- Implements docs/README.md §3.11 and §9 (news), the push and digest half of §12's "What to do
-- when", and §13.2 / §13.3 (deletion and export). Design and deviations: docs/PHASE7.md.
--
-- Three groups, each independent of the others:
--
--  * **News.** `news_sources`, `news_items`, `news_seen`. The copyright rule in §9 is a schema
--    rule here: there is no column that could hold an article body. `summary` is ours, three
--    sentences at most, and `url` is where the reader goes to read the real thing.
--  * **Delivery.** Push tokens, a push state on every notification, delivery receipts, the job
--    alert and deadline generators, and the weekly digest's send ledger. Everything is claimed
--    with `for update skip locked` or a unique key, so two senders running at once — two Fly
--    machines, or the service and a manual run — never deliver the same thing twice.
--  * **Privacy.** Deletion requests with a 30-day grace, the purge that anonymizes rather than
--    orphans, and the export bundle. `deletion_requests` deliberately outlives the account it
--    describes: it is the record that the deletion happened.
--
-- Phases 0–6 are untouched except `notifications`, which gains two columns and a trigger.

-- ══ news ════════════════════════════════════════════════════════════════════════

/*
 * §3.11, with the operational columns job_sources taught phase 1 to want: a display name and a
 * publisher for attribution, and the failure counter that makes "a feed went quiet" visible.
 *
 * `enabled` is the takedown switch, as it is for job sources. A publisher who asks us to stop is
 * one update and a line in `notes`.
 */
create table public.news_sources (
  id                   uuid primary key default gen_random_uuid(),
  kind                 text not null default 'rss' check (kind in ('rss', 'api')),
  url                  text not null unique,
  name                 text not null,
  publisher            text not null,
  /*
   * The company, by slug, with the id resolved at ingest. Configuration is written before the
   * companies it names necessarily exist — migrations run before any seed, and a board can be
   * added after its newsroom — so the slug is the durable reference and the id a cache of it.
   */
  company_slug         text,
  company_id           uuid references public.companies (id) on delete cascade,
  category             text not null check (category in ('company', 'industry')),
  enabled              boolean not null default true,
  etag                 text,
  last_fetched_at      timestamptz,
  last_success_at      timestamptz,
  consecutive_failures smallint not null default 0,
  notes                text,
  created_at           timestamptz not null default now(),
  constraint news_sources_company_matches_category
    check ((category = 'company') = (company_slug is not null))
);

/*
 * One story.
 *
 * **There is no body column, on purpose.** §9: storing and redisplaying article text is
 * infringement. The feed's description is read once, passed to the summarizer, and dropped; what
 * is kept is a headline (attributed), the publisher's name, our own summary, and the link. The
 * check on `summary` is the §9 rule as a constraint: three sentences, each short — a model that
 * starts reproducing the article gets rejected by the table, not trusted by the pipeline.
 *
 * Suppressed items are kept. `url_hash` is what stops a story being summarized twice, and a
 * story we decided was irrelevant would otherwise be re-summarized — and re-billed — every time
 * the feed was fetched. §9: "cached forever, never regenerated".
 */
create table public.news_items (
  id              uuid primary key default gen_random_uuid(),
  source_id       uuid references public.news_sources (id) on delete set null,
  company_id      uuid references public.companies (id) on delete cascade,
  category        text not null check (category in ('company', 'industry')),
  url             text not null,
  url_hash        text not null unique,
  publisher       text not null,
  tag             text not null,
  headline        text not null check (length(headline) between 1 and 300),
  subtext         text check (subtext is null or length(subtext) <= 200),
  summary         text[] not null default '{}'
                    check (cardinality(summary) <= 3
                           and coalesce(length(array_to_string(summary, ' ')), 0) <= 900),
  topic           text not null default 'other'
                    check (topic in ('hiring', 'layoffs', 'funding', 'product', 'engineering', 'other')),
  image_url       text,
  accent_color    text,
  published_at    timestamptz not null,
  ingested_at     timestamptz not null default now(),
  relevance_score real check (relevance_score is null or relevance_score between 0 and 1),
  status          text not null default 'published' check (status in ('published', 'suppressed', 'removed')),
  model           text,
  prompt_version  text,
  tokens_in       integer,
  tokens_out      integer,
  cost_usd        numeric(8,5),
  created_at      timestamptz not null default now()
);

create index news_items_feed_idx on public.news_items (published_at desc) where status = 'published';
create index news_items_company_idx on public.news_items (company_id, published_at desc) where status = 'published';

/* §3.11: the story rings' "watched" state, surviving a restart. */
create table public.news_seen (
  user_id      uuid not null references public.profiles (id) on delete cascade,
  news_item_id uuid not null references public.news_items (id) on delete cascade,
  seen_at      timestamptz not null default now(),
  primary key (user_id, news_item_id)
);

create type public.news_card as (
  id           uuid,
  category     text,
  company_slug text,
  company_name text,
  url          text,
  publisher    text,
  tag          text,
  headline     text,
  subtext      text,
  summary      text[],
  topic        text,
  accent_color text,
  published_at timestamptz,
  seen         boolean
);

/*
 * The stories row: every published story from the last `p_days`, newest first, with whether this
 * reader has watched it. Ordering by relevance to the reader — followed companies and industry
 * news first — stays in `useNewsFeed`, which already does it and needs the follow set anyway.
 */
create or replace function public.news_feed(p_days integer default 14, p_limit integer default 120)
returns setof public.news_card
language sql
stable
security definer
set search_path = ''
as $fn$
  select n.id, n.category, c.slug, c.name, n.url, n.publisher, n.tag, n.headline, n.subtext,
         n.summary, n.topic, n.accent_color, n.published_at,
         exists (select 1 from public.news_seen s
                  where s.user_id = (select auth.uid()) and s.news_item_id = n.id)
    from public.news_items n
    left join public.companies c on c.id = n.company_id
   where n.status = 'published'
     and n.published_at > now() - make_interval(days => least(greatest(p_days, 1), 60))
   order by n.published_at desc
   limit least(greatest(p_limit, 1), 300);
$fn$;

/* Batched, one-way, idempotent — the client flushes watched ids a handful at a time. */
create or replace function public.mark_news_seen(p_ids uuid[])
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  uid     uuid := (select auth.uid());
  written integer;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = 'CD401';
  end if;

  insert into public.news_seen (user_id, news_item_id)
  select uid, i
    from unnest(p_ids[1:200]) i
   where exists (select 1 from public.news_items n where n.id = i)
  on conflict do nothing;

  get diagnostics written = row_count;
  return written;
end;
$fn$;

-- ══ delivery ════════════════════════════════════════════════════════════════════

/*
 * One Expo push token per device. Unique on the token, not on (user, token): a phone that signs
 * out of one account and into another is the same device, and it must stop receiving the first
 * account's notifications the moment it registers for the second.
 */
create table public.push_tokens (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles (id) on delete cascade,
  token           text not null unique check (token ~ '^Expo(nent)?PushToken\[[^\]]+\]$'),
  platform        text not null check (platform in ('ios', 'android')),
  created_at      timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  disabled_at     timestamptz,
  disabled_reason text
);

create index push_tokens_user_idx on public.push_tokens (user_id) where disabled_at is null;

/*
 * Every notification now carries where it is in the push pipeline.
 *
 * `none` is the default so that the ~everything already in the table is never pushed — a
 * migration that paged every user about a reply from last month would be the first thing
 * anybody remembered about phase 7. New rows are set to `pending` by the trigger below, for the
 * kinds that are ever pushed.
 */
alter table public.notifications
  add column push_state text not null default 'none'
    check (push_state in ('none', 'pending', 'sending', 'sent', 'failed', 'skipped')),
  add column pushed_at timestamptz;

create index notifications_push_pending_idx on public.notifications (created_at)
  where push_state = 'pending';

-- Idempotency for the deadline generator: one reminder per saved posting, ever.
create unique index notifications_deadline_once
  on public.notifications (user_id, subject_id) where kind = 'deadline';

/*
 * Which kinds push. `comment_like` does not: it aggregates on the inbox row by design, and a
 * push per like is exactly the notification spam that gets an app's permission revoked.
 */
create or replace function public.notification_push_pending()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if new.kind <> 'comment_like' then
    new.push_state := 'pending';
  end if;
  return new;
end;
$fn$;

create trigger notifications_push_pending
  before insert on public.notifications
  for each row execute function public.notification_push_pending();

/* One row per Expo ticket, so a receipt can be matched back and a dead token retired. */
create table public.push_deliveries (
  id                 bigint generated always as identity primary key,
  notification_id    uuid references public.notifications (id) on delete cascade,
  token_id           uuid references public.push_tokens (id) on delete cascade,
  ticket_id          text,
  status             text not null check (status in ('ok', 'error')),
  error              text,
  receipt_status     text check (receipt_status in ('ok', 'error')),
  receipt_error      text,
  receipt_checked_at timestamptz,
  created_at         timestamptz not null default now()
);

create index push_deliveries_receipts_idx on public.push_deliveries (created_at)
  where ticket_id is not null and receipt_checked_at is null;

/*
 * A reader's preference, defaulting to on.
 *
 * `notification_prefs` has existed since phase 0 as `{}` with nothing reading it. The shape is
 * `{"push": {"replies": bool, "job_alerts": bool, "deadlines": bool, "account": bool},
 *   "email": {"digest": bool}}` and an absent key means yes — the OS permission prompt is the
 * real opt-in for push, and the digest carries an unsubscribe link in every send.
 */
create or replace function public.notification_pref(p_prefs jsonb, p_channel text, p_key text)
returns boolean
language sql
immutable
set search_path = ''
as $fn$
  select coalesce((p_prefs -> p_channel ->> p_key)::boolean, true);
$fn$;

/* The preference key that governs a notification kind. */
create or replace function public.push_pref_key(p_kind public.notification_kind)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select case p_kind
           when 'comment_reply' then 'replies'
           when 'job_alert'     then 'job_alerts'
           when 'deadline'      then 'deadlines'
           else 'account'
         end;
$fn$;

create or replace function public.register_push_token(p_token text, p_platform text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  uid uuid := (select auth.uid());
  tid uuid;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = 'CD401';
  end if;

  insert into public.push_tokens (user_id, token, platform)
  values (uid, btrim(p_token), p_platform)
  on conflict (token) do update
     set user_id         = excluded.user_id,
         platform        = excluded.platform,
         last_seen_at    = now(),
         disabled_at     = null,
         disabled_reason = null
  returning id into tid;

  return tid;
end;
$fn$;

/* On sign-out. Scoped to the caller, so a reader cannot switch off somebody else's device. */
create or replace function public.unregister_push_token(p_token text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  update public.push_tokens
     set disabled_at = now(), disabled_reason = 'signed_out'
   where token = btrim(p_token) and user_id = (select auth.uid()) and disabled_at is null;
  return found;
end;
$fn$;

create type public.push_job as (
  notification_id uuid,
  user_id         uuid,
  kind            public.notification_kind,
  subject_type    text,
  subject_id      uuid,
  payload         jsonb,
  token_ids       uuid[],
  tokens          text[]
);

/*
 * Claims up to `p_limit` pending pushes for one sender.
 *
 * Skip-locked, so concurrent senders take disjoint batches. Everything that makes a push
 * pointless is decided here and marked `skipped` rather than sent: no live device, the reader
 * turned that kind off, the account is being deleted, or the notification is over a day old — a
 * reply from yesterday arriving as a buzz today is worse than silence.
 */
create or replace function public.claim_push_batch(p_limit integer default 100)
returns setof public.push_job
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  claimed uuid[];
begin
  select coalesce(array_agg(id), '{}') into claimed from (
    select n.id from public.notifications n
     where n.push_state = 'pending'
     order by n.created_at
     limit least(greatest(p_limit, 1), 500)
     for update skip locked
  ) batch;

  update public.notifications n
     set push_state = 'skipped'
   where n.id = any (claimed)
     and (
       n.created_at < now() - interval '1 day'
       or exists (select 1 from public.profiles p where p.id = n.user_id and p.deleted_at is not null)
       or not public.notification_pref(
            (select up.notification_prefs from public.user_preferences up where up.user_id = n.user_id),
            'push', public.push_pref_key(n.kind))
       or not exists (select 1 from public.push_tokens t where t.user_id = n.user_id and t.disabled_at is null)
     );

  return query
  update public.notifications n
     set push_state = 'sending'
   where n.id = any (claimed) and n.push_state = 'pending'
  returning n.id, n.user_id, n.kind, n.subject_type, n.subject_id, n.payload,
            (select array_agg(t.id order by t.created_at) from public.push_tokens t
              where t.user_id = n.user_id and t.disabled_at is null),
            (select array_agg(t.token order by t.created_at) from public.push_tokens t
              where t.user_id = n.user_id and t.disabled_at is null);
end;
$fn$;

/*
 * Records what Expo said about each message.
 *
 * `p_results`: `[{notification_id, token_id, status: "ok"|"error", ticket_id?, error?}]`.
 * `DeviceNotRegistered` retires the token on the spot — Expo's documented signal that the app
 * was uninstalled, and sending to it again only earns a rate limit.
 */
create or replace function public.record_push_results(p_results jsonb)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  written integer;
begin
  insert into public.push_deliveries (notification_id, token_id, ticket_id, status, error)
  select (r ->> 'notification_id')::uuid, (r ->> 'token_id')::uuid, r ->> 'ticket_id',
         r ->> 'status', left(r ->> 'error', 200)
    from jsonb_array_elements(p_results) r;
  get diagnostics written = row_count;

  update public.push_tokens t
     set disabled_at = now(), disabled_reason = 'DeviceNotRegistered'
   where t.id in (select (r ->> 'token_id')::uuid from jsonb_array_elements(p_results) r
                   where r ->> 'error' = 'DeviceNotRegistered')
     and t.disabled_at is null;

  update public.notifications n
     set push_state = case when exists (
                        select 1 from jsonb_array_elements(p_results) r
                         where (r ->> 'notification_id')::uuid = n.id and r ->> 'status' = 'ok')
                      then 'sent' else 'failed' end,
         pushed_at = now()
   where n.id in (select distinct (r ->> 'notification_id')::uuid from jsonb_array_elements(p_results) r)
     and n.push_state = 'sending';

  return written;
end;
$fn$;

/* Tickets old enough that Expo has a receipt for them — its docs say to wait ~15 minutes. */
create or replace function public.push_receipts_due(p_limit integer default 300)
returns table (delivery_id bigint, ticket_id text, token_id uuid)
language sql
stable
security definer
set search_path = ''
as $fn$
  select d.id, d.ticket_id, d.token_id
    from public.push_deliveries d
   where d.ticket_id is not null and d.receipt_checked_at is null
     and d.created_at < now() - interval '15 minutes'
   order by d.created_at
   limit least(greatest(p_limit, 1), 1000);
$fn$;

/* `p_receipts`: `[{delivery_id, status, error?}]`. Same retirement rule as the tickets. */
create or replace function public.record_push_receipts(p_receipts jsonb)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  written integer;
begin
  update public.push_deliveries d
     set receipt_status = r ->> 'status', receipt_error = left(r ->> 'error', 200), receipt_checked_at = now()
    from jsonb_array_elements(p_receipts) r
   where d.id = (r ->> 'delivery_id')::bigint;
  get diagnostics written = row_count;

  update public.push_tokens t
     set disabled_at = now(), disabled_reason = 'DeviceNotRegistered'
   where t.id in (select d.token_id from public.push_deliveries d
                   join jsonb_array_elements(p_receipts) r on d.id = (r ->> 'delivery_id')::bigint
                  where r ->> 'error' = 'DeviceNotRegistered')
     and t.disabled_at is null;

  return written;
end;
$fn$;

-- ── job alerts and deadlines ─────────────────────────────────────────────────

create table public.notification_state (
  user_id           uuid primary key references public.profiles (id) on delete cascade,
  last_job_alert_at timestamptz,
  updated_at        timestamptz not null default now()
);

/*
 * §12's "Follows a company → … job alerts", as one notification per reader per day at most.
 *
 * New means first seen since the reader's last alert (or the last day, for a first alert), at a
 * company they follow, still open, and not something they hid. One row per reader whatever the
 * count — "3 new roles at Stripe and Figma" — because a push per posting is the fastest way to
 * lose the permission. If they have stated employment types, only those count.
 *
 * Returns how many alerts it wrote. Safe to run as often as you like: the 20-hour spacing is
 * checked per reader under a row lock.
 */
create or replace function public.generate_job_alerts(p_max_users integer default 1000)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  r       record;
  since   timestamptz;
  written integer := 0;
  v_ids   uuid[];
  v_names text[];
  v_count integer;
begin
  for r in
    select distinct f.user_id
      from public.company_follows f
      join public.profiles p on p.id = f.user_id and p.deleted_at is null
      left join public.notification_state s on s.user_id = f.user_id
     where s.last_job_alert_at is null or s.last_job_alert_at < now() - interval '20 hours'
     limit p_max_users
  loop
    insert into public.notification_state (user_id) values (r.user_id) on conflict do nothing;

    select last_job_alert_at into since from public.notification_state
     where user_id = r.user_id for update skip locked;
    if not found then continue; end if;  -- another runner has this reader
    if since is not null and since >= now() - interval '20 hours' then continue; end if;

    since := coalesce(since, now() - interval '1 day');

    select count(*)::integer,
           (array_agg(j.id order by j.posted_at desc))[1:5],
           (array_agg(distinct j.company_name))[1:3]
      into v_count, v_ids, v_names
      from public.jobs j
      join public.company_follows f on f.company_id = j.company_id and f.user_id = r.user_id
      left join public.user_preferences up on up.user_id = r.user_id
     where j.status = 'open'
       and j.first_seen_at > since
       and j.first_seen_at > f.created_at
       and (cardinality(coalesce(up.preferred_employment_types, '{}')) = 0
            or j.employment_type::text = any (up.preferred_employment_types::text[]))
       and not exists (select 1 from public.job_interactions i
                        where i.user_id = r.user_id and i.job_id = j.id
                          and i.kind in ('hide', 'not_interested'));

    update public.notification_state
       set last_job_alert_at = now(), updated_at = now()
     where user_id = r.user_id;

    if v_count > 0 then
      insert into public.notifications (user_id, kind, subject_type, subject_id, payload)
      values (r.user_id, 'job_alert', 'job', v_ids[1], jsonb_build_object(
        'job_id', v_ids[1],
        'job_ids', to_jsonb(v_ids),
        'count', v_count,
        'headline', case when v_count = 1 then '1 new role at ' || v_names[1]
                         else v_count || ' new roles at companies you follow' end,
        'detail', array_to_string(v_names, ', ')
      ));
      written := written + 1;
    end if;
  end loop;

  return written;
end;
$fn$;

/*
 * §15's "deadlines": a saved posting that closes within three days, not yet applied to. Once per
 * posting per reader, enforced by `notifications_deadline_once`.
 */
create or replace function public.generate_deadline_reminders(p_within_days integer default 3)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  written integer;
begin
  insert into public.notifications (user_id, kind, subject_type, subject_id, payload)
  select i.user_id, 'deadline', 'job', j.id, jsonb_build_object(
           'job_id', j.id,
           'closes_at', j.closes_at,
           'headline', j.title || ' closes ' ||
             case when j.closes_at < now() + interval '1 day' then 'within a day'
                  else 'in ' || ceil(extract(epoch from j.closes_at - now()) / 86400)::int || ' days' end,
           'detail', j.company_name || ' — you saved this one.'
         )
    from public.job_interactions i
    join public.jobs j on j.id = i.job_id
    join public.profiles p on p.id = i.user_id and p.deleted_at is null
   where i.kind = 'save'
     and j.status = 'open'
     and j.closes_at between now() and now() + make_interval(days => p_within_days)
     and not exists (select 1 from public.applications a where a.user_id = i.user_id and a.job_id = j.id)
  on conflict (user_id, subject_id) where kind = 'deadline' do nothing;

  get diagnostics written = row_count;
  return written;
end;
$fn$;

-- ── the weekly digest ────────────────────────────────────────────────────────

/*
 * The send ledger. The primary key is the idempotency: a week is claimed before it is sent, so
 * two senders cannot both email the same person, and a crash between claim and send leaves a
 * `sending` row rather than a duplicate. That is the right way round — a missed digest is
 * forgettable, a doubled one is a reason to unsubscribe.
 */
create table public.digest_sends (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  week_start  date not null check (extract(isodow from week_start) = 1),
  status      text not null default 'sending' check (status in ('sending', 'sent', 'failed', 'skipped')),
  provider_id text,
  error       text,
  claimed_at  timestamptz not null default now(),
  sent_at     timestamptz,
  primary key (user_id, week_start)
);

create type public.digest_job as (
  user_id    uuid,
  email      text,
  first_name text,
  content    jsonb
);

/*
 * Claims up to `p_limit` readers for the week's digest and returns what to tell each of them.
 *
 * Only readers who want it, whose address is confirmed, whose account is not being deleted, and
 * who have **something to say**: new postings this week at companies they follow, or saved
 * postings closing in the next week. An email that says "nothing happened" teaches people to
 * ignore the next one. Readers with nothing are recorded as `skipped` so they are not reconsidered
 * every tick.
 */
create or replace function public.claim_digest_batch(p_week_start date, p_limit integer default 50)
returns setof public.digest_job
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  r        record;
  v_new    jsonb;
  v_closing jsonb;
  v_goal   jsonb;
  job      public.digest_job;
  claimed  integer := 0;
begin
  if extract(isodow from p_week_start) <> 1 then
    raise exception 'a week starts on a Monday' using errcode = '22023';
  end if;

  for r in
    select p.id, u.email, p.first_name, up.weekly_goal
      from public.profiles p
      join auth.users u on u.id = p.id
      join public.user_preferences up on up.user_id = p.id
     where p.deleted_at is null
       and u.email is not null and u.email_confirmed_at is not null
       and public.notification_pref(up.notification_prefs, 'email', 'digest')
       and not exists (select 1 from public.digest_sends d where d.user_id = p.id and d.week_start = p_week_start)
     order by p.id
     limit greatest(p_limit, 1) * 4
  loop
    exit when claimed >= p_limit;

    insert into public.digest_sends (user_id, week_start) values (r.id, p_week_start)
    on conflict do nothing;
    if not found then continue; end if;  -- another sender claimed this reader

    select coalesce(jsonb_agg(x order by x ->> 'posted_at' desc), '[]') into v_new from (
      select jsonb_build_object('id', j.id, 'title', j.title, 'company', j.company_name,
                                'location', j.location_raw, 'posted_at', j.posted_at) x
        from public.jobs j
        join public.company_follows f on f.company_id = j.company_id and f.user_id = r.id
       where j.status = 'open' and j.first_seen_at >= p_week_start - 7
       order by j.posted_at desc
       limit 5
    ) q;

    select coalesce(jsonb_agg(x order by x ->> 'closes_at'), '[]') into v_closing from (
      select jsonb_build_object('id', j.id, 'title', j.title, 'company', j.company_name,
                                'closes_at', j.closes_at) x
        from public.job_interactions i
        join public.jobs j on j.id = i.job_id
       where i.user_id = r.id and i.kind = 'save' and j.status = 'open'
         and j.closes_at between now() and now() + interval '7 days'
         and not exists (select 1 from public.applications a where a.user_id = r.id and a.job_id = j.id)
       limit 5
    ) q;

    if jsonb_array_length(v_new) = 0 and jsonb_array_length(v_closing) = 0 then
      update public.digest_sends set status = 'skipped' where user_id = r.id and week_start = p_week_start;
      continue;
    end if;

    v_goal := jsonb_build_object(
      'target', r.weekly_goal,
      'last_week', public.applications_in_week(r.id, p_week_start - 7)
    );

    claimed := claimed + 1;
    job.user_id    := r.id;
    job.email      := r.email;
    job.first_name := r.first_name;
    job.content    := jsonb_build_object('new_jobs', v_new, 'closing', v_closing, 'goal', v_goal,
                                         'credits', public.credit_balance(r.id));
    return next job;
  end loop;
end;
$fn$;

create or replace function public.record_digest_result(
  p_user_id uuid, p_week_start date, p_status text, p_provider_id text default null, p_error text default null
)
returns void
language sql
volatile
security definer
set search_path = ''
as $fn$
  update public.digest_sends
     set status = p_status, provider_id = p_provider_id, error = left(p_error, 300),
         sent_at = case when p_status = 'sent' then now() end
   where user_id = p_user_id and week_start = p_week_start;
$fn$;

/*
 * The unsubscribe link's write. Service-only: the link is authenticated by an HMAC the service
 * checks, not by a session, because the person clicking it is reading their email, not signed in.
 */
create or replace function public.set_notification_pref(
  p_user_id uuid, p_channel text, p_key text, p_value boolean
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $fn$
  update public.user_preferences
     set notification_prefs = jsonb_set(
           case when jsonb_typeof(notification_prefs -> p_channel) = 'object'
                then notification_prefs
                else notification_prefs || jsonb_build_object(p_channel, '{}'::jsonb) end,
           array[p_channel, p_key], to_jsonb(p_value))
   where user_id = p_user_id
  returning notification_prefs;
$fn$;

-- ══ privacy ═════════════════════════════════════════════════════════════════════

/*
 * §13.2's deletion, phase one. `user_id` has no foreign key on purpose: the row must survive the
 * account it describes, because it is the evidence that a deletion was requested, honoured, and
 * when. It holds nothing but the id and dates.
 */
create table public.deletion_requests (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null,
  requested_at timestamptz not null default now(),
  purge_after  timestamptz not null default now() + interval '30 days',
  cancelled_at timestamptz,
  completed_at timestamptz,
  purge_detail jsonb
);

create unique index deletion_requests_one_open
  on public.deletion_requests (user_id) where cancelled_at is null and completed_at is null;
create index deletion_requests_due_idx
  on public.deletion_requests (purge_after) where cancelled_at is null and completed_at is null;

/* Accounts the system owns. Today: the tombstone that deleted readers' comments are moved to. */
create table public.system_accounts (
  role    text primary key check (role in ('tombstone')),
  user_id uuid not null unique references public.profiles (id)
);

create table public.data_exports (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  bytes        integer
);

create index data_exports_user_idx on public.data_exports (user_id, requested_at desc);

create type public.account_status as (
  deletion_requested_at timestamptz,
  purge_after           timestamptz
);

/*
 * Answerable when nothing else is. A reader with a pending deletion cannot select their own
 * profile — phase 0's policy has required `deleted_at is null` since the first migration — so the
 * app asks this instead when the profile read comes back empty.
 */
create or replace function public.my_account_status()
returns public.account_status
language sql
stable
security definer
set search_path = ''
as $fn$
  select r.requested_at, r.purge_after
    from (select 1) one
    left join public.deletion_requests r
      on r.user_id = (select auth.uid()) and r.cancelled_at is null and r.completed_at is null;
$fn$;

/*
 * §13.2: "`deletion_requests` row, account disabled immediately, 30-day grace (recoverable)."
 *
 * Disabled means `profiles.deleted_at`: the reader can no longer read their own profile (so the
 * app shows the pending screen and nothing else), pushes and digests stop, and alerts skip them.
 * Their comments stay up under the pseudonym for the grace period; they are anonymized at the
 * purge, not hidden now, so a change of mind restores a thread rather than a hole in it.
 */
create or replace function public.request_account_deletion()
returns public.account_status
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  uid    uuid := (select auth.uid());
  result public.account_status;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = 'CD401';
  end if;

  insert into public.deletion_requests (user_id) values (uid)
  on conflict (user_id) where cancelled_at is null and completed_at is null do nothing;

  update public.profiles set deleted_at = coalesce(deleted_at, now()) where id = uid;

  select requested_at, purge_after into result from public.deletion_requests
   where user_id = uid and cancelled_at is null and completed_at is null;
  return result;
end;
$fn$;

create or replace function public.cancel_account_deletion()
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  uid uuid := (select auth.uid());
begin
  update public.deletion_requests
     set cancelled_at = now()
   where user_id = uid and cancelled_at is null and completed_at is null and purge_after > now();
  if not found then
    return false;
  end if;

  update public.profiles set deleted_at = null where id = uid;
  return true;
end;
$fn$;

/* Requests whose grace has run out, for the purge job. */
create or replace function public.due_account_purges(p_limit integer default 20)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $fn$
  select user_id from public.deletion_requests
   where cancelled_at is null and completed_at is null and purge_after <= now()
   order by purge_after
   limit greatest(p_limit, 1);
$fn$;

/*
 * §13.2 phase two, the part SQL can do. Returns the storage objects the caller must remove
 * before deleting the auth user (which cascades everything keyed on the profile).
 *
 *  - **Comments are anonymized, not deleted.** Re-pointed to the tombstone account, so threads
 *    stay coherent — and their idempotency keys are cleared, because they were unique per author
 *    and the tombstone is now everyone's author.
 *  - **Impressions are dissociated to one random research id.** They carry no foreign key (they
 *    are partitioned and high-volume), so the cascade would never reach them; a fresh uuid per
 *    purged account keeps "one reader's session" analysable and "which reader" unanswerable.
 *  - **Applications, interactions, the ledger, resumes, verifications** go with the cascade.
 *  - **`pii_access_log` stays.** The record of who read someone's data outlives the data, which is
 *    the point of it; it names a user id that no longer resolves to anybody.
 *
 * `p_force` skips the grace check, for verification and for a support-confirmed immediate request.
 */
create or replace function public.begin_account_purge(p_user_id uuid, p_force boolean default false)
returns table (bucket text, path text)
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  tomb     uuid;
  research uuid := gen_random_uuid();
  moved    integer;
  dissoc   integer;
begin
  if not p_force and not exists (
    select 1 from public.deletion_requests
     where user_id = p_user_id and cancelled_at is null and completed_at is null and purge_after <= now()
  ) then
    raise exception 'no deletion is due for this account' using errcode = 'CD031';
  end if;

  select user_id into tomb from public.system_accounts where role = 'tombstone';
  if tomb is null then
    raise exception 'the tombstone account does not exist yet' using errcode = 'CD032';
  end if;
  if tomb = p_user_id then
    raise exception 'the tombstone cannot be purged' using errcode = 'CD032';
  end if;

  update public.comments set author_id = tomb, idempotency_key = null where author_id = p_user_id;
  get diagnostics moved = row_count;

  update public.job_impressions set user_id = research where user_id = p_user_id;
  get diagnostics dissoc = row_count;

  update public.deletion_requests
     set purge_detail = jsonb_build_object('comments_anonymized', moved, 'impressions_dissociated', dissoc)
   where user_id = p_user_id and completed_at is null and cancelled_at is null;

  return query
    select 'resumes'::text, r.storage_path from public.resumes r where r.user_id = p_user_id
    union all
    select 'resume-thumbnails'::text, r.thumbnail_path from public.resumes r
     where r.user_id = p_user_id and r.thumbnail_path is not null;
end;
$fn$;

/* After the auth user is gone. Closes the request — or opens a closed one for a forced purge. */
create or replace function public.complete_account_purge(p_user_id uuid)
returns void
language sql
volatile
security definer
set search_path = ''
as $fn$
  insert into public.deletion_requests (user_id, requested_at, purge_after, completed_at)
  select p_user_id, now(), now(), now()
   where not exists (select 1 from public.deletion_requests
                      where user_id = p_user_id and cancelled_at is null and completed_at is null);
  update public.deletion_requests
     set completed_at = now()
   where user_id = p_user_id and cancelled_at is null and completed_at is null;
$fn$;

/*
 * §13.2: "Export: a job producing a JSON bundle of everything."
 *
 * Everything a reader created or that was recorded about them, keyed by table, in their own
 * words where there are words. Three deliberate exclusions, each named in the bundle's `notes`:
 * credential hashes (verification identifiers — a hash of your own email is not information about
 * you, it is a weakness), the sealed contact fields (the service opens and adds them), and raw
 * impressions (summarised per month; a year of scroll events is not a readable disclosure and is
 * P2 data anyway).
 *
 * Includes `pii_access_log` rows about the reader. Under CCPA the right to know covers who their
 * personal information was disclosed to, and that log is the answer.
 */
create or replace function public.export_account(p_user_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  bundle jsonb;
begin
  if exists (select 1 from public.data_exports
              where user_id = p_user_id and requested_at > now() - interval '24 hours') then
    raise exception 'one export a day — the last one is still recent' using errcode = 'CD030';
  end if;

  insert into public.data_exports (user_id) values (p_user_id);

  select jsonb_build_object(
    'generated_at', now(),
    'account_id', p_user_id,
    'profile', (select to_jsonb(p) - 'school_id' from public.profiles p where p.id = p_user_id),
    'preferences', (select to_jsonb(u) from public.user_preferences u where u.user_id = p_user_id),
    'follows', (select coalesce(jsonb_agg(jsonb_build_object('company', c.name, 'slug', c.slug, 'since', f.created_at)), '[]')
                  from public.company_follows f join public.companies c on c.id = f.company_id where f.user_id = p_user_id),
    'interactions', (select coalesce(jsonb_agg(jsonb_build_object('job_id', i.job_id, 'kind', i.kind, 'at', i.created_at)), '[]')
                       from public.job_interactions i where i.user_id = p_user_id),
    'applications', (select coalesce(jsonb_agg(to_jsonb(a) || jsonb_build_object(
                        'job_title', j.title, 'company', j.company_name,
                        'events', (select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at), '[]')
                                     from public.application_events e where e.application_id = a.id))), '[]')
                       from public.applications a join public.jobs j on j.id = a.job_id where a.user_id = p_user_id),
    'comments', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'job_id', c.job_id, 'parent_id', c.parent_id,
                   'body', c.body, 'gif_id', c.gif_id, 'created_at', c.created_at, 'deleted_at', c.deleted_at,
                   'moderation_status', c.moderation_status)), '[]')
                   from public.comments c where c.author_id = p_user_id),
    'comment_likes', (select coalesce(jsonb_agg(jsonb_build_object('comment_id', l.comment_id, 'at', l.created_at)), '[]')
                        from public.comment_likes l where l.user_id = p_user_id),
    'blocks', (select count(*) from public.blocks b where b.blocker_id = p_user_id),
    'reports_filed', (select coalesce(jsonb_agg(jsonb_build_object('target_type', r.target_type, 'reason', r.reason,
                        'status', r.status, 'at', r.created_at)), '[]')
                        from public.reports r where r.reporter_id = p_user_id),
    'strikes', (select coalesce(jsonb_agg(to_jsonb(s) - 'issued_by'), '[]') from public.user_strikes s where s.user_id = p_user_id),
    'verifications', (select coalesce(jsonb_agg(jsonb_build_object('kind', v.kind, 'status', v.status,
                        'edu_email', v.edu_email, 'verified_at', v.verified_at, 'created_at', v.created_at)), '[]')
                        from public.verifications v where v.user_id = p_user_id),
    'notifications', (select coalesce(jsonb_agg(jsonb_build_object('kind', n.kind, 'payload', n.payload,
                        'created_at', n.created_at, 'read_at', n.read_at)), '[]')
                        from public.notifications n where n.user_id = p_user_id),
    'resumes', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'focus', r.focus,
                  'uploaded_at', r.created_at, 'deleted_at', r.deleted_at, 'is_default', r.is_default,
                  'parsed', (select jsonb_build_object('location', rp.location, 'skills', rp.skills,
                               'education', rp.education, 'experience', rp.experience,
                               'years_experience', rp.years_experience, 'seniority', rp.seniority,
                               'parsed_at', rp.parsed_at)
                               from public.resume_profiles rp where rp.resume_id = r.id))), '[]')
                  from public.resumes r where r.user_id = p_user_id),
    'match_scores', (select count(*) from public.job_match_scores m where m.user_id = p_user_id),
    'credits', (select coalesce(jsonb_agg(jsonb_build_object('kind', t.kind, 'amount', t.amount, 'at', t.created_at)
                  order by t.id), '[]') from public.credit_transactions t where t.user_id = p_user_id),
    'subscription', (select to_jsonb(s) - 'original_transaction_id' - 'revenuecat_id'
                       from public.subscriptions s where s.user_id = p_user_id),
    'entitlements', (select coalesce(jsonb_agg(to_jsonb(e) - 'user_id'), '[]') from public.entitlements e where e.user_id = p_user_id),
    'auto_apply_runs', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'job_id', a.job_id, 'status', a.status,
                          'draft', a.draft, 'created_at', a.created_at, 'completed_at', a.completed_at)), '[]')
                          from public.auto_apply_runs a where a.user_id = p_user_id),
    'news_seen', (select count(*) from public.news_seen s where s.user_id = p_user_id),
    'devices', (select coalesce(jsonb_agg(jsonb_build_object('platform', t.platform, 'registered_at', t.created_at,
                  'disabled_at', t.disabled_at)), '[]') from public.push_tokens t where t.user_id = p_user_id),
    'impressions_by_month', (select coalesce(jsonb_agg(x order by x ->> 'month'), '[]') from (
                  select jsonb_build_object('month', to_char(date_trunc('month', shown_at), 'YYYY-MM'),
                                            'cards_shown', count(*)) x
                    from public.job_impressions where user_id = p_user_id
                   group by date_trunc('month', shown_at)) q),
    'who_accessed_your_data', (select coalesce(jsonb_agg(jsonb_build_object('actor_type', l.actor_type,
                  'resource', l.resource, 'purpose', l.purpose, 'at', l.created_at) order by l.created_at), '[]')
                  from public.pii_access_log l where l.subject_user_id = p_user_id),
    'notes', jsonb_build_array(
      'Contact details parsed from your resume are added by the service, which holds the key.',
      'Verification identifiers are stored only as salted hashes and are not included.',
      'Feed impressions are summarised per month; the raw events are kept for 13 months, then dropped.',
      'CareerDeck does not sell or share your personal information.'
    )
  ) into bundle;

  return bundle;
end;
$fn$;

create or replace function public.record_export_size(p_user_id uuid, p_bytes integer)
returns void
language sql
volatile
security definer
set search_path = ''
as $fn$
  update public.data_exports set completed_at = now(), bytes = p_bytes
   where id = (select id from public.data_exports where user_id = p_user_id
                order by requested_at desc limit 1);
$fn$;

-- ══ operations ══════════════════════════════════════════════════════════════════

/* Delivery records are operational, not historical. A month is plenty to debug a complaint. */
create or replace function public.prune_push_deliveries(p_keep_days integer default 30)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  gone integer;
begin
  delete from public.push_deliveries where created_at < now() - make_interval(days => p_keep_days);
  get diagnostics gone = row_count;
  return gone;
end;
$fn$;

-- ══ grants ══════════════════════════════════════════════════════════════════════
--
-- | table               | a reader can select              | a reader can write        |
-- |---------------------|----------------------------------|---------------------------|
-- | `news_items`        | published rows, minus cost cols  | nothing                   |
-- | `news_sources`      | nothing                          | nothing                   |
-- | `news_seen`         | own rows                         | `mark_news_seen()` only   |
-- | `push_tokens`       | nothing                          | register/unregister only  |
-- | `push_deliveries`   | nothing                          | nothing                   |
-- | `notification_state`| nothing                          | nothing                   |
-- | `digest_sends`      | nothing                          | nothing                   |
-- | `deletion_requests` | nothing — `my_account_status()`  | request/cancel only       |
-- | `data_exports`      | nothing                          | nothing — the service     |
-- | `system_accounts`   | nothing                          | nothing                   |

alter table public.news_sources       enable row level security;
alter table public.news_items         enable row level security;
alter table public.news_seen          enable row level security;
alter table public.push_tokens        enable row level security;
alter table public.push_deliveries    enable row level security;
alter table public.notification_state enable row level security;
alter table public.digest_sends       enable row level security;
alter table public.deletion_requests  enable row level security;
alter table public.system_accounts    enable row level security;
alter table public.data_exports       enable row level security;

revoke all on public.news_sources       from anon, authenticated;
revoke all on public.news_items         from anon, authenticated;
revoke all on public.news_seen          from anon, authenticated;
revoke all on public.push_tokens        from anon, authenticated;
revoke all on public.push_deliveries    from anon, authenticated;
revoke all on public.notification_state from anon, authenticated;
revoke all on public.digest_sends       from anon, authenticated;
revoke all on public.deletion_requests  from anon, authenticated;
revoke all on public.system_accounts    from anon, authenticated;
revoke all on public.data_exports       from anon, authenticated;

grant select (id, company_id, category, url, publisher, tag, headline, subtext, summary, topic,
              image_url, accent_color, published_at)
  on public.news_items to authenticated;
create policy news_items_published on public.news_items
  for select to authenticated using (status = 'published');

grant select on public.news_seen to authenticated;
create policy news_seen_own on public.news_seen
  for select to authenticated using (user_id = (select auth.uid()));

-- Internals and the service's half.
revoke all on function public.notification_push_pending()                 from public, anon, authenticated;
revoke all on function public.notification_pref(jsonb, text, text)        from public, anon, authenticated;
revoke all on function public.push_pref_key(public.notification_kind)     from public, anon, authenticated;
revoke all on function public.claim_push_batch(integer)                   from public, anon, authenticated;
revoke all on function public.record_push_results(jsonb)                  from public, anon, authenticated;
revoke all on function public.push_receipts_due(integer)                  from public, anon, authenticated;
revoke all on function public.record_push_receipts(jsonb)                 from public, anon, authenticated;
revoke all on function public.generate_job_alerts(integer)                from public, anon, authenticated;
revoke all on function public.generate_deadline_reminders(integer)        from public, anon, authenticated;
revoke all on function public.claim_digest_batch(date, integer)           from public, anon, authenticated;
revoke all on function public.record_digest_result(uuid, date, text, text, text) from public, anon, authenticated;
revoke all on function public.set_notification_pref(uuid, text, text, boolean)   from public, anon, authenticated;
revoke all on function public.due_account_purges(integer)                 from public, anon, authenticated;
revoke all on function public.begin_account_purge(uuid, boolean)          from public, anon, authenticated;
revoke all on function public.complete_account_purge(uuid)                from public, anon, authenticated;
revoke all on function public.export_account(uuid)                        from public, anon, authenticated;
revoke all on function public.record_export_size(uuid, integer)           from public, anon, authenticated;
revoke all on function public.prune_push_deliveries(integer)              from public, anon, authenticated;

-- A reader's own calls.
revoke all on function public.news_feed(integer, integer)          from public, anon;
revoke all on function public.mark_news_seen(uuid[])               from public, anon;
revoke all on function public.register_push_token(text, text)      from public, anon;
revoke all on function public.unregister_push_token(text)          from public, anon;
revoke all on function public.my_account_status()                  from public, anon;
revoke all on function public.request_account_deletion()           from public, anon;
revoke all on function public.cancel_account_deletion()            from public, anon;

grant execute on function public.news_feed(integer, integer)       to authenticated;
grant execute on function public.mark_news_seen(uuid[])            to authenticated;
grant execute on function public.register_push_token(text, text)   to authenticated;
grant execute on function public.unregister_push_token(text)       to authenticated;
grant execute on function public.my_account_status()               to authenticated;
grant execute on function public.request_account_deletion()        to authenticated;
grant execute on function public.cancel_account_deletion()         to authenticated;

-- ══ found by the load test ══════════════════════════════════════════════════════
--
-- `my_credits()` (phase 6) took the ledger's row lock on every call — `select … for update` on
-- the reader's profile — even though a grant is due at most once a day. A row lock is a write:
-- it stamps the tuple and goes to the WAL, so the cheapest read in the app was the only one that
-- missed its budget under `npm run load-test` (p95 301 ms against 250, with p50 at 13). PHASE7.md §6.
--
-- The fix is the classic double-check: look without the lock, and take it only when a grant might
-- be due. `claim_daily_grant()` re-reads under the lock, so two readers racing past the unlocked
-- check still pay exactly one grant — the idempotency key was always the real guard.

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
  granted integer := 0;
  plan    public.plans;
  result  public.credit_summary;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = 'CD401';
  end if;

  select created_at into born from public.profiles where id = uid;
  if born is null then
    raise exception 'no profile for this account' using errcode = 'CD401';
  end if;

  if coalesce((select max(grant_period) from public.credit_transactions
                where user_id = uid and kind = 'daily_grant'), -1)
     < public.grant_period_at(born, now()) then
    perform public.lock_ledger(uid);
    granted := public.claim_daily_grant(uid, born);
  end if;

  plan := public.viewer_plan(uid);

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
