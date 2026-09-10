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
    modules: [{ id: 's1', courseId: 'c1', number: 1, title: 'Intro', color: null }],
    sections: [
      {
        id: 'm1',
        courseId: 'c1',
        moduleId: 's1',
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
    expect(snapshot.modules).toHaveLength(1);
    expect(snapshot.sections[0].elements).toHaveLength(1);
  });

  /**
   * A course is published whole, quizzes included.
   *
   * This used to drop anything not separately published, which let an author
   * press Publish, be told the course was live, and still serve a section with
   * the quiz missing from it — there was a second switch inside the quiz editor
   * and nothing on screen said so. Elements never worked that way, and quizzes
   * no longer do either: what is in the course when it is published is what
   * learners get.
   */
  it('captures every quiz, however the old per-quiz flag was left', async () => {
    curriculum.getCourseById.mockResolvedValue(
      courseRow({
        sections: [
          {
            ...courseRow().sections[0],
            quizzes: [
              { id: 'live', published: true, questions: [] },
              { id: 'never-published-on-its-own', published: false, questions: [] },
            ],
          },
        ],
      }) as never,
    );

    const snapshot = await PublicationService.buildSnapshot('c1');

    expect(snapshot.sections[0].quizzes.map((entry) => entry.id)).toEqual([
      'live',
      'never-published-on-its-own',
    ]);
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

/**
 * A write is not a change.
 *
 * The badge used to come from the clock alone: anything written after the last
 * publish counted, and the editor writes constantly — it saves on blur and
 * auto-saves as you type, so tabbing through a field or setting a toggle back to
 * what it already was armed it. Nothing an author could do would clear it again,
 * because publishing re-armed it too.
 *
 * So the clock is now only the first question. When it says something was
 * written, the course is actually compared with what learners are reading.
 */
describe('hasUnpublishedChanges — comparing content, not clocks', () => {
  const publishedAt = new Date('2026-05-01T10:00:00Z');
  /** Something was saved after the publish — which is where the old bug began. */
  const written = { draftUpdatedAt: new Date('2026-05-02T10:00:00Z') };

  /** As it comes back out of the database: JSON, so dates are strings. */
  function stored(snapshot: unknown) {
    return JSON.parse(JSON.stringify(snapshot));
  }

  it('reports false when a save moved the clock but not the content', async () => {
    curriculum.getCourseById.mockResolvedValue(courseRow(written) as never);
    const live = await PublicationService.buildSnapshot('c1');
    publication.getLive.mockResolvedValue({ publishedAt, snapshot: stored(live) } as never);

    expect(await PublicationService.hasUnpublishedChanges('c1')).toBe(false);
  });

  /**
   * Prisma stamps `updatedAt` on every write whether the values moved or not, so
   * a no-op save changes the rows without changing a word of the course. That is
   * the same false positive one layer down, and it has to be ignored too.
   */
  it('ignores row bookkeeping that moves without the content moving', async () => {
    curriculum.getCourseById.mockResolvedValue(courseRow(written) as never);
    const live = await PublicationService.buildSnapshot('c1');
    publication.getLive.mockResolvedValue({
      publishedAt,
      snapshot: stored({ ...live, updatedAt: new Date('2019-01-01'), publishedVersion: 99 }),
    } as never);

    expect(await PublicationService.hasUnpublishedChanges('c1')).toBe(false);
  });

  it('reports true when the course really has been changed', async () => {
    curriculum.getCourseById.mockResolvedValue(courseRow(written) as never);
    const live = await PublicationService.buildSnapshot('c1');
    publication.getLive.mockResolvedValue({
      publishedAt,
      snapshot: stored({ ...live, title: 'What it used to be called' }),
    } as never);

    expect(await PublicationService.hasUnpublishedChanges('c1')).toBe(true);
  });

  /** Deep enough to catch an edit to a single question, not just the top level. */
  it('notices a change buried inside a section', async () => {
    curriculum.getCourseById.mockResolvedValue(courseRow(written) as never);
    const live = await PublicationService.buildSnapshot('c1');
    publication.getLive.mockResolvedValue({
      publishedAt,
      snapshot: stored({
        ...live,
        sections: [{ ...live.sections[0], title: 'Basics, as it was' }],
      }),
    } as never);

    expect(await PublicationService.hasUnpublishedChanges('c1')).toBe(true);
  });

  /** Nothing to compare against is not the same as nothing having changed. */
  it('reports true when the live version has no snapshot to read', async () => {
    curriculum.getCourseById.mockResolvedValue(courseRow(written) as never);
    publication.getLive.mockResolvedValue({ publishedAt } as never);

    expect(await PublicationService.hasUnpublishedChanges('c1')).toBe(true);
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
    expect(result.added.newSectionIds).toEqual([]);
  });

  /**
   * One button publishes the course and everything in it.
   *
   * The snapshot is what learners read, so this is not what makes the quizzes
   * reachable — it stops the row flag drifting away from the truth for the
   * places that still read it, and brings quizzes written before the per-quiz
   * publish button was removed up to date the first time their course is
   * published again.
   */
  it('publishes the quizzes in the course along with it', async () => {
    curriculum.getCourseById.mockResolvedValue(courseRow({ publishedVersion: 0 }) as never);

    await PublicationService.publish('c1', 1);

    expect(quiz.publishQuizzesInCourse).toHaveBeenCalledWith('c1');
  });

  it('records exactly what a later version added', async () => {
    curriculum.getCourseById.mockResolvedValue(
      courseRow({
        publishedVersion: 1,
        sections: [
          courseRow().sections[0],
          {
            ...courseRow().sections[0],
            id: 'm2',
            elements: [{ id: 'e2' }],
            quizzes: [],
          },
        ],
      }) as never,
    );
    // The previous version had only the first section.
    publication.getLive.mockResolvedValue({
      snapshot: {
        modules: [{ id: 's1' }],
        sections: [{ id: 'm1', elements: [{ id: 'e1' }], quizzes: [{ id: 'q1' }] }],
      },
    } as never);

    const result = await PublicationService.publish('c1', 1);

    expect(result.version).toBe(2);
    expect(result.added.newSectionIds).toEqual(['m2']);
    expect(result.added.newElementIds).toEqual(['e2']);
    expect(result.hasNewContent).toBe(true);
  });

  it('supersedes the previous version, starting its archive clock', async () => {
    curriculum.getCourseById.mockResolvedValue(courseRow({ publishedVersion: 3 }) as never);
    publication.getLive.mockResolvedValue({ snapshot: { modules: [], sections: [] } } as never);

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
        modules: [{ id: 's1' }],
        sections: [{ id: 'm1', elements: [{ id: 'e1' }], quizzes: [{ id: 'q1' }] }],
      },
    } as never);

    const result = await PublicationService.publish('c1', 1);

    expect(result.hasNewContent).toBe(false);
    expect(curriculum.touchContent).not.toHaveBeenCalled();
  });
});

