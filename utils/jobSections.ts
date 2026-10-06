/**
 * A job posting's free text → the same handful of sections for every job.
 *
 * Employers write postings in every shape there is: the company's history first and the role
 * last, eleven ways of saying "requirements", benefits and EEO boilerplate twice the length of
 * the job. Rendered raw, a reel showed whatever happened to come first — usually "Astranis
 * builds advanced satellites…" — and ran a different length on every card.
 *
 * So the posting is read for its own headings, each section is sorted into one bucket, and the
 * app renders the buckets instead of the text: a fixed-length `summary` for the reel, and About /
 * What you'll do / What you need / Nice to have for the sheet. Nothing is invented or reworded —
 * every line shown is the employer's — and the full text stays one tap away.
 *
 * Pure and dependency-free on purpose: the reel parses on the device (no stored copy, nothing to
 * backfill, and a better parser ships with the app), and the server can import the same file.
 */

export interface JobSections {
  /** 1–3 of the employer's own sentences about the role, sized for a reel caption. */
  summary: string;
  /** Paragraphs for "About the role". */
  overview: string[];
  responsibilities: string[];
  requirements: string[];
  preferred: string[];
  /**
   * True when there is no real description at all — the internship feed's one-line stand-in for
   * a posting whose employer page could not be read. `facts` then carries what it did say.
   */
  isStub: boolean;
  facts: { label: string; value: string }[];
}

type Kind =
  | 'role'
  | 'team'
  | 'company'
  | 'responsibilities'
  | 'requirements'
  | 'preferred'
  | 'benefits'
  | 'legal'
  | 'other';

interface Block {
  kind: Kind | 'intro';
  paragraphs: string[];
  bullets: string[];
}

