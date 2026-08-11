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

describe('toNumber and toSortKey', () => {
  it('renders the number a learner sees', () => {
    expect(toNumber(2, 3)).toBe('2.3');
    expect(toNumber(1, 1)).toBe('1.1');
  });

  /**
   * Zero padding is the whole point: under plain string comparison "1.10"
   * sorts before "1.2", which would silently reorder any course with ten or
   * more modules in a section.
   */
  it('produces a sort key that orders numerically', () => {
    expect(toSortKey(2, 3)).toBe('000002.000003');

    const keys = [toSortKey(1, 2), toSortKey(1, 10), toSortKey(1, 1)];
    expect([...keys].sort()).toEqual([toSortKey(1, 1), toSortKey(1, 2), toSortKey(1, 10)]);
  });

  it('orders across sections before modules', () => {
    const keys = [toSortKey(2, 1), toSortKey(1, 9), toSortKey(10, 1)];
    expect([...keys].sort()).toEqual([toSortKey(1, 9), toSortKey(2, 1), toSortKey(10, 1)]);
  });
});

describe('createCourse', () => {
  it('rejects a blank title', async () => {
    await expect(CurriculumService.createCourse('  ')).rejects.toThrow(/required/);
    await expect(CurriculumService.createCourse(undefined)).rejects.toThrow(/required/);
  });

  /** A module lives inside a section, so a course with none has nowhere to put them. */
  it('creates a first section so a module can be added immediately', async () => {
    gateway.createCourse.mockResolvedValue({ id: 'c1', title: 'New' } as never);
    gateway.createSection.mockResolvedValue({} as never);
    gateway.getCourseById.mockResolvedValue({ id: 'c1' } as never);

    await CurriculumService.createCourse('  New  ');

    expect(gateway.createCourse).toHaveBeenCalledWith('New');
    expect(gateway.createSection).toHaveBeenCalledWith(
      expect.objectContaining({ courseId: 'c1', number: 1 }),
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

describe('createModule', () => {
  beforeEach(() => {
    passThroughTransaction();
    gateway.getCourseById.mockResolvedValue({ id: 'c1' } as never);
    gateway.getModuleById.mockResolvedValue({ id: 'm-new' } as never);
    gateway.createModule.mockResolvedValue({ id: 'm-new' } as never);
    gateway.updateModule.mockResolvedValue({} as never);
    gateway.updateSection.mockResolvedValue({} as never);
    gateway.getLowestSectionNumber.mockResolvedValue(1 as never);
    gateway.getModulesForRenumber.mockResolvedValue([] as never);
  });

  it('refuses a course with no sections', async () => {
    gateway.getSections.mockResolvedValue([] as never);
    await expect(CurriculumService.createModule('c1', { title: 'M' })).rejects.toThrow(
      /add a section before adding modules/,
    );
  });

  it('requires a title', async () => {
    gateway.getSections.mockResolvedValue([{ id: 's1', number: 1 }] as never);
    await expect(CurriculumService.createModule('c1', { title: '' })).rejects.toThrow(/required/);
  });

  /** No section named means the last one — where an author adding in order expects it. */
  it('defaults to the last section', async () => {
    gateway.getSections.mockResolvedValue([
      { id: 's1', number: 1 },
      { id: 's2', number: 2 },
    ] as never);

    await CurriculumService.createModule('c1', { title: 'M' });

    expect(gateway.createModule).toHaveBeenCalledWith(
      expect.objectContaining({ sectionId: 's2' }),
      expect.anything(),
    );
  });

  it('refuses a section that is not in this course', async () => {
    gateway.getSections.mockResolvedValue([{ id: 's1', number: 1 }] as never);
    await expect(
      CurriculumService.createModule('c1', { title: 'M', sectionId: 'elsewhere' }),
    ).rejects.toThrow(/not found in this course/);
  });

  it('renumbers the course after inserting', async () => {
    gateway.getSections.mockResolvedValue([{ id: 's1', number: 1 }] as never);
    await CurriculumService.createModule('c1', { title: 'M' });
    // The renumber pass reads the grid back before rewriting it.
    expect(gateway.getModulesForRenumber).toHaveBeenCalled();
  });
});

describe('reorderStructure — validation', () => {
  const course = {
    id: 'c1',
    sections: [{ id: 's1' }, { id: 's2' }],
    modules: [{ id: 'm1' }, { id: 'm2' }],
  };

  beforeEach(() => {
    passThroughTransaction();
    gateway.getCourseById.mockResolvedValue(course as never);
  });

  it('refuses a section that is not in the course', async () => {
    await expect(
      CurriculumService.reorderStructure('c1', [{ id: 'ghost', moduleIds: [] }]),
    ).rejects.toThrow(/not in this course/);
  });

  it('refuses the same section listed twice', async () => {
    await expect(
      CurriculumService.reorderStructure('c1', [
        { id: 's1', moduleIds: [] },
        { id: 's1', moduleIds: [] },
      ]),
    ).rejects.toThrow(/same section twice/);
  });

  /**
   * A partial reorder would leave the omitted rows on stale numbers, so the
   * whole grid has to be restated.
   */
  it('refuses a partial list of sections', async () => {
    await expect(
      CurriculumService.reorderStructure('c1', [{ id: 's1', moduleIds: ['m1', 'm2'] }]),
    ).rejects.toThrow(/every section/);
  });

  it('refuses a module that is not in the course', async () => {
    await expect(
      CurriculumService.reorderStructure('c1', [
        { id: 's1', moduleIds: ['ghost'] },
        { id: 's2', moduleIds: [] },
      ]),
    ).rejects.toThrow(/not in this course/);
  });

  it('refuses the same module listed twice', async () => {
    await expect(
      CurriculumService.reorderStructure('c1', [
        { id: 's1', moduleIds: ['m1', 'm1'] },
        { id: 's2', moduleIds: ['m2'] },
      ]),
    ).rejects.toThrow(/same module twice/);
  });

  it('refuses a partial list of modules', async () => {
    await expect(
      CurriculumService.reorderStructure('c1', [
        { id: 's1', moduleIds: ['m1'] },
        { id: 's2', moduleIds: [] },
      ]),
    ).rejects.toThrow(/every module/);
  });

  it('accepts a complete restatement of the grid', async () => {
    gateway.updateModule.mockResolvedValue({} as never);
    gateway.updateSection.mockResolvedValue({} as never);
    gateway.getLowestSectionNumber.mockResolvedValue(1 as never);
    gateway.getSections.mockResolvedValue([{ id: 's1' }, { id: 's2' }] as never);
    gateway.getModulesForRenumber.mockResolvedValue([
      { id: 'm1', sectionId: 's1', position: 1 },
      { id: 'm2', sectionId: 's2', position: 1 },
    ] as never);

    await expect(
      CurriculumService.reorderStructure('c1', [
        { id: 's2', moduleIds: ['m2'] },
        { id: 's1', moduleIds: ['m1'] },
      ]),
    ).resolves.not.toThrow();
  });
});

describe('reorderModuleContent', () => {
  beforeEach(() => {
    passThroughTransaction();
    gateway.getModuleById.mockResolvedValue({ id: 'm1' } as never);
    gateway.getModuleContentIds.mockResolvedValue({
      elementIds: new Set(['e1', 'e2']),
      quizIds: new Set(['q1']),
    } as never);
    gateway.setElementOrder.mockResolvedValue({} as never);
    gateway.setQuizOrder.mockResolvedValue({} as never);
  });

  it('refuses an item that is not in this module', async () => {
    await expect(
      CurriculumService.reorderModuleContent('m1', [{ kind: 'element', id: 'elsewhere' }]),
    ).rejects.toThrow(/not in this module/);
  });

  /** Elements and quizzes share one sequence, so a quiz can sit mid-module. */
  it('numbers elements and quizzes into a single sequence', async () => {
    await CurriculumService.reorderModuleContent('m1', [
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
    gateway.getModuleById.mockResolvedValue({ id: 'm1' } as never);
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

    gateway.findDeletedModule.mockResolvedValue(null as never);
    await expect(CurriculumService.purgeModule('m1')).rejects.toThrow(/not in the recycle bin/);

    gateway.findDeletedSection.mockResolvedValue(null as never);
    await expect(CurriculumService.purgeSection('s1')).rejects.toThrow(/not in the recycle bin/);
  });

  /**
   * A module only has a number because it sits in a section. Restoring it into
   * one that is itself deleted would leave it live but unnumbered.
   */
  it('refuses to restore a module whose section is still deleted', async () => {
    gateway.findDeletedModule.mockResolvedValue({ id: 'm1', sectionId: 's1' } as never);
    gateway.getSectionById.mockResolvedValue(null as never);

    await expect(CurriculumService.restoreModule('m1')).rejects.toThrow(/section first/);
  });

  it('sweeps expired items outermost-first so cascades do the work', async () => {
    gateway.purgeCoursesDeletedBefore.mockResolvedValue({ count: 1 } as never);
    gateway.purgeSectionsDeletedBefore.mockResolvedValue({ count: 2 } as never);
    gateway.purgeModulesDeletedBefore.mockResolvedValue({ count: 3 } as never);
    quizGateway.purgeQuizzesDeletedBefore.mockResolvedValue({ count: 4 } as never);

    const result = await CurriculumService.purgeExpired();

    expect(result).toEqual({ courses: 1, sections: 2, modules: 3, quizzes: 4 });
  });

  /** A failed sweep must not take the page down with it. */
  it('never throws when the sweep fails', async () => {
    gateway.purgeCoursesDeletedBefore.mockRejectedValue(new Error('database is away'));

    await expect(CurriculumService.purgeExpired()).resolves.toEqual({
      courses: 0,
      sections: 0,
      modules: 0,
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
