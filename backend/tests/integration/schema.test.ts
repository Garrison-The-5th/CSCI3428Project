/**
 * File: schema.test.ts
 * Description: Database tests — migration state, schema validation and foreign
 *   key / cascade integrity.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
import { prisma } from '../../prisma/prisma-client';
import { hasDatabase } from '../setup-integration';

/**
 * §5.5 names three database tests as required for a PostgreSQL + ORM project:
 * migration tests, schema validation tests and foreign key integrity tests.
 *
 * These matter more than usual here. The repository carries a known migration
 * defect — `20260727195114_add_quiz_question_option` had to be emptied by hand
 * because a later migration was given an earlier timestamp — and nothing until
 * now would have caught a repeat.
 */
const describeWithDatabase = hasDatabase ? describe : describe.skip;

describeWithDatabase('migrations', () => {
  it('has applied every migration in the repository, with none failed', async () => {
    const rows = await prisma.$queryRaw<
      Array<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }>
    >`SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations"`;

    expect(rows.length).toBeGreaterThan(0);

    const unfinished = rows.filter((row) => row.finished_at === null);
    const rolledBack = rows.filter((row) => row.rolled_back_at !== null);

    expect(unfinished).toEqual([]);
    expect(rolledBack).toEqual([]);
  });

  it('applied migrations in timestamp order, so a replay cannot fail', async () => {
    const rows = await prisma.$queryRaw<Array<{ migration_name: string }>>`
      SELECT migration_name FROM "_prisma_migrations" ORDER BY started_at ASC`;

    const names = rows.map((row) => row.migration_name);
    const sorted = [...names].sort();

    // Prisma replays by name. If application order and name order disagree, a
    // fresh database cannot be built from the migration history — which is
    // exactly the defect that had to be repaired by hand once already.
    expect(names).toEqual(sorted);
  });
});

