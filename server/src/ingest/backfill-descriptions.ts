/**
 * One-off: gives the Simplify postings already in `jobs` the employer's own description.
 *
 *   npm run ingest:backfill-descriptions               every stub still open
 *   npm run ingest:backfill-descriptions -- --dry-run  fetch and report, write nothing
 *   npm run ingest:backfill-descriptions -- --limit=50 the first 50 apply URLs
 *
 * New postings get theirs at crawl time (aggregators/simplify.ts). This covers the rows that
 * landed before that existed, and removes the "Sourced from the Simplify…" line from the ones
 * whose employer page cannot be read. Safe to re-run: a row whose description is already the
 * employer's is not selected again.
 */

import { compileDictionary } from './normalize/skills.ts';
import { loadSkillDictionary, serviceClient } from './db.ts';
import { scoreQuality } from './normalize/quality.ts';
import { describePosting, fetchPostingDetails, type ListingFacts } from './aggregators/detail.ts';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const limit = Number(args.find((arg) => arg.startsWith('--limit='))?.slice(8) ?? Infinity);

/** Both stand-in formats: the old one with the provenance line, and the current one. */
const STUB_PATTERNS = ['%Sourced from the Simplify%', '%Tap Apply to see the full posting%'];

interface StubRow {
  id: string;
  title: string;
  company_name: string;
  company_id: string;
  apply_url: string;
  description_text: string;
}

/** The terms and degrees the stand-in stated, read back out of it. */
function factsFrom(row: StubRow): ListingFacts {
  const text = row.description_text;
  const terms = text.match(/Term(?:\(s\))?: ([^.]+)\./)?.[1];
  const degrees = text.match(/Open to:? ([^.]+?) students\./)?.[1];
  return {
    title: row.title,
    companyName: row.company_name,
    terms: terms ? terms.split(', ') : [],
    degrees: degrees ? degrees.split(', ') : [],
  };
}

async function main() {
  const client = serviceClient();
  const dictionary = compileDictionary(await loadSkillDictionary(client));

  const { data: sources, error: sourceError } = await client.from('job_sources').select('id').eq('kind', 'feed');
  if (sourceError) throw sourceError;
  const sourceIds = (sources ?? []).map((source) => source.id as string);

  const rows: StubRow[] = [];
  for (const pattern of STUB_PATTERNS) {
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await client
        .from('jobs')
        .select('id, title, company_name, company_id, apply_url, description_text')
        .in('source_id', sourceIds)
        .eq('status', 'open')
        .ilike('description_text', pattern)
        .order('id')
        .range(offset, offset + 999);
      if (error) throw error;
      rows.push(...((data ?? []) as StubRow[]));
      if (!data || data.length < 1000) break;
    }
  }

  const urls = [...new Set(rows.map((row) => row.apply_url))].slice(0, limit);
  const selected = rows.filter((row) => urls.includes(row.apply_url));
  console.log(`${rows.length} stub row(s) over ${new Set(rows.map((r) => r.apply_url)).size} URL(s); reading ${urls.length}`);

  const started = Date.now();
  const details = await fetchPostingDetails(urls, { concurrency: 12, log: (message) => console.log(message) });
  const found = [...details.values()].filter(Boolean).length;
  console.log(`read ${found} of ${urls.length} description(s) in ${Math.round((Date.now() - started) / 1000)}s`);

  // quality.ts's "a real program, not a one-off" signal, as the crawl computes it.
  const perCompany = new Map<string, number>();
  for (const row of selected) perCompany.set(row.company_id, (perCompany.get(row.company_id) ?? 0) + 1);

  let written = 0;
  let improved = 0;
  const updates = selected.map((row) => {
    const info = describePosting(factsFrom(row), details.get(row.apply_url) ?? null, dictionary);
    if (info.hasFullDescription) improved += 1;
    return {
      id: row.id,
      patch: {
        description_text: info.description_text,
        requirements: info.requirements,
        skills: info.skills,
        job_family: info.job_family,
        ...(info.salary
          ? { salary_min: info.salary.min, salary_max: info.salary.max, salary_period: info.salary.period }
          : {}),
        quality_score: scoreQuality({
          title: row.title,
          descriptionText: info.description_text,
          requirements: info.requirements,
          skills: info.skills,
          hasStructuredSalary: info.hasStructuredSalary,
          companyOpenPostings: perCompany.get(row.company_id) ?? 1,
          seniority: 'intern',
          hasCompanyDomain: false,
          hasFullDescription: info.hasFullDescription,
        }),
      },
    };
  });

  if (dryRun) {
    const sample = updates.find((update) => update.patch.description_text.length > 300);
    console.log(`dry run: ${improved} of ${updates.length} row(s) would get a real description`);
    if (sample) console.log(sample.patch.description_text.slice(0, 600));
    return;
  }

  let next = 0;
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (next < updates.length) {
      const { id, patch } = updates[next++]!;
      const { error } = await client.from('jobs').update(patch).eq('id', id);
      if (error) console.error(`update ${id}: ${error.message}`);
      else written += 1;
    }
  }));

  console.log(`updated ${written} row(s); ${improved} now carry the employer's description`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
