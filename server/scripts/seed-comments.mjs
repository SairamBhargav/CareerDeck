/*
 * Launch seed comments — fake student chatter on the jobs a new user's deck shows first.
 *
 *   cd server
 *   node --env-file=.env --env-file=../.env.local scripts/seed-comments.mjs <step>
 *
 * Steps, in order (each writes its output under scripts/.seed/ so a later step can rerun alone):
 *
 *   accounts   create the seed accounts (seedNN@seed.careerdeck.invalid) with school/major/year
 *   gifs       build the GIF pool from KLIPY search, one query per mood (~20 requests)
 *   pilot      write comments for a handful of jobs with the plain Messages API, to read them
 *   generate   submit the Message Batch (Haiku 4.5, half price) for the chosen jobs
 *   collect    wait for the batch and parse its results
 *   insert     insert comments + likes, skipping jobs that already have seed comments
 *   remove     delete every seed account; comments, likes and notifications cascade
 *
 * Every seed account's email ends in SEED_DOMAIN, so "is this real?" is one `like` away, for
 * cleanup and for keeping them out of any metric.
 *
 * Comments go in as `approved`: the moderation sweep only rechecks `flagged`, so nothing here
 * spends a moderation call. The prompt keeps them away from the claims moderation exists for —
 * no "I interviewed there", no facts about the employer that the posting does not state.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

import Anthropic from '@anthropic-ai/sdk';
import { EVERYDAY, UNIVERSAL_C, UNIVERSAL_Q, UNIVERSAL_CAPTION } from './seed-universal.mjs';

const ALLOWED = new Set([...EVERYDAY, ...[...UNIVERSAL_C, ...UNIVERSAL_Q, ...UNIVERSAL_CAPTION].flatMap((l) => l.toLowerCase().match(/[a-z]+/g) ?? [])]);
import { createClient } from '@supabase/supabase-js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '.seed');
mkdirSync(OUT, { recursive: true });

const SEED_DOMAIN = 'seed.careerdeck.invalid';
const ACCOUNTS = 72;
const JOB_COUNT = Number(process.env.SEED_JOBS ?? 1200);
const PER_COMPANY = 3;
const JOBS_PER_REQUEST = 4;
const MODEL = 'claude-haiku-4-5';

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const anthropic = new Anthropic();

// SEED_TAG names a run's jobs/batch/results files, so a second run does not overwrite the first.
const TAG = process.env.SEED_TAG ?? '';
const tagged = (name) => (TAG ? name.replace('.json', `-${TAG}.json`) : name);
const file = (name) => join(OUT, name);
const save = (name, value) => writeFileSync(file(name), JSON.stringify(value, null, 2));
const load = (name) => JSON.parse(readFileSync(file(name), 'utf8'));
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const between = (lo, hi) => lo + Math.random() * (hi - lo);

// ── accounts ───────────────────────────────────────────────────────────────────

// Exact `schools.name`, weighted by repetition toward the big recruiting schools.
const SCHOOLS = [
  'Purdue University', 'Purdue University', 'Georgia Institute of Technology', 'Georgia Institute of Technology',
  'University of Illinois Urbana-Champaign', 'University of Illinois Urbana-Champaign', 'University of Michigan',
  'University of Texas at Austin', 'University of Texas at Austin', 'University of Texas at Dallas',
  'University of California, Berkeley', 'Arizona State University', 'Arizona State University',
  'University of Washington', 'Ohio State University', 'Rutgers University-New Brunswick', 'Boston University',
  'Carnegie Mellon University', 'Cornell University', 'Stanford University', 'University of California-Irvine',
  'Rice University', 'Duke University', 'Georgia State University', 'San Jose State University', 'Drexel University',
  'Stony Brook University', 'Iowa State University', 'Vanderbilt University', 'Emory University',
  'CUNY Bernard M Baruch College', 'Brown University', 'Massachusetts Institute of Technology',
];

const MAJORS = [
  'CS', 'CS', 'CS', 'CS', 'CS', 'Computer Engineering', 'Data Science', 'Data Science', 'Software Engineering',
  'Electrical Engineering', 'Mechanical Engineering', 'Information Science', 'Statistics', 'Math', 'Finance',
  'Finance', 'Economics', 'Business', 'Marketing', 'Accounting', 'Industrial Engineering', 'Design', 'Cognitive Science',
];

const COLORS = ['#5B5BD6', '#E5484D', '#30A46C', '#F76B15', '#0090FF', '#8E4EC6', '#D6409F', '#12A594', '#FFB224', '#3E63DD'];

async function accounts() {
  const { data: schools, error } = await db.from('schools').select('id,name').in('name', [...new Set(SCHOOLS)]);
  if (error) throw error;
  const byName = new Map();
  for (const s of schools) if (!byName.has(s.name)) byName.set(s.name, s.id);

  const made = existsSync(file('accounts.json')) ? load('accounts.json') : [];
  for (let i = made.length; i < ACCOUNTS; i++) {
    const email = `seed${String(i + 1).padStart(2, '0')}@${SEED_DOMAIN}`;
    const { data, error: e } = await db.auth.admin.createUser({
      email,
      email_confirm: false,
      user_metadata: { seed: true },
    });
    if (e) throw new Error(`${email}: ${e.message}`);
    const id = data.user.id;
    const school = pick(SCHOOLS);
    const year = pick([2026, 2027, 2027, 2028, 2028, 2029]);
    const profile = {
      school_id: Math.random() < 0.85 ? (byName.get(school) ?? null) : null,
      major: pick(MAJORS),
      graduation_year: year,
      avatar_color: pick(COLORS),
      onboarding_completed_at: new Date(Date.now() - between(3, 20) * 86_400_000).toISOString(),
    };
    const { error: pe } = await db.from('profiles').update(profile).eq('id', id);
    if (pe) throw pe;
    made.push({ id, email });
    save('accounts.json', made);
  }
  const { data: shown } = await db.from('profiles').select('handle,comment_badge').in('id', made.map((a) => a.id)).limit(8);
  console.log(`${made.length} seed accounts. e.g.`, shown);
}

// ── gifs ───────────────────────────────────────────────────────────────────────

// Mood → KLIPY search, and optionally a title filter where search drifts off-topic. The model
// picks a mood; a GIF is drawn from that mood's pool.
const MOODS = {
  cooked: ['we are cooked', /cook/i],
  its_over: ['its over', /over/i],
  speed_shocked: ['ishowspeed shocked', /speed/i],
  speed_hype: ['ishowspeed hype', /speed/i],
  crying: ['crying meme', /cry/i],
  praying: 'praying please',
  money: 'money rain',
  skull_laugh: 'laughing hysterically',
  nervous: 'nervous sweating',
  celebrate: 'lets go celebration',
  waiting: 'waiting skeleton',
  mind_blown: 'mind blown',
  typing: 'typing fast',
  side_eye: 'side eye',
  sad: 'sad spongebob',
  locked_in: 'locked in',
  shrug: 'shrug',
  this_is_fine: 'this is fine',
  wow: 'wow',
};

async function gifs() {
  const key = process.env.EXPO_PUBLIC_KLIPY_APP_KEY;
  if (!key) throw new Error('EXPO_PUBLIC_KLIPY_APP_KEY is not set (pass --env-file=../.env.local).');
  const pool = {};
  for (const [mood, spec] of Object.entries(MOODS)) {
    const [q, match] = Array.isArray(spec) ? spec : [spec, null];
    const params = new URLSearchParams({ q, page: '1', per_page: '24', locale: 'us', content_filter: 'high', format_filter: 'gif' });
    const res = await fetch(`https://api.klipy.com/api/v1/${encodeURIComponent(key)}/gifs/search?${params}`);
    if (!res.ok) throw new Error(`KLIPY ${res.status} on ${q}`);
    const json = await res.json();
    pool[mood] = (json.data?.data ?? [])
      .filter((g) => typeof g.slug === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(g.slug) && (g.type ?? 'gif') === 'gif')
      .filter((g) => !match || match.test(g.title ?? ''))
      .slice(0, 8)
      .map((g) => ({ slug: g.slug, title: g.title ?? '' }));
    console.log(mood.padEnd(14), pool[mood].length, pool[mood].slice(0, 3).map((g) => g.title).join(' | '));
  }
  save('gifs.json', pool);
}

// ── jobs ───────────────────────────────────────────────────────────────────────

/*
 * The jobs a deck can actually show. `personal_candidate_pool` takes the 400 newest eligible
 * postings in the reader's families and seniorities, so the first run — top quality_score —
 * missed most of what people see (2026-10-08: 152 of the user's 600). This is the union of that
 * pool over every family × seniority target, ranked by how near the top of any one it sits.
 */
