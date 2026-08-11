/**
 * File: publishcheck.ts
 * Description: Exercises versioned publishing: that a learner reads the snapshot rather than.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
/**
 * Exercises versioned publishing: that a learner reads the snapshot rather than
 * the rows an author is editing, that edits as well as additions are held back
 * until published, that quizzes are graded against the version the learner was
 * shown, and that superseded versions archive rather than vanish.
 */
import 'dotenv/config';

import CurriculumGateway from '@/gateways/curriculum-gateway/curriculum-gateway';
import AssignmentService from '@/services/assignment-service/assignment-service';
import AuthService from '@/services/auth-service/auth-service';
import CurriculumService from '@/services/curriculum-service/curriculum-service';
import InsightsService from '@/services/insights-service/insights-service';
import PublicationService from '@/services/publication-service/publication-service';
import QuizService from '@/services/quiz-service/quiz-service';

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

async function main() {
  const email = 'publishcheck@example.test';

  const created = await CurriculumService.createCourse('PUBLISH TEST — safe to delete');
  const courseId = created!.id;
  const [section] = await CurriculumGateway.getSections(courseId);

  const moduleA = await CurriculumService.createModule(courseId, {
    sectionId: section.id,
    title: 'Alpha',
  });
  const element = await CurriculumService.createElement(moduleA!.id, {
    type: 'TEXT',
    textContent: 'original text',
  });

  const user = await AuthService.getOrCreateUser(email);

  console.log('an unpublished course is invisible to a learner');
  await AssignmentService.assign({ email, type: 'PLATFORM', courseId });
  check('nothing to read', await CurriculumService.getCourseForLearner(email, courseId), null);
  check('not in their list', (await CurriculumService.getCoursesForLearner(email)).length, 0);

  console.log('\npublishing puts version 1 live');
  const first = await PublicationService.publish(courseId, user.id);
  check('version 1', first.version, 1);
  check('a first publish marks nothing new', first.hasNewContent, false);

  const live1 = await CurriculumService.getCourseForLearner(email, courseId);
  check('the learner can read it', live1?.title, 'PUBLISH TEST — safe to delete');
  check('one module', live1?.modules.length, 1);
  check('the original text', live1?.modules[0]?.elements[0]?.textContent, 'original text');

  console.log('\nnothing to publish immediately after publishing');
  check('clean', await PublicationService.hasUnpublishedChanges(courseId), false);

  // ---- The load-bearing case: edits held back, not just additions ----
  console.log('\nediting existing content does not reach the learner');
  await CurriculumService.updateElement(element.id, { textContent: 'REWRITTEN' });
  const afterEdit = await CurriculumService.getCourseForLearner(email, courseId);
  check('still the old text', afterEdit?.modules[0]?.elements[0]?.textContent, 'original text');

  console.log('\nnor does renaming a module');
  await CurriculumService.updateModule(moduleA!.id, { title: 'Alpha RENAMED' });
  check(
    'still the old title',
    (await CurriculumService.getCourseForLearner(email, courseId))?.modules[0]?.title,
    'Alpha',
  );

  console.log('\nnor does adding a whole module');
  const moduleB = await CurriculumService.createModule(courseId, {
    sectionId: section.id,
    title: 'Bravo',
  });
  check(
    'still one module',
    (await CurriculumService.getCourseForLearner(email, courseId))?.modules.length,
    1,
  );

  console.log('\nbut the editor knows there is something to publish');
  // touchDraft normally rides on the request; these calls bypass the middleware.
  await CurriculumGateway.touchDraft(courseId);
  check('dirty', await PublicationService.hasUnpublishedChanges(courseId), true);
  const pending = await PublicationService.getUnpublishedIds(courseId);
  check('one unpublished module', pending.newModuleIds, [moduleB!.id]);

  console.log('\npublishing again releases all of it at once');
  const second = await PublicationService.publish(courseId, user.id);
  check('version 2', second.version, 2);
  check('reports new content', second.hasNewContent, true);
  check('names the new module', second.added.newModuleIds, [moduleB!.id]);

  const live2 = await CurriculumService.getCourseForLearner(email, courseId);
  check('the edit is now live', live2?.modules[0]?.elements[0]?.textContent, 'REWRITTEN');
  check('and the rename', live2?.modules[0]?.title, 'Alpha RENAMED');
  check('and the new module', live2?.modules.length, 2);
  check('clean again', await PublicationService.hasUnpublishedChanges(courseId), false);

  console.log('\nthe version records which module is new');
  const liveRow = (await PublicationService.listVersions(courseId))[0];
  check('new module reported', liveRow?.newModuleIds, [moduleB!.id]);
  check('the older module is not', liveRow?.newModuleIds.includes(moduleA!.id), false);

  console.log('\nbut New is only shown to someone who already knew the course');
  check(
    'nothing marked for a first-time learner',
    (await PublicationService.getNewIdsForLearner(courseId, user.id)).newModuleIds,
    [],
  );

  // Having started before the version went live is the case New exists for.
  await CurriculumService.recordModuleView(user.id, moduleA!.id);
  await prisma.moduleProgress.updateMany({
    where: { userId: user.id, moduleId: moduleA!.id },
    data: { viewedAt: new Date(Date.now() - 60 * 60 * 1000) },
  });
  check(
    'marked for someone who was part way through',
    (await PublicationService.getNewIdsForLearner(courseId, user.id)).newModuleIds,
    [moduleB!.id],
  );

  /*
   * Opening the course must not clear the marks.
   *
   * Keying on the *latest* visit did exactly that: viewing anything set the
   * clock to now, so by the next page load nothing had been published "since"
   * and every pill vanished for good. The mark belongs to the unread item, not
   * to the visit.
   */
  console.log('\n...and re-opening the course does not clear them');
  // Re-opening records the same module again. The upsert must leave the
  // original date alone — if it moved to now, the learner would look like a
  // first-timer and every mark would vanish.
  await CurriculumService.recordModuleView(user.id, moduleA!.id);
  const stillEarly = await CurriculumGateway.getFirstActivityAt(user.id, courseId);
  check(
    'the start date is not moved by a revisit',
    stillEarly!.getTime() < Date.now() - 60_000,
    true,
  );
  check(
    'still marked after another visit',
    (await PublicationService.getNewIdsForLearner(courseId, user.id)).newModuleIds,
    [moduleB!.id],
  );

  console.log('\nreading the new module is what clears it');
  await CurriculumService.recordModuleView(user.id, moduleB!.id);
  check(
    'cleared once read',
    (await PublicationService.getNewIdsForLearner(courseId, user.id)).newModuleIds,
    [],
  );
  await prisma.moduleProgress.deleteMany({ where: { userId: user.id } });

  console.log('\nand a first-time learner still sees nothing');
  check(
    'nothing marked',
    (await PublicationService.getNewIdsForLearner(courseId, user.id)).newModuleIds,
    [],
  );

  // ---- The three shapes the pill has to distinguish ----
  console.log('\nthe three cases the New pill must tell apart');
  const freshSection = (await CurriculumService.createSection(courseId, {
    title: 'Brand new section',
  }))!;
  const moduleInFreshSection = await CurriculumService.createModule(courseId, {
    sectionId: freshSection.id,
    title: 'Inside the new section',
  });
  const moduleInOldSection = await CurriculumService.createModule(courseId, {
    sectionId: section.id,
    title: 'New module, old section',
  });
  const elementInOldModule = await CurriculumService.createElement(moduleA!.id, {
    type: 'TEXT',
    textContent: 'new paragraph in an existing module',
  });

  const shapes = await PublicationService.publish(courseId, user.id);
  check('the new section is reported', shapes.added.newSectionIds, [freshSection.id]);
  check(
    'both new modules are reported',
    new Set(shapes.added.newModuleIds),
    new Set([moduleInFreshSection!.id, moduleInOldSection!.id]) as unknown,
  );
  check(
    'the new element is reported',
    shapes.added.newElementIds.includes(elementInOldModule.id),
    true,
  );

  // The roll-up rule lives in the frontend, but it can only be right if the
  // server hands it the raw sets — the module inside a brand new section is
  // reported here and suppressed there, rather than being left out.
  check(
    'the module inside the new section is reported, not omitted',
    shapes.added.newModuleIds.includes(moduleInFreshSection!.id),
    true,
  );
  check(
    'the untouched module is not reported',
    shapes.added.newModuleIds.includes(moduleA!.id),
    false,
  );

  /*
   * New has to survive a republish that adds nothing.
   *
   * Reading only the newest version's delta made the marks vanish the moment an
   * author fixed a typo and published again — a learner who had been away since
   * before the additions was told there was nothing new when there plainly was.
   */
  console.log('\nand New survives a later publish that adds nothing');
  await CurriculumService.recordModuleView(user.id, moduleA!.id);
  await prisma.moduleProgress.updateMany({
    where: { userId: user.id, moduleId: moduleA!.id },
    data: { viewedAt: new Date(Date.now() - 2 * 60 * 60 * 1000) },
  });

  const beforeNoOp = await PublicationService.getNewIdsForLearner(courseId, user.id);
  check('marked before the no-op publish', beforeNoOp.newModuleIds.length > 0, true);

  await CurriculumService.updateCourse(courseId, { description: 'a typo fix' });
  const noOp = await PublicationService.publish(courseId, user.id);
  check('the no-op publish adds nothing', noOp.hasNewContent, false);

  const afterNoOp = await PublicationService.getNewIdsForLearner(courseId, user.id);
  check(
    'still marked after it',
    new Set(afterNoOp.newModuleIds),
    new Set(beforeNoOp.newModuleIds) as unknown,
  );
  await prisma.moduleProgress.deleteMany({ where: { userId: user.id } });

  // ---- Quizzes are graded against what was shown ----
  console.log('\na quiz is graded against the published version, not the draft');
  const quiz = await QuizService.createQuiz({ title: 'Marking', moduleId: moduleA!.id });
  await QuizService.updateQuiz(quiz.id, { published: true });
  const question = await QuizService.addQuestion(quiz.id, {
    prompt: 'Pick the right one',
    options: [
      { text: 'right', isCorrect: true },
      { text: 'wrong', isCorrect: false },
    ],
  });
  await PublicationService.publish(courseId, user.id);

  const publishedQuiz = await PublicationService.findPublishedQuiz(quiz.id);
  const rightId = publishedQuiz!.questions[0].options.find((o) => o.isCorrect)!.id;
  const wrongId = publishedQuiz!.questions[0].options.find((o) => !o.isCorrect)!.id;

  const correctAttempt = await QuizService.submitAttempt(user.id, quiz.id, {
    [question.id]: rightId,
  });
  check('answering what was shown scores', correctAttempt.score, 1);

  console.log('\n...even after the author flips the answer key without publishing');
  await QuizService.updateQuestion(question.id, {
    prompt: 'Pick the right one',
    options: [
      { text: 'right', isCorrect: false },
      { text: 'wrong', isCorrect: true },
    ],
  });

  const stillCorrect = await QuizService.submitAttempt(user.id, quiz.id, {
    [question.id]: rightId,
  });
  check('the shown answer still scores', stillCorrect.score, 1);
  const nowWrong = await QuizService.submitAttempt(user.id, quiz.id, {
    [question.id]: wrongId,
  });
  check('and the draft answer does not', nowWrong.score, 0);

  // ---- Archive ----
  console.log('\nsuperseded versions are archived, the live one is not');
  // Relative to what was actually published, so adding a case above does not
  // break assertions that are about archiving rather than about counting.
  const liveVersion = (await CurriculumGateway.getCourseById(courseId))!.publishedVersion;
  const versions = await PublicationService.listVersions(courseId);
  check('one row per publish', versions.length, liveVersion);
  check('newest first', versions[0]?.version, liveVersion);
  check('the live one is not superseded', versions[0]?.supersededAt, null);
  check('the older ones are', versions[1]?.supersededAt !== null, true);

  console.log('\nand the archive clears after its window');
  await prisma.coursePublication.updateMany({
    where: { courseId, version: 1 },
    data: { supersededAt: new Date(Date.now() - 15 * 86_400_000) },
  });
  await PublicationService.purgeExpired();
  const left = await PublicationService.listVersions(courseId);
  check(
    'the expired one is gone',
    left.some((v) => v.version === 1),
    false,
  );
  check(
    'the live one survives',
    left.some((v) => v.version === liveVersion),
    true,
  );

  console.log('\nunpublishing hides the course without losing the version');
  await CurriculumService.updateCourse(courseId, { published: false });
  check('invisible', await CurriculumService.getCourseForLearner(email, courseId), null);
  check(
    'version retained',
    (await CurriculumGateway.getCourseById(courseId))?.publishedVersion,
    liveVersion,
  );

  console.log('\nand updateCourse refuses to publish behind the snapshot');
  try {
    await CurriculumService.updateCourse(courseId, { published: true });
    check('refused', 'no error', 'an error');
  } catch (error) {
    check('refused', (error as Error).message, 'use the publish endpoint to put a course live');
  }

  // ---- The assignment type is chosen, not asked ----
  console.log('\nan address with no account gets a private link');
  const stranger = 'publishcheck-stranger@example.test';
  check('LINK', await AssignmentService.chooseType(stranger), 'LINK');

  console.log('\nan address that has never signed in gets one too');
  // A row with no name is what an earlier assignment leaves behind.
  await AuthService.getOrCreateUser(stranger);
  check('still LINK', await AssignmentService.chooseType(stranger), 'LINK');

  console.log('\nbut someone who has signed in is enrolled on the platform');
  // A name is not the test — some realms send no name claim — so the sign-in
  // stamp the auth middleware writes is what this reads.
  const signedIn = await AuthService.getOrCreateUser(stranger);
  await AuthService.markSignedIn({ ...signedIn, lastSignInAt: null });
  check('PLATFORM', await AssignmentService.chooseType(stranger), 'PLATFORM');

  console.log('\nand assigning without a type uses that choice');
  await CurriculumService.updateCourse(courseId, { published: false });
  await PublicationService.publish(courseId, user.id);
  const auto = await AssignmentService.assign({ email: stranger, courseId });
  check('assigned on the platform', auto.type, 'PLATFORM');

  // ---- Insights read the published version ----
  console.log('\ninsights measure against what is published');
  const learners = await InsightsService.listLearners(null);
  const them = learners.find((learner) => learner.email === stranger);
  check('the learner is listed', Boolean(them), true);
  check('one course', them?.courses.length, 1);
  check(
    'counted against the published module count',
    them?.courses[0]?.totalModules,
    (await CurriculumService.getCourseForLearner(email, courseId))?.modules.length,
  );
  check('no marks yet', them?.courses[0]?.averageScore, null);

  console.log('\nand a learner nobody assigned is not invented');
  check('absent', (await InsightsService.getLearner('nobody@example.test', null)) === null, true);

  await prisma.course.delete({ where: { id: courseId } });
  await prisma.user.deleteMany({ where: { email: { in: [email, stranger] } } });
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
