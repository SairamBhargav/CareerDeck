import type { Job, Resume } from '@/types';

/**
 * A stand-in for real resume-to-job matching — there's no backend, no parsed resume
 * content, and no scoring model yet. This produces a deterministic score per
 * (resume, job) pair so the same job always shows the same match against a given
 * resume within a session, instead of a random number that changes every render.
 * Replace this whole file with a real call once matching actually exists.
 */

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/** True if any word from the resume's focus shows up in the job's title or skills. */
function sharesFocusKeyword(job: Job, resume: Resume): boolean {
  const haystack = `${job.title} ${job.skills.join(' ')}`.toLowerCase();
  return resume.focus
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 3)
    .some((word) => haystack.includes(word));
}

/**
 * 0-100 match score for how well `resume` fits `job`. Deterministic per pair (so it
 * doesn't flicker between renders or refreshes), with a bump when the resume's stated
 * focus overlaps the job's title or skills — a data science resume should read higher
 * against a data science posting than an unrelated one, even in a fake scorer.
 */
export function resumeMatchScore(job: Job, resume: Resume | undefined): number {
  if (!resume) return 0;

  const hash = hashString(`${resume.id}:${job.id}`);
  const base = 5 + (hash % 90); // 5-94
  const boosted = sharesFocusKeyword(job, resume) ? base + 15 : base;

  return Math.min(97, Math.max(5, boosted));
}
