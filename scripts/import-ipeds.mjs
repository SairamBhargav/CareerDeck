/*
 * Builds the school list from IPEDS, the federal directory of US institutions.
 *
 *   node scripts/import-ipeds.mjs
 *
 * Writes two things from one source, which is the point:
 *
 *  - `constants/schools.ts` — what the app bundles and searches. No database ids in it,
 *    so it can be regenerated without a migration and without a `db:reset`.
 *  - `supabase/schools-rows.sql` — the `schools` rows, keyed on `ipeds_id`. This is what
 *    `profiles.school_id_claimed` points at and what `.edu` verification matches domains
 *    against, so it has to be in Postgres however static the data is.
 *
 * Both are generated, both are committed. Committing generated output is the right call
 * here: it is reference data that changes once a year, the build must not depend on a
 * federal website being up, and a diff on the school list is something a human should be
 * able to read in a pull request.
 *
 * ── Why the aliases matter more than the names ────────────────────────────────
 *
 * The whole reason this file exists is that "CU Boulder" and "Boulder" and "Colorado" are
 * the same school and free text made them three. IPEDS ships an `inst_alias` field that
 * already solves it — CU Boulder's reads:
 *
 *   U of Colorado|Univ of Colorado|University of Colorado|U of CO|Boulder|CU|CU-Boulder|
 *   UCB|CUB|Colorado|Colorado University|Buffs|Buffaloes|CU at Boulder|...
 *
 * Every one of those resolves to unitid 126614. Typing any of them finds the right row.
 *
 * Aliases are filtered hard before they ship, because the raw field is long and most of it
 * is dead weight — see `usefulAliases`.
 */

import fs from 'node:fs';

const SOURCE =
  'https://educationdata.urban.org/api/v1/college-university/ipeds/directory/2022/';

/*
 * A browser UA, because the API 403s a bare `node-fetch` one. Not a workaround for a rate
 * limit or an auth check — the data is public domain, this is one request a year, and the
 * block is indiscriminate rather than aimed at us.
 */
const HEADERS = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
  accept: 'application/json',
};

/**
 * Lowercased, punctuation flattened to single spaces.
 *
 * This is what makes "CU-Boulder" and "cu boulder" one string, and "M.I.T." and "mit".
 * IPEDS punctuates aliases however the registrar felt that year, and nobody types a
 * period into a search field.
 */
