-- Resume re-upload dedup, and the free-tier shelf limit.
--
-- Two changes, both to `register_resume`'s neighbourhood, both about not paying twice.
--
-- ── 1. The re-upload check, finally wired up ───────────────────────────────────
--
-- Phase 4 built every piece of this and connected none of them: `resumes.content_hash`
-- exists, `resumes_user_hash_idx` exists and its comment literally reads "the re-upload
-- check: has this user already got this exact file", `register_resume` takes a
-- `p_content_hash` argument, and `resume_for_service` returns the column. The client never
-- computed a hash, so every row was written with `content_hash = null` and the index has
-- never had anything in it.
--
-- The cost of that is one model call per upload. A parse is a PDF rendered to images and
-- read by `claude-opus-5` — measured at ~4,800 input and ~650 output tokens for a one-page
-- resume, which is roughly four cents. A user who re-uploads the same resume after editing
-- one bullet, or who taps Add twice because the first tap did not look like it worked, pays
-- that again for a document the database already holds a finished profile for.
--
-- `resume_by_content_hash` is the lookup the client makes *before* it uploads, so a
-- duplicate costs neither the object nor the parse. It returns the same `resume_card` as
-- `my_resumes()` so the caller can hand the existing resume straight to the review screen.
--
-- Deliberately scoped to one user. A hash is a hash, and two users with the same resume is
-- either a coincidence or plagiarism — but sharing a parse across accounts would mean one
-- user's upload revealing that another account holds the same file, which is exactly the
-- inference `content_hash`'s own column comment in phase 4 refused to allow. The index is
-- `(user_id, content_hash)` for the same reason.

create or replace function public.resume_by_content_hash(p_content_hash text)
returns public.resume_card
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  uid  uuid := (select auth.uid());
  hit  uuid;
  card public.resume_card;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = 'CD401';
  end if;

  if p_content_hash is null or btrim(p_content_hash) = '' then
    return card;  -- all-null composite: "nothing matched", not an error
  end if;

  /*
   * Newest first, so re-uploading a file the user has three copies of resolves to the one
   * they touched most recently — which is the one whose confirmations are current.
   */
  select r.id into hit
    from public.resumes r
   where r.user_id = uid
     and r.deleted_at is null
     and r.content_hash = btrim(p_content_hash)
   order by r.created_at desc
   limit 1;

  if hit is null then
    return card;
  end if;

  select * into card from public.my_resumes() c where c.id = hit;
  return card;
end;
$fn$;

comment on function public.resume_by_content_hash(text) is
  'This user''s existing resume with the given content hash, or an all-null resume_card. Lets the client skip a duplicate upload and its parse.';

-- ── 2. The shelf limit: 3, not 10 ──────────────────────────────────────────────
--
-- Phase 4 set the cap at 10 and called it "§11's abuse envelope" — a number chosen to be
-- far past normal use and far short of what someone farming free object storage wants. That
-- is the right way to pick an *abuse* ceiling and the wrong way to pick a *product* limit,
-- and the difference matters now that there is a free tier to define.
--
-- Three is the product limit: enough for the real case (a general resume, one tuned for the
-- role you actually want, and one you are mid-edit on) and few enough that a paid tier has
-- something to sell.
--
-- There is no `plan` column anywhere in the schema yet, so this is one constant rather than
-- a lookup, and that is the honest shape of it — a per-plan limit written before plans exist
-- would be a join against a table with one value in it. When a plan column arrives, the
-- `limit` local below becomes a select and nothing else in this function changes.
--
-- The error code stays `CD011` so the client keeps mapping it to the same message, and the
-- message itself now carries the number, because "too many resumes" leaves the user
-- guessing what the cap is.

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
  -- The free tier's shelf size. Becomes a per-plan select the day a plan column exists.
  max_live integer := 3;
  live     integer;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = 'CD401';
  end if;

  if p_storage_path is null or p_storage_path not like (uid::text || '/%') then
    raise exception 'a resume must be stored under its owner' using errcode = 'CD010';
  end if;

  select count(*) into live
    from public.resumes
   where user_id = uid and deleted_at is null;

  if live >= max_live then
    raise exception 'you can keep % resumes at once. Delete one to add another.', max_live
      using errcode = 'CD011';
  end if;

  -- The first resume is the default, because a shelf with one document and no default is a
  -- state where the ring is hidden and nobody can work out why.
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

-- `register_resume` keeps its phase 4 grant through the replace. The new function needs its
-- own, and `anon` is revoked explicitly rather than left to the default — every other
-- function in phase 4 does the same.
revoke all on function public.resume_by_content_hash(text) from public, anon;
grant execute on function public.resume_by_content_hash(text) to authenticated;
