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
import { Course, CourseSection, LearnerProgress, quizOf } from '@/services/curriculum-api';
import { Quiz } from '@/services/quiz-api';

/**
 * One thing a learner can open: a section.
 *
 * A course is two layers, and a section is a single piece of content, so the
 * course in reading order is simply its sections. A quiz section carries its
 * quiz alongside, because "done" means something different for it — attempted,
 * rather than opened.
 */
export type CourseItem =
  | { kind: 'content'; sectionId: string; section: CourseSection }
  | { kind: 'quiz'; sectionId: string; section: CourseSection; quiz: Quiz };

/**
 * The id of a course item: its section's id, whichever kind it is.
 *
 * Exported as `idOf` too — the player and the dashboard both key their unlock
 * sets on it, and the two must agree.
 */
export function itemId(item: CourseItem): string {
  return item.sectionId;
}

export const idOf = itemId;

/**
 * Every item in the course in reading order.
 *
 * `course.sections` arrives sorted model-then-position, so this is one pass. A
 * QUIZ section whose quiz did not travel with it — a one-time link is stripped
 * from the browsing path — has nothing to open and is left out, rather than
 * offered as a blank page.
 */
export function flattenCourse(course: Course): CourseItem[] {
  return course.sections.flatMap((section): CourseItem[] => {
    if (section.type !== 'QUIZ') return [{ kind: 'content', sectionId: section.id, section }];

    const quiz = quizOf(section);
    return quiz ? [{ kind: 'quiz', sectionId: section.id, section, quiz }] : [];
  });
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
 * On a sequential course sections open one at a time: the first is always
 * available and every other waits for the one before it. Models fall out of the
 * same rule rather than being locked separately — a model is locked when none
 * of its sections are reachable.
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
  /** Removes the directed-learning layer quizzes that are still shut from a set of unlocked ids. */
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

/**
 * Whether one item counts as done, which is what opens the next one.
 *
 * A content section is done once it has been opened. A quiz section is done
 * once its quiz has been attempted — opening a quiz and walking past it is
 * exactly what a learning check exists to prevent.
 */
export function itemDoneFor(_course: Course, progress: LearnerProgress) {
  const viewed = new Set(progress.viewedSectionIds);
  const attempted = new Set(progress.attemptedQuizIds);

  return (item: CourseItem): boolean =>
    item.kind === 'quiz' ? attempted.has(item.quiz.id) : viewed.has(item.sectionId);
}

/**
 * Whether a section can be opened.
 *
 * A section with nothing to open — a quiz section whose quiz was not sent —
 * cannot block anything, and locking it would leave a padlock nobody can ever
 * open. Otherwise it is reachable exactly when the unlock walk reached it,
 * which covers both pace (a sequential course) and branch points (a layer quiz
 * that is still shut, on a course that is not sequential at all).
 */
export function sectionUnlocked(
  _course: Course,
  items: CourseItem[],
  unlocked: Set<string>,
  sectionId: string,
): boolean {
  if (!items.some((item) => item.sectionId === sectionId)) return true;
  return unlocked.has(sectionId);
}

/** A model is reachable when any of the sections inside it is. */
export function modelUnlocked(
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
 * Any recorded activity counts — a section opened or a quiz attempted — because
 * both mean the same thing to the button on the landing page: there is
 * something to come back to. Scoped to this course's own ids, since progress
 * arrives for everything the learner has ever done.
 */
export function hasStartedCourse(course: Course, progress: LearnerProgress): boolean {
  const ownSections = new Set(course.sections.map((section) => section.id));
  if (progress.viewedSectionIds.some((id) => ownSections.has(id))) return true;

  const ownQuizzes = new Set(
    course.sections.flatMap((section) => section.quizzes.map((quiz) => quiz.id)),
  );
  return progress.attemptedQuizIds.some((id) => ownQuizzes.has(id));
}

/**
 * Where Continue should drop them: the last thing they actually opened.
 *
 * Deliberately the most recently viewed item rather than the first unfinished
 * one. Somebody who read to the end of model 3 and then jumped back to re-read
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

  // `sectionViews` arrives newest first, and opening a quiz section records a
  // view like any other, so this is the last thing they had on screen.
  for (const view of progress.sectionViews ?? []) {
    const item = byId.get(view.sectionId);
    if (item && unlocked.has(view.sectionId)) return item;
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
  attemptedQuizIds: [],
};
