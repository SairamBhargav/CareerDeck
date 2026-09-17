export interface ResumeEducationEntry {
  school: string;
  degree: string;
  period: string;
  detail?: string;
}

export interface ResumeExperienceEntry {
  role: string;
  organization: string;
  period: string;
  bullets: string[];
}

export interface Resume {
  id: string;
  name: string;
  /** Short subtitle shown in the preview bubble, e.g. "Software Engineering". */
  focus: string;
  /** ISO date string of the last edit. */
  updatedAt: string;
  /**
   * Relative widths (0–1) for the mock paragraph lines drawn inside the preview bubble,
   * giving each resume a distinct "page" silhouette at a glance, before it's opened.
   */
  previewLines: number[];
  /** Shown under the person's name in the full viewer, e.g. "Dallas, TX · email · phone". */
  contactLine: string;
  summary: string;
  education: ResumeEducationEntry[];
  experience: ResumeExperienceEntry[];
  skills: string[];
}
