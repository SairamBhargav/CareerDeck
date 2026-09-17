import type { Resume } from '@/types';

/**
 * A student's stored resumes. `previewLines` back the bubble's mock page silhouette;
 * everything else (summary, education, experience, skills) is the real content shown
 * when a bubble is opened in the full-page viewer.
 */
export const mockResumes: Resume[] = [
  {
    id: 'engineering',
    name: 'Software Engineering Resume',
    focus: 'Software Engineering',
    updatedAt: '2026-09-12',
    previewLines: [0.9, 0.55, 0.75, 0.4, 0.65, 0.5],
    contactLine: 'Dallas, TX · aswaanth.k@utdallas.edu · (469) 555-0142 · github.com/aswaanthk',
    summary:
      'Computer Science junior focused on backend systems and distributed infrastructure, with internship experience shipping production services and a habit of profiling before optimizing.',
    education: [
      {
        school: 'University of Texas at Dallas',
        degree: 'B.S. Computer Science',
        period: 'Aug 2023 – May 2027',
        detail: "GPA 3.82 · Dean's List, 4 semesters",
      },
    ],
    experience: [
      {
        role: 'Software Engineering Intern',
        organization: 'Local FinTech Startup',
        period: 'Jun 2026 – Aug 2026',
        bullets: [
          'Built a rate-limiting middleware in Go that cut API timeout incidents by 40%',
          'Migrated a legacy cron pipeline to event-driven queues, reducing processing lag from 12 minutes to under 90 seconds',
          'Wrote integration tests covering the payments retry path, catching 3 production-bound bugs in review',
        ],
      },
      {
        role: 'Undergraduate Research Assistant',
        organization: 'UT Dallas Systems Lab',
        period: 'Jan 2026 – Present',
        bullets: [
          'Benchmarked task-scheduling algorithms across 6 cluster configurations for a distributed runner',
          'Co-authored an internal report comparing consistency models for a course-project database engine',
        ],
      },
    ],
    skills: ['Python', 'Go', 'C++', 'Distributed Systems', 'PostgreSQL', 'Docker', 'Git', 'Linux'],
  },
  {
    id: 'product',
    name: 'Product Design Resume',
    focus: 'Product Design',
    updatedAt: '2026-09-07',
    previewLines: [0.85, 0.5, 0.7, 0.35, 0.6],
    contactLine: 'Dallas, TX · aswaanth.k@utdallas.edu · (469) 555-0142 · aswaanthk.design',
    summary:
      'Computer Science student with a design-engineering hybrid background — prototypes fast in Figma, then builds the real thing when a team needs someone who can do both.',
    education: [
      {
        school: 'University of Texas at Dallas',
        degree: 'B.S. Computer Science, Human-Computer Interaction minor',
        period: 'Aug 2023 – May 2027',
        detail: "GPA 3.82 · Dean's List, 4 semesters",
      },
    ],
    experience: [
      {
        role: 'Product Design Intern',
        organization: 'Campus Startup Studio',
        period: 'Jun 2026 – Aug 2026',
        bullets: [
          'Redesigned the onboarding flow for a student marketplace app, raising signup completion from 61% to 78%',
          'Ran 12 usability sessions and turned findings into a component library adopted by two other teams',
          'Prototyped a redesigned checkout flow in Figma and handed off specs directly to engineering',
        ],
      },
      {
        role: 'UX Design Lead',
        organization: 'UT Dallas Design Club',
        period: 'Sep 2025 – Present',
        bullets: [
          'Lead a team of 5 student designers through weekly critique and a semester-long client project',
          "Built the club's first design system, cutting new-member ramp-up time roughly in half",
        ],
      },
    ],
    skills: ['Figma', 'User Research', 'Prototyping', 'Design Systems', 'HTML/CSS', 'Usability Testing'],
  },
  {
    id: 'data',
    name: 'Data Science Resume',
    focus: 'Data Science',
    updatedAt: '2026-08-29',
    previewLines: [0.8, 0.6, 0.45, 0.7, 0.5, 0.65],
    contactLine: 'Dallas, TX · aswaanth.k@utdallas.edu · (469) 555-0142 · github.com/aswaanthk',
    summary:
      'Computer Science student focused on applied machine learning, comfortable moving from a messy dataset to a validated model and a clear write-up.',
    education: [
      {
        school: 'University of Texas at Dallas',
        degree: 'B.S. Computer Science, Statistics minor',
        period: 'Aug 2023 – May 2027',
        detail: "GPA 3.82 · Dean's List, 4 semesters",
      },
    ],
    experience: [
      {
        role: 'Data Science Intern',
        organization: 'Regional Healthcare Analytics Firm',
        period: 'Jun 2026 – Aug 2026',
        bullets: [
          'Built a patient no-show prediction model (gradient boosted trees) that improved scheduling accuracy by 22%',
          'Cleaned and joined five years of appointment records across inconsistent legacy schemas',
          'Presented findings to a non-technical stakeholder group and shipped the model behind a lightweight internal API',
        ],
      },
      {
        role: 'Course Project — Kaggle Competition',
        organization: 'UT Dallas Applied ML Course',
        period: 'Jan 2026 – May 2026',
        bullets: [
          'Placed in the top 8% of a public leaderboard predicting housing prices using feature engineering and stacked models',
          'Wrote up methodology and error analysis in a shared class report',
        ],
      },
    ],
    skills: ['Python', 'pandas', 'scikit-learn', 'SQL', 'PyTorch', 'Statistics', 'Data Visualization'],
  },
];

/** Which resume is used to pre-fill the apply sheet until the user picks another. */
export const defaultResumeId = 'engineering';