/** Checked in this order, because several overlap: "preferred qualifications" is not "qualifications". */
const HEADING_KINDS: [Kind, RegExp][] = [
  ['legal', /equal (employment )?opportunit|\beeo\b|accommodation|disclos|notices?\b|privacy|e-verify|referral|application instructions|physical demands|work authori[sz]ation|background check|pay transparency|disclaimer|recruit(ing|ment) (fraud|scam)|applicants? with disabilit/],
  ['benefits', /benefits|perks|what we offer|what('|’)?s in it for you|we (proudly )?offer|stipend|time off|compensation|salary|pay range|base pay|how .{0,30} supports?|total rewards|why (join|work)/],
  ['preferred', /^preferred|nice[- ]?to[- ]?haves?|bonus( points)?|pluses|stand out|not required|added plus|extra credit|desired|qualifications we value|is a plus|preferred (background|skills|experience)/],
  ['requirements', /qualifications|requirements|requisitos|what you('|’)?ll (need|bring)|what you (need|bring|will bring)|what we('|’)?re looking for|what we need to see|who you are|^you have|must[- ]haves?|required|^skills|experience (&|and) skills|about you|good fit if|excited about you|might thrive|love to hear from you|your background|ideal candidate|looking for someone|minimum|basic|you should have|you bring/],
  ['responsibilities', /responsibilit|what you('|’)?ll (do|be doing|actually do|work on)|what you will (do|be doing|work on)|in this role|^you will\b|you('|’)?ll be responsible|duties|essential functions|day[- ]to[- ]day|your (impact|role|work)|opportunity because you will|example projects|^the work|key (activities|accountabilities)|^job functions/],
  ['team', /^(about )?(the|our) .{0,30}team|^about our teams|^the team|^meet the team/],
  ['role', /^about (the|this) (role|job|position|opportunity|internship|program)|^the (role|opportunity|position|internship)|job (description|overview|summary)|position (summary|overview|description)|^overview|role (overview|summary|description)|^summary|^description|^your mission|^the program/],
  ['company', /^about\b|^who we are|^our (mission|values|story|company|culture)|^more about|^life at|^company (description|overview)|^why\b/],
];

/** Lines that start a bullet, after htmlToText turned `<li>` into "• ". */
const BULLET = /^(?:[•·▪●◦]\s*\.?\s*|[*\-–]\s+)/;
/** A bullet symbol with nothing after it. */
const BARE_BULLET = /^[•·▪●◦*\-–]\s*\.?$/;

/** The internship feed's stand-in, from server/src/ingest/aggregators/detail.ts. */
const STUB = /Tap Apply to see the full posting|Sourced from the Simplify/;

const SUMMARY_MIN = 140;
const SUMMARY_MAX = 300;
const MAX_BULLETS = 8;
const MAX_REQUIREMENTS = 10;
const MAX_OVERVIEW = 3;

export function parseJobSections(
  text: string | null | undefined,
  job: { title: string; companyName: string; requirements?: string[] },
): JobSections {
  const source = (text ?? '').trim();

  if (!source || STUB.test(source)) {
    return {
      summary: stubSummary(job),
      overview: [],
      responsibilities: [],
      requirements: job.requirements ?? [],
      preferred: [],
      isStub: true,
      facts: stubFacts(source),
    };
  }

  const blocks = toBlocks(source, job.title);
  const of = (kind: Block['kind']) => blocks.filter((block) => block.kind === kind);
  const bulletsOf = (kind: Kind, cap: number) => unique(of(kind).flatMap((block) => block.bullets)).slice(0, cap);

  const introParagraphs = of('intro').flatMap((block) => block.paragraphs);
  const roleParagraphs = of('role').flatMap((block) => block.paragraphs);
  const teamParagraphs = of('team').flatMap((block) => block.paragraphs);
  // A title word alone (score 1) is not enough: "…products people can use" is NVIDIA's pitch.
  const roleLikeIntro = introParagraphs.filter((paragraph) => roleScore(paragraph, job) >= 2);
  // Salesforce files "As a Named Account Executive, you would…" under "About Salesforce".
  const roleLikeElsewhere = blocks
    .filter((block) => block.kind === 'company' || block.kind === 'other')
    .flatMap((block) => block.paragraphs)
    .filter((paragraph) => roleScore(paragraph, job) >= 3);

  let responsibilities = bulletsOf('responsibilities', MAX_BULLETS);
  // A responsibilities section written as prose rather than a list still counts.
  if (responsibilities.length === 0) {
    responsibilities = of('responsibilities').flatMap((block) => block.paragraphs).slice(0, 3);
  }
  // Last, a list with no heading at all, outside the sections that are never duties.
  if (responsibilities.length === 0) {
    responsibilities = unique(
      blocks
        .filter((block) => ['intro', 'role', 'team', 'company', 'other'].includes(block.kind))
        .flatMap((block) => block.bullets),
    ).slice(0, MAX_BULLETS);
  }
  let requirements = bulletsOf('requirements', MAX_REQUIREMENTS);
  if (requirements.length === 0) requirements = (job.requirements ?? []).slice(0, MAX_REQUIREMENTS);
  const preferred = bulletsOf('preferred', MAX_BULLETS);

  const overview = unique([...roleParagraphs, ...roleLikeIntro, ...roleLikeElsewhere, ...teamParagraphs])
    .slice(0, MAX_OVERVIEW);

  const summary = padSummary(
    buildSummary(
      [
        roleParagraphs,
        roleLikeIntro,
        roleLikeElsewhere,
        teamParagraphs.filter((paragraph) => roleScore(paragraph, job) >= 2),
        responsibilities.length > 0 ? [responsibilitiesSentence(responsibilities)] : [],
        teamParagraphs,
        introParagraphs,
      ],
      job,
    ),
    responsibilities,
  );

  // Never a blank caption: the first thing the posting says that is not legal or benefits text.
  const fallback = summary
    ? summary
    : truncate(
        blocks
          .filter((block) => block.kind !== 'legal' && block.kind !== 'benefits')
          .flatMap((block) => [...block.paragraphs, ...block.bullets])
          .find((line) => line.length >= 40) ?? `${job.title} at ${job.companyName}.`,
        SUMMARY_MAX,
      );

  return {
    summary: fallback,
    overview: overview.length > 0 ? overview : [fallback],
    responsibilities,
    requirements,
    preferred,
    isStub: false,
    facts: [],
  };
}

// ── reading the text into blocks ───────────────────────────────────────────────

function toBlocks(source: string, title: string): Block[] {
  const blocks: Block[] = [{ kind: 'intro', paragraphs: [], bullets: [] }];
  const lines = joinBareBullets(source.split('\n').map((line) => line.trim()).filter(Boolean));
  const titleLine = title.trim().toLowerCase();

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const current = blocks[blocks.length - 1]!;

    // Workday and others open with the title as its own line; it is already on the card.
    if (line.toLowerCase() === titleLine) continue;

    if (BULLET.test(line)) {
      const bullet = cleanLine(line.replace(BULLET, ''));
      // "• Required" / "• Preferred" — a sub-heading set as a list item, which switches section.
      const subheading = bullet.split(/\s+/).length <= 3 ? headingKind(bullet) : null;
      if (subheading) blocks.push({ kind: subheading, paragraphs: [], bullets: [] });
      else if (bullet.length >= 3) current.bullets.push(bullet);
      continue;
    }

    // "Responsibilities: Build things…" — a heading and its first line on one line.
    const inline = line.match(/^([^.:!?]{3,60}):\s+(\S.*)$/);
    if (inline && headingKind(inline[1]!)) {
      blocks.push({ kind: headingKind(inline[1]!)!, paragraphs: [cleanLine(inline[2]!)], bullets: [] });
      continue;
    }

    const next = lines.slice(index + 1).find(Boolean) ?? '';
    const kind = isHeading(line, next) ? headingKind(line) ?? 'other' : null;
    if (kind) {
      blocks.push({ kind, paragraphs: [], bullets: [] });
      continue;
    }

    const paragraph = cleanLine(line);
    // A line that was only a stray tag or a link cleans down to nothing.
    if (paragraph.length >= 3) current.paragraphs.push(paragraph);
  }

  return blocks.filter((block) => block.paragraphs.length > 0 || block.bullets.length > 0);
}

/**
 * `<li><p>text</p></li>` comes out of htmlToText as a lone "•" with the text on the next line,
 * which is how most Workday and many Greenhouse postings arrive. Rejoined here, or every bullet
 * in them reads as a paragraph and their requirements come out empty.
 */
function joinBareBullets(lines: string[]): string[] {
  const joined: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (BARE_BULLET.test(line) && index + 1 < lines.length && !BULLET.test(lines[index + 1]!)) {
      joined.push(`• ${lines[index + 1]}`);
      index += 1;
    } else if (!BARE_BULLET.test(line)) {
      joined.push(line);
    }
  }
  return joined;
}

