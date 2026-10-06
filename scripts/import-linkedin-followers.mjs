/*
 * Load companies' LinkedIn follower counts from data/linkedin-followers.csv
 * (20261011000000_linkedin_followers.sql explains why they are shown at all).
 *
 *   node --env-file=server/.env scripts/import-linkedin-followers.mjs            dry run
 *   node --env-file=server/.env scripts/import-linkedin-followers.mjs --apply    writes
 *
 * The CSV is `slug,followers,as_of` — one row per company, `as_of` the date the figure was read
 * off LinkedIn's public page (YYYY-MM-DD). Edit it by hand and re-run; a slug that matches no
 * company is reported and skipped. This is deliberately not a crawler: LinkedIn's terms forbid
 * automated collection, so the numbers are entered, dated, and refreshed on purpose.
 */

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const apply = process.argv.includes('--apply');
const file = new URL('../data/linkedin-followers.csv', import.meta.url);

const rows = readFileSync(file, 'utf8')
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#') && !line.startsWith('slug,'))
  .map((line, index) => {
    const [slug, followers, asOf] = line.split(',').map((cell) => cell.trim());
    const count = Number(followers);
    if (!slug || !Number.isInteger(count) || count < 0 || !/^\d{4}-\d{2}-\d{2}$/.test(asOf ?? '')) {
      throw new Error(`line ${index + 1} is not slug,followers,YYYY-MM-DD: ${line}`);
    }
    return { slug, count, asOf };
  });

const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const { data: companies, error } = await client
  .from('companies')
  .select('id, slug')
  .in('slug', rows.map((row) => row.slug));
if (error) throw error;
const known = new Map(companies.map((company) => [company.slug.toLowerCase(), company.id]));

const missing = rows.filter((row) => !known.has(row.slug.toLowerCase()));
for (const row of missing) console.log(`skip  ${row.slug} — no such company`);

const updates = rows.filter((row) => known.has(row.slug.toLowerCase()));
console.log(`${updates.length} of ${rows.length} rows match a company${apply ? '' : ' (dry run; --apply to write)'}`);
if (!apply) process.exit(0);

let written = 0;
for (const row of updates) {
  const { error: updateError } = await client
    .from('companies')
    .update({ linkedin_follower_count: row.count, linkedin_followers_as_of: row.asOf })
    .eq('id', known.get(row.slug.toLowerCase()));
  if (updateError) console.error(`fail  ${row.slug}: ${updateError.message}`);
  else written += 1;
}
console.log(`updated ${written} companies`);
