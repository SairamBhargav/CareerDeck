/*
 * Extra blob changes for one account (2026-10-10), for testing the sheet without running out.
 *
 * Changes left are `blob_change_limit() - blob_changes`, so a count below zero is a grant: -8 leaves
 * ten. Only the service role can write the column (readers have no update grant on it), so this
 * only loosens what an operator can set by hand. Spending still adds one, and the cap of two used
 * stays.
 */

alter table public.profiles drop constraint profiles_blob_changes_check;
alter table public.profiles add constraint profiles_blob_changes_check check (blob_changes <= 2);
