/**
 * File: previewcheck.ts
 * Description: Every surface agrees about a directed course — preview, learner path and progress.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-09-25
 */
/**
 * Checks the one promise the Course content preview makes: that it shows the
 * author what a learner gets.
 *
 * Built around content the map *borrows* — an exam staged in from a quiz set,
 * placed on a branch — because that is where the two sides drifted apart. A
 * snapshot is built from the sections the course delivers; the preview was built
 * from the sections the course wrote. Those are the same thing right up until
 * somebody stages another course's content onto a node, and then the branch is
 * served to learners and missing from the preview.
 *
 * So this walks one map down both paths and compares the answers, rather than
 * asserting either one in isolation — the failure was never that one of them was
 * wrong on its own terms.
 */
import 'dotenv/config';

import CourseMapGateway from '@/gateways/course-map-gateway/course-map-gateway';
import CurriculumGateway from '@/gateways/curriculum-gateway/curriculum-gateway';
import AssignmentService from '@/services/assignment-service/assignment-service';
import AuthService from '@/services/auth-service/auth-service';
import CourseMapService from '@/services/course-map-service/course-map-service';
import CurriculumService from '@/services/curriculum-service/curriculum-service';
import DashboardService from '@/services/dashboard-service/dashboard-service';
import InsightsService from '@/services/insights-service/insights-service';
import PublicationService from '@/services/publication-service/publication-service';
import QuizService from '@/services/quiz-service/quiz-service';

import { CourseKind } from '../generated/prisma';
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

/** Section ids and the quizzes on them, which is what the two sides must agree on. */
function shapeOf(course: { sections: Array<{ id: string; quizzes?: Array<{ id: string }> }> }) {
  return course.sections.map((section) => ({
    id: section.id,
    quizzes: (section.quizzes ?? []).map((quiz) => quiz.id),
  }));
}

