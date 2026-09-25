/**
 * The content policy, as the app shows it — README §10: *"a clear content policy shown at first
 * comment"*.
 *
 * The full text lives in [docs/CONTENT-POLICY.md](../docs/CONTENT-POLICY.md). What is here is the
 * version string and the short form the sheet renders, and the two have to move together: the
 * version is written to `profiles.content_policy_version` when somebody accepts, which is the
 * record that says *which text* they were shown. Editing the wording without bumping the version
 * makes that record a lie.
 *
 * ── Why it is short ───────────────────────────────────────────────────────────
 *
 * Because it is shown at the moment somebody is trying to write a comment, and a wall of text at
 * that moment is a wall of text nobody reads — which defeats the only purpose it has. §10 wants
 * this in place as a mitigation against the defamation risk the product carries, and a mitigation
 * has to actually be read to work. Six lines that a student will read beats a page they will not.
 *
 * The one thing it must be unambiguous about is the part people get wrong in both directions:
 * criticising an employer is allowed, and going after a person is not.
 */

/** Bumped whenever the text below or docs/CONTENT-POLICY.md changes in substance. */
export const CONTENT_POLICY_VERSION = '2026-09-24';

export const CONTENT_POLICY_TITLE = 'Before you comment';

/**
 * The lead line. Sets up why the rest is short: the account behind a comment is known to us, which
 * is the thing that makes anonymous comments workable at all.
 */
export const CONTENT_POLICY_INTRO =
  'Comments here are anonymous to everyone else and tied to your verified account for us. ' +
  'That is what keeps this usable, and it is why the rules are short.';

export interface PolicyPoint {
  icon: 'checkmark-circle-outline' | 'close-circle-outline' | 'eye-off-outline' | 'flag-outline';
  title: string;
  body: string;
}

export const CONTENT_POLICY_POINTS: PolicyPoint[] = [
  {
    icon: 'checkmark-circle-outline',
    title: 'Say what happened to you',
    body:
      'Ghosted after a final round, a recruiter who misled you, an interview that felt unfair — ' +
      'this is what the comments are for. Name the company. Be specific.',
  },
  {
    icon: 'close-circle-outline',
    title: 'Never go after a person',
    body:
      'Harassment, threats, sexual remarks or abuse aimed at anyone — another student, a ' +
      'recruiter, an interviewer — gets the comment removed and your account restricted.',
  },
  {
    icon: 'eye-off-outline',
    title: 'No contact details, including your own',
    body:
      'No emails, phone numbers, addresses, or asking people to move somewhere private. ' +
      'Recruiters read these threads and anything posted here is public for good.',
  },
  {
    icon: 'flag-outline',
    title: 'Reports reach a person',
    body:
      'Report anything that breaks this and a human reads it within a day. If you are removed ' +
      'or muted, we tell you why — and you can verify again if it was a mistake.',
  },
];

/**
 * The footer. States the consequence plainly, because a policy that does not is a suggestion — and
 * §10's escalation is bound to the verification, which is the part that makes it bite.
 */
export const CONTENT_POLICY_FOOTER =
  'Breaking these gets a warning, then a 7-day mute, then a ban. A ban is tied to the school ' +
  'email or ID you verified with, so it does not come back with a new signup.';
