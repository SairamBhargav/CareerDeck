/**
 * The script Auto Apply injects into the employer's application page.
 *
 * It fills two kinds of answer, and nothing else:
 *
 *  - **The draft** the reader just reviewed — every question the drafter answered, matched to
 *    the page by the question's own label (exact on a real Greenhouse form) or by a known
 *    phrasing of the common questions.
 *  - **The reader's saved answers** (Profile → Application answers): address, phone, GPA,
 *    citizenship, clearance, "how did you hear", and the voluntary self-identification block.
 *    These are the reader's own statements, typed once. A question they left blank is left for
 *    them; nothing here guesses.
 *
 * It never presses Submit, and never ticks a consent or certification box.
 *
 * Values go in through the element prototype's native setter, followed by `input` and `change`
 * events, which is what React-, Vue- and plain-DOM forms all listen for. A field that already
 * has a value is never overwritten. Choice questions (select, radio, checkbox, searchable
 * dropdown) are matched option by option against patterns, because every form words its options
 * differently: "I am not a protected veteran" on one, "No" on the next.
 *
 * It re-runs whenever the DOM changes, because single-page forms (Ashby, Workday, Greenhouse's
 * new boards) render after load and render each next step without navigating.
 */

import type { ApplicationAnswers, DraftField, PageAnswer, PageQuestion } from '@/lib/api';
import type { User } from '@/types';

export interface AutofillAnswer {
  key: string;
  label: string;
  value: string;
  kind: DraftField['kind'];
  options: string[] | null;
  /** Regex source for the question's label. Defaults to ALIASES[key]. */
  pattern?: string;
  /** Regex sources for the option to choose, tried in order. Defaults to "starts with value". */
  optionPatterns?: string[];
  /** A self-identification answer: the only kind allowed onto an EEO question. */
  selfId?: boolean;
}

export interface AutofillResume {
  /** A `data:application/pdf;base64,…` URL, so the page never needs to reach our storage. */
  dataUrl: string;
  fileName: string;
}

/** Messages the page posts back to the app. */
export type AutofillMessage =
  | { type: 'progress'; filled: number; total: number; resumeAttached: boolean; aiFilled: number }
  | { type: 'questions'; questions: PageQuestion[] }
  | { type: 'submitted' };

/** The call that fills the drafter's answers to the page's leftover questions. */
export function answerScript(answers: PageAnswer[]): string {
  return `window.__careerdeckAutofill && window.__careerdeckAutofill.answer(${JSON.stringify(answers)}); true;`;
}

/**
 * Label patterns for the drafter's standard-form keys (server/src/autoapply/form.ts), matched
 * against a label normalized to lowercase letters, digits, hyphens and single spaces.
 */
const ALIASES: Record<string, string> = {
  full_name: '^(full |legal )?name$|^full (legal )?name|^your name',
  first_name: '^(legal )?first name|^given name',
  last_name: '^(legal )?last name|^surname|^family name',
  email: 'e-?mail',
  phone: 'phone|mobile|cell',
  location: '^(current )?location|city state|where (are you|do you) (based|located|live)',
  // Anchored, so "School Major" and "Start Date at Current School" are not the school's name.
  school: '^(name of )?(your )?(current )?(school|university|college|institution)( name)?$|^(school|university|college) name|which (school|university|college)|school you (attend|are attending)',
  degree: '^degree|discipline|field of study|major|area of study',
  // Never the high-school question, which wants a different year.
  graduation: '^(?!.*high school).*(graduat|expected completion|class of)',
  linkedin: 'linkedin',
  website: '^(?!.*other)(website|portfolio|personal (site|url|website))',
  work_authorization: 'authori[sz]ed to work|legally (authori[sz]ed|eligible|able)|eligible to work|work authori[sz]ation|right to work',
  sponsorship: 'sponsor',
  start_date: '^(?!.*(school|college|university)).*(start date|when (can|could) you start|earliest (start|availability)|date available|available to (begin|start)|begin employment)',
  why_company: 'why (do )?you want|why are you interested|why (this|our) (company|team|role)|why .* (join|work)',
};