const TARGETS = [['intern'], ['new_grad', 'intern'], ['new_grad'], ['new_grad', 'mid']];

function fits(job, targets) {
  return targets.includes(job.seniority)
    || (job.seniority === null && (job.employment_type === 'Internship' || targets.includes('new_grad') || targets.includes('mid')));
}

async function seededJobs(accounts) {
  const seeded = new Set();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('comments').select('job_id').in('author_id', accounts).order('id').range(from, from + 999);
    if (error) throw error;
    for (const r of data) seeded.add(r.job_id);
    if (data.length < 1000) return seeded;
  }
}

async function target() {
  const jobs = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('jobs')
      .select('id,job_family,seniority,employment_type,posted_at')
      .eq('status', 'open').gt('quality_score', 0.3).order('id').range(from, from + 999);
    if (error) throw error;
    jobs.push(...data);
    if (data.length < 1000) break;
  }
  const rank = new Map();
  for (const family of new Set(jobs.map((j) => j.job_family))) {
    for (const targets of TARGETS) {
      jobs.filter((j) => j.job_family === family && fits(j, targets))
        .sort((a, b) => (b.posted_at ?? '').localeCompare(a.posted_at ?? ''))
        .slice(0, 400)
        .forEach((j, i) => rank.set(j.id, Math.min(rank.get(j.id) ?? Infinity, i)));
    }
  }
  const seeded = await seededJobs(load('accounts.json').map((a) => a.id));
  const byId = new Map(jobs.map((j) => [j.id, j]));
  const out = [...rank.entries()]
    .filter(([id]) => !seeded.has(id))
    .sort((a, b) => a[1] - b[1])
    .map(([id, r]) => {
      const j = byId.get(id);
      const intern = j.seniority === 'intern' || j.employment_type === 'Internship';
      return { id, family: j.job_family, intern, rank: r };
    });
  save('target.json', out);
  console.log(`${rank.size} jobs reach a deck; ${rank.size - out.length} already seeded; ${out.length} to go`);
}

