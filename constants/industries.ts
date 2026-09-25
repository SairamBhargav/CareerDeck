/**
 * The fields onboarding asks about, and the companies behind each one.
 *
 * ── What these labels are ──────────────────────────────────────────────────────
 *
 * They are fields of study and work — the words a student already uses for what they do,
 * from "Software Development" to "Public Health". Deliberately not the corpus's own
 * `companies.industry` values, which are what each company calls itself ("Model
 * Inference", "Corporate Spend", "Vector Databases"): around a hundred labels across 124
 * companies, most held by one or two. That is the right granularity for a company page
 * and an unanswerable question to put in front of someone in their first thirty seconds.
 *
 * The keys are what `user_preferences.preferred_industries` stores. They are stable; the
 * labels can be reworded without a migration.
 *
 * ── Why a company appears under several fields ─────────────────────────────────
 *
 * Because it belongs to several. Anduril is engineering, government and manufacturing; a
 * student who taps any of those should find it. An earlier version of this file
 * partitioned the corpus — every company in exactly one bucket — which is why splitting a
 * bucket finer always left both halves looking empty. `companiesForSectors` dedupes, so
 * nobody sees a company twice.
 *
 * ── Fields the board list cannot back yet ──────────────────────────────────────
 *
 * The board list is 124 tech employers (see `scripts/board-list.ts`), so fields that sit
 * outside tech resolve to few companies or none. Pharmaceuticals, Construction
 * Management, Event Management, Agriculture, Real Estate and Nonprofit Work have no match
 * at all; Biotechnology, Environmental Science, Sustainability and Sports Management
 * resolve to one each. A few others — Law, Journalism, Architecture, Hospitality,
 * Tourism, Food Science — are honest stretches rather than real matches.
 *
 * They are offered anyway, for two reasons. The answer is recorded either way and is
 * worth having, both for the ranker and for deciding which employers to add next; and
 * step three backfills from the wider directory, so picking one of them strands nobody on
 * an empty follow screen. If the board list stays tech-only, the empty ones are better
 * cut than kept — but that is a product call, not a code one.
 *
 * Counts are companies on the board list, not open postings — a company's postings move
 * nightly, its field does not.
 */

export interface Sector {
  /** Stored in `user_preferences.preferred_industries`. Never shown. */
  key: string;
  /** The chip's text. */
  label: string;
  /**
   * Company slugs, matching `scripts/board-list.ts` and `companies.slug`. Empty where the
   * board list has nothing in that field yet — see the note above.
   */
  companies: string[];
}

/**
 * Grouped by family, and ordered so the broadest fields come first. The chips wrap into a
 * centred cluster, so this order decides the first screenful — which is all most people
 * will read before picking.
 */
