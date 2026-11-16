/**
 * File: two-layer-migration.test.ts
 * Description: Runs the two-layer migration's SQL against a fixture in the old
 *   three-layer shape and checks what it produced.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-11-13
 */
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { Client } from 'pg';

import { splitSectionId, upgradeSnapshot } from '@/services/publication-service/legacy-snapshot';

import { hasDatabase } from '../setup-integration';

/**
 * The database the suite runs against is already migrated, so the old shape no
 * longer exists there. This test builds it again in a schema of its own: every
 * migration before the two-layer one is replayed into that schema, a fixture is
 * inserted the way old data looked, and then the real migration files are run
 * against it — the same SQL `migrate deploy` will run in production.
 *
 * The schema is dropped afterwards, and nothing here touches `public`.
 */
const MIGRATIONS = join(__dirname, '..', '..', 'prisma', 'migrations');
const TWO_LAYER = '20261113120000_two_layer_model';
const DROP_ELEMENTS = '20261113120100_drop_element_tables';
const SCHEMA = `two_layer_fixture_${process.pid}`;

const describeWithDatabase = hasDatabase ? describe : describe.skip;

const sqlOf = (folder: string) => readFileSync(join(MIGRATIONS, folder, 'migration.sql'), 'utf8');

describeWithDatabase('the two-layer migration', () => {
  let db: Client;

  const rows = async <T>(sql: string, params: unknown[] = []) =>
    (await db.query(sql, params)).rows as T[];

  beforeAll(async () => {
    db = new Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    await db.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await db.query(`CREATE SCHEMA "${SCHEMA}"`);
    await db.query(`SET search_path TO "${SCHEMA}"`);

    // The schema as it stood the moment before this migration.
    const earlier = readdirSync(MIGRATIONS)
      .filter((name) => /^\d{14}_/.test(name) && name < TWO_LAYER)
      .sort();
    for (const folder of earlier) await db.query(sqlOf(folder));

    await db.query(`
      INSERT INTO "User" (id, email) VALUES (1, 'ada@example.com'), (2, 'bo@example.com');

      INSERT INTO "Course" (id, title, "stagedContentIds")
      VALUES ('c1', 'Fire safety', ARRAY['mod-1', 'sec-a', 'sec-b']);

      INSERT INTO "Module" (id, "courseId", number, title, "deletedAt") VALUES
        ('mod-1', 'c1', 1, 'Basics', NULL),
        ('mod-layer', 'c1', 2, 'Directed learning quiz 1', NULL),
        ('mod-gone', 'c1', -1, 'Retired', '2026-11-01');

      INSERT INTO "Section"
        (id, "courseId", "moduleId", position, number, "sortKey", title, "estimatedMinutes", color, "createdAt", "deletedAt")
      VALUES
        -- Three elements with a quiz between the second and third, and a recycled quiz.
        ('sec-a', 'c1', 'mod-1', 1, '1.1', '000001.000001', 'Extinguishers', 15, '#c7d9f0', '2026-01-01', NULL),
        -- One element.
        ('sec-b', 'c1', 'mod-1', 2, '1.2', '000001.000002', 'Exits', 5, NULL, '2026-01-02', NULL),
        -- A quiz and nothing else, the way a quiz set's sections are.
        ('sec-c', 'c1', 'mod-1', 3, '1.3', '000001.000003', 'Final exam', 0, NULL, '2026-01-03', NULL),
        -- Nothing at all.
        ('sec-d', 'c1', 'mod-1', 4, '1.4', '000001.000004', 'Empty', 0, NULL, '2026-01-04', NULL),
        -- The map's generated quiz section.
        ('sec-layer', 'c1', 'mod-layer', 1, '2.1', '000002.000001', 'Directed learning quiz 1', 0, NULL, '2026-01-05', NULL),
        -- Deleted along with its module, holding two elements.
        ('sec-gone', 'c1', 'mod-gone', 1, 'deleted-sec-gone', 'deleted-sec-gone', 'Old stuff', 0, NULL, '2026-01-06', '2026-11-01');

      INSERT INTO "Element" (id, "sectionId", "order", type, "textContent", "videoUrl", "imageData", "imageType", "fileName", "durationMinutes", "lastEditedById", "lastEditedAt")
      VALUES
        ('el-1', 'sec-a', 1, 'TEXT', '<p>Read this first</p>', NULL, NULL, NULL, NULL, NULL, 2, '2026-06-01'),
        ('el-2', 'sec-a', 2, 'YOUTUBE', NULL, 'https://youtu.be/x', NULL, NULL, NULL, 4, NULL, NULL),
        ('el-3', 'sec-a', 4, 'IMAGE', NULL, NULL, 'AAAA', 'image/png', 'plan.png', NULL, NULL, NULL),
        ('el-4', 'sec-b', 1, 'PDF', NULL, NULL, 'BBBB', 'application/pdf', 'exits.pdf', NULL, NULL, NULL),
        ('el-5', 'sec-gone', 1, 'TEXT', 'old one', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
        ('el-6', 'sec-gone', 2, 'TEXT', 'old two', NULL, NULL, NULL, NULL, NULL, NULL, NULL);

      INSERT INTO "Quiz" (id, title, type, "sectionId", "order", "createdAt", "deletedAt") VALUES
        ('q-1', 'Quick check', 'LEARNING_CHECK', 'sec-a', 3, '2026-02-01', NULL),
        ('q-del', 'Scrapped check', 'LEARNING_CHECK', 'sec-a', 5, '2026-02-02', '2026-11-05'),
        ('q-2', 'Final exam', 'EXAM', 'sec-c', 1, '2026-02-03', NULL),
        ('q-layer', 'Directed learning quiz 1', 'DIRECTED', 'sec-layer', 1, '2026-02-04', NULL),
        ('q-solo', 'Standalone exam', 'EXAM', NULL, 0, '2026-02-05', NULL);

      INSERT INTO "Question" (id, "quizId", "order", prompt, "hintSectionNumber")
      VALUES ('qq-1', 'q-1', 1, 'Which way out?', '1.2');

      INSERT INTO "DirectedLayerQuiz" (id, "courseId", depth, "quizId", "moduleId")
      VALUES ('layer-1', 'c1', 1, 'q-layer', 'mod-layer');

      INSERT INTO "EditLease" (id, "courseId", scope, "targetId", "userId")
      VALUES ('lease-1', 'c1', 'MODULE', 'mod-1', 1);

      -- Ada opened the section and its first two elements, and sat the quiz.
      -- Bo opened the section before progress was tracked per element.
      INSERT INTO "SectionProgress" (id, "userId", "sectionId", "viewedAt") VALUES
        ('sp-1', 1, 'sec-a', '2026-03-02'),
        ('sp-2', 2, 'sec-a', '2026-03-10');
      INSERT INTO "ElementProgress" (id, "userId", "elementId", "viewedAt") VALUES
        ('ep-1', 1, 'el-1', '2026-03-01'),
        ('ep-2', 1, 'el-2', '2026-03-03');
      INSERT INTO "QuizAttempt" (id, "userId", "quizId", score, total, "completedAt")
      VALUES ('qa-1', 1, 'q-1', 1, 1, '2026-03-04');

      INSERT INTO "CourseMapNode" (id, "courseId", title, x, y, depth, "isRoot")
      VALUES ('node-root', 'c1', 'General content', 0, 0, 0, true);
      INSERT INTO "CourseMapItem" (id, "nodeId", "order", "sectionId", "sourceCourseId") VALUES
        ('item-1', 'node-root', 0, 'sec-a', 'c1'),
        ('item-2', 'node-root', 1, 'sec-b', 'c1');
    `);

    // A version published in the old shape, exactly as buildSnapshot wrote it.
    await db.query(
      `INSERT INTO "CoursePublication" (id, "courseId", version, snapshot, "newSectionIds", "newElementIds")
       VALUES ('pub-1', 'c1', 1, $1, ARRAY['sec-b'], ARRAY['el-2'])`,
      [JSON.stringify(oldSnapshot())],
    );

    await db.query(sqlOf(TWO_LAYER));
    await db.query(sqlOf(DROP_ELEMENTS));
  });

  afterAll(async () => {
    if (!db) return;
    await db.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await db.end();
  });

  /** The published version of the fixture, in the shape versions used to be stored in. */
  function oldSnapshot() {
    return {
      id: 'c1',
      title: 'Fire safety',
      modules: [{ id: 'mod-1', courseId: 'c1', number: 1, title: 'Basics', color: null }],
      sections: [
        {
          id: 'sec-a',
          courseId: 'c1',
          moduleId: 'mod-1',
          position: 1,
          number: '1.1',
          title: 'Extinguishers',
          estimatedMinutes: 15,
          color: '#c7d9f0',
          elements: [
            { id: 'el-1', order: 1, type: 'TEXT', textContent: '<p>Read this first</p>' },
            { id: 'el-2', order: 2, type: 'YOUTUBE', videoUrl: 'https://youtu.be/x' },
            { id: 'el-3', order: 4, type: 'IMAGE', imageData: 'AAAA' },
          ],
          quizzes: [{ id: 'q-1', title: 'Quick check', order: 3, questions: [] }],
        },
        {
          id: 'sec-b',
          courseId: 'c1',
          moduleId: 'mod-1',
          position: 2,
          number: '1.2',
          title: 'Exits',
          estimatedMinutes: 5,
          color: null,
          elements: [{ id: 'el-4', order: 1, type: 'PDF', imageData: 'BBBB' }],
          quizzes: [],
        },
        {
          id: 'sec-c',
          courseId: 'c1',
          moduleId: 'mod-1',
          position: 3,
          number: '1.3',
          title: 'Final exam',
          estimatedMinutes: 0,
          color: null,
          elements: [],
          quizzes: [{ id: 'q-2', title: 'Final exam', order: 1, questions: [] }],
        },
        {
          id: 'sec-d',
          courseId: 'c1',
          moduleId: 'mod-1',
          position: 4,
          number: '1.4',
          title: 'Empty',
          estimatedMinutes: 0,
          color: null,
          elements: [],
          quizzes: [],
        },
      ],
    };
  }

  const video = splitSectionId('element', 'el-2');
  const image = splitSectionId('element', 'el-3');
  const check = splitSectionId('quiz', 'q-1');

  it('renames Module to Model, keeping every id', async () => {
    const tables = (
      await rows<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = $1`,
        [SCHEMA],
      )
    ).map((row) => row.table_name);
    expect(tables).toContain('Model');
    expect(tables).not.toContain('Module');

    const models = await rows<{ id: string }>(`SELECT id FROM "Model" ORDER BY id`);
    // Live and deleted alike: three before, three after.
    expect(models.map((model) => model.id)).toEqual(['mod-1', 'mod-gone', 'mod-layer']);

    // Whatever pointed at a module still points at the same row.
    expect(await rows(`SELECT scope::text, "targetId" FROM "EditLease"`)).toEqual([
      { scope: 'MODEL', targetId: 'mod-1' },
    ]);
    expect(await rows(`SELECT "modelId" FROM "DirectedLayerQuiz"`)).toEqual([
      { modelId: 'mod-layer' },
    ]);
  });

  /**
   * The case the plan names: a section with three elements becomes three
   * sections in order, with its quiz as a section in the right place.
   */
  it('turns one section of three elements and a quiz into four sections, in order', async () => {
    const sections = await rows<{ number: string; id: string; type: string; title: string }>(
      `SELECT number, id, type::text, title FROM "Section"
       WHERE "modelId" = 'mod-1' AND "deletedAt" IS NULL ORDER BY "sortKey"`,
    );

    expect(sections).toEqual([
      // The first element keeps the old section id.
      { number: '1.1', id: 'sec-a', type: 'TEXT', title: 'Extinguishers' },
      { number: '1.2', id: video, type: 'YOUTUBE', title: 'Extinguishers' },
      // The quiz sat between the video and the picture, and still does.
      { number: '1.3', id: check, type: 'QUIZ', title: 'Quick check' },
      { number: '1.4', id: image, type: 'IMAGE', title: 'Extinguishers' },
      // Everything after moves down and keeps its id.
      { number: '1.5', id: 'sec-b', type: 'PDF', title: 'Exits' },
      // A section holding only a quiz becomes that quiz's section in place.
      { number: '1.6', id: 'sec-c', type: 'QUIZ', title: 'Final exam' },
      // A section holding nothing becomes an empty TEXT section.
      { number: '1.7', id: 'sec-d', type: 'TEXT', title: 'Empty' },
    ]);
  });

  it('copies each element’s content onto its section', async () => {
    const byId = new Map(
      (
        await rows<Record<string, unknown> & { id: string }>(
          `SELECT id, "textContent", "videoUrl", "imageData", "imageType", "fileName",
                  "durationMinutes", "estimatedMinutes", color, "lastEditedById", "sortKey", position
           FROM "Section" WHERE "courseId" = 'c1'`,
        )
      ).map((row) => [row.id, row]),
    );

    expect(byId.get('sec-a')).toMatchObject({
      textContent: '<p>Read this first</p>',
      estimatedMinutes: 15,
      // The element's "last edited" mark came with it.
      lastEditedById: 2,
      sortKey: '000001.000001',
      position: 1,
    });
    expect(byId.get(video)).toMatchObject({
      videoUrl: 'https://youtu.be/x',
      durationMinutes: 4,
      // The time estimate stays whole on the original; the colour is repeated.
      estimatedMinutes: 0,
      color: '#c7d9f0',
      sortKey: '000001.000002',
    });
    expect(byId.get(image)).toMatchObject({
      imageData: 'AAAA',
      imageType: 'image/png',
      fileName: 'plan.png',
    });
    expect(byId.get('sec-b')).toMatchObject({ imageData: 'BBBB', fileName: 'exits.pdf' });
    expect(byId.get('sec-d')).toMatchObject({ textContent: '' });
  });

  it('gives every element exactly one home and drops none', async () => {
    // Six elements went in. Every one is a non-quiz section with content.
    const homes = await rows<{ id: string }>(
      `SELECT id FROM "Section" WHERE "courseId" = 'c1' AND type <> 'QUIZ' AND id <> 'sec-d'`,
    );
    expect(homes).toHaveLength(6);

    // 6 sections before + 3 extra for sec-a's later items + 1 for its recycled
    // quiz + 1 for sec-gone's second element = 11.
    const total = await rows<{ count: string }>(`SELECT count(*) FROM "Section"`);
    expect(Number(total[0].count)).toBe(11);

    const tables = (
      await rows<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = $1`,
        [SCHEMA],
      )
    ).map((row) => row.table_name);
    expect(tables).not.toContain('Element');
    expect(tables).not.toContain('ElementProgress');
    expect(tables).not.toContain('_TwoLayerItem');
  });

  it('hangs each quiz off its own QUIZ section and leaves standalone quizzes alone', async () => {
    const quizzes = await rows<{ id: string; sectionId: string | null; type: string | null }>(
      `SELECT q.id, q."sectionId", s.type::text
       FROM "Quiz" q LEFT JOIN "Section" s ON s.id = q."sectionId" ORDER BY q.id`,
    );

    expect(quizzes).toEqual([
      { id: 'q-1', sectionId: check, type: 'QUIZ' },
      { id: 'q-2', sectionId: 'sec-c', type: 'QUIZ' },
      { id: 'q-del', sectionId: splitSectionId('quiz', 'q-del'), type: 'QUIZ' },
      { id: 'q-layer', sectionId: 'sec-layer', type: 'QUIZ' },
      { id: 'q-solo', sectionId: null, type: null },
    ]);

    // Questions keep their ids; a hint follows the section it named (1.2 → 1.5).
    expect(await rows(`SELECT id, "quizId", "hintSectionNumber" FROM "Question"`)).toEqual([
      { id: 'qq-1', quizId: 'q-1', hintSectionNumber: '1.5' },
    ]);
  });

  it('keeps recycled things recycled', async () => {
    const recycled = await rows<{ id: string; number: string; modelId: string }>(
      `SELECT id, number, "modelId" FROM "Section" WHERE "deletedAt" IS NOT NULL ORDER BY id`,
    );
    const gone2 = splitSectionId('element', 'el-6');
    const scrapped = splitSectionId('quiz', 'q-del');

    expect(recycled.map((section) => section.id).sort()).toEqual(
      [gone2, scrapped, 'sec-gone'].sort(),
    );
    // Parked outside the numbering space, like any deleted section.
    for (const section of recycled) expect(section.number).toBe(`deleted-${section.id}`);
  });

  it('moves progress onto the sections the content became', async () => {
    const views = await rows<{ userId: number; sectionId: string; day: string }>(
      `SELECT "userId", "sectionId", to_char("viewedAt", 'YYYY-MM-DD') AS day
       FROM "SectionProgress" ORDER BY "userId", "viewedAt", "sectionId"`,
    );

    expect(views).toEqual(
      [
        // Ada: the earliest of her section view and her view of its first element…
        { userId: 1, sectionId: 'sec-a', day: '2026-03-01' },
        // …the video she watched…
        { userId: 1, sectionId: video, day: '2026-03-03' },
        // …and the quiz she sat. Not the picture, which she never opened.
        { userId: 1, sectionId: check, day: '2026-03-04' },
        // Bo's view predates per-element tracking, which has always read as
        // "seen all of it" — so every content section it became is seen. The quiz
        // is not: he never attempted it.
        { userId: 2, sectionId: 'sec-a', day: '2026-03-10' },
        { userId: 2, sectionId: video, day: '2026-03-10' },
        { userId: 2, sectionId: image, day: '2026-03-10' },
      ].sort(
        (a, b) =>
          a.userId - b.userId ||
          a.day.localeCompare(b.day) ||
          a.sectionId.localeCompare(b.sectionId),
      ),
    );
  });

  it('keeps a mapped and staged course mapped and staged', async () => {
    const items = await rows<{ sectionId: string; order: number }>(
      `SELECT "sectionId", "order" FROM "CourseMapItem" WHERE "nodeId" = 'node-root' ORDER BY "order"`,
    );
    expect(items).toEqual([
      { sectionId: 'sec-a', order: 0 },
      { sectionId: video, order: 1 },
      { sectionId: check, order: 2 },
      { sectionId: image, order: 3 },
      { sectionId: 'sec-b', order: 4 },
    ]);

    const [course] = await rows<{ stagedContentIds: string[] }>(
      `SELECT "stagedContentIds" FROM "Course" WHERE id = 'c1'`,
    );
    expect([...course.stagedContentIds].sort()).toEqual(
      ['mod-1', 'sec-a', 'sec-b', video, check, image].sort(),
    );
  });

  /**
   * D6: the stored snapshot is not rewritten — and reading it through the
   * legacy reader arrives at exactly the section ids the migration produced,
   * which is what keeps a learner's progress attached to what they are reading.
   */
  it('leaves the published snapshot as it was, and the reader agrees with the migration', async () => {
    const [publication] = await rows<{
      snapshot: Record<string, unknown>;
      newSectionIds: string[];
    }>(`SELECT snapshot, "newSectionIds" FROM "CoursePublication" WHERE id = 'pub-1'`);

    expect(publication.snapshot).toEqual(oldSnapshot());
    // What that version added: "new elements" became "new sections".
    expect([...publication.newSectionIds].sort()).toEqual(['sec-b', video].sort());
    const columns = await rows<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = 'CoursePublication'`,
      [SCHEMA],
    );
    expect(columns.map((column) => column.column_name)).not.toContain('newElementIds');
    expect(columns.map((column) => column.column_name)).toContain('newModelIds');

    const migrated = await rows<{ id: string; number: string; type: string }>(
      `SELECT id, number, type::text FROM "Section"
       WHERE "modelId" = 'mod-1' AND "deletedAt" IS NULL ORDER BY "sortKey"`,
    );
    const read = upgradeSnapshot(publication.snapshot)!;

    expect(
      read.sections.map((section) => ({
        id: section.id,
        number: section.number,
        type: section.type,
      })),
    ).toEqual(migrated);
  });

  it('requires a type on every section from now on', async () => {
    await expect(
      db.query(
        `INSERT INTO "Section" (id, "courseId", "modelId", position, number, "sortKey", title)
         VALUES ('blank', 'c1', 'mod-1', 99, '1.99', '000001.000099', 'Blank')`,
      ),
    ).rejects.toThrow(/null value in column "type"/);
  });
});