describe('getNewIdsForLearner', () => {
  const liveSnapshot = {
    modules: [{ id: 's1' }],
    sections: [
      { id: 'm1', moduleId: 's1', elements: [{ id: 'e1' }], quizzes: [{ id: 'q1' }] },
      { id: 'm2', moduleId: 's1', elements: [{ id: 'e2' }], quizzes: [] },
    ],
  };

  beforeEach(() => {
    curriculum.getCourseById.mockResolvedValue(courseRow() as never);
    curriculum.getViewedSectionIds.mockResolvedValue([] as never);
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

    expect(result.newSectionIds).toEqual([]);
    expect(result.newModuleIds).toEqual([]);
  });

  it('marks nothing when no version has been published since they began', async () => {
    curriculum.getFirstActivityAt.mockResolvedValue(new Date('2026-01-01') as never);
    publication.listPublishedSince.mockResolvedValue([] as never);

    const result = await PublicationService.getNewIdsForLearner('c1', 1, liveSnapshot as never);
    expect(result.newSectionIds).toEqual([]);
  });

  it('marks what arrived after they started', async () => {
    curriculum.getFirstActivityAt.mockResolvedValue(new Date('2026-01-01') as never);
    publication.listPublishedSince.mockResolvedValue([
      { newModuleIds: [], newSectionIds: ['m2'], newElementIds: ['e2'], newQuizIds: [] },
    ] as never);

    const result = await PublicationService.getNewIdsForLearner('c1', 1, liveSnapshot as never);

    expect(result.newSectionIds).toEqual(['m2']);
    expect(result.newElementIds).toEqual(['e2']);
  });

  /**
   * Reading the new section is what makes it no longer new. Without this the
   * pills would stick forever.
   */
  it('retires a mark once the learner has read it', async () => {
    curriculum.getFirstActivityAt.mockResolvedValue(new Date('2026-01-01') as never);
    publication.listPublishedSince.mockResolvedValue([
      { newModuleIds: [], newSectionIds: ['m2'], newElementIds: ['e2'], newQuizIds: [] },
    ] as never);
    curriculum.getViewedSectionIds.mockResolvedValue([{ sectionId: 'm2' }] as never);
    curriculum.getViewedElementIds.mockResolvedValue([{ elementId: 'e2' }] as never);

    const result = await PublicationService.getNewIdsForLearner('c1', 1, liveSnapshot as never);

    expect(result.newSectionIds).toEqual([]);
    expect(result.newElementIds).toEqual([]);
  });

  /**
   * Something added in v4 and removed in v5 must not be marked new on a page
   * that no longer contains it.
   */
  it('does not mark content that no longer exists in the served version', async () => {
    curriculum.getFirstActivityAt.mockResolvedValue(new Date('2026-01-01') as never);
    publication.listPublishedSince.mockResolvedValue([
      { newModuleIds: [], newSectionIds: ['deleted-since'], newElementIds: [], newQuizIds: [] },
    ] as never);

    const result = await PublicationService.getNewIdsForLearner('c1', 1, liveSnapshot as never);
    expect(result.newSectionIds).toEqual([]);
  });

  /**
   * Taking only the newest version's delta would make marks vanish the moment
   * an author republished for any other reason.
   */
  it('accumulates across every version published since they began', async () => {
    curriculum.getFirstActivityAt.mockResolvedValue(new Date('2026-01-01') as never);
    publication.listPublishedSince.mockResolvedValue([
      { newModuleIds: [], newSectionIds: ['m1'], newElementIds: [], newQuizIds: [] },
      { newModuleIds: [], newSectionIds: ['m2'], newElementIds: [], newQuizIds: [] },
    ] as never);

    const result = await PublicationService.getNewIdsForLearner('c1', 1, liveSnapshot as never);
    expect(result.newSectionIds.sort()).toEqual(['m1', 'm2']);
  });

  /** A module heading stands in for its contents, so it clears only when they do. */
  it('keeps a new module marked until nothing inside it is outstanding', async () => {
    curriculum.getFirstActivityAt.mockResolvedValue(new Date('2026-01-01') as never);
    publication.listPublishedSince.mockResolvedValue([
      { newModuleIds: ['s1'], newSectionIds: [], newElementIds: [], newQuizIds: [] },
    ] as never);
    curriculum.getViewedSectionIds.mockResolvedValue([{ sectionId: 'm1' }] as never);

    const stillNew = await PublicationService.getNewIdsForLearner('c1', 1, liveSnapshot as never);
    expect(stillNew.newModuleIds).toEqual(['s1']);

    curriculum.getViewedSectionIds.mockResolvedValue([
      { sectionId: 'm1' },
      { sectionId: 'm2' },
    ] as never);

    const cleared = await PublicationService.getNewIdsForLearner('c1', 1, liveSnapshot as never);
    expect(cleared.newModuleIds).toEqual([]);
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

/**
 * Rolling back.
 *
 * The rule being protected is that a restore rolls *forward*: the old snapshot
 * goes out under a new number, and the version it replaces is superseded exactly
 * as an ordinary publish would supersede it. That is what keeps every row either
 * live or on an archive clock, which the retention sweep depends on.
 */
describe('restoreVersion', () => {
  const archived = (overrides: Record<string, unknown> = {}) => ({
    id: 'p1',
    courseId: 'c1',
    version: 2,
    snapshot: { title: 'As it was' },
    supersededAt: new Date('2026-02-01'),
    ...overrides,
  });

  it('refuses a version that does not exist', async () => {
    publication.getById.mockResolvedValue(null as never);
    await expect(PublicationService.restoreVersion('missing', 1)).rejects.toThrow(/not found/);
  });

  it('refuses the version learners are already reading', async () => {
    publication.getById.mockResolvedValue(archived({ supersededAt: null }) as never);
    await expect(PublicationService.restoreVersion('p1', 1)).rejects.toThrow(/already/);
  });

  it('refuses when the course behind it has gone', async () => {
    publication.getById.mockResolvedValue(archived() as never);
    curriculum.getCourseById.mockResolvedValue(null as never);
    await expect(PublicationService.restoreVersion('p1', 1)).rejects.toThrow(/not found/);
  });

  it('republishes the old snapshot under a fresh version number', async () => {
    publication.getById.mockResolvedValue(archived() as never);
    curriculum.getCourseById.mockResolvedValue(courseRow({ publishedVersion: 4 }) as never);
    publication.highestVersion.mockResolvedValue(4 as never);
    publication.create.mockResolvedValue({ publishedAt: new Date('2026-03-01') } as never);

    const result = await PublicationService.restoreVersion('p1', 7);

    expect(result).toEqual({ version: 5, restoredFrom: 2 });
    expect(publication.create).toHaveBeenCalledWith(
      expect.objectContaining({
        courseId: 'c1',
        version: 5,
        snapshot: { title: 'As it was' },
        publishedById: 7,
      }),
    );
  });

  /**
   * The number comes off the rows, not off the course. A course rolled back once
   * points at a version lower than ones that already exist, and reusing a number
   * would collide with the courseId+version unique constraint.
   */
  it('numbers above every existing version, not above the course pointer', async () => {
    publication.getById.mockResolvedValue(archived() as never);
    curriculum.getCourseById.mockResolvedValue(courseRow({ publishedVersion: 2 }) as never);
    publication.highestVersion.mockResolvedValue(9 as never);
    publication.create.mockResolvedValue({ publishedAt: new Date('2026-03-01') } as never);

    const result = await PublicationService.restoreVersion('p1', null);

    expect(result.version).toBe(10);
  });

  it('supersedes what was live, so it goes on the archive clock', async () => {
    publication.getById.mockResolvedValue(archived() as never);
    curriculum.getCourseById.mockResolvedValue(courseRow({ publishedVersion: 4 }) as never);
    publication.highestVersion.mockResolvedValue(4 as never);
    publication.create.mockResolvedValue({ publishedAt: new Date('2026-03-01') } as never);

    await PublicationService.restoreVersion('p1', 1);

    expect(publication.supersede).toHaveBeenCalledWith('c1', 4);
  });

  /** A rollback shows a learner nothing they have not already been offered. */
  it('marks nothing as new', async () => {
    publication.getById.mockResolvedValue(archived() as never);
    curriculum.getCourseById.mockResolvedValue(courseRow() as never);
    publication.highestVersion.mockResolvedValue(3 as never);
    publication.create.mockResolvedValue({ publishedAt: new Date('2026-03-01') } as never);

    await PublicationService.restoreVersion('p1', 1);

    expect(publication.create).toHaveBeenCalledWith(
      expect.objectContaining({
        newModuleIds: [],
        newSectionIds: [],
        newElementIds: [],
        newQuizIds: [],
      }),
    );
  });

  /**
   * A restore publishes old content while the author's draft still holds the new,
   * so the two differ and the editor has to keep saying so.
   *
   * The timestamps here are the realistic ones and that is the point of the test.
   * A publication row is stamped `now()` on insert, so the restore is always
   * *newer* than a draft last edited at some point in the past — and
   * `hasUnpublishedChanges` is the comparison `draftUpdatedAt > publishedAt`.
   * Anything that merely leaves the draft stamp alone, or aligns it with the new
   * publication, silently reports "up to date" on a course whose draft and live
   * version plainly disagree. An earlier version of this test used an artificially
   * old publishedAt, which took the other branch and hid exactly that.
   */
  it('leaves the draft reading as ahead of a restore stamped now', async () => {
    const now = new Date();
    const lastEdit = new Date(now.getTime() - 86_400_000); // edited yesterday

    publication.getById.mockResolvedValue(archived() as never);
    curriculum.getCourseById.mockResolvedValue(
      courseRow({ publishedVersion: 4, draftUpdatedAt: lastEdit }) as never,
    );
    publication.highestVersion.mockResolvedValue(4 as never);
    publication.create.mockResolvedValue({ publishedAt: now } as never);

    await PublicationService.restoreVersion('p1', 1);

    const written = curriculum.updateCourse.mock.calls.at(-1)?.[1] as {
      draftUpdatedAt: Date;
      published: boolean;
      publishedVersion: number;
    };

    expect(written).toMatchObject({ published: true, publishedVersion: 5 });
    // Strictly after, which is what makes hasUnpublishedChanges answer true.
    expect(written.draftUpdatedAt.getTime()).toBeGreaterThan(now.getTime());
  });

  /** A draft edited after the restore keeps its own, later, stamp. */
  it('keeps a draft stamp that is already ahead of the restore', async () => {
    const now = new Date();
    const laterEdit = new Date(now.getTime() + 60_000);

    publication.getById.mockResolvedValue(archived() as never);
    curriculum.getCourseById.mockResolvedValue(
      courseRow({ publishedVersion: 4, draftUpdatedAt: laterEdit }) as never,
    );
    publication.highestVersion.mockResolvedValue(4 as never);
    publication.create.mockResolvedValue({ publishedAt: now } as never);

    await PublicationService.restoreVersion('p1', 1);

    const written = curriculum.updateCourse.mock.calls.at(-1)?.[1] as { draftUpdatedAt: Date };
    expect(written.draftUpdatedAt).toEqual(laterEdit);
  });
});

describe('deleteVersion', () => {
  it('refuses a version that does not exist', async () => {
    publication.getById.mockResolvedValue(null as never);
    await expect(PublicationService.deleteVersion('missing')).rejects.toThrow(/not found/);
  });

  /**
   * Deleting the live version would leave the course pointing at something that
   * no longer exists — a published course nobody can open.
   */
  it('refuses the version learners are reading', async () => {
    publication.getById.mockResolvedValue({ version: 3, supersededAt: null } as never);

    await expect(PublicationService.deleteVersion('p1')).rejects.toThrow(/cannot be deleted/);
    expect(publication.deleteById).not.toHaveBeenCalled();
  });

  it('removes an archived version and says which it was', async () => {
    publication.getById.mockResolvedValue({
      version: 3,
      supersededAt: new Date('2026-02-01'),
    } as never);

    expect(await PublicationService.deleteVersion('p1')).toEqual({ version: 3 });
    expect(publication.deleteById).toHaveBeenCalledWith('p1');
  });

  /**
   * Somebody deliberately said "keep this for good". Honouring that on a single
   * click of a delete button is the whole worth of the promise.
   */
  it('refuses a version that is kept permanently', async () => {
    publication.getById.mockResolvedValue({
      version: 3,
      supersededAt: new Date('2026-02-01'),
      archivedAt: new Date('2026-02-02'),
    } as never);

    await expect(PublicationService.deleteVersion('p1')).rejects.toThrow(/kept permanently/);
    expect(publication.deleteById).not.toHaveBeenCalled();
  });
});

/**
 * Keeping a version, and letting it go again.
 *
 * The fourteen-day archive is a default for the versions nobody will open again.
 * This is the exception for the few that matter, and the exception has to be
 * exempt from the sweep rather than merely long-lived.
 */
describe('setVersionArchived', () => {
  it('keeps a replaced version for good', async () => {
    publication.getById.mockResolvedValue({
      version: 2,
      supersededAt: new Date('2026-02-01'),
    } as never);

    expect(await PublicationService.setVersionArchived('p1', true, 7)).toEqual({
      version: 2,
      archived: true,
    });
    expect(publication.setArchived).toHaveBeenCalledWith('p1', 7, true);
  });

  /**
   * The live version is already kept for as long as it is live, so marking it
   * would promise something the next publish quietly breaks.
   */
  it('refuses the version learners are reading', async () => {
    publication.getById.mockResolvedValue({ version: 3, supersededAt: null } as never);

    await expect(PublicationService.setVersionArchived('p1', true, 7)).rejects.toThrow(
      /already kept/,
    );
    expect(publication.setArchived).not.toHaveBeenCalled();
  });

  /** Letting one go is not a delete: it drops back into the ordinary history. */
  it('releases a kept version back to version history', async () => {
    publication.getById.mockResolvedValue({
      version: 2,
      supersededAt: new Date('2026-02-01'),
      archivedAt: new Date('2026-02-02'),
    } as never);

    expect(await PublicationService.setVersionArchived('p1', false, 7)).toEqual({
      version: 2,
      archived: false,
    });
    expect(publication.setArchived).toHaveBeenCalledWith('p1', 7, false);
    expect(publication.deleteById).not.toHaveBeenCalled();
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
      snapshot: { sections: [{ quizzes: [{ id: 'q1', title: 'Found' }] }] },
    } as never);

    expect(await PublicationService.findPublishedQuiz('q1')).toMatchObject({ title: 'Found' });
  });

  it('returns null when the quiz is not in the published version', async () => {
    curriculum.courseIdFromQuiz.mockResolvedValue('c1' as never);
    curriculum.getCourseById.mockResolvedValue(courseRow() as never);
    publication.getLive.mockResolvedValue({
      snapshot: { sections: [{ quizzes: [{ id: 'other' }] }] },
    } as never);

    expect(await PublicationService.findPublishedQuiz('q1')).toBeNull();
  });
});

/**
 * The reads the editor's version panel is built from, and the failure paths
 * underneath them.
 *
 * These were the part of the service with no tests, which is why its pinned
 * coverage slipped when `hasUnpublishedChanges` grew its content comparison —
 * the new branches landed in a file whose exercised share was already thin.
 */
describe('version reads', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  /**
   * A snapshot published before modules and sections traded names is read
   * through a shim. Getting this wrong does not throw — it silently swaps the
   * two levels of every old course.
   */
  it('reads a snapshot published under the old module/section naming', async () => {
    curriculum.getCourseById.mockResolvedValue(courseRow() as never);
    publication.getLive.mockResolvedValue({
      snapshot: {
        id: 'c1',
        title: 'Fire safety',
        // The old shape: the outer level was called `sections` and the inner
        // level `modules`, and the inner one carried the elements.
        sections: [{ id: 'outer-1', courseId: 'c1', number: 1, title: 'Intro' }],
        modules: [
          {
            id: 'inner-1',
            sectionId: 'outer-1',
            number: '1.1',
            title: 'Basics',
            elements: [{ id: 'e1' }],
            quizzes: [{ id: 'q1', moduleId: 'inner-1', questions: [] }],
          },
        ],
      },
    } as never);

    const snapshot = await PublicationService.getLiveSnapshot('c1');

    // The outer level becomes modules, the inner becomes sections.
    expect(snapshot!.modules.map((m) => m.id)).toEqual(['outer-1']);
    expect(snapshot!.sections.map((s) => s.id)).toEqual(['inner-1']);
    expect(snapshot!.sections[0].moduleId).toBe('outer-1');
    // Defaults that did not exist when the snapshot was written.
    expect(snapshot!.kind).toBe('LESSON');
    expect(snapshot!.sections[0].quizzes[0].type).toBe('EXAM');
    expect(snapshot!.sections[0].quizzes[0].showResults).toBe(true);
  });

  it('reports nothing outstanding on a course that has never been published', async () => {
    curriculum.getCourseById.mockResolvedValue(courseRow({ publishedVersion: 0 }) as never);

    await expect(PublicationService.getUnpublishedIds('c1')).resolves.toEqual({
      newModuleIds: [],
      newSectionIds: [],
      newElementIds: [],
      newQuizIds: [],
    });
  });

  /** What the editor tags as "not live yet": in the draft, absent from the live version. */
  it('names exactly what the draft has added since the live version', async () => {
    curriculum.getCourseById.mockResolvedValue(
      courseRow({
        sections: [
          courseRow().sections[0],
          { ...courseRow().sections[0], id: 'm2', elements: [{ id: 'e2' }], quizzes: [] },
        ],
      }) as never,
    );
    publication.getLive.mockResolvedValue({
      snapshot: { ...(await PublicationService.buildSnapshot('c1')), sections: [] },
    } as never);

    const added = await PublicationService.getUnpublishedIds('c1');

    expect(added.newSectionIds).toEqual(['m1', 'm2']);
    expect(added.newElementIds).toEqual(['e1', 'e2']);
  });

  /** A course never published has no snapshot, and is skipped rather than nulled into the list. */
  it('drops courses with no live snapshot when reading several at once', async () => {
    curriculum.getCourseById
      .mockResolvedValueOnce(courseRow() as never)
      .mockResolvedValueOnce(courseRow({ published: false, publishedVersion: 0 }) as never);
    publication.getLive.mockResolvedValue({
      snapshot: { id: 'c1', title: 'Fire safety' },
    } as never);

    const snapshots = await PublicationService.getLiveSnapshots(['c1', 'c2']);

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].id).toBe('c1');
  });

  it('lists the versions of a course', async () => {
    publication.listForCourse.mockResolvedValue([{ id: 'p1', version: 2 }] as never);
    await expect(PublicationService.listVersions('c1')).resolves.toEqual([
      { id: 'p1', version: 2 },
    ]);
  });

  it('reads one archived version', async () => {
    publication.getById.mockResolvedValue({ id: 'p1', version: 2 } as never);
    await expect(PublicationService.getVersion('p1')).resolves.toMatchObject({ version: 2 });
  });

  it('refuses a version id that does not exist', async () => {
    publication.getById.mockResolvedValue(null as never);
    await expect(PublicationService.getVersion('nope')).rejects.toThrow(/not found/);
  });

  /**
   * A comparison that cannot be made must not read as "nothing to publish".
   * Stranding an author on an up-to-date badge they cannot clear is the worse
   * of the two failures, so the fallback is to report changes.
   */
  it('reports changes when the two versions cannot be compared', async () => {
    curriculum.getCourseById
      .mockResolvedValueOnce(
        courseRow({ draftUpdatedAt: new Date('2026-05-02T10:00:00Z') }) as never,
      )
      .mockRejectedValueOnce(new Error('snapshot unreadable'));
    publication.getLive.mockResolvedValue({
      publishedAt: new Date('2026-05-01T10:00:00Z'),
      snapshot: { id: 'c1', title: 'Fire safety', sections: [] },
    } as never);

    await expect(PublicationService.hasUnpublishedChanges('c1')).resolves.toBe(true);
  });
});

