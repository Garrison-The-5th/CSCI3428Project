/**
 * File: retention.ts
 * Description: How long a deleted item has left before it is cleared.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-11-14
 */

/**
 * "clears in 3 days", "clears tomorrow", or "clearing now" once it is past due.
 *
 * One function for the admin recycle bin and a course's Archive tab, so the two
 * places that show a deleted item's countdown word it the same way. The server
 * does the clearing; this only says when.
 */
export function timeLeft(deletedAt: string, retentionDays: number): string {
  const expiresAt = new Date(deletedAt).getTime() + retentionDays * 86_400_000;
  const days = Math.ceil((expiresAt - Date.now()) / 86_400_000);
  if (days <= 0) return 'clearing now';
  if (days === 1) return 'clears tomorrow';
  return `clears in ${days} days`;
}
