/**
 * File: curriculum-service.test.ts
 * Description: Unit tests for the course numbering grid, content ordering and
 *   the recycle bin rules.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
import CurriculumGateway from '@/gateways/curriculum-gateway/curriculum-gateway';
import QuizGateway from '@/gateways/quiz-gateway/quiz-gateway';
import CurriculumService, {
  RECYCLE_BIN_DAYS,
  toNumber,
  toSortKey,
} from '@/services/curriculum-service/curriculum-service';

jest.mock('@/gateways/curriculum-gateway/curriculum-gateway');
jest.mock('@/gateways/quiz-gateway/quiz-gateway');
jest.mock('@/services/auth-service/auth-service');
jest.mock('@/services/enrolment-service/enrolment-service');
jest.mock('@/services/publication-service/publication-service');

const gateway = CurriculumGateway as jest.Mocked<typeof CurriculumGateway>;
const quizGateway = QuizGateway as jest.Mocked<typeof QuizGateway>;

/** Runs a transaction callback against a stub client. */
function passThroughTransaction() {
  (gateway.runTransaction as unknown as jest.Mock).mockImplementation(
    async (fn: (db: unknown) => unknown) => fn({}),
  );
}

/**
 * Enough of the gateway for a quiz set to be built end to end.
 *
 * A set is now three writes rather than one — the course, the row that carries
 * the quiz's name, and the quiz — so the two tests that exercise it need the
 * same scaffolding and share it rather than each half-building one.
 */
function stubQuizSetCreation() {
  passThroughTransaction();
  gateway.createCourse.mockResolvedValue({ id: 'q1', title: 'Fire safety' } as never);
  gateway.createModule.mockResolvedValue({} as never);
  gateway.getCourseById.mockResolvedValue({ id: 'q1', title: 'Fire safety' } as never);
  gateway.getModules.mockResolvedValue([{ id: 'm1', number: 1 }] as never);
  gateway.getSectionsForRenumber.mockResolvedValue([] as never);
  gateway.createSection.mockResolvedValue({ id: 's1' } as never);
  gateway.getSectionById.mockResolvedValue({ id: 's1', courseId: 'q1' } as never);
  gateway.getLastContentOrder.mockResolvedValue(0 as never);
  quizGateway.findOneTimeQuiz.mockResolvedValue(null as never);
  quizGateway.createQuiz.mockResolvedValue({ id: 'quiz-1' } as never);
}

describe('toNumber and toSortKey', () => {
  it('renders the number a learner sees', () => {
    expect(toNumber(2, 3)).toBe('2.3');
    expect(toNumber(1, 1)).toBe('1.1');
  });

  /**
   * Zero padding is the whole point: under plain string comparison "1.10"
   * sorts before "1.2", which would silently reorder any course with ten or
   * more sections in a module.
   */
  it('produces a sort key that orders numerically', () => {
    expect(toSortKey(2, 3)).toBe('000002.000003');

    const keys = [toSortKey(1, 2), toSortKey(1, 10), toSortKey(1, 1)];
    expect([...keys].sort()).toEqual([toSortKey(1, 1), toSortKey(1, 2), toSortKey(1, 10)]);
  });

  it('orders across modules before sections', () => {
    const keys = [toSortKey(2, 1), toSortKey(1, 9), toSortKey(10, 1)];
    expect([...keys].sort()).toEqual([toSortKey(1, 9), toSortKey(2, 1), toSortKey(10, 1)]);
  });
});