export const SECTORS: Sector[] = [
  // ── Technology ───────────────────────────────────────────────────────────────
  {
    key: 'technology',
    label: 'Technology',
    companies: [
      'cloudflare', 'datadog', 'mongodb', 'elastic', 'twilio', 'gitlab', 'vercel', 'databricks',
      'dropbox', 'figma', 'linear', 'airtable',
    ],
  },
  {
    key: 'software-development',
    label: 'Software Development',
    companies: [
      'gitlab', 'vercel', 'replit', 'warp', 'sourcegraph', 'supabase', 'neon', 'circleci',
      'launchdarkly', 'browserbase', 'n8n', 'cockroach-labs',
    ],
  },
  {
    key: 'data-science',
    label: 'Data Science',
    companies: [
      'databricks', 'dataiku', 'hex', 'sigma-computing', 'fivetran', 'posthog', 'amplitude',
      'imply', 'elastic', 'mongodb', 'weaviate',
    ],
  },
  {
    key: 'artificial-intelligence',
    label: 'Artificial Intelligence',
    companies: [
      'anthropic', 'openai', 'cohere', 'scale-ai', 'sierra', 'writer', 'cresta', 'decagon',
      'elevenlabs', 'langchain', 'baseten', 'modal', 'fireworks-ai', 'coreweave', 'sambanova',
      'graphcore', 'lovable',
    ],
  },
  {
    key: 'cybersecurity',
    label: 'Cybersecurity',
    companies: [
      'okta', 'vanta', 'abnormal', 'verkada', 'jamf', 'secureframe', 'checkr', 'sardine', 'alloy',
    ],
  },
  {
    key: 'information-technology',
    label: 'Information Technology',
    companies: ['jamf', 'okta', 'pagerduty', 'datadog', 'grafana', 'cloudflare', 'gitlab'],
  },
  {
    key: 'engineering',
    label: 'Engineering',
    companies: [
      'anduril', 'relativity-space', 'astranis', 'epirus', 'saronic', 'waymo', 'wayve', 'axon',
      'samsara', 'motive',
    ],
  },

  // ── Business and finance ─────────────────────────────────────────────────────
  {
    key: 'business-management',
    label: 'Business Management',
    companies: ['celonis', 'asana', 'linear', 'lattice', 'samsara', 'carta'],
  },
  {
    key: 'business-operations',
    label: 'Business Operations',
    companies: ['celonis', 'asana', 'motive', 'samsara', 'flexport', 'n8n'],
  },
  {
    key: 'finance',
    label: 'Finance',
    companies: [
      'stripe', 'brex', 'ramp', 'affirm', 'sofi', 'mercury', 'carta', 'betterment', 'robinhood',
      'wise', 'coinbase', 'ripple', 'gemini', 'jane-street', 'imc', 'optiver', 'drw',
    ],
  },
  {
    key: 'banking',
    label: 'Banking',
    companies: ['chime', 'monzo', 'mercury', 'sofi', 'brex', 'ramp', 'tala', 'trade-republic'],
  },
  {
    key: 'accounting',
    label: 'Accounting',
    companies: ['brex', 'ramp', 'carta', 'gusto'],
  },

  // ── Marketing, media and creative ────────────────────────────────────────────
  {
    key: 'marketing',
    label: 'Marketing',
    companies: ['klaviyo', 'braze', 'amplitude', 'unify', 'algolia'],
  },
  {
    key: 'advertising',
    label: 'Advertising',
    companies: ['klaviyo', 'braze', 'reddit', 'pinterest'],
  },
  {
    key: 'sales',
    label: 'Sales',
    companies: ['unify', 'cresta', 'decagon', 'braze', 'klaviyo', 'faire'],
  },
  {
    key: 'communications',
    label: 'Communications',
    companies: ['twilio', 'discord', 'elevenlabs', 'sierra', 'reddit'],
  },
  {
    key: 'journalism',
    label: 'Journalism',
    companies: ['reddit', 'contentful', 'nextdoor'],
  },
  {
    key: 'media-production',
    label: 'Media Production',
    companies: ['elevenlabs', 'epic-games', 'riot-games', 'roblox', 'contentful', 'scopely'],
  },
  {
    key: 'arts',
    label: 'Arts',
    companies: ['figma', 'roblox', 'epic-games', 'squarespace', 'contentful'],
  },
  {
    key: 'design',
    label: 'Design',
    companies: ['figma', 'contentful', 'squarespace', 'lovable'],
  },

  // ── Health ───────────────────────────────────────────────────────────────────
  {
    key: 'healthcare',
    label: 'Healthcare',
    companies: ['komodo-health', 'ophelia'],
  },
  {
    key: 'medicine',
    label: 'Medicine',
    companies: ['ophelia', 'komodo-health'],
  },
  {
    key: 'public-health',
    label: 'Public Health',
    companies: ['komodo-health', 'ophelia'],
  },
  {
    key: 'biotechnology',
    label: 'Biotechnology',
    companies: ['komodo-health'],
  },
  {
    key: 'pharmaceuticals',
    label: 'Pharmaceuticals',
    companies: [],
  },

  // ── Law, policy and government ───────────────────────────────────────────────
  {
    key: 'law',
    label: 'Law',
    companies: ['vanta', 'secureframe', 'alloy', 'checkr', 'carta'],
  },
  {
    key: 'public-policy',
    label: 'Public Policy',
    companies: ['sylvera', 'axon', 'vannevar-labs'],
  },
  {
    key: 'government',
    label: 'Government',
    companies: ['anduril', 'axon', 'vannevar-labs', 'epirus', 'saronic'],
  },
  {
    key: 'international-affairs',
    label: 'International Affairs',
    companies: ['wise', 'monzo', 'deel', 'trade-republic', 'deliveroo'],
  },

  // ── Education, social and science ────────────────────────────────────────────
  {
    key: 'education',
    label: 'Education',
    companies: ['duolingo', 'coursera', 'udemy', 'handshake'],
  },
  {
    key: 'psychology',
    label: 'Psychology',
    companies: ['ophelia', 'lattice'],
  },
  {
    key: 'social-work',
    label: 'Social Work',
    companies: ['ophelia', 'nextdoor'],
  },
  {
    key: 'scientific-research',
    label: 'Scientific Research',
    companies: ['anthropic', 'openai', 'cohere', 'graphcore', 'sambanova', 'komodo-health'],
  },
  {
    key: 'environmental-science',
    label: 'Environmental Science',
    companies: ['sylvera'],
  },
  {
    key: 'sustainability',
    label: 'Sustainability',
    companies: ['sylvera'],
  },

  // ── Built environment, industry and logistics ────────────────────────────────
  {
    key: 'architecture',
    label: 'Architecture',
    companies: ['figma', 'squarespace'],
  },
  {
    key: 'construction-management',
    label: 'Construction Management',
    companies: [],
  },
  {
    key: 'manufacturing',
    label: 'Manufacturing',
    companies: ['relativity-space', 'anduril', 'epirus', 'saronic', 'astranis'],
  },
  {
    key: 'supply-chain',
    label: 'Supply Chain',
    companies: ['flexport', 'samsara', 'motive'],
  },
  {
    key: 'logistics',
    label: 'Logistics',
    companies: ['flexport', 'motive', 'samsara', 'deliveroo', 'doordash', 'instacart'],
  },
  {
    key: 'human-resources',
    label: 'Human Resources',
    companies: ['gusto', 'deel', 'lattice', 'handshake', 'checkr'],
  },

  // ── Service, leisure and land ────────────────────────────────────────────────
  {
    key: 'hospitality',
    label: 'Hospitality',
    companies: ['deliveroo', 'doordash'],
  },
  {
    key: 'tourism',
    label: 'Tourism',
    companies: ['via', 'lyft'],
  },
  {
    key: 'event-management',
    label: 'Event Management',
    companies: [],
  },
  {
    key: 'sports-management',
    label: 'Sports Management',
    companies: ['peloton'],
  },
  {
    key: 'agriculture',
    label: 'Agriculture',
    companies: [],
  },
  {
    key: 'food-science',
    label: 'Food Science',
    companies: ['instacart', 'doordash', 'deliveroo'],
  },
  {
    key: 'real-estate',
    label: 'Real Estate',
    companies: [],
  },
  {
    key: 'nonprofit-work',
    label: 'Nonprofit Work',
    companies: [],
  },
];

/**
 * Company slugs for a set of field keys, interleaved.
 *
 * Interleaved rather than concatenated: someone who picks Artificial Intelligence and
 * Accounting should see a spend-management company before the eleventh AI lab, or the
 * smaller pick may as well not have been made. Deduped, because the fields overlap on
 * purpose — see the note at the top.
 *
 * Returns nothing when every pick is a field the board list cannot back yet. Step three
 * handles that the same way it handles a short list: by backfilling from the wider
 * directory.
 */
export function companiesForSectors(keys: string[]): string[] {
  const picked = SECTORS.filter((sector) => keys.includes(sector.key));
  if (picked.length === 0) return [];

  const out: string[] = [];
  // Seeded with 0 so a pick of only empty fields yields an empty list, not -Infinity.
  const longest = Math.max(...picked.map((sector) => sector.companies.length), 0);

  for (let rank = 0; rank < longest; rank += 1) {
    for (const sector of picked) {
      const slug = sector.companies[rank];
      if (slug !== undefined && !out.includes(slug)) out.push(slug);
    }
  }

  return out;
}

/** The smallest number of fields worth continuing on. One is a feed, none is a blank. */
export const MIN_SECTORS = 1;
