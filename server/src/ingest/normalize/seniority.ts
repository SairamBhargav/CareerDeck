/**
 * Seniority and employment type — docs/README.md §4.4.
 *
 * "Extract intern / new grad / senior from the title. This is the single highest-leverage
 * field for your audience — a student should essentially never see a Staff Engineer role,
 * and title text alone handles that better than any model."
 *
 * Title first, description only as a tie-break, and in a fixed order: the most specific
 * signal wins, because "Senior Software Engineer Intern" is not a thing but "Intern,
 * Senior Design Team" is, and the word `intern` is the one that decides.
 */

export type SeniorityLevel = 'intern' | 'new_grad' | 'mid' | 'senior' | 'staff_plus';
export type EmploymentTypeValue = 'Internship' | 'Full-time' | 'Part-time' | 'Contract';

/**
 * Checked in order. The first hit wins, so the list is ordered by how strongly the signal
 * overrides everything else in a title.
 */
const TITLE_RULES: { level: SeniorityLevel; pattern: RegExp }[] = [
  /*
   * `intern` before everything: an internship on a senior team is still an internship.
   *
   * The trailing \b is load-bearing and was missing for a while: without it, `\bintern`
   * matches the first six letters of "Internal", "International" and "Internet", which
   * mislabeled full-time comms, tax and product roles as internships. `práctic\w*` keeps
   * matching "prácticas"/"práctica" as a prefix while still stopping at a real word
   * boundary rather than matching into whatever follows.
   *
   * `working student` / `werkstudent` covers the German-market equivalent, which several
   * European boards (Anduril's among them) use instead of "intern".
   */
  { level: 'intern', pattern: /\b(intern|internship|co-?op|coop|summer\s+(analyst|associate|20\d\d)|industrial placement|placement (student|year)|apprentice(ship)?|trainee|student (worker|assistant)|working student|werkstudent\w*|práctic\w*)\b/i },
  { level: 'staff_plus', pattern: /\b(staff|principal|distinguished|fellow|architect|director|vp|vice president|head of|chief|cto|svp|manager,? (engineering|software))\b/i },
  { level: 'senior', pattern: /\b(senior|sr\.?|lead|staff\s|iii|iv|expert|specialist ii)\b/i },
  { level: 'new_grad', pattern: /\b(new ?grad(uate)?s?|university (grad|graduate|hire)|campus hire|entry[- ]level|early career(s)?|graduate (program|scheme|engineer|analyst|developer)|associate (software )?(engineer|developer)|junior|jr\.?|rotational)\b/i },
  // A roman or arabic "1" suffix is a new-grad rung at most large employers.
  { level: 'new_grad', pattern: /\b(engineer|developer|analyst|scientist|designer)\s+(i|1)\b/i },
  { level: 'mid', pattern: /\b(engineer|developer|analyst|scientist|designer)\s+(ii|2)\b/i },
];

/** Only consulted when the title is silent, and only for the two buckets it can prove. */
const DESCRIPTION_RULES: { level: SeniorityLevel; pattern: RegExp }[] = [
  { level: 'intern', pattern: /\b(currently (enrolled|pursuing)|rising (junior|senior)|must be a (current )?student|internship program|for the summer of 20\d\d)\b/i },
  { level: 'new_grad', pattern: /\b(0[-–]2 years|no prior (professional )?experience|recent graduate|graduating (in|by) (the )?(spring|fall|winter|summer|20\d\d)|within (the last )?12 months of graduat)/i },
  { level: 'senior', pattern: /\b([5-9]|1\d)\+? years of (relevant |professional |industry )?experience\b/i },
];

export function extractSeniority(title: string, description: string): SeniorityLevel | null {
  for (const rule of TITLE_RULES) {
    if (rule.pattern.test(title)) return rule.level;
  }
  for (const rule of DESCRIPTION_RULES) {
    if (rule.pattern.test(description)) return rule.level;
  }
  // Null rather than a guess. `mid` is a claim, and an unranked posting should sort on
  // its other merits rather than be filed under something nobody said.
  return null;
}

