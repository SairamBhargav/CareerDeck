/**
 * Location parsing — docs/README.md §4.4.
 *
 * "~40% of postings have a messy location string (`Remote - US`, `SF / NYC / Remote`,
 * `Multiple Locations`). Multi-location postings should fan out into multiple `jobs` rows
 * sharing a `dedup_group_id`, or the location filter lies."
 *
 * The fan-out is the important half. A posting listed in three cities that is stored as
 * one row with the string "SF / NYC / Remote" is invisible to a filter for any of the
 * three, and a student filtering for their own city sees nothing and concludes the app is
 * empty.
 */

export type LocationTypeValue = 'Onsite' | 'Hybrid' | 'Remote';

export interface ParsedLocation {
  raw: string;
  city: string | null;
  region: string | null;
  country: string | null;
  type: LocationTypeValue;
}

/**
 * §4.4 fans multi-location postings out into one row each. Capped, because a posting
 * that lists forty offices is one req with a dropdown, not forty jobs, and forty cards
 * from one employer destroys the feed for everyone else in it.
 */
export const MAX_LOCATIONS_PER_POSTING = 6;

const REMOTE =
  /\b(remote|work from home|wfh|anywhere|distributed|virtual|telecommute|home[- ]based)\b/i;
const HYBRID = /\b(hybrid|flexible|\d\s*days?\s*(per week\s*)?(in|at)[- ]?(the\s*)?office|in[- ]office\s*\d)\b/i;
/**
 * Real strings that name no place at all.
 *
 * Country names are deliberately absent: "US" is a country, not a non-answer, and
 * `placeFromSegment` reads it as one. Treating it as unplaced was throwing away the only
 * geography a remote-in-the-US posting has.
 */
const UNPLACED = /^(multiple locations?|various( locations?)?|several locations?|multiple|tbd|to be determined|flexible|global|worldwide|north america|emea|apac|latam|n\/a|-)$/i;

/**
 * Separators that unambiguously mean "or".
 *
 * Commas are *not* here, because `Austin, TX` is one place and `Seattle, San Francisco,
 * New York City` is three, and only looking at what follows the comma can tell them
 * apart. `splitOnCommas` below does that.
 */
const SPLIT = /\s*(?:\||;|\/|\bor\b|\s+and\s+|•)\s*/i;

const US_STATES: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS',
  kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA',
  michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT',
  nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
  'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND',
  ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI',
  'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT',
  vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV',
  wisconsin: 'WI', wyoming: 'WY', 'district of columbia': 'DC', 'washington dc': 'DC',
};

const STATE_CODES = new Set(Object.values(US_STATES));

/**
 * Abbreviations and metro nicknames that postings use as if they were city names.
 * Not a gazetteer — a gazetteer is `location_city` staying null and `location_raw` being
 * shown as written, which is the honest fallback below.
 */
const ALIASES: Record<string, { city: string; region: string | null; country: string }> = {
  // City-states, listed here so they resolve to a city rather than to a country. Without
  // this, "Singapore" lands in `location_country` and a filter for the city finds nothing.
  singapore: { city: 'Singapore', region: null, country: 'SG' },
  'hong kong': { city: 'Hong Kong', region: null, country: 'HK' },
  dubai: { city: 'Dubai', region: null, country: 'AE' },
  sf: { city: 'San Francisco', region: 'CA', country: 'US' },
  'sf bay area': { city: 'San Francisco', region: 'CA', country: 'US' },
  'bay area': { city: 'San Francisco', region: 'CA', country: 'US' },
  'san francisco bay area': { city: 'San Francisco', region: 'CA', country: 'US' },
  sfo: { city: 'San Francisco', region: 'CA', country: 'US' },
  nyc: { city: 'New York', region: 'NY', country: 'US' },
  'new york city': { city: 'New York', region: 'NY', country: 'US' },
  manhattan: { city: 'New York', region: 'NY', country: 'US' },
  la: { city: 'Los Angeles', region: 'CA', country: 'US' },
  dc: { city: 'Washington', region: 'DC', country: 'US' },
  'washington, d.c.': { city: 'Washington', region: 'DC', country: 'US' },
  'silicon valley': { city: 'Palo Alto', region: 'CA', country: 'US' },
  'research triangle park': { city: 'Raleigh', region: 'NC', country: 'US' },
  rtp: { city: 'Raleigh', region: 'NC', country: 'US' },
  // Airport-style metro codes. Boards write runs of these with no delimiter at all
  // ("SF NYC SEA CHI"), which `splitOnMetroCodes` below relies on this table to detect.
  sea: { city: 'Seattle', region: 'WA', country: 'US' },
  chi: { city: 'Chicago', region: 'IL', country: 'US' },
  atl: { city: 'Atlanta', region: 'GA', country: 'US' },
  bos: { city: 'Boston', region: 'MA', country: 'US' },
  aus: { city: 'Austin', region: 'TX', country: 'US' },
  den: { city: 'Denver', region: 'CO', country: 'US' },
  pdx: { city: 'Portland', region: 'OR', country: 'US' },
  phl: { city: 'Philadelphia', region: 'PA', country: 'US' },
  mia: { city: 'Miami', region: 'FL', country: 'US' },
  lax: { city: 'Los Angeles', region: 'CA', country: 'US' },
  ord: { city: 'Chicago', region: 'IL', country: 'US' },
};

