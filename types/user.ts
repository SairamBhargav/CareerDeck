export interface User {
  id: string;
  firstName: string;
  lastName: string;
  displayName: string;
  /** The generated pseudonym other people see (`profiles.handle`); also seeds the avatar. */
  handle: string;
  school: string;
  major: string;
  graduationYear: number;
  location: string;
  preferredRoles: string[];
  preferredLocations: string[];
  /** When the first-run tour was finished. Null: it is still owed, and the app opens on it. */
  tourCompletedAt: string | null;
  /** How many more times the blob can be changed, ever (`profiles.blob_changes` against 2). */
  blobChangesLeft: number;
}

/** The fields the profile editor can change. Identity only — preferences have their own sheet. */
export type UserIdentityEdit = Pick<
  User,
  'firstName' | 'lastName' | 'school' | 'major' | 'graduationYear' | 'location'
>;