// ── the reader's saved answers, as autofill entries ───────────────────────────

const YES = ['^yes'];
const NO = ['^no\\b'];
const DECLINE = [
  'decline', 'not (wish|want) to', 'prefer not', 'choose not', 'rather not', 'do not wish',
  'don t wish', 'not to (answer|disclose|self|specify|say)', 'undisclosed', 'not specified',
];

const OPTION_PATTERNS: Record<string, Record<string, string[]>> = {
  gender: {
    male: ['^(male|man)\\b', '^m$'],
    female: ['^(female|woman)\\b', '^f$'],
    non_binary: ['non ?-?binary', 'genderqueer', 'gender non'],
    decline: DECLINE,
  },
  hispanicLatino: { yes: [...YES, '^hispanic'], no: [...NO, '^not hispanic'], decline: DECLINE },
  race: {
    american_indian: ['american indian', 'alaska'],
    asian: ['^asian'],
    black: ['^black', 'african american'],
    pacific_islander: ['hawaiian', 'pacific islander'],
    white: ['^white', 'caucasian'],
    two_or_more: ['two or more', 'multi', 'mixed'],
    decline: DECLINE,
  },
  veteranStatus: {
    not_veteran: ['not a (protected )?veteran', 'i am not', '^no\\b', 'not a veteran'],
    protected_veteran: ['^i identify as', 'one or more of the classifications', '^yes'],
    decline: DECLINE,
  },
  disabilityStatus: {
    yes: ['^yes'],
    no: ['^no\\b'],
    decline: DECLINE,
  },
  sexualOrientation: {
    heterosexual: ['heterosexual', 'straight'],
    gay_lesbian: ['^gay', 'lesbian'],
    bisexual: ['bisexual'],
    other: ['^other', 'queer', 'pansexual', 'asexual'],
    decline: DECLINE,
  },
  transgender: { yes: YES, no: NO, decline: DECLINE },
};

/** The label each EEO question goes by, across Greenhouse, Lever, Ashby and Workday. */
const SELF_ID_PATTERNS: Record<string, string> = {
  gender: '^gender|gender identity|^sex$|what is your sex',
  hispanicLatino: 'hispanic|latin[oax]',
  race: '\\brace\\b|ethnicity|ethnic background',
  veteranStatus: 'veteran',
  disabilityStatus: 'disabilit',
  sexualOrientation: 'sexual orientation',
  transgender: 'transgender|trans\\b',
};

const SELF_ID_LABELS: Record<string, string> = {
  gender: 'Gender', hispanicLatino: 'Hispanic or Latino', race: 'Race', veteranStatus: 'Veteran status',
  disabilityStatus: 'Disability status', sexualOrientation: 'Sexual orientation', transgender: 'Transgender',
};

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/**
 * "May 2028" → the options a form might offer for it: "May 2028", "05/2028", "Spring 2028", or
 * a bare "2028". Forms ask graduation as a month, a term or a year, never consistently.
 */
function termPatterns(value: string): string[] | undefined {
  const v = value.toLowerCase();
  const year = v.match(/20\d\d/)?.[0];
  if (!year) return undefined;
  const monthIndex = MONTHS.findIndex((month) => v.includes(month.slice(0, 3)));
  if (monthIndex < 0) return [`\\b${year}\\b`];
  const month = MONTHS[monthIndex]!;
  const season = monthIndex <= 4 ? 'spring' : monthIndex <= 7 ? 'summer' : monthIndex <= 10 ? 'fall' : 'winter';
  return [
    `${month} ${year}`, `${month.slice(0, 3)} ${year}`, `^0?${monthIndex + 1} ${year}`,
    `${season} ${year}`, ...(season === 'fall' ? [`autumn ${year}`] : []),
    `^${year}$`,
  ];
}

