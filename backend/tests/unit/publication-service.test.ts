/**
 * File: publication-service.test.ts
 * Description: Unit tests for versioned publishing — snapshots, version diffs
 *   and the "New to this learner" rule.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
import CurriculumGateway from '@/gateways/curriculum-gateway/curriculum-gateway';
import PublicationGateway from '@/gateways/publication-gateway/publication-gateway';
import QuizGateway from '@/gateways/quiz-gateway/quiz-gateway';
import PublicationService, {
  ARCHIVE_DAYS,
} from '@/services/publication-service/publication-service';

jest.mock('@/gateways/curriculum-gateway/curriculum-gateway');
jest.mock('@/gateways/publication-gateway/publication-gateway');
jest.mock('@/gateways/quiz-gateway/quiz-gateway');

const curriculum = CurriculumGateway as jest.Mocked<typeof CurriculumGateway>;
const publication = PublicationGateway as jest.Mocked<typeof PublicationGateway>;
const quiz = QuizGateway as jest.Mocked<typeof QuizGateway>;

function courseRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    title: 'Fire safety',
    shortDescription: null,
    description: null,
    tags: [],
    languages: [],
    whatYouWillLearn: [],
    prerequisites: [],
    required: false,
    dueDate: null,
    published: true,
    sequential: false,
    publishedAt: new Date('2026-01-01'),
    publishedVersion: 1,
    draftUpdatedAt: new Date('2026-01-01'),
    imageData: null,
    imageType: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    deletedAt: null,
    sections: [{ id: 's1', courseId: 'c1', number: 1, title: 'Intro', color: null }],
    modules: [
      {
        id: 'm1',
        courseId: 'c1',
        sectionId: 's1',
        position: 1,
        number: '1.1',
        title: 'Basics',
        estimatedMinutes: 10,
        elements: [{ id: 'e1' }],
        quizzes: [{ id: 'q1', published: true, questions: [] }],
      },
    ],
    instructors: [],
    ...overrides,
  };
}

describe('buildSnapshot', () => {
  it('refuses an unknown course', async () => {
    curriculum.getCourseById.mockResolvedValue(null as never);
    await expect(PublicationService.buildSnapshot('missing')).rejects.toThrow(/not found/);
  });

  it('captures the tree a learner will read', async () => {
    curriculum.getCourseById.mockResolvedValue(courseRow() as never);

    const snapshot = await PublicationService.buildSnapshot('c1');

    expect(snapshot.id).toBe('c1');
    expect(snapshot.sections).toHaveLength(1);
    expect(snapshot.modules[0].elements).toHaveLength(1);
  });

  /**
   * An author must be able to draft a quiz inside an otherwise finished module
   * without it appearing the moment the course is republished.
   */
  it('drops unpublished quizzes from the snapshot', async () => {
    curriculum.getCourseById.mockResolvedValue(
      courseRow({
        modules: [
          {
            ...courseRow().modules[0],
            quizzes: [
              { id: 'live', published: true, questions: [] },
              { id: 'draft', published: false, questions: [] },
            ],
          },
        ],
      }) as never,
    );

    const snapshot = await PublicationService.buildSnapshot('c1');

    expect(snapshot.modules[0].quizzes.map((entry) => entry.id)).toEqual(['live']);
  });
});

describe('getLiveSnapshot', () => {
  it('returns null for a course that has never been published', async () => {
    curriculum.getCourseById.mockResolvedValue(
      courseRow({ published: false, publishedVersion: 0 }) as never,
    );

    expect(await PublicationService.getLiveSnapshot('c1')).toBeNull();
  });

  it('returns null for an unpublished course even if a version exists', async () => {
    curriculum.getCourseById.mockResolvedValue(courseRow({ published: false }) as never);
    expect(await PublicationService.getLiveSnapshot('c1')).toBeNull();
  });

  it('returns the stored snapshot for the live version', async () => {
    curriculum.getCourseById.mockResolvedValue(courseRow() as never);
    publication.getLive.mockResolvedValue({ snapshot: { id: 'c1', title: 'Frozen' } } as never);

    const snapshot = await PublicationService.getLiveSnapshot('c1');
    expect(snapshot).toMatchObject({ title: 'Frozen' });
  });
});

