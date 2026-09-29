/*
 * Classifies every open job that has no `job_family` yet — docs/PHASE8.md §2.
 *
 *   node --env-file=server/.env scripts/backfill-job-family.mjs            dry run, prints counts
 *   node --env-file=server/.env scripts/backfill-job-family.mjs --apply    writes
 *
 * New postings are classified at ingest; this is for the ones stored before that existed.
 * Safe to re-run: it only touches rows whose family is still null, so a second run classifies
 * nothing it already classified and a posting the classifier cannot place is simply left null.
 *
 * Grouped by family and written as one `update … where id in (…)` per batch, rather than one
 * request per job: 13k single-row updates would be 13k round trips on the free plan's Disk IO
 * budget, and the family is the same value across a batch anyway.
 */

import { createClient } from '@supabase/supabase-js';
import { classifyFamily } from '../server/src/ingest/normalize/family.ts';
import { writeBatches } from '../server/src/ingest/batches.ts';

const apply = process.argv.includes('--apply');
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const jobs = [];
for (let offset = 0; ; offset += 1000) {
  const { data, error } = await db.from('jobs').select('id, title, skills')
    .eq('status', 'open').is('job_family', null).order('id').range(offset, offset + 999);
  if (error) throw error;
  jobs.push(...data);
  if (data.length < 1000) break;
}

const byFamily = new Map();
for (const job of jobs) {
  const family = classifyFamily(job.title, job.skills ?? []);
  if (!family) continue;
  if (!byFamily.has(family)) byFamily.set(family, []);
  byFamily.get(family).push(job.id);
}

const classified = [...byFamily.values()].reduce((sum, ids) => sum + ids.length, 0);
console.log(`unclassified open jobs  ${jobs.length}`);
console.log(`classifiable now        ${classified}  (${jobs.length ? ((100 * classified) / jobs.length).toFixed(1) : 0}%)`);
for (const [family, ids] of [...byFamily].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${family.padEnd(16)} ${ids.length}`);
}

if (!apply) {
  console.log('\nDry run. Re-run with --apply to write.');
  process.exit(0);
}

for (const [family, ids] of byFamily) {
  await writeBatches(ids, 200, `classify ${family}`, async (batch) => {
    const { error } = await db.from('jobs').update({ job_family: family }).in('id', batch).is('job_family', null);
    if (error) throw error;
  });
}
console.log('Done.');