describe('createCourse', () => {
  it('rejects a blank title', async () => {
    await expect(CurriculumService.createCourse('  ')).rejects.toThrow(/required/);
    await expect(CurriculumService.createCourse(undefined)).rejects.toThrow(/required/);
  });

  /** A section lives inside a module, so a course with none has nowhere to put them. */
  it('creates a first module so a section can be added immediately', async () => {
    gateway.createCourse.mockResolvedValue({ id: 'c1', title: 'New' } as never);
    gateway.createModule.mockResolvedValue({} as never);
    gateway.getCourseById.mockResolvedValue({ id: 'c1' } as never);

    await CurriculumService.createCourse('  New  ');

    expect(gateway.createCourse).toHaveBeenCalledWith('New', 'LESSON', null);
    expect(gateway.createModule).toHaveBeenCalledWith(
      expect.objectContaining({ courseId: 'c1', number: 1 }),
    );
  });

  /**
   * Ownership is what makes a lesson somebody's rather than every admin's, and
   * this is the only route that can establish it — a course is created once.
   */
  it('records who created it', async () => {
    gateway.createCourse.mockResolvedValue({ id: 'c1', title: 'New' } as never);
    gateway.createModule.mockResolvedValue({} as never);
    gateway.getCourseById.mockResolvedValue({ id: 'c1' } as never);

    await CurriculumService.createCourse('New', undefined, 7);

    expect(gateway.createCourse).toHaveBeenCalledWith('New', 'LESSON', 7);
  });

  /**
   * A quiz set is the same Course underneath, which is what buys it publishing,
   * versioning and access for nothing. The kind is the only difference, and its
   * single module is named after the set rather than "Module 1" — an author never
   * sees that module, but the content previews do.
   */
  it('creates a quiz set as a course of its own kind', async () => {
    stubQuizSetCreation();

    await CurriculumService.createQuizSet('  Fire safety  ');

    expect(gateway.createCourse).toHaveBeenCalledWith('Fire safety', 'QUIZ_SET', null);
    expect(gateway.createModule).toHaveBeenCalledWith(
      expect.objectContaining({ courseId: 'q1', number: 1, title: 'Fire safety' }),
    );
  });

  /**
   * A set holds one quiz and only ever one, so the empty set an author used to
   * land in was a state with a single legal move in it. The quiz is made with
   * the container, and both it and the row carrying its name take the name the
   * author typed.
   */
  it('creates a quiz set holding its one quiz', async () => {
    stubQuizSetCreation();

    await CurriculumService.createQuizSet('  Fire safety  ');

    expect(gateway.createSection).toHaveBeenCalledWith(
      expect.objectContaining({ courseId: 'q1', title: 'Fire safety' }),
      expect.anything(),
    );
    expect(quizGateway.createQuiz).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Fire safety', sectionId: 's1', type: 'EXAM' }),
    );
  });
});

describe('updateCourse', () => {
  beforeEach(() => {
    gateway.getCourseById.mockResolvedValue({ id: 'c1', title: 'Existing' } as never);
    gateway.updateCourse.mockResolvedValue({} as never);
  });

  it('refuses an unknown course', async () => {
    gateway.getCourseById.mockResolvedValue(null as never);
    await expect(CurriculumService.updateCourse('missing', {})).rejects.toThrow(/not found/);
  });

  it('refuses an empty title', async () => {
    await expect(CurriculumService.updateCourse('c1', { title: '  ' })).rejects.toThrow();
  });

  /**
   * Going live must take a snapshot, or the course would be flagged published
   * with nothing for a learner to read.
   */
  it('refuses to publish through the update route', async () => {
    await expect(CurriculumService.updateCourse('c1', { published: true })).rejects.toThrow(
      /use the publish endpoint/,
    );
  });

  it('allows unpublishing, which needs no new version', async () => {
    await CurriculumService.updateCourse('c1', { published: false });
    expect(gateway.updateCourse).toHaveBeenCalledWith(
      'c1',
      expect.objectContaining({ published: false }),
    );
  });

  it('rejects an unparseable due date', async () => {
    await expect(CurriculumService.updateCourse('c1', { dueDate: 'not a date' })).rejects.toThrow(
      /not a valid date/,
    );
  });

  it('treats an empty due date as clearing it', async () => {
    await CurriculumService.updateCourse('c1', { dueDate: '' });
    expect(gateway.updateCourse).toHaveBeenCalledWith(
      'c1',
      expect.objectContaining({ dueDate: null }),
    );
  });

  it('cleans and de-duplicates tag lists', async () => {
    await CurriculumService.updateCourse('c1', { tags: [' safety ', 'safety', '', 'fire'] });
    expect(gateway.updateCourse).toHaveBeenCalledWith(
      'c1',
      expect.objectContaining({ tags: ['safety', 'fire'] }),
    );
  });

  it('enforces the title length limit', async () => {
    await expect(CurriculumService.updateCourse('c1', { title: 'x'.repeat(500) })).rejects.toThrow(
      /too long/,
    );
  });

  it('leaves untouched fields out of the write', async () => {
    await CurriculumService.updateCourse('c1', { title: 'Renamed' });
    const payload = gateway.updateCourse.mock.calls[0][1] as Record<string, unknown>;
    expect(payload).toHaveProperty('title', 'Renamed');
    expect(payload).not.toHaveProperty('description');
  });
});

