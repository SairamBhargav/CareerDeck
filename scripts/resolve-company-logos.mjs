/*
 * Resolve logo-less companies to a real domain through Brandfetch.
 *
 *   node --env-file-if-exists=server/.env scripts/resolve-company-logos.mjs           # propose
 *   node --env-file-if-exists=server/.env scripts/resolve-company-logos.mjs --review  # list everything
 *   node --env-file-if-exists=server/.env scripts/resolve-company-logos.mjs --apply   # write the exact matches
 *
 * Needs BRANDFETCH_CLIENT_ID in server/.env. One client id authorises both the Brand
 * Search API and the logo CDN; the free plan allows 500k searches and 1M renders a month,
 * against roughly a thousand lookups here.
 *
 * ── Why a resolver ────────────────────────────────────────────────────────────
 *
 * A logo needs a domain. Companies in scripts/board-list.ts have one because a human
 * typed it; companies the Simplify aggregator created do not, because that feed carries a
 * name and nothing else. An earlier pass recovered 86 of them from `jobs.apply_url`,
 * where the employer's own careers host is a fact they published. The rest apply through
 * an ATS, so nothing in the database names their domain.
 *
 * Deriving one from the name fails in the worst direction. "Oshkosh" gives oshkosh.com,
 * which belongs to Carter's — the babywear company that owns OshKosh B'Gosh. "Johnson &
 * Johnson" gives a dead johnsonjohnson.com when the real one is jnj.com. A resolver knows
 * the difference because somebody curated it.
 *
 * ── Why a human still approves half of it ─────────────────────────────────────
 *
 * Brandfetch returns the name it matched, and that is what makes this safe — but not
 * automatic. Asked for "Oshkosh" it answers oshkosh.com and names the brand "OshKosh
 * B'Gosh". Normalised, "oshkosh" is a substring of "oshkoshbgosh", so a containment test
 * accepts it; "Booz Allen" against "Booz Allen Hamilton" has exactly the same shape and
 * is correct. No string rule separates those two.
 *
 * So this does not pretend to. Matches sort into `exact`, which is written, and `close`,
 * which is printed and never written. Automate the lookup, keep the judgement.
 *
 * ── The obligation ────────────────────────────────────────────────────────────
 *
 * Brandfetch's terms require a fresh call at least every thirty days to keep the licence
 * on cached content. This is re-runnable for that reason, and belongs on a schedule if
 * logos start mattering.
 *
 * The client id ends up inside every stored logo URL, which is how their CDN is designed
 * to work — it identifies the caller rather than authenticating them, and those URLs are
 * served to every reader. It is not a secret in that usage, even though it lives beside
 * ones that are.
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
      'Register free at https://brandfetch.com/developers and add it to server/.env.',
  );
  process.exit(1);
}

const APPLY = process.argv.includes('--apply');
const REVIEW = process.argv.includes('--review') || APPLY;
const LIMIT = Number.parseInt(
  process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1] ?? '0',
  10,
);

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

/** Corporate furniture that differs between how we store a name and how Brandfetch does. */
const SUFFIXES =
  /\b(inc|incorporated|corp|corporation|co|company|llc|ltd|limited|plc|lp|llp|group|holdings?|technologies|technology|international|worldwide|global|the)\b/g;

