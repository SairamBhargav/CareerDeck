/*
 * Resolve the remaining logo-less companies through Brandfetch.
 *
 *   node --env-file-if-exists=server/.env scripts/resolve-company-logos.mjs            # propose
 *   node --env-file-if-exists=server/.env scripts/resolve-company-logos.mjs --review   # list every match
 *   node --env-file-if-exists=server/.env scripts/resolve-company-logos.mjs --apply    # write
 *
 * Needs BRANDFETCH_CLIENT_ID in server/.env. Register free at brandfetch.com/developers;
 * the same client id authorises both the Brand Search API and the logo CDN, and the free
 * plan allows 500k searches and 1M logo renders a month against the ~1,000 lookups here.
 *
 * ── Why a resolver rather than a guess ────────────────────────────────────────
 *
 * scripts/backfill-company-logos.mjs already took the free, safe portion: companies whose
 * postings apply through their own careers host, where the domain is a fact the employer
 * published rather than an inference about them. That reached 86.
 *
 * The rest apply through an ATS, so nothing in the database names their domain. Deriving
 * one from the company name fails in the worst direction — "Oshkosh" gives oshkosh.com,
 * which belongs to Carter's, the babywear company that owns OshKosh B'Gosh; "Johnson &
 * Johnson" gives a dead johnsonjohnson.com when the real one is jnj.com. A resolver knows
 * the difference because somebody curated it.
 *
 * ── Why a human still approves it ─────────────────────────────────────────────
 *
 * Brandfetch returns the name it matched, and that is what makes this safe — but not
 * automatic. Asked for "Oshkosh" it answers oshkosh.com and says the brand is "OshKosh
 * B'Gosh", which is the wrong company. Normalised, "oshkosh" is a substring of
 * "oshkoshbgosh", so a containment test accepts it. "Booz Allen" against "Booz Allen
 * Hamilton" has exactly the same shape and is correct.
 *
 * No string rule separates those two, so this does not pretend to. It sorts matches into
 * ones that are certain and ones that need an eye, prints both, and writes nothing until
 * somebody has read the list. The same bargain as the apply-url backfill: automate the
 * lookup, keep the judgement.
 *
 * ── The obligation this creates ───────────────────────────────────────────────
 *
 * Brandfetch's terms require a fresh API call at least every thirty days to keep the
 * licence on cached content. This script is re-runnable for that reason, and if logos
 * start mattering it belongs on a schedule rather than in somebody's memory.
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CLIENT_ID = process.env.BRANDFETCH_CLIENT_ID;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (server/.env).');
  process.exit(1);
}
if (!CLIENT_ID) {
  console.error(
    'BRANDFETCH_CLIENT_ID is required.\n' +
      'Register free at https://brandfetch.com/developers, copy the client id, and add it\n' +
      'to server/.env as BRANDFETCH_CLIENT_ID=...',
  );
  process.exit(1);
}

const APPLY = process.argv.includes('--apply');
const REVIEW = process.argv.includes('--review') || APPLY;
const LIMIT = Number.parseInt(process.argv.find((a) => /^--limit=/.test(a))?.split('=')[1] ?? '0', 10);

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

/** Lowercase, punctuation and the usual corporate furniture removed. */
const SUFFIXES =
  /\b(inc|incorporated|corp|corporation|co|company|llc|ltd|limited|plc|lp|llp|group|holdings|holding|technologies|technology|international|worldwide|global|the)\b/g;