/** Countries common enough in this corpus to be worth recognising by name. */
const COUNTRIES: Record<string, string> = {
  'united states': 'US', usa: 'US', us: 'US', 'u.s.': 'US', 'u.s.a.': 'US', america: 'US',
  canada: 'CA', 'united kingdom': 'GB', uk: 'GB', england: 'GB', scotland: 'GB',
  ireland: 'IE', germany: 'DE', france: 'FR', netherlands: 'NL', spain: 'ES',
  portugal: 'PT', poland: 'PL', sweden: 'SE', norway: 'NO', denmark: 'DK',
  switzerland: 'CH', israel: 'IL', india: 'IN', singapore: 'SG', japan: 'JP',
  australia: 'AU', 'new zealand': 'NZ', brazil: 'BR', mexico: 'MX', 'south korea': 'KR',
  china: 'CN', 'hong kong': 'HK', taiwan: 'TW', argentina: 'AR', colombia: 'CO',
  chile: 'CL', 'costa rica': 'CR', philippines: 'PH', 'united arab emirates': 'AE',
};

/**
 * Whether a single comma segment names a country, or a US state, rather than a place
 * inside one.
 *
 * Exported for adapters that have to fix the *ordering* of a location string before this
 * module can read it — Workday writes "US, CA, Santa Clara", country first, and every
 * heuristic below assumes the city comes first. The tables are the only thing that can
 * answer "is this segment a country", and duplicating them in an adapter is how they
 * drift apart.
 */
export function isCountryName(value: string): boolean {
  return COUNTRIES[value.trim().toLowerCase()] !== undefined;
}

export function isRegionName(value: string): boolean {
  const segment = value.trim();
  return US_STATES[segment.toLowerCase()] !== undefined || STATE_CODES.has(segment.toUpperCase());
}

