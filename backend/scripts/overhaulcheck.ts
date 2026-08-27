/**
 * File: overhaulcheck.ts
 * Description: Exercises the behaviour added in the overhaul: item-by-item progress, the.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
/**
 * Exercises the behaviour added in the overhaul: item-by-item progress, the
 * recycle bin expiring itself, what a resend is and is not allowed to do, that
 * taking an assignment away takes the progress with it, module colours, and the
 * "what is new" list a notification email is built from.
 */
import 'dotenv/config';

import { MODULE_COLORS, parseModuleColor } from '@/config/module-colors';
import CurriculumGateway from '@/gateways/curriculum-gateway/curriculum-gateway';
import QuizGateway from '@/gateways/quiz-gateway/quiz-gateway';
import AssignmentService from '@/services/assignment-service/assignment-service';
import AuthService from '@/services/auth-service/auth-service';
import CurriculumService from '@/services/curriculum-service/curriculum-service';
import NotificationService from '@/services/notification-service/notification-service';
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

const DAY = 86_400_000;

async function main() {
  const email = 'overhaulcheck@example.test';

  // ---- A published course with two modules and content ----
  const created = await CurriculumService.createCourse('OVERHAUL TEST — safe to delete');
  const courseId = created!.id;
  const [first] = await CurriculumGateway.getModules(courseId);
  const second = (await CurriculumService.createModule(courseId, { title: 'Second' }))!;

  const sectionA = await CurriculumService.createSection(courseId, {
    moduleId: first.id,
    title: 'Alpha',
  });
  const elementOne = await CurriculumService.createElement(sectionA!.id, {
    type: 'TEXT',
    textContent: 'one',
  });
  const elementTwo = await CurriculumService.createElement(sectionA!.id, {
    type: 'TEXT',
    textContent: 'two',
  });
  await CurriculumService.updateCourse(courseId, { sequential: true });
  await PublicationService.publish(courseId, null);

  const user = await AuthService.getOrCreateUser(email);

  console.log('module colours are a closed set');
  check('a palette colour is accepted', parseModuleColor(MODULE_COLORS[0]), MODULE_COLORS[0]);
  check('empty clears the tint', parseModuleColor(''), null);
  try {
    parseModuleColor('#ff0000');
    check('refused', 'no error', 'an error');
  } catch (error) {
    check(
      'an off-palette colour is refused',
      (error as Error).message,
      'that is not one of the module colours',
    );
  }

  console.log('\nand a module remembers the one it was given');
  await CurriculumService.updateModule(second.id, { color: MODULE_COLORS[2] });
  const tinted = await CurriculumGateway.getModuleById(second.id);
  check('colour stored', tinted?.color, MODULE_COLORS[2]);
  await CurriculumService.updateModule(second.id, { color: null });
  check('and cleared', (await CurriculumGateway.getModuleById(second.id))?.color, null);

  console.log('\nviewing one item credits its section too');
  await CurriculumService.recordElementView(user.id, elementOne.id);
  const progress = await CurriculumService.getLearnerProgress(user.id);
  check('the element is recorded', progress.viewedElementIds, [elementOne.id]);
  check('and so is its section', progress.viewedSectionIds, [sectionA!.id]);

  console.log('\nthe second item is not viewed until it is opened');
  check('still unseen', progress.viewedElementIds.includes(elementTwo.id), false);
  await CurriculumService.recordElementView(user.id, elementTwo.id);
  const after = await CurriculumService.getLearnerProgress(user.id);
  check(
    'now seen',
    new Set(after.viewedElementIds),
    new Set([elementOne.id, elementTwo.id]) as unknown,
  );

  console.log('\nrecording the same item twice does not double it');
  await CurriculumService.recordElementView(user.id, elementOne.id);
  const twice = await CurriculumService.getLearnerProgress(user.id);
  check('two rows, not three', twice.viewedElementIds.length, 2);

  // ---- What a new-content email would say ----
  console.log('\nwhat is new is named by module and section');
  // Stands in for a learner's completion date: everything above already exists,
  // and only what is created after this line should be reported as new. The
  // pause is so the database clock is unambiguously past it.
  const before = new Date();
  await new Promise((resolve) => setTimeout(resolve, 50));

  const sectionB = await CurriculumService.createSection(courseId, {
    moduleId: second.id,
    title: 'Bravo',
  });
  const items = await NotificationService.newItemsSince(courseId, before);
  check('one new item', items.length, 1);
  check('named', items[0]?.title, 'Bravo');
  check('under its module', items[0]?.module, '2. Second');
  check('with its number', items[0]?.number, '2.1');

  console.log('\na quiz inside a brand new section is not listed twice');
  await QuizService.createQuiz({ title: 'Quiz in new section', sectionId: sectionB!.id });
  const stillOne = await NotificationService.newItemsSince(courseId, before);
  check('the section line covers it', stillOne.length, 1);

  console.log('\nbut a quiz added to an older section is its own line');
  const quiz = await QuizService.createQuiz({ title: 'Quiz on Alpha', sectionId: sectionA!.id });
  await QuizService.updateQuiz(quiz.id, { published: true });
  const withQuiz = await NotificationService.newItemsSince(courseId, before);
  check('two things to report', withQuiz.length, 2);
  check(
    'the quiz is one of them',
    withQuiz.some((item) => item.kind === 'quiz' && item.title === 'Quiz on Alpha'),
    true,
  );

  console.log('\nnothing added since a later moment reports nothing');
  check('empty', (await NotificationService.newItemsSince(courseId, new Date())).length, 0);

  // ---- Resend allowance ----
  console.log('\na resend is refused inside the cooldown');
  const justNow = {
    notifiedAt: new Date(),
    notifyWindowStart: new Date(),
    notifyCount: 1,
  };
  check('refused', AssignmentService.checkResendAllowance(justNow).allowed, false);

  console.log('\n...allowed once the cooldown has passed');
  const anHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  check(
    'allowed',
    AssignmentService.checkResendAllowance({
      notifiedAt: anHourAgo,
      notifyWindowStart: anHourAgo,
      notifyCount: 1,
    }).allowed,
    true,
  );

  console.log('\n...and refused again once the daily cap is reached');
  check(
    'capped',
    AssignmentService.checkResendAllowance({
      notifiedAt: anHourAgo,
      notifyWindowStart: anHourAgo,
      notifyCount: 5,
    }).allowed,
    false,
  );

  console.log('\na lapsed window starts the count over');
  const longAgo = new Date(Date.now() - 2 * DAY);
  const fresh = AssignmentService.checkResendAllowance({
    notifiedAt: longAgo,
    notifyWindowStart: longAgo,
    notifyCount: 5,
  });
  check('allowed again', fresh.allowed, true);
  check('counting from one', fresh.nextCount, 1);

  console.log('\nnever notified at all is always allowed');
  check(
    'allowed',
    AssignmentService.checkResendAllowance({
      notifiedAt: null,
      notifyWindowStart: null,
      notifyCount: 0,
    }).allowed,
    true,
  );

  // ---- Removing an assignment clears progress ----
  console.log('\ntaking the course away takes their progress with it');
  const assignment = await AssignmentService.assign({
    email,
    type: 'PLATFORM',
    courseId,
  });
  await QuizGateway.recordAttempt(user.id, quiz.id, 1, 1);
  await CurriculumGateway.recordCompletion(user.id, courseId, 1);

  check(
    'progress exists first',
    (await CurriculumService.getLearnerProgress(user.id)).viewedElementIds.length,
    2,
  );

  await AssignmentService.remove(assignment.id);
  const wiped = await CurriculumService.getLearnerProgress(user.id);
  check('element views gone', wiped.viewedElementIds, []);
  check('section views gone', wiped.viewedSectionIds, []);
  check('quiz attempts gone', wiped.attemptedQuizIds, []);
  check('completion gone', await CurriculumGateway.getCompletion(user.id, courseId), null);

  // ---- The recycle bin expires itself ----
  console.log('\nthe recycle bin clears what has been in it too long');
  const doomed = await CurriculumService.createCourse('OVERHAUL TEST expired — safe to delete');
  const kept = await CurriculumService.createCourse('OVERHAUL TEST recent — safe to delete');
  await CurriculumService.deleteCourse(doomed!.id);
  await CurriculumService.deleteCourse(kept!.id);

  // Backdate one past the retention window; the other stays where it is.
  await prisma.course.update({
    where: { id: doomed!.id },
    data: { deletedAt: new Date(Date.now() - 15 * DAY) },
  });

  await CurriculumService.purgeExpired();

  check(
    'the old one is gone for good',
    await prisma.course.findUnique({ where: { id: doomed!.id } }),
    null,
  );
  check(
    'the recent one is still recoverable',
    (await prisma.course.findUnique({ where: { id: kept!.id } })) !== null,
    true,
  );

  console.log('\nand the bin reports how long it keeps things');
  const bin = await CurriculumService.getDeletedItems(user.id, true);
  check('retention published', bin.retentionDays, 14);

  // ---- Clean up ----
  await prisma.course.deleteMany({ where: { id: { in: [courseId, kept!.id] } } });
  await prisma.user.deleteMany({ where: { email } });
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
