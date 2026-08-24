/**
 * File: privacy-service.test.ts
 * Description: Unit tests for subject-access export and erasure of a learner's
 *   personal data.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Date: 2026-08-17
 */
import PrivacyService from '@/services/privacy-service/privacy-service';

import { prisma } from '../../prisma/prisma-client';

/**
 * The two rights a learner can exercise over their own data.
 *
 * These had no tests at all, which is the wrong place in this codebase to have
 * none: TTG Technology Standards 3.5.3 requires that "users have a method to
 * remove or export their data on demand", so these two methods *are* the
 * compliance control. Both fail quietly if they fail — an export that silently
 * omits a table still returns a plausible-looking document, and an erasure that
 * misses a column still reports success — so the assertions below are about
 * what is actually in the payload and what actually got written, not about the
 * calls returning.
 */
jest.mock('../../prisma/prisma-client', () => ({
  prisma: {
    user: { findUnique: jest.fn(), update: jest.fn() },
    assignment: { findMany: jest.fn(), updateMany: jest.fn() },
    note: { deleteMany: jest.fn() },
    $transaction: jest.fn(),
  },
}));

jest.mock('@/config/logger', () => ({
  logSecurityEvent: jest.fn(),
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const db = prisma as unknown as {
  user: { findUnique: jest.Mock; update: jest.Mock };
  assignment: { findMany: jest.Mock; updateMany: jest.Mock };
  note: { deleteMany: jest.Mock };
  $transaction: jest.Mock;
};

/** A learner with one row in each table the export is supposed to cover. */
function userFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    email: 'ada@example.com',
    name: 'Ada Lovelace',
    role: 'learner',
    subscribed: true,
    lastSignInAt: new Date('2026-05-01T09:00:00Z'),
    sectionViews: [
      {
        viewedAt: new Date('2026-05-02T10:00:00Z'),
        section: { number: '1.2', title: 'Extinguishers', course: { title: 'Fire safety' } },
      },
    ],
    quizAttempts: [
      {
        score: 4,
        total: 5,
        completedAt: new Date('2026-05-03T11:00:00Z'),
        quiz: { title: 'Fire safety check' },
      },
    ],
    completions: [
      {
        completedAt: new Date('2026-05-04T12:00:00Z'),
        sectionCount: 6,
        course: { title: 'Fire safety' },
      },
    ],
    notes: [
      {
        body: 'Assembly point is the car park',
        sectionId: 'section-1',
        createdAt: new Date('2026-05-02T10:05:00Z'),
        course: { title: 'Fire safety' },
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  db.assignment.findMany.mockResolvedValue([]);
});

describe('exportUser', () => {
  it('refuses an id that belongs to nobody', async () => {
    db.user.findUnique.mockResolvedValue(null);
    await expect(PrivacyService.exportUser(7)).rejects.toThrow(/No account found/);
  });

  /**
   * The point of the export is that the person receiving it can read it. Ids are
   * resolved to titles on the way out, and a document full of UUIDs would meet
   * the letter of the requirement while being useless.
   */
  it('resolves every record to something a human can read', async () => {
    db.user.findUnique.mockResolvedValue(userFixture());

    const dump = await PrivacyService.exportUser(7);

    expect(dump.account).toMatchObject({ email: 'ada@example.com', name: 'Ada Lovelace' });
    expect(dump.sectionProgress).toEqual([
      { section: '1.2 Extinguishers', course: 'Fire safety', viewedAt: expect.any(String) },
    ]);
    expect(dump.quizAttempts[0]).toMatchObject({ quiz: 'Fire safety check', score: 4, total: 5 });
    expect(dump.courseCompletions[0]).toMatchObject({ course: 'Fire safety', sectionCount: 6 });
    expect(dump.notes[0]).toMatchObject({ body: 'Assembly point is the car park' });
  });

  /** Every date crosses the wire as an ISO string, or the file is not portable. */
  it('writes dates as ISO strings throughout', async () => {
    db.user.findUnique.mockResolvedValue(userFixture());
    db.assignment.findMany.mockResolvedValue([
      {
        courseId: 'course-1',
        assignedAt: new Date('2026-04-01T08:00:00Z'),
        dueDate: new Date('2026-06-01T08:00:00Z'),
        lastAccessedAt: null,
        course: { title: 'Fire safety' },
        quiz: null,
      },
    ]);

    const dump = await PrivacyService.exportUser(7);

    expect(dump.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(dump.account.lastSignInAt).toBe('2026-05-01T09:00:00.000Z');
    expect(dump.assignments[0]).toMatchObject({
      item: 'Fire safety',
      kind: 'course',
      assignedAt: '2026-04-01T08:00:00.000Z',
      dueDate: '2026-06-01T08:00:00.000Z',
      lastAccessedAt: null,
    });
  });

  it('labels a quiz assignment as a quiz rather than a course', async () => {
    db.user.findUnique.mockResolvedValue(userFixture());
    db.assignment.findMany.mockResolvedValue([
      {
        courseId: null,
        assignedAt: new Date('2026-04-01T08:00:00Z'),
        dueDate: null,
        lastAccessedAt: null,
        course: null,
        quiz: { title: 'Induction assessment' },
      },
    ]);

    const dump = await PrivacyService.exportUser(7);

    expect(dump.assignments[0]).toMatchObject({ item: 'Induction assessment', kind: 'quiz' });
  });

  /**
   * An assignment whose course was deleted still says something was assigned.
   * Dropping the row would quietly under-report what the platform held.
   */
  it('still reports an assignment whose item has since been removed', async () => {
    db.user.findUnique.mockResolvedValue(userFixture());
    db.assignment.findMany.mockResolvedValue([
      {
        courseId: 'gone',
        assignedAt: new Date('2026-04-01T08:00:00Z'),
        dueDate: null,
        lastAccessedAt: null,
        course: null,
        quiz: null,
      },
    ]);

    const dump = await PrivacyService.exportUser(7);

    expect(dump.assignments[0].item).toBe('Removed item');
  });

  /** Course material is the organisation's, not the learner's, and stays out. */
  it('says in the file itself what it does and does not cover', async () => {
    db.user.findUnique.mockResolvedValue(userFixture());
    const dump = await PrivacyService.exportUser(7);
    expect(dump.notice).toMatch(/does not include course material/i);
  });
});

describe('eraseUser', () => {
  beforeEach(() => {
    db.$transaction.mockResolvedValue([{ count: 3 }, { count: 1 }, {}]);
  });

  it('refuses an id that belongs to nobody', async () => {
    db.user.findUnique.mockResolvedValue(null);
    await expect(PrivacyService.eraseUser(7)).rejects.toThrow(/No account found/);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  /**
   * Anonymise, do not delete. This is a compliance platform: an organisation may
   * have to show that somebody completed an induction on a date, so the progress
   * rows survive with the person detached from them.
   */
  it('detaches the person and leaves the training record standing', async () => {
    db.user.findUnique.mockResolvedValue(userFixture());

    const result = await PrivacyService.eraseUser(7);

    const written = db.user.update.mock.calls[0][0];
    expect(written.where).toEqual({ id: 7 });
    expect(written.data.name).toBeNull();
    expect(written.data.subscribed).toBe(false);
    expect(written.data.lastSignInAt).toBeNull();
    expect(result.anonymisedId).toBe(7);
  });

  /**
   * The address is replaced rather than nulled: it is unique and non-null, and
   * assigning the same real address later has to create a fresh person rather
   * than reviving this one. `.invalid` is reserved by RFC 2606, so the tombstone
   * can never collide with a deliverable address.
   */
  it('replaces the address with an undeliverable tombstone', async () => {
    db.user.findUnique.mockResolvedValue(userFixture());

    await PrivacyService.eraseUser(7);

    const tombstone = db.user.update.mock.calls[0][0].data.email;
    expect(tombstone).toMatch(/^erased-7-\d+@erased\.invalid$/);
    expect(tombstone).not.toContain('ada@example.com');
  });

  /** The address lives on assignments too, so those are detached and closed. */
  it('detaches and revokes the assignments carrying that address', async () => {
    db.user.findUnique.mockResolvedValue(userFixture());

    await PrivacyService.eraseUser(7);

    const call = db.assignment.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ email: 'ada@example.com' });
    expect(call.data.email).toMatch(/@erased\.invalid$/);
    expect(call.data.revokedAt).toBeInstanceOf(Date);
  });

  /** Notes are the learner's own writing: personal, and of no compliance value. */
  it('deletes the notes outright and reports how many went', async () => {
    db.user.findUnique.mockResolvedValue(userFixture());

    const result = await PrivacyService.eraseUser(7);

    expect(db.note.deleteMany).toHaveBeenCalledWith({ where: { userId: 7 } });
    expect(result.notesDeleted).toBe(3);
  });

  /** All three writes land together, or a half-erased person is left behind. */
  it('does the whole erasure in one transaction', async () => {
    db.user.findUnique.mockResolvedValue(userFixture());

    await PrivacyService.eraseUser(7);

    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.$transaction.mock.calls[0][0]).toHaveLength(3);
  });
});