async function chooseJobs() {
  if (TAG === 'newest') {
    // The top of target.json, which `remix` then leaves alone.
    const ids = load('target.json').slice(0, JOB_COUNT).map((t) => t.id);
    const rows = [];
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await db.from('jobs')
        .select('id,title,company_name,location_raw,location_type,employment_type,seniority,salary_min,salary_max,salary_period,description_text,first_seen_at,quality_score')
        .in('id', ids.slice(i, i + 200));
      if (error) throw error;
      rows.push(...data);
    }
    return rows.sort(() => Math.random() - 0.5);
  }
  const rows = [];
  for (let from = 0; rows.length < JOB_COUNT * 4 && from < 20_000; from += 1000) {
    const { data, error } = await db
      .from('jobs')
      .select('id,title,company_name,location_raw,location_type,employment_type,seniority,salary_min,salary_max,salary_period,description_text,first_seen_at,quality_score')
      .eq('status', 'open')
      // The postings students are here for — and the ones the pilot's comments made sense on.
      .in('seniority', ['intern', 'new_grad'])
      .order('quality_score', { ascending: false, nullsFirst: false })
      .order('first_seen_at', { ascending: false })
      .range(from, from + 999);
    if (error) throw error;
    if (data.length === 0) break;
    rows.push(...data);
  }
  const perCompany = new Map();
  const seen = new Set();
  const chosen = [];
  for (const job of rows) {
    const n = perCompany.get(job.company_name) ?? 0;
    // The same role listed per city reads as one post twice.
    const key = `${job.company_name}|${job.title}`.toLowerCase();
    if (n >= PER_COMPANY || seen.has(key)) continue;
    seen.add(key);
    perCompany.set(job.company_name, n + 1);
    chosen.push(job);
    if (chosen.length >= JOB_COUNT) break;
  }
  // Shuffled, so one request's four jobs are four different companies: grouped siblings got
  // compared with each other ("why is warp hiring 3 roles"), which no real thread would do.
  return chosen.sort(() => Math.random() - 0.5);
}

function pay(job) {
  if (!job.salary_min && !job.salary_max) return null;
  const fmt = (v) => (job.salary_period === 'hour' ? `$${Math.round(v)}/hr` : `$${Math.round(v / 1000)}k`);
  return job.salary_min && job.salary_max && job.salary_min !== job.salary_max
    ? `${fmt(job.salary_min)}–${fmt(job.salary_max)}`
    : fmt(job.salary_max ?? job.salary_min);
}

