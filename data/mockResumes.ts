import type { Resume } from '@/types';

/**
 * A student's stored resumes. `previewLines` are relative widths (0–1) drawn as mock
 * paragraph bars inside each resume's preview bubble — a stand-in for real page content
 * until resume upload/parsing exists.
 */
export const mockResumes: Resume[] = [
  {
    id: 'engineering',
    name: 'Software Engineering Resume',
    focus: 'Software Engineering',
    updatedAt: '2026-09-12',
    previewLines: [0.9, 0.55, 0.75, 0.4, 0.65, 0.5],
  },
  {
    id: 'product',
    name: 'Product Design Resume',
    focus: 'Product Design',
    updatedAt: '2026-09-07',
    previewLines: [0.85, 0.5, 0.7, 0.35, 0.6],
  },
  {
    id: 'data',
    name: 'Data Science Resume',
    focus: 'Data Science',
    updatedAt: '2026-08-29',
    previewLines: [0.8, 0.6, 0.45, 0.7, 0.5, 0.65],
  },
];

/** Which resume is used to pre-fill the apply sheet until the user picks another. */
export const defaultResumeId = 'engineering';