/** "B.S.", "Bachelor's", "BS in CS" → the option a form offers for that level. */
function degreePatterns(degree: string): string[] | undefined {
  const d = degree.toLowerCase();
  if (/ph\.? ?d|doctor/.test(d)) return ['ph ?d', 'doctor'];
  if (/master|\bm\.? ?(s|a|eng)\b|mba/.test(d)) return ['^master', '\\bm s\\b', '\\bms\\b', 'graduate'];
  if (/associate/.test(d)) return ['^associate'];
  if (/bachelor|\bb\.? ?(s|a|sc|eng)\b|undergrad/.test(d)) return ['^bachelor', '\\bb s\\b', '\\bbs\\b', '\\bba\\b', 'undergrad'];
  return undefined;
}

function yesNo(value: boolean): Pick<AutofillAnswer, 'value' | 'optionPatterns'> {
  return value ? { value: 'Yes', optionPatterns: YES } : { value: 'No', optionPatterns: NO };
}

/**
 * Profile → Application answers, plus the profile itself, as autofill entries. Each carries its
 * own label pattern; each choice carries the option patterns for its value. Blank answers are
 * left out entirely, which is what leaves those questions for the reader.
 */
export function savedAnswers(a: ApplicationAnswers, user: User | null): AutofillAnswer[] {
  const out: AutofillAnswer[] = [];
  const text = (key: string, label: string, value: string | null | undefined, pattern: string) => {
    if (value && value.trim()) out.push({ key: `saved_${key}`, label, value: value.trim(), kind: 'text', options: null, pattern });
  };
  const bool = (key: string, label: string, value: boolean | null, pattern: string) => {
    if (value !== null) out.push({ key: `saved_${key}`, label, kind: 'select', options: null, pattern, ...yesNo(value) });
  };

  text('first_name', 'First name', user?.firstName, ALIASES.first_name!);
  text('last_name', 'Last name', user?.lastName, ALIASES.last_name!);
  if (user?.firstName && user.lastName) text('full_name', 'Full name', `${user.firstName} ${user.lastName}`, ALIASES.full_name!);
  text('preferred_name', 'Preferred name', a.preferredName, 'preferred (first )?name|nickname|name you go by');
  text('phone', 'Phone', a.phone, 'phone|mobile|cell');
  text('address_line1', 'Street address', a.addressLine1,
    '^(?!.*\\be-?mail)(.*\\bstreet\\b|address( line)?( 1)?$|address line 1|(mailing|home|current|permanent|residential) address)');
  text('address_line2', 'Address line 2', a.addressLine2, 'address line 2|apt|apartment|suite|unit number');
  text('city', 'City', a.city, '^city\\b|\\bcity$|town');
  text('state', 'State', a.stateRegion, '^state\\b|state province|^province|\\bregion$');
  text('postal', 'ZIP code', a.postalCode, '\\bzip\\b|postal|post code');
  text('country', 'Country', a.country, '^country\\b|country of residence');
  if (a.city && a.stateRegion) text('location', 'Location', `${a.city}, ${a.stateRegion}`, ALIASES.location!);
  text('school', 'School', a.schoolName ?? user?.school, ALIASES.school!);
  if (a.degree?.trim()) {
    out.push({
      key: 'saved_degree', label: 'Degree', value: a.degree.trim(), kind: 'text', options: null,
      pattern: '^degree|degree type|what degree|degree (are you )?(currently )?(pursuing|seeking)|level of education|highest (level of )?education',
      optionPatterns: degreePatterns(a.degree),
    });
  }
  text('field', 'Field of study', a.fieldOfStudy ?? user?.major, 'discipline|field of study|\\bmajor\\b|area of study|concentration');
  const graduation = a.graduationDate ?? (user?.graduationYear ? String(user.graduationYear) : null);
  if (graduation?.trim()) {
    out.push({
      key: 'saved_graduation', label: 'Graduation date', value: graduation.trim(), kind: 'text', options: null,
      pattern: ALIASES.graduation, optionPatterns: termPatterns(graduation),
    });
  }
  text('gpa', 'GPA', a.gpa, '\\bgpa\\b|grade point');
  text('linkedin', 'LinkedIn', a.linkedinUrl, 'linkedin');
  text('github', 'GitHub', a.githubUrl, 'github');
  text('website', 'Website', a.portfolioUrl, ALIASES.website!);
  text('start', 'Earliest start', a.earliestStart, ALIASES.start_date!);
  text('how_heard', 'How did you hear about us', a.howHeard, '(how|where) did you (hear|find|learn)|how you heard');
  text('pay', 'Expected pay', a.desiredPay, '(salary|pay|compensation) (expectation|requirement)|(expected|desired) (salary|pay|compensation|hourly)');
  text('pronouns', 'Pronouns', a.pronouns, 'pronoun');

  if (a.workAuthorizedUs !== null) bool('work_auth', 'Authorized to work', a.workAuthorizedUs, ALIASES.work_authorization!);
  if (a.needsSponsorship !== null) bool('sponsorship', 'Sponsorship', a.needsSponsorship, ALIASES.sponsorship!);
  bool('over_18', '18 or older', a.over18, '18 years|at least 18|over 18|over the age|legal age');
  if (a.usCitizen !== null) {
    out.push({
      key: 'saved_citizen', label: 'US citizen', kind: 'select', options: null,
      pattern: 'u ?s ?a? citizen|citizenship|citizen of the united states',
      value: a.usCitizen ? 'Yes' : 'No',
      optionPatterns: a.usCitizen ? ['^yes', 'u ?s citizen', 'united states citizen'] : NO,
    });
  }
  bool('clearance', 'Security clearance', a.hasClearance, 'clearance');
  bool('relocate', 'Willing to relocate', a.willingToRelocate, 'relocat');

  for (const key of Object.keys(SELF_ID_PATTERNS)) {
    const value = a[key as keyof ApplicationAnswers] as string | null;
    const patterns = value ? OPTION_PATTERNS[key]?.[value] : undefined;
    if (!value || !patterns) continue;
    out.push({
      key: `saved_${key}`, label: SELF_ID_LABELS[key]!, value, kind: 'select', options: null,
      pattern: SELF_ID_PATTERNS[key], optionPatterns: patterns, selfId: true,
    });
  }
  return out;
}

