/**
 * The sectors onboarding asks about, and the companies inside each one.
 *
 * ── Why this exists rather than reading `companies.industry` ───────────────────
 *
 * The corpus's own `industry` values are what each company calls itself: "Model
 * Inference", "Corporate Spend", "Vector Databases", "Retail Investing". Around a hundred
 * distinct labels across 124 companies, most of them held by one or two. That is the
 * right granularity for a company page and the wrong one for a chip somebody taps during
 * their first thirty seconds in the app.
 *
 * So the chips are the curated sectors below, and this file is the mapping. The keys are
 * what `user_preferences.preferred_industries` stores.
 *
 * ── Why a company appears in more than one sector ──────────────────────────────
 *
 * Because it is in more than one sector. Waymo is autonomy and it is transport; a student
 * who taps Robotics and a student who taps Transportation should both find it. The
 * earlier, narrower version of this file partitioned the corpus — every company in
 * exactly one bucket — and the result was that splitting a bucket finer made both halves
 * look empty. Overlap is what lets the list be this long without any chip becoming a dead
 * end. `companiesForSectors` dedupes, so nobody sees a company twice.
 *
 * ── The one chip the corpus cannot back yet ────────────────────────────────────
 *
 * `climate` resolves to a single company. It is here because it is a real thing students
 * filter for and the answer is worth recording for the ranker even while the board list
 * is thin — and because step three backfills from the wider directory, so the follow
 * screen does not strand anyone on one row. It should be the first thing revisited when
 * the board list grows; if it stays at one for long it is better cut than kept.
 *
 * Every other sector resolves to at least two, and most to five or more. Counts are
 * companies on the board list, not open postings — a company's postings move nightly,
 * its sector does not.
 */

export interface Sector {
  /** Stored in `user_preferences.preferred_industries`. Never shown. */
  key: string;
  /** The chip's text. Kept short: these wrap into a grid, and a long label owns a row. */
  label: string;
  /** Company slugs, matching `scripts/board-list.ts` and `companies.slug`. */
  companies: string[];
}

/**
 * Ordered roughly by how many people are likely to want them, because the first screenful
 * is what most people will pick from — the rest is for the ones who scroll.
 */