describe('createSection', () => {
  beforeEach(() => {
    passThroughTransaction();
    gateway.getCourseById.mockResolvedValue({ id: 'c1' } as never);
    gateway.getSectionById.mockResolvedValue({ id: 'm-new' } as never);
    gateway.createSection.mockResolvedValue({ id: 'm-new' } as never);
    gateway.updateSection.mockResolvedValue({} as never);
    gateway.updateModule.mockResolvedValue({} as never);
    gateway.getLowestModuleNumber.mockResolvedValue(1 as never);
    gateway.getSectionsForRenumber.mockResolvedValue([] as never);
  });

  it('refuses a course with no modules', async () => {
    gateway.getModules.mockResolvedValue([] as never);
    await expect(CurriculumService.createSection('c1', { title: 'M' })).rejects.toThrow(
      /add a module before adding sections/,
    );
  });

  it('requires a title', async () => {
    gateway.getModules.mockResolvedValue([{ id: 's1', number: 1 }] as never);
    await expect(CurriculumService.createSection('c1', { title: '' })).rejects.toThrow(/required/);
  });

  /** No module named means the last one — where an author adding in order expects it. */
  it('defaults to the last module', async () => {
    gateway.getModules.mockResolvedValue([
      { id: 's1', number: 1 },
      { id: 's2', number: 2 },
    ] as never);

    await CurriculumService.createSection('c1', { title: 'M' });

    expect(gateway.createSection).toHaveBeenCalledWith(
      expect.objectContaining({ moduleId: 's2' }),
      expect.anything(),
    );
  });

  it('refuses a module that is not in this course', async () => {
    gateway.getModules.mockResolvedValue([{ id: 's1', number: 1 }] as never);
    await expect(
      CurriculumService.createSection('c1', { title: 'M', moduleId: 'elsewhere' }),
    ).rejects.toThrow(/not found in this course/);
  });

  it('renumbers the course after inserting', async () => {
    gateway.getModules.mockResolvedValue([{ id: 's1', number: 1 }] as never);
    await CurriculumService.createSection('c1', { title: 'M' });
    // The renumber pass reads the grid back before rewriting it.
    expect(gateway.getSectionsForRenumber).toHaveBeenCalled();
  });

  /**
   * A link opens the whole set, so a second quiz beside a one-time link would be
   * handed over with it — and would outlive the one-time quiz closing itself.
   * The quiz side of the same rule lives in QuizService.
   */
  it('refuses a second section in a set built around a one-time link', async () => {
    gateway.getModules.mockResolvedValue([{ id: 's1', number: 1 }] as never);
    quizGateway.findOneTimeQuiz.mockResolvedValue({
      id: 'quiz-1',
      title: 'Assessment',
      published: true,
    } as never);

    await expect(CurriculumService.createSection('c1', { title: 'M' })).rejects.toThrow(
      /only quiz in it/,
    );
    expect(gateway.createSection).not.toHaveBeenCalled();
  });
});

