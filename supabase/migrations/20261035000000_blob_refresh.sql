/*
 * Refreshing the blob offer, five times per change (2026-10-10).
 *
 * 20261034000000 kept the three offered blobs fixed until a pick, so nobody could roll forever for
 * a particular look. That turned out too strict: people want to see a few more. A refresh swaps the
 * offer for three new ones, five times before each change, and the count starts again after a
 * change is spent. Eighteen to choose from per change, still not unlimited.
 */

alter table public.profiles
  -- Refreshes used since the last change.
  add column blob_refreshes smallint not null default 0 check (blob_refreshes between 0 and 5);

create or replace function public.blob_refresh_limit()
returns smallint
language sql
immutable
set search_path = ''
as $fn$ select 5::smallint $fn$;

/*
 * As in 20261034000000, plus `p_refresh`: three new blobs in place of the offer, while refreshes
 * are left. Without it, the same offer as last time. Also answers how many refreshes are left.
 * The old no-argument form is dropped; a call without arguments still reaches this one.
 */
drop function public.blob_options();

create function public.blob_options(p_refresh boolean default false)
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

/* As in 20261034000000; spending a change also gives the refreshes back. */
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

revoke all on function public.blob_refresh_limit()    from public, anon, authenticated;
revoke all on function public.blob_options(boolean)   from public, anon;
grant execute on function public.blob_options(boolean) to authenticated;