function normalize(value) {
  return String(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(SUFFIXES, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * How far the returned brand agrees with the company we asked about.
 *
 * `exact` is safe to write unread. `close` is where Oshkosh lives, and is never written
 * automatically — see the header for why no rule can settle it.
 */
function agreement(ours, theirs) {
  const a = normalize(ours);
  const b = normalize(theirs);
  if (!a || !b) return 'weak';
  if (a === b || a.replace(/ /g, '') === b.replace(/ /g, '')) return 'exact';
  if (b.startsWith(a) || a.startsWith(b) || b.includes(a) || a.includes(b)) return 'close';
  return 'weak';
}

/**
 * Does the domain itself look like it belongs to this company?
 *
 * The name agreeing is not enough, because Brandfetch's own records are sometimes wrong
 * in a way no name check can see. It returns "Hewlett Packard Enterprise" pointing at
 * selectium.com, three separate "AeroVironment" records pointing at acquired
 * subsidiaries, and a verified "Motorola" on motorola.com.br. Every one of those passes
 * an exact name comparison.
 *
 * So the domain has to corroborate: a word from the name appears in it, or its first
 * label is the initials. Texas Instruments keeps ti.com and General Motors keeps gm.com;
 * selectium.com and planckaero.com do not survive.
 *
 * It costs correct answers too — jnj.com for Johnson & Johnson is right and fails both
 * tests. Those fall to the review list rather than being lost, which is what the review
 * list is for.
 */
function domainCorroborates(slug, domain) {
  const label = domain.split('.')[0].replace(/[^a-z0-9]/g, '');
  const flat = domain.replace(/[^a-z0-9]/g, '');
  const words = slug.split('-').filter((w) => w.length >= 3);

  if (words.some((w) => flat.includes(w))) return true;
  if (slug.replace(/-/g, '').length >= 3 && flat.includes(slug.replace(/-/g, ''))) return true;

  const initials = slug.split('-').map((w) => w[0]).join('');
  if (initials.length >= 2 && label === initials) return true;

  return false;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/*
 * Brandfetch throttles hard and says so plainly: `429 {"message":"Slow down."}`. The
 * first run of this script had no pacing at all and was cut off almost immediately — of
 * 1,146 lookups, 1,063 came back empty and were counted as "no such company", which is a
 * far more damaging kind of wrong than a slow script. The quota was never the limit; the
 * rate was.
 *
 * So: a gap between calls, and a backoff that actually waits rather than giving up. A
 * 429 is the server asking for patience, not refusing.
 */
const GAP_MS = 350;
const RETRIES = 4;

async function search(name) {
  for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
    try {
      const r = await fetch(
        `https://api.brandfetch.io/v2/search/${encodeURIComponent(name)}?c=${CLIENT_ID}`,
        { headers: { accept: 'application/json' } },
      );

      if (r.status === 429) {
        // Honour Retry-After when it is offered; otherwise back off geometrically.
        const after = Number.parseInt(r.headers.get('retry-after') ?? '', 10);
        await sleep(Number.isFinite(after) ? after * 1000 : 1500 * 2 ** attempt);
        continue;
      }

      if (!r.ok) return { error: `HTTP ${r.status}` };
      const list = await r.json();
      await sleep(GAP_MS);
      return { top: Array.isArray(list) && list.length > 0 ? list[0] : null };
    } catch (e) {
      if (attempt === RETRIES) return { error: String(e.message).slice(0, 50) };
      await sleep(1000 * 2 ** attempt);
    }
  }
  return { error: 'rate limited after retries' };
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
  console.log(APPLY ? 'Writing exact matches.\n' : 'Proposing only — nothing is written.\n');

  // Most-hiring first, so a partial run covers what people actually see on screen.
  let companies = (
    await page('companies', 'id, slug, name, open_job_count', (q) => q.is('logo_url', null))
  ).sort((a, b) => (b.open_job_count ?? 0) - (a.open_job_count ?? 0));

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
    } else {
      const row = {
        id: c.id,
        slug: c.slug,
        ours: c.name,
        theirs: top.name ?? '',
        domain: top.domain,
        jobs: c.open_job_count ?? 0,
        logo_url: `https://cdn.brandfetch.io/${top.domain}?c=${CLIENT_ID}`,
      };
      const verdict = agreement(c.name, top.name ?? '');
      const corroborated = domainCorroborates(c.slug, top.domain);

      // Both, or it is not automatic. The name says Brandfetch found the right company;
      // the domain says it found that company's own site. They fail independently.
      if (verdict === 'exact' && corroborated) exact.push(row);
      else if (verdict === 'exact' || verdict === 'close') close.push(row);
      else weak += 1;
    }

    if ((i + 1) % 25 === 0) process.stdout.write(`  resolved ${i + 1}/${companies.length}\r`);
  }

  console.log(`\nexact name match : ${exact.length}   (written by --apply)`);
  console.log(`needs an eye     : ${close.length}   (one name contains the other)`);
  console.log(`name disagreed   : ${weak}   (skipped)`);
  console.log(`no result        : ${missed}\n`);

  if (REVIEW && close.length > 0) {
    console.log('── read these: is it the same company? ────────────────────────');
    for (const r of close.slice(0, 60)) {
      console.log(`  ${String(r.jobs).padStart(4)} jobs  ${r.ours}  ->  ${r.theirs}  (${r.domain})`);
    }
    if (close.length > 60) console.log(`  … and ${close.length - 60} more`);
    console.log('');
  }

  if (REVIEW) {
    console.log('── exact ─────────────────────────────────────────────────────');
    for (const r of exact.slice(0, 40)) console.log(`  ${r.slug.padEnd(32)} ${r.domain}`);
    if (exact.length > 40) console.log(`  … and ${exact.length - 40} more`);
    console.log('');
  }

  if (!APPLY) {
    console.log(`Nothing written. --review lists everything, --apply writes the ${exact.length} exact ones.`);
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