describe('hasUnpublishedChanges', () => {
  it('reports true for a course never published', async () => {
    curriculum.getCourseById.mockResolvedValue(courseRow({ publishedVersion: 0 }) as never);
    expect(await PublicationService.hasUnpublishedChanges('c1')).toBe(true);
  });

  it('reports false immediately after a publish', async () => {
    const publishedAt = new Date('2026-05-01T10:00:00Z');
    curriculum.getCourseById.mockResolvedValue(courseRow({ draftUpdatedAt: publishedAt }) as never);
    publication.getLive.mockResolvedValue({ publishedAt } as never);

    expect(await PublicationService.hasUnpublishedChanges('c1')).toBe(false);
  });

  it('reports true once an edit pushes the draft past the publication', async () => {
    curriculum.getCourseById.mockResolvedValue(
      courseRow({ draftUpdatedAt: new Date('2026-05-02T10:00:00Z') }) as never,
    );
    publication.getLive.mockResolvedValue({
      publishedAt: new Date('2026-05-01T10:00:00Z'),
    } as never);

    expect(await PublicationService.hasUnpublishedChanges('c1')).toBe(true);
  });

  it('reports false for a course that does not exist', async () => {
    curriculum.getCourseById.mockResolvedValue(null as never);
    expect(await PublicationService.hasUnpublishedChanges('missing')).toBe(false);
  });
});

describe('publish', () => {
  beforeEach(() => {
    curriculum.updateCourse.mockResolvedValue({} as never);
    curriculum.touchContent.mockResolvedValue({} as never);
    publication.supersede.mockResolvedValue({} as never);
    (publication.create as unknown as jest.Mock).mockImplementation(async (data: object) => ({
      ...data,
      publishedAt: new Date(),
    }));
  });

  /**
   * A first publish marks nothing new: everything is new, and saying so on
   * every line is noise rather than information.
   */
  it('marks nothing as new on the first publish', async () => {
    curriculum.getCourseById.mockResolvedValue(
      courseRow({ publishedVersion: 0, published: false }) as never,
    );

    const result = await PublicationService.publish('c1', 1);

    expect(result.version).toBe(1);
    expect(result.hasNewContent).toBe(false);
    expect(result.added.newModuleIds).toEqual([]);
  });

  it('records exactly what a later version added', async () => {
    curriculum.getCourseById.mockResolvedValue(
      courseRow({
        publishedVersion: 1,
        modules: [
          courseRow().modules[0],
          {
            ...courseRow().modules[0],
            id: 'm2',
            elements: [{ id: 'e2' }],
            quizzes: [],
          },
        ],
      }) as never,
    );
    // The previous version had only the first module.
    publication.getLive.mockResolvedValue({
      snapshot: {
        sections: [{ id: 's1' }],
        modules: [{ id: 'm1', elements: [{ id: 'e1' }], quizzes: [{ id: 'q1' }] }],
      },
    } as never);

    const result = await PublicationService.publish('c1', 1);

    expect(result.version).toBe(2);
    expect(result.added.newModuleIds).toEqual(['m2']);
    expect(result.added.newElementIds).toEqual(['e2']);
    expect(result.hasNewContent).toBe(true);
  });

  it('supersedes the previous version, starting its archive clock', async () => {
    curriculum.getCourseById.mockResolvedValue(courseRow({ publishedVersion: 3 }) as never);
    publication.getLive.mockResolvedValue({ snapshot: { sections: [], modules: [] } } as never);

    await PublicationService.publish('c1', 1);

    expect(publication.supersede).toHaveBeenCalledWith('c1', 3);
  });

  /**
   * draftUpdatedAt takes the publication's own timestamp; stamping it
   * separately would leave it milliseconds ahead and the editor would claim
   * unpublished changes the instant a publish finished.
   */
  it('aligns draftUpdatedAt with the publication timestamp', async () => {
    curriculum.getCourseById.mockResolvedValue(
      courseRow({ publishedVersion: 0, published: false }) as never,
    );

    await PublicationService.publish('c1', 1);

    const update = curriculum.updateCourse.mock.calls[0][1] as Record<string, unknown>;
    expect(update.published).toBe(true);
    expect(update.publishedVersion).toBe(1);
    expect(update.draftUpdatedAt).toBeInstanceOf(Date);
  });

  it('touches the content stamp only when something was actually added', async () => {
    curriculum.getCourseById.mockResolvedValue(courseRow({ publishedVersion: 1 }) as never);
    // Identical to the current tree: a republish with no additions.
    publication.getLive.mockResolvedValue({
      snapshot: {
        sections: [{ id: 's1' }],
        modules: [{ id: 'm1', elements: [{ id: 'e1' }], quizzes: [{ id: 'q1' }] }],
      },
    } as never);

    const result = await PublicationService.publish('c1', 1);

    expect(result.hasNewContent).toBe(false);
    expect(curriculum.touchContent).not.toHaveBeenCalled();
  });
});

