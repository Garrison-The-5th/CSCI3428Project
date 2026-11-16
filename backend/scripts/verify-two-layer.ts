/**
 * File: verify-two-layer.ts
 * Description: One-off check of a database after the two-layer migration —
 *   run once after deploying it, against the migrated database.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-11-13
 */
/**
 * What the migration itself could not say.
 *
 * `20261113120000_two_layer_model` checks its own copy against the old tables
 * and aborts if an element went missing, so by the time this runs the data has
 * already passed that. This looks at the result from the application's side:
 * that every row satisfies the rules the code now assumes, that every published
 * version still reads, and that the default tutorial is what start-up expects.
 *
 * Read-only. It changes nothing, so it is safe to run against production.
 *
 *   DATABASE_URL=… npx ts-node -r tsconfig-paths/register scripts/verify-two-layer.ts
 *
 * Exits 0 when every check passes and 1 otherwise.
 */
import { toNumber, toSortKey } from '@/services/curriculum-service/curriculum-service';
import { upgradeSnapshot } from '@/services/publication-service/legacy-snapshot';

import { prisma } from '../prisma/prisma-client';

let failures = 0;

function check(label: string, ok: boolean, detail = '') {
  if (ok) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ''}`);
  }
}

const sample = (ids: string[]) => ids.slice(0, 5).join(', ') + (ids.length > 5 ? ', …' : '');

async function main() {
  const [models, sections, quizzes, views, publications] = await Promise.all([
    prisma.model.count(),
    prisma.section.count(),
    prisma.quiz.count(),
    prisma.sectionProgress.count(),
    prisma.coursePublication.count(),
  ]);
  const byType = await prisma.section.groupBy({ by: ['type'], _count: true });

  console.log('counts');
  console.log(`  models ${models}, sections ${sections}, quizzes ${quizzes}`);
  console.log(`  section views ${views}, published versions ${publications}`);
  console.log(
    `  sections by type: ${byType.map((row) => `${row.type} ${row._count}`).join(', ') || 'none'}`,
  );

  console.log('\nthe old tables are gone');
  const tables = (
    await prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema()`
  ).map((row) => row.table_name);
  check('no Module table', !tables.includes('Module'));
  check(
    'no migration work tables left behind',
    !tables.some((name) => name.startsWith('_TwoLayer')),
  );
  if (tables.includes('Element')) {
    console.log('  note  Element and ElementProgress are still present — the follow-up');
    console.log('        migration 20261113120100_drop_element_tables has not been applied yet.');
  }

  console.log('\na quiz in a course is the whole of a QUIZ section');
  const strayQuizzes = await prisma.quiz.findMany({
    where: { section: { type: { not: 'QUIZ' } } },
    select: { id: true },
  });
  check(
    'no quiz sits in a section of another type',
    strayQuizzes.length === 0,
    sample(strayQuizzes.map((quiz) => quiz.id)),
  );

  const crowded = await prisma.$queryRaw<Array<{ sectionId: string }>>`
    SELECT "sectionId" FROM "Quiz"
    WHERE "sectionId" IS NOT NULL AND "deletedAt" IS NULL
    GROUP BY "sectionId" HAVING count(*) > 1`;
  check(
    'no section holds two live quizzes',
    crowded.length === 0,
    sample(crowded.map((row) => row.sectionId)),
  );

  const hollow = await prisma.section.findMany({
    where: { type: 'QUIZ', deletedAt: null, quizzes: { none: { deletedAt: null } } },
    select: { id: true },
  });
  check(
    'every live QUIZ section has its quiz',
    hollow.length === 0,
    sample(hollow.map((section) => section.id)),
  );

  console.log('\nthe numbering grid');
  const live = await prisma.section.findMany({
    where: { deletedAt: null, course: { deletedAt: null } },
    orderBy: [{ courseId: 'asc' }, { sortKey: 'asc' }],
    select: {
      id: true,
      courseId: true,
      modelId: true,
      position: true,
      number: true,
      sortKey: true,
      model: { select: { number: true, deletedAt: true } },
    },
  });
  const unplaced = live.filter((section) => !section.model || section.model.deletedAt);
  const misnumbered = live.filter(
    (section) =>
      section.model &&
      !section.model.deletedAt &&
      (section.number !== toNumber(section.model.number, section.position) ||
        section.sortKey !== toSortKey(section.model.number, section.position)),
  );
  check(
    'every live section is numbered from its model and position',
    misnumbered.length === 0,
    sample(misnumbered.map((section) => `${section.id} (${section.number})`)),
  );
  check(
    'no live section is without a live model',
    unplaced.length === 0,
    sample(unplaced.map((section) => section.id)),
  );

  const positions = new Map<string, number[]>();
  for (const section of live) {
    if (!section.modelId) continue;
    positions.set(section.modelId, [...(positions.get(section.modelId) ?? []), section.position]);
  }
  const gappy = [...positions].filter(([, taken]) =>
    [...taken].sort((a, b) => a - b).some((position, index) => position !== index + 1),
  );
  check(
    'positions run 1..n in every model, with no gaps or repeats',
    gappy.length === 0,
    sample(gappy.map(([modelId]) => modelId)),
  );

  console.log('\nthe course map');
  const lostPlacements = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT mi.id FROM "CourseMapItem" mi
    LEFT JOIN "Section" s ON s.id = mi."sectionId"
    WHERE s.id IS NULL`;
  check('every placement names a section that exists', lostPlacements.length === 0);

  console.log('\npublished versions');
  const versions = await prisma.coursePublication.findMany({
    where: { supersededAt: null },
    select: { id: true, courseId: true, version: true, snapshot: true },
  });
  let converted = 0;
  const unreadable: string[] = [];
  for (const version of versions) {
    const stored = version.snapshot as Record<string, unknown> | null;
    if (stored && !Array.isArray(stored.models)) converted += 1;

    const read = upgradeSnapshot(stored);
    const ok =
      read !== null &&
      Array.isArray(read.models) &&
      Array.isArray(read.sections) &&
      read.sections.every(
        (section) => typeof section.type === 'string' && !('elements' in section),
      ) &&
      new Set(read.sections.map((section) => section.id)).size === read.sections.length;
    if (!ok) unreadable.push(`${version.courseId} v${version.version}`);
  }
  console.log(
    `  ${versions.length} live version(s); ${converted} still stored in an older shape and converted on read`,
  );
  check(
    'every live version reads as models and typed sections',
    unreadable.length === 0,
    sample(unreadable),
  );

  console.log('\nthe default tutorial');
  const tutorial = await prisma.course.findFirst({
    where: { isDefaultTutorial: true },
    select: {
      id: true,
      title: true,
      publishedVersion: true,
      models: { where: { deletedAt: null }, select: { title: true } },
      sections: {
        where: { deletedAt: null },
        orderBy: { sortKey: 'asc' },
        select: { number: true, title: true, type: true, textContent: true },
      },
    },
  });
  if (!tutorial) {
    console.log('  note  there is no default tutorial yet — start-up creates it.');
  } else {
    console.log(
      `  "${tutorial.title}": ${tutorial.models.length} model(s), ${tutorial.sections.length} section(s)`,
    );
    for (const section of tutorial.sections) {
      console.log(`    ${section.number} ${section.title} [${section.type}]`);
    }
    check(
      'it has at least one model and one section',
      tutorial.models.length > 0 && tutorial.sections.length > 0,
    );
    check('it is published, so start-up has nothing to redo', tutorial.publishedVersion > 0);
    check(
      'its text sections kept their text',
      tutorial.sections
        .filter((section) => section.type === 'TEXT')
        .some((section) => (section.textContent ?? '').length > 0),
    );
  }

  console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