export const SECTORS: Sector[] = [
  {
    key: 'ai',
    label: 'AI & machine learning',
    companies: [
      'anthropic',
      'openai',
      'cohere',
      'scale-ai',
      'sierra',
      'writer',
      'cresta',
      'decagon',
      'elevenlabs',
      'langchain',
      'lovable',
    ],
  },
  {
    key: 'devtools',
    label: 'Developer tools',
    companies: [
      'gitlab',
      'vercel',
      'replit',
      'warp',
      'sourcegraph',
      'supabase',
      'neon',
      'circleci',
      'launchdarkly',
      'n8n',
      'browserbase',
    ],
  },
  {
    key: 'data',
    label: 'Data & analytics',
    companies: [
      'databricks',
      'mongodb',
      'elastic',
      'fivetran',
      'hex',
      'dataiku',
      'posthog',
      'amplitude',
      'sigma-computing',
      'imply',
      'cockroach-labs',
      'weaviate',
    ],
  },
  {
    key: 'saas',
    label: 'Productivity & collaboration',
    companies: ['linear', 'asana', 'dropbox', 'airtable', 'figma', 'contentful', 'celonis', 'n8n'],
  },
  {
    key: 'fintech',
    label: 'Payments & fintech',
    companies: ['stripe', 'affirm', 'wise', 'ripple', 'tala', 'sardine', 'alloy'],
  },
  {
    key: 'gaming',
    label: 'Gaming',
    companies: ['epic-games', 'riot-games', 'roblox', 'scopely'],
  },
  {
    key: 'security',
    label: 'Cybersecurity',
    companies: [
      'okta',
      'vanta',
      'abnormal',
      'verkada',
      'jamf',
      'secureframe',
      'checkr',
      'alloy',
      'sardine',
    ],
  },
  {
    key: 'social',
    label: 'Social & community',
    companies: ['reddit', 'discord', 'pinterest', 'nextdoor'],
  },
  {
    key: 'ai-infra',
    label: 'AI infrastructure & chips',
    companies: [
      'baseten',
      'modal',
      'fireworks-ai',
      'coreweave',
      'sambanova',
      'graphcore',
      'weaviate',
      'browserbase',
      'scale-ai',
    ],
  },
  {
    key: 'cloud',
    label: 'Cloud & infrastructure',
    companies: [
      'cloudflare',
      'datadog',
      'grafana',
      'pagerduty',
      'twilio',
      'algolia',
      'coreweave',
      'modal',
    ],
  },
  {
    key: 'quant',
    label: 'Quant & trading',
    companies: ['jane-street', 'imc', 'optiver', 'drw'],
  },
  {
    key: 'banking',
    label: 'Banking & lending',
    companies: ['chime', 'monzo', 'mercury', 'sofi', 'brex', 'ramp', 'affirm', 'tala'],
  },
  {
    key: 'investing',
    label: 'Investing & wealth',
    companies: ['robinhood', 'betterment', 'trade-republic', 'carta', 'sofi'],
  },
  {
    key: 'crypto',
    label: 'Crypto & web3',
    companies: ['coinbase', 'gemini', 'ripple'],
  },
  {
    key: 'defense',
    label: 'Defense & public safety',
    companies: ['anduril', 'epirus', 'vannevar-labs', 'axon', 'saronic'],
  },
  {
    key: 'robotics',
    label: 'Robotics & autonomy',
    companies: ['waymo', 'wayve', 'saronic', 'anduril', 'samsara'],
  },
  {
    key: 'space',
    label: 'Aerospace & space',
    companies: ['astranis', 'relativity-space'],
  },
  {
    key: 'mobility',
    label: 'Transportation & mobility',
    companies: ['lyft', 'waymo', 'wayve', 'via', 'motive'],
  },
  {
    key: 'commerce',
    label: 'E-commerce & marketplaces',
    companies: ['faire', 'squarespace', 'instacart', 'doordash', 'klaviyo', 'braze'],
  },
  {
    key: 'delivery',
    label: 'Food & delivery',
    companies: ['doordash', 'instacart', 'deliveroo'],
  },
  {
    key: 'logistics',
    label: 'Logistics & supply chain',
    companies: ['flexport', 'samsara', 'motive'],
  },
  {
    key: 'design',
    label: 'Design & creative tools',
    companies: ['figma', 'contentful', 'squarespace', 'lovable'],
  },
  {
    key: 'marketing',
    label: 'Marketing & growth',
    companies: ['klaviyo', 'braze', 'amplitude', 'unify', 'algolia'],
  },
  {
    key: 'hr',
    label: 'HR & recruiting',
    companies: ['gusto', 'deel', 'lattice', 'handshake', 'checkr', 'carta'],
  },
  {
    key: 'education',
    label: 'Education & learning',
    companies: ['duolingo', 'coursera', 'udemy', 'handshake'],
  },
  {
    key: 'health',
    label: 'Health & biotech',
    companies: ['komodo-health', 'ophelia', 'peloton'],
  },
  {
    key: 'climate',
    label: 'Climate & energy',
    companies: ['sylvera'],
  },
];

/**
 * Company slugs for a set of sector keys, interleaved.
 *
 * Interleaved rather than concatenated: someone who picks AI and Quant should see a
 * trading firm before the eleventh AI company, or the smaller pick may as well not have
 * been made. Deduped, because the sectors overlap on purpose — see the note at the top.
 */
export function companiesForSectors(keys: string[]): string[] {
  const picked = SECTORS.filter((sector) => keys.includes(sector.key));
  if (picked.length === 0) return [];

  const out: string[] = [];
  const longest = Math.max(...picked.map((sector) => sector.companies.length));

  for (let rank = 0; rank < longest; rank += 1) {
    for (const sector of picked) {
      const slug = sector.companies[rank];
      if (slug !== undefined && !out.includes(slug)) out.push(slug);
    }
  }

  return out;
}

/** The smallest number of sectors worth continuing on. One is a feed, none is a blank. */
export const MIN_SECTORS = 1;