describe('getNewIdsForLearner', () => {
  const liveSnapshot = {
    sections: [{ id: 's1' }],
    modules: [
      { id: 'm1', sectionId: 's1', elements: [{ id: 'e1' }], quizzes: [{ id: 'q1' }] },
      { id: 'm2', sectionId: 's1', elements: [{ id: 'e2' }], quizzes: [] },
    ],
  };

  beforeEach(() => {
    curriculum.getCourseById.mockResolvedValue(courseRow() as never);
    curriculum.getViewedModuleIds.mockResolvedValue([] as never);
    curriculum.getViewedElementIds.mockResolvedValue([] as never);
    quiz.getAttemptsForUser.mockResolvedValue([] as never);
  });

  /**
   * To a first-time learner every line is equally new, so marking half of it
   * would be noise. They get a clean page.
   */
  it('marks nothing for a learner who has never opened the course', async () => {
    curriculum.getFirstActivityAt.mockResolvedValue(null as never);

    const result = await PublicationService.getNewIdsForLearner('c1', 1, liveSnapshot as never);

    expect(result.newModuleIds).toEqual([]);
    expect(result.newSectionIds).toEqual([]);
  });

  it('marks nothing when no version has been published since they began', async () => {
    curriculum.getFirstActivityAt.mockResolvedValue(new Date('2026-01-01') as never);
    publication.listPublishedSince.mockResolvedValue([] as never);

    const result = await PublicationService.getNewIdsForLearner('c1', 1, liveSnapshot as never);
    expect(result.newModuleIds).toEqual([]);
  });

  it('marks what arrived after they started', async () => {
    curriculum.getFirstActivityAt.mockResolvedValue(new Date('2026-01-01') as never);
    publication.listPublishedSince.mockResolvedValue([
      { newSectionIds: [], newModuleIds: ['m2'], newElementIds: ['e2'], newQuizIds: [] },
    ] as never);

    const result = await PublicationService.getNewIdsForLearner('c1', 1, liveSnapshot as never);

    expect(result.newModuleIds).toEqual(['m2']);
    expect(result.newElementIds).toEqual(['e2']);
  });

  /**
   * Reading the new module is what makes it no longer new. Without this the
   * pills would stick forever.
   */
  it('retires a mark once the learner has read it', async () => {
    curriculum.getFirstActivityAt.mockResolvedValue(new Date('2026-01-01') as never);
    publication.listPublishedSince.mockResolvedValue([
      { newSectionIds: [], newModuleIds: ['m2'], newElementIds: ['e2'], newQuizIds: [] },
    ] as never);
    curriculum.getViewedModuleIds.mockResolvedValue([{ moduleId: 'm2' }] as never);
    curriculum.getViewedElementIds.mockResolvedValue([{ elementId: 'e2' }] as never);

    const result = await PublicationService.getNewIdsForLearner('c1', 1, liveSnapshot as never);

    expect(result.newModuleIds).toEqual([]);
    expect(result.newElementIds).toEqual([]);
  });

  /**
   * Something added in v4 and removed in v5 must not be marked new on a page
   * that no longer contains it.
   */
  it('does not mark content that no longer exists in the served version', async () => {
    curriculum.getFirstActivityAt.mockResolvedValue(new Date('2026-01-01') as never);
    publication.listPublishedSince.mockResolvedValue([
      { newSectionIds: [], newModuleIds: ['deleted-since'], newElementIds: [], newQuizIds: [] },
    ] as never);

    const result = await PublicationService.getNewIdsForLearner('c1', 1, liveSnapshot as never);
    expect(result.newModuleIds).toEqual([]);
  });

  /**
   * Taking only the newest version's delta would make marks vanish the moment
   * an author republished for any other reason.
   */
  it('accumulates across every version published since they began', async () => {
    curriculum.getFirstActivityAt.mockResolvedValue(new Date('2026-01-01') as never);
    publication.listPublishedSince.mockResolvedValue([
      { newSectionIds: [], newModuleIds: ['m1'], newElementIds: [], newQuizIds: [] },
      { newSectionIds: [], newModuleIds: ['m2'], newElementIds: [], newQuizIds: [] },
    ] as never);

    const result = await PublicationService.getNewIdsForLearner('c1', 1, liveSnapshot as never);
    expect(result.newModuleIds.sort()).toEqual(['m1', 'm2']);
  });

  /** A section heading stands in for its contents, so it clears only when they do. */
  it('keeps a new section marked until nothing inside it is outstanding', async () => {
    curriculum.getFirstActivityAt.mockResolvedValue(new Date('2026-01-01') as never);
    publication.listPublishedSince.mockResolvedValue([
      { newSectionIds: ['s1'], newModuleIds: [], newElementIds: [], newQuizIds: [] },
    ] as never);
    curriculum.getViewedModuleIds.mockResolvedValue([{ moduleId: 'm1' }] as never);

    const stillNew = await PublicationService.getNewIdsForLearner('c1', 1, liveSnapshot as never);
    expect(stillNew.newSectionIds).toEqual(['s1']);

    curriculum.getViewedModuleIds.mockResolvedValue([
      { moduleId: 'm1' },
      { moduleId: 'm2' },
    ] as never);

    const cleared = await PublicationService.getNewIdsForLearner('c1', 1, liveSnapshot as never);
    expect(cleared.newSectionIds).toEqual([]);
  });
});

