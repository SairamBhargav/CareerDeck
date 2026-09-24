/*
 * The curated board list — PHASE1.md §9.
 *
 * Every row becomes a `companies` row and a `job_sources` row in supabase/seed.sql. It is
 * seeded data rather than a constant in the crawler because §4.3 needs adding a company to
 * be an insert and removing one — a takedown — to be `enabled = false` plus a note, not a
 * code change and a deploy.
 *
 * Chosen for this audience: employers that actually run internship and new-grad programs,
 * weighted toward the startup and mid-market tech companies where §4.2 says Greenhouse,
 * Lever and Ashby give near-complete coverage. Notably absent are the household names that
 * run Workday — NVIDIA, Apple, Amazon, Boeing, Lockheed — which §4.2 explicitly defers:
 * "Workday is where a quarter disappears." Those companies still exist in the app as
 * `companies` rows seeded from the fixtures; they simply have no source attached yet.
 *
 * `token` is the board identifier in that ATS's URL space:
 *   greenhouse  boards-api.greenhouse.io/v1/boards/<token>/jobs
 *   lever       api.lever.co/v0/postings/<token>
 *   ashby       api.ashbyhq.com/posting-api/job-board/<token>
 *
 * Tokens are guesses until a crawl proves them. A wrong one 404s, which is not retried,
 * increments that source's failure counter and shows up in the run summary — so the list
 * is maintained by running it, not by trusting it. Anything still failing after a full
 * pass belongs out of this file.
 */

export type BoardKind = 'greenhouse' | 'lever' | 'ashby';

export interface BoardEntry {
  /** Also the company slug and the /company/[id] route segment. */
  slug: string;
  name: string;
  /** §3.3's cross-crawler dedup key. The registrable domain, no scheme, no www. */
  domain: string;
  kind: BoardKind;
  token: string;
  industry: string;
  /** Brand tint behind the logo. Omitted where guessing would be worse than the default. */
  logoColor?: string;
}

