export interface User {
  id: string;
  firstName: string;
  lastName: string;
  displayName: string;
  school: string;
  major: string;
  graduationYear: number;
  location: string;
  preferredRoles: string[];
  preferredLocations: string[];
  resumeName: string;
  /** ISO date string of the last resume update. */
  resumeUpdatedAt: string;
  appliedCount: number;
}
