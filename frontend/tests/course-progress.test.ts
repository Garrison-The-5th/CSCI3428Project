/**
 * File: course-progress.test.ts
 * Description: Unit tests for what a learner has unlocked — section by section,
 *   layer quizzes included.
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
 *
 * A course is two layers — models, and the sections inside them — and a section
 * is one piece of content. So the unit everything here locks, unlocks and
 * resumes at is the section.
 */
import {
  flattenCourse,
  hasStartedCourse,
  idOf,
  itemDoneFor,
  itemId,
  modelUnlocked,
  NO_PROGRESS,
  resumeItem,
  sectionUnlocked,
  shutLayerQuizIds,
  unlockedItemIds,
} from '@/services/course-progress';
import type { Course, CourseSection, LearnerProgress } from '@/services/curriculum-api';

/** One section of a given type, with only what these rules read. */
function section(
  id: string,
  number: string,
  type: CourseSection['type'],
  quizzes: Array<{ id: string }> = [],
) {
  return {
    id,
    courseId: 'c1',
    modelId: 'm1',
    position: Number(number.split('.')[1]),
    number,
    title: id,
    estimatedMinutes: 5,
    type,
    quizzes: quizzes.map((quiz) => ({ ...quiz, title: quiz.id, questions: [] })),
  };
}

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
    models: [{ id: 'm1', courseId: 'c1', number: 1, title: 'Everyone', color: null }],
    sections: [
      section('s-intro', '1.1', 'TEXT'),
      section('s-quiz', '1.2', 'QUIZ', [{ id: 'layer-1' }]),
    ],
  } as unknown as Course;
}

/** A sequential lesson: text, a learning check, a video, then more text. */
function sequentialCourse(): Course {
  return {
    id: 'c1',
    title: 'Sequential',
    sequential: true,
    models: [{ id: 'm1', courseId: 'c1', number: 1, title: 'Basics', color: null }],
    sections: [
      section('s-read', '1.1', 'TEXT'),
      section('s-check', '1.2', 'QUIZ', [{ id: 'check-1' }]),
      section('s-watch', '1.3', 'YOUTUBE'),
      section('s-more', '1.4', 'TEXT'),
    ],
  } as unknown as Course;
}

const progress = (over: Partial<LearnerProgress> = {}): LearnerProgress => ({
  ...NO_PROGRESS,
  ...over,
});

describe('flattenCourse', () => {
  it('yields one item per section, in order, keyed by the section', () => {
    const items = flattenCourse(sequentialCourse());

    expect(items.map((item) => [itemId(item), item.kind])).toEqual([
      ['s-read', 'content'],
      ['s-check', 'quiz'],
      ['s-watch', 'content'],
      ['s-more', 'content'],
    ]);
    // The player and the dashboard key on the same id, under either name.
    expect(items.map(idOf)).toEqual(items.map(itemId));
    // A quiz item carries its quiz; nothing carries an element.
    expect(items[1]).toMatchObject({ kind: 'quiz', quiz: { id: 'check-1' } });
    for (const item of items) expect(item).not.toHaveProperty('element');
  });

  /** A one-time link is stripped on the browsing path, leaving nothing to open. */
  it('leaves out a quiz section whose quiz was not sent', () => {
    const course = sequentialCourse();
    course.sections[1].quizzes = [];

    expect(flattenCourse(course).map(itemId)).toEqual(['s-read', 's-watch', 's-more']);
  });
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

    expect(unlocked.has('s-intro')).toBe(true);
    expect(unlocked.has('s-quiz')).toBe(false);
  });

  it('lets it open once the content above it has been read', () => {
    const course = directedCourse();
    const items = flattenCourse(course);

    const unlocked = unlockedItemIds(course, items, progress({ viewedSectionIds: ['s-intro'] }));

    expect(unlocked.has('s-quiz')).toBe(true);
  });

  it('still unlocks everything on an ordinary course', () => {
    const course = { ...directedCourse(), directedLocks: undefined } as Course;
    const items = flattenCourse(course);

    expect(unlockedItemIds(course, items, progress()).size).toBe(items.length);
  });

  /** A sequential course unlocks section by section. */
  it('opens only the first section of a sequential course that has not been started', () => {
    const course = sequentialCourse();
    const items = flattenCourse(course);

    expect([...unlockedItemIds(course, items, progress())]).toEqual(['s-read']);
  });

  it('opens the next section once the one before it has been viewed', () => {
    const course = sequentialCourse();
    const items = flattenCourse(course);

    const unlocked = unlockedItemIds(course, items, progress({ viewedSectionIds: ['s-read'] }));

    expect([...unlocked]).toEqual(['s-read', 's-check']);
  });

  /**
   * Opening a quiz is not doing it. A learning check has to be attempted before
   * the section after it opens — viewing its section is not enough.
   */
  it('holds the section after a quiz until the quiz has been attempted', () => {
    const course = sequentialCourse();
    const items = flattenCourse(course);

    const opened = unlockedItemIds(
      course,
      items,
      progress({ viewedSectionIds: ['s-read', 's-check'] }),
    );
    expect(opened.has('s-watch')).toBe(false);

    const attempted = unlockedItemIds(
      course,
      items,
      progress({ viewedSectionIds: ['s-read', 's-check'], attemptedQuizIds: ['check-1'] }),
    );
    expect([...attempted]).toEqual(['s-read', 's-check', 's-watch']);
  });
});

