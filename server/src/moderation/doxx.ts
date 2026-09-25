/**
 * The regex pass — docs/README.md §10: "doxxing (a regex pass for emails/phones/addresses
 * on top of the classifier)."
 *
 * This runs *before* the classifier and blocks on its own, for two reasons. It is free and
 * instant, so a comment containing a phone number never costs a model call. And a language
 * model is genuinely unreliable here: "you can reach him at 317-555-0148" is a sentence
 * whose harm is entirely in a token pattern, and a classifier tuned for harassment will
 * happily rate it as neutral because the tone is helpful.
 *
 * What it deliberately does **not** do is block URLs, company names, or the words people use
 * when they are angry at an employer. §10 is explicit that "this company rejected me for no
 * reason" is the speech the product exists for.
 *
 * Every pattern here has a false-positive story, which is why the verdict is a *reason* and
 * not a silent drop: the user is told which kind of thing was found, so they can rephrase.
 * A student writing "the OA was 90 minutes, 3 problems" must not trip the phone matcher, and
 * the shapes below are tight enough that it does not.
 */

export type DoxxKind = 'email' | 'phone' | 'address' | 'ssn' | 'card' | 'handle_contact';

export interface DoxxMatch {
  kind: DoxxKind;
  /** What to tell the user. Names the category, never echoes the matched text back. */
  message: string;
}

interface Pattern {
  kind: DoxxKind;
  test: RegExp;
  message: string;
}

/*
 * Ordered by how confident each one is. The first match wins, so the most specific and
 * least ambiguous patterns come first and the user gets the most useful explanation.
 */
const PATTERNS: Pattern[] = [
  {
    kind: 'ssn',
    // Only the fully punctuated form. A bare nine-digit run is far more likely to be a
    // requisition id or a salary figure somebody typed without separators.
    test: /\b\d{3}-\d{2}-\d{4}\b/,
    message: 'That looks like a government ID number. Comments cannot contain one.',
  },
  {
    kind: 'card',
    // 13–16 digits in groups, which is a card and essentially nothing else a student types
    // into a comment about a job posting.
    test: /\b(?:\d[ -]?){12,15}\d\b/,
    message: 'That looks like a payment card number. Comments cannot contain one.',
  },
  {
    kind: 'email',
    test: /[\w.+-]+@[\w-]+\.[\w.-]{2,}/,
    message:
      'Comments cannot contain email addresses — including your own. Recruiters read these ' +
      'threads, and an address here is public forever.',
  },
  {
    kind: 'phone',
    /*
     * North American shapes with a separator, plus the +CC international form. A separator
     * is required on purpose: `3175550148` is indistinguishable from an id, and requiring
     * punctuation is what keeps "90 minutes, 3 problems, 45 test cases" out of the matcher.
     */
    test: /(?:\+\d{1,3}[ .-]?)?(?:\(\d{3}\)[ .-]?|\b\d{3}[ .-])\d{3}[ .-]\d{4}\b/,
    message: 'Comments cannot contain phone numbers.',
  },
  {
    kind: 'address',
    // A street number followed by a street type. "1200 employees" and "3 rounds" do not
    // match; "412 Oak Street" does.
    test: /\b\d{1,5}\s+(?:[A-Z][\w'-]*\s+){0,3}(?:st(?:reet)?|ave(?:nue)?|road|rd|boulevard|blvd|lane|ln|drive|dr|court|ct|way|terrace|place|pl|apt|apartment|suite|unit)\b\.?/i,
    message: 'Comments cannot contain street addresses.',
  },
  {
    kind: 'handle_contact',
    /*
     * "DM me at @someone" and "my number is on my insta" are the workaround for every rule
     * above, and the one that actually happens. Matching the *invitation* rather than the
     * contact detail is the only thing that catches it.
     *
     * Narrow on purpose: it needs both a contact verb and a platform, so "I posted my notes
     * on Discord" is fine and "dm me on discord" is not.
     */
    test: /\b(?:dm|pm|text|call|email|add|message|hmu|hit\s+me\s+up|reach\s+me)\b[^.!?\n]{0,30}\b(?:instagram|insta|snap(?:chat)?|whatsapp|telegram|discord|linkedin|twitter|number|cell|phone)\b/i,
    message:
      'Comments cannot ask people to move the conversation somewhere private. Keep it in the ' +
      'thread, where moderation can see it.',
  },
];

/**
 * The first thing the text trips, or null.
 *
 * Returns one match rather than all of them: the user acts on one explanation at a time, and
 * a list of everything wrong with a sentence they are about to rewrite is noise.
 */
export function findDoxx(text: string): DoxxMatch | null {
  if (text.length === 0) return null;

  /*
   * Zero-width characters and the Unicode look-alikes for `@` and `.` are the standard way
   * around a pattern like this — `a​da@purdue.edu` matches nothing above. Normalizing
   * first costs a string allocation and closes the whole family.
   */
  const normalized = text
    .normalize('NFKC')
    .replace(/[​-‍﻿⁠]/g, '')
    .replace(/[＠﹫]/g, '@')
    .replace(/[．。]/g, '.')
    .replace(/\s*\(\s*at\s*\)\s*|\s+at\s+(?=[\w-]+\s*(?:\(\s*dot\s*\)|\s+dot\s+))/gi, '@')
    .replace(/\s*\(\s*dot\s*\)\s*|\s+dot\s+/gi, '.');

  for (const pattern of PATTERNS) {
    if (pattern.test.test(normalized)) {
      return { kind: pattern.kind, message: pattern.message };
    }
  }

  return null;
}
