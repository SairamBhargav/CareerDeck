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
 * So the chips are these nine curated sectors, and this file is the mapping. The keys are
 * what `user_preferences.preferred_industries` stores.
 *
 * ── Why the sections in board-list.ts weren't enough ───────────────────────────
 *
 * `scripts/board-list.ts` already groups its companies under comment headers, and those
 * were the obvious source. Two problems with using them directly:
 *
 *  - **"Enterprise and platform" held 57 of the 124.** Not a sector — an unsorted
 *    remainder, with OpenAI, Cohere and CoreWeave filed beside DoorDash, Riot Games and
 *    Wise. Nobody self-identifies into it, and offering it as a chip would have meant
 *    half the corpus behind a label that tells the ranker nothing.
 *  - **Two of the sections were too thin to offer at all.** Security had three companies
 *    and Health & bio had one. A chip that yields one company is worse than no chip: it
 *    promises a feed and delivers a dead end on the first screen.
 *
 * Redistributing the remainder fixes both. Security is seven now and stands on its own;
 * Health & bio is still two and is deliberately absent until the board list grows.
 * Gaming was pulled out because it is four strong names and a real thing students want,
 * not because the count justifies it.
 *
 * Counts below are companies on the board list, not open postings — a company's postings
 * move nightly, its sector does not.
 */

export interface Sector {
  /** Stored in `user_preferences.preferred_industries`. Never shown. */
  key: string;
  /** The chip's text. */
  label: string;
  /** Company slugs, matching `scripts/board-list.ts` and `companies.slug`. */
  companies: string[];
}

export const SECTORS: Sector[] = [
  {
    key: 'ai',
    label: 'AI & research',
    companies: [
      'anthropic', 'openai', 'cohere', 'scale-ai', 'elevenlabs', 'sierra', 'writer',
      'baseten', 'modal', 'langchain', 'fireworks-ai', 'weaviate', 'cresta', 'sambanova',
      'graphcore', 'coreweave', 'decagon',
    ],
  },
  {
    key: 'devtools',
    label: 'Data & dev tools',
    companies: [
      'databricks', 'datadog', 'cloudflare', 'elastic', 'mongodb', 'gitlab', 'vercel',
      'supabase', 'neon', 'posthog', 'grafana', 'replit', 'warp', 'hex', 'fivetran',
      'amplitude', 'twilio', 'cockroach-labs', 'sourcegraph', 'browserbase', 'dataiku',
      'sigma-computing', 'imply', 'algolia', 'contentful', 'circleci', 'launchdarkly',
      'pagerduty', 'n8n', 'unify',
    ],
  },
  {
    key: 'fintech',
    label: 'Fintech & payments',
    companies: [
      'stripe', 'coinbase', 'brex', 'ramp', 'affirm', 'chime', 'gusto', 'mercury', 'sofi',
      'alloy', 'ripple', 'gemini', 'betterment', 'wise', 'monzo', 'trade-republic', 'tala',
      'sardine',
    ],
  },
  {
    key: 'consumer',
    label: 'Consumer & marketplaces',
    companies: [
      'instacart', 'reddit', 'discord', 'pinterest', 'robinhood', 'duolingo', 'lyft',
      'faire', 'peloton', 'doordash', 'squarespace', 'nextdoor', 'deliveroo', 'via',
      'klaviyo', 'braze',
    ],
  },
  {
    key: 'saas',
    label: 'Productivity & SaaS',
    companies: [
      'figma', 'linear', 'asana', 'dropbox', 'airtable', 'carta', 'deel', 'lattice',
      'flexport', 'samsara', 'motive', 'celonis', 'lovable',
    ],
  },
  {
    key: 'hardtech',
    label: 'Hard tech & defense',
    companies: [
      'anduril', 'astranis', 'relativity-space', 'waymo', 'wayve', 'axon',
      'vannevar-labs', 'epirus', 'saronic',
    ],
  },
  {
    key: 'security',
    label: 'Security',
    companies: ['okta', 'vanta', 'abnormal', 'verkada', 'jamf', 'secureframe', 'checkr'],
  },
  {
    key: 'gaming',
    label: 'Gaming',
    companies: ['epic-games', 'riot-games', 'scopely', 'roblox'],
  },
  {
    key: 'quant',
    label: 'Quant & trading',
    companies: ['jane-street', 'imc', 'optiver', 'drw'],
  },
];

/**
 * Company slugs for a set of sector keys, most-represented sector first.
 *
 * Interleaved rather than concatenated: someone who picks AI and Quant should see a
 * trading firm before the seventeenth AI company, or the smaller pick may as well not
 * have been made.
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