const CONTRACT = /\b(contract|contractor|consultant|freelance|temporary|temp|fixed[- ]term|seasonal|1099|c2c|corp[- ]to[- ]corp|w2 only)\b/i;
const PART_TIME = /\b(part[- ]?time|pt\b|\d\d?\s*hours?\s*(per|a)\s*week)\b/i;
const FULL_TIME = /\b(full[- ]?time|permanent|regular)\b/i;
const INTERNSHIP = /\b(intern|internship|co-?op|coop|apprentice|placement)\b/i;

/**
 * §3.4's four-value enum, which `user_preferences.preferred_employment_types` already
 * uses — so a mismatch here silently empties a user's filter.
 *
 * An ATS hint is trusted first where it exists (Lever's `commitment`, Ashby's
 * `employmentType`); those are fields the employer picked from a list, not prose.
 *
 * Defaults to `Full-time`, which is what an unlabelled posting almost always is, and
 * which is the value that keeps a posting *in* the default feed rather than hiding it
 * behind a filter nobody set.
 */
export function extractEmploymentType(
  hint: string | null,
  title: string,
  seniority: SeniorityLevel | null,
): EmploymentTypeValue {
  if (seniority === 'intern') return 'Internship';

  if (hint) {
    const normalized = hint.toLowerCase();
    if (INTERNSHIP.test(normalized)) return 'Internship';
    if (CONTRACT.test(normalized)) return 'Contract';
    if (PART_TIME.test(normalized)) return 'Part-time';
    if (FULL_TIME.test(normalized)) return 'Full-time';
  }

  if (INTERNSHIP.test(title)) return 'Internship';
  if (CONTRACT.test(title)) return 'Contract';
  if (PART_TIME.test(title)) return 'Part-time';

  return 'Full-time';
}

/**
 * `title_normalized` — the dedup key's middle term and the prefix-search column.
 *
 * Getting this wrong in either direction is the whole game (PHASE1.md §5.1): too
 * aggressive and two genuinely different roles collapse into one; too loose and the dedup
 * rate never gets under 2%.
 *
 * What comes off: seniority words, requisition numbers, years, location and remote
 * suffixes, department parentheticals, and punctuation. What stays: the role itself.
 *
 *   "Senior Software Engineer II, Platform (Remote) - Req #12345"  →  "software engineer platform"
 */
export function normalizeTitle(title: string): string {
  let value = ` ${title.toLowerCase()} `;

  value = value
    // Requisition ids in every shape a board writes them.
    .replace(/\(?\b(req(uisition)?|job|posting)\s*(id|#|no\.?|number)?\s*[:#-]?\s*[a-z]*\d{3,}\b\)?/g, ' ')
    .replace(/[(\[]\s*#?\d{3,}\s*[)\]]/g, ' ')
    /*
     * Years and seasons are deliberately KEPT.
     *
     * Stripping them was the other half of the Anduril collision: "2026 Early Career
     * Manufacturing Engineer" and "2027 Early Career Manufacturing Engineer" are two
     * genuinely different requisitions for two different cohorts, and normalizing both to
     * "manufacturing engineer" merged them into one. A year in a title is signal, not
     * noise — unlike a requisition number, which is stripped above.
     */
    // Modality and location suffixes.
    .replace(/\b(remote|hybrid|onsite|on-site|work from home|wfh|us|usa|united states)\b/g, ' ')
    // Seniority, which the `seniority` column now carries instead.
    .replace(/\b(senior|sr|junior|jr|staff|principal|distinguished|fellow|lead|entry[- ]level|new ?grad(uate)?s?|university (grad|graduate|hire)|campus|intern(ship)?|co-?op|coop|associate|apprentice|trainee|early career)\b/g, ' ')
    // Level suffixes: I/II/III/IV and 1–4, only where they trail a word.
    .replace(/\b(i{1,3}|iv|v|[1-4])\b/g, ' ')
    // Punctuation and separators.
    .replace(/[|/\\,;:()[\]{}#@!?"'’“”_+*&–—-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Everything was noise — "Intern (Summer 2026)". Fall back to a plain squash of the
  // original, because an empty title_normalized makes the dedup key collapse every
  // posting at the company into one row.
  if (value === '') {
    return title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim() || 'untitled';
  }

  return value;
}
