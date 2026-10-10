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
      'google', 'apple', 'microsoft', 'amazon', 'meta', 'tiktok', 'palantir',
      'nvidia', 'salesforce', 'adobe',
      'cloudflare', 'datadog', 'mongodb', 'elastic', 'twilio', 'gitlab', 'vercel', 'databricks',
      'dropbox', 'figma', 'linear', 'airtable',
    ],
  },
  {
    key: 'software-development',
    label: 'Software Development',
    companies: [
      'google', 'microsoft', 'palantir', 'autodesk', 'bytedance',
      'salesforce', 'adobe',
      'gitlab', 'vercel', 'replit', 'warp', 'sourcegraph', 'supabase', 'neon', 'circleci',
      'launchdarkly', 'browserbase', 'n8n', 'cockroach-labs',
    ],
  },
  {
    key: 'data-science',
    label: 'Data Science',
    companies: [
      'google', 'palantir', 'micron-technology',
      'nvidia',
      'databricks', 'dataiku', 'hex', 'sigma-computing', 'fivetran', 'posthog', 'amplitude',
      'imply', 'elastic', 'mongodb', 'weaviate',
    ],
  },
  {
    key: 'artificial-intelligence',
    label: 'Artificial Intelligence',
    companies: [
      'google', 'meta', 'apple', 'tiktok',
      'nvidia',
      'anthropic', 'openai', 'cohere', 'scale-ai', 'sierra', 'writer', 'cresta', 'decagon',
      'elevenlabs', 'langchain', 'baseten', 'modal', 'fireworks-ai', 'coreweave', 'sambanova',
      'graphcore', 'lovable',
    ],
  },
  {
    key: 'cybersecurity',
    label: 'Cybersecurity',
    companies: [
      'palantir', 'booz-allen', 'leidos',
      'okta', 'vanta', 'abnormal', 'verkada', 'jamf', 'secureframe', 'checkr', 'sardine', 'alloy',
      'northern-trust', 'ensign-bickford-aerospace-defense-company',
    ],
  },
  {
    key: 'information-technology',
    label: 'Information Technology',
    companies: [
      'microsoft', 'booz-allen', 'general-dynamics-information-technology',
      'salesforce', 'workday', 'adobe','jamf', 'okta', 'pagerduty', 'datadog', 'grafana', 'cloudflare', 'gitlab',
      'l3harris-technologies', 'keysight-technologies',
    ],
  },
  {
    key: 'engineering',
    label: 'Engineering',
    companies: [
      'amd', 'texas-instruments', 'qualcomm', 'intel', 'micron-technology', 'marvell', 'analog-devices', 'l3harris-technologies', 'rtx', 'spacex', 'blueorigin', 'boeing', 'northrop-grumman', 'tesla', 'waymo',
      'nvidia',
      'anduril', 'relativity-space', 'astranis', 'epirus', 'saronic', 'waymo', 'wayve', 'axon',
      'samsara', 'motive',
    ],
  },

  // ── Business and finance ─────────────────────────────────────────────────────
  {
    key: 'business-management',
    label: 'Business Management',
    companies: [
      'booz-allen',
      'workday', 'salesforce','celonis', 'asana', 'linear', 'lattice', 'samsara', 'carta',
      'susquehanna-international-group-sig', 'meridian-partners', 'citizens-financial-group', 'cigna-group', 'western-southern-financial-group', 'avis-budget-group',
    ],
  },
  {
    key: 'business-operations',
    label: 'Business Operations',
    companies: [
      'booz-allen', 'emerson-electric',
      'salesforce', 'workday','celonis', 'asana', 'motive', 'samsara', 'flexport', 'n8n',
      'susquehanna-international-group-sig', 'national-information-solutions-cooperative', 'citizens-financial-group', 'cigna-group', 'allied-solutions',
    ],
  },
  {
    key: 'finance',
    label: 'Finance',
    companies: [
      'goldman-sachs', 'jump-trading', 'drw', 'optiver', 'blackrock', 'jane-street', 'citadel-securities', 'blackrock', 'american-express', 'fidelity-investments', 'jump-trading', 'susquehanna-international-group-sig',
      'capital-one', 'mastercard', 'paypal',
      'stripe', 'brex', 'ramp', 'affirm', 'sofi', 'mercury', 'carta', 'betterment', 'robinhood',
      'wise', 'coinbase', 'ripple', 'gemini', 'jane-street', 'imc', 'optiver', 'drw',
    ],
  },
  {
    key: 'banking',
    label: 'Banking',
    companies: [
      'goldman-sachs', 'royal-bank-of-canada', 'citizens-financial-group', 'navy-federal',
      'capital-one','chime', 'monzo', 'mercury', 'sofi', 'brex', 'ramp', 'tala', 'trade-republic',
      'manulife-financial', 'first-national-bank',
    ],
  },
  {
    key: 'accounting',
    label: 'Accounting',
    companies: [
      'american-express', 'fidelity-investments','brex', 'ramp', 'carta', 'gusto',
      'manulife-financial', 'citizens-financial-group', 'gm-financial', 'western-southern-financial-group', 'definity-financial', 'virtu-financial', 'compeer-financial', 'principal-financial-group', 'lpl-financial-holdings',
    ],
  },

  // ── Marketing, media and creative ────────────────────────────────────────────
  {
    key: 'marketing',
    label: 'Marketing',
    companies: [
      'procter-gamble', 'nike',
      'adobe', 'salesforce','klaviyo', 'braze', 'amplitude', 'unify', 'algolia',
      'fortune-brands', 'marquee-brands',
    ],
  },
  {
    key: 'advertising',
    label: 'Advertising',
    companies: [
      'tiktok', 'publicis-groupe',
      'adobe','klaviyo', 'braze', 'reddit', 'pinterest',
      'fortune-brands', 'marquee-brands',
    ],
  },
  {
    key: 'sales',
    label: 'Sales',
    companies: [
      'american-express', 'procter-gamble',
      'salesforce','unify', 'cresta', 'decagon', 'braze', 'klaviyo', 'faire',
      'commercial-metals',
    ],
  },
  {
    key: 'communications',
    label: 'Communications',
    companies: [
      'tiktok', 'meta', 'the-walt-disney-company','twilio', 'discord', 'elevenlabs', 'sierra', 'reddit',
      'palo-alto-networks', 'verizon-communications', 'kepler-communications', 'arista-networks', 'iridium-communications',
    ],
  },
  {
    key: 'journalism',
    label: 'Journalism',
    companies: [
      'fox', 'newsbreak', 'the-walt-disney-company','reddit', 'contentful', 'nextdoor'],
  },
  {
    key: 'media-production',
    label: 'Media Production',
    companies: [
      'the-walt-disney-company', 'netflix', 'sony-interactive-entertainment',
      'adobe','elevenlabs', 'epic-games', 'riot-games', 'roblox', 'contentful', 'scopely',
      'haven-studios',
    ],
  },
  {
    key: 'arts',
    label: 'Arts',
    companies: [
      'the-walt-disney-company', 'autodesk',
      'adobe','figma', 'roblox', 'epic-games', 'squarespace', 'contentful',
      'cadence-design-systems', 'electronic-arts', 'haven-studios', 'sony-interactive-entertainment',
    ],
  },
  {
    key: 'design',
    label: 'Design',
    companies: [
      'autodesk', 'the-walt-disney-company',
      'adobe','figma', 'contentful', 'squarespace', 'lovable',
      'cadence-design-systems', 'fortune-brands', 'haven-studios', 'marquee-brands',
    ],
  },

  // ── Health ───────────────────────────────────────────────────────────────────
  {
    key: 'healthcare',
    label: 'Healthcare',
    companies: [
      'johnson-johnson', 'stryker', 'medtronic', 'boston-scientific', 'ge-healthcare','komodo-health', 'ophelia',
      'ensemble-health-partners', 'bjc-healthcare', 'calpion-plutus-health', 'cardinal-health', 'charta-health', 'cooper-university-health-care', 'garner-health', 'jefferson-health',
    ],
  },
  {
    key: 'medicine',
    label: 'Medicine',
    companies: [
      'johnson-johnson', 'merck', 'stryker', 'medtronic','ophelia', 'komodo-health',
      'ensemble-health-partners', 'calpion-plutus-health', 'cardinal-health', 'charta-health', 'clinical-ink', 'cooper-university-health-care', 'garner-health', 'jefferson-health', 'medical-informatics-engineering',
    ],
  },
  {
    key: 'public-health',
    label: 'Public Health',
    companies: [
      'johnson-johnson', 'merck', 'ge-healthcare','komodo-health', 'ophelia',
      'ensemble-health-partners', 'bjc-healthcare', 'calpion-plutus-health', 'cardinal-health', 'charta-health', 'cooper-university-health-care', 'garner-health', 'jefferson-health', 'medical-informatics-engineering', 'nerv-technology-inc-d-b-a-fluidai-medical',
    ],
  },
  {
    key: 'biotechnology',
    label: 'Biotechnology',
    companies: [
      'amgen', 'moderna', 'merck', 'bio-techne','komodo-health',
      'output-biosciences', 'xaira-therapeutics',
    ],
  },
  {
    key: 'pharmaceuticals',
    label: 'Pharmaceuticals',
    companies: [
      'merck', 'amgen', 'moderna', 'johnson-johnson',
      'kite-pharma', 'xaira-therapeutics',
    ],
  },

  // ── Law, policy and government ───────────────────────────────────────────────
  {
    key: 'law',
    label: 'Law',
    companies: [
      'lexisnexis-legal-professional','vanta', 'secureframe', 'alloy', 'checkr', 'carta'],
  },
  {
    key: 'public-policy',
    label: 'Public Policy',
    companies: [
      'booz-allen', 'johns-hopkins-applied-physics-laboratory','sylvera', 'axon', 'vannevar-labs',
      'national-information-solutions-cooperative', 'first-national-bank', 'lawrence-livermore-national-laboratory-llnl', 'national-laboratory-of-the-rockies', 'toyota-research-institute', 'national-life', 'sdsu-research-foundation', 'foundation', 'foundation-finance', 'institute-of-foundation-models',
    ],
  },
  {
    key: 'government',
    label: 'Government',
    companies: [
      'johns-hopkins-applied-physics-laboratory', 'booz-allen', 'leidos', 'lawrence-livermore-national-laboratory-llnl', 'l3harris-technologies', 'rtx', 'northrop-grumman', 'general-dynamics-mission-systems','anduril', 'axon', 'vannevar-labs', 'epirus', 'saronic',
      'navy-federal', 'national-information-solutions-cooperative',
    ],
  },
  {
    key: 'international-affairs',
    label: 'International Affairs',
    companies: [
      'goldman-sachs', 'royal-bank-of-canada', 'american-express','wise', 'monzo', 'deel', 'trade-republic', 'deliveroo',
      'susquehanna-international-group-sig', 'lennox-international', 'edison-international', 'susquehanna-international-group', 'twg-global', 'dallas-fort-worth-international-airport', 'asm-global',
    ],
  },

  // ── Education, social and science ────────────────────────────────────────────
  {
    key: 'education',
    label: 'Education',
    companies: [
      'pennsylvania-state-university', 'arizona-state-university', 'university-of-rochester','duolingo', 'coursera', 'udemy', 'handshake',
      'akuna-capital-university', 'university-of-texas-at-austin', 'ivy-tech-community-college', 'mercer-university', 'prairie-view-a-m-university', 'texas-a-m-international-university', 'texas-a-m-university-system', 'university-of-arkansas',
    ],
  },
  {
    key: 'psychology',
    label: 'Psychology',
    companies: ['ophelia', 'lattice'],
  },
  {
    key: 'social-work',
    label: 'Social Work',
    companies: ['ophelia', 'nextdoor',
      'cole-engineering-services', 'greatamerica-financial-services', 'ivy-tech-community-college', 'sdsu-research-foundation', 'cooper-university-health-care', 'coretek-services', 'foundation', 'foundation-finance', 'hays-electrical-services', 'herzog-railroad-services', 'institute-of-foundation-models', 'pnc-financial-services', 'universal-health-services',
    ],
  },
  {
    key: 'scientific-research',
    label: 'Scientific Research',
    companies: [
      'lawrence-livermore-national-laboratory-llnl', 'johns-hopkins-applied-physics-laboratory', 'pacific-northwest-national-laboratory', 'amgen', 'moderna','anthropic', 'openai', 'cohere', 'graphcore', 'sambanova', 'komodo-health',
      'g-research', 'tower-research-capital', 'national-laboratory-of-the-rockies', 'seven-research',
    ],
  },
  {
    key: 'environmental-science',
    label: 'Environmental Science',
    companies: [
      'ge-vernova', 'xcel-energy', 'fervo-energy', 'constellation-energy','sylvera',
      'dominion-energy', 'energy-transfer-partners', 'zurn-elkay-water-solutions', 'advanced-energy', 'rodan-energy-solutions', 'watts-water', 'peak-energy', 'tc-energy', 'wec-energy-group', 'cenovus-energy',
    ],
  },
  {
    key: 'sustainability',
    label: 'Sustainability',
    companies: [
      'ge-vernova', 'xcel-energy', 'fervo-energy', 'the-nuclear-company','sylvera',
      'dominion-energy', 'constellation-energy', 'energy-transfer-partners', 'advanced-energy', 'rodan-energy-solutions', 'peak-energy', 'tc-energy', 'wec-energy-group', 'antares-nuclear', 'cenovus-energy',
    ],
  },

  // ── Built environment, industry and logistics ────────────────────────────────
  {
    key: 'architecture',
    label: 'Architecture',
    companies: ['figma', 'squarespace',
      'cadence-design-systems', 'schweitzer-engineering-laboratories', 'apogee-engineering', 'cole-engineering-services', 'bird-construction', 'hoffman-construction', 'medical-informatics-engineering', 'north-american-construction-group',
    ],
  },
  {
    key: 'construction-management',
    label: 'Construction Management',
    companies: [
      'bird-construction', 'hoffman-construction', 'north-american-construction-group',
    ],
  },
  {
    key: 'manufacturing',
    label: 'Manufacturing',
    companies: [
      'emerson-electric', 'ge-vernova', 'oshkosh', 'vertiv', 'garmin', 'micron-technology','relativity-space', 'anduril', 'epirus', 'saronic', 'astranis',
      'north-atlantic-industries', 'westinghouse-electric-company', 'applied-materials', 'koch-industries',
    ],
  },
  {
    key: 'supply-chain',
    label: 'Supply Chain',
    companies: [
      'amazon', 'walmart', 'procter-gamble','flexport', 'samsara', 'motive',
      'direct-supply', 'dayton-freight-lines', 'hd-supply',
    ],
  },
  {
    key: 'logistics',
    label: 'Logistics',
    companies: [
      'amazon', 'walmart', 'oshkosh','flexport', 'motive', 'samsara', 'deliveroo', 'doordash', 'instacart',
      'dayton-freight-lines',
    ],
  },
  {
    key: 'human-resources',
    label: 'Human Resources',
    companies: [
      'american-express',
      'workday','gusto', 'deel', 'lattice', 'handshake', 'checkr'],
  },

  // ── Service, leisure and land ────────────────────────────────────────────────
  {
    key: 'hospitality',
    label: 'Hospitality',
    companies: [
      'the-walt-disney-company','deliveroo', 'doordash'],
  },
  {
    key: 'tourism',
    label: 'Tourism',
    companies: [
      'the-walt-disney-company', 'republic-airways','via', 'lyft'],
  },
  {
    key: 'event-management',
    label: 'Event Management',
    companies: [
      'sony-interactive-entertainment',
    ],
  },
  {
    key: 'sports-management',
    label: 'Sports Management',
    companies: [
      'nike','peloton'],
  },
  {
    key: 'agriculture',
    label: 'Agriculture',
    companies: [
      'farm-credit-canada',
      'state-farm',
    ],
  },
  {
    key: 'food-science',
    label: 'Food Science',
    companies: [
      'procter-gamble','instacart', 'doordash', 'deliveroo',
      'gordon-food-service', 'us-foods', 'fortune-brands', 'hormel-foods', 'tyson-foods', 'empirical-foods', 'marquee-brands',
    ],
  },
  {
    key: 'real-estate',
    label: 'Real Estate',
    companies: [
      'first-national-bank',
      'perry-homes', 'gables-residential',
    ],
  },
  {
    key: 'nonprofit-work',
    label: 'Nonprofit Work',
    companies: [
      'toyota-research-institute', 'sdsu-research-foundation', 'foundation', 'foundation-finance', 'institute-of-foundation-models',
    ],
  },

  // ── Onboarding v2 (20261038000000) ───────────────────────────────────────────
  // Finer fields for the three areas the corpus actually covers. Each has a row in
  // `sector_families`; the slugs were checked against hosted `companies` on 2026-10-10.
  {
    key: 'cloud-infrastructure',
    label: 'Cloud & Infrastructure',
    companies: [
      'cloudflare', 'datadog', 'coreweave', 'vercel', 'gitlab', 'grafana', 'snowflake', 'supabase',
      'amazon', 'google', 'microsoft',
    ],
  },
  {
    key: 'electrical-engineering',
    label: 'Electrical Engineering',
    companies: [
      'texas-instruments', 'analog-devices', 'qualcomm', 'marvell', 'keysight-technologies', 'tesla',
      'emerson-electric', 'applied-materials', 'kla', 'honeywell',
    ],
  },
  {
    key: 'computer-hardware',
    label: 'Computer Hardware',
    companies: [
      'nvidia', 'amd', 'intel', 'micron-technology', 'marvell', 'qualcomm', 'applied-materials', 'kla',
    ],
  },
  {
    key: 'mechanical-engineering',
    label: 'Mechanical Engineering',
    companies: [
      'tesla', 'rivian', 'general-motors', 'caterpillar', 'anduril', 'saronic', 'spacex', 'relativity-space',
      'boeing', 'honeywell', '3m',
    ],
  },
  {
    key: 'aerospace-engineering',
    label: 'Aerospace Engineering',
    companies: [
      'spacex', 'relativity-space', 'astranis', 'blueorigin', 'boeing', 'ge-aerospace', 'rtx',
      'northrop-grumman', 'lockheed', 'l3harris-technologies', 'anduril', 'skydio', 'shield-ai',
    ],
  },
  {
    key: 'robotics',
    label: 'Robotics',
    companies: ['tesla', 'waymo', 'zoox', 'anduril', 'skydio', 'saronic', 'wayve', 'intuitive-surgical', 'shield-ai'],
  },
  {
    // A stretch: the corpus has no civil firm yet. These hire civil engineers for plants,
    // sites and heavy equipment, which is honest enough to follow.
    key: 'civil-engineering',
    label: 'Civil Engineering',
    companies: ['caterpillar', 'honeywell', '3m', 'tesla'],
  },
  {
    // Also a stretch: fabs and materials are where chemical engineers land in this corpus.
    key: 'chemical-engineering',
    label: 'Chemical Engineering',
    companies: ['3m', 'applied-materials', 'micron-technology', 'intel', 'tesla'],
  },
  {
    key: 'industrial-engineering',
    label: 'Industrial Engineering',
    companies: [
      'tesla', 'general-motors', 'caterpillar', 'emerson-electric', 'honeywell', 'flexport', 'samsara',
      'motive', 'oshkosh',
    ],
  },
  {
    key: 'quant-trading',
    label: 'Quant & Trading',
    companies: [
      'jane-street', 'citadel-securities', 'drw', 'optiver', 'jump-trading', 'imc',
      'susquehanna-international-group-sig',
    ],
  },
  {
    key: 'fintech',
    label: 'Fintech',
    companies: [
      'stripe', 'ramp', 'robinhood', 'coinbase', 'affirm', 'sofi', 'chime', 'brex', 'paypal', 'mercury',
      'wise', 'ripple',
    ],
  },
  {
    key: 'consulting',
    label: 'Consulting',
    companies: ['deloitte', 'accenture', 'booz-allen'],
  },
  {
    key: 'product-management',
    label: 'Product Management',
    companies: ['linear', 'asana', 'figma', 'salesforce', 'workday', 'google', 'microsoft', 'stripe', 'ramp'],
  },
];