describe('reorderStructure — validation', () => {
  const course = {
    id: 'c1',
    modules: [{ id: 's1' }, { id: 's2' }],
    sections: [{ id: 'm1' }, { id: 'm2' }],
  };

  beforeEach(() => {
    passThroughTransaction();
    gateway.getCourseById.mockResolvedValue(course as never);
  });

  it('refuses a module that is not in the course', async () => {
    await expect(
      CurriculumService.reorderStructure('c1', [{ id: 'ghost', sectionIds: [] }]),
    ).rejects.toThrow(/not in this course/);
  });

  it('refuses the same module listed twice', async () => {
    await expect(
      CurriculumService.reorderStructure('c1', [
        { id: 's1', sectionIds: [] },
        { id: 's1', sectionIds: [] },
      ]),
    ).rejects.toThrow(/same module twice/);
  });

  /**
   * A partial reorder would leave the omitted rows on stale numbers, so the
   * whole grid has to be restated.
   */
  it('refuses a partial list of modules', async () => {
    await expect(
      CurriculumService.reorderStructure('c1', [{ id: 's1', sectionIds: ['m1', 'm2'] }]),
    ).rejects.toThrow(/every module/);
  });

  it('refuses a section that is not in the course', async () => {
    await expect(
      CurriculumService.reorderStructure('c1', [
        { id: 's1', sectionIds: ['ghost'] },
        { id: 's2', sectionIds: [] },
      ]),
    ).rejects.toThrow(/not in this course/);
  });

  it('refuses the same section listed twice', async () => {
    await expect(
      CurriculumService.reorderStructure('c1', [
        { id: 's1', sectionIds: ['m1', 'm1'] },
        { id: 's2', sectionIds: ['m2'] },
      ]),
    ).rejects.toThrow(/same section twice/);
  });

  it('refuses a partial list of sections', async () => {
    await expect(
      CurriculumService.reorderStructure('c1', [
        { id: 's1', sectionIds: ['m1'] },
        { id: 's2', sectionIds: [] },
      ]),
    ).rejects.toThrow(/every section/);
  });

  it('accepts a complete restatement of the grid', async () => {
    gateway.updateSection.mockResolvedValue({} as never);
    gateway.updateModule.mockResolvedValue({} as never);
    gateway.getLowestModuleNumber.mockResolvedValue(1 as never);
    gateway.getModules.mockResolvedValue([{ id: 's1' }, { id: 's2' }] as never);
    gateway.getSectionsForRenumber.mockResolvedValue([
      { id: 'm1', moduleId: 's1', position: 1 },
      { id: 'm2', moduleId: 's2', position: 1 },
    ] as never);

    await expect(
      CurriculumService.reorderStructure('c1', [
        { id: 's2', sectionIds: ['m2'] },
        { id: 's1', sectionIds: ['m1'] },
      ]),
    ).resolves.not.toThrow();
  });
});

describe('reorderSectionContent', () => {
  beforeEach(() => {
    passThroughTransaction();
    gateway.getSectionById.mockResolvedValue({ id: 'm1' } as never);
    gateway.getSectionContentIds.mockResolvedValue({
      elementIds: new Set(['e1', 'e2']),
      quizIds: new Set(['q1']),
    } as never);
    gateway.setElementOrder.mockResolvedValue({} as never);
    gateway.setQuizOrder.mockResolvedValue({} as never);
  });

  it('refuses an item that is not in this section', async () => {
    await expect(
      CurriculumService.reorderSectionContent('m1', [{ kind: 'element', id: 'elsewhere' }]),
    ).rejects.toThrow(/not in this section/);
  });

  /** Elements and quizzes share one sequence, so a quiz can sit mid-section. */
  it('numbers elements and quizzes into a single sequence', async () => {
    await CurriculumService.reorderSectionContent('m1', [
      { kind: 'element', id: 'e1' },
      { kind: 'quiz', id: 'q1' },
      { kind: 'element', id: 'e2' },
    ]);

    expect(gateway.setElementOrder).toHaveBeenCalledWith('e1', 1, expect.anything());
    expect(gateway.setQuizOrder).toHaveBeenCalledWith('q1', 2, expect.anything());
    expect(gateway.setElementOrder).toHaveBeenCalledWith('e2', 3, expect.anything());
  });
});

