/**
 * File: course-progress.ts
 * Description: What a learner has unlocked in a course, worked out in one place.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-09-25
 */
/**
 * Where a learner has got to, and what that opens.
 *
 * Lives outside the pages because two of them now need the same answer. The
 * player has always needed it to decide what the rail may open; the course
 * landing page needs it too, so its quick links can jump straight to a section
 * and show a padlock on the ones that are not reachable yet. A second copy of
 * the rule would drift, and the two would disagree about what is locked — which
 * is the one thing a learner would definitely notice.
 */
import {
  Course,
  CourseSection,
  LearnerProgress,
  sectionContent,
  SectionElement,
} from '@/services/curriculum-api';
import { Quiz } from '@/services/quiz-api';

/** One thing a learner can open, tagged with the section it belongs to. */
export type CourseItem =
  | { kind: 'element'; sectionId: string; element: SectionElement }
  | { kind: 'quiz'; sectionId: string; quiz: Quiz };

export function itemId(item: CourseItem): string {
  return item.kind === 'element' ? item.element.id : item.quiz.id;
}

/**
 * Every item in the course in reading order.
 *
 * `sectionContent` interleaves elements and quizzes by the sequence they share,
 * so a quiz dropped into the middle of a section is reached in the right place
 * rather than after everything else.
 */
export function flattenCourse(course: Course): CourseItem[] {
  return course.sections.flatMap((section) =>
    sectionContent(section).map((item): CourseItem =>
      item.kind === 'element'
        ? { kind: 'element', sectionId: section.id, element: item.element }
        : { kind: 'quiz', sectionId: section.id, quiz: item.quiz },
    ),
  );
}

/**
 * Sections that predate per-element tracking.
 *
 * Progress used to be recorded only per section, so an old account has sections
 * marked viewed with no element rows behind them. Reading that as "nothing in
 * this section has been seen" would re-lock courses people had already worked
 * through. A viewed section with no element views at all is therefore treated as
 * fully seen; the moment any element view lands for it — which the first click
 * does — the fine-grained rule takes over.
 */
export function legacySectionIds(course: Course, progress: LearnerProgress): Set<string> {
  const viewedSections = new Set(progress.viewedSectionIds);
  const viewedElements = new Set(progress.viewedElementIds ?? []);

  const legacy = new Set<string>();
  for (const section of course.sections) {
    if (!viewedSections.has(section.id)) continue;
    if (!section.elements.some((element) => viewedElements.has(element.id))) legacy.add(section.id);
  }
  return legacy;
}

/**
 * Layer quizzes still waiting on the content above them.
 *
 * A layer quiz on a directed course is the end of its layer — read what everyone
 * at this level reads, then say what applies to you next — so it stays shut until
 * that content has been seen. The server names the sections each one waits on
 * rather than sending a rule, so this only has to ask a question the browser can
 * already answer.
 *
 * Independent of `sequential`: a directed course gates at its branch points
 * whether or not its author also asked for step-by-step unlocking, because the
 * gate is what the branching is made of rather than a preference about pace.
 *
 * Exported because the player computes its own unlock walk and has to shut the
 * same doors. The rule being in one place is the point — the landing page and
 * the player disagreed about this for a while, and the landing page offered a
 * link into a quiz the player then refused to open.
 */
export function shutLayerQuizIds(course: Course, progress: LearnerProgress): Set<string> {
  const viewed = new Set(progress.viewedSectionIds);
  const shut = new Set<string>();

  for (const lock of course.directedLocks ?? []) {
    if (lock.requires.some((sectionId) => !viewed.has(sectionId))) shut.add(lock.quizId);
  }

  return shut;
}

/**
 * What the learner has unlocked.
 *
 * On a sequential course items open one at a time: the first is always available
 * and every other waits for the one before it. Sections and modules fall out of
 * the same rule rather than being locked separately — a section is locked when
 * none of its items are reachable, and a module when none of its sections are.
 *
 * Non-sequential courses lock nothing — except a layer quiz, which is not a
 * matter of pace. Both passes end by shutting those, so everything downstream of
 * this set agrees about what is reachable.
 */
export function unlockedItemIds(
  course: Course,
  items: CourseItem[],
  progress: LearnerProgress,
): Set<string> {
  const shut = shutLayerQuizIds(course, progress);
  const shutLayers = (ids: Set<string>) => {
    for (const item of items) {
      if (item.kind === 'quiz' && shut.has(item.quiz.id)) ids.delete(itemId(item));
    }
    return ids;
  };

  const unlocked = new Set<string>();
  if (!course.sequential) {
    for (const item of items) unlocked.add(itemId(item));
    return shutLayers(unlocked);
  }

  const done = itemDoneFor(course, progress);

  for (const [index, item] of items.entries()) {
    // The very first item is always viewable — otherwise a sequential course
    // could never be started.
    if (index === 0) {
      unlocked.add(itemId(item));
      continue;
    }

    const previous = items[index - 1];
    if (!unlocked.has(itemId(previous)) || !done(previous)) break;
    unlocked.add(itemId(item));
  }

  return shutLayers(unlocked);
}