function normalize(value) {
  return value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(SUFFIXES, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * How much the returned brand agrees with the company we asked about.
 *
 * `exact` is safe to apply without reading. `close` is where Oshkosh lives — one name
 * contains the other, which is right for "Booz Allen" / "Booz Allen Hamilton" and wrong
 * for "Oshkosh" / "OshKosh B'Gosh", and no amount of string comparison tells them apart.
 */
function agreement(ours, theirs) {
  const a = normalize(ours);
  const b = normalize(theirs);
  if (a === b) return 'exact';
  if (a.replace(/ /g, '') === b.replace(/ /g, '')) return 'exact';
  if (b.startsWith(a) || a.startsWith(b)) return 'close';
  if (b.includes(a) || a.includes(b)) return 'close';
  return 'weak';
}

async function search(name) {
  const url = `https://api.brandfetch.io/v2/search/${encodeURIComponent(name)}?c=${CLIENT_ID}`;
  try {
    const r = await fetch(url, { headers: { accept: 'application/json' } });
    if (!r.ok) return { error: `HTTP ${r.status}` };
    const list = await r.json();
    return { top: Array.isArray(list) && list.length > 0 ? list[0] : null };
  } catch (e) {
    return { error: String(e.message).slice(0, 60) };
  }
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
  console.log(APPLY ? 'Writing.\n' : 'Proposing only. Nothing is written.\n');

  let companies = await page('companies', 'id, slug, name, domain, logo_url', (q) =>
    q.is('logo_url', null),
  );
  // Most-hiring first, so a partial run covers what people actually see.
  companies = (await page('companies', 'id, open_job_count'))
    .reduce((acc, row) => {
      const c = companies.find((x) => x.id === row.id);
      if (c) acc.push({ ...c, open_job_count: row.open_job_count ?? 0 });
      return acc;
    }, [])
    .sort((a, b) => b.open_job_count - a.open_job_count);

  if (LIMIT > 0) companies = companies.slice(0, LIMIT);
  console.log(`companies without a logo: ${companies.length}\n`);

  const exact = [];
  const close = [];
  let weak = 0;
  let missed = 0;

  for (let i = 0; i < companies.length; i += 1) {
    const c = companies[i];
    const { top, error } = await search(c.name);
    if (error || !top?.domain) {
      missed += 1;
      continue;
    }

    const verdict = agreement(c.name, top.name ?? '');
    const row = {
      id: c.id,
      slug: c.slug,
      ours: c.name,
      theirs: top.name,
      domain: top.domain,
      jobs: c.open_job_count,
      logo_url: `https://cdn.brandfetch.io/${top.domain}?c=${CLIENT_ID}`,
    };

    if (verdict === 'exact') exact.push(row);
    else if (verdict === 'close') close.push(row);
    else weak += 1;

    if ((i + 1) % 25 === 0) process.stdout.write(`  resolved ${i + 1}/${companies.length}\r`);
  }

  console.log(`\nexact name match : ${exact.length}   (safe to apply)`);
  console.log(`needs an eye     : ${close.length}   (one name contains the other)`);
  console.log(`name disagreed   : ${weak}   (skipped)`);
  console.log(`no result        : ${missed}\n`);

  if (REVIEW && close.length > 0) {
    console.log('── these need reading: is it the same company? ────────────────');
    for (const r of close) {
      console.log(`  ${String(r.jobs).padStart(4)} jobs  ${r.ours}`);
      console.log(`              -> ${r.theirs}  (${r.domain})`);
    }
    console.log('');
  }

  if (REVIEW) {
    console.log('── exact matches ──────────────────────────────────────────────');
    for (const r of exact.slice(0, 40)) console.log(`  ${r.slug.padEnd(34)} ${r.domain}`);
    if (exact.length > 40) console.log(`  … and ${exact.length - 40} more`);
    console.log('');
  }

  if (!APPLY) {
    console.log(
      `Nothing written. --review lists every match; --apply writes the ${exact.length} exact ones.\n` +
        'The "needs an eye" group is never written automatically — paste the ones you accept\n' +
        'and I will add them, or widen the rule once you have seen what it catches.',
    );
    return;
  }

  let written = 0;
  for (const r of exact) {
    const { error } = await admin
      .from('companies')
      .update({ domain: r.domain, logo_url: r.logo_url })
      .eq('id', r.id);
    if (error) console.error(`  ${r.slug}: ${error.message}`);
    else written += 1;
  }
  console.log(`wrote ${written} of ${exact.length} exact matches.`);
  console.log(`${close.length} close matches were left alone, deliberately.`);
}

await main();