// ── the injected script ──────────────────────────────────────────────────────

export function autofillScript(answers: AutofillAnswer[], resume: AutofillResume | null): string {
  // Lever and many custom forms ask for one "Full name" rather than first and last.
  const first = answers.find((a) => a.key === 'first_name')?.value;
  const last = answers.find((a) => a.key === 'last_name')?.value;
  const withFullName =
    first && last && !answers.some((a) => a.key === 'full_name')
      ? [...answers, { key: 'full_name', label: 'Full name', value: `${first} ${last}`, kind: 'text' as const, options: null }]
      : answers;
  const payload = JSON.stringify({ answers: withFullName, aliases: ALIASES, resume });

  // Plain ES2017, no imports: this runs inside whatever browser engine the WebView uses.
  return `
(function () {
  if (window.__careerdeckAutofill) { window.__careerdeckAutofill.run(); return; }
  var DATA = ${payload};
  var post = function (message) {
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(message));
  };
  var norm = function (text) {
    // Required-markers (*, ✱), punctuation and icons all go; letters, digits and hyphens stay.
    return (text || '').toLowerCase().replace(/[^a-z0-9\\- ]+/g, ' ').replace(/\\s+/g, ' ').trim();
  };
  var SELF_IDENTIFY = /gender|\\brace\\b|ethnic|hispanic|latin[oax]|veteran|disabilit|pronoun|sexual orientation|transgender/;
  var CONSENT = /i (agree|acknowledge|certify|consent|understand|confirm)|privacy|terms|attest|signature/;

  function textOf(id) {
    var node = id && document.getElementById(id);
    return node ? node.textContent : '';
  }

  function labelFor(el) {
    var parts = [];
    if (el.id) {
      var byFor = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (byFor) parts.push(byFor.textContent);
    }
    var wrapping = el.closest('label');
    if (wrapping && el.type !== 'radio' && el.type !== 'checkbox') parts.push(wrapping.textContent);
    if (el.getAttribute('aria-label')) parts.push(el.getAttribute('aria-label'));
    var labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) labelledBy.split(/\\s+/).forEach(function (id) { parts.push(textOf(id)); });
    // The question text above the field comes before any placeholder: Lever's custom questions
    // all carry the placeholder "Type your response", which says nothing about the question.
    if (parts.length === 0) {
      var nearest = nearestQuestion(el);
      if (nearest) parts.push(nearest);
    }
    if (parts.length === 0 && el.placeholder) parts.push(el.placeholder);
    if (parts.length === 0 && el.name) parts.push(el.name.replace(/[_\\[\\]]+/g, ' '));
    return norm(parts.join(' '));
  }

  /**
   * The question text for a field that has no <label> of its own: walk up the ancestors and take
   * the first label-ish element that holds no inputs. That last rule is what keeps a radio
   * group's own option labels ("Yes", "No") from being read as its question.
   */
  function nearestQuestion(el) {
    var node = el.parentElement;
    for (var depth = 0; node && depth < 6; depth++, node = node.parentElement) {
      var found = node.querySelectorAll('legend, label, [class*="label" i], [class*="question" i], [class*="title" i]');
      for (var i = 0; i < found.length; i++) {
        var candidate = found[i];
        if (candidate.contains(el) || candidate.querySelector('input, select, textarea')) continue;
        var text = (candidate.textContent || '').trim();
        if (text) return text;
      }
    }
    return '';
  }

  /** Every answer that could fit this label, best first: exact label, then pattern. */
  function candidatesFor(label) {
    if (!label) return [];
    var eeo = SELF_IDENTIFY.test(label);
    var exact = [], patterned = [];
    for (var i = 0; i < DATA.answers.length; i++) {
      var a = DATA.answers[i];
      if (eeo && !a.selfId) continue; // an EEO question only ever takes the reader's own EEO answer
      var own = norm(a.label);
      // Prefix and contains only for a drafted answer's long, form-specific label. A short one
      // ("School") would otherwise claim "School Major"; saved answers go by their pattern.
      if (own && (label === own || (!a.pattern && own.length > 12 && label.indexOf(own) >= 0))) {
        exact.push(a);
        continue;
      }
      var pattern = a.pattern || DATA.aliases[a.key];
      if (pattern && new RegExp(pattern).test(label)) patterned.push(a);
    }
    return exact.concat(patterned);
  }

  function optionMatches(text, answer) {
    text = norm(text);
    if (!text) return false;
    if (answer.optionPatterns) {
      for (var i = 0; i < answer.optionPatterns.length; i++) {
        if (new RegExp(answer.optionPatterns[i]).test(text)) return true;
      }
      return false;
    }
    var want = norm(answer.value);
    if (text === want || text.indexOf(want) === 0) return true;
    // "University of Colorado Boulder" against "University of Colorado at Boulder": every word
    // of the answer is in the option, and the option adds at most two words of its own.
    var STOP = { of: 1, the: 1, at: 1, and: 1, in: 1 };
    var wantWords = want.split(' ').filter(function (w) { return !STOP[w]; });
    var textWords = text.split(' ').filter(function (w) { return !STOP[w]; });
    if (wantWords.length < 2) return false;
    var all = wantWords.every(function (w) { return textWords.indexOf(w) >= 0; });
    return all && textWords.length - wantWords.length <= 2;
  }

  function setNative(el, value) {
    var proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    var setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  function mark(el) {
    el.setAttribute('data-careerdeck', 'filled');
    el.style.outline = '2px solid #22c55e';
    el.style.outlineOffset = '1px';
  }

  function visible(el) {
    return el.offsetParent !== null || el.type === 'file';
  }

  function fillSelect(el, answer) {
    for (var i = 0; i < el.options.length; i++) {
      var option = el.options[i];
      if (option.value !== '' && optionMatches(option.textContent, answer)) {
        setNative(el, option.value);
        return true;
      }
    }
    return false;
  }

  function isCombobox(el) {
    return el.getAttribute('role') === 'combobox' || el.getAttribute('aria-autocomplete') === 'list';
  }

  /**
   * A searchable dropdown (react-select and friends, used by Greenhouse's and Ashby's new forms):
   * open it, click the option that matches. For a free-text answer, typing it first filters the
   * list. A combobox with no matching option is put back as it was.
   */
  function fillCombobox(el, answer) {
    el.focus();
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown', keyCode: 40 }));
    if (!answer.optionPatterns) setNative(el, answer.value);
    setTimeout(function () {
      var options = document.querySelectorAll('[role=option], [class*="option" i]');
      for (var i = 0; i < options.length; i++) {
        if (optionMatches(options[i].textContent, answer)) {
          options[i].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
          options[i].click();
          return;
        }
      }
      if (!answer.optionPatterns) setNative(el, '');
      el.blur();
      el.removeAttribute('data-careerdeck');
      el.style.outline = '';
    }, 350);
    return true;
  }

  function choiceText(input) {
    var text = '';
    if (input.id) {
      var byFor = document.querySelector('label[for="' + CSS.escape(input.id) + '"]');
      if (byFor) text = byFor.textContent;
    }
    if (!text) text = (input.closest('label') || {}).textContent || input.getAttribute('aria-label') || input.value || '';
    return text;
  }

  /** A radio or checkbox group: tick the one option that matches. Never more than one. */
  function fillGroup(group, answer) {
    for (var i = 0; i < group.length; i++) {
      if (optionMatches(choiceText(group[i]), answer)) {
        if (!group[i].checked) group[i].click();
        return true;
      }
    }
    return false;
  }

  function groupLabel(group) {
    var first = group[0];
    var labelled = first.closest('[role=radiogroup], [role=group], fieldset');
    var aria = labelled && (labelled.getAttribute('aria-label') || textOf(labelled.getAttribute('aria-labelledby')));
    if (aria) return norm(aria);
    // Walk up from the group's common container, so the first option is not its own question.
    var container = first.parentElement;
    while (container && group.some(function (input) { return !container.contains(input); })) container = container.parentElement;
    return norm(nearestQuestion(container || first));
  }

  var resumeDone = false;
  function attachResume(input) {
    if (resumeDone || !DATA.resume || input.files && input.files.length > 0) return;
    try {
      var base64 = DATA.resume.dataUrl.split(',')[1];
      var binary = atob(base64);
      var bytes = new Uint8Array(binary.length);
      for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      var file = new File([bytes], DATA.resume.fileName, { type: 'application/pdf' });
      var transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      resumeDone = true;
      mark(input);
    } catch (e) {
      // DataTransfer is missing on older engines; the reader attaches it by hand.
    }
  }

  var filledKeys = {};
  function run() {
    var elements = document.querySelectorAll('input, textarea, select');
    var groups = {};
    for (var i = 0; i < elements.length; i++) {
      var el = elements[i];
      var type = (el.type || '').toLowerCase();
      if (type === 'hidden' || type === 'submit' || type === 'button' || el.disabled) continue;

      if (type === 'file') {
        var fileLabel = labelFor(el) + ' ' + norm(el.name) + ' ' + norm(el.id);
        if (/resume|cv|curriculum/.test(fileLabel) || document.querySelectorAll('input[type=file]').length === 1) attachResume(el);
        continue;
      }
      if (type === 'radio' || type === 'checkbox') {
        var name = type + ':' + (el.name || el.id);
        (groups[name] = groups[name] || []).push(el);
        continue;
      }
      if (!visible(el) || el.getAttribute('data-careerdeck')) continue;
      if (el.value && el.value.trim() !== '') continue; // the reader's, or already filled

      var label = labelFor(el);
      if (CONSENT.test(label)) continue;
      var candidates = candidatesFor(label);
      for (var c = 0; c < candidates.length; c++) {
        var answer = candidates[c];
        var ok = el instanceof HTMLSelectElement ? fillSelect(el, answer)
          : isCombobox(el) ? fillCombobox(el, answer)
            // A yes/no or EEO answer never goes into a free-text box; a text answer with option
            // patterns (the degree) may.
            : answer.optionPatterns && answer.kind !== 'text' ? false
              : (setNative(el, answer.value), true);
        if (ok) { mark(el); filledKeys[answer.key] = true; break; }
      }
    }

    Object.keys(groups).forEach(function (name) {
      var group = groups[name];
      if (group.some(function (r) { return r.checked; })) return;
      var label = groupLabel(group);
      // A lone checkbox is almost always a consent or an "I certify"; those stay the reader's.
      if (CONSENT.test(label) || group.length === 1 && name.indexOf('checkbox:') === 0) return;
      var candidates = candidatesFor(label);
      for (var c = 0; c < candidates.length; c++) {
        if (fillGroup(group, candidates[c])) { filledKeys[candidates[c].key] = true; break; }
      }
    });

    report();

    // Once the page stops changing, whatever is still empty goes to the drafter.
    clearTimeout(askTimer);
    askTimer = setTimeout(collectQuestions, 1500);

    var body = norm(document.body ? (document.body.innerText || document.body.textContent || '').slice(0, 4000) : '');
    if (/thank you for (applying|your (application|interest))|application (has been |was )?(submitted|received)|we( ve| have) received your application/.test(body)
        && document.querySelectorAll('input[type=email]').length === 0) {
      post({ type: 'submitted' });
    }
  }

  function report() {
    post({
      type: 'progress',
      filled: Object.keys(filledKeys).length,
      total: DATA.answers.length,
      resumeAttached: resumeDone,
      aiFilled: aiFilled,
    });
  }

  // ── the questions nothing above could answer ──────────────────────────────

  var asked = {};
  var askTimer = null;
  var aiFilled = 0;
  var questionCounter = 0;
  var CONTACT = /^(full |first |last |legal |preferred )?name$|e-?mail|phone|mobile/;

  /** A key the app can hand back: the field's name, else its id, else a tag we put on it. */
  function keyFor(el) {
    if (el.name) return el.name;
    if (el.id) return '#' + el.id;
    var tag = el.getAttribute('data-careerdeck-q');
    if (!tag) { tag = String(++questionCounter); el.setAttribute('data-careerdeck-q', tag); }
    return '@' + tag;
  }

  function findByKey(key) {
    if (key.charAt(0) === '#') return [document.getElementById(key.slice(1))].filter(Boolean);
    if (key.charAt(0) === '@') return [document.querySelector('[data-careerdeck-q="' + CSS.escape(key.slice(1)) + '"]')].filter(Boolean);
    return Array.prototype.slice.call(document.getElementsByName(key));
  }

  function collectQuestions() {
    var questions = [];
    var groups = {};
    var elements = document.querySelectorAll('input, textarea, select');
    for (var i = 0; i < elements.length && questions.length < 20; i++) {
      var el = elements[i];
      var type = (el.type || '').toLowerCase();
      if (el.disabled || el.getAttribute('data-careerdeck')) continue;
      if (type === 'radio' || type === 'checkbox') {
        (groups[type + ':' + (el.name || el.id)] = groups[type + ':' + (el.name || el.id)] || []).push(el);
        continue;
      }
      var isText = el instanceof HTMLTextAreaElement || type === 'text' || type === '' || type === 'search';
      if (!(isText || el instanceof HTMLSelectElement) || !visible(el)) continue;
      if (el.value && el.value.trim() !== '') continue;
      var label = labelFor(el);
      if (!label || label.length < 3 || SELF_IDENTIFY.test(label) || CONSENT.test(label) || CONTACT.test(label)) continue;
      var key = keyFor(el);
      if (asked[key]) continue;
      var options = null;
      if (el instanceof HTMLSelectElement) {
        options = Array.prototype.slice.call(el.options)
          .filter(function (o) { return o.value !== '' && !/^select|^choose|^--/i.test(o.textContent.trim()); })
          .map(function (o) { return o.textContent.trim(); });
      }
      asked[key] = true;
      questions.push({
        key: key,
        label: label,
        kind: el instanceof HTMLTextAreaElement ? 'long_text' : options ? 'select' : 'text',
        options: options,
        required: el.required || el.getAttribute('aria-required') === 'true',
      });
    }
    Object.keys(groups).forEach(function (name) {
      var group = groups[name];
      if (questions.length >= 20 || group.some(function (r) { return r.checked; })) return;
      if (name.indexOf('checkbox:') === 0 && group.length === 1) return; // a lone checkbox is a consent
      var label = groupLabel(group);
      if (!label || SELF_IDENTIFY.test(label) || CONSENT.test(label)) return;
      var key = group[0].name || keyFor(group[0]);
      if (asked[key]) return;
      asked[key] = true;
      questions.push({
        key: key,
        label: label,
        kind: name.indexOf('checkbox:') === 0 ? 'multi_select' : 'select',
        options: group.map(function (input) { return (choiceText(input) || '').trim(); }),
        required: group.some(function (input) { return input.required; }),
      });
    });
    if (questions.length > 0) post({ type: 'questions', questions: questions });
  }

  /** Amber rather than green: written by the drafter, so the reader should read it. */
  function markDrafted(el) {
    el.setAttribute('data-careerdeck', 'drafted');
    el.style.outline = '2px solid #f59e0b';
    el.style.outlineOffset = '1px';
  }

  function answer(list) {
    list.forEach(function (item) {
      var els = findByKey(item.key);
      if (els.length === 0) return;
      var values = Array.isArray(item.value) ? item.value : [item.value];
      var first = els[0];
      var type = (first.type || '').toLowerCase();
      var done = false;
      if (type === 'radio' || type === 'checkbox') {
        values.forEach(function (value) {
          if (fillGroup(els, { value: value })) done = true;
        });
        if (done) els.forEach(function (el) { if (el.checked) markDrafted(el.closest('label') || el); });
      } else if (first instanceof HTMLSelectElement) {
        done = fillSelect(first, { value: values[0] });
        if (done) markDrafted(first);
      } else if (!first.value || first.value.trim() === '') {
        if (isCombobox(first)) fillCombobox(first, { value: values[0] });
        else setNative(first, values.join(', '));
        markDrafted(first);
        done = true;
      }
      if (done) aiFilled += 1;
    });
    report();
  }

  var timer = null;
  var observer = new MutationObserver(function () {
    clearTimeout(timer);
    timer = setTimeout(run, 400);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.__careerdeckAutofill = { run: run, labelFor: labelFor, answer: answer };
  setTimeout(run, 300);
})();
true;
`;
}

/**
 * The page with the form on it, which is not always the posting page an apply URL points at:
 * Lever and Ashby put the form one path segment further on.
 */
export function applicationFormUrl(applyUrl: string): string {
  try {
    const url = new URL(applyUrl);
    const segments = url.pathname.split('/').filter(Boolean);
    if (url.hostname.endsWith('lever.co') && segments.length === 2) {
      url.pathname = `/${segments.join('/')}/apply`;
    } else if (url.hostname === 'jobs.ashbyhq.com' && segments.length === 2) {
      url.pathname = `/${segments.join('/')}/application`;
    }
    return url.toString();
  } catch {
    return applyUrl;
  }
}