/**
 * What the onboarding interests step offers, in the order its bubbles float.
 *
 * Twenty-one of the sectors above, with labels short enough for a bubble. The rest of
 * SECTORS stays: everyone who onboarded on the old forty-field grid has those keys stored,
 * and `companiesForSectors` and `sector_families` still have to read them.
 *
 * Shuffled across the three areas on purpose. Grouped, the screen reads as a form with
 * three sections; mixed, it reads as one cloud to pick from.
 */
export const INTERESTS: { key: string; label: string }[] = [
  { key: 'software-development', label: 'Software Engineering' },
  { key: 'finance', label: 'Finance' },
  { key: 'aerospace-engineering', label: 'Aerospace' },
  { key: 'artificial-intelligence', label: 'AI & ML' },
  { key: 'quant-trading', label: 'Quant & Trading' },
  { key: 'mechanical-engineering', label: 'Mechanical' },
  { key: 'data-science', label: 'Data Science' },
  { key: 'electrical-engineering', label: 'Electrical' },
  { key: 'fintech', label: 'Fintech' },
  { key: 'cybersecurity', label: 'Cybersecurity' },
  { key: 'consulting', label: 'Consulting' },
  { key: 'robotics', label: 'Robotics' },
  { key: 'banking', label: 'Banking' },
  { key: 'cloud-infrastructure', label: 'Cloud & Infra' },
  { key: 'computer-hardware', label: 'Computer Hardware' },
  { key: 'product-management', label: 'Product' },
  { key: 'civil-engineering', label: 'Civil' },
  { key: 'accounting', label: 'Accounting' },
  { key: 'industrial-engineering', label: 'Industrial' },
  { key: 'business-operations', label: 'Operations' },
  { key: 'chemical-engineering', label: 'Chemical' },
];

/**
 * How many companies a single field contributes.
 *
 * Picking two fields should give fifteen from each, alternating, rather than thirty
 * from whichever field happens to be listed longer. The cap is what makes the
 * interleave fair in both directions: without it a field with seventeen entries
 * quietly outweighs one with four.
 */
export const PER_FIELD = 15;
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
  const longest = Math.min(PER_FIELD, Math.max(...picked.map((f) => f.companies.length), 0));

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