function describe(job, n) {
  // Cut at a sentence end, or the model jokes about the posting being cut off.
  const text = (job.description_text ?? '').replace(/\s+/g, ' ').slice(0, 360);
  const end = Math.max(text.lastIndexOf('. '), text.lastIndexOf('! '), text.lastIndexOf('? '));
  const snippet = end > 80 ? text.slice(0, end + 1) : '';
  return [
    `### JOB ${n}`,
    `${job.title} — ${job.company_name}`,
    `${job.location_raw ?? ''} (${job.location_type ?? '?'}) · ${job.employment_type ?? '?'} · ${job.seniority ?? '?'}${pay(job) ? ` · ${pay(job)}` : ''}`,
    snippet ? `Posting: ${snippet}` : '',
  ].filter(Boolean).join('\n');
}

// ── prompt ─────────────────────────────────────────────────────────────────────

const SYSTEM = `You write the comment section under job postings in a college students' job app (think TikTok/Instagram comments, but the posts are internships and new-grad roles). For each JOB you get, write 11 comments from different US/Canadian college students.

Voice: gen-z, mostly lowercase, short (usually under 70 chars, never over 110), funny, self-deprecating, a little unhinged. Slang is fine (fr, ngl, lowkey, no shot, bro, 😭, 💀). Every job's thread must feel specific to THAT posting: riff on the company, the role title, the pay, the city, the requirements, remote vs onsite, the job's quirks. Don't reuse the same joke across jobs.

Mix per job: ~3 GIF reactions, ~3 questions a student would genuinely ask, ~4 jokes/reactions, 1–2 replies to earlier comments.

Hard rules:
- Never claim personal experience with the employer (no "I interned/interviewed/worked there", "my friend got an offer", "they ghosted me", "OA was easy").
- Never state facts about the company that the posting doesn't say (no culture, layoffs, salary rumors, visa policy). Questions about them are fine.
- No slurs, sexual content, drugs, threats, real people's names besides IShowSpeed, or insults aimed at the company/its staff. Mild swearing at most once per job.
- Never call the posting fake, a scam or a trap, even jokingly.
- Never praise or judge the employer itself ("goated company", "insane team", "solid company", "toxic") — react to the posting, the pay, the role, your own chances.
- Each JOB is its own post with its own commenters: never refer to other jobs or to "the posting above". The posting text is an excerpt; never remark on it being cut off.
- Don't mention the app, AI, or that these are generated. No hashtags, no @mentions.
- A G line's mood must be exactly one of the moods listed below.

Output format, one comment per line, nothing else:
C|text            a normal comment
Q|question        a question
G|mood            a GIF alone
G|mood|caption    a GIF with a short caption
R2|text           a reply to comment #2 of this job (numbered by line, 1-based; reply only to C or Q lines that came earlier)
GIF moods: ${Object.keys(MOODS).join(', ')}
Start each job with its header line "### JOB n" exactly as given.`;

function userPrompt(jobs, offset) {
  return jobs.map((job, i) => describe(job, offset + i + 1)).join('\n\n');
}

function parse(text) {
  const out = new Map();
  let current = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const header = /^###\s*JOB\s+(\d+)/i.exec(line);
    if (header) { current = Number(header[1]); out.set(current, []); continue; }
    if (current === null || !line.includes('|')) continue;
    const [kind, ...rest] = line.split('|');
    const body = rest.join('|').trim().replace(/^reply to (that|this|them)[:,]?\s*/i, '');
    // What the prompt forbids and Haiku still sometimes writes. Cheaper to drop than to argue.
    if (/\b(scam|toxic|goated|shit|fuck|ghosted|layoffs?|trap|job \d)\b|posting above|sounds fake|fake (company|videos)|seems fake/i.test(body)) continue;
    const list = out.get(current);
    if (kind === 'C' || kind === 'Q') { if (body) list.push({ kind, body }); }
    else if (kind === 'G') {
      let [mood, ...cap] = body.split('|').map((x) => x.trim());
      // "G|confused|mind_blown": an invented mood with the real one in the caption slot.
      if (!(mood in MOODS) && cap.length === 1 && cap[0] in MOODS) [mood, cap] = [cap[0], []];
      list.push({ kind, mood, body: mood in MOODS ? cap.join('|') : '' });
    } else if (/^R\d+$/.test(kind)) {
      if (body) list.push({ kind: 'R', to: Number(kind.slice(1)), body });
    }
  }
  return out;
}

function requestFor(jobs, offset) {
  return {
    model: MODEL,
    max_tokens: 400 * jobs.length + 200,
    temperature: 1,
    system: SYSTEM,
    messages: [{ role: 'user', content: userPrompt(jobs, offset) }],
  };
}