describe('createElement', () => {
  beforeEach(() => {
    passThroughTransaction();
    gateway.getSectionById.mockResolvedValue({ id: 'm1' } as never);
    gateway.getLastContentOrder.mockResolvedValue(2 as never);
    gateway.createElement.mockResolvedValue({} as never);
  });

  it('rejects an unknown element type', async () => {
    await expect(CurriculumService.createElement('m1', { type: 'AUDIO' })).rejects.toThrow(
      /type must be one of/,
    );
  });

  it('sanitises author rich text before storing it', async () => {
    await CurriculumService.createElement('m1', {
      type: 'TEXT',
      textContent: '<p>Safe</p><script>alert(1)</script>',
    });

    const written = gateway.createElement.mock.calls[0][1] as { textContent: string };
    expect(written.textContent).not.toContain('<script>');
    expect(written.textContent).toContain('<p>Safe</p>');
  });

  it('rejects a javascript: video link', async () => {
    await expect(
      CurriculumService.createElement('m1', { type: 'YOUTUBE', videoUrl: 'javascript:alert(1)' }),
    ).rejects.toThrow(/must start with http/);
  });

  it('rejects a data: image URL', async () => {
    await expect(
      CurriculumService.createElement('m1', {
        type: 'IMAGE',
        imageUrl: 'data:text/html,<script>alert(1)</script>',
      }),
    ).rejects.toThrow(/must start with http/);
  });

  it('appends after whatever is currently last in the shared sequence', async () => {
    await CurriculumService.createElement('m1', { type: 'TEXT', textContent: 'hi' });
    expect(gateway.createElement).toHaveBeenCalledWith(
      'm1',
      expect.anything(),
      3,
      expect.anything(),
    );
  });

  it('only records a duration for video', async () => {
    await CurriculumService.createElement('m1', {
      type: 'TEXT',
      textContent: 'hi',
      durationMinutes: 10,
    });
    const written = gateway.createElement.mock.calls[0][1] as { durationMinutes: number | null };
    expect(written.durationMinutes).toBeNull();
  });
});

describe('recycle bin', () => {
  it('keeps deleted content for two weeks', () => {
    expect(RECYCLE_BIN_DAYS).toBe(14);
  });

  it('refuses to permanently delete something not already in the bin', async () => {
    gateway.findDeletedCourse.mockResolvedValue(null as never);
    await expect(CurriculumService.purgeCourse('c1')).rejects.toThrow(/not in the recycle bin/);

    gateway.findDeletedSection.mockResolvedValue(null as never);
    await expect(CurriculumService.purgeSection('m1')).rejects.toThrow(/not in the recycle bin/);

    gateway.findDeletedModule.mockResolvedValue(null as never);
    await expect(CurriculumService.purgeModule('s1')).rejects.toThrow(/not in the recycle bin/);
  });

  /**
   * A section only has a number because it sits in a module. Restoring it into
   * one that is itself deleted would leave it live but unnumbered.
   */
  it('refuses to restore a section whose module is still deleted', async () => {
    gateway.findDeletedSection.mockResolvedValue({ id: 'm1', moduleId: 's1' } as never);
    gateway.getModuleById.mockResolvedValue(null as never);

    await expect(CurriculumService.restoreSection('m1')).rejects.toThrow(/module first/);
  });

  it('sweeps expired items outermost-first so cascades do the work', async () => {
    gateway.purgeCoursesDeletedBefore.mockResolvedValue({ count: 1 } as never);
    gateway.purgeModulesDeletedBefore.mockResolvedValue({ count: 2 } as never);
    gateway.purgeSectionsDeletedBefore.mockResolvedValue({ count: 3 } as never);
    quizGateway.purgeQuizzesDeletedBefore.mockResolvedValue({ count: 4 } as never);

    const result = await CurriculumService.purgeExpired();

    expect(result).toEqual({ courses: 1, modules: 2, sections: 3, quizzes: 4 });
  });

  /** A failed sweep must not take the page down with it. */
  it('never throws when the sweep fails', async () => {
    gateway.purgeCoursesDeletedBefore.mockRejectedValue(new Error('database is away'));

    await expect(CurriculumService.purgeExpired()).resolves.toEqual({
      courses: 0,
      modules: 0,
      sections: 0,
      quizzes: 0,
    });
  });
});

describe('notes', () => {
  it('rejects an empty note', () => {
    expect(() => CurriculumService.createNote(1, 'c1', { body: '   ' })).toThrow(/required/);
  });

  it('enforces the note length limit', () => {
    expect(() => CurriculumService.createNote(1, 'c1', { body: 'x'.repeat(20_000) })).toThrow(
      /too long/,
    );
  });

  /** Scoped by userId, so a note cannot be edited by anyone else. */
  it("reports a note that is not the caller's as not found", async () => {
    gateway.updateNote.mockResolvedValue({ count: 0 } as never);
    await expect(CurriculumService.updateNote('n1', 99, 'text')).rejects.toThrow(/not found/);
  });

  it('reports a delete that matched nothing as not found', async () => {
    gateway.deleteNote.mockResolvedValue({ count: 0 } as never);
    await expect(CurriculumService.deleteNote('n1', 99)).rejects.toThrow(/not found/);
  });
});
