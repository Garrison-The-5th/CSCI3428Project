/**
 * File: due-dates.ts
 * Description: The one rule that turns a length of time into a deadline.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-09-04
 */

/**
 * The date a deadline of this many days would land on.
 *
 * A mirror of `dueDateFromDays` in the server's config/validation.ts, and it has
 * to stay one: an author setting "14 days" is shown a date here, and being shown
 * a different date from the one that will actually be stamped on the assignment
 * is worse than being shown nothing.
 *
 * Today's date plus the days, ending at 11:59 PM. The time of day it was set at
 * decides nothing, so a length is a count of whole days rather than of hours
 * from now.
 *
 * Returns null for anything that is not a whole number of days, 1 or more —
 * which is what a half-typed box holds most of the time.
 */
export function dueDateFromDays(days: number | string | null, from = new Date()): Date | null {
  const parsed = typeof days === 'string' ? Number(days.trim()) : days;
  if (parsed === null || days === '' || !Number.isInteger(parsed) || parsed < 1) return null;

  const due = new Date(from);
  // setDate rather than adding milliseconds, so the end of a month and a
  // daylight-saving change both carry properly.
  due.setDate(due.getDate() + parsed);
  due.setHours(23, 59, 0, 0);
  return due;
}

/**
 * How a deadline reads to a learner: the date, and the time it actually falls.
 *
 * The time is worth saying. "Due 14 March" leaves someone guessing whether they
 * have the day itself, and they do — until 11:59 PM.
 */
export function formatDue(iso: string | Date): string {
  const due = new Date(iso);
  return `${due.toLocaleDateString()} at 11:59 PM`;
}
