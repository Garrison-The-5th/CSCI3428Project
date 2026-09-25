/**
 * File: course-progress.test.ts
 * Description: Unit tests for what a learner has unlocked, layer quizzes included.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-09-25
 */
/**
 * The rule these cover is shared on purpose.
 *
 * The course landing page and the player both have to decide what is open, and
 * for a while only the player knew that a directed course's layer quiz waits on
 * the content above it. The landing page therefore drew that quiz unlocked,
 * offered a link into it, and the player refused to open it — so "Continue"
 * could land somewhere the next screen would not show.
 */
import {
  flattenCourse,
  moduleUnlocked,
  NO_PROGRESS,
  resumeItem,
  sectionUnlocked,
  shutLayerQuizIds,
  unlockedItemIds,
} from '@/services/course-progress';
import type { Course, LearnerProgress } from '@/services/curriculum-api';

/**
 * A directed course as the learner endpoint serves one: the content everybody
 * reads, then the quiz that asks what applies to them.
 *
 * The quiz waits on `s-intro`, which is exactly what `directedLocks` says.
 */
function directedCourse(): Course {
  return {
    id: 'c1',
    title: 'Directed',
    sequential: false,
    directedLearning: true,
    directedLocks: [{ quizId: 'layer-1', sectionId: 's-quiz', depth: 1, requires: ['s-intro'] }],
    modules: [{ id: 'm1', courseId: 'c1', number: 1, title: 'Everyone', color: null }],
    sections: [
      {
        id: 's-intro',
        courseId: 'c1',
        moduleId: 'm1',
        position: 1,
        number: '1.1',
        title: 'Intro',
        estimatedMinutes: 5,
        elements: [{ id: 'e-intro', sectionId: 's-intro', order: 1, type: 'TEXT' }],
        quizzes: [],
      },
      {
        id: 's-quiz',
        courseId: 'c1',
        moduleId: 'm1',
        position: 2,
        number: '1.2',
        title: 'Directed learning quiz 1',
        estimatedMinutes: 0,
        elements: [],
        quizzes: [{ id: 'layer-1', title: 'Which apply to you?', order: 1, questions: [] }],
      },
    ],
  } as unknown as Course;
}

const progress = (over: Partial<LearnerProgress> = {}): LearnerProgress => ({
  ...NO_PROGRESS,
  ...over,
});

describe('shutLayerQuizIds', () => {
  it('shuts a layer quiz whose content has not been read', () => {
    expect([...shutLayerQuizIds(directedCourse(), progress())]).toEqual(['layer-1']);
  });

  it('opens it once every section it waits on has been seen', () => {
    const shut = shutLayerQuizIds(directedCourse(), progress({ viewedSectionIds: ['s-intro'] }));

    expect([...shut]).toEqual([]);
  });

  /** An ordinary course carries no locks, so nothing is ever shut by this. */
  it('says nothing about a course that is not directed', () => {
    const plain = { ...directedCourse(), directedLearning: false, directedLocks: undefined };

    expect([...shutLayerQuizIds(plain as Course, progress())]).toEqual([]);
  });
});

describe('unlockedItemIds', () => {
  /*
    The bug this exists to stop. The course is *not* sequential, so the old rule
    unlocked everything — and a layer quiz is not a matter of pace.
  */
  it('holds a layer quiz shut on a course that locks nothing else', () => {
    const course = directedCourse();
    const items = flattenCourse(course);

    const unlocked = unlockedItemIds(course, items, progress());

    expect(unlocked.has('e-intro')).toBe(true);
    expect(unlocked.has('layer-1')).toBe(false);
  });

  it('lets it open once the content above it has been read', () => {
    const course = directedCourse();
    const items = flattenCourse(course);

    const unlocked = unlockedItemIds(course, items, progress({ viewedSectionIds: ['s-intro'] }));

    expect(unlocked.has('layer-1')).toBe(true);
  });

  it('still unlocks everything on an ordinary course', () => {
    const course = { ...directedCourse(), directedLocks: undefined } as Course;
    const items = flattenCourse(course);

    expect(unlockedItemIds(course, items, progress()).size).toBe(items.length);
  });
});

describe('sectionUnlocked', () => {
  it('locks the section a shut layer quiz sits in', () => {
    const course = directedCourse();
    const items = flattenCourse(course);
    const unlocked = unlockedItemIds(course, items, progress());

    expect(sectionUnlocked(course, items, unlocked, 's-intro')).toBe(true);
    expect(sectionUnlocked(course, items, unlocked, 's-quiz')).toBe(false);
  });

  it('opens it once the quiz does', () => {
    const course = directedCourse();
    const items = flattenCourse(course);
    const unlocked = unlockedItemIds(course, items, progress({ viewedSectionIds: ['s-intro'] }));

    expect(sectionUnlocked(course, items, unlocked, 's-quiz')).toBe(true);
  });

  it('never locks a module whose sections are all open', () => {
    const course = directedCourse();
    const items = flattenCourse(course);
    const unlocked = unlockedItemIds(course, items, progress({ viewedSectionIds: ['s-intro'] }));

    expect(moduleUnlocked(course, items, unlocked, course.sections)).toBe(true);
  });
});

describe('resumeItem', () => {
  /**
   * Its own documentation promises this: "anything locked is skipped, so this
   * can never hand back somewhere the player would refuse to show". That was
   * false for a directed course, and Continue jumped to the top of the course.
   */
  it('never resumes at a layer quiz that is still shut', () => {
    const course = directedCourse();
    const items = flattenCourse(course);
    const unlocked = unlockedItemIds(course, items, progress());

    const resume = resumeItem(course, items, unlocked, progress());

    expect(resume && (resume.kind === 'quiz' ? resume.quiz.id : resume.element.id)).toBe('e-intro');
  });
});
