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
      'Model',
      'Section',
      'Quiz',
      'Question',
      'Option',
      'Assignment',
      'SectionProgress',
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
    const model = await prisma.model.create({
      data: { courseId: course.id, number: 1, title: 'One' },
    });

    // Two models cannot share a number within one course.
    await expect(
      prisma.model.create({ data: { courseId: course.id, number: 1, title: 'Clash' } }),
    ).rejects.toThrow();

    await prisma.section.create({
      data: {
        courseId: course.id,
        modelId: model.id,
        position: 1,
        number: '1.1',
        sortKey: '000001.000001',
        title: 'M',
        type: 'TEXT',
      },
    });

    // Nor can two sections share a number.
    await expect(
      prisma.section.create({
        data: {
          courseId: course.id,
          modelId: model.id,
          position: 2,
          number: '1.1',
          sortKey: '000001.000002',
          title: 'Clash',
          type: 'TEXT',
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

/**
 * The course structure is two layers: models, and the sections inside them,
 * where a section is one typed piece of content. These pin the parts of that
 * the database itself enforces.
 */
describeWithDatabase('the two-layer course structure', () => {
  it('has a Model table and no Module, Element or ElementProgress table', async () => {
    const rows = await prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema()`;
    const tables = new Set(rows.map((row) => row.table_name));

    expect(tables.has('Model')).toBe(true);
    expect(tables.has('Section')).toBe(true);
    expect(tables.has('Module')).toBe(false);
    expect(tables.has('Element')).toBe(false);
    expect(tables.has('ElementProgress')).toBe(false);
  });

  /**
   * "type is required on creation": the column is NOT NULL with no default, so
   * a section that does not say what it holds is refused by the database even
   * if something got past the service.
   */
  it('refuses a section with no type', async () => {
    const course = await prisma.course.create({ data: { title: 'Type test' } });
    const model = await prisma.model.create({
      data: { courseId: course.id, number: 1, title: 'One' },
    });

    await expect(
      prisma.$executeRaw`
        INSERT INTO "Section" (id, "courseId", "modelId", position, number, "sortKey", title)
        VALUES ('no-type', ${course.id}, ${model.id}, 1, '1.1', '000001.000001', 'Blank')`,
    ).rejects.toThrow(/null value in column "type"/);
  });

  it('accepts each of the six section types and nothing else', async () => {
    const course = await prisma.course.create({ data: { title: 'Types' } });
    const model = await prisma.model.create({
      data: { courseId: course.id, number: 1, title: 'One' },
    });

    const types = ['TEXT', 'YOUTUBE', 'IMAGE', 'PDF', 'CANVAS', 'QUIZ'] as const;
    for (const [index, type] of types.entries()) {
      await prisma.section.create({
        data: {
          courseId: course.id,
          modelId: model.id,
          position: index + 1,
          number: `1.${index + 1}`,
          sortKey: `000001.00000${index + 1}`,
          title: type,
          type,
        },
      });
    }
    expect(await prisma.section.count({ where: { courseId: course.id } })).toBe(6);

    await expect(
      prisma.$executeRaw`
        INSERT INTO "Section" (id, "courseId", "modelId", position, number, "sortKey", title, type)
        VALUES ('bad-type', ${course.id}, ${model.id}, 9, '1.9', '000001.000009', 'Bad', 'AUDIO')`,
    ).rejects.toThrow();
  });

  it('keeps a quiz hanging off its section, and takes it when the section goes', async () => {
    const course = await prisma.course.create({ data: { title: 'Quiz section' } });
    const model = await prisma.model.create({
      data: { courseId: course.id, number: 1, title: 'One' },
    });
    const section = await prisma.section.create({
      data: {
        courseId: course.id,
        modelId: model.id,
        position: 1,
        number: '1.1',
        sortKey: '000001.000001',
        title: 'Check',
        type: 'QUIZ',
      },
    });
    const quiz = await prisma.quiz.create({ data: { title: 'Check', sectionId: section.id } });

    await prisma.section.delete({ where: { id: section.id } });

    expect(await prisma.quiz.findUnique({ where: { id: quiz.id } })).toBeNull();
  });

  it('cascades a model delete to its sections', async () => {
    const course = await prisma.course.create({ data: { title: 'Model cascade' } });
    const model = await prisma.model.create({
      data: { courseId: course.id, number: 1, title: 'One' },
    });
    const section = await prisma.section.create({
      data: {
        courseId: course.id,
        modelId: model.id,
        position: 1,
        number: '1.1',
        sortKey: '000001.000001',
        title: 'S',
        type: 'TEXT',
      },
    });

    await prisma.model.delete({ where: { id: model.id } });

    expect(await prisma.section.findUnique({ where: { id: section.id } })).toBeNull();
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
          type: 'TEXT',
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
        type: 'TEXT',
      },
    });

    await expect(
      prisma.sectionProgress.create({ data: { userId: 999_999, sectionId: section.id } }),
    ).rejects.toThrow();
  });

  /**
   * Deleting a course must take its whole tree. Without the cascade, purging
   * the recycle bin would leave orphaned sections behind — and sections carry
   * base64 media, so the leak would be measured in megabytes.
   */
  it('cascades a course delete through models, sections and quizzes', async () => {
    const course = await prisma.course.create({ data: { title: 'Cascade test' } });
    const model = await prisma.model.create({
      data: { courseId: course.id, number: 1, title: 'S' },
    });
    const section = await prisma.section.create({
      data: {
        courseId: course.id,
        modelId: model.id,
        position: 1,
        number: '1.1',
        sortKey: '000001.000001',
        title: 'M',
        type: 'QUIZ',
      },
    });
    const text = await prisma.section.create({
      data: {
        courseId: course.id,
        modelId: model.id,
        position: 2,
        number: '1.2',
        sortKey: '000001.000002',
        title: 'T',
        type: 'TEXT',
        textContent: 'hello',
      },
    });
    const quiz = await prisma.quiz.create({ data: { title: 'Q', sectionId: section.id } });
    const question = await prisma.question.create({
      data: { quizId: quiz.id, order: 1, prompt: 'P' },
    });
    await prisma.option.create({
      data: { questionId: question.id, order: 1, text: 'A', isCorrect: true },
    });

    await prisma.course.delete({ where: { id: course.id } });

    expect(await prisma.model.findUnique({ where: { id: model.id } })).toBeNull();
    expect(await prisma.section.findUnique({ where: { id: section.id } })).toBeNull();
    expect(await prisma.section.findUnique({ where: { id: text.id } })).toBeNull();
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
        type: 'TEXT',
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
