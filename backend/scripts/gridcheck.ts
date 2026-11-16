/**
 * File: gridcheck.ts
 * Description: Exercises the model/section numbering grid against the real database.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
/**
 * Exercises the model/section numbering grid against the real database.
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

/** The whole grid as "1.1 Title" strings, model by model. */
async function grid(courseId: string) {
  const course = await CurriculumGateway.getCourseById(courseId);
  if (!course) throw new Error('course vanished');
  return course.models.map((model) => ({
    model: `${model.number}. ${model.title}`,
    sections: course.sections
      .filter((m) => m.modelId === model.id)
      .sort((a, b) => a.position - b.position)
      .map((m) => `${m.number} ${m.title}`),
  }));
}

async function main() {
  const course = await CurriculumService.createCourse('GRID TEST — safe to delete');
  const courseId = course!.id;
  console.log(`course ${courseId}\n`);

  console.log('a new course starts with one model');
  check(
    'models',
    (await grid(courseId)).map((g) => g.model),
    ['1. Model 1'],
  );

  const [s1] = await CurriculumGateway.getModels(courseId);
  for (const title of ['Alpha', 'Bravo', 'Charlie']) {
    await CurriculumService.createSection(courseId, { modelId: s1.id, title, type: 'TEXT' });
  }

  console.log('\nsections take the next number in their model');
  check('grid', await grid(courseId), [
    { model: '1. Model 1', sections: ['1.1 Alpha', '1.2 Bravo', '1.3 Charlie'] },
  ]);

  console.log('\nadding a model at 1 pushes the existing one down');
  await CurriculumService.createModel(courseId, { title: 'Intro', number: 1 });
  check('grid', await grid(courseId), [
    { model: '1. Intro', sections: [] },
    { model: '2. Model 1', sections: ['2.1 Alpha', '2.2 Bravo', '2.3 Charlie'] },
  ]);

  console.log('\na model number past the end lands at the end');
  await CurriculumService.createModel(courseId, { title: 'Wrap up', number: 99 });
  check(
    'models',
    (await grid(courseId)).map((g) => g.model),
    ['1. Intro', '2. Model 1', '3. Wrap up'],
  );

  console.log('\ninserting a section mid-model renumbers the rest');
  const model2 = (await CurriculumGateway.getModels(courseId))[1];
  await CurriculumService.createSection(courseId, {
    modelId: model2.id,
    title: 'Inserted',
    type: 'TEXT',
    position: 2,
  });
  check('grid', (await grid(courseId))[1], {
    model: '2. Model 1',
    sections: ['2.1 Alpha', '2.2 Inserted', '2.3 Bravo', '2.4 Charlie'],
  });

  console.log('\ndragging a section to another model renumbers both');
  let models = await CurriculumGateway.getModels(courseId);
  let sections = await CurriculumGateway.getSectionsForRenumber(courseId);
  const bravo = sections.find((m) => m.number === '2.3')!;
  await CurriculumService.reorderStructure(courseId, [
    { id: models[0].id, sectionIds: [bravo.id] },
    {
      id: models[1].id,
      sectionIds: sections
        .filter((m) => m.modelId === models[1].id && m.id !== bravo.id)
        .map((m) => m.id),
    },
    { id: models[2].id, sectionIds: [] },
  ]);
  check('grid', await grid(courseId), [
    { model: '1. Intro', sections: ['1.1 Bravo'] },
    { model: '2. Model 1', sections: ['2.1 Alpha', '2.2 Inserted', '2.3 Charlie'] },
    { model: '3. Wrap up', sections: [] },
  ]);

  console.log('\ndragging a model carries its sections and renumbers them');
  models = await CurriculumGateway.getModels(courseId);
  sections = await CurriculumGateway.getSectionsForRenumber(courseId);
  const idsIn = (modelId: string) =>
    sections
      .filter((m) => m.modelId === modelId)
      .sort((a, b) => a.position - b.position)
      .map((m) => m.id);
  await CurriculumService.reorderStructure(courseId, [
    { id: models[1].id, sectionIds: idsIn(models[1].id) },
    { id: models[0].id, sectionIds: idsIn(models[0].id) },
    { id: models[2].id, sectionIds: idsIn(models[2].id) },
  ]);
  check('grid', await grid(courseId), [
    { model: '1. Model 1', sections: ['1.1 Alpha', '1.2 Inserted', '1.3 Charlie'] },
    { model: '2. Intro', sections: ['2.1 Bravo'] },
    { model: '3. Wrap up', sections: [] },
  ]);

  console.log('\ndeleting a section closes the gap it leaves');
  sections = await CurriculumGateway.getSectionsForRenumber(courseId);
  await CurriculumService.deleteSection(sections.find((m) => m.number === '1.2')!.id);
  check('grid', (await grid(courseId))[0], {
    model: '1. Model 1',
    sections: ['1.1 Alpha', '1.2 Charlie'],
  });

  console.log('\ndeleting a model takes its sections and closes the gap');
  models = await CurriculumGateway.getModels(courseId);
  await CurriculumService.deleteModel(models[0].id);
  check('grid', await grid(courseId), [
    { model: '1. Intro', sections: ['1.1 Bravo'] },
    { model: '2. Wrap up', sections: [] },
  ]);

  console.log('\na deleted section does not block the number it used to hold');
  models = await CurriculumGateway.getModels(courseId);
  await CurriculumService.createSection(courseId, {
    modelId: models[0].id,
    title: 'Delta',
    type: 'TEXT',
  });
  check('grid', (await grid(courseId))[0], {
    model: '1. Intro',
    sections: ['1.1 Bravo', '1.2 Delta'],
  });

  console.log('\na section cannot be restored while its model is still binned');
  const charlie = (await CurriculumGateway.getDeletedStructure(courseId)).sections.find(
    (m) => m.title === 'Charlie',
  )!;
  try {
    await CurriculumService.restoreSection(charlie.id);
    check('refused', 'no error', 'an error');
  } catch (error) {
    check(
      'refused',
      (error as Error).message,
      "restore this section's model first — a section lives inside one",
    );
  }

  console.log('\nthe course Archive lists the model with the section that comes back with it');
  const archive = await CurriculumService.getDeletedStructure(courseId);
  check(
    'archive',
    archive.models.map((m) => ({ title: m.title, sections: m.sections.map((s) => s.title) })),
    [{ title: 'Model 1', sections: ['Charlie', 'Alpha', 'Inserted'] }],
  );
  check('nothing loose', archive.sections, []);

  console.log('\nrestoring a model brings it back at the end, renumbered, with its sections');
  const gone = archive.models.find((s) => s.title === 'Model 1')!;
  await CurriculumService.restoreModel(gone.id);
  check(
    'models',
    (await grid(courseId)).map((g) => g.model),
    ['1. Intro', '2. Wrap up', '3. Model 1'],
  );
  check('grid', await grid(courseId), [
    { model: '1. Intro', sections: ['1.1 Bravo', '1.2 Delta'] },
    { model: '2. Wrap up', sections: [] },
    { model: '3. Model 1', sections: ['3.1 Alpha', '3.2 Inserted', '3.3 Charlie'] },
  ]);

  console.log('\nreordering rejects a partial grid');
  models = await CurriculumGateway.getModels(courseId);
  try {
    await CurriculumService.reorderStructure(courseId, [{ id: models[0].id, sectionIds: [] }]);
    check('rejected', 'no error', 'an error');
  } catch (error) {
    check('rejected', (error as Error).message, 'reorder must list every model in the course');
  }

  console.log('\na section cannot be added without a model');
  const bare = await prisma.course.create({ data: { title: 'GRID TEST bare' } });
  try {
    await CurriculumService.createSection(bare.id, { title: 'Orphan', type: 'TEXT' });
    check('refused', 'no error', 'an error');
  } catch (error) {
    check(
      'refused',
      (error as Error).message,
      'add a model before adding sections — a section lives inside one',
    );
  }

  console.log('\na section cannot be added without a type');
  try {
    await CurriculumService.createSection(courseId, { title: 'Blank' });
    check('refused', 'no error', 'an error');
  } catch (error) {
    check(
      'refused',
      (error as Error).message,
      'a section needs a type — one of YOUTUBE, IMAGE, TEXT, PDF, CANVAS, QUIZ',
    );
  }

  console.log('\na quiz is a section of its own, in the same sequence as the content');
  models = await CurriculumGateway.getModels(courseId);
  await CurriculumService.createSection(courseId, {
    modelId: models[0].id,
    title: 'Check',
    type: 'QUIZ',
    quizType: 'LEARNING_CHECK',
    position: 2,
  });
  check('grid', (await grid(courseId))[0], {
    model: '1. Intro',
    sections: ['1.1 Bravo', '1.2 Check', '1.3 Delta'],
  });
  const withQuiz = await CurriculumGateway.getCourseById(courseId);
  check(
    'only the quiz section holds a quiz',
    withQuiz!.sections.map((m) => `${m.type}:${m.quizzes.length}`),
    ['TEXT:0', 'QUIZ:1', 'TEXT:0', 'TEXT:0', 'TEXT:0', 'TEXT:0'],
  );

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
