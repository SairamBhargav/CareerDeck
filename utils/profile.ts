import type { User } from '@/types';

/**
 * How to show a profile that isn't filled in yet.
 *
 * Signup asks for an email and nothing else (§3.2), and Apple only hands over a name if
 * the user lets it. So the first run of the app is a real account with no name, school
 * or graduation year, and every screen that shows those has to have an answer for it
 * that isn't a blank line or "Class of 0".
 */

type NamedUser = Pick<User, 'firstName' | 'lastName'>;

/** Initials for the avatar, or null when there is no name to take them from. */
export function initialsOf(user: NamedUser | null): string | null {
  const initials = `${user?.firstName.charAt(0) ?? ''}${user?.lastName.charAt(0) ?? ''}`.trim();
  return initials.length > 0 ? initials.toUpperCase() : null;
}

/** The name in "Hey —". Falls back to something that still reads as a greeting. */
export function greetingNameOf(user: NamedUser | null): string {
  const first = user?.firstName.trim() ?? '';
  return first.length > 0 ? first : 'there';
}

/** The line under the avatar on Profile: "Computer Science · Class of 2027". */
export function studyLineOf(user: Pick<User, 'major' | 'graduationYear'>): string | null {
  const parts: string[] = [];
  if (user.major.trim().length > 0) parts.push(user.major.trim());
  if (user.graduationYear > 0) parts.push(`Class of ${user.graduationYear}`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * The credential as the reader entered it — "Computer Science @ Purdue '27" — for showing a
 * person their own line before it is verified. On comments the database composes it from the
 * *verified* school instead (`comment_badge`), so nobody can post under a school they typed.
 */
export function credentialOf(user: Pick<User, 'major' | 'school' | 'graduationYear'> | null): string {
  const major = user?.major.trim() ?? '';
  const school = user?.school.trim() ?? '';
  let line = [major, school].filter((part) => part.length > 0).join(' @ ');
  if (user && user.graduationYear > 0) line = `${line} '${String(user.graduationYear % 100).padStart(2, '0')}`.trim();
  return line.length > 0 ? line : 'Student';
}