describeWithDatabase('schema validation', () => {
  it('has every model the application expects', async () => {
    const rows = await prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`;

    const tables = rows.map((row) => row.table_name);

    for (const expected of [
      'User',
      'Course',
      'CoursePublication',
      'Module',
      'Section',
      'Element',
      'Quiz',
      'Question',
      'Option',
      'Assignment',
      'SectionProgress',
      'ElementProgress',
      'QuizAttempt',
      'QuizSession',
      'CourseCompletion',
      'Note',
      'Instructor',
    ]) {
      expect(tables).toContain(expected);
    }
  });

  it('enforces the uniqueness the numbering grid depends on', async () => {
    const course = await prisma.course.create({ data: { title: 'Unique test' } });
    const module = await prisma.module.create({
      data: { courseId: course.id, number: 1, title: 'One' },
    });

    // Two modules cannot share a number within one course.
    await expect(
      prisma.module.create({ data: { courseId: course.id, number: 1, title: 'Clash' } }),
    ).rejects.toThrow();

    await prisma.section.create({
      data: {
        courseId: course.id,
        moduleId: module.id,
        position: 1,
        number: '1.1',
        sortKey: '000001.000001',
        title: 'M',
      },
    });

    // Nor can two sections share a number.
    await expect(
      prisma.section.create({
        data: {
          courseId: course.id,
          moduleId: module.id,
          position: 2,
          number: '1.1',
          sortKey: '000001.000002',
          title: 'Clash',
        },
      }),
    ).rejects.toThrow();
  });

  it('enforces one user per email address', async () => {
    await prisma.user.create({ data: { email: 'unique@example.com' } });
    await expect(prisma.user.create({ data: { email: 'unique@example.com' } })).rejects.toThrow();
  });

  it('enforces one assignment token hash globally', async () => {
    const course = await prisma.course.create({ data: { title: 'Token test' } });
    await prisma.assignment.create({
      data: { tokenHash: 'shared-token', email: 'a@example.com', courseId: course.id },
    });

    await expect(
      prisma.assignment.create({
        data: { tokenHash: 'shared-token', email: 'b@example.com', courseId: course.id },
      }),
    ).rejects.toThrow();
  });

  it('enforces one completion per learner per course', async () => {
    const user = await prisma.user.create({ data: { email: 'once@example.com' } });
    const course = await prisma.course.create({ data: { title: 'Completion test' } });

    await prisma.courseCompletion.create({ data: { userId: user.id, courseId: course.id } });
    await expect(
      prisma.courseCompletion.create({ data: { userId: user.id, courseId: course.id } }),
    ).rejects.toThrow();
  });
});

describeWithDatabase('foreign key integrity', () => {
  it('refuses a section pointing at a course that does not exist', async () => {
    await expect(
      prisma.section.create({
        data: {
          courseId: '00000000-0000-0000-0000-000000000000',
          position: 1,
          number: '1.1',
          sortKey: '000001.000001',
          title: 'Orphan',
        },
      }),
    ).rejects.toThrow();
  });

  it('refuses progress against a user that does not exist', async () => {
    const course = await prisma.course.create({ data: { title: 'FK test' } });
    const section = await prisma.section.create({
      data: {
        courseId: course.id,
        position: 1,
        number: '1.1',
        sortKey: '000001.000001',
        title: 'M',
      },
    });

    await expect(
      prisma.sectionProgress.create({ data: { userId: 999_999, sectionId: section.id } }),
    ).rejects.toThrow();
  });

  /**
   * Deleting a course must take its whole tree. Without the cascade, purging
   * the recycle bin would leave orphaned sections and elements behind — and the
   * elements carry base64 media, so the leak would be measured in megabytes.
   */
  it('cascades a course delete through modules, sections, elements and quizzes', async () => {
    const course = await prisma.course.create({ data: { title: 'Cascade test' } });
    const module = await prisma.module.create({
      data: { courseId: course.id, number: 1, title: 'S' },
    });
    const section = await prisma.section.create({
      data: {
        courseId: course.id,
        moduleId: module.id,
        position: 1,
        number: '1.1',
        sortKey: '000001.000001',
        title: 'M',
      },
    });
    const element = await prisma.element.create({
      data: { sectionId: section.id, order: 1, type: 'TEXT', textContent: 'hello' },
    });
    const quiz = await prisma.quiz.create({ data: { title: 'Q', sectionId: section.id } });
    const question = await prisma.question.create({
      data: { quizId: quiz.id, order: 1, prompt: 'P' },
    });
    await prisma.option.create({
      data: { questionId: question.id, order: 1, text: 'A', isCorrect: true },
    });

    await prisma.course.delete({ where: { id: course.id } });

    expect(await prisma.module.findUnique({ where: { id: module.id } })).toBeNull();
    expect(await prisma.section.findUnique({ where: { id: section.id } })).toBeNull();
    expect(await prisma.element.findUnique({ where: { id: element.id } })).toBeNull();
    expect(await prisma.quiz.findUnique({ where: { id: quiz.id } })).toBeNull();
    expect(await prisma.question.findUnique({ where: { id: question.id } })).toBeNull();
    expect(await prisma.option.count({ where: { questionId: question.id } })).toBe(0);
  });

  it('cascades a user delete through their progress and notes', async () => {
    const user = await prisma.user.create({ data: { email: 'cascade@example.com' } });
    const course = await prisma.course.create({ data: { title: 'User cascade' } });
    const section = await prisma.section.create({
      data: {
        courseId: course.id,
        position: 1,
        number: '1.1',
        sortKey: '000001.000001',
        title: 'M',
      },
    });

    await prisma.sectionProgress.create({ data: { userId: user.id, sectionId: section.id } });
    await prisma.note.create({ data: { userId: user.id, courseId: course.id, body: 'note' } });

    await prisma.user.delete({ where: { id: user.id } });

    expect(await prisma.sectionProgress.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.note.count({ where: { userId: user.id } })).toBe(0);
  });

  /**
   * The assigner is set to null rather than cascading: removing a staff account
   * must not delete the assignments they handed out, or their learners would
   * silently lose their training.
   */
  it('nulls the assigner rather than deleting the assignment', async () => {
    const assigner = await prisma.user.create({ data: { email: 'assigner@example.com' } });
    const course = await prisma.course.create({ data: { title: 'Assigner test' } });
    const assignment = await prisma.assignment.create({
      data: {
        tokenHash: 'assigner-token',
        email: 'learner@example.com',
        courseId: course.id,
        assignedById: assigner.id,
      },
    });

    await prisma.user.delete({ where: { id: assigner.id } });

    const survived = await prisma.assignment.findUnique({ where: { id: assignment.id } });
    expect(survived).not.toBeNull();
    expect(survived?.assignedById).toBeNull();
  });

  it('cascades a course delete through its publications', async () => {
    const course = await prisma.course.create({ data: { title: 'Publication cascade' } });
    const publication = await prisma.coursePublication.create({
      data: { courseId: course.id, version: 1, snapshot: { id: course.id } },
    });

    await prisma.course.delete({ where: { id: course.id } });
    expect(await prisma.coursePublication.findUnique({ where: { id: publication.id } })).toBeNull();
  });

  it('enforces one publication per version per course', async () => {
    const course = await prisma.course.create({ data: { title: 'Version uniqueness' } });
    await prisma.coursePublication.create({
      data: { courseId: course.id, version: 1, snapshot: {} },
    });

    await expect(
      prisma.coursePublication.create({
        data: { courseId: course.id, version: 1, snapshot: {} },
      }),
    ).rejects.toThrow();
  });
});
