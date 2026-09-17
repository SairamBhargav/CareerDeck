export interface Resume {
  id: string;
  name: string;
  /** Short subtitle shown in the preview bubble, e.g. "Software Engineering". */
  focus: string;
  /** ISO date string of the last edit. */
  updatedAt: string;
  /**
   * Relative widths (0–1) for the mock paragraph lines drawn inside the preview bubble,
   * giving each resume a distinct "page" silhouette without rendering real content.
   */
  previewLines: number[];
}
