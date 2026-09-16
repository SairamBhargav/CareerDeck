export type LocationType = 'Onsite' | 'Hybrid' | 'Remote';

export type EmploymentType = 'Internship' | 'Full-time' | 'Part-time' | 'Contract';

export type SalaryPeriod = 'hour' | 'year';

export interface Job {
  id: string;
  companyId: string;
  companyName: string;
  companyLogo: string;
  title: string;
  location: string;
  locationType: LocationType;
  employmentType: EmploymentType;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryPeriod: SalaryPeriod;
  description: string;
  requirements: string[];
  skills: string[];
  /** ISO date string. */
  postedAt: string;
  applicationUrl: string;
  isSaved: boolean;
  isLiked: boolean;
}