/** Whether one item counts as done, which is what opens the next one. */
export function itemDoneFor(course: Course, progress: LearnerProgress) {
  const viewedElements = new Set(progress.viewedElementIds ?? []);
  const attempted = new Set(progress.attemptedQuizIds);
  const legacy = legacySectionIds(course, progress);

  return (item: CourseItem): boolean =>
    item.kind === 'quiz'
      ? attempted.has(item.quiz.id)
      : viewedElements.has(item.element.id) || legacy.has(item.sectionId);
}

/**
 * A section is reachable when any of its items is.
 *
 * The pace setting is checked second rather than first, because a layer quiz's
 * section can be shut on a course that is not sequential at all — the branch
 * point is part of how the course is built, not a preference about how fast to
 * go through it.
 */
export function sectionUnlocked(
  course: Course,
  items: CourseItem[],
  unlocked: Set<string>,
  sectionId: string,
): boolean {
  const own = items.filter((item) => item.sectionId === sectionId);
  // A section with no content at all cannot block anything, and locking it would
  // leave a padlock nobody can ever open.
  if (own.length === 0) return true;
  if (own.some((item) => unlocked.has(itemId(item)))) return true;
  return !course.sequential && !own.some((item) => item.kind === 'quiz');
}

/** A module is reachable when any of the sections inside it is. */
export function moduleUnlocked(
  course: Course,
  items: CourseItem[],
  unlocked: Set<string>,
  sections: CourseSection[],
): boolean {
  if (sections.length === 0) return true;
  return sections.some((section) => sectionUnlocked(course, items, unlocked, section.id));
}

/**
 * Whether they have started this course at all.
 *
 * Any recorded activity counts — a section opened, an element read, a quiz
 * attempted — because all three mean the same thing to the button on the landing
 * page: there is something to come back to. Scoped to this course's own ids,
 * since progress arrives for everything the learner has ever done.
 */
export function hasStartedCourse(course: Course, progress: LearnerProgress): boolean {
  const ownSections = new Set(course.sections.map((section) => section.id));
  if (progress.viewedSectionIds.some((id) => ownSections.has(id))) return true;

  const ownElements = new Set(
    course.sections.flatMap((section) => section.elements.map((element) => element.id)),
  );
  if ((progress.viewedElementIds ?? []).some((id) => ownElements.has(id))) return true;

  const ownQuizzes = new Set(
    course.sections.flatMap((section) => section.quizzes.map((quiz) => quiz.id)),
  );
  return progress.attemptedQuizIds.some((id) => ownQuizzes.has(id));
}

/**
 * Where Continue should drop them: the last thing they actually opened.
 *
 * Deliberately the most recently viewed item rather than the first unfinished
 * one. Somebody who read to the end of module 3 and then jumped back to re-read
 * 1.2 is *at* 1.2, and "Continue" that threw them forward to the first thing
 * they had not ticked would be answering a different question.
 *
 * Falls back to the first unfinished item, and then to the very start — which is
 * what a learner who has opened nothing, or whose last item has since been
 * deleted, should get. Anything locked is skipped, so this can never hand back
 * somewhere the player would refuse to show.
 */
export function resumeItem(
  course: Course,
  items: CourseItem[],
  unlocked: Set<string>,
  progress: LearnerProgress,
): CourseItem | null {
  const byId = new Map(items.map((item) => [itemId(item), item]));

  // `elementViews` arrives newest first. Quizzes are not in it — an attempt is
  // not a "view" — so a learner whose last act was a quiz resumes at the last
  // element they read, which is the nearest honest answer.
  for (const view of progress.elementViews ?? []) {
    const item = byId.get(view.elementId);
    if (item && unlocked.has(view.elementId)) return item;
  }

  const done = itemDoneFor(course, progress);
  return (
    items.find((item) => unlocked.has(itemId(item)) && !done(item)) ??
    items.find((item) => unlocked.has(itemId(item))) ??
    null
  );
}

/** An empty progress record, for the authoring preview and for a failed load. */
export const NO_PROGRESS: LearnerProgress = {
  viewedSectionIds: [],
  viewedElementIds: [],
  attemptedQuizIds: [],
};
