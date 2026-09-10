/**
 * File: learner-previews.ts
 * Description: The two learner pages the course editor previews.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-09-04
 */
/**
 * The learner pages the authoring shell renders as previews.
 *
 * Re-exported together because they are one idea to the editor — "show me what a
 * learner sees" — and it takes both to do it. Importing them separately said the
 * shell depended on two more things than it really does.
 *
 * These are the real pages, not preview copies of them, which is the whole point:
 * a preview built from its own markup drifts from what ships the first time
 * anybody edits one of them.
 */
export { default as CourseLanding } from '@/pages/private/learning/course-landing';
export { default as CoursePlayer } from '@/pages/private/learning/course-player';
