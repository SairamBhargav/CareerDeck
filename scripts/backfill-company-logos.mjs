/*
 * Give the logo-less companies a domain, and therefore a logo.
 *
 *   node --env-file-if-exists=server/.env scripts/backfill-company-logos.mjs [--apply]
 *
 * ── The problem ───────────────────────────────────────────────────────────────
 *
 * A company's logo is `logoUrlFor(domain)` — a favicon lookup keyed on the company's own
 * domain. Every company in scripts/board-list.ts has one because a human typed it. Every
 * company created by the Simplify aggregator does not, because that feed supplies a name
 * and nothing else, so `resolveCompaniesByName` can only honestly write a monogram.
 *
 * That is 1,075 of 1,224 companies rendering as a two-letter plate next to NVIDIA's
 * actual mark.
 *
 * ── Why the domain is derived from apply URLs ─────────────────────────────────
 *
 * Guessing it from the name does not work, and fails in the worst possible direction:
 * "Oshkosh" resolves to oshkosh.com, which belongs to Carter's — the babywear company
 * that owns OshKosh B'Gosh. We would have shipped children's clothing on a defence
 * contractor. "Johnson & Johnson" gives johnsonjohnson.com, which is dead; the real one
 * is jnj.com. A wrong logo is worse than no logo, so nothing here is guessed.
 *
 * Instead it reads what we already crawled. A posting's `apply_url` is where the employer
 * sends applicants, and for a good fraction of them that is the employer's own careers
 * host: jobs.bytedance.com, careers.garmin.com, jobs.l3harris.com. Those are facts from
 * the employer, not inferences about them.
 *
 * Postings that apply through an ATS or an aggregator are skipped rather than guessed at,
 * which is most of the reason coverage is partial rather than total. Partial and correct
 * beats total and sometimes wrong.
 *
 * ── Why no third party ────────────────────────────────────────────────────────
 *
 * Brandfetch resolves a name to a verified domain and would cover far more. It also adds
 * a dependency, a 30-day cache-refresh obligation in its terms, and a question about
 * automated bulk use. This gets a meaningful share of the way there using data already in
 * the database and the same favicon service the other 149 logos already use, which is a
 * cheaper trade for the first pass.
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (server/.env).');
  process.exit(1);
}

const APPLY = process.argv.includes('--apply');
/** Print every proposed domain rather than a sample, so the list can be eyeballed. */
const ALL = process.argv.includes('--all');
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

/*
 * Hosts that belong to an ATS, an aggregator or a job board rather than to the employer.
 * A domain from one of these would put Greenhouse's favicon on every Greenhouse customer.
 *
 * Deliberately generous: a host wrongly skipped costs one company its logo, a host
 * wrongly kept gives several companies the same wrong logo.
 */
const NOT_THE_EMPLOYER =
  /(myworkdayjobs|myworkdaysite|workdaysuite|greenhouse|lever\.co|ashbyhq|icims|taleo|smartrecruiters|jobvite|workable|bamboohr|applytojob|jazzhr|rippling|paylocity|oraclecloud|successfactors|dayforce|ultipro|adp\.com|paycom|paycor|recruitee|teamtailor|breezy|pinpointhq|eightfold|phenom|avature|brassring|silkroad|clearcompany|hirebridge|grnh\.se|recsolu|yello\.co|gusto\.com|simplify\.jobs|linkedin|indeed|glassdoor|ziprecruiter|monster|dice\.com|builtin|wellfound|angel\.co|github\.io|google\.com|notion\.site|airtable)/i;

/** Careers subdomains, so jobs.garmin.com becomes garmin.com. */
const CAREERS_PREFIX = /^(app|[a-z]*(jobs?|careers?|recruit\w*|talent|hiring|employment))\./i;

/** The favicon service's "I have nothing" response, so a real icon can be told from it. */
async function fallbackSize() {
  const r = await fetch(
    'https://www.google.com/s2/favicons?sz=128&domain_url=no-such-domain-9182736455.invalid',
  );
  return Buffer.from(await r.arrayBuffer()).length;
}

/**
 * Does this domain plausibly belong to this company?
 *
 * Reading the first pass showed the failure is never a broken domain — it is a real,
 * resolving, icon-bearing domain belonging to somebody else. Clerkie's postings apply
 * through getfiber.ai, Deutsche Bank's through an ATS, MindSmith's through Dover's
 * system, Markem-Imaje's through its parent. Every one of those passes a "does it load"
 * test and puts the wrong company's mark on a card.
 *
 * So the domain has to bear some relation to the name: either a word from the name
 * appears in it, or its first label is an acronym of those words. Neither is clever, and
 * together they reject every mismatch found by hand.
 *
 * It also rejects things that were right — jhuapl.edu for Johns Hopkins APL, cmc.com for
 * Commercial Metals. That is the intended direction of error. A company without a logo
 * looks unfinished; a company wearing another company's logo looks like a mistake nobody
 * checked, and is the one failure a reader can actually spot.
 */