// Haiku 4.5: $1 / $5 per MTok, half on the Batch API.
const cost = (u, batch) => ((u.input_tokens * 1 + u.output_tokens * 5) / 1e6) * (batch ? 0.5 : 1);

async function pilot() {
  const jobs = (await chooseJobs()).slice(0, 8);
  let usage = { input_tokens: 0, output_tokens: 0 };
  const results = {};
  for (let i = 0; i < jobs.length; i += JOBS_PER_REQUEST) {
    const group = jobs.slice(i, i + JOBS_PER_REQUEST);
    const msg = await anthropic.messages.create(requestFor(group, 0));
    usage.input_tokens += msg.usage.input_tokens;
    usage.output_tokens += msg.usage.output_tokens;
    const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    const parsed = parse(text);
    group.forEach((job, k) => { results[job.id] = parsed.get(k + 1) ?? []; });
  }
  for (const job of jobs) {
    console.log(`\n=== ${job.title} — ${job.company_name} (${job.location_raw}) ${pay(job) ?? ''}`);
    for (const c of results[job.id]) console.log(`  ${c.kind}${c.to ? c.to : ''}${c.mood ? `[${c.mood}]` : ''} ${c.body}`);
  }
  const per = cost(usage, false) / jobs.length;
  console.log(`\nusage`, usage, `≈ $${per.toFixed(5)}/job standard, ≈ $${(per / 2).toFixed(5)}/job batch → ${JOB_COUNT} jobs ≈ $${((per / 2) * JOB_COUNT).toFixed(2)}`);
  save('pilot.json', { jobs: jobs.map((j) => j.id), results });
}

// ── batch ──────────────────────────────────────────────────────────────────────

async function generate() {
  const jobs = await chooseJobs();
  save(tagged('jobs.json'), jobs.map(({ description_text, ...j }) => j));
  const requests = [];
  for (let i = 0; i < jobs.length; i += JOBS_PER_REQUEST) {
    const group = jobs.slice(i, i + JOBS_PER_REQUEST);
    requests.push({ custom_id: `g${i / JOBS_PER_REQUEST}`, params: requestFor(group, 0) });
  }
  const batch = await anthropic.messages.batches.create({ requests });
  save(tagged('batch.json'), { id: batch.id, groups: requests.length, perGroup: JOBS_PER_REQUEST });
  console.log(`batch ${batch.id}: ${jobs.length} jobs in ${requests.length} requests`);
}