async function main() {
  const email = 'previewcheck@example.test';
  const author = await AuthService.getOrCreateUser('previewcheck-author@example.test');

  // ---- The quiz set whose exam gets staged onto the map ----
  const set = await CurriculumService.createCourse(
    'PREVIEW TEST quiz set — safe to delete',
    CourseKind.QUIZ_SET,
    author.id,
  );
  const [setModule] = await CurriculumGateway.getModules(set!.id);
  const examSection = await CurriculumService.createSection(set!.id, {
    moduleId: setModule.id,
    title: 'Safety exam',
  });
  const exam = await QuizService.createQuiz({ title: 'Safety exam', sectionId: examSection!.id });
  await QuizService.addQuestion(exam.id, {
    prompt: 'Where is the muster point?',
    options: [
      { text: 'The car park', isCorrect: true },
      { text: 'The roof', isCorrect: false },
    ],
  });

  // ---- The directed lesson that borrows it ----
  const lesson = await CurriculumService.createCourse(
    'PREVIEW TEST lesson — safe to delete',
    CourseKind.LESSON,
    author.id,
  );
  const courseId = lesson!.id;
  const [module] = await CurriculumGateway.getModules(courseId);
  const intro = await CurriculumService.createSection(courseId, {
    moduleId: module.id,
    title: 'Everyone reads this',
  });
  await CurriculumService.createElement(intro!.id, { type: 'TEXT', textContent: 'welcome' });

  await CourseMapService.setDirected(courseId, true);
  await CourseMapService.addImport(courseId, set!.id, author.id, false);

  const root = (await CourseMapGateway.getRoot(courseId))!;
  await CourseMapService.setNodeItems(root.id, [intro!.id]);

  const branch = await CourseMapService.createNode(courseId, { title: 'Needs the exam' });
  await CourseMapService.setNodeItems(branch.id, [examSection!.id]);
  await CourseMapService.connect(root.id, branch.id);

  /*
    A second branch, deliberately never picked.

    Without one every section in the course is on every learner's path, and the
    progress checks at the bottom cannot tell "measured against your own path"
    apart from "measured against the whole map" — which is exactly the bug they
    exist to catch.
  */
  const other = await CurriculumService.createSection(courseId, {
    moduleId: module.id,
    title: 'Somebody else’s branch',
  });
  await CurriculumService.createElement(other!.id, { type: 'TEXT', textContent: 'not for you' });
  const unpickedBranch = await CourseMapService.createNode(courseId, { title: 'Not taken' });
  await CourseMapService.setNodeItems(unpickedBranch.id, [other!.id]);
  await CourseMapService.connect(root.id, unpickedBranch.id);

  await CourseMapService.stage(courseId);
  await PublicationService.publish(courseId, author.id);

  console.log('the staged exam is on the map');
  const nodes = await CourseMapGateway.getNodes(courseId);
  check(
    'the branch holds the borrowed section',
    nodes.find((node) => node.id === branch.id)?.items.map((item) => item.sectionId),
    [examSection!.id],
  );

  // ---- The learner, having picked the branch ----
  await AssignmentService.assign({ email, type: 'PLATFORM', courseId });
  const learner = await AuthService.getOrCreateUser(email);
  await CourseMapGateway.saveChoice(learner.id, courseId, 1, [branch.id]);

  const real = await CurriculumService.getCourseForLearner(email, courseId);
  const preview = await CourseMapService.previewFor(courseId, new Map([[1, [branch.id]]]));

  console.log('\nthe learner is served the staged exam');
  check(
    'the borrowed section is in their course',
    real?.sections.some((section) => section.id === examSection!.id),
    true,
  );
  check(
    'and the quiz on it',
    real?.sections
      .find((section) => section.id === examSection!.id)
      ?.quizzes?.map((quiz) => quiz.id),
    [exam.id],
  );

  console.log('\nand the preview shows the author exactly that');
  check(
    'the borrowed section is in the preview',
    preview.course.sections.some((section) => section.id === examSection!.id),
    true,
  );
  check(
    'and the quiz on it',
    preview.course.sections
      .find((section) => section.id === examSection!.id)
      ?.quizzes?.map((quiz) => quiz.id),
    [exam.id],
  );
  check(
    'the branch is drawn as a module',
    preview.course.modules.some((m) => m.title === 'Needs the exam'),
    true,
  );

  console.log('\nthe two agree, which is the whole promise the preview makes');
  check('same sections, same quizzes', shapeOf(preview.course), shapeOf(real!));

  console.log('\nand a branch nobody picked is absent from both');
  const unpicked = await CourseMapService.previewFor(courseId, new Map());
  const realUnpicked = await CurriculumService.getCourseForLearner(
    'previewcheck-nobody@example.test',
    courseId,
  );
  check(
    'not in the preview',
    unpicked.course.sections.some((section) => section.id === examSection!.id),
    false,
  );
  check('not served to somebody who has not answered', realUnpicked, null);

  /*
    And every surface counts the same path.

    The learner's own dashboard, the author's roster and the insights page each
    measure a course against a person. On a directed course that has to mean
    their branches rather than the whole map — otherwise somebody who has
    finished everything they will ever be shown reads as part way through, and
    `CourseCompletion` (stamped at 100% and nowhere else) is never written.
  */
  console.log('\nfinishing the path they were given counts as finishing the course');
  for (const section of real!.sections) {
    await CurriculumService.recordSectionView(learner.id, section.id);
    for (const quizOnIt of section.quizzes ?? []) {
      await prisma.quizAttempt.create({
        data: { userId: learner.id, quizId: quizOnIt.id, score: 0, total: 0 },
      });
    }
  }

  const dashboard = await DashboardService.getDashboard(learner.id, email);
  const card = dashboard.courseProgress.find((entry) => entry.courseId === courseId)!;
  check('the dashboard counts their path, not the map', card.totalSections, real!.sections.length);
  check('and calls it finished', card.percentComplete, 100);
  check(
    'so it stops being outstanding',
    dashboard.outstandingCourses.some((entry) => entry.courseId === courseId),
    false,
  );
  check(
    'and the completion is recorded',
    (await prisma.courseCompletion.findFirst({ where: { userId: learner.id, courseId } })) !== null,
    true,
  );

  const roster = await AssignmentService.listWithProgress({ courseId });
  const theirRow = roster.find((entry) => entry.email === email)!;
  check('the author’s roster agrees', theirRow.percentComplete, 100);

  const insights = (await InsightsService.getLearner(email, null))!;
  const held = insights.courses.find((entry) => entry.courseId === courseId)!;
  check('and so does student insights', held.percentComplete, 100);

  /*
    And "new content" only fires for content on the path they took.

    New is retired by reading the thing that is new. A mark pointing at a branch
    this learner cannot open therefore never clears — the course would claim
    something was waiting for them for ever — so the marks have to be narrowed to
    their own path exactly as everything else is.
  */
  console.log('\ncontent added elsewhere on the map is not announced to them');
  const elsewhere = await CurriculumService.createSection(courseId, {
    moduleId: module.id,
    title: 'Added to the branch they skipped',
  });
  await CurriculumService.createElement(elsewhere!.id, {
    type: 'TEXT',
    textContent: 'not for you',
  });
  await CourseMapService.setNodeItems(unpickedBranch.id, [other!.id, elsewhere!.id]);
  await PublicationService.publish(courseId, author.id);

  check(
    'nothing is marked new',
    (await PublicationService.getNewIdsForLearner(courseId, learner.id)).newSectionIds.length,
    0,
  );
  check(
    'and the course is not flagged as updated',
    (await DashboardService.getDashboard(learner.id, email)).updatedCourses.some(
      (entry) => entry.courseId === courseId,
    ),
    false,
  );

  console.log('\nbut content added to their own branch is');
  const forThem = await CurriculumService.createSection(courseId, {
    moduleId: module.id,
    title: 'Added to their branch',
  });
  await CurriculumService.createElement(forThem!.id, { type: 'TEXT', textContent: 'for you' });
  await CourseMapService.setNodeItems(branch.id, [examSection!.id, forThem!.id]);
  await PublicationService.publish(courseId, author.id);

  check(
    'exactly the one section they can reach',
    (await PublicationService.getNewIdsForLearner(courseId, learner.id)).newSectionIds,
    [forThem!.id],
  );

  // ---- Tidy up ----
  await prisma.assignment.deleteMany({ where: { courseId } });
  await prisma.course.delete({ where: { id: courseId } });
  await prisma.course.delete({ where: { id: set!.id } });
  await prisma.user.deleteMany({
    where: { email: { in: [email, 'previewcheck-author@example.test'] } },
  });
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