export const BOARDS: BoardEntry[] = [
  // ── AI and research ──────────────────────────────────────────────────────────
  { slug: 'anthropic', name: 'Anthropic', domain: 'anthropic.com', kind: 'greenhouse', token: 'anthropic', industry: 'AI Safety & Research', logoColor: '#BF6A4D' },
  { slug: 'scale-ai', name: 'Scale AI', domain: 'scale.com', kind: 'greenhouse', token: 'scaleai', industry: 'AI Data Infrastructure', logoColor: '#000000' },
  { slug: 'sierra', name: 'Sierra', domain: 'sierra.ai', kind: 'ashby', token: 'sierra', industry: 'Conversational AI', logoColor: '#1C1C1C' },
  { slug: 'writer', name: 'Writer', domain: 'writer.com', kind: 'ashby', token: 'writer', industry: 'Enterprise AI', logoColor: '#5B34DA' },
  { slug: 'baseten', name: 'Baseten', domain: 'baseten.co', kind: 'ashby', token: 'baseten', industry: 'Model Inference', logoColor: '#6C47FF' },
  { slug: 'modal', name: 'Modal', domain: 'modal.com', kind: 'ashby', token: 'modal', industry: 'Serverless Compute', logoColor: '#7FEE64' },

  // ── Fintech and payments ─────────────────────────────────────────────────────
  { slug: 'stripe', name: 'Stripe', domain: 'stripe.com', kind: 'greenhouse', token: 'stripe', industry: 'Payments Infrastructure', logoColor: '#635BFF' },
  { slug: 'coinbase', name: 'Coinbase', domain: 'coinbase.com', kind: 'greenhouse', token: 'coinbase', industry: 'Crypto & Fintech', logoColor: '#0052FF' },
  { slug: 'brex', name: 'Brex', domain: 'brex.com', kind: 'greenhouse', token: 'brex', industry: 'Corporate Spend', logoColor: '#212121' },
  { slug: 'ramp', name: 'Ramp', domain: 'ramp.com', kind: 'ashby', token: 'ramp', industry: 'Corporate Spend', logoColor: '#E4F222' },
  { slug: 'affirm', name: 'Affirm', domain: 'affirm.com', kind: 'greenhouse', token: 'affirm', industry: 'Consumer Lending', logoColor: '#4A4AF4' },
  { slug: 'chime', name: 'Chime', domain: 'chime.com', kind: 'greenhouse', token: 'chime', industry: 'Consumer Banking', logoColor: '#1EC677' },
  { slug: 'gusto', name: 'Gusto', domain: 'gusto.com', kind: 'greenhouse', token: 'gusto', industry: 'Payroll & Benefits', logoColor: '#F45D48' },
  { slug: 'mercury', name: 'Mercury', domain: 'mercury.com', kind: 'ashby', token: 'mercury', industry: 'Startup Banking', logoColor: '#5465FF' },
  { slug: 'sofi', name: 'SoFi', domain: 'sofi.com', kind: 'greenhouse', token: 'sofi', industry: 'Consumer Finance', logoColor: '#00A0DF' },
  { slug: 'alloy', name: 'Alloy', domain: 'alloy.com', kind: 'greenhouse', token: 'alloy', industry: 'Identity & Risk', logoColor: '#1D4ED8' },

  // ── Quantitative finance and trading ─────────────────────────────────────────
  { slug: 'jane-street', name: 'Jane Street', domain: 'janestreet.com', kind: 'greenhouse', token: 'janestreet', industry: 'Quantitative Trading', logoColor: '#0C2340' },
  { slug: 'imc', name: 'IMC Trading', domain: 'imc.com', kind: 'greenhouse', token: 'imc', industry: 'Market Making', logoColor: '#E4002B' },
  { slug: 'optiver', name: 'Optiver', domain: 'optiver.com', kind: 'greenhouse', token: 'optiver', industry: 'Market Making', logoColor: '#FF4E00' },
  { slug: 'drw', name: 'DRW', domain: 'drw.com', kind: 'greenhouse', token: 'drweng', industry: 'Proprietary Trading', logoColor: '#1C1C1C' },

  // ── Data, infrastructure and developer tools ─────────────────────────────────
  { slug: 'databricks', name: 'Databricks', domain: 'databricks.com', kind: 'greenhouse', token: 'databricks', industry: 'Data & AI Platform', logoColor: '#FF3621' },
  { slug: 'datadog', name: 'Datadog', domain: 'datadoghq.com', kind: 'greenhouse', token: 'datadog', industry: 'Observability', logoColor: '#632CA6' },
  { slug: 'cloudflare', name: 'Cloudflare', domain: 'cloudflare.com', kind: 'greenhouse', token: 'cloudflare', industry: 'Edge Network', logoColor: '#F38020' },
  { slug: 'elastic', name: 'Elastic', domain: 'elastic.co', kind: 'greenhouse', token: 'elastic', industry: 'Search & Analytics', logoColor: '#0077CC' },
  { slug: 'mongodb', name: 'MongoDB', domain: 'mongodb.com', kind: 'greenhouse', token: 'mongodb', industry: 'Databases', logoColor: '#00ED64' },
  { slug: 'gitlab', name: 'GitLab', domain: 'gitlab.com', kind: 'greenhouse', token: 'gitlab', industry: 'DevOps Platform', logoColor: '#FC6D26' },
  { slug: 'vercel', name: 'Vercel', domain: 'vercel.com', kind: 'greenhouse', token: 'vercel', industry: 'Frontend Cloud', logoColor: '#000000' },
  { slug: 'supabase', name: 'Supabase', domain: 'supabase.com', kind: 'ashby', token: 'supabase', industry: 'Backend Platform', logoColor: '#3ECF8E' },
  { slug: 'neon', name: 'Neon', domain: 'neon.tech', kind: 'ashby', token: 'neon', industry: 'Serverless Postgres', logoColor: '#00E599' },
  { slug: 'posthog', name: 'PostHog', domain: 'posthog.com', kind: 'ashby', token: 'posthog', industry: 'Product Analytics', logoColor: '#F54E00' },
  { slug: 'grafana', name: 'Grafana Labs', domain: 'grafana.com', kind: 'greenhouse', token: 'grafanalabs', industry: 'Observability', logoColor: '#F46800' },
  { slug: 'replit', name: 'Replit', domain: 'replit.com', kind: 'ashby', token: 'replit', industry: 'Developer Platform', logoColor: '#F26207' },
  { slug: 'warp', name: 'Warp', domain: 'warp.dev', kind: 'ashby', token: 'warp', industry: 'Developer Tools', logoColor: '#01A0F0' },
  { slug: 'hex', name: 'Hex', domain: 'hex.tech', kind: 'ashby', token: 'hex', industry: 'Data Workspaces', logoColor: '#F5C400' },
  { slug: 'fivetran', name: 'Fivetran', domain: 'fivetran.com', kind: 'greenhouse', token: 'fivetran', industry: 'Data Integration', logoColor: '#0073E6' },
  { slug: 'amplitude', name: 'Amplitude', domain: 'amplitude.com', kind: 'greenhouse', token: 'amplitude', industry: 'Product Analytics', logoColor: '#1E61F0' },
  { slug: 'twilio', name: 'Twilio', domain: 'twilio.com', kind: 'greenhouse', token: 'twilio', industry: 'Communications APIs', logoColor: '#F22F46' },

  // ── Security ─────────────────────────────────────────────────────────────────
  { slug: 'okta', name: 'Okta', domain: 'okta.com', kind: 'greenhouse', token: 'okta', industry: 'Identity', logoColor: '#007DC1' },
  { slug: 'vanta', name: 'Vanta', domain: 'vanta.com', kind: 'ashby', token: 'vanta', industry: 'Compliance Automation', logoColor: '#6057FF' },
  { slug: 'abnormal', name: 'Abnormal Security', domain: 'abnormalsecurity.com', kind: 'greenhouse', token: 'abnormalsecurity', industry: 'Email Security', logoColor: '#1E3A8A' },

  // ── Consumer, marketplaces and commerce ──────────────────────────────────────
  { slug: 'instacart', name: 'Instacart', domain: 'instacart.com', kind: 'greenhouse', token: 'instacart', industry: 'Grocery Delivery', logoColor: '#43B02A' },
  { slug: 'reddit', name: 'Reddit', domain: 'reddit.com', kind: 'greenhouse', token: 'reddit', industry: 'Social & Communities', logoColor: '#FF4500' },
  { slug: 'discord', name: 'Discord', domain: 'discord.com', kind: 'greenhouse', token: 'discord', industry: 'Social & Communities', logoColor: '#5865F2' },
  { slug: 'pinterest', name: 'Pinterest', domain: 'pinterest.com', kind: 'greenhouse', token: 'pinterest', industry: 'Visual Discovery', logoColor: '#E60023' },
  { slug: 'robinhood', name: 'Robinhood', domain: 'robinhood.com', kind: 'greenhouse', token: 'robinhood', industry: 'Retail Investing', logoColor: '#00C805' },
  { slug: 'duolingo', name: 'Duolingo', domain: 'duolingo.com', kind: 'greenhouse', token: 'duolingo', industry: 'Language Learning', logoColor: '#58CC02' },
  { slug: 'lyft', name: 'Lyft', domain: 'lyft.com', kind: 'greenhouse', token: 'lyft', industry: 'Rideshare', logoColor: '#FF00BF' },
  { slug: 'faire', name: 'Faire', domain: 'faire.com', kind: 'greenhouse', token: 'faire', industry: 'Wholesale Marketplace', logoColor: '#111111' },
  { slug: 'roblox', name: 'Roblox', domain: 'roblox.com', kind: 'greenhouse', token: 'roblox', industry: 'Gaming Platform', logoColor: '#E2231A' },
  { slug: 'peloton', name: 'Peloton', domain: 'onepeloton.com', kind: 'greenhouse', token: 'peloton', industry: 'Connected Fitness', logoColor: '#181A1D' },

  // ── Productivity and SaaS ────────────────────────────────────────────────────
  { slug: 'figma', name: 'Figma', domain: 'figma.com', kind: 'greenhouse', token: 'figma', industry: 'Design Tools', logoColor: '#A259FF' },
  { slug: 'linear', name: 'Linear', domain: 'linear.app', kind: 'ashby', token: 'linear', industry: 'Issue Tracking', logoColor: '#5E6AD2' },
  { slug: 'asana', name: 'Asana', domain: 'asana.com', kind: 'greenhouse', token: 'asana', industry: 'Work Management', logoColor: '#F06A6A' },
  { slug: 'dropbox', name: 'Dropbox', domain: 'dropbox.com', kind: 'greenhouse', token: 'dropbox', industry: 'File Collaboration', logoColor: '#0061FF' },
  { slug: 'airtable', name: 'Airtable', domain: 'airtable.com', kind: 'greenhouse', token: 'airtable', industry: 'No-Code Databases', logoColor: '#18BFFF' },
  { slug: 'carta', name: 'Carta', domain: 'carta.com', kind: 'greenhouse', token: 'carta', industry: 'Equity Management', logoColor: '#22314E' },
  { slug: 'deel', name: 'Deel', domain: 'deel.com', kind: 'ashby', token: 'deel', industry: 'Global Payroll', logoColor: '#0C5EFF' },
  { slug: 'lattice', name: 'Lattice', domain: 'lattice.com', kind: 'greenhouse', token: 'lattice', industry: 'People Management', logoColor: '#3EB1C8' },
  { slug: 'checkr', name: 'Checkr', domain: 'checkr.com', kind: 'greenhouse', token: 'checkr', industry: 'Background Checks', logoColor: '#1A3A5C' },
  { slug: 'flexport', name: 'Flexport', domain: 'flexport.com', kind: 'greenhouse', token: 'flexport', industry: 'Freight & Logistics', logoColor: '#25A0FC' },
  { slug: 'samsara', name: 'Samsara', domain: 'samsara.com', kind: 'greenhouse', token: 'samsara', industry: 'Connected Operations', logoColor: '#2A7DE1' },

  // ── Health and bio ───────────────────────────────────────────────────────────
  { slug: 'komodo-health', name: 'Komodo Health', domain: 'komodohealth.com', kind: 'greenhouse', token: 'komodohealth', industry: 'Healthcare Data', logoColor: '#0B3C5D' },

  // ── Hard tech, defense and space ─────────────────────────────────────────────
  { slug: 'anduril', name: 'Anduril', domain: 'anduril.com', kind: 'greenhouse', token: 'andurilindustries', industry: 'Defense Technology', logoColor: '#35402F' },
  { slug: 'astranis', name: 'Astranis', domain: 'astranis.com', kind: 'greenhouse', token: 'astranis', industry: 'Satellite Communications', logoColor: '#0E2A47' },
  { slug: 'relativity-space', name: 'Relativity Space', domain: 'relativityspace.com', kind: 'greenhouse', token: 'relativity', industry: 'Launch Vehicles', logoColor: '#1A1A1A' },
  { slug: 'waymo', name: 'Waymo', domain: 'waymo.com', kind: 'greenhouse', token: 'waymo', industry: 'Autonomous Driving', logoColor: '#5F6368' },
  { slug: 'wayve', name: 'Wayve', domain: 'wayve.ai', kind: 'greenhouse', token: 'wayve', industry: 'Autonomous Driving', logoColor: '#0F62FE' },

  // ── Enterprise and platform ──────────────────────────────────────────────────
  { slug: 'verkada', name: 'Verkada', domain: 'verkada.com', kind: 'greenhouse', token: 'verkada', industry: 'Physical Security', logoColor: '#0E4DA4' },
  { slug: 'klaviyo', name: 'Klaviyo', domain: 'klaviyo.com', kind: 'greenhouse', token: 'klaviyo', industry: 'Marketing Automation', logoColor: '#1F2937' },
  { slug: 'braze', name: 'Braze', domain: 'braze.com', kind: 'greenhouse', token: 'braze', industry: 'Customer Engagement', logoColor: '#FF6B4A' },
  { slug: 'cockroach-labs', name: 'Cockroach Labs', domain: 'cockroachlabs.com', kind: 'greenhouse', token: 'cockroachlabs', industry: 'Distributed Databases', logoColor: '#6933FF' },
  { slug: 'sourcegraph', name: 'Sourcegraph', domain: 'sourcegraph.com', kind: 'greenhouse', token: 'sourcegraph91', industry: 'Code Intelligence', logoColor: '#A112FF' },
  { slug: 'sardine', name: 'Sardine', domain: 'sardine.ai', kind: 'ashby', token: 'sardine', industry: 'Fraud Prevention', logoColor: '#0B3D91' },
  { slug: 'browserbase', name: 'Browserbase', domain: 'browserbase.com', kind: 'ashby', token: 'browserbase', industry: 'Browser Infrastructure', logoColor: '#F5A623' },
  { slug: 'decagon', name: 'Decagon', domain: 'decagon.ai', kind: 'ashby', token: 'decagon', industry: 'Support Automation', logoColor: '#111111' },

  /*
   * Verified in a second pass.
   *
   * The first full crawl 404ed on 66 of 141 tokens: companies that had moved to
   * Workday, renamed their board, or never used the one guessed for them. Rather than
   * guess again, every candidate below was probed against its board API first and is
   * listed only because it answered with postings. That is the maintenance loop this
   * file's header describes, run once.
   */
  { slug: 'doordash', name: 'DoorDash', domain: 'doordash.com', kind: 'greenhouse', token: 'doordashusa', industry: 'On-Demand Delivery', logoColor: '#FF3008' },
  { slug: 'cohere', name: 'Cohere', domain: 'cohere.com', kind: 'ashby', token: 'cohere', industry: 'Language Models', logoColor: '#39594D' },
  { slug: 'elevenlabs', name: 'ElevenLabs', domain: 'elevenlabs.io', kind: 'ashby', token: 'elevenlabs', industry: 'Voice AI', logoColor: '#1A1A1A' },
  { slug: 'openai', name: 'OpenAI', domain: 'openai.com', kind: 'ashby', token: 'openai', industry: 'Applied AI Research', logoColor: '#74AA9C' },
  { slug: 'langchain', name: 'LangChain', domain: 'langchain.com', kind: 'ashby', token: 'langchain', industry: 'LLM Tooling', logoColor: '#1C3C3C' },
  { slug: 'fireworks-ai', name: 'Fireworks AI', domain: 'fireworks.ai', kind: 'ashby', token: 'fireworks', industry: 'Model Inference', logoColor: '#5019C5' },
  { slug: 'lovable', name: 'Lovable', domain: 'lovable.dev', kind: 'ashby', token: 'lovable', industry: 'AI App Building', logoColor: '#F26E3F' },
  { slug: 'weaviate', name: 'Weaviate', domain: 'weaviate.io', kind: 'ashby', token: 'weaviate', industry: 'Vector Databases', logoColor: '#0BA5EC' },
  { slug: 'cresta', name: 'Cresta', domain: 'cresta.com', kind: 'greenhouse', token: 'cresta', industry: 'Contact Centre AI', logoColor: '#1F2937' },
  { slug: 'sambanova', name: 'SambaNova', domain: 'sambanova.ai', kind: 'greenhouse', token: 'sambanovasystems', industry: 'AI Accelerators', logoColor: '#EE3A43' },
  { slug: 'graphcore', name: 'Graphcore', domain: 'graphcore.ai', kind: 'greenhouse', token: 'graphcore', industry: 'AI Accelerators', logoColor: '#FF6F00' },
  { slug: 'coreweave', name: 'CoreWeave', domain: 'coreweave.com', kind: 'greenhouse', token: 'coreweave', industry: 'GPU Cloud', logoColor: '#0B0B0B' },
  { slug: 'dataiku', name: 'Dataiku', domain: 'dataiku.com', kind: 'greenhouse', token: 'dataiku', industry: 'Data Science Platform', logoColor: '#2AB1AC' },
  { slug: 'sigma-computing', name: 'Sigma Computing', domain: 'sigmacomputing.com', kind: 'greenhouse', token: 'sigmacomputing', industry: 'Cloud Analytics', logoColor: '#4A6EE0' },
  { slug: 'imply', name: 'Imply', domain: 'imply.io', kind: 'greenhouse', token: 'imply', industry: 'Real-Time Analytics', logoColor: '#1E3A8A' },
  { slug: 'algolia', name: 'Algolia', domain: 'algolia.com', kind: 'greenhouse', token: 'algolia', industry: 'Search APIs', logoColor: '#003DFF' },
  { slug: 'contentful', name: 'Contentful', domain: 'contentful.com', kind: 'greenhouse', token: 'contentful', industry: 'Content Platform', logoColor: '#2478CC' },
  { slug: 'celonis', name: 'Celonis', domain: 'celonis.com', kind: 'greenhouse', token: 'celonis', industry: 'Process Mining', logoColor: '#5A1EE8' },
  { slug: 'circleci', name: 'CircleCI', domain: 'circleci.com', kind: 'greenhouse', token: 'circleci', industry: 'CI/CD', logoColor: '#343434' },
  { slug: 'launchdarkly', name: 'LaunchDarkly', domain: 'launchdarkly.com', kind: 'greenhouse', token: 'launchdarkly', industry: 'Feature Management', logoColor: '#3DD6F5' },
  { slug: 'pagerduty', name: 'PagerDuty', domain: 'pagerduty.com', kind: 'greenhouse', token: 'pagerduty', industry: 'Incident Response', logoColor: '#06AC38' },
  { slug: 'jamf', name: 'Jamf', domain: 'jamf.com', kind: 'greenhouse', token: 'jamf', industry: 'Device Management', logoColor: '#0B6BB7' },
  { slug: 'secureframe', name: 'Secureframe', domain: 'secureframe.com', kind: 'ashby', token: 'secureframe', industry: 'Compliance Automation', logoColor: '#1B2A4A' },
  { slug: 'ripple', name: 'Ripple', domain: 'ripple.com', kind: 'greenhouse', token: 'ripple', industry: 'Crypto Payments', logoColor: '#0085FF' },
  { slug: 'gemini', name: 'Gemini', domain: 'gemini.com', kind: 'greenhouse', token: 'gemini', industry: 'Crypto Exchange', logoColor: '#00DCFA' },
  { slug: 'betterment', name: 'Betterment', domain: 'betterment.com', kind: 'greenhouse', token: 'betterment', industry: 'Automated Investing', logoColor: '#1F4C73' },
  { slug: 'wise', name: 'Wise', domain: 'wise.com', kind: 'greenhouse', token: 'wise', industry: 'International Transfers', logoColor: '#9FE870' },
  { slug: 'monzo', name: 'Monzo', domain: 'monzo.com', kind: 'greenhouse', token: 'monzo', industry: 'Consumer Banking', logoColor: '#FF4F40' },
  { slug: 'trade-republic', name: 'Trade Republic', domain: 'traderepublic.com', kind: 'greenhouse', token: 'traderepublic', industry: 'Retail Investing', logoColor: '#1A1A1A' },
  { slug: 'tala', name: 'Tala', domain: 'tala.co', kind: 'lever', token: 'tala', industry: 'Emerging Market Credit', logoColor: '#00A6A0' },
  { slug: 'squarespace', name: 'Squarespace', domain: 'squarespace.com', kind: 'greenhouse', token: 'squarespace', industry: 'Website Platform', logoColor: '#000000' },
  { slug: 'nextdoor', name: 'Nextdoor', domain: 'nextdoor.com', kind: 'greenhouse', token: 'nextdoor', industry: 'Neighborhood Social', logoColor: '#8ED500' },
  { slug: 'deliveroo', name: 'Deliveroo', domain: 'deliveroo.com', kind: 'greenhouse', token: 'deliveroo', industry: 'Food Delivery', logoColor: '#00CCBC' },
  { slug: 'via', name: 'Via', domain: 'ridewithvia.com', kind: 'greenhouse', token: 'via', industry: 'Transit Technology', logoColor: '#0C2C84' },
  { slug: 'motive', name: 'Motive', domain: 'gomotive.com', kind: 'greenhouse', token: 'motive', industry: 'Fleet Operations', logoColor: '#2A6CF6' },
  { slug: 'udemy', name: 'Udemy', domain: 'udemy.com', kind: 'greenhouse', token: 'udemy', industry: 'Online Learning', logoColor: '#A435F0' },
  { slug: 'coursera', name: 'Coursera', domain: 'coursera.org', kind: 'greenhouse', token: 'coursera', industry: 'Online Learning', logoColor: '#0056D2' },
  { slug: 'handshake', name: 'Handshake', domain: 'joinhandshake.com', kind: 'greenhouse', token: 'handshake', industry: 'Campus Recruiting', logoColor: '#2F3E4E' },
  { slug: 'epic-games', name: 'Epic Games', domain: 'epicgames.com', kind: 'greenhouse', token: 'epicgames', industry: 'Game Development', logoColor: '#2A2A2A' },
  { slug: 'riot-games', name: 'Riot Games', domain: 'riotgames.com', kind: 'greenhouse', token: 'riotgames', industry: 'Game Development', logoColor: '#D13639' },
  { slug: 'scopely', name: 'Scopely', domain: 'scopely.com', kind: 'greenhouse', token: 'scopely', industry: 'Mobile Gaming', logoColor: '#6F2DBD' },
  { slug: 'axon', name: 'Axon', domain: 'axon.com', kind: 'greenhouse', token: 'axon', industry: 'Public Safety Technology', logoColor: '#FDB515' },
  { slug: 'vannevar-labs', name: 'Vannevar Labs', domain: 'vannevarlabs.com', kind: 'greenhouse', token: 'vannevarlabs', industry: 'Defense Technology', logoColor: '#1B2A41' },
  { slug: 'epirus', name: 'Epirus', domain: 'epirusinc.com', kind: 'greenhouse', token: 'epirus', industry: 'Defense Technology', logoColor: '#0F2A3D' },
  { slug: 'saronic', name: 'Saronic', domain: 'saronic.com', kind: 'ashby', token: 'saronic', industry: 'Autonomous Vessels', logoColor: '#0E3B5C' },
  { slug: 'sylvera', name: 'Sylvera', domain: 'sylvera.com', kind: 'ashby', token: 'sylvera', industry: 'Carbon Data', logoColor: '#1F6F4A' },
  { slug: 'unify', name: 'Unify', domain: 'unifygtm.com', kind: 'ashby', token: 'unify', industry: 'Go-to-Market', logoColor: '#111827' },
  { slug: 'n8n', name: 'n8n', domain: 'n8n.io', kind: 'ashby', token: 'n8n', industry: 'Workflow Automation', logoColor: '#EA4B71' },
  { slug: 'ophelia', name: 'Ophelia', domain: 'ophelia.com', kind: 'greenhouse', token: 'ophelia', industry: 'Telehealth', logoColor: '#2B4C7E' },
];

/** `NV` for NVIDIA, `HR` for Hudson River Trading — the CompanyLogo fallback. */
export function monogramFor(name: string): string {
  const words = name
    .replace(/[^A-Za-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0) return '?';
  if (words.length === 1) return (words[0] ?? '').slice(0, 2).toUpperCase();
  return `${words[0]?.charAt(0) ?? ''}${words[1]?.charAt(0) ?? ''}`.toUpperCase();
}

/** The board's public URL. Stored on the source and unique per (kind, url). */
export function boardUrlFor(entry: BoardEntry): string {
  switch (entry.kind) {
    case 'greenhouse':
      return `https://boards.greenhouse.io/${entry.token}`;
    case 'lever':
      return `https://jobs.lever.co/${entry.token}`;
    case 'ashby':
      return `https://jobs.ashbyhq.com/${entry.token}`;
  }
}

/**
 * Matches data/mockCompanies.ts, so a seeded company gets a logo without a separate asset
 * pipeline. Phase 1 has no logo ingestion and does not need one; a favicon at 128px is
 * what the existing fixtures already use and what CompanyLogo already renders.
 */
export function logoUrlFor(domain: string): string {
  return `https://www.google.com/s2/favicons?sz=128&domain_url=${domain}`;
}
