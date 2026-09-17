import type { Resume } from '@/types';

/**
 * A student's stored resumes — real PDF files bundled as local assets, each with a
 * matching page-1 thumbnail rendered from the same content so the bubble and the full
 * document agree with each other.
 */
export const mockResumes: Resume[] = [
  {
    id: 'engineering',
    name: 'Software Engineering Resume',
    focus: 'Software Engineering',
    updatedAt: '2026-09-12',
    pdf: require('@/assets/resumes/engineering.pdf'),
    thumbnail: require('@/assets/resumes/engineering.png'),
  },
  {
    id: 'product',
    name: 'Product Design Resume',
    focus: 'Product Design',
    updatedAt: '2026-09-07',
    pdf: require('@/assets/resumes/product.pdf'),
    thumbnail: require('@/assets/resumes/product.png'),
  },
  {
    id: 'data',
    name: 'Data Science Resume',
    focus: 'Data Science',
    updatedAt: '2026-08-29',
    pdf: require('@/assets/resumes/data.pdf'),
    thumbnail: require('@/assets/resumes/data.png'),
  },
  {
    id: 'quant',
    name: 'Quantitative Research Resume',
    focus: 'Quantitative Research',
    updatedAt: '2026-08-22',
    pdf: require('@/assets/resumes/quant.pdf'),
    thumbnail: require('@/assets/resumes/quant.png'),
  },
  {
    id: 'fullstack',
    name: 'Full Stack Resume',
    focus: 'Full Stack Development',
    updatedAt: '2026-08-15',
    pdf: require('@/assets/resumes/fullstack.pdf'),
    thumbnail: require('@/assets/resumes/fullstack.png'),
  },
];

/** Which resume is used to pre-fill the apply sheet until the user picks another. */
export const defaultResumeId = 'engineering';
