import type { Company, Job } from '@/types';

/**
 * "$40-$60/hr" for hourly roles, "$138k - $186k" for salaried ones.
 * Returns null when a posting has no salary so callers can hide the row entirely.
 */
export function formatSalary(job: Pick<Job, 'salaryMin' | 'salaryMax' | 'salaryPeriod'>): string | null {
  const { salaryMin, salaryMax, salaryPeriod } = job;
  if (salaryMin === null && salaryMax === null) return null;

  const format = (value: number) =>
    salaryPeriod === 'hour' ? `$${value}` : `$${Math.round(value / 1000)}k`;

  const suffix = salaryPeriod === 'hour' ? '/hr' : '/yr';
  if (salaryMin !== null && salaryMax !== null) {
    return `${format(salaryMin)} - ${format(salaryMax)}${suffix}`;
  }

  const single = salaryMin ?? salaryMax;
  return single === null ? null : `${format(single)}${suffix}`;
}

/** Compact relative time: "Today", "3d ago", "2w ago". */
export function formatPostedAt(postedAt: string, now: Date = new Date()): string {
  const posted = new Date(postedAt);
  if (Number.isNaN(posted.getTime())) return '';

  const days = Math.floor((now.getTime() - posted.getTime()) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

/** 184200 -> "184.2K", 1043000 -> "1.0M". */
export function formatFollowerCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return String(count);
}

/**
 * Follows on CareerDeck at which a company's own count replaces its LinkedIn snapshot. Below
 * it, "2 followers" undersells every company in the app.
 */
const OWN_FOLLOWERS_THRESHOLD = 100;

/**
 * The audience line for a company: CareerDeck's own followers once there are enough of them,
 * otherwise its LinkedIn audience — always labelled as LinkedIn's, so it is never read as
 * CareerDeck users — and failing both, how many roles it has open.
 */
export function companyAudience(
  company: Pick<Company, 'followerCount' | 'linkedinFollowerCount' | 'openJobCount'>,
): string {
  if (company.followerCount >= OWN_FOLLOWERS_THRESHOLD) {
    return `${formatFollowerCount(company.followerCount)} followers`;
  }
  if (company.linkedinFollowerCount) {
    return `${formatFollowerCount(company.linkedinFollowerCount)} on LinkedIn`;
  }
  if (company.openJobCount > 0) {
    return `${company.openJobCount} open ${company.openJobCount === 1 ? 'role' : 'roles'}`;
  }
  return `${formatFollowerCount(company.followerCount)} followers`;
}

/** "Santa Clara, CA · Hybrid" */
export function formatLocationLine(job: Pick<Job, 'location' | 'locationType'>): string {
  return `${job.location} · ${job.locationType}`;
}
