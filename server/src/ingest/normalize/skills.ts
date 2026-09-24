/**
 * Skill extraction — docs/README.md §4.4.
 *
 * "Dictionary-based extraction against a curated `skills` table, not free-form LLM
 * output. Free-form gives you `React`, `ReactJS`, `React.js`, and `react` as four skills
 * and your filters quietly stop working."
 *
 * So: the `skills` table is the only authority on what a skill is called. A posting that
 * says `react.js` and one that says `ReactJS` both emit the label `React`, which is what
 * lands in `jobs.skills` and what the filter and the card read.
 */

export interface SkillEntry {
  slug: string;
  label: string;
  aliases: string[];
}

/**
 * The dictionary, compiled once per run into a form that can be matched cheaply against
 * tens of thousands of descriptions.
 *
 * The compile step is not decoration. A naive `description.includes(alias)` over ~250
 * entries × ~40k postings is 10 million substring scans of multi-kilobyte strings; worse,
 * it matches "go" inside "going" and "R" inside every capital R in the document. Tokenising
 * once and looking terms up in a Map is both correct and roughly two orders of magnitude
 * faster.
 */
export interface SkillDictionary {
  /** Single-word terms, lowercased → label. */
  unigrams: Map<string, string>;
  /** Unigrams that are also ordinary English words. Title and requirements only — see below. */
  ambiguous: Map<string, string>;
  /** Multi-word terms, as token arrays, longest first so "machine learning ops" beats "machine learning". */
  phrases: { tokens: string[]; label: string }[];
}

/**
 * Skill names that are also common English words.
 *
 * Found by running the crawler against real boards: a sales posting came back tagged
 * `Go`, `Excel` and `.NET` because it said "go to market", "excel at communication" and
 * "net new revenue". Every one of those is the dictionary working exactly as written and
 * producing a wrong answer.
 *
 * Dropping the terms is not an option — Go and Rust are real skills students filter on.
 * Instead these match only in the title and the requirements list, where a word is
 * overwhelmingly likely to be the technology, and never in free prose.
 *
 * `net` is here because the tokenizer strips the leading dot from `.NET`; the unambiguous
 * spellings `dotnet` and `asp.net` still match anywhere.
 */
const AMBIGUOUS_TOKENS = new Set([
  // Skill names whose everyday meaning is the more common one in prose.
  'go', 'net', 'excel', 'unity', 'swift', 'rust', 'dart', 'spring', 'julia',
  // Single letters. "C" and "R" are real languages and match far too much on their own.
  'c', 'r',
]);

/**
 * Splits on anything that is not a letter, digit, `+`, `#` or `.`.
 *
 * Those three survive because they are load-bearing in this vocabulary: `c++`, `c#`,
 * `node.js`, `.net`. Dropping them turns `C++` into `c` and matches the language `C` in
 * every posting that mentions either.
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9+#.]+/)
    .map((token) => token.replace(/^\.+|\.+$/g, ''))
    .filter((token) => token !== '');
}

export function compileDictionary(entries: SkillEntry[]): SkillDictionary {
  const unigrams = new Map<string, string>();
  const ambiguous = new Map<string, string>();
  const phrases: { tokens: string[]; label: string }[] = [];

  for (const entry of entries) {
    /*
     * The slug is deliberately NOT a search term. It is a stable identifier, and several
     * are truncations of their label: `embedded` for "Embedded Systems", `performance` for
     * "Performance Optimization", `security` for "Security". Indexing them tagged every
     * fintech posting that said "embedded finance" as embedded systems work, and every
     * sales posting that mentioned performance as a performance engineer.
     *
     * The label and the aliases are the vocabulary. Where a short form is genuinely how
     * people write a skill — `sre`, `oop`, `cpp` — it is listed as an alias, which is
     * where a search term belongs.
     */
    for (const term of [entry.label, ...entry.aliases]) {
      const tokens = tokenize(term);
      if (tokens.length === 0) continue;

      if (tokens.length === 1) {
        const token = tokens[0];
        if (token === undefined) continue;
        const target = AMBIGUOUS_TOKENS.has(token) ? ambiguous : unigrams;
        // First writer wins, so a term claimed by two entries keeps the one the dictionary
        // lists first rather than flipping with iteration order.
        if (!target.has(token)) target.set(token, entry.label);
      } else {
        phrases.push({ tokens, label: entry.label });
      }
    }
  }

  phrases.sort((a, b) => b.tokens.length - a.tokens.length);
  return { unigrams, ambiguous, phrases };
}

/** Keeps a card readable: a posting tagged with 30 skills is tagged with none. */
const MAX_SKILLS = 12;

/**
 * Extracts skills from a posting.
 *
 * The title is scanned first and its hits are kept in front — a posting titled "Machine
 * Learning Intern" should lead with `Machine Learning` rather than with whatever the
 * benefits paragraph happened to mention. Requirements come next, then the body, and the
 * list is truncated in that order of confidence.
 */
export function extractSkills(
  dictionary: SkillDictionary,
  title: string,
  requirements: string[],
  description: string,
): string[] {
  const found: string[] = [];
  const seen = new Set<string>();

  /** `trusted` admits the ambiguous single words — the title and the requirements list. */
  const scan = (text: string, trusted: boolean) => {
    if (text === '' || found.length >= MAX_SKILLS) return;
    const tokens = tokenize(text);

    // Phrases first: matching "machine learning" as a phrase and marking its tokens used
    // stops "learning" from also matching on its own.
    const consumed = new Array<boolean>(tokens.length).fill(false);

    for (const phrase of dictionary.phrases) {
      const length = phrase.tokens.length;
      for (let start = 0; start + length <= tokens.length; start += 1) {
        let matches = true;
        for (let offset = 0; offset < length; offset += 1) {
          if (consumed[start + offset] || tokens[start + offset] !== phrase.tokens[offset]) {
            matches = false;
            break;
          }
        }
        if (!matches) continue;

        for (let offset = 0; offset < length; offset += 1) consumed[start + offset] = true;
        if (!seen.has(phrase.label)) {
          seen.add(phrase.label);
          found.push(phrase.label);
        }
      }
    }

    for (let index = 0; index < tokens.length; index += 1) {
      if (consumed[index]) continue;
      const token = tokens[index];
      if (token === undefined) continue;
      const label = dictionary.unigrams.get(token) ?? (trusted ? dictionary.ambiguous.get(token) : undefined);
      if (label === undefined || seen.has(label)) continue;
      seen.add(label);
      found.push(label);
    }
  };

  scan(title, true);
  scan(requirements.join('\n'), true);
  scan(description, false);

  return found.slice(0, MAX_SKILLS);
}
