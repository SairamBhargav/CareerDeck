/*
 * Comment GIFs from KLIPY (2026-10-07).
 *
 * `comments.gif_id` was free text, which was harmless while the app could only render the eight
 * bundled reactions by id. It now also holds `klipy:<slug>`, which the app resolves to media
 * through KLIPY's own API, so the column must never be able to hold anything else — a URL in
 * particular, which would let a comment point every reader's phone at an image host of the
 * author's choosing. The API service checks the same shape (server/src/comments.ts); this is
 * the line a write that skips the service would still meet.
 *
 * No existing row has a GIF, so the constraint validates instantly.
 */

alter table public.comments
  add constraint comments_gif_id_shape
  check (gif_id is null or gif_id ~ '^(klipy:[A-Za-z0-9_-]{1,120}|[a-z0-9_-]{1,40})$');
