/*
 * Make the nightly "still open" touch HOT for real.
 *
 * 20261002000000 dropped jobs_stale_idx so that a last_seen_at-only update would rewrite no
 * index. It never became HOT: measured on hosted 2026-10-06, touching Stripe's 549 open rows
 * was 549 updates, 0 of them HOT. Postgres 17 recomputes every STORED generated column on
 * every UPDATE, whatever the SET list says. search_vector comes out with the same lexemes, but
 * it is TOASTed under a new pointer, so the HOT check sees an indexed column change. Each
 * touch then rewrites the row's search_vector TOAST and inserts into all fourteen indexes,
 * three of them GIN.
 *
 * On the free plan's throttled disk that cost about a second per row. On 2026-10-06 the
 * Stripe board's "refresh last seen" step halved its batch down to a single row and still hit
 * the 8s statement timeout, and that failed the nightly run.
 *
 * search_vector becomes a plain column kept by a trigger. The trigger recomputes it only when
 * title, skills or description_text actually change. Any other update carries the old datum
 * over untouched, and that update can be HOT.
 */

set lock_timeout = '10s';

-- Catalog-only: the stored values stay as they are, and nothing is rewritten.
alter table public.jobs alter column search_vector drop expression;

-- Same expression as 20261002000000.
create or replace function public.job_search_vector(p_title text, p_skills text[], p_description text)
returns tsvector
language sql
immutable
parallel safe
set search_path = ''
as $$
  select setweight(to_tsvector('english', coalesce(p_title, '')), 'A') ||
         setweight(to_tsvector('english', coalesce(public.text_array_to_string(p_skills, ' '), '')), 'B') ||
         strip(to_tsvector('english', coalesce(p_description, '')));
$$;

create or replace function public.jobs_set_search_vector()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT'
     or new.title is distinct from old.title
     or new.skills is distinct from old.skills
     or new.description_text is distinct from old.description_text
  then
    new.search_vector := public.job_search_vector(new.title, new.skills, new.description_text);
  else
    -- Writing search_vector directly is not a way to change it; it follows its inputs.
    new.search_vector := old.search_vector;
  end if;
  return new;
end;
$$;

create trigger jobs_set_search_vector
  before insert or update on public.jobs
  for each row execute function public.jobs_set_search_vector();

comment on column public.jobs.search_vector is
  'Kept by the jobs_set_search_vector trigger (20261013000000), not a generated column: a stored generated column made every update non-HOT.';
