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
  appliedCount: number;
}
