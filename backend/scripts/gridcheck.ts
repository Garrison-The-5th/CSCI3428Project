/**
 * File: gridcheck.ts
 * Description: Exercises the section/module numbering grid against the real database.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
/**
 * Exercises the section/module numbering grid against the real database.
 * Creates a throwaway course, puts it through every mutation that can disturb
 * the numbering, and asserts the grid stays contiguous and correctly labelled.
 */
import 'dotenv/config';

import CurriculumGateway from '@/gateways/curriculum-gateway/curriculum-gateway';
import CurriculumService from '@/services/curriculum-service/curriculum-service';

import { prisma } from '../prisma/prisma-client';

let failures = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${label}\n         expected ${e}\n         actual   ${a}`);
  }
}

/** The whole grid as "1.1 Title" strings, section by section. */
async function grid(courseId: string) {
  const course = await CurriculumGateway.getCourseById(courseId);
  if (!course) throw new Error('course vanished');
  return course.sections.map((section) => ({
    section: `${section.number}. ${section.title}`,
    modules: course.modules
      .filter((m) => m.sectionId === section.id)
      .sort((a, b) => a.position - b.position)
      .map((m) => `${m.number} ${m.title}`),
  }));
}

async function main() {
  const course = await CurriculumService.createCourse('GRID TEST — safe to delete');
  const courseId = course!.id;
  console.log(`course ${courseId}\n`);

  console.log('a new course starts with one section');
  check(
    'sections',
    (await grid(courseId)).map((g) => g.section),
    ['1. Section 1'],
  );

  const [s1] = await CurriculumGateway.getSections(courseId);
  for (const title of ['Alpha', 'Bravo', 'Charlie']) {
    await CurriculumService.createModule(courseId, { sectionId: s1.id, title });
  }

  console.log('\nmodules take the next number in their section');
  check('grid', await grid(courseId), [
    { section: '1. Section 1', modules: ['1.1 Alpha', '1.2 Bravo', '1.3 Charlie'] },
  ]);

  console.log('\nadding a section at 1 pushes the existing one down');
  await CurriculumService.createSection(courseId, { title: 'Intro', number: 1 });
  check('grid', await grid(courseId), [
    { section: '1. Intro', modules: [] },
    { section: '2. Section 1', modules: ['2.1 Alpha', '2.2 Bravo', '2.3 Charlie'] },
  ]);

  console.log('\na section number past the end lands at the end');
  await CurriculumService.createSection(courseId, { title: 'Wrap up', number: 99 });
  check(
    'sections',
    (await grid(courseId)).map((g) => g.section),
    ['1. Intro', '2. Section 1', '3. Wrap up'],
  );

  console.log('\ninserting a module mid-section renumbers the rest');
  const section2 = (await CurriculumGateway.getSections(courseId))[1];
  await CurriculumService.createModule(courseId, {
    sectionId: section2.id,
    title: 'Inserted',
    position: 2,
  });
  check('grid', (await grid(courseId))[1], {
    section: '2. Section 1',
    modules: ['2.1 Alpha', '2.2 Inserted', '2.3 Bravo', '2.4 Charlie'],
  });

  console.log('\ndragging a module to another section renumbers both');
  let sections = await CurriculumGateway.getSections(courseId);
  let modules = await CurriculumGateway.getModulesForRenumber(courseId);
  const bravo = modules.find((m) => m.number === '2.3')!;
  await CurriculumService.reorderStructure(courseId, [
    { id: sections[0].id, moduleIds: [bravo.id] },
    {
      id: sections[1].id,
      moduleIds: modules
        .filter((m) => m.sectionId === sections[1].id && m.id !== bravo.id)
        .map((m) => m.id),
    },
    { id: sections[2].id, moduleIds: [] },
  ]);
  check('grid', await grid(courseId), [
    { section: '1. Intro', modules: ['1.1 Bravo'] },
    { section: '2. Section 1', modules: ['2.1 Alpha', '2.2 Inserted', '2.3 Charlie'] },
    { section: '3. Wrap up', modules: [] },
  ]);

  console.log('\ndragging a section carries its modules and renumbers them');
  sections = await CurriculumGateway.getSections(courseId);
  modules = await CurriculumGateway.getModulesForRenumber(courseId);
  const idsIn = (sectionId: string) =>
    modules
      .filter((m) => m.sectionId === sectionId)
      .sort((a, b) => a.position - b.position)
      .map((m) => m.id);
  await CurriculumService.reorderStructure(courseId, [
    { id: sections[1].id, moduleIds: idsIn(sections[1].id) },
    { id: sections[0].id, moduleIds: idsIn(sections[0].id) },
    { id: sections[2].id, moduleIds: idsIn(sections[2].id) },
  ]);
  check('grid', await grid(courseId), [
    { section: '1. Section 1', modules: ['1.1 Alpha', '1.2 Inserted', '1.3 Charlie'] },
    { section: '2. Intro', modules: ['2.1 Bravo'] },
    { section: '3. Wrap up', modules: [] },
  ]);

  console.log('\ndeleting a module closes the gap it leaves');
  modules = await CurriculumGateway.getModulesForRenumber(courseId);
  await CurriculumService.deleteModule(modules.find((m) => m.number === '1.2')!.id);
  check('grid', (await grid(courseId))[0], {
    section: '1. Section 1',
    modules: ['1.1 Alpha', '1.2 Charlie'],
  });

  console.log('\ndeleting a section takes its modules and closes the gap');
  sections = await CurriculumGateway.getSections(courseId);
  await CurriculumService.deleteSection(sections[0].id);
  check('grid', await grid(courseId), [
    { section: '1. Intro', modules: ['1.1 Bravo'] },
    { section: '2. Wrap up', modules: [] },
  ]);

  console.log('\na deleted module does not block the number it used to hold');
  sections = await CurriculumGateway.getSections(courseId);
  await CurriculumService.createModule(courseId, { sectionId: sections[0].id, title: 'Delta' });
  check('grid', (await grid(courseId))[0], {
    section: '1. Intro',
    modules: ['1.1 Bravo', '1.2 Delta'],
  });

  console.log('\na module cannot be restored while its section is still binned');
  const charlie = (await CurriculumGateway.getDeletedModules()).find((m) => m.title === 'Charlie')!;
  try {
    await CurriculumService.restoreModule(charlie.id);
    check('refused', 'no error', 'an error');
  } catch (error) {
    check(
      'refused',
      (error as Error).message,
      "restore this module's section first — a module lives inside one",
    );
  }

  console.log('\nrestoring a section brings it back at the end, renumbered');
  const gone = (await CurriculumGateway.getDeletedSections()).find((s) => s.title === 'Section 1')!;
  await CurriculumService.restoreSection(gone.id);
  check(
    'sections',
    (await grid(courseId)).map((g) => g.section),
    ['1. Intro', '2. Wrap up', '3. Section 1'],
  );
  check('section came back empty', (await grid(courseId))[2].modules, []);

  console.log('\nwith the section back, the module restores onto the end of it');
  await CurriculumService.restoreModule(charlie.id);
  check('grid', await grid(courseId), [
    { section: '1. Intro', modules: ['1.1 Bravo', '1.2 Delta'] },
    { section: '2. Wrap up', modules: [] },
    { section: '3. Section 1', modules: ['3.1 Charlie'] },
  ]);

  console.log('\nreordering rejects a partial grid');
  sections = await CurriculumGateway.getSections(courseId);
  try {
    await CurriculumService.reorderStructure(courseId, [{ id: sections[0].id, moduleIds: [] }]);
    check('rejected', 'no error', 'an error');
  } catch (error) {
    check('rejected', (error as Error).message, 'reorder must list every section in the course');
  }

  console.log('\na module cannot be added without a section');
  const bare = await prisma.course.create({ data: { title: 'GRID TEST bare' } });
  try {
    await CurriculumService.createModule(bare.id, { title: 'Orphan' });
    check('refused', 'no error', 'an error');
  } catch (error) {
    check(
      'refused',
      (error as Error).message,
      'add a section before adding modules — a module lives inside one',
    );
  }

  await prisma.course.delete({ where: { id: bare.id } });
  await prisma.course.delete({ where: { id: courseId } });
  console.log('\ncleaned up.');

  console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
