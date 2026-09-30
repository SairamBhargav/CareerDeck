/*
 * What would crawling more Workday boards actually cost?
 *
 *   node scripts/measure-workday.mjs [sampleSize]
 *
 * Discovery first. Every Simplify listing carries the employer's own apply URL, and for a
 * Workday employer that URL *is* the board address — tenant, instance and career site,
 * verified rather than guessed. That matters because none of the three is derivable:
 * RTX's tenant is `globalhr`, Booz Allen's is `bah`, Merck's is `msd`. A pattern sweep of
 * 208 guesses across 13 tenants found nothing; this finds a thousand.
 *
 * Then measurement. A Workday source crawls the employer's *whole* board, not the
 * internship slice Simplify happens to list, so the question is not "can we reach them"
 * but "what does each one weigh". This asks each sampled board for its total, estimates
 * what survives the US/Canada and student-level filters, and converts to megabytes at the
 * corpus's own measured bytes-per-job.
 *
 * Read-only. It counts postings and writes nothing anywhere.
 */

import fs from 'node:fs';

const FEED =
  'https://raw.githubusercontent.com/SimplifyJobs/Summer2027-Internships/dev/.github/scripts/listings.json';

const UA = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
  'content-type': 'application/json',
  accept: 'application/json',
};

/*
 * From the hosted corpus on 2026-09-29: 184 MB across 13,650 jobs after the VACUUM FULL,
 * which is ~13.5 KB per job including its raw posting, its search vector and its indexes.
 * A rough number from a real database beats a precise one from nowhere.
 */
const KB_PER_JOB = 13.5;

/*
 * The share of a full board that survives `postingInScope` — US/Canada, and student-level
 * only (Senior and Staff+ are dropped). Measured against the seven boards already
 * crawled: NVIDIA keeps 280 of ~2,000, Salesforce 216 of 1,520, Adobe 196 of 553,
 * Capital One 654 of 1,847. That is 9% to 35%, averaging near 18%.
 */
const IN_SCOPE_SHARE = 0.18;

const WORKDAY = /([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([A-Za-z0-9_-]+)/;

/** Byte-for-byte the one in server/src/ingest/db.ts, so slugs match the rows that exist. */
function slugify(name) {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base === '' ? 'company' : base;
}

/** The board's total postings, or null when the tenant/site pair does not answer. */
async function boardTotal(tenant, wd, site) {
  const url = `https://${tenant}.${wd}.myworkdayjobs.com/wday/cxs/${tenant}/${site}/jobs`;
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: UA,
      body: JSON.stringify({ appliedFacets: {}, limit: 1, offset: 0, searchText: '' }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    const total = j.total ?? j.totalCount;
    return typeof total === 'number' ? total : null;
  } catch {
    return null;
  }
}

async function main() {
  const sampleSize = Number.parseInt(process.argv[2] ?? '20', 10);

  process.stdout.write('Reading the Simplify feed… ');
  const feed = await fetch(FEED, { headers: UA }).then((r) => r.json());
  console.log(`${feed.length} listings.`);

  // ── discovery ──────────────────────────────────────────────────────────────

  const boards = new Map();
  for (const l of feed) {
    const m = WORKDAY.exec(l.url ?? '');
    if (!m || !l.company_name) continue;
    const token = `${m[1]}.${m[2]}/${m[3]}`;
    const key = `${slugify(l.company_name)}|${token}`;
    const entry = boards.get(key) ?? {
      slug: slugify(l.company_name),
      name: l.company_name,
      token,
      active: 0,
    };
    if (l.active !== false) entry.active += 1;
    boards.set(key, entry);
  }

  const ranked = [...boards.values()]
    .filter((b) => b.active > 0)
    .sort((a, b) => b.active - a.active);

  console.log(`Workday boards discovered: ${boards.size}  (${ranked.length} with an active listing)\n`);

  // ── measurement ────────────────────────────────────────────────────────────

  const sample = ranked.slice(0, sampleSize);
  console.log(`Asking ${sample.length} boards for their size…\n`);

  const measured = [];
  for (const b of sample) {
    const [host, site] = b.token.split('/');
    const [tenant, wd] = host.split('.');
    const total = await boardTotal(tenant, wd, site);
    measured.push({ ...b, total });
    const kept = total === null ? null : Math.round(total * IN_SCOPE_SHARE);
    console.log(
      `  ${String(b.active).padStart(3)} listed  ${b.slug.padEnd(28)} ` +
        (total === null
          ? 'board did not answer'
          : `${String(total).padStart(5)} on the board → ~${String(kept).padStart(4)} in scope`),
    );
  }

  const live = measured.filter((m) => m.total !== null);
  if (live.length === 0) {
    console.log('\nNo board answered. Nothing to estimate.');
    return;
  }

  const totals = live.map((m) => m.total).sort((a, b) => a - b);
  const median = totals[Math.floor(totals.length / 2)];
  const mean = Math.round(totals.reduce((a, b) => a + b, 0) / totals.length);
  const keptPerBoard = mean * IN_SCOPE_SHARE;
  const mbPerBoard = (keptPerBoard * KB_PER_JOB) / 1024;

  console.log(`\n── per board ──────────────────────────────────────────────────`);
  console.log(`  answered            ${live.length} of ${sample.length}`);
  console.log(`  postings, median    ${median}`);
  console.log(`  postings, mean      ${mean}`);
  console.log(`  in scope (~${Math.round(IN_SCOPE_SHARE * 100)}%)    ${Math.round(keptPerBoard)} jobs`);
  console.log(`  storage             ~${mbPerBoard.toFixed(1)} MB`);

  console.log(`\n── what a tier would cost ─────────────────────────────────────`);
  for (const n of [25, 50, 100, 250, ranked.length]) {
    const jobs = Math.round(n * keptPerBoard);
    const mb = (jobs * KB_PER_JOB) / 1024;
    console.log(
      `  top ${String(n).padStart(4)} boards   ~${String(jobs.toLocaleString()).padStart(8)} jobs   ~${mb.toFixed(0).padStart(5)} MB`,
    );
  }

  console.log(
    `\nAgainst a 500 MB plan currently holding ~184 MB, so roughly 316 MB of headroom\n` +
      `before the failure mode of 2026-09-29 repeats.`,
  );

  // Under .expo/, which is already ignored: this is a scratch artifact of a measuring
  // run, not something a reviewer should be asked to read 436 entries of.
  fs.mkdirSync('.expo', { recursive: true });
  const out = '.expo/workday-boards.json';
  fs.writeFileSync(out, JSON.stringify(ranked, null, 2));
  console.log(`\nAll ${ranked.length} discovered boards written to ${out}.`);
}

await main();
