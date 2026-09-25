-- Phase 3 — Identity and social.
--
-- Implements docs/README.md §3.2 (the two-path verification ladder), §3.8 (comments,
-- moderation, notifications) and §10 (the moderation pipeline). Design and deviations:
-- docs/PHASE3.md.
--
-- Phase 0 established who a reader is, phase 1 what there is to look at, phase 2 what
-- they did about it. This is the phase where they say something — and the first phase
-- whose failure mode is not a lost tap but a real person being harassed by another real
-- person under a name neither of them can see.
--
-- Everything here follows from one property, worth stating before the first table:
-- **users are anonymous to each other and fully identified to us.** `comments.author_id`
-- always points at an account that cost somebody a `.edu` address or a government ID to
-- obtain. Nothing the client can read exposes it. That asymmetry is what makes anonymous
-- speech survivable here: a harasser is invisible to their target and one `user_strikes`
-- row away from losing the thing they paid for.
--
-- Two structural consequences show up all over this file:
--
--  * **The client holds no author identifier**, so anything that needs to act on an author
--    — blocking them, reporting them — is keyed by the *comment* and resolved server-side.
--    That is the contract working, not an inconvenience to route around.
--  * **Comment writes do not come from the client at all.** `post_comment()` is granted to
--    `service_role` only: the API service authenticates the reader, classifies the text,
--    and calls in. Every rule that makes a comment legitimate — tier, strikes, rate,
--    thread depth, policy acceptance — is enforced here rather than there, so a bug in the
--    service cannot produce a comment the database would have refused. PHASE3.md §4.
--
-- Nothing in phases 1 and 2 is altered except where it is named and argued: the
-- `viewer_sets` composite gains one attribute, and phase 0's provisioning trigger gains
-- handle assignment. `jobs`, `companies` and `feed_jobs` are untouched.

-- pgcrypto backs the credential digest in `apply_strike`. Supabase installs it by default;
-- this is here so a bare Postgres running these migrations does not fail at the last one.
create extension if not exists pgcrypto with schema extensions;

-- ── enums ──────────────────────────────────────────────────────────────────────

-- §3.2. Siblings, not a hierarchy: both grant comment-write and they differ only in the
-- badge. The bootcamp grad, the career switcher and the student at a `.ac.uk` school get
-- in through the second one.
create type public.verification_kind   as enum ('edu_email', 'government_id');
create type public.verification_status as enum ('pending', 'verified', 'failed', 'expired');

-- §3.8. `pending` exists for the case where the write path cannot reach a classifier and
-- chooses to hold a comment rather than publish it unchecked; §10's normal outcomes are
-- `approved` (published) and `flagged` (published *and* queued for a human).
create type public.moderation_status as enum ('pending', 'approved', 'flagged', 'removed');

create type public.report_target as enum ('comment', 'profile');
create type public.report_status as enum ('open', 'actioned', 'dismissed');

/*
 * Every notification kind the product will ever have, declared now.
 *
 * Phase 2 took the same decision on `interaction_kind` for the same reason: adding a value
 * to an enum later is a migration that cannot run in a transaction alongside anything that
 * reads the type, and the kinds phase 7 needs are already written down in §3.8 and §15.
 * `moderation` and `verification` are ours — they are how a strike, a removal, or an
 * expiring `.edu` address reaches the person it happened to, which §3.2 and §10 both
 * require ("do not silently revoke — notify").
 */
create type public.notification_kind as enum (
  'comment_reply',
  'comment_like',
  'moderation',
  'verification',
  'job_alert',
  'deadline'
);

-- ── profiles: the pseudonym, and consent to the policy ─────────────────────────

/*
 * `profiles.handle` has existed since phase 0 and nothing has ever filled it. It is the
 * name a comment carries, so phase 3 is where it becomes real.
 *
 * Generated, never chosen. A user-picked handle is a second identity to moderate — it can
 * carry a slur, a real name, a school the account has not verified, or an impersonation of
 * someone else's handle with a homoglyph — and the product gets nothing from it that
 * "quiet-otter-4821" does not. §3.8 generates the badge for exactly this reason; the
 * handle is the same argument one field over.
 */
create table public.handle_words (
  kind text not null check (kind in ('adjective', 'noun')),
  word text not null,
  primary key (kind, word)
);

/*
 * Two words and four digits. At the seeded vocabulary that is millions of combinations, so
 * a collision is rare and a retry is cheap. The loop is bounded because an unbounded one
 * inside a signup transaction is an outage waiting for a busy afternoon; when the attempts
 * run out it falls back to a uuid tail, which is ugly and always available.
 */
create or replace function public.generate_handle()
returns extensions.citext
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  candidate text;
  attempt   integer := 0;
begin
  while attempt < 10 loop
    select w1.word || '-' || w2.word || '-' || (1000 + floor(random() * 9000))::int
      into candidate
      from (select word from public.handle_words where kind = 'adjective'
             order by random() limit 1) w1,
           (select word from public.handle_words where kind = 'noun'
             order by random() limit 1) w2;

    -- No words seeded (a database that has never loaded seed.sql) — take the fallback
    -- rather than spinning ten times over an empty table.
    exit when candidate is null;

    if not exists (select 1 from public.profiles where handle = candidate::extensions.citext) then
      return candidate::extensions.citext;
    end if;

    attempt := attempt + 1;
  end loop;

  return ('anon-' || replace(gen_random_uuid()::text, '-', ''))::extensions.citext;
end;
$fn$;

/*
 * §10: "a clear content policy shown at first comment". The acceptance is recorded rather
 * than remembered on the device, because the reason it exists is to be producible later —
 * in a takedown response, or to a platform reviewing the app. The version travels with it
 * so a policy change can ask again instead of assuming consent to text nobody saw.
 */
alter table public.profiles
  add column content_policy_accepted_at timestamptz,
  add column content_policy_version     text;

/*
 * Phase 0's provisioning trigger, extended with handle assignment.
 *
 * Replacing an applied migration's function from a later migration is the pattern phase 2
 * used for its `revoke ... from public` fix: the earlier file stays as it shipped and the
 * change is where it can be read in context. Everything phase 0 said about this function
 * still holds — it runs inside the signup transaction, so every statement in it has to be
 * incapable of raising, which is why `generate_handle()` cannot loop forever.
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

  return new;
end;
$fn$;

-- Every account created before this migration. A profile with no handle cannot appear on a
-- comment, and everything below assumes one exists.
update public.profiles set handle = public.generate_handle() where handle is null;

-- ── verifications ──────────────────────────────────────────────────────────────

/*
 * §3.2, both paths in one table.
 *
 * **The non-negotiable, as schema rather than as policy:** the government-ID path has
 * columns for a provider reference and an outcome, and *no column that could hold document
 * data*. No image, no document number, no date of birth, no name off the document. There
 * is nowhere to put it. "We decided not to store it" is a promise; "there is no column" is
 * a fact, and the difference is what a breach-notification obligation turns on.
 *
 * The magic-link token is the same shape of decision: `token_hash` holds a digest, so a
 * dump of this table does not let the reader verify anybody's account.
 */
create table public.verifications (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles (id) on delete cascade,
  kind             public.verification_kind not null,
  status           public.verification_status not null default 'pending',

  -- edu_email path
  edu_email        extensions.citext,
  edu_domain       extensions.citext,
  school_id        uuid references public.schools (id),
  token_hash       text,
  token_expires_at timestamptz,
  attempts         smallint not null default 0,

  -- government_id path. provider_ref is the inquiry id and THE ONLY THING WE KEEP.
  provider         text,
  provider_ref     text,
  -- Pass/fail and reason codes. Enforced below to carry nothing else.
  provider_result  jsonb,

  verified_at      timestamptz,
  -- §3.2: ".edu addresses die after graduation." Set on the edu path, null on the ID path,
  -- because personhood does not expire.
  expires_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint verifications_edu_shape check (
    kind <> 'edu_email' or (edu_email is not null and edu_domain is not null)
  ),
  constraint verifications_id_shape check (
    kind <> 'government_id' or provider is not null
  ),
  /*
   * The data rule, enforced rather than trusted. A vendor payload contains a name, a date
   * of birth and often a document image URL; what may land here is the outcome and the
   * reason codes. Anything else is a rejected insert, which is a bug report, whereas a
   * silently stored date of birth is a disclosure.
   */
  constraint verifications_result_is_minimal check (
    provider_result is null
    or (jsonb_typeof(provider_result) = 'object'
        and not (provider_result ?| array[
          'name', 'first_name', 'last_name', 'birthdate', 'date_of_birth', 'dob',
          'document_number', 'id_number', 'address', 'photo', 'image', 'selfie',
          'document', 'files', 'raw'
        ]))
  )
);

create index verifications_user_idx on public.verifications (user_id, created_at desc);

-- One verified row per path per account. `edu` and `identity` are siblings, so a user may
-- legitimately hold both.
create unique index verifications_one_verified_per_kind
  on public.verifications (user_id, kind) where status = 'verified';

-- And one account per `.edu` address. Sharing a departmental alias would otherwise let one
-- mailbox mint verified accounts indefinitely.
create unique index verifications_one_account_per_edu_email
  on public.verifications (edu_email) where status = 'verified' and edu_email is not null;

create index verifications_pending_token_idx
  on public.verifications (edu_email, created_at desc)
  where status = 'pending' and kind = 'edu_email';

create trigger verifications_set_updated_at
  before update on public.verifications
  for each row execute function public.set_updated_at();

/*
 * §10: "escalation bound to the verification, so a banned user needs a new `.edu` address
 * or a new government ID to return."
 *
 * A ban that only touches the account is a ban on nothing — signup is open to any email.
 * What has to be burned is the *credential*, and the credential is not ours to keep: this
 * table holds a salted digest of the `.edu` address or of the provider's subject reference
 * and nothing that can be read back into either. It is the smallest artefact that makes a
 * ban mean something.
 */
create table public.verification_blocklist (
  kind            public.verification_kind not null,
  identifier_hash text not null,
  reason          text not null,
  created_at      timestamptz not null default now(),
  primary key (kind, identifier_hash)
);

-- ── comments ───────────────────────────────────────────────────────────────────

