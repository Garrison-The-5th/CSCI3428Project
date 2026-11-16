/**
 * File: curriculum-service.test.ts
 * Description: Unit tests for the course numbering grid, typed sections and
 *   the recycle bin and Archive rules.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
import CourseMapGateway from '@/gateways/course-map-gateway/course-map-gateway';
import CurriculumGateway from '@/gateways/curriculum-gateway/curriculum-gateway';
import QuizGateway from '@/gateways/quiz-gateway/quiz-gateway';
import CurriculumService, {
  RECYCLE_BIN_DAYS,
  toNumber,
  toSortKey,
} from '@/services/curriculum-service/curriculum-service';

jest.mock('@/gateways/curriculum-gateway/curriculum-gateway');
// Answers "no layer models" unless a test says otherwise.
jest.mock('@/gateways/course-map-gateway/course-map-gateway');
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
 * A set is three writes rather than one — the course, the QUIZ section that
 * carries the quiz's name, and the quiz — so the two tests that exercise it need the
 * same scaffolding and share it rather than each half-building one.
 */
function stubQuizSetCreation() {
  passThroughTransaction();
  gateway.createCourse.mockResolvedValue({ id: 'q1', title: 'Fire safety' } as never);
  gateway.createModel.mockResolvedValue({} as never);
  gateway.getCourseById.mockResolvedValue({ id: 'q1', title: 'Fire safety' } as never);
  gateway.getModels.mockResolvedValue([{ id: 'm1', number: 1 }] as never);
  gateway.getSectionsForRenumber.mockResolvedValue([] as never);
  gateway.createSection.mockResolvedValue({ id: 's1' } as never);
  gateway.getSectionById.mockResolvedValue({ id: 's1', courseId: 'q1', type: 'QUIZ' } as never);
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
   * more sections in a model.
   */
  it('produces a sort key that orders numerically', () => {
    expect(toSortKey(2, 3)).toBe('000002.000003');

    const keys = [toSortKey(1, 2), toSortKey(1, 10), toSortKey(1, 1)];
    expect([...keys].sort()).toEqual([toSortKey(1, 1), toSortKey(1, 2), toSortKey(1, 10)]);
  });

  it('orders across models before sections', () => {
    const keys = [toSortKey(2, 1), toSortKey(1, 9), toSortKey(10, 1)];
    expect([...keys].sort()).toEqual([toSortKey(1, 9), toSortKey(2, 1), toSortKey(10, 1)]);
  });
});

describe('createCourse', () => {
  it('rejects a blank title', async () => {
    await expect(CurriculumService.createCourse('  ')).rejects.toThrow(/required/);
    await expect(CurriculumService.createCourse(undefined)).rejects.toThrow(/required/);
  });

  /** A section lives inside a model, so a course with none has nowhere to put them. */
  it('creates a first model so a section can be added immediately', async () => {
    gateway.createCourse.mockResolvedValue({ id: 'c1', title: 'New' } as never);
    gateway.createModel.mockResolvedValue({} as never);
    gateway.getCourseById.mockResolvedValue({ id: 'c1' } as never);

    await CurriculumService.createCourse('  New  ');

    expect(gateway.createCourse).toHaveBeenCalledWith('New', 'LESSON', null);
    expect(gateway.createModel).toHaveBeenCalledWith(
      expect.objectContaining({ courseId: 'c1', number: 1 }),
    );
  });

  /**
   * Ownership is what makes a lesson somebody's rather than every admin's, and
   * this is the only route that can establish it — a course is created once.
   */
  it('records who created it', async () => {
    gateway.createCourse.mockResolvedValue({ id: 'c1', title: 'New' } as never);
    gateway.createModel.mockResolvedValue({} as never);
    gateway.getCourseById.mockResolvedValue({ id: 'c1' } as never);

    await CurriculumService.createCourse('New', undefined, 7);

    expect(gateway.createCourse).toHaveBeenCalledWith('New', 'LESSON', 7);
  });

  /**
   * A quiz set is the same Course underneath, which is what buys it publishing,
   * versioning and access for nothing. The kind is the only difference, and its
   * single model is named after the set rather than "Model 1" — an author never
   * sees that model, but the content previews do.
   */
  it('creates a quiz set as a course of its own kind', async () => {
    stubQuizSetCreation();

    await CurriculumService.createQuizSet('  Fire safety  ');

    expect(gateway.createCourse).toHaveBeenCalledWith('Fire safety', 'QUIZ_SET', null);
    expect(gateway.createModel).toHaveBeenCalledWith(
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
      expect.objectContaining({ courseId: 'q1', title: 'Fire safety', type: 'QUIZ' }),
      expect.anything(),
    );
    expect(quizGateway.createQuiz).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Fire safety', sectionId: 's1', type: 'EXAM' }),
    );
  });
});

