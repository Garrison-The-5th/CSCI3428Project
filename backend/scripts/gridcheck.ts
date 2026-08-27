/**
 * File: gridcheck.ts
 * Description: Exercises the module/section numbering grid against the real database.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
/**
 * Exercises the module/section numbering grid against the real database.
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

/** The whole grid as "1.1 Title" strings, module by module. */
async function grid(courseId: string) {
  const course = await CurriculumGateway.getCourseById(courseId);
  if (!course) throw new Error('course vanished');
  return course.modules.map((module) => ({
    module: `${module.number}. ${module.title}`,
    sections: course.sections
      .filter((m) => m.moduleId === module.id)
      .sort((a, b) => a.position - b.position)
      .map((m) => `${m.number} ${m.title}`),
  }));
}

async function main() {
  const course = await CurriculumService.createCourse('GRID TEST — safe to delete');
  const courseId = course!.id;
  console.log(`course ${courseId}\n`);

  console.log('a new course starts with one module');
  check(
    'modules',
    (await grid(courseId)).map((g) => g.module),
    ['1. Module 1'],
  );

  const [s1] = await CurriculumGateway.getModules(courseId);
  for (const title of ['Alpha', 'Bravo', 'Charlie']) {
    await CurriculumService.createSection(courseId, { moduleId: s1.id, title });
  }

  console.log('\nsections take the next number in their module');
  check('grid', await grid(courseId), [
    { module: '1. Module 1', sections: ['1.1 Alpha', '1.2 Bravo', '1.3 Charlie'] },
  ]);

  console.log('\nadding a module at 1 pushes the existing one down');
  await CurriculumService.createModule(courseId, { title: 'Intro', number: 1 });
  check('grid', await grid(courseId), [
    { module: '1. Intro', sections: [] },
    { module: '2. Module 1', sections: ['2.1 Alpha', '2.2 Bravo', '2.3 Charlie'] },
  ]);

  console.log('\na module number past the end lands at the end');
  await CurriculumService.createModule(courseId, { title: 'Wrap up', number: 99 });
  check(
    'modules',
    (await grid(courseId)).map((g) => g.module),
    ['1. Intro', '2. Module 1', '3. Wrap up'],
  );

  console.log('\ninserting a section mid-module renumbers the rest');
  const module2 = (await CurriculumGateway.getModules(courseId))[1];
  await CurriculumService.createSection(courseId, {
    moduleId: module2.id,
    title: 'Inserted',
    position: 2,
  });
  check('grid', (await grid(courseId))[1], {
    module: '2. Module 1',
    sections: ['2.1 Alpha', '2.2 Inserted', '2.3 Bravo', '2.4 Charlie'],
  });

  console.log('\ndragging a section to another module renumbers both');
  let modules = await CurriculumGateway.getModules(courseId);
  let sections = await CurriculumGateway.getSectionsForRenumber(courseId);
  const bravo = sections.find((m) => m.number === '2.3')!;
  await CurriculumService.reorderStructure(courseId, [
    { id: modules[0].id, sectionIds: [bravo.id] },
    {
      id: modules[1].id,
      sectionIds: sections
        .filter((m) => m.moduleId === modules[1].id && m.id !== bravo.id)
        .map((m) => m.id),
    },
    { id: modules[2].id, sectionIds: [] },
  ]);
  check('grid', await grid(courseId), [
    { module: '1. Intro', sections: ['1.1 Bravo'] },
    { module: '2. Module 1', sections: ['2.1 Alpha', '2.2 Inserted', '2.3 Charlie'] },
    { module: '3. Wrap up', sections: [] },
  ]);

  console.log('\ndragging a module carries its sections and renumbers them');
  modules = await CurriculumGateway.getModules(courseId);
  sections = await CurriculumGateway.getSectionsForRenumber(courseId);
  const idsIn = (moduleId: string) =>
    sections
      .filter((m) => m.moduleId === moduleId)
      .sort((a, b) => a.position - b.position)
      .map((m) => m.id);
  await CurriculumService.reorderStructure(courseId, [
    { id: modules[1].id, sectionIds: idsIn(modules[1].id) },
    { id: modules[0].id, sectionIds: idsIn(modules[0].id) },
    { id: modules[2].id, sectionIds: idsIn(modules[2].id) },
  ]);
  check('grid', await grid(courseId), [
    { module: '1. Module 1', sections: ['1.1 Alpha', '1.2 Inserted', '1.3 Charlie'] },
    { module: '2. Intro', sections: ['2.1 Bravo'] },
    { module: '3. Wrap up', sections: [] },
  ]);

  console.log('\ndeleting a section closes the gap it leaves');
  sections = await CurriculumGateway.getSectionsForRenumber(courseId);
  await CurriculumService.deleteSection(sections.find((m) => m.number === '1.2')!.id);
  check('grid', (await grid(courseId))[0], {
    module: '1. Module 1',
    sections: ['1.1 Alpha', '1.2 Charlie'],
  });

  console.log('\ndeleting a module takes its sections and closes the gap');
  modules = await CurriculumGateway.getModules(courseId);
  await CurriculumService.deleteModule(modules[0].id);
  check('grid', await grid(courseId), [
    { module: '1. Intro', sections: ['1.1 Bravo'] },
    { module: '2. Wrap up', sections: [] },
  ]);

  console.log('\na deleted section does not block the number it used to hold');
  modules = await CurriculumGateway.getModules(courseId);
  await CurriculumService.createSection(courseId, { moduleId: modules[0].id, title: 'Delta' });
  check('grid', (await grid(courseId))[0], {
    module: '1. Intro',
    sections: ['1.1 Bravo', '1.2 Delta'],
  });

  console.log('\na section cannot be restored while its module is still binned');
  const charlie = (await CurriculumGateway.getDeletedSections([courseId])).find(
    (m) => m.title === 'Charlie',
  )!;
  try {
    await CurriculumService.restoreSection(charlie.id);
    check('refused', 'no error', 'an error');
  } catch (error) {
    check(
      'refused',
      (error as Error).message,
      "restore this section's module first — a section lives inside one",
    );
  }

  console.log('\nrestoring a module brings it back at the end, renumbered');
  const gone = (await CurriculumGateway.getDeletedModules([courseId])).find(
    (s) => s.title === 'Module 1',
  )!;
  await CurriculumService.restoreModule(gone.id);
  check(
    'modules',
    (await grid(courseId)).map((g) => g.module),
    ['1. Intro', '2. Wrap up', '3. Module 1'],
  );
  check('module came back empty', (await grid(courseId))[2].sections, []);

  console.log('\nwith the module back, the section restores onto the end of it');
  await CurriculumService.restoreSection(charlie.id);
  check('grid', await grid(courseId), [
    { module: '1. Intro', sections: ['1.1 Bravo', '1.2 Delta'] },
    { module: '2. Wrap up', sections: [] },
    { module: '3. Module 1', sections: ['3.1 Charlie'] },
  ]);

  console.log('\nreordering rejects a partial grid');
  modules = await CurriculumGateway.getModules(courseId);
  try {
    await CurriculumService.reorderStructure(courseId, [{ id: modules[0].id, sectionIds: [] }]);
    check('rejected', 'no error', 'an error');
  } catch (error) {
    check('rejected', (error as Error).message, 'reorder must list every module in the course');
  }

  console.log('\na section cannot be added without a module');
  const bare = await prisma.course.create({ data: { title: 'GRID TEST bare' } });
  try {
    await CurriculumService.createSection(bare.id, { title: 'Orphan' });
    check('refused', 'no error', 'an error');
  } catch (error) {
    check(
      'refused',
      (error as Error).message,
      'add a module before adding sections — a section lives inside one',
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