/** Cities whose names include a comma-free country we would otherwise miss. */
const CITY_COUNTRY: Record<string, string> = {
  london: 'GB', dublin: 'IE', berlin: 'DE', munich: 'DE', paris: 'FR', amsterdam: 'NL',
  madrid: 'ES', barcelona: 'ES', lisbon: 'PT', warsaw: 'PL', krakow: 'PL',
  stockholm: 'SE', oslo: 'NO', copenhagen: 'DK', zurich: 'CH', 'tel aviv': 'IL',
  bangalore: 'IN', bengaluru: 'IN', hyderabad: 'IN', pune: 'IN', mumbai: 'IN',
  singapore: 'SG', tokyo: 'JP', sydney: 'AU', melbourne: 'AU', toronto: 'CA',
  vancouver: 'CA', montreal: 'CA', 'mexico city': 'MX', 'são paulo': 'BR',
  'sao paulo': 'BR', seoul: 'KR', shanghai: 'CN', beijing: 'CN', taipei: 'TW',
};

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .map((word) => (word.length <= 2 && word === word.toUpperCase() ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(' ');
}

/**
 * Strips the remote/hybrid wording out of a segment so the place name underneath can be
 * read. "Remote - San Francisco" is a San Francisco team you do not have to sit with.
 */
function stripModality(segment: string): string {
  return segment
    .replace(/\b(fully|100%|primarily|mostly)\s+/gi, '')
    // "Remote in Canada" / "Remote from the UK" name a real place after the preposition,
    // and stripping only the bare word "remote" left "in Canada" behind to be read as a
    // literal (and fictional) city called "In Canada". Strip the preposition with it, so
    // what remains is the same plain place name any other segment would resolve.
    .replace(/\bremote\s+(in|from)\s+(the\s+)?/gi, '')
    .replace(REMOTE, '')
    .replace(HYBRID, '')
    .replace(/\b(optional|friendly|first|only|eligible|based)\b/gi, '')
    // "Ireland Locations", "Bengaluru Office" — boards append a noise word to the place.
    // Trailing only, so "Bay Area" and "Greater Boston Area" survive via ALIASES.
    .replace(/\s+(locations?|offices?|hub)\s*$/i, '')
    // A trailing super-region: "Gemini North America" is an office label, not a place.
    .replace(/\s+(north america|south america|americas|emea|apac|latam|global)\s*$/i, '')
    .replace(/[-–—()]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Splits a comma-separated location string into real places.
 *
 * The rule: a part is *attached* to the one before it when it reads as a qualifier of it —
 * a US state code or name, or a country. Anything else starts a new place.
 *
 *   "Austin, TX"                              → ["Austin, TX"]
 *   "Dublin, Ireland"                         → ["Dublin, Ireland"]
 *   "San Francisco, CA, New York, NY"         → ["San Francisco, CA", "New York, NY"]
 *   "Seattle, San Francisco, New York City"   → three
 *
 * Without this, the parser produced a single "city" called "Seattle San Francisco New
 * York City" and the location filter matched none of the three.
 */
function splitOnCommas(segment: string): string[] {
  const parts = segment.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length <= 1) return parts;

  const isQualifier = (part: string) => {
    // Dots stripped so "D.C." and "U.S." read as the codes they are. Without this,
    // "Washington, D.C." split into a state called Washington and a city called "D.C.".
    const bare = part.replace(/\./g, '').trim();
    const key = bare.toLowerCase();
    return STATE_CODES.has(bare.toUpperCase()) || US_STATES[key] !== undefined || COUNTRIES[key] !== undefined;
  };

  const places: string[] = [];
  for (const part of parts) {
    const previous = places.at(-1);
    if (previous !== undefined && isQualifier(part)) {
      places[places.length - 1] = `${previous}, ${part}`;
    } else {
      places.push(part);
    }
  }

  return places;
}

/**
 * "SF NYC SEA CHI" — a run of metro abbreviations with no delimiter between them.
 *
 * Returns the expanded names when at least two tokens are recognised, and null otherwise,
 * so a genuine multi-word city name ("New York City") is never shredded into initials.
 */
function splitOnMetroCodes(segment: string): string[] | null {
  const tokens = segment.split(/\s+/).filter(Boolean);
  if (tokens.length < 2 || tokens.length > 6) return null;

  const matched = tokens.filter((token) => ALIASES[token.toLowerCase()] !== undefined);
  if (matched.length < 2 || matched.length !== tokens.length) return null;

  return tokens;
}

/**
 * Rejects a "city" that cannot be one.
 *
 * Real city names are one to four words and contain no digits. Anything else is an
 * unparsed list, a department, or — the case that put 1,069 rows into the corpus before
 * this existed — an employer's internal office code: Anduril's Greenhouse board calls one
 * of its offices `CA OC 00`, and title-casing that into `location_city` puts a fiction
 * into the column the location filter reads.
 */
function isPlausibleCity(value: string): boolean {
  if (/\d/.test(value)) return false;
  const words = value.split(/\s+/).filter(Boolean);
  return words.length >= 1 && words.length <= 4;
}

function placeFromSegment(segment: string): Pick<ParsedLocation, 'city' | 'region' | 'country'> {
  const cleaned = stripModality(segment);
  if (cleaned === '' || UNPLACED.test(cleaned)) {
    return { city: null, region: null, country: null };
  }

  const lower = cleaned.toLowerCase();

  const alias = ALIASES[lower];
  if (alias) return { city: alias.city, region: alias.region, country: alias.country };

  // A bare country name is a country, not a city — "United States" is not a place you commute to.
  const bareCountry = COUNTRIES[lower];
  if (bareCountry) return { city: null, region: null, country: bareCountry };

  /*
   * A handful of state names that, standing alone in a job posting, mean the city.
   *
   * "San Francisco / New York" was coming back as one location: New York resolved to the
   * *state*, which left it with no city, and the city-preference rule below then dropped
   * it in favour of San Francisco. An employer writing "New York" in a location field
   * means the city essentially always.
   *
   * Washington is deliberately absent — there it really does usually mean the state, and
   * the capital is written "Washington, DC".
   */
  const CITY_OVER_STATE: Record<string, { city: string; region: string }> = {
    'new york': { city: 'New York', region: 'NY' },
  };

  const cityFirst = CITY_OVER_STATE[lower];
  if (cityFirst) return { city: cityFirst.city, region: cityFirst.region, country: 'US' };

  // A bare state is a state. "California" as a whole location is real on remote postings.
  const bareState = STATE_CODES.has(cleaned.toUpperCase())
    ? cleaned.toUpperCase()
    : (US_STATES[lower] ?? null);
  if (bareState) return { city: null, region: bareState, country: 'US' };

  const parts = cleaned.split(/\s*,\s*/).map((part) => part.trim()).filter(Boolean);
  const first = parts[0];
  if (!first) return { city: null, region: null, country: null };

  /*
   * A segment whose first part is a bare state *code* or a country has no city left in it.
   *
   * stripModality has already run, so "Remote, CA, US" — which is how Workday states
   * remote-within-a-state once sources/workday.ts has reordered it city-first — arrives
   * here as "CA, US". Read as the city it superficially looks like, it puts a city called
   * "CA" into the corpus and the city filter starts disagreeing with the state filter.
   *
   * State *names* are deliberately excluded from this test: "Washington, DC" means the
   * city, which is the whole reason CITY_OVER_STATE above exists. Only a two-or-three
   * letter code, which no city in this corpus is called, counts.
   */
  const firstBare = first.replace(/\./g, '').trim();
  const firstIsQualifier =
    (firstBare.length <= 3 && STATE_CODES.has(firstBare.toUpperCase())) ||
    COUNTRIES[firstBare.toLowerCase()] !== undefined;

  let region: string | null = null;
  let country: string | null = null;

  for (const rawPart of firstIsQualifier ? parts : parts.slice(1)) {
    // Same dot-stripping as splitOnCommas: "D.C." is DC, "U.S." is US.
    const part = rawPart.replace(/\./g, '').trim();
    if (part === '') continue;
    const key = part.toLowerCase();
    const upper = part.toUpperCase();

    if (STATE_CODES.has(upper)) {
      region ??= upper;
      country ??= 'US';
    } else if (US_STATES[key]) {
      region ??= US_STATES[key] ?? null;
      country ??= 'US';
    } else if (COUNTRIES[key]) {
      country ??= COUNTRIES[key] ?? null;
    } else if (region === null && part.length <= 3) {
      // A short unrecognised trailing token is a province or state code we do not list
      // (ON, BC, NSW). Keeping it is better than discarding the only region signal.
      region = upper;
    }
  }

  // Every part was a qualifier, so the honest answer is the geography without a city.
  if (firstIsQualifier) return { city: null, region, country };

  /*
   * The alias table again, on the city part alone.
   *
   * Checking only the whole segment left "New York City, NY" and "New York, NY" as two
   * different cities — 506 rows against 2,306, for one place. A qualifier after the comma
   * does not make the city a different city, so the same lookup has to run here.
   */
  const firstAlias = ALIASES[first.toLowerCase()];
  if (firstAlias) {
    return {
      city: firstAlias.city,
      region: region ?? firstAlias.region,
      country: country ?? firstAlias.country,
    };
  }

  if (!isPlausibleCity(first)) {
    // Keep whatever geography the qualifiers gave us and admit we do not know the city,
    // rather than writing an unparsed list into `location_city`.
    return { city: null, region, country };
  }

  const city = titleCase(first);
  country ??= CITY_COUNTRY[first.toLowerCase()] ?? null;

  return { city, region, country };
}

function modalityOf(segment: string, hint: LocationTypeValue | null): LocationTypeValue {
  // A vendor that states its own workplace type is more reliable than any string parse —
  // Lever's `workplaceType` and Ashby's `isRemote` are fields the employer filled in.
  if (hint) return hint;
  if (REMOTE.test(segment)) return 'Remote';
  if (HYBRID.test(segment)) return 'Hybrid';
  return 'Onsite';
}

/**
 * A raw location string (plus whatever extra locations the ATS listed separately) →
 * one `ParsedLocation` per real place.
 *
 * Always returns at least one entry: a posting with no usable location is still a
 * posting, and dropping it would lose real jobs to a formatting choice. That entry keeps
 * `location_raw` and leaves the structured columns null — the filter then correctly does
 * not claim it is anywhere.
 */
export function parseLocations(
  raw: string | null,
  extras: string[] = [],
  hint: LocationTypeValue | null = null,
): ParsedLocation[] {
  const sources = [raw, ...extras].filter((value): value is string => typeof value === 'string' && value.trim() !== '');

  if (sources.length === 0) {
    return [{ raw: 'Not specified', city: null, region: null, country: null, type: hint ?? 'Onsite' }];
  }

  const segments = sources.flatMap((source) =>
    source
      .split(SPLIT)
      .map((segment) => segment.trim())
      .filter((segment) => segment !== '')
      // Commas, then undelimited metro-code runs. Order matters: the comma pass has to
      // run first so "SF NYC, Austin, TX" reaches the code pass as "SF NYC".
      .flatMap((segment) => splitOnCommas(segment))
      .flatMap((segment) => splitOnMetroCodes(stripModality(segment)) ?? [segment]),
  );

  const results: ParsedLocation[] = [];
  const seen = new Set<string>();

  for (const segment of segments) {
    const place = placeFromSegment(segment);
    const type = modalityOf(segment, hint);

    // A remote segment with no place is the one case where the segment itself is the
    // whole answer, and every board writes it differently. Normalising it to "Remote"
    // means "Remote", "Remote - US" and "Fully Remote" collapse into one row rather than
    // three, which is a dedup win as much as a display one.
    const label = place.city
      ? [place.city, place.region].filter(Boolean).join(', ')
      : type === 'Remote'
        ? 'Remote'
        : // The stripped form, not the raw segment: otherwise "Singapore" and "Singapore
          // Locations" are two labels for one place and both get their own row. A segment
          // that names no place keeps its original wording, because "Multiple Locations"
          // is at least honest where the stripped "Multiple" is just odd.
          UNPLACED.test(stripModality(segment))
          ? segment
          : (stripModality(segment) || segment);

    const key = `${label.toLowerCase()}|${type}`;
    if (seen.has(key)) continue;
    seen.add(key);

    results.push({ raw: label, ...place, type });
    if (results.length >= MAX_LOCATIONS_PER_POSTING) break;
  }

  if (results.length === 0) {
    const first = sources[0] ?? 'Not specified';
    return [{ raw: first, city: null, region: null, country: null, type: modalityOf(first, hint) }];
  }

  // A posting that is "Remote" *and* lists offices is one remote job, not one per office.
  // Without this, every remote role at a company with five offices becomes six rows.
  const remoteOnly = results.filter((entry) => entry.type === 'Remote' && entry.city === null);
  if (remoteOnly.length > 0 && hint === 'Remote') return remoteOnly.slice(0, 1);

  /*
   * Drop country- and region-level rows once a real city is known.
   *
   * Greenhouse boards routinely list both `location: "Dublin"` and an office called
   * "Ireland", which fanned out into two rows for one job — one of them a card that says
   * "Ireland" and filters to nothing. The city-level row is strictly more informative, so
   * where both exist the vaguer one is noise.
   */
  const withCity = results.filter((entry) => entry.city !== null);
  if (withCity.length > 0) {
    const kept = results.filter((entry) => entry.city !== null || entry.type === 'Remote');
    return kept.length > 0 ? kept : withCity;
  }

  return results;
}