describe('removeCourseImage', () => {
  it('clears the photo and its type together', async () => {
    gateway.getCourseById.mockResolvedValue({ id: 'c1' } as never);
    gateway.updateCourse.mockResolvedValue({} as never);

    await CurriculumService.removeCourseImage('c1');

    expect(gateway.updateCourse).toHaveBeenCalledWith('c1', { imageData: null, imageType: null });
  });

  it('refuses an unknown course', async () => {
    gateway.getCourseById.mockResolvedValue(null as never);
    await expect(CurriculumService.removeCourseImage('missing')).rejects.toThrow(/not found/);
    expect(gateway.updateCourse).not.toHaveBeenCalled();
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
    gateway.updateModel.mockResolvedValue({} as never);
    gateway.getLowestModelNumber.mockResolvedValue(1 as never);
    gateway.getSectionsForRenumber.mockResolvedValue([] as never);
  });

  /**
   * A section is one piece of content, so there is no such thing as a blank
   * one: the type is chosen at creation and a request without it is refused
   * before anything is written.
   */
  it('requires a type', async () => {
    gateway.getModels.mockResolvedValue([{ id: 's1', number: 1 }] as never);

    await expect(CurriculumService.createSection('c1', { title: 'M' })).rejects.toThrow(
      /needs a type/,
    );
    await expect(
      CurriculumService.createSection('c1', { title: 'M', type: 'AUDIO' }),
    ).rejects.toThrow(/needs a type/);
    expect(gateway.createSection).not.toHaveBeenCalled();
  });

  it('stores the type and the content together', async () => {
    gateway.getModels.mockResolvedValue([{ id: 's1', number: 1 }] as never);

    await CurriculumService.createSection('c1', {
      title: 'Intro',
      type: 'YOUTUBE',
      videoUrl: 'https://youtu.be/abc',
      durationMinutes: 12,
    });

    expect(gateway.createSection).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'YOUTUBE',
        videoUrl: 'https://youtu.be/abc',
        durationMinutes: 12,
      }),
      expect.anything(),
    );
  });

  it('refuses a course with no models', async () => {
    gateway.getModels.mockResolvedValue([] as never);
    await expect(
      CurriculumService.createSection('c1', { title: 'M', type: 'TEXT' }),
    ).rejects.toThrow(/add a model before adding sections/);
  });

  it('requires a title', async () => {
    gateway.getModels.mockResolvedValue([{ id: 's1', number: 1 }] as never);
    await expect(
      CurriculumService.createSection('c1', { title: '', type: 'TEXT' }),
    ).rejects.toThrow(/required/);
  });

  /** No model named means the last one — where an author adding in order expects it. */
  it('defaults to the last model', async () => {
    gateway.getModels.mockResolvedValue([
      { id: 's1', number: 1 },
      { id: 's2', number: 2 },
    ] as never);

    await CurriculumService.createSection('c1', { title: 'M', type: 'TEXT' });

    expect(gateway.createSection).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: 's2' }),
      expect.anything(),
    );
  });

  /*
    A course map appends its generated quiz models at the end, so "the last
    model" used to mean one of those — and new sections landed inside a
    directed learning quiz model.
  */
  it('skips the map’s quiz models when defaulting, and refuses one named outright', async () => {
    gateway.getModels.mockResolvedValue([
      { id: 's1', number: 1 },
      { id: 'layer', number: 2 },
    ] as never);
    (CourseMapGateway.getLayers as jest.Mock).mockResolvedValue([{ modelId: 'layer' }]);

    await CurriculumService.createSection('c1', { title: 'M', type: 'TEXT' });
    expect(gateway.createSection).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: 's1' }),
      expect.anything(),
    );

    await expect(
      CurriculumService.createSection('c1', { title: 'M', type: 'TEXT', modelId: 'layer' }),
    ).rejects.toThrow(/directed learning quiz models/i);

    (CourseMapGateway.getLayers as jest.Mock).mockResolvedValue(undefined);
  });

  it('refuses a model that is not in this course', async () => {
    gateway.getModels.mockResolvedValue([{ id: 's1', number: 1 }] as never);
    await expect(
      CurriculumService.createSection('c1', { title: 'M', type: 'TEXT', modelId: 'elsewhere' }),
    ).rejects.toThrow(/not found in this course/);
  });

  it('renumbers the course after inserting', async () => {
    gateway.getModels.mockResolvedValue([{ id: 's1', number: 1 }] as never);
    await CurriculumService.createSection('c1', { title: 'M', type: 'TEXT' });
    // The renumber pass reads the grid back before rewriting it.
    expect(gateway.getSectionsForRenumber).toHaveBeenCalled();
  });

  /**
   * A link opens the whole set, so a second quiz beside a one-time link would be
   * handed over with it — and would outlive the one-time quiz closing itself.
   * The quiz side of the same rule lives in QuizService.
   */
  it('refuses a second section in a set built around a one-time link', async () => {
    gateway.getModels.mockResolvedValue([{ id: 's1', number: 1 }] as never);
    quizGateway.findOneTimeQuiz.mockResolvedValue({
      id: 'quiz-1',
      title: 'Assessment',
      published: true,
    } as never);

    await expect(
      CurriculumService.createSection('c1', { title: 'M', type: 'TEXT' }),
    ).rejects.toThrow(/only quiz in it/);
    expect(gateway.createSection).not.toHaveBeenCalled();
  });
});