async function collect() {
  const { id, perGroup } = load(tagged('batch.json'));
  const jobs = load(tagged('jobs.json'));
  for (;;) {
    const b = await anthropic.messages.batches.retrieve(id);
    console.log(new Date().toISOString(), b.processing_status, b.request_counts);
    if (b.processing_status === 'ended') break;
    await new Promise((r) => setTimeout(r, 30_000));
  }
  const usage = { input_tokens: 0, output_tokens: 0 };
  const results = {};
  let failed = 0;
  for await (const row of await anthropic.messages.batches.results(id)) {
    if (row.result.type !== 'succeeded') { failed++; continue; }
    const msg = row.result.message;
    usage.input_tokens += msg.usage.input_tokens;
    usage.output_tokens += msg.usage.output_tokens;
    const start = Number(row.custom_id.slice(1)) * perGroup;
    const parsed = parse(msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n'));
    for (let k = 0; k < perGroup; k++) {
      const job = jobs[start + k];
      if (job && (parsed.get(k + 1)?.length ?? 0) >= 6) results[job.id] = parsed.get(k + 1);
    }
  }
  save(tagged('results.json'), results);
  console.log(`${Object.keys(results).length}/${jobs.length} jobs parsed, ${failed} requests failed, usage`, usage, `≈ $${cost(usage, true).toFixed(3)}`);
}

// ── remix ──────────────────────────────────────────────────────────────────────

/*
 * Free threads for the rest of target.json, built from the Haiku comments already written.
 * Only lines that would read true under any posting are reused: nothing naming the company,
 * the city, a number, a quote from the posting, pay, or where the work happens. Lines are
 * pooled per job family (a hardware joke stays on hardware jobs) and dealt round-robin, so each
 * is reused as evenly and as rarely as the pool allows.
 */
const SPECIFIC = /[0-9$"“”']|\b(remote|onsite|on-site|hybrid|in-person|office|commute|rent|city|cost of living|relocat\w*|housing|salary|pay|paid|hourly|bay area|sf|nyc|ny|la|cad|usd|canada|canadian|california|texas|seattle|boston|chicago|austin|denver|toronto|vancouver|same|this company|they're hiring|startup|ai)\b/i;
const GENERIC_TITLE_WORDS = new Set(['intern', 'internship', 'summer', 'engineer', 'engineering', 'software', 'analyst', 'new', 'grad', 'and', 'the', 'for', 'with']);

const wordsOf = (text) => (text ?? '').toLowerCase().match(/[a-z]{4,}/g) ?? [];

/*
 * Naming the company or city is the easy half. The other half is a line about the posting's
 * subject — "rockets are cool", "is this mostly verilog" — which reads as obviously fake under a
 * bank internship. So a line also needs every word in it to be one the commenters used on at
 * least DF_MIN different jobs: "return offer" passes, "rockets" and "quebec" do not.
 */
const DF_MIN = 15;
const FAMILY_MIN = 5;
let documentFrequency = new Map();
let familySpread = new Map();
// The same rule `parse` applies to new output, for lines written before it worked.
// Lines that only make sense under an internship ("how many interns", "summer only?").
const INTERN_ONLY = /\b(intern|interns|internship|internships|summer|semester|co-?op|return offers?|school ends|credit)\b/i;
const OFF_RULES = /\bmore than\b|(scam|toxic|goated|shit|fuck|ghosted|layoffs?|trap|job \d)|posting above|sounds fake|fake (company|videos)|seems fake/i;

function isGeneric(body, job) {
  if (!body) return true;
  if (SPECIFIC.test(body)) return false;
  if (OFF_RULES.test(body)) return false;
  if ((body.toLowerCase().match(/[a-z]+/g) ?? []).some((w) => w.length > 1 && !ALLOWED.has(w))) return false;
  // Common overall, and common across fields: "verilog" is frequent, but only under hardware.
  if (wordsOf(body).some((w) => (documentFrequency.get(w) ?? 0) < DF_MIN || (familySpread.get(w)?.size ?? 0) < FAMILY_MIN)) return false;
  const lower = body.toLowerCase();
  const words = [
    ...`${job.company_name ?? ''} ${job.location_raw ?? ''}`.toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 3),
    ...(job.title ?? '').toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 4 && !GENERIC_TITLE_WORDS.has(w)),
  ];
  return !words.some((w) => new RegExp(`\\b${w}`, 'i').test(lower));
}

/*
 * Each line recurs across thousands of posts, so no two uses should be byte-identical: the
 * same question asked twice is normal, the same string with the same emoji twice looks pasted.
 */
const TAILS = ['', '', '', ' 😭', ' 🙏', ' lol', ' fr', ' ngl', ' 💀', ' 👀', ' 😮‍💨', '!!'];
const HEADS = ['', '', '', '', 'ok ', 'wait ', 'ngl ', 'lowkey ', 'bro ', 'ok but '];

function vary(body) {
  let out = body.replace(/[\s\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{200D}]+$/u, '');
  const head = pick(HEADS);
  if (head && !/^(ok|wait|ngl|lowkey|bro)\b/i.test(out)) out = head + out.charAt(0).toLowerCase() + out.slice(1);
  if (Math.random() < 0.2) out = out.toLowerCase().replace(/[.!]+$/, '');
  return out + pick(TAILS);
}