function isHeading(line: string, next: string): boolean {
  const bare = stripHeading(line);
  if (bare.length < 3 || bare.length > 80 || bare.split(/\s+/).length > 12) return false;
  // A sentence is not a heading, however short.
  if (/[.!?]$/.test(line) && !/(…|\.\.\.)$/.test(line)) return false;
  if (/[:…]$|\.\.\.$/.test(line)) return true;
  if (BULLET.test(next)) return true;
  if (/^[A-Z0-9][A-Z0-9 &'’/,()-]{3,}$/.test(line)) return true;
  // A short line that reads as a known heading, followed by prose.
  return bare.split(/\s+/).length <= 6 && headingKind(line) !== null;
}

function headingKind(line: string): Kind | null {
  const bare = stripHeading(line).toLowerCase();
  for (const [kind, pattern] of HEADING_KINDS) {
    if (pattern.test(bare)) return kind;
  }
  return null;
}

function stripHeading(line: string): string {
  return line
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/[:…]+$|\.\.\.$/, '')
    .replace(/^#+\s*/, '')
    .trim();
}

function cleanLine(line: string): string {
  // Some sources double-escape their HTML, so a `<div>` survives htmlToText as literal text.
  // Links are dropped too: a card cannot open them, and a bare URL is noise in a sentence.
  return line
    .replace(/<\/?[a-z][a-z0-9]*\b[^>]*>/gi, ' ')
    .replace(/\s*\(?https?:\/\/\S+\)?/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── choosing the summary ───────────────────────────────────────────────────────

/** Positive when a paragraph is about the job; negative when it is about the company. */
function roleScore(paragraph: string, job: { title: string; companyName: string }): number {
  const lower = paragraph.toLowerCase();
  let score = 0;
  if (/\byou('|’)?(ll| will| would)?\b|\byour\b/.test(lower)) score += 2;
  if (/\b(this|the) (role|position|internship|opportunity|program)\b|\bas an? [^,.]{3,60}, you\b/.test(lower)) score += 2;
  if (/\b(we('|’)?re|we are) (looking|seeking|hiring)|\bseeking\b|\blooking for\b/.test(lower)) score += 2;
  if (/\b(intern|internship|co-?op|new grad|graduate)\b/.test(lower)) score += 1;
  const titleWords = job.title.toLowerCase().split(/[^a-z]+/).filter((word) => word.length > 3);
  if (titleWords.some((word) => lower.includes(word))) score += 1;
  if (isBoilerplate(paragraph, job)) score -= 4;
  return score;
}

/** Says what the person in the job will do, or that the company is hiring for it. */
const ROLE_SIGNAL =
  /\byou('|’)?(ll|d)\b|\byou (will|would)\b|\b(this|the) (role|position|internship)\b|\bas an? [^,.]{3,60}, you\b|\b(looking|seeking|hiring) for\b|\b(is|are) (looking|seeking)\b|\bseeking an?\b/;

/** The company's own pitch, a mission statement, hiring logistics or legal text: never a summary. */
function isBoilerplate(paragraph: string, job: { companyName: string }): boolean {
  const lower = paragraph.toLowerCase();
  const company = job.companyName.toLowerCase().split(/[ ,(]/)[0] ?? '';
  if (company && (lower.startsWith(company) || lower.startsWith(`at ${company}`))) {
    if (!ROLE_SIGNAL.test(lower.slice(0, 200))) return true;
  }
  if (/^(we are|we're|we’re|founded|our mission|our vision|since \d{4}|headquartered|for (over|more than) \w+ (decades|years))/.test(lower)) {
    if (!ROLE_SIGNAL.test(lower)) return true;
  }
  // Culture copy that addresses the reader but describes the employer, not the job.
  if (/^(welcome to|working at|a career at|life at|the same principles|from creating|\*)/.test(lower)) return true;
  if (/equal opportunity|without regard to|reasonable accommodation|e-verify|applicants? (must|will)|privacy (policy|notice)/.test(lower)) return true;
  if (/maximum of \d+ roles|candidate experience|applications? (for this job )?will be accepted|this posting is for|recruiting process/.test(lower)) return true;
  if (/legal entity|learn (more|how we work)|commuting distance|days (per|a) week in|in the office \w+ days/.test(lower)) return true;
  if (/\b(world('|’)?s (leading|largest)|global leader|leading provider|fortune \d+|mission is to)\b/.test(lower)) return true;
  return false;
}

function buildSummary(candidates: string[][], job: { title: string; companyName: string }): string {
  for (const paragraphs of candidates) {
    const sentences = paragraphs
      .filter((paragraph) => paragraph.length >= 40)
      .flatMap(sentencesOf)
      .map((sentence) => sentence.replace(/\s*https?:\/\/\S+/g, '').trim())
      // "Do you love building…?" and "You're in the right place!" are hooks, not descriptions.
      .filter((sentence) => sentence.length >= 20 && !/[?!]$/.test(sentence) && !isBoilerplate(sentence, job));

    let summary = '';
    for (const sentence of sentences) {
      const next = summary ? `${summary} ${sentence}` : sentence;
      if (next.length > SUMMARY_MAX) {
        if (summary.length === 0) return truncate(sentence, SUMMARY_MAX);
        break;
      }
      summary = next;
      if (summary.length >= SUMMARY_MIN) break;
    }
    if (summary.length >= 60) return summary;
  }
  return '';
}

/** Tops a short summary up to caption length with the first thing the role does. */
function padSummary(summary: string, responsibilities: string[]): string {
  if (summary.length >= SUMMARY_MIN - 40) return summary;
  // The first duty the summary does not already say.
  const unused = responsibilities
    .map((bullet) => responsibilitiesSentence([bullet]))
    .find((sentence) => !summary.includes(sentence.replace(/\.$/, '')));
  if (!unused) return summary;
  const padded = summary ? `${summary} ${unused}` : unused;
  return padded.length <= SUMMARY_MAX ? padded : summary || truncate(unused, SUMMARY_MAX);
}

function responsibilitiesSentence(bullets: string[]): string {
  // "Market Analysis: Evaluate the…" — the label reads as a heading, not a sentence.
  const [first, second] = bullets.map((bullet) => bullet.replace(/^[^:.]{3,40}:\s+/, '').replace(/[.;,]+$/, ''));
  return second ? `${first}. ${second}.` : `${first}.`;
}

function sentencesOf(paragraph: string): string[] {
  return paragraph.split(/(?<=[.!?])\s+(?=[A-Z"“(])/).map((sentence) => sentence.trim()).filter(Boolean);
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  return `${cut.slice(0, cut.lastIndexOf(' ')).replace(/[,;:]$/, '')}…`;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

// ── the feed's stand-in ────────────────────────────────────────────────────────

function stubFacts(source: string): JobSections['facts'] {
  const facts: JobSections['facts'] = [];
  const term = source.match(/Term(?:\(s\))?: ([^.]+)\./)?.[1];
  const degrees = source.match(/Open to:? ([^.]+?) students\./)?.[1];
  if (term) facts.push({ label: 'Term', value: term });
  if (degrees) facts.push({ label: 'Open to', value: `${degrees} students` });
  return facts;
}

function stubSummary(job: { title: string; companyName: string }): string {
  return `${job.title} at ${job.companyName}. The full description is on ${job.companyName}'s site.`;
}