create table public.comments (
  id                uuid primary key default gen_random_uuid(),
  job_id            uuid not null references public.jobs (id) on delete cascade,
  parent_id         uuid references public.comments (id) on delete cascade,
  author_id         uuid not null references public.profiles (id) on delete cascade,
  body              text not null default '',
  -- An id into the GIF catalogue, not a URL. §3.8, and it keeps the picker's backing store
  -- swappable without rewriting every comment.
  gif_id            text,
  moderation_status public.moderation_status not null default 'pending',
  -- The classifier's per-category scores, kept for the review queue and for tuning the
  -- thresholds against real traffic rather than against intuition. Never client-visible.
  moderation_scores jsonb,
  -- Why it was held or flagged, in words a reviewer can act on.
  moderation_reason text,
  like_count        integer not null default 0,
  reply_count       integer not null default 0,
  /*
   * Supplied by the client through the API service so a retried POST cannot double-post.
   * The comment write path is the one write in the app that is not idempotent by
   * construction — phase 2's toggles set a state, and this one appends — so idempotency has
   * to be carried explicitly. PHASE3.md §5.
   */
  idempotency_key   text,
  created_at        timestamptz not null default now(),
  edited_at         timestamptz,
  deleted_at        timestamptz,

  -- A comment is text, or a GIF, or both. Never neither. §3.8.
  constraint comment_has_content check (length(btrim(body)) > 0 or gif_id is not null),
  constraint comment_body_length check (length(body) <= 500)
);

create unique index comments_author_idempotency_key
  on public.comments (author_id, idempotency_key) where idempotency_key is not null;

-- The thread read: top-level comments for one posting, newest first.
create index comments_job_roots_idx
  on public.comments (job_id, created_at desc, id desc)
  where parent_id is null and deleted_at is null;

-- The replies read: one thread, oldest first.
create index comments_parent_idx
  on public.comments (parent_id, created_at asc, id asc)
  where deleted_at is null;

/*
 * The rate limiter's index — §11's "10/hour, 40/day".
 *
 * README §10 puts that counter in Redis. There is no Redis here and there does not need to
 * be one: the limit is a count of this author's rows in a window, the index answers it in
 * a millisecond, and being in the same transaction as the insert makes it exactly right
 * rather than approximately right. PHASE3.md §4.2 has the argument and the trigger for
 * revisiting it.
 */
create index comments_author_recent_idx on public.comments (author_id, created_at desc);

-- The review queue's read. Partial, because flagged comments are a rounding error against
-- the table and a full index on a status nobody filters by would be paid on every insert.
create index comments_flagged_idx on public.comments (created_at)
  where moderation_status in ('flagged', 'pending');

/*
 * Single-level threads, in the database rather than hoped for in the client.
 *
 * `types/comment.ts` has said "replies are flat" since the first fixture and the sheet is
 * built around it. A nested reply would not crash anything — it would render at the wrong
 * indent, which is the kind of bug that survives for a year.
 */
create or replace function public.enforce_flat_threads()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if new.parent_id is not null
     and (select parent_id from public.comments where id = new.parent_id) is not null then
    raise exception 'replies cannot be nested more than one level' using errcode = '23514';
  end if;
  return new;
end;
$fn$;

create trigger comments_enforce_flat_threads
  before insert or update of parent_id on public.comments
  for each row execute function public.enforce_flat_threads();

create table public.comment_likes (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  comment_id uuid not null references public.comments (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, comment_id)
);

create index comment_likes_comment_idx on public.comment_likes (comment_id);

/*
 * §1.3(b), fixed at last.
 *
 * "`Comment.likeCount` includes the viewer's own like. This is the kind of thing that
 * looks harmless and then produces a UI where unliking decrements to a wrong number.
 * Store the true count; send `viewerHasLiked` separately."
 *
 * Phase 2 left the client folding its own like into the count, and said the two would land
 * together, because there was no stored count for it to be wrong about. This is that
 * count: it is the true total, the viewer's own like arrives through `viewer_state()`, and
 * `CareerDeckContext` no longer adds one to anything.
 */
create or replace function public.sync_comment_like_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if tg_op = 'INSERT' then
    update public.comments set like_count = like_count + 1 where id = new.comment_id;
  else
    update public.comments set like_count = greatest(0, like_count - 1) where id = old.comment_id;
  end if;
  return null;
end;
$fn$;

create trigger comment_likes_sync_count
  after insert or delete on public.comment_likes
  for each row execute function public.sync_comment_like_count();

/*
 * `reply_count` on the parent, maintained here rather than counted per read.
 *
 * The sheet shows "View 3 replies" on every root in the list, so counting would mean a
 * correlated subquery per row on the one read that happens while somebody is waiting. The
 * denormalization is the same trade as `companies.follower_count`, and it gets the same
 * treatment: a nightly reconcile that checks it (see `reconcile_comment_counts()`).
 *
 * A removed comment stops counting, because "View 3 replies" that opens onto two is a bug
 * report from a user who cannot see what is missing.
 */
create or replace function public.sync_comment_reply_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  visible boolean;
  was     boolean;
begin
  visible := new.parent_id is not null
             and new.deleted_at is null
             and new.moderation_status in ('approved', 'flagged');

  if tg_op = 'INSERT' then
    if visible then
      update public.comments set reply_count = reply_count + 1 where id = new.parent_id;
    end if;
    return null;
  end if;

  was := old.parent_id is not null
         and old.deleted_at is null
         and old.moderation_status in ('approved', 'flagged');

  if was and not visible then
    update public.comments set reply_count = greatest(0, reply_count - 1) where id = old.parent_id;
  elsif visible and not was then
    update public.comments set reply_count = reply_count + 1 where id = new.parent_id;
  end if;

  return null;
end;
$fn$;

create trigger comments_sync_reply_count
  after insert or update of deleted_at, moderation_status on public.comments
  for each row execute function public.sync_comment_reply_count();

-- ── blocks, reports, strikes ───────────────────────────────────────────────────

create table public.blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint blocks_not_self check (blocker_id <> blocked_id)
);

-- The thread read needs "did either of these two block the other", in both directions.
create index blocks_blocked_idx on public.blocks (blocked_id, blocker_id);

/*
 * The anonymity contract, as a projection — §3.8.
 *
 * Defined here, after `blocks`, rather than up with the `comments` table it projects: the block
 * filter below references that table, and a view cannot be created before something it reads.
 *
 * Everything the client is ever allowed to see about a comment is in this view, and
 * `author_id` is not in it. Nothing downstream has to remember to leave it out, which is
 * the point: a contract that depends on every future select list being careful is a
 * contract that lasts until the next feature.
 *
 * **Deliberately not `security_invoker`.** An invoker view reads with the caller's own
 * privileges, which would mean granting `authenticated` select on `comments.author_id` — the
 * join needs it — and that is the one column this whole phase exists to keep out of a client's
 * reach. So the view runs as its owner, and everything an invoker view would have got from RLS
 * is written into the `where` clause instead: the visibility filter, and the block filter using
 * `auth.uid()`. `notifications_public` below *can* be an invoker view, because its base table
 * has a column grant that omits `actor_id` and nothing it selects needs the omitted column.
 * The asymmetry is not an inconsistency; it is which projection can be expressed as a grant.
 *
 * `flagged` comments are visible. §10 is explicit that "this company rejected me for no
 * reason" is the speech the product exists for and that over-blocking it makes the comment
 * section worthless, so a flag publishes and queues rather than hides.
 */
create or replace view public.comments_public as
select c.id,
       c.job_id,
       c.parent_id,
       c.body,
       c.gif_id,
       c.like_count,
       c.reply_count,
       c.created_at,
       c.edited_at,
       p.handle::text   as author_handle,
       p.comment_badge  as author_badge,
       p.avatar_color   as author_color
  from public.comments c
  join public.profiles p on p.id = c.author_id
 where c.deleted_at is null
   and c.moderation_status in ('approved', 'flagged')
   -- The block filter lives in the view because the view is the projection, and a reader who
   -- blocked somebody must not meet them again through a different door.
   and not exists (
     select 1 from public.blocks b
      where (b.blocker_id = (select auth.uid()) and b.blocked_id = c.author_id)
         or (b.blocker_id = c.author_id and b.blocked_id = (select auth.uid()))
   );


create table public.reports (
  id          uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  target_type public.report_target not null,
  target_id   uuid not null,
  reason      text not null,
  detail      text,
  status      public.report_status not null default 'open',
  resolved_by uuid references public.profiles (id),
  resolved_at timestamptz,
  created_at  timestamptz not null default now(),
  -- One report per person per thing. A second one is the same information and would let a
  -- group bury a comment by volume.
  unique (reporter_id, target_type, target_id),
  constraint reports_reason_length check (length(btrim(reason)) between 1 and 60),
  constraint reports_detail_length check (detail is null or length(detail) <= 500)
);

-- §10's SLA is 24h on reports and 1h on threats, so the queue reads oldest-open-first.
create index reports_open_idx on public.reports (created_at) where status = 'open';
create index reports_target_idx on public.reports (target_type, target_id);

create table public.user_strikes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  -- 1 warn, 2 mute, 3 ban. §10's ladder.
  severity   smallint not null check (severity between 1 and 3),
  reason     text not null,
  comment_id uuid references public.comments (id) on delete set null,
  issued_by  uuid references public.profiles (id),
  -- Null on a warning (it is a record, not a restriction) and on a ban (it does not lapse).
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create index user_strikes_user_idx on public.user_strikes (user_id, created_at desc);

-- ── notifications ──────────────────────────────────────────────────────────────

/*
 * §3.8. `actor_id` is internal only and never serialized: a like notification that named
 * who liked you would undo the anonymity contract from the other end.
 *
 * `payload` is denormalized on purpose. A notification is read once, months after the
 * thread it describes may have been removed, and joining back to a comment that is gone
 * produces a blank row where a sentence should be.
 */
create table public.notifications (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles (id) on delete cascade,
  kind            public.notification_kind not null,
  subject_type    text,
  subject_id      uuid,
  actor_id        uuid references public.profiles (id) on delete set null,
  aggregate_count integer not null default 1,
  payload         jsonb not null default '{}'::jsonb,
  read_at         timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id, created_at desc)
  where read_at is null;

/*
 * The aggregation key. §3.8: "the third person to like your comment updates
 * `aggregate_count` on the existing row rather than inserting a new one", which is what
 * lets the client render "Priya and 4 others" from one row.
 *
 * Scoped to unread rows only, so a like arriving a week after the last batch was read
 * starts a new notification instead of silently bumping a count on something already
 * dismissed.
 */
create unique index notifications_aggregate_key
  on public.notifications (user_id, kind, subject_id)
  where read_at is null and subject_id is not null and kind = 'comment_like';

