/*
 * Changing your blob, twice in a lifetime (2026-10-10).
 *
 * The blob is drawn from `profiles.handle`, which is generated at signup and never shown as text
 * (20261010 drop of anonymous names). So a new blob is a new handle: every comment, reply and
 * Home header follows it at once, since they all join the handle at read time. Notifications
 * already sent keep the blob they were sent with; they carry a copy of the handle in their payload.
 *
 * The reader doesn't get to type one, for the reason phase 3 gives (a chosen handle is a second
 * identity to moderate). They are offered three fresh ones, pick one, and that counts as one of
 * their two changes. Looking costs nothing. The offer is kept until they pick, so reopening the
 * sheet shows the same three; asking for three more is allowed three times per change, so there
 * are a dozen to choose from without rolling forever for a particular look.
 *
 * Also closes a hole that predates this: phase 0 granted `update (handle)` to every signed-in
 * user, so anyone could write any handle (and so any blob) straight through the API. The app
 * never did; now nobody can.
 */

alter table public.profiles
  add column blob_changes   smallint not null default 0 check (blob_changes between 0 and 2),
  add column blob_offers    text[],
  -- "Three more" asked for since the last change; reset when a change is spent.
  add column blob_refreshes smallint not null default 0 check (blob_refreshes between 0 and 3);

revoke update (handle) on public.profiles from authenticated;

/* The lifetime allowance. One place, so the sheet's copy and the check cannot disagree. */
create or replace function public.blob_change_limit()
returns smallint
language sql
immutable
set search_path = ''
as $fn$ select 2::smallint $fn$;

/* "Three more" per change. */
create or replace function public.blob_refresh_limit()
returns smallint
language sql
immutable
set search_path = ''
as $fn$ select 3::smallint $fn$;

/*
 * The three blobs on offer, how many changes are left and how many "three more" are left. Generates
 * the offer the first time and returns the same one after that, until a pick spends it, or until
 * `p_refresh` asks for three more and one is left. With no changes left, no offer.
 */
create or replace function public.blob_options(p_refresh boolean default false)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  uid    uuid := (select auth.uid());
  me     public.profiles;
  offers text[];
begin
  if uid is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;

  select * into me from public.profiles where id = uid and deleted_at is null for update;
  if not found then
    raise exception 'no profile' using errcode = 'P0002';
  end if;

  if me.blob_changes >= public.blob_change_limit() then
    return jsonb_build_object('left', 0, 'offers', '[]'::jsonb, 'refreshes', 0);
  end if;

  offers := me.blob_offers;
  if p_refresh and offers is not null and me.blob_refreshes < public.blob_refresh_limit() then
    offers := null;
    me.blob_refreshes := me.blob_refreshes + 1;
    update public.profiles set blob_refreshes = me.blob_refreshes where id = uid;
  end if;

  if offers is null or cardinality(offers) <> 3 then
    offers := array[
      public.generate_handle()::text,
      public.generate_handle()::text,
      public.generate_handle()::text
    ];
    update public.profiles set blob_offers = offers where id = uid;
  end if;

  return jsonb_build_object(
    'left',      public.blob_change_limit() - me.blob_changes,
    'offers',    to_jsonb(offers),
    'refreshes', public.blob_refresh_limit() - me.blob_refreshes
  );
end;
$fn$;

/*
 * Takes one of the offered blobs: it becomes the reader's handle, a change is spent and the offer
 * is cleared. Anything not in the offer is refused, so a change can only land on a generated handle.
 */
create or replace function public.choose_blob(p_handle text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  uid uuid := (select auth.uid());
  me  public.profiles;
begin
  if uid is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;

  select * into me from public.profiles where id = uid and deleted_at is null for update;
  if not found then
    raise exception 'no profile' using errcode = 'P0002';
  end if;
  if me.blob_changes >= public.blob_change_limit() then
    raise exception 'no changes left' using errcode = '22023';
  end if;
  if me.blob_offers is null or not (p_handle = any (me.blob_offers)) then
    raise exception 'not on offer' using errcode = '22023';
  end if;

  -- Someone could have been handed the same one since it was offered: vanishingly rare, and the
  -- unique index refuses it. Answered rather than raised, so clearing the stale offer sticks and
  -- the sheet can ask for a fresh one. Nothing is spent.
  begin
    update public.profiles
       set handle         = p_handle::extensions.citext,
           blob_changes   = blob_changes + 1,
           blob_offers    = null,
           blob_refreshes = 0
     where id = uid;
  exception when unique_violation then
    update public.profiles set blob_offers = null where id = uid;
    return jsonb_build_object('taken', true, 'left', public.blob_change_limit() - me.blob_changes);
  end;

  return jsonb_build_object('handle', p_handle, 'left', public.blob_change_limit() - me.blob_changes - 1);
end;
$fn$;

revoke all on function public.blob_change_limit()     from public, anon, authenticated;
revoke all on function public.blob_refresh_limit()    from public, anon, authenticated;
revoke all on function public.blob_options(boolean)   from public, anon;
revoke all on function public.choose_blob(text)       from public, anon;
grant execute on function public.blob_options(boolean) to authenticated;
grant execute on function public.choose_blob(text) to authenticated;