describe('itemDoneFor', () => {
  it('counts content as done when its section was viewed, and a quiz when it was attempted', () => {
    const course = sequentialCourse();
    const [read, check] = flattenCourse(course);

    const before = itemDoneFor(course, progress());
    expect(before(read)).toBe(false);
    expect(before(check)).toBe(false);

    const after = itemDoneFor(
      course,
      progress({ viewedSectionIds: ['s-read', 's-check'], attemptedQuizIds: [] }),
    );
    expect(after(read)).toBe(true);
    expect(after(check)).toBe(false);

    const sat = itemDoneFor(course, progress({ attemptedQuizIds: ['check-1'] }));
    expect(sat(check)).toBe(true);
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

  it('locks the sections a sequential course has not reached', () => {
    const course = sequentialCourse();
    const items = flattenCourse(course);
    const unlocked = unlockedItemIds(course, items, progress());

    expect(sectionUnlocked(course, items, unlocked, 's-read')).toBe(true);
    expect(sectionUnlocked(course, items, unlocked, 's-check')).toBe(false);
    expect(sectionUnlocked(course, items, unlocked, 's-more')).toBe(false);
  });

  it('never locks a model whose sections are all open', () => {
    const course = directedCourse();
    const items = flattenCourse(course);
    const unlocked = unlockedItemIds(course, items, progress({ viewedSectionIds: ['s-intro'] }));

    expect(modelUnlocked(course, items, unlocked, course.sections)).toBe(true);
  });

  it('opens a model as soon as one section inside it is reachable', () => {
    const course = sequentialCourse();
    const items = flattenCourse(course);
    const unlocked = unlockedItemIds(course, items, progress());

    expect(modelUnlocked(course, items, unlocked, course.sections)).toBe(true);
    expect(modelUnlocked(course, items, unlocked, course.sections.slice(2))).toBe(false);
  });
});

describe('hasStartedCourse', () => {
  it('is true once a section of this course was viewed or one of its quizzes attempted', () => {
    const course = sequentialCourse();

    expect(hasStartedCourse(course, progress())).toBe(false);
    expect(hasStartedCourse(course, progress({ viewedSectionIds: ['elsewhere'] }))).toBe(false);
    expect(hasStartedCourse(course, progress({ viewedSectionIds: ['s-read'] }))).toBe(true);
    expect(hasStartedCourse(course, progress({ attemptedQuizIds: ['check-1'] }))).toBe(true);
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

    expect(resume && itemId(resume)).toBe('s-intro');
  });

  /** Continue goes to the last section they opened, not the first unfinished one. */
  it('resumes at the section they opened most recently', () => {
    const course = { ...sequentialCourse(), sequential: false } as Course;
    const items = flattenCourse(course);
    const seen = progress({
      viewedSectionIds: ['s-read', 's-watch'],
      // Newest first, as the server sends it.
      sectionViews: [
        { sectionId: 's-read', viewedAt: '2026-11-02T10:00:00Z' },
        { sectionId: 's-watch', viewedAt: '2026-11-01T10:00:00Z' },
      ],
    });
    const unlocked = unlockedItemIds(course, items, seen);

    expect(itemId(resumeItem(course, items, unlocked, seen)!)).toBe('s-read');
  });

  it('falls back to the first unfinished section when nothing was recorded', () => {
    const course = sequentialCourse();
    const items = flattenCourse(course);
    const seen = progress({ viewedSectionIds: ['s-read'] });
    const unlocked = unlockedItemIds(course, items, seen);

    expect(itemId(resumeItem(course, items, unlocked, seen)!)).toBe('s-check');
  });
});