describe('reorderStructure — validation', () => {
  const course = {
    id: 'c1',
    models: [{ id: 's1' }, { id: 's2' }],
    sections: [{ id: 'm1' }, { id: 'm2' }],
  };

  beforeEach(() => {
    passThroughTransaction();
    gateway.getCourseById.mockResolvedValue(course as never);
  });

  it('refuses a model that is not in the course', async () => {
    await expect(
      CurriculumService.reorderStructure('c1', [{ id: 'ghost', sectionIds: [] }]),
    ).rejects.toThrow(/not in this course/);
  });

  it('refuses the same model listed twice', async () => {
    await expect(
      CurriculumService.reorderStructure('c1', [
        { id: 's1', sectionIds: [] },
        { id: 's1', sectionIds: [] },
      ]),
    ).rejects.toThrow(/same model twice/);
  });

  /**
   * A partial reorder would leave the omitted rows on stale numbers, so the
   * whole grid has to be restated.
   */
  it('refuses a partial list of models', async () => {
    await expect(
      CurriculumService.reorderStructure('c1', [{ id: 's1', sectionIds: ['m1', 'm2'] }]),
    ).rejects.toThrow(/every model/);
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
    gateway.updateModel.mockResolvedValue({} as never);
    gateway.getLowestModelNumber.mockResolvedValue(1 as never);
    gateway.getModels.mockResolvedValue([{ id: 's1' }, { id: 's2' }] as never);
    gateway.getSectionsForRenumber.mockResolvedValue([
      { id: 'm1', modelId: 's1', position: 1 },
      { id: 'm2', modelId: 's2', position: 1 },
    ] as never);

    await expect(
      CurriculumService.reorderStructure('c1', [
        { id: 's2', sectionIds: ['m2'] },
        { id: 's1', sectionIds: ['m1'] },
      ]),
    ).resolves.not.toThrow();
  });
});