async function remix() {
  const sources = [['jobs.json', 'results.json'], ['jobs-newest.json', 'results-newest.json']]
    .filter(([j]) => existsSync(file(j)))
    .flatMap(([j, r]) => {
      const results = load(r);
      return load(j).filter((job) => results[job.id]).map((job) => ({ job, thread: results[job.id] }));
    });
  const families = new Map();
  for (let i = 0; i < sources.length; i += 200) {
    const ids = sources.slice(i, i + 200).map((s) => s.job.id);
    const { data, error } = await db.from('jobs').select('id,job_family').in('id', ids);
    if (error) throw error;
    for (const r of data) families.set(r.id, r.job_family);
  }
  documentFrequency = new Map();
  familySpread = new Map();
  for (const { job, thread } of sources) {
    for (const w of new Set(thread.flatMap((c) => wordsOf(c.body)))) {
      documentFrequency.set(w, (documentFrequency.get(w) ?? 0) + 1);
      if (!familySpread.has(w)) familySpread.set(w, new Set());
      familySpread.get(w).add(families.get(job.id) ?? 'none');
    }
  }

  // family → { C: [...], Q: [...], G: [...], pairs: [[parent, reply], ...] }
  const pools = new Map();
  const poolOf = (family) => {
    if (!pools.has(family)) pools.set(family, { C: [], Q: [], G: [], pairs: [] });
    return pools.get(family);
  };
  for (const { job, thread } of sources) {
    const pool = poolOf(families.get(job.id) ?? null);
    const all = poolOf('*');
    thread.forEach((c, i) => {
      if (!isGeneric(c.body, job)) return;
      if (c.kind === 'R') {
        const parent = thread[c.to - 1];
        if (parent && parent.kind !== 'G' && parent.kind !== 'R' && isGeneric(parent.body, job)) {
          pool.pairs.push([parent, c]);
          all.pairs.push([parent, c]);
        }
        return;
      }
      if (c.kind === 'G' && !(c.mood in MOODS)) return;
      pool[c.kind].push(c);
      all[c.kind].push(c);
    });
  }
  const all = poolOf('*');
  all.C.push(...UNIVERSAL_C.map((body) => ({ kind: 'C', body })));
  all.Q.push(...UNIVERSAL_Q.map((body) => ({ kind: 'Q', body })));
  for (const mood of Object.keys(MOODS)) for (const body of UNIVERSAL_CAPTION) all.G.push({ kind: 'G', mood, body });
  for (const [family, p] of pools) {
    console.log(`${String(family).padEnd(16)} C ${p.C.length}  Q ${p.Q.length}  G ${p.G.length}  pairs ${p.pairs.length}`);
    for (const k of ['C', 'Q', 'G', 'pairs']) p[k].sort(() => Math.random() - 0.5);
  }

  // Round-robin cursors, so every line is used once before any is used twice.
  const cursor = new Map();
  const deal = (family, kind, n, avoid, intern) => {
    const p = pools.get(family);
    const list = p && p[kind].length >= 60 ? p[kind] : pools.get('*')[kind];
    const key = `${list === p?.[kind] ? family : '*'}:${kind}`;
    const out = [];
    for (let tries = 0; out.length < n && tries < n * 4; tries++) {
      const at = cursor.get(key) ?? 0;
      cursor.set(key, (at + 1) % list.length);
      const item = list[at];
      const sig = kind === 'pairs' ? item[0].body : kind === 'G' ? `g:${item.mood}` : item.body;
      if (avoid.has(sig) || (!intern && INTERN_ONLY.test(item.body ?? ''))) continue;
      avoid.add(sig);
      out.push(item);
    }
    return out;
  };

  const newest = new Set(existsSync(file('results-newest.json')) ? Object.keys(load('results-newest.json')) : []);
  const results = {};
  for (const t of load('target.json')) {
    if (newest.has(t.id)) continue;
    const avoid = new Set();
    // GIF- and question-heavy: a GIF or "do they sponsor?" recurring across posts is what real
    // threads look like; the same joke twice is not.
    const roots = [
      ...deal(t.family, 'G', 2 + Math.round(Math.random() * 2), avoid, t.intern),
      ...deal(t.family, 'Q', 1 + Math.round(Math.random() * 2), avoid, t.intern),
      ...deal(t.family, 'C', 1 + Math.round(Math.random()), avoid, t.intern),
    ].map((c) => ({ ...c, body: c.kind === 'G' ? c.body : vary(c.body) })).sort(() => Math.random() - 0.5);
    // No replies: Haiku's reply numbering is loose enough that a pair lifted out of its thread
    // often answered a different comment than the one it lands under.
    results[t.id] = roots;
  }
  save('results-remix.json', results);
  const sample = Object.entries(results).slice(0, 3);
  for (const [id, thread] of sample) {
    console.log(`\n=== ${id}`);
    for (const c of thread) console.log(`  ${c.kind}${c.to ?? ''}${c.mood ? `[${c.mood}]` : ''} ${c.body}`);
  }
  console.log(`\n${Object.keys(results).length} remixed threads`);
}

// ── insert ─────────────────────────────────────────────────────────────────────

function likeCount(c) {
  // Mostly a few, sometimes a lot — the shape of a real thread.
  const r = Math.random();
  const base = r < 0.35 ? 0 : r < 0.7 ? between(1, 4) : r < 0.92 ? between(4, 14) : between(14, 40);
  return Math.round(base * (c.kind === 'R' ? 0.5 : 1));
}

