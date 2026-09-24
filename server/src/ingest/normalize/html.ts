/**
 * ATS description HTML → readable plain text.
 *
 * Not a general HTML parser and not trying to be. Every input is a job description from
 * one of three ATSs, which means a predictable soup of `<p>`, `<ul>`, `<div>`, `<br>` and
 * inline formatting. A real parser would be a dependency, a build step and a class of
 * security bugs, in exchange for handling markup that never arrives.
 *
 * Two properties matter downstream and are the reason this is careful rather than a
 * one-line regex:
 *
 *  - **Block boundaries become newlines.** `<li>Python</li><li>Go</li>` must not collapse
 *    into `PythonGo`, or the skills dictionary matches neither and the requirements
 *    extractor sees one run-on line.
 *  - **Script and style content is dropped, not flattened.** A board that inlines a
 *    tracking snippet would otherwise put minified JavaScript into `description_text`,
 *    where it lands in the search vector and matches queries for "function".
 */

/** Elements whose text content is never part of the description. */
const DROPPED = /<(script|style|noscript|template|svg)\b[^>]*>[\s\S]*?<\/\1>/gi;

/** Elements that end a line. `li` also gets a bullet, below. */
const BLOCK =
  /<\/?(p|div|br|li|ul|ol|tr|h[1-6]|section|article|header|footer|blockquote|table|thead|tbody)\b[^>]*>/gi;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  hellip: '…',
  bull: '•',
  middot: '·',
  eacute: 'é',
  reg: '®',
  copy: '©',
  trade: '™',
  deg: '°',
};

export function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => safeCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => safeCodePoint(Number.parseInt(dec, 10)))
    .replace(/&([a-z][a-z0-9]*);/gi, (match, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? match);
}

function safeCodePoint(code: number): string {
  // A malformed entity can name a code point outside Unicode, which throws. A description
  // is not worth losing over one bad character reference.
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return '';
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

/**
 * Collapses runs of blank lines to at most one, and trims trailing spaces.
 *
 * Descriptions arrive with a great deal of incidental whitespace — every `<p>` pair
 * produces two newlines here — and leaving it in makes the "description under 400
 * characters" quality signal fire on postings that are not actually short.
 */
function tidy(value: string): string {
  return value
    .replace(/[ \t ]+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function htmlToText(html: string | null | undefined): string {
  if (!html) return '';

  return tidy(
    decodeEntities(
      html
        .replace(DROPPED, ' ')
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<li\b[^>]*>/gi, '\n• ')
        .replace(BLOCK, '\n')
        .replace(/<[^>]+>/g, ''),
    ),
  );
}

/**
 * The bullet lines from a description, as `jobs.requirements`.
 *
 * Postings put their requirements in a list far more often than not, and the list right
 * after a heading that says so is the one worth keeping. When no heading matches, the
 * longest bullet run in the document is taken instead — on a job posting that is almost
 * always the qualifications.
 *
 * Deliberately conservative: a posting whose requirements cannot be located confidently
 * gets an empty array, and `quality.ts` scores it slightly lower for it. An array of
 * benefits mislabelled as requirements is worse than no array.
 */
const REQUIREMENT_HEADING =
  /^(what (we('| i)re looking for|you('| )ll need|you bring)|requirements?|qualifications?|basic qualifications?|minimum qualifications?|who you are|about you|skills?( (and|&) experience)?|you (have|should have|might have)|preferred qualifications?)\b/i;

/** Headings that end a requirements list — everything after them is a different topic. */
const SECTION_HEADING =
  /^(benefits?|perks?|compensation|pay|salary|equal (employment )?opportunity|eeo\b|about (us|the (company|team|role))|why join|our (values|mission)|what we offer|nice to have|bonus points|how to apply|application process)\b/i;

const MAX_REQUIREMENTS = 12;
const MIN_REQUIREMENT_LENGTH = 12;
const MAX_REQUIREMENT_LENGTH = 400;

export function extractRequirements(text: string): string[] {
  const lines = text.split('\n');

  const isBullet = (line: string) => line.startsWith('•');
  const clean = (line: string) => line.replace(/^[•\-*•\s]+/, '').trim();
  const usable = (line: string) =>
    line.length >= MIN_REQUIREMENT_LENGTH && line.length <= MAX_REQUIREMENT_LENGTH;

  // Pass 1: the bullet run immediately following a requirements heading.
  for (let index = 0; index < lines.length; index += 1) {
    const heading = clean(lines[index] ?? '');
    if (!REQUIREMENT_HEADING.test(heading)) continue;

    const collected: string[] = [];
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const line = lines[cursor] ?? '';
      if (line === '') continue;
      if (!isBullet(line)) {
        // A non-bullet line ends the run — but only once something has been collected,
        // so an intervening lede paragraph between heading and list is tolerated.
        if (collected.length > 0) break;
        if (SECTION_HEADING.test(clean(line))) break;
        continue;
      }
      const value = clean(line);
      if (usable(value)) collected.push(value);
      if (collected.length >= MAX_REQUIREMENTS) break;
    }

    if (collected.length >= 2) return collected;
  }

  // Pass 2: the longest bullet run anywhere, before the benefits/EEO tail.
  let best: string[] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (isBullet(line)) {
      const value = clean(line);
      if (usable(value)) current.push(value);
      continue;
    }
    if (line !== '') {
      if (current.length > best.length) best = current;
      current = [];
      if (SECTION_HEADING.test(clean(line)) && best.length >= 2) break;
    }
  }
  if (current.length > best.length) best = current;

  return best.length >= 2 ? best.slice(0, MAX_REQUIREMENTS) : [];
}
