/**
 * Week arithmetic for the application goal.
 *
 * Weeks run Monday to Sunday: a goal that resets on Monday matches how a student
 * actually thinks about a week of applying, and it means Sunday night is the last
 * chance rather than the start of a fresh slate.
 *
 * Everything works in local time on purpose. Application dates are stored as plain
 * `YYYY-MM-DD` with no zone, and the user's own Monday is the one that matters.
 */

const MS_PER_DAY = 86_400_000;

/** Midnight on the Monday of the week containing `date`. */
export function startOfWeek(date: Date): Date {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  // getDay() is Sunday-first; shift so Monday is 0 and Sunday is 6.
  const offset = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - offset);
  return start;
}

/** Stable `YYYY-MM-DD` id for a week, being the date of its Monday. */
export function weekKey(date: Date): string {
  const start = startOfWeek(date);
  const month = String(start.getMonth() + 1).padStart(2, '0');
  const day = String(start.getDate()).padStart(2, '0');
  return `${start.getFullYear()}-${month}-${day}`;
}

/**
 * Parses a stored `YYYY-MM-DD` as a local date. `new Date('2026-09-14')` would read it
 * as UTC midnight, which lands on the previous day for anyone west of Greenwich and
 * quietly files an application into the wrong week.
 */
export function parseLocalDate(iso: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/** Whole weeks from the Monday of `from` back to the Monday of `to` — negative going forward. */
export function weeksBefore(from: Date, to: Date): number {
  const diff = startOfWeek(from).getTime() - startOfWeek(to).getTime();
  return Math.round(diff / (MS_PER_DAY * 7));
}

/** The Monday `count` weeks before the one containing `date`. */
export function weekStartBefore(date: Date, count: number): Date {
  const start = startOfWeek(date);
  start.setDate(start.getDate() - count * 7);
  return start;
}

/** "Sep 14" — used to label past weeks in the streak history. */
export function formatWeekLabel(date: Date): string {
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Days left in the week containing `date`, counting today. Sunday returns 1. */
export function daysLeftInWeek(date: Date): number {
  return 7 - ((date.getDay() + 6) % 7);
}