function normalize(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Words that are never a useful thing to type, and never disambiguate anything. */
const NOISE = new Set([
  'university', 'college', 'institute', 'school', 'campus', 'main', 'the', 'of', 'at', 'and',
]);

/**
 * Only the joining words. Deliberately much smaller than NOISE: an acronym needs the
 * institution word, or "New York University" becomes "NY" and fails the length floor.
 */
const ACRONYM_SKIP = new Set(['of', 'the', 'at', 'and', 'in', 'for']);

/**
 * An acronym built from the name, for the schools IPEDS leaves blank.
 *
 * New York University ships an empty alias field, so "NYU" found nothing at all — and
 * that is the third most obvious thing anyone could type. Initials of the significant
 * words reconstruct it, and the same rule gives UCF, USC and a few hundred others.
 *
 * Only used when IPEDS offered nothing, and only at three letters or more: two-letter
 * acronyms collide constantly ("CC" is forty colleges) and would bury real matches.
 */
function acronymOf(name) {
  const words = name
    .replace(/[^A-Za-z ]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !ACRONYM_SKIP.has(w.toLowerCase()));
  const acronym = words.map((w) => w[0].toUpperCase()).join('');
  return acronym.length >= 3 && acronym.length <= 5 ? acronym : null;
}

/**
 * Which aliases are worth the bundle bytes.
 *
 * The raw field averages around 120 characters and most of it is redundant: "University of
 * Colorado" is already a prefix of "University of Colorado Boulder", so searching the name
 * finds it and shipping it twice costs bytes for nothing. What survives is the part the
 * name cannot match — acronyms (CU, UCB, MIT), and nicknames (Buffs, Mines).
 */
function usefulAliases(rawField, name) {
  // Deliberately not an early return for an empty field: a blank alias list is exactly
  // when the acronym fallback at the bottom has to run. NYU’s field is a single space.
  const raw = rawField && rawField.trim() ? rawField : '';

  const seen = new Set();
  const out = [];

  /*
   * Both delimiters. IPEDS is inconsistent: CU Boulder’s field is pipe-separated, MIT’s
   * is "MIT, M.I.T." with a comma. Splitting on only one turns the other school’s whole
   * list into a single unmatchable string.
   */
  for (const piece of raw.split(/[|,]/)) {
    const alias = piece.trim().replace(/\s{2,}/g, ' ');
    if (!alias || alias.length < 2 || alias.length > 24) continue;

    const key = normalize(alias);
    if (!key || seen.has(key)) continue;
    // The name already finds it.
    if (normalize(name).includes(key)) continue;
    // A single noise word on its own matches half the country.
    if (NOISE.has(key)) continue;

    seen.add(key);
    out.push(alias);
  }

  /*
   * Shortest first, then cap.
   *
   * Without this the cap keeps whatever IPEDS listed first, and for CU Boulder that is
   * "U of Colorado", "Univ of Colorado", "University of CO" — six slots of prose nobody
   * types, crowding out CU, UCB and Buffs. Short aliases are acronyms and nicknames,
   * which are exactly the strings the name cannot already match.
   */
  out.sort((a, b) => a.length - b.length);

  // Nothing usable from IPEDS — fall back to initials rather than shipping a school
  // that only its own full legal name can find.
  if (out.length === 0) {
    const acronym = acronymOf(name);
    if (acronym && !normalize(name).includes(normalize(acronym))) return [acronym];
  }

  return out.slice(0, 6);
}

/** `www.colorado.edu/` → `colorado.edu`. Null when IPEDS has nothing usable. */
function domainOf(url) {
  if (!url || !url.trim()) return null;
  const host = url
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .split(/[/?#]/)[0]
    .toLowerCase();
  // Must look like a hostname. IPEDS has a few free-text entries in this column.
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) ? host : null;
}

function sqlQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function main() {
  process.stdout.write('Fetching the IPEDS directory… ');
  const response = await fetch(SOURCE, { headers: HEADERS });
  if (!response.ok) throw new Error(`IPEDS returned ${response.status}`);
  const payload = await response.json();
  const all = payload.results ?? [];
  console.log(`${all.length} institutions.`);

  const schools = all
    .filter((row) => row.degree_granting === 1)
    .filter((row) => row.currently_active_ipeds === 1)
    .filter((row) => !row.date_closed || String(row.date_closed).startsWith('-'))
    .filter((row) => typeof row.inst_name === 'string' && row.inst_name.trim().length > 1)
    .map((row) => ({
      id: row.unitid,
      /*
       * IPEDS suffixes flagship campuses "-Main Campus" — "Purdue University-Main
       * Campus", "Georgia Institute of Technology-Main Campus". Nobody says that, and it
       * actively hurts: ties are broken by name length, so the suffix pushed each
       * flagship below its own satellite campuses. Twenty schools carry it.
       */
      name: row.inst_name.trim().replace(/\s*-\s*Main Campus$/i, '').replace(/\s{2,}/g, ' '),
      state: row.state_abbr ?? '',
      alt: usefulAliases(row.inst_alias, row.inst_name),
      domain: domainOf(row.url_school),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const withDomain = schools.filter((s) => s.domain !== null).length;
  const withAlias = schools.filter((s) => s.alt.length > 0).length;
  console.log(
    `Kept ${schools.length} degree-granting, currently active. ` +
      `${withDomain} have a domain, ${withAlias} have aliases.`,
  );

  // ── constants/schools.ts ───────────────────────────────────────────────────

  const entries = schools
    .map((s) => {
      const alt = s.alt.length > 0 ? `, alt: [${s.alt.map((a) => JSON.stringify(a)).join(', ')}]` : '';
      return `  { id: ${s.id}, name: ${JSON.stringify(s.name)}, state: ${JSON.stringify(s.state)}${alt} },`;
    })
    .join('\n');

  const ts = `/*
 * Every degree-granting, currently active US institution in the IPEDS directory.
 *
 * GENERATED by scripts/import-ipeds.mjs — do not edit by hand. Rerun it to refresh;
 * IPEDS publishes once a year.
 *
 * ── Why this is bundled rather than queried ───────────────────────────────────
 *
 * The canonical rows live in Postgres, because \`profiles.school_id_claimed\` is a foreign
 * key and \`.edu\` verification matches domains server-side. But the *search* has no
 * business being a network call: it is a fixed list that never changes between releases,
 * and a round trip per keystroke is slow, needs debouncing, and fails offline.
 *
 * So the database holds the rows and the app holds a copy to search. The join between
 * them is \`id\`, the IPEDS UNITID — a stable federal identifier, not a database-generated
 * uuid, so this file survives a \`db:reset\` and can be regenerated on its own.
 *
 * ── \`alt\` is the whole point ──────────────────────────────────────────────────
 *
 * "CU Boulder", "Boulder", "CU" and "Buffs" are one school, and free text made them four.
 * IPEDS already knows they are aliases of unitid 126614, so typing any of them finds the
 * right row. Aliases the name already contains are dropped at import — searching
 * "University of Colorado" finds it via \`name\` and does not need storing twice.
 */

export interface School {
  /** IPEDS UNITID. Stable across years and across databases. */
  id: number;
  name: string;
  /** Two-letter state code, shown beside the name so duplicates are tellable apart. */
  state: string;
  /** Acronyms and nicknames the name itself does not contain. */
  alt?: string[];
}

export const SCHOOLS: School[] = [
${entries}
];

/** How many suggestions a picker shows. Enough to find it, few enough to scan. */
export const SCHOOL_SUGGESTION_LIMIT = 8;

/**
 * Lowercased with punctuation flattened, so "CU-Boulder", "CU Boulder" and "cu  boulder"
 * are one string — and so are "M.I.T." and "mit". Applied to both sides of every
 * comparison below; a query is never compared against raw text.
 */
function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Schools matching what someone has typed, best first.
 *
 * Ranked rather than filtered, because "Colorado" matches forty rows and the one somebody
 * means is almost never the fortieth. The order is: an exact alias hit ("CU"), then a name
 * that starts with the query, then a name that contains it, then an alias that contains
 * it, and last a match whose words are spread across the name and the aliases together.
 * Within a tier, shorter names win — "Colorado College" before "Colorado College of
 * Osteopathic Medicine", because the shorter name is the more common answer.
 */
export function searchSchools(query: string, limit = SCHOOL_SUGGESTION_LIMIT): School[] {
  const q = normalize(query);
  if (q.length < 2) return [];

  const scored: { school: School; rank: number }[] = [];

  for (const school of SCHOOLS) {
    const name = normalize(school.name);
    const alts = school.alt?.map(normalize) ?? [];

    let rank = -1;
    if (alts.includes(q)) rank = 0;
    else if (name.startsWith(q)) rank = 1;
    else if (alts.some((a) => a.startsWith(q))) rank = 2;
    else if (name.includes(q)) rank = 3;
    else if (alts.some((a) => a.includes(q))) rank = 4;
    else {
      /*
       * Last tier: every word of the query found somewhere across the name and the
       * aliases, not necessarily in the same one.
       *
       * This is what makes "cu boulder" work. "CU" is an alias and "Boulder" is in the
       * name, and no single field holds both — so every test above misses, even though a
       * human typed the most natural possible thing. Tokens are also why "texas austin"
       * and "colorado boulder" find the right row without anyone guessing the official
       * word order.
       */
      const haystack = [name, ...alts].join(' ');
      const tokens = q.split(' ').filter(Boolean);
      if (tokens.length > 1 && tokens.every((t) => haystack.includes(t))) rank = 5;
    }

    if (rank >= 0) scored.push({ school, rank });
  }

  scored.sort((a, b) => a.rank - b.rank || a.school.name.length - b.school.name.length);
  return scored.slice(0, limit).map((entry) => entry.school);
}

/** The row for an IPEDS id, for rendering a school somebody picked earlier. */
export function schoolById(id: number | null): School | undefined {
  if (id === null) return undefined;
  return SCHOOLS.find((school) => school.id === id);
}
`;

  fs.writeFileSync('constants/schools.ts', ts);
  const tsSize = (fs.statSync('constants/schools.ts').size / 1024).toFixed(0);
  console.log(`Wrote constants/schools.ts (${tsSize} KB, ${schools.length} rows).`);

  // ── supabase/schools-rows.sql ──────────────────────────────────────────────

  const values = schools
    .map((s) => {
      const domains = s.domain ? `array[${sqlQuote(s.domain)}]::extensions.citext[]` : `'{}'::extensions.citext[]`;
      return `  (${s.id}, ${sqlQuote(s.name)}, ${sqlQuote(s.state)}, ${domains})`;
    })
    .join(',\n');

  const sql = `-- GENERATED by scripts/import-ipeds.mjs — do not edit by hand.
--
-- Every degree-granting, currently active US institution in the IPEDS directory, keyed on
-- UNITID. This is the table \`profiles.school_id_claimed\` points at and the one \`.edu\`
-- verification matches \`email_domains\` against.
--
-- Idempotent on \`ipeds_id\`, so rerunning the import and re-seeding updates names and
-- domains without orphaning any profile that already points at a row.

insert into public.schools (ipeds_id, name, state, email_domains) values
${values}
on conflict (ipeds_id) do update set
  name          = excluded.name,
  state         = excluded.state,
  email_domains = case
                    when excluded.email_domains = '{}'::extensions.citext[]
                      then public.schools.email_domains
                    else excluded.email_domains
                  end;
`;

  fs.writeFileSync('supabase/schools-rows.sql', sql);
  const sqlSize = (fs.statSync('supabase/schools-rows.sql').size / 1024).toFixed(0);
  console.log(`Wrote supabase/schools-rows.sql (${sqlSize} KB).`);
  console.log(
    'To publish a refresh, paste it into a NEW migration — never edit an applied one. ' +
      'Seeds do not reach a hosted project; only `db push` does.',
  );
}

await main();
