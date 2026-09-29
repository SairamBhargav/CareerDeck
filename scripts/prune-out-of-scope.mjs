/*
 * Remove jobs the app no longer lists (decisions of 2026-09-29): outside the US and Canada,
 * or Senior / Staff+ level.
 *
 *   node --env-file=server/.env scripts/prune-out-of-scope.mjs            dry run, prints counts
 *   node --env-file=server/.env scripts/prune-out-of-scope.mjs --apply    does it
 *
 * The crawler now skips these postings before storing them (postingInScope in
 * server/src/ingest/pipeline.ts). This clears out what was stored before that, and is safe
 * to re-run whenever a scope rule changes.
 *
 * Two passes, because a job can be out of scope in two ways:
 *   1. The whole posting is. Read from raw_postings with the source's own adapter, so
 *      "Remote - EMEA" is judged from what the employer wrote, not from the "Remote" label it
 *      was stored under. Its raw_postings rows go too.
 *   2. One fan-out row of a posting that is otherwise in scope ("London / New York"): judged
 *      from the row's own stored location. Seniority is per posting, so it is also read from
 *      the row for jobs whose raw payload is gone.
 *
 * A job a user has touched (saved, applied to, commented on, drafted with Auto Apply) is
 * closed, never deleted: those tables cascade or restrict, and the phase 2 rule is that jobs
 * are closed. Everything else is deleted, which is what frees the space.
 */

import { createClient } from '@supabase/supabase-js';
import { adapterFor } from '../server/src/ingest/sources/index.ts';
import { postingInMarket, postingInScope, EXCLUDED_SENIORITY } from '../server/src/ingest/pipeline.ts';
import { extractSeniority } from '../server/src/ingest/normalize/seniority.ts';
import { parseLocations, MARKET_COUNTRIES } from '../server/src/ingest/normalize/location.ts';
import { writeBatches } from '../server/src/ingest/batches.ts';

const apply = process.argv.includes('--apply');
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function pages(build, size = 500) {
  const rows = [];
  for (let offset = 0; ; offset += size) {
    const { data, error } = await build().range(offset, offset + size - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < size) return rows;
  }
}

// ── 1. whole postings, from their stored payloads ─────────────────────────────
const sources = await pages(() => db.from('job_sources').select('id, kind, board_token').order('id'));
const foreignRawIds = [];
const foreignPostings = new Set(); // `${source_id}|${external_id}`

for (const source of sources) {
  const adapter = adapterFor(source.kind);
  const raws = await pages(() => db.from('raw_postings')
    .select('id, external_id, payload').eq('source_id', source.id).order('id'), 200);
  for (const raw of raws) {
    let inScope;
    if (adapter) {
      inScope = postingInScope(adapter.parse({ externalId: raw.external_id, payload: raw.payload }));
    } else {
      // The Simplify feed stores its listing's locations directly, and lists internships only.
      const [first, ...rest] = Array.isArray(raw.payload?.locations) ? raw.payload.locations : [];
      inScope = postingInMarket({ locationRaw: first ?? null, extraLocations: rest, workplaceHint: null });
    }
    if (!inScope) {
      foreignRawIds.push(raw.id);
      foreignPostings.add(`${source.id}|${raw.external_id}`);
    }
  }
}

// ── 2. individual rows ────────────────────────────────────────────────────────
const jobs = await pages(() => db.from('jobs')
  .select('id, source_id, external_id, title, location_raw, location_country, location_type, seniority, status').order('id'), 1000);

const foreignJobIds = [];
for (const job of jobs) {
  // A row stored "unranked" before a seniority rule existed is judged by the current rules,
  // from its title: "Engineering Manager" was unranked until 2026-09-29.
  const level = job.seniority ?? extractSeniority(job.title, '');
  if (foreignPostings.has(`${job.source_id}|${job.external_id}`) || EXCLUDED_SENIORITY.has(level ?? '')) {
    foreignJobIds.push(job.id);
    continue;
  }
  const country = job.location_country?.trim() || null;
  const abroad = country
    ? !MARKET_COUNTRIES.has(country)
    : parseLocations(job.location_raw, [], job.location_type).every((location) => location.abroad);
  if (abroad) foreignJobIds.push(job.id);
}

// ── who has touched them ──────────────────────────────────────────────────────
const touched = new Set();
for (const table of ['job_interactions', 'applications', 'comments', 'auto_apply_runs']) {
  await writeBatches(foreignJobIds, 150, `read ${table}`, async (batch) => {
    const { data, error } = await db.from(table).select('job_id').in('job_id', batch);
    if (error) throw error;
    for (const row of data) touched.add(row.job_id);
  });
}

const toClose = foreignJobIds.filter((id) => touched.has(id));
const toDelete = foreignJobIds.filter((id) => !touched.has(id));

console.log(`jobs scanned              ${jobs.length}`);
console.log(`out-of-scope postings    ${foreignPostings.size}  (${foreignRawIds.length} raw row(s))`);
console.log(`out-of-scope job rows    ${foreignJobIds.length}`);
console.log(`  delete (untouched)      ${toDelete.length}`);
console.log(`  close (a user has them) ${toClose.length}`);
console.log(`jobs left                 ${jobs.length - toDelete.length}`);

if (!apply) {
  console.log('\nDry run. Re-run with --apply to delete and close.');
  process.exit(0);
}

await writeBatches(toClose, 150, 'close foreign jobs', async (batch) => {
  const { error } = await db.from('jobs').update({ status: 'closed' }).in('id', batch).eq('status', 'open');
  if (error) throw error;
});
await writeBatches(toDelete, 100, 'delete foreign jobs', async (batch) => {
  const { error } = await db.from('jobs').delete().in('id', batch);
  if (error) throw error;
});
await writeBatches(foreignRawIds, 200, 'delete foreign raw postings', async (batch) => {
  const { error } = await db.from('raw_postings').delete().in('id', batch);
  if (error) throw error;
});

const { data: counts, error } = await db.rpc('refresh_open_job_counts');
if (error) console.warn(`open-job counts not refreshed: ${error.message}`);
else console.log(`company open-role counts corrected: ${counts}`);
console.log('Done.');