function plausible(slug, domain) {
  const label = domain.split('.')[0].replace(/[^a-z0-9]/g, '');
  const words = slug.split('-').filter((w) => w.length >= 3);
  const flat = domain.replace(/[^a-z0-9]/g, '');

  // A word from the name shows up in the domain, or the other way round for short names.
  if (words.some((w) => flat.includes(w))) return true;
  if (slug.replace(/-/g, '').length >= 3 && flat.includes(slug.replace(/-/g, ''))) return true;

  // Or the first label is the initials: electronic-arts -> ea, illinois-tool-works -> itw.
  const initials = slug.split('-').map((w) => w[0]).join('');
  if (initials.length >= 2 && label === initials) return true;

  return false;
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return null;
  }
}

/**
 * The registrable domain, where that is safe to take.
 *
 * Only a known careers prefix is stripped. Anything else is left whole: lifeattiktok.com
 * is TikTok's careers site and its own registrable domain, and chopping labels off hosts
 * in general turns co.uk into uk.
 */
function registrable(host) {
  const stripped = host.replace(CAREERS_PREFIX, '');
  return stripped.split('.').length >= 2 ? stripped : host;
}

async function page(table, select, filter, size = 1000) {
  const out = [];
  for (let from = 0; ; from += size) {
    let q = admin.from(table).select(select).range(from, from + size - 1);
    if (filter) q = filter(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data ?? []));
    if ((data?.length ?? 0) < size) return out;
  }
}

async function main() {
  console.log(APPLY ? 'Running for real.\n' : 'Dry run — nothing is written. Pass --apply to write.\n');

  const companies = await page('companies', 'id, slug, name, domain, logo_url', (q) =>
    q.is('logo_url', null),
  );
  console.log(`companies without a logo: ${companies.length}`);

  const byId = new Map(companies.map((c) => [c.id, c]));

  const jobs = await page('jobs', 'company_id, apply_url', (q) => q.eq('status', 'open'));
  console.log(`open jobs scanned:        ${jobs.length}`);

  // One candidate host per company: the first that is plausibly the employer's own.
  const candidate = new Map();
  // Companies whose only apply host belonged to somebody else. Counted, not guessed at.
  const implausible = new Set();
  for (const job of jobs) {
    if (!byId.has(job.company_id) || candidate.has(job.company_id) || !job.apply_url) continue;
    const host = hostOf(job.apply_url);
    if (!host || NOT_THE_EMPLOYER.test(host)) continue;
    const domain = registrable(host);
    if (!plausible(byId.get(job.company_id).slug, domain)) {
      implausible.add(job.company_id);
      continue;
    }
    candidate.set(job.company_id, domain);
  }
  console.log(`companies with a candidate domain: ${candidate.size}`);
  console.log(`rejected as somebody else’s domain:  ${implausible.size}\n`);

  const fallback = await fallbackSize();
  const updates = [];
  let checked = 0;
  let rejected = 0;

  for (const [companyId, domain] of candidate) {
    checked += 1;
    let real = false;
    try {
      const r = await fetch(`https://www.google.com/s2/favicons?sz=128&domain_url=${domain}`);
      real = r.ok && Buffer.from(await r.arrayBuffer()).length !== fallback;
    } catch {
      real = false;
    }

    if (!real) {
      rejected += 1;
      continue;
    }

    updates.push({
      id: companyId,
      slug: byId.get(companyId).slug,
      domain,
      logo_url: `https://www.google.com/s2/favicons?sz=128&domain_url=${domain}`,
    });

    if (checked % 25 === 0) process.stdout.write(`  checked ${checked}/${candidate.size}\r`);
  }

  console.log(`\nverified: ${updates.length}   rejected (no real icon): ${rejected}\n`);
  for (const u of (ALL ? updates : updates.slice(0, 20))) console.log(`  ${u.slug.padEnd(34)} ${u.domain}`);
  if (!ALL && updates.length > 20) console.log(`  … and ${updates.length - 20} more (--all to list)`);

  if (!APPLY) {
    console.log(`\nDry run. ${updates.length} companies would gain a logo. Pass --apply to write.`);
    return;
  }

  let written = 0;
  for (const u of updates) {
    const { error } = await admin
      .from('companies')
      .update({ domain: u.domain, logo_url: u.logo_url })
      .eq('id', u.id);
    if (error) console.error(`  ${u.slug}: ${error.message}`);
    else written += 1;
  }
  console.log(`\nwrote ${written} of ${updates.length}.`);
}

await main();
