import { supabase } from '@/lib/supabase';
import type { TrackedApplication } from '@/hooks/useApplications';
import type { WeeklyGoal } from '@/hooks/useWeeklyGoal';
import type { Job, StoryGroup } from '@/types';

/**
 * The first-run tour's server half and its practice content.
 *
 * Everything a new account touches during the tour is made up here and never written: the
 * practice postings, the comments, the story, the application. Likes, follows and the Auto
 * Apply draft change local state only. The one real write is `completeTour()` at the end, which
 * pays the bonus and stamps the profile so the tour never shows again.
 */

/** Pays the tour's Auto Applies (once per account) and marks it done. Returns what it paid. */
export async function completeTour(): Promise<number> {
  const { data, error } = await supabase.rpc('complete_tour');
  if (error) throw error;
  return typeof data === 'number' ? data : 0;
}

export const TOUR_BONUS = 3;

/*
 * Set when the tour hands over to the app, read once by the tabs layout: it opens on the Deck
 * (the tour ends on "Start swiping") and holds back the welcome paywall for this launch, which
 * would otherwise slide up over a reader who was just handed four free Auto Applies.
 */
let justFinished = false;

export function markTourFinished(): void {
  justFinished = true;
}

export function tourJustFinished(): boolean {
  return justFinished;
}

// ── practice content ─────────────────────────────────────────────────────────────

/*
 * Brandfetch tiles, the same CDN and client id the crawler resolves every company's
 * `logo_url` to. Real employers and believable pay so the deck feels like the one that is
 * about to load; every posting is marked "Practice" on the screen and none of it is stored.
 */
const logo = (domain: string) => `https://cdn.brandfetch.io/${domain}?c=1idoWHbXpti47hvU0f8`;

export const TOUR_LOGOS = {
  apple: logo('apple.com'),
  nvidia: logo('nvidia.com'),
  mckinsey: logo('mckinsey.com'),
  lockheed: logo('lockheedmartin.com'),
};

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

function practiceJob(job: Partial<Job> & Pick<Job, 'id' | 'companyName' | 'title'>): Job {
  return {
    companyId: `tour-${job.id}`,
    companySlug: `tour-${job.id}`,
    companyLogo: '',
    companyLogoUrl: null,
    companyLogoColor: null,
    seniority: 'intern',
    location: '',
    locationType: 'Onsite',
    employmentType: 'Internship',
    salaryMin: null,
    salaryMax: null,
    salaryPeriod: 'hour',
    salaryIsEstimated: false,
    description: '',
    requirements: [],
    skills: [],
    postedAt: daysAgo(2),
    lastSeenAt: daysAgo(0),
    applicationUrl: '',
    isLiked: false,
    ...job,
  };
}

export const PRACTICE_APPLE = practiceJob({
  id: 'tour-apple',
  companyName: 'Apple',
  companyLogo: TOUR_LOGOS.apple,
  companyLogoUrl: TOUR_LOGOS.apple,
  companyLogoColor: '#1D1D1F',
  title: 'Software Engineering Intern, Machine Learning',
  location: 'Cupertino, CA',
  salaryMin: 52,
  salaryMax: 60,
  description:
    'Build and ship machine learning features in Apple apps, side by side with the engineers and researchers who own them.',
  skills: ['Machine Learning', 'Python', 'Swift'],
  postedAt: daysAgo(2),
});

export const PRACTICE_NVIDIA = practiceJob({
  id: 'tour-nvidia',
  companyName: 'NVIDIA',
  companyLogo: TOUR_LOGOS.nvidia,
  companyLogoUrl: TOUR_LOGOS.nvidia,
  companyLogoColor: '#76B900',
  title: 'Software Engineer, New College Grad 2026',
  seniority: 'new_grad',
  employmentType: 'Full-time',
  location: 'Santa Clara, CA',
  locationType: 'Hybrid',
  salaryMin: 108_000,
  salaryMax: 196_000,
  salaryPeriod: 'year',
  description:
    "Write the systems software that keeps NVIDIA's GPU clusters fast: scheduling, networking and the tools engineers use every day.",
  skills: ['C++', 'Distributed Systems', 'CUDA'],
  postedAt: daysAgo(3),
});

export const PRACTICE_MCKINSEY = practiceJob({
  id: 'tour-mckinsey',
  companyName: 'McKinsey & Company',
  companyLogo: TOUR_LOGOS.mckinsey,
  companyLogoUrl: TOUR_LOGOS.mckinsey,
  companyLogoColor: '#2E7BFF',
  title: 'Business Analyst, Finance',
  seniority: 'new_grad',
  employmentType: 'Full-time',
  location: 'New York, NY',
  salaryMin: 112_000,
  salaryMax: 112_000,
  salaryPeriod: 'year',
  postedAt: daysAgo(1),
});

