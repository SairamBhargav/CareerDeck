/*
 * Everything else an application asks, answered once, so Auto Apply's autofill can fill it.
 *
 * PHASE8.md §5 stored the answers that shape a draft (degree, work authorization, links). A real
 * form asks far more: a mailing address, a phone, a GPA, citizenship and clearance for defense
 * employers, "how did you hear about us", and the voluntary self-identification block (gender,
 * race, veteran and disability status). Students retype all of it on every application, which is
 * the thing Auto Apply exists to end.
 *
 * ── The self-identification answers ───────────────────────────────────────────
 *
 * PHASE6.md §5.1 says self-identification is never drafted and never shown to a model. That still
 * holds: these columns are the student's own statements, typed by them, read only by their own
 * device (RLS below) to fill the form they are looking at. The drafter in server/src/autoapply
 * does not select them. Each has an explicit 'decline' value, because "I don't wish to answer" is
 * itself the answer most forms offer and many students choose; null means "not set, leave the
 * question for me".
 */

set lock_timeout = '10s';

alter table public.application_answers
  add column preferred_name      text,
  add column phone               text,
  add column address_line1       text,
  add column address_line2       text,
  add column city                text,
  add column state_region        text,
  add column postal_code         text,
  add column country             text,
  add column school_name         text,
  add column graduation_date     text,
  add column gpa                 text,
  add column over_18             boolean,
  add column us_citizen          boolean,
  add column has_clearance       boolean,
  add column how_heard           text,
  add column desired_pay         text,
  add column pronouns            text,
  add column gender              text
    check (gender in ('male', 'female', 'non_binary', 'decline')),
  add column hispanic_latino     text
    check (hispanic_latino in ('yes', 'no', 'decline')),
  add column race                text
    check (race in ('american_indian', 'asian', 'black', 'pacific_islander', 'white', 'two_or_more', 'decline')),
  add column veteran_status      text
    check (veteran_status in ('not_veteran', 'protected_veteran', 'decline')),
  add column disability_status   text
    check (disability_status in ('yes', 'no', 'decline')),
  add column sexual_orientation  text
    check (sexual_orientation in ('heterosexual', 'gay_lesbian', 'bisexual', 'other', 'decline')),
  add column transgender         text
    check (transgender in ('yes', 'no', 'decline'));

/*
 * Nothing to grant: phase 8 granted select, insert and update on the whole table to
 * `authenticated`, and its RLS policies already limit every row to its owner.
 */
