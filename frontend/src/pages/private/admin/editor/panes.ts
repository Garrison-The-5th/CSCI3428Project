/**
 * File: panes.ts
 * Description: The panes the course editor's sidebar switches between.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-09-04
 */
/**
 * Everything the authoring shell can put in its right-hand column.
 *
 * Gathered here because they are one thing to the shell: it holds a `pane` and
 * renders whichever of these matches. Naming each one separately at the top of
 * course-editor.tsx made the shell look like it depended on five unrelated
 * modules when it really depends on one idea — the set of panes.
 */
export {
  default as ArchivePane,
  type PendingVersion,
} from '@/pages/private/admin/editor/archive-pane';
export { default as CourseAccess } from '@/pages/private/admin/editor/course-access';
export { default as LandingPageEditor } from '@/pages/private/admin/editor/landing-page-editor';
export { default as QuizPane } from '@/pages/private/admin/editor/quiz-pane';
export { default as StructureEditor } from '@/pages/private/admin/editor/structure-editor';