describe('section content', () => {
  beforeEach(() => {
    passThroughTransaction();
    gateway.getCourseById.mockResolvedValue({ id: 'c1' } as never);
    gateway.getModels.mockResolvedValue([{ id: 's1', number: 1 }] as never);
    gateway.getSectionsForRenumber.mockResolvedValue([] as never);
    gateway.getLowestModelNumber.mockResolvedValue(1 as never);
    gateway.createSection.mockResolvedValue({ id: 'm1' } as never);
    gateway.updateSection.mockResolvedValue({} as never);
    gateway.getSectionById.mockResolvedValue({ id: 'm1', courseId: 'c1', type: 'TEXT' } as never);
    quizGateway.findOneTimeQuiz.mockResolvedValue(null as never);
  });

  /** What createSection wrote for the new row. */
  const written = () =>
    gateway.createSection.mock.calls[0][0] as unknown as Record<string, unknown>;

  it('sanitises author rich text before storing it', async () => {
    await CurriculumService.createSection('c1', {
      title: 'M',
      type: 'TEXT',
      textContent: '<p>Safe</p><script>alert(1)</script>',
    });

    expect(written().textContent).not.toContain('<script>');
    expect(written().textContent).toContain('<p>Safe</p>');
  });

  it('rejects a javascript: video link', async () => {
    await expect(
      CurriculumService.createSection('c1', {
        title: 'M',
        type: 'YOUTUBE',
        videoUrl: 'javascript:alert(1)',
      }),
    ).rejects.toThrow(/must start with http/);
  });

  it('rejects a data: image URL', async () => {
    await expect(
      CurriculumService.createSection('c1', {
        title: 'M',
        type: 'IMAGE',
        imageUrl: 'data:text/html,<script>alert(1)</script>',
      }),
    ).rejects.toThrow(/must start with http/);
  });

  it('only records a duration for video', async () => {
    await CurriculumService.createSection('c1', {
      title: 'M',
      type: 'TEXT',
      textContent: 'hi',
      durationMinutes: 10,
    });
    expect(written().durationMinutes).toBeNull();
  });

  /** An edit must not be a way around a check that creation makes. */
  it('applies the same checks when a section is edited', async () => {
    await CurriculumService.updateSection('m1', {
      textContent: '<p>Safe</p><script>alert(1)</script>',
    });
    const update = gateway.updateSection.mock.calls[0][1] as { textContent: string };
    expect(update.textContent).not.toContain('<script>');

    await expect(
      CurriculumService.updateSection('m1', { videoUrl: 'javascript:alert(1)' }),
    ).rejects.toThrow(/must start with http/);
  });

  /** The type is chosen at creation; changing content means adding a section. */
  it('refuses to change a section into another type', async () => {
    await expect(CurriculumService.updateSection('m1', { type: 'YOUTUBE' })).rejects.toThrow(
      /chosen when it is created/,
    );

    // Posting the type it already has is not an error.
    await expect(
      CurriculumService.updateSection('m1', { type: 'TEXT', title: 'Renamed' }),
    ).resolves.not.toThrow();
  });

  it('refuses a canvas layout on a section that is not a canvas', async () => {
    await expect(CurriculumService.updateSection('m1', { canvas: { items: [] } })).rejects.toThrow(
      /Only a canvas/,
    );
  });

  /**
   * Quizzes and content share one sequence within a model: a quiz is a section
   * like any other, so it takes whatever position it was asked for and the grid
   * renumbers around it. There is no second ordering to keep in step.
   */
  it('places a quiz section in the same sequence as the content around it', async () => {
    gateway.getSectionsForRenumber.mockResolvedValue([
      { id: 'a', modelId: 's1', position: 1, type: 'TEXT' },
      { id: 'b', modelId: 's1', position: 2, type: 'TEXT' },
    ] as never);
    gateway.getSectionById.mockResolvedValue({ id: 'm1', courseId: 'c1', type: 'QUIZ' } as never);
    quizGateway.createQuiz.mockResolvedValue({ id: 'quiz-1' } as never);

    await CurriculumService.createSection('c1', {
      title: 'Check',
      type: 'QUIZ',
      quizType: 'LEARNING_CHECK',
      position: 2,
    });

    // The section that held position 2 moves down to make room…
    expect(gateway.updateSection).toHaveBeenCalledWith('b', { position: 3 }, expect.anything());
    // …the quiz section takes it…
    expect(gateway.createSection).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'QUIZ', position: 2 }),
      expect.anything(),
    );
    // …and the quiz is made inside it, with no order of its own.
    const quiz = quizGateway.createQuiz.mock.calls[0][0] as Record<string, unknown>;
    expect(quiz).toMatchObject({ sectionId: 'm1', type: 'LEARNING_CHECK' });
    expect(quiz).not.toHaveProperty('order');
  });

  it('holds quizzes only in a quiz set', async () => {
    gateway.getCourseById.mockResolvedValue({ id: 'c1', kind: 'QUIZ_SET' } as never);
    await expect(
      CurriculumService.createSection('c1', { title: 'Notes', type: 'TEXT' }),
    ).rejects.toThrow(/quizzes only/);
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

    gateway.findDeletedModel.mockResolvedValue(null as never);
    await expect(CurriculumService.purgeModel('s1')).rejects.toThrow(/not in the recycle bin/);
  });

  /**
   * A section only has a number because it sits in a model. Restoring it into
   * one that is itself deleted would leave it live but unnumbered.
   */
  it('refuses to restore a section whose model is still deleted', async () => {
    gateway.findDeletedSection.mockResolvedValue({ id: 'm1', modelId: 's1' } as never);
    gateway.getModelById.mockResolvedValue(null as never);

    await expect(CurriculumService.restoreSection('m1')).rejects.toThrow(/model first/);
  });

  /** "A deleted model's sections come back with it." */
  it('restores a model together with every section deleted inside it', async () => {
    passThroughTransaction();
    gateway.findDeletedModel.mockResolvedValue({ id: 's1', courseId: 'c1' } as never);
    gateway.restoreModel.mockResolvedValue({ id: 's1' } as never);
    gateway.getDeletedSectionsOfModel.mockResolvedValue([
      { id: 'm1', type: 'TEXT' },
      { id: 'm2', type: 'QUIZ' },
    ] as never);
    gateway.getModels.mockResolvedValue([] as never);
    gateway.getSectionsForRenumber.mockResolvedValue([] as never);
    gateway.getLowestModelNumber.mockResolvedValue(0 as never);

    await CurriculumService.restoreModel('s1');

    expect(gateway.restoreSection).toHaveBeenCalledWith('m1', 's1', expect.anything());
    expect(gateway.restoreSection).toHaveBeenCalledWith('m2', 's1', expect.anything());
    // A quiz section's quiz comes back with it.
    expect(quizGateway.restoreQuizzesInSection).toHaveBeenCalledWith('m2', expect.anything());
    expect(gateway.touchDraft).toHaveBeenCalledWith('c1');
  });

  /** Deleting a quiz section and deleting its quiz are the same act. */
  it('takes a quiz into the bin with its section', async () => {
    passThroughTransaction();
    gateway.getSectionById.mockResolvedValue({ id: 'm1', courseId: 'c1', type: 'QUIZ' } as never);
    gateway.softDeleteSection.mockResolvedValue({ id: 'm1' } as never);
    gateway.getModels.mockResolvedValue([] as never);
    gateway.getSectionsForRenumber.mockResolvedValue([] as never);
    gateway.getLowestModelNumber.mockResolvedValue(0 as never);

    await CurriculumService.deleteSection('m1');

    expect(quizGateway.softDeleteQuizzesInSection).toHaveBeenCalledWith('m1', expect.anything());
  });

  /**
   * The admin recycle bin is for courses (and, through QuizService, standalone
   * quizzes). A model or section deleted inside a live course is in that
   * course's Archive, so none of the bin's three actions may reach it.
   */
  it('lists, restores and empties courses only', async () => {
    gateway.purgeCoursesDeletedBefore.mockResolvedValue({ count: 0 } as never);
    gateway.purgeModelsDeletedBefore.mockResolvedValue({ count: 0 } as never);
    gateway.purgeSectionsDeletedBefore.mockResolvedValue({ count: 0 } as never);
    quizGateway.purgeQuizzesDeletedBefore.mockResolvedValue({ count: 0 } as never);
    gateway.getAccessibleCourseIds.mockResolvedValue(['c1'] as never);
    gateway.getDeletedCourses.mockResolvedValue([{ id: 'c1', title: 'Old' }] as never);
    gateway.restoreAllCourses.mockResolvedValue({ count: 1 } as never);
    gateway.purgeCourses.mockResolvedValue({ count: 1 } as never);

    const listed = await CurriculumService.getDeletedItems(7, true);
    expect(Object.keys(listed).sort()).toEqual(['courses', 'retentionDays']);

    expect(await CurriculumService.restoreAll(7, true)).toEqual({ courses: 1 });
    expect(await CurriculumService.purgeAll(7, true)).toEqual({ courses: 1 });

    // Nothing that restores or purges a model or a section was reached.
    expect(gateway.restoreModel).not.toHaveBeenCalled();
    expect(gateway.restoreSection).not.toHaveBeenCalled();
    expect(gateway.hardDeleteModel).not.toHaveBeenCalled();
    expect(gateway.hardDeleteSection).not.toHaveBeenCalled();
    expect(gateway).not.toHaveProperty('purgeModels');
    expect(gateway).not.toHaveProperty('purgeSections');
  });

  /** The Archive list is shaped the way it is restored. */
  it('lists a course’s deleted models, sections and quizzes for its Archive', async () => {
    gateway.purgeCoursesDeletedBefore.mockResolvedValue({ count: 0 } as never);
    gateway.purgeModelsDeletedBefore.mockResolvedValue({ count: 0 } as never);
    gateway.purgeSectionsDeletedBefore.mockResolvedValue({ count: 0 } as never);
    quizGateway.purgeQuizzesDeletedBefore.mockResolvedValue({ count: 0 } as never);
    const when = new Date('2026-11-01T00:00:00Z');
    gateway.getDeletedStructure.mockResolvedValue({
      models: [{ id: 'gone', title: 'Old model', deletedAt: when }],
      sections: [
        { id: 'in-model', title: 'Inside', type: 'TEXT', modelId: 'gone', deletedAt: when },
        { id: 'loose', title: 'Loose', type: 'IMAGE', modelId: 'live', deletedAt: when },
        { id: 'quiz-sec', title: 'Check', type: 'QUIZ', modelId: 'live', deletedAt: when },
      ],
    } as never);
    quizGateway.getQuizzesInDeletedSections.mockResolvedValue([
      { id: 'quiz-1', title: 'Safety check', sectionId: 'quiz-sec', deletedAt: when },
    ] as never);

    const archive = await CurriculumService.getDeletedStructure('c1');

    // A deleted model carries the sections that come back with it.
    expect(archive.models).toEqual([
      {
        id: 'gone',
        title: 'Old model',
        deletedAt: when,
        sections: [{ id: 'in-model', title: 'Inside', type: 'TEXT' }],
      },
    ]);
    // A section whose model is live stands alone…
    expect(archive.sections.map((section) => section.id)).toEqual(['loose']);
    // …and a quiz section is listed once, as its quiz, under its section's title.
    expect(archive.quizzes).toEqual([
      {
        id: 'quiz-1',
        title: 'Safety check',
        sectionId: 'quiz-sec',
        sectionTitle: 'Check',
        deletedAt: when,
      },
    ]);
    expect(archive.retentionDays).toBe(RECYCLE_BIN_DAYS);
  });

  it('sweeps expired items outermost-first so cascades do the work', async () => {
    gateway.purgeCoursesDeletedBefore.mockResolvedValue({ count: 1 } as never);
    gateway.purgeModelsDeletedBefore.mockResolvedValue({ count: 2 } as never);
    gateway.purgeSectionsDeletedBefore.mockResolvedValue({ count: 3 } as never);
    quizGateway.purgeQuizzesDeletedBefore.mockResolvedValue({ count: 4 } as never);

    const result = await CurriculumService.purgeExpired();

    expect(result).toEqual({ courses: 1, models: 2, sections: 3, quizzes: 4 });
  });

  /** A failed sweep must not take the page down with it. */
  it('never throws when the sweep fails', async () => {
    gateway.purgeCoursesDeletedBefore.mockRejectedValue(new Error('database is away'));

    await expect(CurriculumService.purgeExpired()).resolves.toEqual({
      courses: 0,
      models: 0,
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
