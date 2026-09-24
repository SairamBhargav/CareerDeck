/**
 * The shape of a fixture company — seed input, not a `Company`.
 *
 * Same reasoning as FixtureJob: a real `Company` has a uuid, a slug and an
 * `openJobCount` that only the database knows. `id` here is what becomes the slug.
 */
export interface FixtureCompany {
  /** Becomes `companies.slug`, and stays the /company/[id] route segment. */
  id: string;
  name: string;
  logo: string;
  logoColor: string;
  industry: string;
  followerCount: number;
  isFollowing: boolean;
}

export const mockCompanies: FixtureCompany[] = [
  {
    id: 'nvidia',
    name: 'NVIDIA',
    logo: 'https://www.google.com/s2/favicons?sz=128&domain_url=nvidia.com',
    logoColor: '#76B900',
    industry: 'Semiconductors & AI',
    followerCount: 184200,
    isFollowing: true,
  },
  {
    id: 'google',
    name: 'Google',
    logo: 'https://www.google.com/s2/favicons?sz=128&domain_url=google.com',
    logoColor: '#4285F4',
    industry: 'Internet & Cloud',
    followerCount: 921400,
    isFollowing: false,
  },
  {
    id: 'amazon',
    name: 'Amazon',
    logo: 'https://www.google.com/s2/favicons?sz=128&domain_url=amazon.com',
    logoColor: '#FF9900',
    industry: 'E-commerce & Cloud',
    followerCount: 764800,
    isFollowing: false,
  },
  {
    id: 'citadel',
    name: 'Citadel',
    logo: 'https://www.google.com/s2/favicons?sz=128&domain_url=citadel.com',
    logoColor: '#0B3D2E',
    industry: 'Quantitative Finance',
    followerCount: 58300,
    isFollowing: false,
  },
  {
    id: 'stripe',
    name: 'Stripe',
    logo: 'https://www.google.com/s2/favicons?sz=128&domain_url=stripe.com',
    logoColor: '#635BFF',
    industry: 'Payments Infrastructure',
    followerCount: 112700,
    isFollowing: true,
  },
  {
    id: 'datadog',
    name: 'Datadog',
    logo: 'https://www.google.com/s2/favicons?sz=128&domain_url=datadoghq.com',
    logoColor: '#632CA6',
    industry: 'Observability',
    followerCount: 47900,
    isFollowing: false,
  },
  {
    id: 'apple',
    name: 'Apple',
    logo: 'https://www.google.com/s2/favicons?sz=128&domain_url=apple.com',
    logoColor: '#1D1D1F',
    industry: 'Consumer Hardware',
    followerCount: 1043000,
    isFollowing: false,
  },
  {
    id: 'palantir',
    name: 'Palantir',
    logo: 'https://www.google.com/s2/favicons?sz=128&domain_url=palantir.com',
    logoColor: '#101113',
    industry: 'Data Platforms',
    followerCount: 96500,
    isFollowing: false,
  },
  {
    id: 'spacex',
    name: 'SpaceX',
    logo: 'https://www.google.com/s2/favicons?sz=128&domain_url=spacex.com',
    logoColor: '#005288',
    industry: 'Aerospace',
    followerCount: 402100,
    isFollowing: false,
  },
  {
    id: 'microsoft',
    name: 'Microsoft',
    logo: 'https://www.google.com/s2/favicons?sz=128&domain_url=microsoft.com',
    logoColor: '#0078D4',
    industry: 'Software & Cloud',
    followerCount: 887300,
    isFollowing: false,
  },
  {
    id: 'meta',
    name: 'Meta',
    logo: 'https://www.google.com/s2/favicons?sz=128&domain_url=meta.com',
    logoColor: '#0866FF',
    industry: 'Social & Metaverse',
    followerCount: 758200,
    isFollowing: false,
  },
  {
    id: 'netflix',
    name: 'Netflix',
    logo: 'https://www.google.com/s2/favicons?sz=128&domain_url=netflix.com',
    logoColor: '#E50914',
    industry: 'Streaming & Entertainment',
    followerCount: 341600,
    isFollowing: false,
  },
  {
    id: 'openai',
    name: 'OpenAI',
    logo: 'https://www.google.com/s2/favicons?sz=128&domain_url=openai.com',
    logoColor: '#74AA9C',
    industry: 'Applied AI Research',
    followerCount: 612900,
    isFollowing: false,
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    logo: 'https://www.google.com/s2/favicons?sz=128&domain_url=anthropic.com',
    logoColor: '#BF6A4D',
    industry: 'AI Safety & Research',
    followerCount: 289400,
    isFollowing: true,
  },
  {
    id: 'coinbase',
    name: 'Coinbase',
    logo: 'https://www.google.com/s2/favicons?sz=128&domain_url=coinbase.com',
    logoColor: '#0052FF',
    industry: 'Crypto & Fintech',
    followerCount: 143800,
    isFollowing: false,
  },
  {
    id: 'snowflake',
    name: 'Snowflake',
    logo: 'https://www.google.com/s2/favicons?sz=128&domain_url=snowflake.com',
    logoColor: '#29B5E8',
    industry: 'Data Cloud',
    followerCount: 76300,
    isFollowing: false,
  },
  {
    id: 'databricks',
    name: 'Databricks',
    logo: 'https://www.google.com/s2/favicons?sz=128&domain_url=databricks.com',
    logoColor: '#FF3621',
    industry: 'Data & AI Platform',
    followerCount: 91200,
    isFollowing: false,
  },
  {
    id: 'figma',
    name: 'Figma',
    logo: 'https://www.google.com/s2/favicons?sz=128&domain_url=figma.com',
    logoColor: '#A259FF',
    industry: 'Design Tools',
    followerCount: 168400,
    isFollowing: true,
  },
  {
    id: 'doordash',
    name: 'DoorDash',
    logo: 'https://www.google.com/s2/favicons?sz=128&domain_url=doordash.com',
    logoColor: '#FF3008',
    industry: 'On-Demand Delivery',
    followerCount: 128900,
    isFollowing: false,
  },
  {
    id: 'discord',
    name: 'Discord',
    logo: 'https://www.google.com/s2/favicons?sz=128&domain_url=discord.com',
    logoColor: '#5865F2',
    industry: 'Social & Communities',
    followerCount: 204700,
    isFollowing: false,
  },
  {
    id: 'twosigma',
    name: 'Two Sigma',
    logo: 'https://www.google.com/s2/favicons?sz=128&domain_url=twosigma.com',
    logoColor: '#123C69',
    industry: 'Quantitative Finance',
    followerCount: 39800,
    isFollowing: false,
  },
  {
    id: 'anduril',
    name: 'Anduril',
    logo: 'https://www.google.com/s2/favicons?sz=128&domain_url=anduril.com',
    logoColor: '#35402F',
    industry: 'Defense Technology',
    followerCount: 67100,
    isFollowing: false,
  },
  {
    id: 'rivian',
    name: 'Rivian',
    logo: 'https://www.google.com/s2/favicons?sz=128&domain_url=rivian.com',
    logoColor: '#1C4E80',
    industry: 'Electric Vehicles',
    followerCount: 118500,
    isFollowing: false,
  },
  {
    id: 'crowdstrike',
    name: 'CrowdStrike',
    logo: 'https://www.google.com/s2/favicons?sz=128&domain_url=crowdstrike.com',
    logoColor: '#FC0A54',
    industry: 'Cybersecurity',
    followerCount: 83600,
    isFollowing: false,
  },
  {
    id: 'boeing',
    name: 'Boeing',
    logo: 'https://www.google.com/s2/favicons?sz=128&domain_url=boeing.com',
    logoColor: '#0039A6',
    industry: 'Aerospace & Defense',
    followerCount: 402500,
    isFollowing: false,
  },
  {
    id: 'lockheed',
    name: 'Lockheed Martin',
    logo: 'https://www.google.com/s2/favicons?sz=128&domain_url=lockheedmartin.com',
    logoColor: '#0033A0',
    industry: 'Aerospace & Defense',
    followerCount: 318900,
    isFollowing: false,
  },
  {
    id: 'blueorigin',
    name: 'Blue Origin',
    logo: 'https://www.google.com/s2/favicons?sz=128&domain_url=blueorigin.com',
    logoColor: '#1B2A47',
    industry: 'Spaceflight',
    followerCount: 96400,
    isFollowing: false,
  },
  {
    id: 'tesla',
    name: 'Tesla',
    logo: 'https://www.google.com/s2/favicons?sz=128&domain_url=tesla.com',
    logoColor: '#E82127',
    industry: 'Electric Vehicles & Energy',
    followerCount: 587300,
    isFollowing: false,
  },
  {
    id: 'caterpillar',
    name: 'Caterpillar',
    logo: 'https://www.google.com/s2/favicons?sz=128&domain_url=caterpillar.com',
    logoColor: '#FFCD11',
    industry: 'Heavy Machinery',
    followerCount: 143800,
    isFollowing: false,
  },
];

/*
 * `suggestedCompanyIds` lived here and is gone.
 *
 * The "Suggested for you" rail is served by `suggested_companies()` in the phase 1
 * migration, which ranks on companies that are actually hiring right now. A hardcoded list
 * of thirteen slugs could recommend an employer with nothing open, which is the one thing
 * a suggestion rail must not do.
 */
