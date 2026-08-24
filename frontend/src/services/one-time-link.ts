/**
 * File: one-time-link.ts
 * Description: The rules a one-time link quiz set has to obey, stated once.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Date: 2026-08-14
 */
/**
 * One-time link quizzes.
 *
 * A one-time link is sent to an address, opened once, and is then closed to that
 * person for good. The grading half has always existed: the server knows the
 * kind, refuses a second attempt, keeps the paper for the admin dashboard, and
 * hides the quiz from the Quizzes tab even for somebody signed in with the
 * address it went to. This module holds what the authoring half needs.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHERE ONE MAY LIVE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The structural question was whether a one-time quiz could own a section, given
 * that a quiz set stores one section per quiz — the section is the row in the
 * list, and what carries the name, the minutes, the colour and the order. It can,
 * in a quiz set only, and the server says so in `enforceTypeRules`:
 *
 *   - a QUIZ_SET section  — allowed. That section is authoring furniture, not
 *                           somewhere a learner browses to. What keeps the quiz
 *                           unreachable except through its link is
 *                           `BROWSABLE_QUIZ_TYPES`, the LINK-only assignment
 *                           that delivers it, and `redactCourse` dropping it
 *                           from the signed-in browsing path — none of which
 *                           depended on it being sectionless.
 *   - a LESSON section    — refused. A lesson section sits in a run of content
 *                           somebody walks through, so a quiz in one is reached
 *                           by reading the lesson, which is the one thing a
 *                           one-time link must never be.
 *   - no section at all   — allowed, and unchanged: that is a one-time quiz
 *                           created from the Create a Quiz page.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE SET, ONE SECTION, ONE QUIZ
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A link is issued for a whole course. So a second quiz sitting beside a
 * one-time link would be handed over with it, and would still be open to anyone
 * who kept the URL after the one-time quiz closed itself — which would make
 * "one attempt, then gone" false for everything except the quiz it was written
 * about.
 *
 * The rule that follows is `ONE_TIME_SET_RULE` below, and it is enforced from
 * both ends so that neither order of operations gets around it:
 *
 *   - the picker will not offer One-time link once a set has more than one quiz,
 *     and `QuizService.assertOneTimeIsAlone` refuses it on the server;
 *   - adding a quiz to a set whose quiz is already one-time is refused, in the
 *     pane here and in `CurriculumService.createSection`.
 *
 * Sharing itself is unchanged and already built: a one-time quiz set is sent
 * with an `AssignmentType.LINK` assignment from the course's Access pane, which
 * mints the token, handles expiry, revoke and resend, and whose
 * `markQuizCompleted` is what closes the link when the paper goes in.
 */

/** Shown wherever the one-quiz rule stops something from happening. */
export const ONE_TIME_SET_RULE =
  'A one-time link has to be the only quiz in its set — the link opens the whole set, ' +
  'so anything beside it would be handed over too.';

/**
 * Whether a quiz in this set may be made a one-time link.
 *
 * `sectionCount` is the number of quizzes in the set, because a quiz set stores
 * one section per quiz. Anything past the first means the set already holds
 * something a link would carry along with it.
 */
export function canBeOneTime(sectionCount: number): boolean {
  return sectionCount <= 1;
}
