/**
 * Fills `job_signals` (20261023000000_match_signals.sql) for every open posting that has none, or
 * whose posting changed after its signals were read.
 *
 *   npm run ingest:signals              read and write
 *   npm run ingest:signals -- --dry-run read and report, write nothing
 *
 * Runs after each night's crawl (.github/workflows/ingest.yml). The first run is the backfill.
 * Safe to re-run: a posting whose signals are current is not selected, so a second run in a row
 * downloads ids and timestamps and nothing else.
 */

import { loadSkillDictionary, serviceClient } from './db.ts';
import { postingSignals } from './normalize/eligibility.ts';
import { compileDictionary } from './normalize/skills.ts';

const dryRun = process.argv.includes('--dry-run');
const PAGE = 1000;
const READ_CHUNK = 200;
const WRITE_CHUNK = 500;

interface JobStamp {
  id: string;
  updated_at: string;
}

interface JobText {
  id: string;
  title: string;
  company_name: string;
  skills: string[] | null;
  description_text: string | null;
  updated_at: string;
}

/** A `YYYY-MM` bound as the first of that month, which is what the scorer compares against. */
const asDate = (month: string | null) => (month ? `${month}-01` : null);

async function main() {
  const client = serviceClient();
  const dictionary = compileDictionary(await loadSkillDictionary(client));

  const stamps: JobStamp[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await client
      .from('jobs').select('id, updated_at').eq('status', 'open').order('id').range(offset, offset + PAGE - 1);
    if (error) throw error;
    stamps.push(...((data ?? []) as JobStamp[]));
    if (!data || data.length < PAGE) break;
  }

  const current = new Map<string, string>();
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await client
      .from('job_signals').select('job_id, source_updated_at').order('job_id').range(offset, offset + PAGE - 1);
    if (error) throw error;
    for (const row of data ?? []) current.set(row.job_id as string, row.source_updated_at as string);
    if (!data || data.length < PAGE) break;
  }

  const due = stamps.filter((job) => {
    const read = current.get(job.id);
    return read === undefined || new Date(read).getTime() < new Date(job.updated_at).getTime();
  });
  console.log(`${stamps.length} open posting(s); ${due.length} need signals`);

  const rows: Record<string, unknown>[] = [];
  const tally = { preferred: 0, none: 0, none_ever: 0, offered: 0, citizen: 0, us_person: 0, grad: 0 };
  for (let i = 0; i < due.length; i += READ_CHUNK) {
    const ids = due.slice(i, i + READ_CHUNK).map((job) => job.id);
    const { data, error } = await client
      .from('jobs').select('id, title, company_name, skills, description_text, updated_at').in('id', ids);
    if (error) throw error;
    for (const job of (data ?? []) as JobText[]) {
      const signals = postingSignals(dictionary, {
        title: job.title,
        companyName: job.company_name,
        skills: job.skills ?? [],
        descriptionText: job.description_text,
      });
      if (signals.preferredSkills.length > 0) tally.preferred += 1;
      if (signals.sponsorship) tally[signals.sponsorship] += 1;
      if (signals.citizenship) tally[signals.citizenship] += 1;
      if (signals.gradFrom || signals.gradTo) tally.grad += 1;
      rows.push({
        job_id: job.id,
        preferred_skills: signals.preferredSkills,
        sponsorship: signals.sponsorship,
        citizenship: signals.citizenship,
        grad_from: asDate(signals.gradFrom),
        grad_to: asDate(signals.gradTo),
        source_updated_at: job.updated_at,
        computed_at: new Date().toISOString(),
      });
    }
  }

  console.log(
    `read ${rows.length}: nice-to-have skills ${tally.preferred}, no sponsorship ${tally.none + tally.none_ever} ` +
      `(${tally.none_ever} "now or in the future"), sponsors ${tally.offered}, citizens only ${tally.citizen}, ` +
      `US persons ${tally.us_person}, graduation window ${tally.grad}`,
  );
  if (dryRun) return;

  let written = 0;
  for (let i = 0; i < rows.length; i += WRITE_CHUNK) {
    const { error } = await client.from('job_signals').upsert(rows.slice(i, i + WRITE_CHUNK), { onConflict: 'job_id' });
    if (error) throw error;
    written += Math.min(WRITE_CHUNK, rows.length - i);
  }
  console.log(`wrote ${written} row(s)`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