export const PRACTICE_LOCKHEED = practiceJob({
  id: 'tour-lockheed',
  companyName: 'Lockheed Martin',
  companyLogo: TOUR_LOGOS.lockheed,
  companyLogoUrl: TOUR_LOGOS.lockheed,
  companyLogoColor: '#0033A0',
  title: 'Aeronautical Engineering Intern',
  location: 'Fort Worth, TX',
  salaryMin: 28,
  salaryMax: 34,
  postedAt: daysAgo(4),
});

/** Home's feed in the two orders the tour shows: as ranked, then by Top salary. */
export const PRACTICE_FEED_RELEVANT = [PRACTICE_APPLE, PRACTICE_LOCKHEED, PRACTICE_MCKINSEY];
export const PRACTICE_FEED_SALARY = [PRACTICE_NVIDIA, PRACTICE_APPLE, PRACTICE_MCKINSEY];

/** One real item from the news feed (TechCrunch, 2026-09-28), so the story reads like one. */
export const PRACTICE_STORY: StoryGroup = {
  id: 'tour-nvidia-news',
  name: 'NVIDIA',
  logo: TOUR_LOGOS.nvidia,
  logoColor: '#76B900',
  isIndustry: false,
  hasUnseen: true,
  items: [
    {
      id: 'tour-news-1',
      category: 'company',
      companyName: 'NVIDIA',
      accentColor: '#E4EEFB',
      tag: 'Industry Pulse · Product',
      headline: 'Nvidia launches new platform for reining in rogue AI agents',
      subtext: 'Nvidia releases security platform for AI agents',
      summary: [
        'Nvidia has launched a new toolkit combining software and hardware to add security controls around AI agents. This suggests growing industry focus on managing autonomous AI systems as they become more common in production environments.',
      ],
      topic: 'product',
      url: 'https://techcrunch.com',
      publisher: 'TechCrunch',
      publishedAt: '2026-09-28T18:31:23Z',
      seen: false,
    },
  ],
};

/** The rest of Home's News row: present, but not the one the tour opens. */
export const PRACTICE_STORY_ROW: StoryGroup[] = [
  PRACTICE_STORY,
  { ...PRACTICE_STORY, id: 'tour-apple-news', name: 'Apple', logo: TOUR_LOGOS.apple, logoColor: '#1D1D1F' },
  { ...PRACTICE_STORY, id: 'tour-mck-news', name: 'McKinsey', logo: TOUR_LOGOS.mckinsey, logoColor: '#2E7BFF' },
  { ...PRACTICE_STORY, id: 'tour-lm-news', name: 'Lockheed', logo: TOUR_LOGOS.lockheed, logoColor: '#0033A0', hasUnseen: false },
];

export interface PracticeComment {
  handle: string;
  badge: string;
  body: string;
}

export const PRACTICE_COMMENTS: PracticeComment[] = [
  { handle: 'quiet-otter-4821', badge: "CS @ Purdue '27", body: '108k to start?? nvidia please notice me' },
  { handle: 'amber-heron-1180', badge: "Data Science @ UIUC '28", body: 'applying before i talk myself out of it' },
  { handle: 'tidal-granite-7739', badge: "Stats @ UW '27", body: 'do they want cuda experience going in or can you learn it' },
];

export function practiceApplication(status: 'applied' | 'interview'): TrackedApplication {
  const now = new Date().toISOString();
  return {
    job: PRACTICE_NVIDIA,
    application: {
      id: 'tour-application',
      jobId: PRACTICE_NVIDIA.id,
      status,
      source: 'company',
      appliedAt: now,
      updatedAt: now,
      selfReported: false,
    },
  };
}

/** A new account's week: one application (the practice draft), goal of seven. */
export function practiceGoal(): WeeklyGoal {
  const monday = new Date();
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const weeks = [3, 2, 1, 0].map((back) => {
    const start = new Date(monday);
    start.setDate(start.getDate() - back * 7);
    const key = start.toISOString().slice(0, 10);
    return { key, label: back === 0 ? 'Now' : key.slice(5), count: back === 0 ? 1 : 0, met: false };
  });
  return {
    target: 7,
    count: 1,
    progress: 1 / 7,
    remaining: 6,
    met: false,
    streakWeeks: 0,
    bonusThisWeek: 1,
    history: weeks,
  };
}