create trigger notifications_set_updated_at
  before update on public.notifications
  for each row execute function public.set_updated_at();

/*
 * The one thing the client may read about a notification.
 *
 * Same discipline as `comments_public`: `actor_id` is projected away here rather than in
 * every select list that will ever touch this table. What survives is the payload, which
 * carries the actor's *handle* — a pseudonym is a name you can address a reply to, and a
 * uuid is a name you can look someone up with.
 */
create or replace view public.notifications_public
with (security_invoker = true) as
select n.id,
       n.kind,
       n.subject_type,
       n.subject_id,
       n.aggregate_count,
       n.payload,
       n.read_at,
       n.created_at
  from public.notifications n;

-- ── moderators ─────────────────────────────────────────────────────────────────

/*
 * §10: "a small internal web view over `reports` and flagged comments. Build it before
 * launch, not after the first incident."
 *
 * An allow-list rather than a role on `profiles`, because moderation is a job somebody
 * holds and then stops holding, and a row that can be deleted is a better model of that
 * than a column that has to be reset. Rows are written by the service role only — there is
 * deliberately no way to promote yourself.
 */
create table public.moderators (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  email      text,
  can_ban    boolean not null default false,
  created_at timestamptz not null default now()
);

create or replace function public.is_moderator(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (select 1 from public.moderators m where m.user_id = p_user_id);
$fn$;

-- ── read API ───────────────────────────────────────────────────────────────────

/*
 * A comment as the client is allowed to see it, plus the two things only the reader's own
 * session can answer.
 *
 * `is_own` is viewer-specific, and phase 2 spent a whole section arguing that viewer state
 * must not ride on a shared row. The argument does not apply here and it is worth being
 * precise about why: a feed page is identical for every reader and therefore *cacheable*,
 * which is the property folding viewer state into it would destroy. A thread is not —
 * blocks remove rows from it per reader (§3.8), so it was never a shared object to begin
 * with. Once a response is per-viewer by necessity, keeping a flag off it buys nothing and
 * costs the client a second lookup.
 *
 * `author_id` is still absent. That is not a caching decision, it is the contract.
 */
create type public.comment_card as (
  id            uuid,
  job_id        uuid,
  parent_id     uuid,
  body          text,
  gif_id        text,
  like_count    integer,
  reply_count   integer,
  created_at    timestamptz,
  edited_at     timestamptz,
  author_handle text,
  author_badge  text,
  author_color  text,
  is_own        boolean,
  page_cursor   text
);

/*
 * One posting's top-level comments, newest first.
 *
 * Roots only. The sheet shows "View 3 replies" and fetches a thread when it is opened,
 * which is also what keeps this read bounded: a posting with a 200-reply argument on one
 * comment returns twenty rows here, not two hundred.
 *
 * The block filter runs in **both directions**. Blocking someone has to stop their replies
 * reaching you *and* stop yours reaching them, or a block becomes a way to keep talking at
 * somebody who has asked you to stop.
 */
create or replace function public.job_comments(
  p_job_id uuid,
  p_cursor text default null,
  p_limit  integer default 20
)
returns setof public.comment_card
language sql
stable
security definer
set search_path = ''
as $fn$
  with args as (
    select (select auth.uid())                                        as uid,
           least(greatest(coalesce(p_limit, 20), 1), 50)              as lim,
           public.decode_cursor(p_cursor)                             as cur
  )
  select c.id,
         c.job_id,
         c.parent_id,
         c.body,
         c.gif_id,
         c.like_count,
         c.reply_count,
         c.created_at,
         c.edited_at,
         p.handle::text,
         p.comment_badge,
         p.avatar_color,
         c.author_id = a.uid,
         public.encode_cursor(to_char(c.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.USOF'), c.id)
    from public.comments c
    join public.profiles p on p.id = c.author_id
   cross join args a
   where c.job_id = p_job_id
     and c.parent_id is null
     and c.deleted_at is null
     and c.moderation_status in ('approved', 'flagged')
     and not exists (
       select 1 from public.blocks b
        where (b.blocker_id = a.uid and b.blocked_id = c.author_id)
           or (b.blocker_id = c.author_id and b.blocked_id = a.uid)
     )
     and (a.cur is null
          or (c.created_at, c.id) < ((a.cur ->> 'v')::timestamptz, (a.cur ->> 'i')::uuid))
   order by c.created_at desc, c.id desc
   limit (select lim from args);
$fn$;

/*
 * One thread's replies, oldest first — a reply chain read backwards is not a conversation.
 *
 * Unpaginated and capped. A thread long enough to need a second page is a thread that has
 * become an argument, and the cap is a cheaper answer than a cursor nothing would use; if
 * that turns out to be wrong, this function grows a cursor and the sheet grows a "load
 * more", and nothing else changes.
 */
create or replace function public.comment_replies(
  p_comment_id uuid,
  p_limit      integer default 100
)
returns setof public.comment_card
language sql
stable
security definer
set search_path = ''
as $fn$
  with args as (
    select (select auth.uid()) as uid,
           least(greatest(coalesce(p_limit, 100), 1), 200) as lim
  )
  select c.id, c.job_id, c.parent_id, c.body, c.gif_id, c.like_count, c.reply_count,
         c.created_at, c.edited_at, p.handle::text, p.comment_badge, p.avatar_color,
         c.author_id = a.uid,
         null::text
    from public.comments c
    join public.profiles p on p.id = c.author_id
   cross join args a
   where c.parent_id = p_comment_id
     and c.deleted_at is null
     and c.moderation_status in ('approved', 'flagged')
     and not exists (
       select 1 from public.blocks b
        where (b.blocker_id = a.uid and b.blocked_id = c.author_id)
           or (b.blocker_id = c.author_id and b.blocked_id = a.uid)
     )
   order by c.created_at asc, c.id asc
   limit (select lim from args);
$fn$;

/*
 * Comment totals for the postings a screen is holding — the number on a reel's comment
 * action.
 *
 * **This deliberately does not live on `job_card`.** Adding `comment_count` to the feed
 * composite would put a counter that changes every few seconds inside a page whose whole
 * value is being byte-identical for every reader, and phase 2 already established where
 * that leads: the page stops being cacheable, and it stops being cacheable for a number
 * nobody is looking at while they scroll. So the volatile counter travels separately, on
 * the same principle as viewer state and for the same reason. PHASE3.md §3.
 *
 * Viewer-independent, unlike `job_comments` above: a blocked author's comments are hidden
 * from a thread, but subtracting them from a count would tell the reader how many comments
 * they are not being shown, which is information about somebody they asked not to hear
 * from.
 */
create or replace function public.comment_counts(p_job_ids uuid[])
returns table (job_id uuid, comment_count integer)
language sql
stable
security definer
set search_path = ''
as $fn$
  select c.job_id, count(*)::integer
    from public.comments c
   where c.job_id = any (p_job_ids[1:200])
     and c.deleted_at is null
     and c.moderation_status in ('approved', 'flagged')
   group by c.job_id;
$fn$;

/*
 * Phase 2's `viewer_sets`, plus the viewer's comment likes.
 *
 * One attribute rather than a second round trip: this read already exists, already runs
 * once per session, and §1.3(b) needs `viewerHasLiked` to arrive *separately from* the
 * stored count — which is precisely what this composite is for. `cascade` because the type
 * is a function return type and Postgres wants to be told the dependency is understood.
 */
alter type public.viewer_sets add attribute liked_comment_ids uuid[] cascade;

create or replace function public.viewer_state(p_limit integer default 2000)
returns public.viewer_sets
language sql
stable
as $fn$
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
    array(select c.slug::text from public.company_follows f
            join public.companies c on c.id = f.company_id
           where f.user_id = (select auth.uid())
           order by f.created_at desc limit p_limit),
    array(select l.comment_id from public.comment_likes l
           where l.user_id = (select auth.uid())
           order by l.created_at desc limit p_limit);
$fn$;

/*
 * Everything the composer needs to know before the user starts typing.
 *
 * The alternative is letting them write four hundred characters and then explaining that
 * unverified accounts cannot comment, which is the worst possible moment to say it. All of
 * it is computed here rather than assembled from three client-side checks, because the
 * write path enforces exactly these rules and two implementations of one rule drift.
 *
 * `remaining_hour` / `remaining_day` are the same counts `post_comment()` enforces, so the
 * composer can say "you have said a lot today" before the server has to.
 */
create type public.comment_gate_state as (
  can_comment     boolean,
  tier            public.verification_tier,
  handle          text,
  badge           text,
  policy_version  text,
  policy_accepted boolean,
  muted_until     timestamptz,
  banned          boolean,
  remaining_hour  integer,
  remaining_day   integer
);

create or replace function public.comment_gate()
returns public.comment_gate_state
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  uid        uuid := (select auth.uid());
  state      public.comment_gate_state;
  used_hour  integer := 0;
  used_day   integer := 0;
begin
  if uid is null then
    return state;
  end if;

  select p.verification_tier,
         p.handle::text,
         p.comment_badge,
         p.content_policy_version,
         p.content_policy_accepted_at is not null
    into state.tier, state.handle, state.badge, state.policy_version, state.policy_accepted
    from public.profiles p
   where p.id = uid;

  select max(s.expires_at) filter (where s.severity = 2 and s.expires_at > now()),
         bool_or(s.severity = 3)
    into state.muted_until, state.banned
    from public.user_strikes s
   where s.user_id = uid;

  state.banned := coalesce(state.banned, false);

  select count(*) filter (where c.created_at > now() - interval '1 hour'),
         count(*) filter (where c.created_at > now() - interval '1 day')
    into used_hour, used_day
    from public.comments c
   where c.author_id = uid
     and c.created_at > now() - interval '1 day';

  state.remaining_hour := greatest(0, 10 - used_hour);
  state.remaining_day  := greatest(0, 40 - used_day);

  /*
   * `policy_accepted` is part of this and not merely reported alongside it.
   *
   * `post_comment()` raises CD003 for an unread policy, so a gate that said yes while the write
   * path said no would put the composer in exactly the state §10's first-comment sheet exists to
   * prevent: the user types four hundred characters and *then* learns there is a document to
   * read. The client reads `policy_accepted` separately to know which of the two things to show
   * them — the sheet, or the reason they cannot write at all.
   */
  state.can_comment := state.tier in ('edu', 'identity')
                       and coalesce(state.policy_accepted, false)
                       and not state.banned
                       and state.muted_until is null
                       and state.remaining_hour > 0
                       and state.remaining_day > 0;

  return state;
end;
$fn$;

-- ── write API (the reader's own actions) ────────────────────────────────────────

/*
 * A comment like, set to a state rather than flipped — phase 2's contract, unchanged,
 * because these go through the same outbox and a replayed toggle must not invert.
 *
 * Refuses a comment that is not visible to this reader. Without that check a client could
 * like a removed comment, which would resurrect its count in the review queue and give a
 * brigading group a way to signal each other through a comment nobody else can see.
 */
create or replace function public.set_comment_like(p_comment_id uuid, p_on boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then
    raise exception 'set_comment_like requires an authenticated user' using errcode = '28000';
  end if;

  if p_on then
    if not exists (
      select 1 from public.comments c
       where c.id = p_comment_id
         and c.deleted_at is null
         and c.moderation_status in ('approved', 'flagged')
         and not exists (
           select 1 from public.blocks b
            where (b.blocker_id = uid and b.blocked_id = c.author_id)
               or (b.blocker_id = c.author_id and b.blocked_id = uid)
         )
    ) then
      raise exception 'no such comment' using errcode = '23503';
    end if;

    insert into public.comment_likes (user_id, comment_id)
    values (uid, p_comment_id)
    on conflict (user_id, comment_id) do nothing;
  else
    -- Unliking is never refused, whatever happened to the comment in between. A like the
    -- reader cannot withdraw is a worse outcome than a stale count.
    delete from public.comment_likes where user_id = uid and comment_id = p_comment_id;
  end if;

  return exists (
    select 1 from public.comment_likes where user_id = uid and comment_id = p_comment_id
  );
end;
$fn$;

/*
 * Deleting your own comment, and the replies hanging off it.
 *
 * Soft, per §3's convention for anything a user authored: the row stays, because a comment
 * that produced a report or a strike is evidence, and evidence a user can erase is not
 * evidence. What the reader gets is the comment gone from every read, which is the whole of
 * what they asked for.
 *
 * Replies go with it. An orphaned reply reads as a non sequitur, and promoting it to the top
 * level — which is what the fixture-backed version did — publishes somebody's answer as
 * though it were a statement.
 */
create or replace function public.delete_own_comment(p_comment_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  uid     uuid := (select auth.uid());
  removed integer;
begin
  if uid is null then
    raise exception 'delete_own_comment requires an authenticated user' using errcode = '28000';
  end if;

  update public.comments
     set deleted_at = now()
   where id = p_comment_id
     and author_id = uid
     and deleted_at is null;

  get diagnostics removed = row_count;
  if removed = 0 then
    return false;
  end if;

  -- Replies by anyone, including other people's. They were answers to something that is
  -- no longer there.
  update public.comments
     set deleted_at = now()
   where parent_id = p_comment_id
     and deleted_at is null;

  return true;
end;
$fn$;

/*
 * Reporting, keyed by the comment.
 *
 * §10 wants "a report path that reaches a human within 24h", and this is its front door.
 * Reporting the *author* rather than the comment is the `profile` variant, which is the
 * right target for "this account follows me around" — and note that the caller still names
 * a comment, because the client has no other handle on a person. The author is resolved
 * here and the reporter never learns who it was.
 */
create or replace function public.report_content(
  p_comment_id uuid,
  p_reason     text,
  p_detail     text default null,
  p_target     public.report_target default 'comment'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  uid       uuid := (select auth.uid());
  author    uuid;
  target    uuid;
  report_id uuid;
begin
  if uid is null then
    raise exception 'report_content requires an authenticated user' using errcode = '28000';
  end if;

  select c.author_id into author from public.comments c where c.id = p_comment_id;
  if author is null then
    raise exception 'no such comment' using errcode = '23503';
  end if;

  if author = uid then
    raise exception 'a comment cannot be reported by its author' using errcode = 'CD006';
  end if;

  target := case when p_target = 'profile' then author else p_comment_id end;

  insert into public.reports (reporter_id, target_type, target_id, reason, detail)
  values (uid, p_target, target, btrim(p_reason), nullif(btrim(coalesce(p_detail, '')), ''))
  on conflict (reporter_id, target_type, target_id) do update
    -- A second report on the same thing replaces the detail rather than raising: the user
    -- pressed the button again because they had more to say, not because they wanted an
    -- error.
    set detail = coalesce(excluded.detail, reports.detail)
  returning id into report_id;

  return report_id;
end;
$fn$;

/*
 * Blocking, keyed by the comment — the anonymity contract's most visible consequence.
 *
 * The client cannot name a person, so it names something they said and the author is
 * resolved here. §3.8's projection is what makes that necessary, and it is also what makes
 * it safe: the reader never learns the uuid they just blocked, so a block cannot be used to
 * correlate two pseudonyms.
 *
 * The block is one-directional in the table and two-directional in effect (see
 * `job_comments`). A reader who blocks somebody should not have to also be invisible to
 * them for it to work.
 */
create or replace function public.set_block_from_comment(p_comment_id uuid, p_on boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  uid    uuid := (select auth.uid());
  author uuid;
begin
  if uid is null then
    raise exception 'set_block_from_comment requires an authenticated user' using errcode = '28000';
  end if;

  select c.author_id into author from public.comments c where c.id = p_comment_id;
  if author is null then
    raise exception 'no such comment' using errcode = '23503';
  end if;

  if author = uid then
    raise exception 'an account cannot block itself' using errcode = '23514';
  end if;

  if p_on then
    insert into public.blocks (blocker_id, blocked_id)
    values (uid, author)
    on conflict (blocker_id, blocked_id) do nothing;
  else
    delete from public.blocks where blocker_id = uid and blocked_id = author;
  end if;

  return exists (select 1 from public.blocks where blocker_id = uid and blocked_id = author);
end;
$fn$;

/*
 * §10: "a clear content policy shown at first comment."
 *
 * The version is the client's, checked against nothing — the policy text ships in the app
 * and in docs/CONTENT-POLICY.md, and the only thing the database can honestly record is
 * which version the app said it showed. Recording that is still worth doing: it is the
 * difference between "users agree to a policy" and "this account was shown v1 on this
 * date".
 */
create or replace function public.accept_content_policy(p_version text)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  uid uuid := (select auth.uid());
  at  timestamptz := now();
begin
  if uid is null then
    raise exception 'accept_content_policy requires an authenticated user' using errcode = '28000';
  end if;

  update public.profiles
     set content_policy_accepted_at = at,
         content_policy_version     = nullif(btrim(p_version), '')
   where id = uid;

  return at;
end;
$fn$;

create or replace function public.mark_notifications_read(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  uid     uuid := (select auth.uid());
  touched integer;
begin
  if uid is null then
    raise exception 'mark_notifications_read requires an authenticated user' using errcode = '28000';
  end if;

  update public.notifications
     set read_at = now()
   where user_id = uid
     and read_at is null
     and (p_ids is null or id = any (p_ids));

  get diagnostics touched = row_count;
  return touched;
end;
$fn$;

-- ── the comment write path (service role only) ──────────────────────────────────

/*
 * §10's pipeline, with the classifier's verdict as an argument.
 *
 * ```
 * POST /v1/comments
 *   → verify tier ∈ (edu, identity)        else 403
 *   → rate limit                           else 429
 *   → moderation classifier (~50–200ms)
 *       block → 422 with a reason the user can act on
 *       flag  → insert approved + review queue
 *       pass  → insert approved
 *   → return; realtime broadcast to the thread
 * ```
 *
 * The classifier is the only step the database cannot do: it needs a secret and a model.
 * Everything else is in here, and that split is the whole design. The API service knows who
 * the caller is and what the classifier said; it does not get to decide whether an
 * unverified, muted or rate-limited account may comment, because the day that logic lives in
 * two places is the day they disagree. PHASE3.md §4.
 *
 * Errors carry distinguishable SQLSTATEs so the service can map them to status codes without
 * matching on message text:
 *
 *   CD001  not verified            → 403
 *   CD002  muted or banned         → 403
 *   CD003  content policy unread   → 428
 *   CD004  rate limited            → 429
 *   CD005  the parent author has blocked this reader, or vice versa → 403
 *   23503  no such job or parent    → 404
 *   23514  malformed (empty, nested reply, too long) → 422
 */
create or replace function public.post_comment(
  p_author_id       uuid,
  p_job_id          uuid,
  p_body            text,
  p_parent_id       uuid default null,
  p_gif_id          text default null,
  p_status          public.moderation_status default 'approved',
  p_scores          jsonb default null,
  p_reason          text default null,
  p_idempotency_key text default null
)
returns public.comment_card
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  tier         public.verification_tier;
  policy_at    timestamptz;
  muted_until  timestamptz;
  banned       boolean;
  used_hour    integer;
  used_day     integer;
  parent_author uuid;
  body         text := btrim(coalesce(p_body, ''));
  existing     uuid;
  new_id       uuid;
  card         public.comment_card;
begin
  if p_author_id is null then
    raise exception 'post_comment requires an author' using errcode = '28000';
  end if;

  /*
   * Idempotency first, before any of the checks below.
   *
   * A retried POST — the response was lost, the phone changed networks, the user pressed the
   * arrow twice — must return the comment that already exists rather than a rate-limit
   * error, which is what checking the limits first would produce on the second attempt.
   */
  if p_idempotency_key is not null then
    select id into existing
      from public.comments
     where author_id = p_author_id and idempotency_key = p_idempotency_key;

    if existing is not null then
      select * into card from public.comment_card_of(existing, p_author_id);
      return card;
    end if;
  end if;

  select p.verification_tier, p.content_policy_accepted_at
    into tier, policy_at
    from public.profiles p
   where p.id = p_author_id;

  if tier is null then
    raise exception 'no profile for this account' using errcode = '23503';
  end if;

  -- §3.2's ladder. `edu` and `identity` are siblings and both open this door; `email` does
  -- not, and that is the entire point of having a ladder.
  if tier not in ('edu', 'identity') then
    raise exception 'commenting requires a verified account' using errcode = 'CD001';
  end if;

  select max(s.expires_at) filter (where s.severity = 2 and s.expires_at > now()),
         coalesce(bool_or(s.severity = 3), false)
    into muted_until, banned
    from public.user_strikes s
   where s.user_id = p_author_id;

  if banned then
    raise exception 'this account is banned from commenting' using errcode = 'CD002';
  end if;

  if muted_until is not null then
    raise exception 'this account is muted until %', muted_until using errcode = 'CD002';
  end if;

  if policy_at is null then
    raise exception 'the content policy has not been accepted' using errcode = 'CD003';
  end if;

  select count(*) filter (where c.created_at > now() - interval '1 hour'),
         count(*) filter (where c.created_at > now() - interval '1 day')
    into used_hour, used_day
    from public.comments c
   where c.author_id = p_author_id
     and c.created_at > now() - interval '1 day';

  if used_hour >= 10 then
    raise exception 'too many comments in the last hour' using errcode = 'CD004';
  end if;

  if used_day >= 40 then
    raise exception 'too many comments today' using errcode = 'CD004';
  end if;

  if body = '' and p_gif_id is null then
    raise exception 'a comment needs text or a GIF' using errcode = '23514';
  end if;

  if length(body) > 500 then
    raise exception 'a comment cannot be longer than 500 characters' using errcode = '23514';
  end if;

  if not exists (select 1 from public.jobs j where j.id = p_job_id) then
    raise exception 'no such posting' using errcode = '23503';
  end if;

  if p_parent_id is not null then
    select c.author_id into parent_author
      from public.comments c
     where c.id = p_parent_id
       and c.job_id = p_job_id
       and c.deleted_at is null;

    if parent_author is null then
      raise exception 'no such comment on this posting' using errcode = '23503';
    end if;

    -- A block has to stop a reply, not just hide one. Letting the row be written and
    -- filtered on read would leave the replier believing they had been heard.
    if exists (
      select 1 from public.blocks b
       where (b.blocker_id = p_author_id and b.blocked_id = parent_author)
          or (b.blocker_id = parent_author and b.blocked_id = p_author_id)
    ) then
      raise exception 'this reply cannot be delivered' using errcode = 'CD005';
    end if;
  end if;

  insert into public.comments (
    job_id, parent_id, author_id, body, gif_id,
    moderation_status, moderation_scores, moderation_reason, idempotency_key
  )
  values (
    p_job_id, p_parent_id, p_author_id, body, nullif(btrim(coalesce(p_gif_id, '')), ''),
    p_status, p_scores, nullif(btrim(coalesce(p_reason, '')), ''), p_idempotency_key
  )
  returning id into new_id;

  select * into card from public.comment_card_of(new_id, p_author_id);
  return card;
end;
$fn$;

/*
 * One comment, as its own author sees it. Used by `post_comment` to answer with the row it
 * just wrote, so the client does not have to re-read the thread to see its own comment.
 *
 * `security definer` and *not* granted to anybody: it is only ever reached from inside
 * another definer function, which is why it can take the viewer as an argument instead of
 * reading `auth.uid()`.
 */
create or replace function public.comment_card_of(p_comment_id uuid, p_viewer uuid)
returns public.comment_card
language sql
stable
security definer
set search_path = ''
as $fn$
  select c.id, c.job_id, c.parent_id, c.body, c.gif_id, c.like_count, c.reply_count,
         c.created_at, c.edited_at, p.handle::text, p.comment_badge, p.avatar_color,
         c.author_id = p_viewer,
         null::text
    from public.comments c
    join public.profiles p on p.id = c.author_id
   where c.id = p_comment_id;
$fn$;

-- ── realtime on threads ────────────────────────────────────────────────────────

/*
 * §15: "Realtime on threads."
 *
 * Broadcast from the database, **not** `postgres_changes`. That is not a style preference —
 * a changefeed on `comments` sends the whole row, and the whole row contains `author_id`.
 * Subscribing to a table whose entire read path exists to project one column away would
 * hand every listener the column. So the trigger composes exactly the `comments_public`
 * shape and sends that.
 *
 * The topic is per posting (`job:<uuid>:comments`) and private, so the subscription is
 * authorized by a policy on `realtime.messages` (below) rather than open to anyone holding
 * the publishable key.
 *
 * `realtime.send` swallows its own errors as a warning, by design. A thread whose live
 * updates fail should fall back to being a thread you pull to refresh — not a thread you
 * cannot post to.
 */
create or replace function public.broadcast_comment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  row_v    public.comments;
  visible  boolean;
  event    text;
  payload  jsonb;
begin
  row_v := case when tg_op = 'DELETE' then old else new end;

  visible := row_v.deleted_at is null
             and row_v.moderation_status in ('approved', 'flagged');

  if tg_op = 'INSERT' then
    if not visible then
      return null;
    end if;
    event := 'comment_added';
  elsif visible then
    event := 'comment_changed';
  else
    event := 'comment_removed';
  end if;

  if event = 'comment_removed' then
    -- Only the id. A removal does not need to re-transmit what was said, and a moderation
    -- removal that broadcast the body would republish the thing that was removed.
    payload := jsonb_build_object('id', row_v.id, 'parent_id', row_v.parent_id);
  else
    select jsonb_build_object(
             'id', row_v.id,
             'job_id', row_v.job_id,
             'parent_id', row_v.parent_id,
             'body', row_v.body,
             'gif_id', row_v.gif_id,
             'like_count', row_v.like_count,
             'reply_count', row_v.reply_count,
             'created_at', row_v.created_at,
             'edited_at', row_v.edited_at,
             'author_handle', p.handle::text,
             'author_badge', p.comment_badge,
             'author_color', p.avatar_color
           )
      into payload
      from public.profiles p
     where p.id = row_v.author_id;
  end if;

  perform realtime.send(
    payload,
    event,
    'job:' || row_v.job_id::text || ':comments',
    true
  );

  return null;
end;
$fn$;

create trigger comments_broadcast
  after insert or update of body, gif_id, deleted_at, moderation_status, like_count
  on public.comments
  for each row execute function public.broadcast_comment();

/*
 * Who may listen.
 *
 * Any signed-in reader may subscribe to any posting's comment topic, because any signed-in
 * reader may already read that posting's comments. What they may not do is *send* on it —
 * there is no insert policy, so a client cannot broadcast a comment that was never written,
 * which is exactly the attack a public broadcast channel invites.
 */
create policy comment_topics_readable_by_authenticated
  on realtime.messages
  for select
  to authenticated
  using (realtime.topic() like 'job:%:comments');

-- ── notifications fan-out ──────────────────────────────────────────────────────

/*
 * §3.8's "derived, aggregated feed", derived here rather than by a job.
 *
 * A reply notification is written in the same transaction as the reply. The alternative — a
 * queue worker — buys throughput this table does not need and costs the property that
 * matters: a notification cannot exist for a comment that was rolled back, and a comment
 * cannot land without its notification.
 *
 * Nothing is written for a comment on your own thread by yourself, and nothing is written
 * when either party has blocked the other: a notification is a delivery, and a block means
 * do not deliver.
 */
create or replace function public.notify_comment_reply()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  parent_author uuid;
  parent_body   text;
  actor_handle  text;
  actor_color   text;
begin
  if new.parent_id is null or new.moderation_status not in ('approved', 'flagged') then
    return null;
  end if;

  select c.author_id, c.body into parent_author, parent_body
    from public.comments c where c.id = new.parent_id;

  if parent_author is null or parent_author = new.author_id then
    return null;
  end if;

  if exists (
    select 1 from public.blocks b
     where (b.blocker_id = parent_author and b.blocked_id = new.author_id)
        or (b.blocker_id = new.author_id and b.blocked_id = parent_author)
  ) then
    return null;
  end if;

  select p.handle::text, p.avatar_color into actor_handle, actor_color
    from public.profiles p where p.id = new.author_id;

  insert into public.notifications (user_id, kind, subject_type, subject_id, actor_id, payload)
  values (
    parent_author,
    'comment_reply',
    'comment',
    new.id,
    new.author_id,
    jsonb_build_object(
      'job_id', new.job_id,
      'parent_id', new.parent_id,
      -- Quoted back, because §3.8's card shows what the reply answers and the thread it
      -- answers may be gone by the time this is read.
      'your_comment', left(parent_body, 280),
      'reply_body', left(new.body, 280),
      'actor_handle', actor_handle,
      'actor_color', actor_color
    )
  );

  return null;
end;
$fn$;

create trigger comments_notify_reply
  after insert on public.comments
  for each row execute function public.notify_comment_reply();

/*
 * Like notifications aggregate — §3.8, and `CommentActivity.likeCount` in the client has
 * anticipated it since the first fixture ("Priya and 4 others").
 *
 * The third person to like your comment bumps `aggregate_count` on the unread row rather
 * than inserting a fourth notification. `actor_id` ends up being the most recent liker,
 * which is the one the sentence names.
 *
 * The count is recomputed from `comment_likes` rather than incremented, and that is the whole
 * subtlety here. Incrementing looks equivalent and is not: unliking deliberately does not
 * decrement — "somebody liked your comment and then thought better of it" is not a thing to tell
 * anybody — so a reader who toggles a like four times would add four to a counter that is
 * supposed to read "and 4 others". Recomputing makes the sentence true by construction and makes
 * toggling inert.
 */
create or replace function public.notify_comment_like()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  target_author uuid;
  target_body   text;
  target_job    uuid;
  actor_handle  text;
  actor_color   text;
begin
  select c.author_id, c.body, c.job_id into target_author, target_body, target_job
    from public.comments c
   where c.id = new.comment_id
     and c.deleted_at is null;

  if target_author is null or target_author = new.user_id then
    return null;
  end if;

  if exists (
    select 1 from public.blocks b
     where (b.blocker_id = target_author and b.blocked_id = new.user_id)
        or (b.blocker_id = new.user_id and b.blocked_id = target_author)
  ) then
    return null;
  end if;

  select p.handle::text, p.avatar_color into actor_handle, actor_color
    from public.profiles p where p.id = new.user_id;

  insert into public.notifications (user_id, kind, subject_type, subject_id, actor_id, payload)
  values (
    target_author, 'comment_like', 'comment', new.comment_id, new.user_id,
    jsonb_build_object(
      'job_id', target_job,
      'your_comment', left(target_body, 280),
      'actor_handle', actor_handle,
      'actor_color', actor_color
    )
  )
  on conflict (user_id, kind, subject_id) where read_at is null and subject_id is not null and kind = 'comment_like'
  do update set aggregate_count = (
                  select count(*) from public.comment_likes l where l.comment_id = new.comment_id
                ),
                actor_id        = excluded.actor_id,
                payload         = excluded.payload,
                created_at      = now();

  return null;
end;
$fn$;

create trigger comment_likes_notify
  after insert on public.comment_likes
  for each row execute function public.notify_comment_like();

/*
 * The notification a moderation action produces.
 *
 * §10: "do not silently revoke — notify, give a grace period, offer the ID path, then
 * downgrade the badge (not the account)." The same instinct applies to a removal: a comment
 * that vanishes without explanation reads as a bug, and the user's next move is to post it
 * again.
 */
create or replace function public.notify_moderation(
  p_user_id uuid,
  p_headline text,
  p_detail text default null,
  p_kind public.notification_kind default 'moderation',
  p_subject_id uuid default null
)
returns uuid
language sql
security definer
set search_path = ''
as $fn$
  insert into public.notifications (user_id, kind, subject_type, subject_id, payload)
  values (
    p_user_id, p_kind,
    case when p_subject_id is null then null else 'comment' end,
    p_subject_id,
    jsonb_build_object('headline', p_headline, 'detail', p_detail)
  )
  returning id;
$fn$;

-- ── verification (service role only) ───────────────────────────────────────────

/*
 * §3.2's edu path, step one: check the address is verifiable and record the token's hash.
 *
 * Service-role only because delivering the code needs an email provider, which needs a
 * secret. The token itself never reaches this function — only a digest of it, so this table
 * cannot be read back into a way to verify somebody's account.
 *
 * Returns the school so the service can name it in the email ("Confirm your Purdue
 * address"), which is the difference between a code somebody types and a code somebody
 * deletes as phishing.
 */
create or replace function public.start_edu_verification(
  p_user_id          uuid,
  p_email            text,
  p_token_hash       text,
  p_identifier_hash  text,
  p_ttl_minutes      integer default 30
)
returns table (verification_id uuid, school_id uuid, school_name text)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  email   extensions.citext := lower(btrim(p_email))::extensions.citext;
  domain  extensions.citext;
  school  public.schools;
  vid     uuid;
  recent  integer;
begin
  if position('@' in email::text) = 0 then
    raise exception 'that is not an email address' using errcode = '22P02';
  end if;

  domain := split_part(email::text, '@', 2)::extensions.citext;

  /*
   * A banned account's credential. §10's escalation is only real if the thing that was
   * verified cannot verify again — otherwise a ban costs the price of a new signup.
   */
  if exists (
    select 1 from public.verification_blocklist
     where kind = 'edu_email' and identifier_hash = p_identifier_hash
  ) then
    raise exception 'that address cannot be used to verify an account' using errcode = 'CD007';
  end if;

  select s.* into school
    from public.schools s
   where domain = any (s.email_domains)
   limit 1;

  if school.id is null then
    /*
     * Not an error the user can fix by trying harder, so it says so explicitly and the
     * client routes them to the ID path. §3.2: "the student whose university uses a
     * `.ac.uk`-style domain: they get in via the ID path."
     */
    raise exception 'no school is registered for the domain %', domain using errcode = 'CD008';
  end if;

  if exists (
    select 1 from public.verifications v
     where v.edu_email = email and v.status = 'verified' and v.user_id <> p_user_id
  ) then
    raise exception 'that address has already verified another account' using errcode = 'CD009';
  end if;

  -- Three codes in ten minutes is somebody enumerating addresses, not somebody who did not
  -- get the email.
  select count(*) into recent
    from public.verifications v
   where v.user_id = p_user_id
     and v.kind = 'edu_email'
     and v.created_at > now() - interval '10 minutes';

  if recent >= 3 then
    raise exception 'too many verification attempts' using errcode = 'CD004';
  end if;

  -- Supersede this account's outstanding attempts, so the newest code is the only one that
  -- works and an older email cannot be replayed.
  update public.verifications
     set status = 'expired'
   where user_id = p_user_id and kind = 'edu_email' and status = 'pending';

  insert into public.verifications (
    user_id, kind, status, edu_email, edu_domain, school_id, token_hash, token_expires_at
  )
  values (
    p_user_id, 'edu_email', 'pending', email, domain, school.id, p_token_hash,
    now() + make_interval(mins => greatest(coalesce(p_ttl_minutes, 30), 1))
  )
  returning id into vid;

  return query select vid, school.id, coalesce(nullif(btrim(school.short_name), ''), school.name);
end;
$fn$;

/*
 * Step two: the code came back. Grants the tier, sets `school_id` — which is what makes the
 * badge appear, because §3.1's trigger reads `school_id` and never the free-text school —
 * and dates the address's expiry.
 *
 * Two years, per §3.2's quarterly re-challenge. An address that outlives its student is the
 * one credential in the system that decays on its own, and pretending otherwise is how a
 * graduate keeps a "CS @ Purdue '27" badge in 2034.
 */
create or replace function public.confirm_edu_verification(
  p_user_id    uuid,
  p_token_hash text
)
returns table (verification_id uuid, school_name text, badge text)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v public.verifications;
begin
  select * into v
    from public.verifications
   where user_id = p_user_id
     and kind = 'edu_email'
     and status = 'pending'
     and token_hash = p_token_hash
     and token_expires_at > now()
   order by created_at desc
   limit 1;

  if v.id is null then
    -- Count the miss against the newest outstanding attempt, and burn it after five. A code
    -- that can be guessed forever is a six-digit password.
    update public.verifications
       set attempts = attempts + 1,
           status   = case when attempts + 1 >= 5 then 'failed' else status end
     where id = (
       select id from public.verifications
        where user_id = p_user_id and kind = 'edu_email' and status = 'pending'
        order by created_at desc limit 1
     );

    raise exception 'that code is wrong or has expired' using errcode = 'CD010';
  end if;

  update public.verifications
     set status      = 'verified',
         verified_at = now(),
         expires_at  = now() + interval '2 years',
         token_hash  = null
   where id = v.id;

  update public.profiles
     set school_id         = v.school_id,
         school_name_raw   = coalesce(school_name_raw, (select s.name from public.schools s where s.id = v.school_id)),
         -- `identity` is not a higher rung than `edu` — they are siblings (§3.2) — so an
         -- account that already passed the ID check keeps that tier and gains the badge.
         verification_tier = case when verification_tier = 'identity'
                             then 'identity'::public.verification_tier
                             else 'edu'::public.verification_tier end
   where id = p_user_id;

  perform public.notify_moderation(
    p_user_id,
    'Your school email is verified',
    'You can comment on postings now. Your comments show your school and year, never your name.',
    'verification'
  );

  return query
    select v.id,
           coalesce(nullif(btrim(s.short_name), ''), s.name),
           p.comment_badge
      from public.schools s
      join public.profiles p on p.id = p_user_id
     where s.id = v.school_id;
end;
$fn$;

/*
 * §3.2's ID path, as the webhook sees it.
 *
 * **What this function is allowed to store is the whole point.** `p_result` is checked
 * against the constraint on `verifications.provider_result`, which rejects a name, a date of
 * birth, a document number or an image reference. The vendor holds all of that and is
 * contractually responsible for it; the moment it lands here we have inherited a
 * breach-notification obligation nobody wants.
 *
 * The badge is generic — "Verified", no school claim — because passing a personhood check
 * says a person exists, not where they study.
 */
create or replace function public.record_identity_verification(
  p_user_id         uuid,
  p_provider        text,
  p_provider_ref    text,
  p_passed          boolean,
  p_result          jsonb default null,
  p_identifier_hash text default null
)
returns public.verification_tier
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  tier public.verification_tier;
begin
  if p_identifier_hash is not null and p_passed and exists (
    select 1 from public.verification_blocklist
     where kind = 'government_id' and identifier_hash = p_identifier_hash
  ) then
    raise exception 'that identity cannot be used to verify an account' using errcode = 'CD007';
  end if;

  insert into public.verifications (
    user_id, kind, status, provider, provider_ref, provider_result, verified_at
  )
  values (
    p_user_id, 'government_id',
    case when p_passed then 'verified'::public.verification_status
         else 'failed'::public.verification_status end,
    p_provider, p_provider_ref, p_result,
    case when p_passed then now() end
  )
  on conflict do nothing;

  if not p_passed then
    return (select verification_tier from public.profiles where id = p_user_id);
  end if;

  update public.profiles
     set verification_tier = case when verification_tier = 'edu'
                                 then 'edu'::public.verification_tier
                                 else 'identity'::public.verification_tier end
   where id = p_user_id
  returning verification_tier into tier;

  perform public.notify_moderation(
    p_user_id,
    'You are verified',
    'You can comment on postings now. Your comments show a Verified badge and nothing else about you.',
    'verification'
  );

  return tier;
end;
$fn$;

/*
 * §3.2: "Run a quarterly job that re-challenges `edu` verifications older than ~2 years. Do
 * not silently revoke — notify, give a grace period, offer the ID path, then downgrade the
 * badge (not the account)."
 *
 * All four steps are here, in the order that sentence puts them. The first pass notifies and
 * leaves everything intact; a second pass thirty days later is what downgrades. An account
 * that also holds an ID verification loses nothing, which is the ladder working as designed.
 */
create or replace function public.expire_edu_verifications(p_grace_days integer default 30)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  notified integer := 0;
  expired  integer := 0;
begin
  -- Step one: warn everything past its date that has not been warned.
  with due as (
    select v.id, v.user_id
      from public.verifications v
     where v.kind = 'edu_email'
       and v.status = 'verified'
       and v.expires_at is not null
       and v.expires_at <= now()
       and not exists (
         select 1 from public.notifications n
          where n.user_id = v.user_id
            and n.kind = 'verification'
            and n.subject_type = 'verification'
            and n.subject_id = v.id
       )
  ), sent as (
    insert into public.notifications (user_id, kind, subject_type, subject_id, payload)
    select d.user_id, 'verification', 'verification', d.id,
           jsonb_build_object(
             'headline', 'Confirm your school email again',
             'detail', 'School addresses expire after graduation. Re-confirm it, or verify with '
                       || 'a government ID instead — your account and your comments stay either way.'
           )
      from due d
    returning 1
  )
  select count(*) into notified from sent;

  -- Step two: past the grace period, the verification lapses and the badge goes with it. The
  -- account, its comments and its applications are untouched.
  with lapsed as (
    update public.verifications v
       set status = 'expired'
     where v.kind = 'edu_email'
       and v.status = 'verified'
       and v.expires_at is not null
       and v.expires_at <= now() - make_interval(days => greatest(coalesce(p_grace_days, 30), 0))
    returning v.user_id
  )
  update public.profiles p
     set school_id = null,
         verification_tier = case
           when exists (
             select 1 from public.verifications v2
              where v2.user_id = p.id and v2.kind = 'government_id' and v2.status = 'verified'
           ) then 'identity'::public.verification_tier
           else 'email'::public.verification_tier
         end
    from lapsed l
   where p.id = l.user_id;

  get diagnostics expired = row_count;
  return notified + expired;
end;
$fn$;

-- ── moderation (service role only) ─────────────────────────────────────────────

/*
 * §10's strike ladder: warn → 7-day mute → ban.
 *
 * Escalation is computed from history rather than passed in, so two moderators working the
 * queue at once cannot both issue a "first warning". Severity is derived from how many
 * strikes are already on the account, unless the caller names one — which is what the
 * `threat` path needs, because a credible threat is not a first offence to be warned about.
 *
 * A ban burns the credential (§10, and `verification_blocklist` above). That is the step that
 * makes the ladder mean anything: signup is open to any email, so banning an account without
 * burning what verified it costs the offender ten seconds.
 */
create or replace function public.apply_strike(
  p_user_id    uuid,
  p_reason     text,
  p_comment_id uuid default null,
  p_severity   smallint default null,
  p_issued_by  uuid default null
)
returns table (strike_id uuid, severity smallint, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  prior integer;
  sev   smallint;
  until timestamptz;
  sid   uuid;
begin
  select count(*) into prior from public.user_strikes s where s.user_id = p_user_id;

  sev := coalesce(p_severity, least(3, prior + 1)::smallint);
  until := case when sev = 2 then now() + interval '7 days' end;

  insert into public.user_strikes (user_id, severity, reason, comment_id, issued_by, expires_at)
  values (p_user_id, sev, p_reason, p_comment_id, p_issued_by, until)
  returning id into sid;

  if sev = 3 then
    /*
     * Burn every credential this account verified with.
     *
     * The digest is computed here, from the address and from the provider reference, with the
     * account's own id deliberately *not* in it — the whole point is that the same address
     * under a different account is recognised. `digest` comes from pgcrypto; the salt is a
     * fixed pepper rather than a per-row one, because a per-row salt would make the hashes
     * un-comparable, which is the one thing they exist for.
     */
    insert into public.verification_blocklist (kind, identifier_hash, reason)
    select v.kind,
           encode(extensions.digest('careerdeck-verification:' ||
             coalesce(v.edu_email::text, v.provider_ref, v.id::text), 'sha256'), 'hex'),
           'ban: ' || left(p_reason, 200)
      from public.verifications v
     where v.user_id = p_user_id and v.status = 'verified'
    on conflict (kind, identifier_hash) do nothing;

    update public.verifications
       set status = 'failed'
     where user_id = p_user_id and status = 'verified';

    update public.profiles
       set verification_tier = 'email', school_id = null
     where id = p_user_id;
  end if;

  perform public.notify_moderation(
    p_user_id,
    case sev
      when 1 then 'A comment of yours broke the content policy'
      when 2 then 'You cannot comment for the next 7 days'
      else 'Your account can no longer comment'
    end,
    p_reason,
    'moderation',
    p_comment_id
  );

  return query select sid, sev, until;
end;
$fn$;

/*
 * The queue, as one read. §10: "Target: 24h on reports, 1h on threats."
 *
 * Open reports and flagged comments in one list, because a reviewer works a list and not two
 * tabs, ordered by how close each item is to breaching that target. Reported items sort ahead
 * of merely-flagged ones at the same age: a flag is a machine's suspicion and a report is a
 * person telling us something is wrong.
 *
 * This is the one read in the system that may see `author_id`, and it does: the reviewer needs
 * the account's strike history to decide between a warning and a ban. Service role only, and
 * the client has no route to it. §3.8's projection is about what users see of each other.
 */
create or replace function public.moderation_queue(p_limit integer default 50)
returns table (
  kind          text,
  report_id     uuid,
  comment_id    uuid,
  job_id        uuid,
  author_id     uuid,
  author_handle text,
  author_badge  text,
  author_tier   public.verification_tier,
  prior_strikes integer,
  body          text,
  gif_id        text,
  moderation_status public.moderation_status,
  moderation_reason text,
  moderation_scores jsonb,
  report_count  integer,
  reasons       text[],
  details       text[],
  created_at    timestamptz
)
language sql
stable
security definer
set search_path = ''
as $fn$
  with flagged as (
    select c.id as comment_id, c.created_at
      from public.comments c
     where c.deleted_at is null
       and c.moderation_status in ('flagged', 'pending')
  ),
  reported as (
    select r.target_id as comment_id, min(r.created_at) as created_at
      from public.reports r
     where r.status = 'open' and r.target_type = 'comment'
     group by r.target_id
  ),
  items as (
    select coalesce(f.comment_id, r.comment_id) as comment_id,
           least(coalesce(f.created_at, r.created_at), coalesce(r.created_at, f.created_at)) as created_at,
           (r.comment_id is not null) as was_reported
      from flagged f
      full outer join reported r on r.comment_id = f.comment_id
  )
  select case when i.was_reported then 'report' else 'flag' end,
         null::uuid,
         c.id,
         c.job_id,
         c.author_id,
         p.handle::text,
         p.comment_badge,
         p.verification_tier,
         (select count(*)::integer from public.user_strikes s where s.user_id = c.author_id),
         c.body,
         c.gif_id,
         c.moderation_status,
         c.moderation_reason,
         c.moderation_scores,
         (select count(*)::integer from public.reports r2
           where r2.target_type = 'comment' and r2.target_id = c.id and r2.status = 'open'),
         array(select r3.reason from public.reports r3
                where r3.target_type = 'comment' and r3.target_id = c.id and r3.status = 'open'
                order by r3.created_at),
         array(select r4.detail from public.reports r4
                where r4.target_type = 'comment' and r4.target_id = c.id and r4.status = 'open'
                  and r4.detail is not null
                order by r4.created_at),
         i.created_at
    from items i
    join public.comments c on c.id = i.comment_id
    join public.profiles p on p.id = c.author_id
   where c.deleted_at is null
   order by i.was_reported desc, i.created_at asc
   limit least(greatest(coalesce(p_limit, 50), 1), 200);
$fn$;

/*
 * Resolving one queue item: the comment's fate, the reports on it, and optionally a strike,
 * in one transaction.
 *
 * One function rather than three calls because these three facts have to move together. A
 * removal whose reports stay open comes back up the queue tomorrow; a strike issued without
 * the removal punishes somebody for something still on the page.
 */
create or replace function public.moderation_resolve(
  p_comment_id uuid,
  p_status     public.moderation_status,
  p_reason     text,
  p_moderator  uuid default null,
  p_strike     boolean default false,
  p_severity   smallint default null
)
returns table (comment_id uuid, status public.moderation_status, strike_severity smallint)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  author uuid;
  sev    smallint;
begin
  select c.author_id into author from public.comments c where c.id = p_comment_id;
  if author is null then
    raise exception 'no such comment' using errcode = '23503';
  end if;

  update public.comments
     set moderation_status = p_status,
         moderation_reason = nullif(btrim(coalesce(p_reason, '')), '')
   where id = p_comment_id;

  /*
   * Every column qualified, because this function's OUT columns are named `comment_id` and
   * `status` and plpgsql resolves a bare name to the variable before it looks at the table.
   * Unqualified, `and status = 'open'` compares a report against the *outcome being written*,
   * which is a filter that matches nothing and closes no reports.
   */
  update public.reports
     set status      = case when p_status = 'removed'
                            then 'actioned'::public.report_status
                            else 'dismissed'::public.report_status end,
         resolved_by = p_moderator,
         resolved_at = now()
   where reports.target_type = 'comment'
     and reports.target_id = p_comment_id
     and reports.status = 'open';

  if p_strike then
    select s.severity into sev
      from public.apply_strike(author, p_reason, p_comment_id, p_severity, p_moderator) s;
  elsif p_status = 'removed' then
    -- Removed without a strike still gets explained. An unexplained disappearance is
    -- indistinguishable from a bug, and the user's next move is to post it again.
    perform public.notify_moderation(
      author,
      'A comment of yours was removed',
      coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'It broke the content policy.'),
      'moderation',
      p_comment_id
    );
  end if;

  return query select p_comment_id, p_status, sev;
end;
$fn$;

create or replace function public.resolve_report(
  p_report_id uuid,
  p_status    public.report_status,
  p_moderator uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  touched integer;
begin
  update public.reports
     set status = p_status, resolved_by = p_moderator, resolved_at = now()
   where id = p_report_id and status = 'open';

  get diagnostics touched = row_count;
  return touched > 0;
end;
$fn$;

-- ── operational functions (service role only) ──────────────────────────────────

/*
 * The nightly check on the two denormalized counters this phase adds — the same treatment
 * phase 2 gave `companies.follower_count`, for the same reason: a counter nobody verifies is
 * a counter that is eventually wrong, and nothing else in the system would notice.
 */
create or replace function public.reconcile_comment_counts()
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  fixed integer := 0;
  n     integer;
begin
  with truth as (
    select c.id,
           (select count(*) from public.comment_likes l where l.comment_id = c.id)::integer as likes,
           (select count(*) from public.comments r
             where r.parent_id = c.id
               and r.deleted_at is null
               and r.moderation_status in ('approved', 'flagged'))::integer as replies
      from public.comments c
  ), drifted as (
    update public.comments c
       set like_count  = t.likes,
           reply_count = t.replies
      from truth t
     where c.id = t.id
       and (c.like_count <> t.likes or c.reply_count <> t.replies)
    returning 1
  )
  select count(*) into n from drifted;

  fixed := n;
  return fixed;
end;
$fn$;

/*
 * §13.2's retention, applied to notifications.
 *
 * A read notification is a row nobody will ever look at again; ninety days is enough that
 * "what did that reply say" is still answerable and short enough that this table does not
 * become the largest thing in the database after impressions.
 */
create or replace function public.prune_notifications(p_keep_days integer default 90)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  removed integer;
begin
  delete from public.notifications
   where read_at is not null
     and read_at < now() - make_interval(days => greatest(coalesce(p_keep_days, 90), 7));

  get diagnostics removed = row_count;
  return removed;
end;
$fn$;

-- ── authorization ──────────────────────────────────────────────────────────────

/*
 * Phase 0's discipline for the third time: **RLS decides which rows, column grants decide
 * which fields**, and neither substitutes for the other.
 *
 * | Table                    | Read                        | Write                             |
 * |--------------------------|-----------------------------|-----------------------------------|
 * | `comments`               | **nobody** — the view only  | none — `post_comment()` only      |
 * | `comments_public`        | every signed-in reader      | —                                 |
 * | `comment_likes`          | own rows                    | none — `set_comment_like()` only  |
 * | `blocks`                 | own rows                    | none — `set_block_from_comment()` |
 * | `reports`                | own rows                    | none — `report_content()` only    |
 * | `user_strikes`           | own rows                    | none — moderators only            |
 * | `verifications`          | own rows, minus the secrets | none — service role only          |
 * | `verification_blocklist` | **nobody**                  | none                              |
 * | `notifications`          | own rows via the view       | none — `mark_notifications_read()`|
 * | `moderators`             | **nobody**                  | none                              |
 * | `handle_words`           | **nobody**                  | none                              |
 *
 * The base `comments` table is unreadable by design. Granting select on it and relying on a
 * policy would leave `author_id` one `select *` away, and the whole anonymity contract rests
 * on that column never being in a client response. So the grant is on the view, and
 * `security_invoker` makes the view read under the caller's own privileges — which means the
 * view needs a policy on the base table to read through, and that policy is what the last
 * block below installs.
 */

alter table public.verifications          enable row level security;
alter table public.verification_blocklist enable row level security;
alter table public.comments               enable row level security;
alter table public.comment_likes          enable row level security;
alter table public.blocks                 enable row level security;
alter table public.reports                enable row level security;
alter table public.user_strikes           enable row level security;
alter table public.notifications          enable row level security;
alter table public.moderators             enable row level security;
alter table public.handle_words           enable row level security;

revoke all on public.verifications          from anon, authenticated;
revoke all on public.verification_blocklist from anon, authenticated;
revoke all on public.comments               from anon, authenticated;
revoke all on public.comment_likes          from anon, authenticated;
revoke all on public.blocks                 from anon, authenticated;
revoke all on public.reports                from anon, authenticated;
revoke all on public.user_strikes           from anon, authenticated;
revoke all on public.notifications          from anon, authenticated;
revoke all on public.moderators             from anon, authenticated;
revoke all on public.handle_words           from anon, authenticated;
revoke all on public.comments_public        from anon, authenticated;
revoke all on public.notifications_public   from anon, authenticated;

/*
 * `comments`: read-through for the view, and nothing else.
 *
 * The policy admits exactly the rows `comments_public` publishes — visible, not blocked in
 * either direction — so a reader who somehow acquired a select grant on the base table would
 * still only see rows they can already read, just with a column they should not have. Defence
 * in depth: the grant is the wall, the policy is the second wall.
 */
grant select on public.comments_public to authenticated;

create policy comments_select_visible on public.comments
  for select to authenticated
  using (
    deleted_at is null
    and moderation_status in ('approved', 'flagged')
    and not exists (
      select 1 from public.blocks b
       where (b.blocker_id = (select auth.uid()) and b.blocked_id = comments.author_id)
          or (b.blocker_id = comments.author_id and b.blocked_id = (select auth.uid()))
    )
  );

-- `comment_likes`: the viewer's own, which is what `viewer_state()` reads back.
grant select on public.comment_likes to authenticated;

create policy comment_likes_select_own on public.comment_likes
  for select to authenticated
  using (user_id = (select auth.uid()));

/*
 * `blocks`: the blocker's own rows only, and deliberately not the blocked person's.
 *
 * Reading "who has blocked me" would tell somebody that a particular pseudonym has blocked
 * them, which in a small thread is enough to work out who it was. Being blocked should be
 * indistinguishable from being ignored.
 */
grant select on public.blocks to authenticated;

create policy blocks_select_own on public.blocks
  for select to authenticated
  using (blocker_id = (select auth.uid()));

-- `reports`: your own, so the client can show "reported" on something you already reported
-- rather than letting you file it twice and get a constraint error for your trouble.
grant select on public.reports to authenticated;

create policy reports_select_own on public.reports
  for select to authenticated
  using (reporter_id = (select auth.uid()));

/*
 * `user_strikes`: your own.
 *
 * §10's ladder is only a deterrent if the person on it can see where they are. What they
 * cannot see is `issued_by` — which is a column grant, not a policy, because a moderator's
 * identity is not part of the record the subject is entitled to.
 */
grant select (id, user_id, severity, reason, comment_id, expires_at, created_at)
  on public.user_strikes to authenticated;

create policy user_strikes_select_own on public.user_strikes
  for select to authenticated
  using (user_id = (select auth.uid()));

/*
 * `verifications`: your own, minus every secret in the row.
 *
 * No `token_hash` (the thing that would let a stolen session finish somebody else's
 * verification), no `provider_result`, no `provider_ref`. What is left is the status ladder —
 * which is all the client needs to render "Verified" or "Confirm your school email".
 */
grant select (id, user_id, kind, status, edu_email, edu_domain, school_id,
              token_expires_at, verified_at, expires_at, created_at)
  on public.verifications to authenticated;

create policy verifications_select_own on public.verifications
  for select to authenticated
  using (user_id = (select auth.uid()));

/*
 * `notifications`: own rows, every column except the one that would name who caused it.
 *
 * `notifications_public` is an invoker view, so it reads with the caller's privileges and needs
 * these columns on the base table. That is fine here and impossible for `comments`: the view
 * selects nothing that is withheld, whereas `comments_public` has to join on `author_id`.
 *
 * `user_id` is not granted and not needed — the RLS policy below references it, and a policy's
 * USING clause is not subject to column privileges. What a reader gets is their own rows,
 * without the actor, whichever door they come through.
 */
grant select (id, kind, subject_type, subject_id, aggregate_count, payload, read_at, created_at)
  on public.notifications to authenticated;
grant select on public.notifications_public to authenticated;

create policy notifications_select_own on public.notifications
  for select to authenticated
  using (user_id = (select auth.uid()));

/*
 * `verification_blocklist`, `moderators` and `handle_words` have RLS enabled and **no policy
 * at all**, which denies everything, on top of no grant.
 *
 * Phase 2 took the same belt-and-braces approach to `job_impressions` and the reasoning has
 * not changed: "a convenience grant added by somebody in six months still hits a locked
 * door." Here the stakes are higher than a behavioural log — `handle_words` is the dictionary
 * that generates every pseudonym in the system, and a reader who can enumerate it can
 * enumerate the handle space.
 */

-- ── function grants ────────────────────────────────────────────────────────────

/*
 * Postgres grants EXECUTE on every new function to PUBLIC, and Supabase separately grants all
 * functions to `anon, authenticated, service_role`. Neither revoke covers the other, so both
 * are spelled out — phase 2 learned this the hard way and wrote it down.
 */

-- Internal: only ever called from inside another definer function, or by a trigger.
revoke all on function public.generate_handle()                          from public, anon, authenticated;
revoke all on function public.enforce_flat_threads()                     from public, anon, authenticated;
revoke all on function public.sync_comment_like_count()                  from public, anon, authenticated;
revoke all on function public.sync_comment_reply_count()                 from public, anon, authenticated;
revoke all on function public.broadcast_comment()                        from public, anon, authenticated;
revoke all on function public.notify_comment_reply()                     from public, anon, authenticated;
revoke all on function public.notify_comment_like()                      from public, anon, authenticated;
revoke all on function public.comment_card_of(uuid, uuid)                from public, anon, authenticated;
revoke all on function public.is_moderator(uuid)                         from public, anon, authenticated;
revoke all on function public.notify_moderation(uuid, text, text, public.notification_kind, uuid)
  from public, anon, authenticated;

-- The write path and everything privileged. Service role only: these either bypass the checks
-- the client is subject to, or take the caller's identity as an argument.
revoke all on function public.post_comment(uuid, uuid, text, uuid, text, public.moderation_status, jsonb, text, text)
  from public, anon, authenticated;
revoke all on function public.start_edu_verification(uuid, text, text, text, integer)
  from public, anon, authenticated;
revoke all on function public.confirm_edu_verification(uuid, text)       from public, anon, authenticated;
revoke all on function public.record_identity_verification(uuid, text, text, boolean, jsonb, text)
  from public, anon, authenticated;
revoke all on function public.expire_edu_verifications(integer)          from public, anon, authenticated;
revoke all on function public.apply_strike(uuid, text, uuid, smallint, uuid)
  from public, anon, authenticated;
revoke all on function public.moderation_queue(integer)                  from public, anon, authenticated;
revoke all on function public.moderation_resolve(uuid, public.moderation_status, text, uuid, boolean, smallint)
  from public, anon, authenticated;
revoke all on function public.resolve_report(uuid, public.report_status, uuid)
  from public, anon, authenticated;
revoke all on function public.reconcile_comment_counts()                 from public, anon, authenticated;
revoke all on function public.prune_notifications(integer)               from public, anon, authenticated;

-- The reader's own surface.
revoke all on function public.job_comments(uuid, text, integer)          from public, anon;
revoke all on function public.comment_replies(uuid, integer)             from public, anon;
revoke all on function public.comment_counts(uuid[])                     from public, anon;
revoke all on function public.comment_gate()                             from public, anon;
revoke all on function public.set_comment_like(uuid, boolean)             from public, anon;
revoke all on function public.delete_own_comment(uuid)                    from public, anon;
revoke all on function public.report_content(uuid, text, text, public.report_target)
  from public, anon;
revoke all on function public.set_block_from_comment(uuid, boolean)       from public, anon;
revoke all on function public.accept_content_policy(text)                 from public, anon;
revoke all on function public.mark_notifications_read(uuid[])             from public, anon;

grant execute on function public.job_comments(uuid, text, integer)        to authenticated;
grant execute on function public.comment_replies(uuid, integer)           to authenticated;
grant execute on function public.comment_counts(uuid[])                   to authenticated;
grant execute on function public.comment_gate()                           to authenticated;
grant execute on function public.set_comment_like(uuid, boolean)          to authenticated;
grant execute on function public.delete_own_comment(uuid)                 to authenticated;
grant execute on function public.report_content(uuid, text, text, public.report_target)
  to authenticated;
grant execute on function public.set_block_from_comment(uuid, boolean)    to authenticated;
grant execute on function public.accept_content_policy(text)              to authenticated;
grant execute on function public.mark_notifications_read(uuid[])          to authenticated;

-- `viewer_state` was already granted in phase 2 and keeps its grant through the replace; the
-- composite gained an attribute, not a new signature.