/**
 * Reading an old version against the one learners are on now.
 *
 * The two trees are merged rather than shown side by side, because what an
 * author wants from an old version is one course with the differences marked on
 * it — this was here, this has gone, this arrived since — not two courses to
 * compare by eye. Everything unmarked is what they already know.
 */
describe('getVersionDiff', () => {
  /** A tree in the shape a stored snapshot has, trimmed to what the diff reads. */
  function tree(overrides: Record<string, unknown> = {}) {
    return {
      id: 'c1',
      title: 'Fire safety',
      modules: [{ id: 'mod1', courseId: 'c1', number: 1, title: 'Intro', color: null }],
      sections: [
        {
          id: 'sec1',
          moduleId: 'mod1',
          elements: [{ id: 'el1' }],
          quizzes: [{ id: 'quiz1', questions: [{ id: 'qq1' }] }],
        },
      ],
      ...overrides,
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    curriculum.getCourseById.mockResolvedValue({
      id: 'c1',
      published: true,
      publishedVersion: 5,
    } as never);
  });

  /** Everything in both versions is left plain, which is what makes marks read. */
  it('marks nothing when the two versions match', async () => {
    publication.getById.mockResolvedValue({
      courseId: 'c1',
      version: 4,
      snapshot: tree(),
    } as never);
    publication.getLive.mockResolvedValue({ snapshot: tree() } as never);

    const diff = await PublicationService.getVersionDiff('p1');

    expect(diff.status.modules.mod1).toBe('same');
    expect(diff.status.sections.sec1).toBe('same');
    expect(diff.status.elements.el1).toBe('same');
    expect(diff.status.quizzes.quiz1).toBe('same');
    expect(diff.status.questions.qq1).toBe('same');
    expect(diff.identical).toBe(true);
  });

  /** In the live version and not in this one: it arrived after this version. */
  it('marks what the live version has gained as added', async () => {
    publication.getById.mockResolvedValue({
      courseId: 'c1',
      version: 4,
      snapshot: tree(),
    } as never);
    publication.getLive.mockResolvedValue({
      snapshot: tree({
        modules: [
          { id: 'mod1', courseId: 'c1', number: 1, title: 'Intro', color: null },
          { id: 'mod2', courseId: 'c1', number: 2, title: 'Later', color: null },
        ],
      }),
    } as never);

    const diff = await PublicationService.getVersionDiff('p1');

    expect(diff.status.modules.mod2).toBe('added');
    expect(diff.status.modules.mod1).toBe('same');
    // Both versions' modules are drawn, or the added one would be marked and
    // then not appear anywhere.
    expect(diff.course.modules.map((module) => module.id)).toEqual(['mod1', 'mod2']);
    expect(diff.identical).toBe(false);
  });

  /** In this version and not in the live one: it has gone since. */
  it('marks what the live version has lost as removed', async () => {
    publication.getById.mockResolvedValue({
      courseId: 'c1',
      version: 4,
      snapshot: tree(),
    } as never);
    publication.getLive.mockResolvedValue({
      snapshot: tree({
        sections: [{ id: 'sec1', moduleId: 'mod1', elements: [], quizzes: [] }],
      }),
    } as never);

    const diff = await PublicationService.getVersionDiff('p1');

    expect(diff.status.elements.el1).toBe('removed');
    expect(diff.status.quizzes.quiz1).toBe('removed');
    expect(diff.status.questions.qq1).toBe('removed');
    // A section both versions have keeps everything either side put in it.
    expect(diff.course.sections[0].elements.map((element) => element.id)).toEqual(['el1']);
  });

  /**
   * Questions are diffed too. A version differing only by a reworded exam is
   * still a different course to sit, and a diff that stopped at the quiz would
   * call the two identical.
   */
  it('marks a question the live version added', async () => {
    publication.getById.mockResolvedValue({
      courseId: 'c1',
      version: 4,
      snapshot: tree(),
    } as never);
    publication.getLive.mockResolvedValue({
      snapshot: tree({
        sections: [
          {
            id: 'sec1',
            moduleId: 'mod1',
            elements: [{ id: 'el1' }],
            quizzes: [{ id: 'quiz1', questions: [{ id: 'qq1' }, { id: 'qq2' }] }],
          },
        ],
      }),
    } as never);

    const diff = await PublicationService.getVersionDiff('p1');

    expect(diff.status.questions.qq2).toBe('added');
    expect(diff.status.questions.qq1).toBe('same');
  });

  /**
   * With nothing live there is nothing to compare against. Everything reads as
   * removed, which is true — `identical` is false so the page can say it more
   * gracefully than a wall of red.
   */
  it('handles a course with no live version', async () => {
    curriculum.getCourseById.mockResolvedValue({
      id: 'c1',
      published: false,
      publishedVersion: 0,
    } as never);
    publication.getById.mockResolvedValue({
      courseId: 'c1',
      version: 1,
      snapshot: tree(),
    } as never);

    const diff = await PublicationService.getVersionDiff('p1');

    expect(diff.liveVersion).toBe(0);
    expect(diff.identical).toBe(false);
    expect(diff.status.modules.mod1).toBe('removed');
    // The tree still draws, so the version is readable rather than blank.
    expect(diff.course.modules).toHaveLength(1);
  });
});