describe('archive retention', () => {
  it('keeps a superseded version for two weeks', () => {
    expect(ARCHIVE_DAYS).toBe(14);
  });

  it('never throws when the sweep fails', async () => {
    publication.purgeSupersededBefore.mockRejectedValue(new Error('database away'));
    await expect(PublicationService.purgeExpired()).resolves.toBe(0);
  });

  it('reports how many versions it cleared', async () => {
    publication.purgeSupersededBefore.mockResolvedValue({ count: 3 } as never);
    expect(await PublicationService.purgeExpired()).toBe(3);
  });
});

describe('findPublishedQuiz', () => {
  it('returns null when the quiz belongs to no course', async () => {
    curriculum.courseIdFromQuiz.mockResolvedValue(null as never);
    expect(await PublicationService.findPublishedQuiz('q1')).toBeNull();
  });

  it('finds the quiz inside the live snapshot', async () => {
    curriculum.courseIdFromQuiz.mockResolvedValue('c1' as never);
    curriculum.getCourseById.mockResolvedValue(courseRow() as never);
    publication.getLive.mockResolvedValue({
      snapshot: { modules: [{ quizzes: [{ id: 'q1', title: 'Found' }] }] },
    } as never);

    expect(await PublicationService.findPublishedQuiz('q1')).toMatchObject({ title: 'Found' });
  });

  it('returns null when the quiz is not in the published version', async () => {
    curriculum.courseIdFromQuiz.mockResolvedValue('c1' as never);
    curriculum.getCourseById.mockResolvedValue(courseRow() as never);
    publication.getLive.mockResolvedValue({
      snapshot: { modules: [{ quizzes: [{ id: 'other' }] }] },
    } as never);

    expect(await PublicationService.findPublishedQuiz('q1')).toBeNull();
  });
});