async function insert() {
  const accounts = load('accounts.json').map((a) => a.id);
  const pool = load('gifs.json');
  const results = load(process.argv[3] === 'pilot' ? 'pilot.json' : tagged('results.json'));
  // Remixed threads are spread over five times the jobs; lighter likes keep the table small.
  const likeScale = TAG === 'remix' ? 0.5 : 1;
  const byJob = results.results ?? results;
  const jobIds = Object.keys(byJob);

  const seeded = new Set();
  for (let i = 0; i < jobIds.length; i += 200) {
    const { data, error } = await db.from('comments').select('job_id').in('job_id', jobIds.slice(i, i + 200)).in('author_id', accounts);
    if (error) throw error;
    for (const r of data) seeded.add(r.job_id);
  }

  const meta = new Map();
  for (let i = 0; i < jobIds.length; i += 200) {
    const { data, error } = await db.from('jobs').select('id,first_seen_at,status').in('id', jobIds.slice(i, i + 200));
    if (error) throw error;
    for (const r of data) meta.set(r.id, r);
  }

  const roots = [];
  const replies = [];
  const likes = [];
  const now = Date.now();
  for (const jobId of jobIds) {
    const job = meta.get(jobId);
    if (!job || job.status !== 'open' || seeded.has(jobId)) continue;
    const earliest = Math.max(new Date(job.first_seen_at).getTime(), now - 6 * 86_400_000);
    const authors = [...accounts].sort(() => Math.random() - 0.5);
    const ids = [];
    const times = [];
    byJob[jobId].slice(0, 12).forEach((c, idx) => {
      let gif = null;
      if (c.kind === 'G') {
        const list = pool[c.mood] ?? pool.shrug;
        if (!list?.length) return;
        gif = `klipy:${pick(list).slug}`;
      }
      const body = (c.body ?? '').slice(0, 500);
      if (!gif && !body) return;
      const id = randomUUID();
      const author = authors[idx % authors.length];
      const row = { id, job_id: jobId, author_id: author, body, gif_id: gif, moderation_status: 'approved', idempotency_key: `seed:${jobId}:${idx}` };
      if (c.kind === 'R') {
        const parentIdx = c.to - 1;
        const parent = ids[parentIdx];
        if (!parent || parent.reply) return;
        const t = Math.min(now - 60_000, times[parentIdx] + between(5 * 60_000, 20 * 3_600_000));
        replies.push({ ...row, parent_id: parent.id, created_at: new Date(t).toISOString() });
        ids[idx] = { id, reply: true };
        times[idx] = t;
      } else {
        const t = between(earliest, now - 10 * 60_000);
        roots.push({ ...row, created_at: new Date(t).toISOString() });
        ids[idx] = { id, reply: false };
        times[idx] = t;
      }
      const n = Math.min(Math.round(likeCount(c) * likeScale), accounts.length - 1);
      const likers = accounts.filter((a) => a !== author).sort(() => Math.random() - 0.5).slice(0, n);
      for (const user_id of likers) likes.push({ user_id, comment_id: id });
    });
  }

  console.log(`inserting ${roots.length} comments, ${replies.length} replies, ${likes.length} likes`);
  for (const [name, rows, table] of [['roots', roots, 'comments'], ['replies', replies, 'comments'], ['likes', likes, 'comment_likes']]) {
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await db.from(table).insert(rows.slice(i, i + 500));
      if (error) throw new Error(`${name} @${i}: ${error.message}`);
    }
    console.log(`  ${name} done`);
  }

  // Reply and like notifications addressed to seed accounts: nobody reads them.
  const { error: ne } = await db.from('notifications').delete().in('user_id', accounts);
  if (ne) console.warn('notification cleanup:', ne.message);
}

// ── remove ─────────────────────────────────────────────────────────────────────

async function remove() {
  const ids = [];
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    ids.push(...data.users.filter((u) => u.email?.endsWith(`@${SEED_DOMAIN}`)).map((u) => u.id));
    if (data.users.length < 1000) break;
  }
  for (const id of ids) {
    const { error } = await db.auth.admin.deleteUser(id);
    if (error) throw error;
  }
  console.log(`deleted ${ids.length} seed accounts (their comments and likes cascade)`);
}

const steps = { accounts, gifs, target, pilot, generate, collect, remix, insert, remove };
const step = steps[process.argv[2]];
if (!step) {
  console.error(`usage: seed-comments.mjs <${Object.keys(steps).join('|')}>`);
  process.exit(1);
}
await step();
