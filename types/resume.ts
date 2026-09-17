import type { ImageSourcePropType } from 'react-native';

export interface Resume {
  id: string;
  name: string;
  /** Short subtitle used elsewhere in the app, e.g. "Software Engineering". */
  focus: string;
  /** ISO date string of the last edit. */
  updatedAt: string;
  /** The real PDF file, bundled locally — require('@/assets/resumes/x.pdf'). */
  pdf: number;
  /** A rendered page-1 thumbnail, shown directly on the bubble without opening it. */
  thumbnail: ImageSourcePropType;
}
