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
 * taking an assignment away takes the progress with it, model colours, and the
 * "what is new" list a notification email is built from.
 */
import 'dotenv/config';

import { MODEL_COLORS, parseModelColor } from '@/config/model-colors';
import CurriculumGateway from '@/gateways/curriculum-gateway/curriculum-gateway';
import QuizGateway from '@/gateways/quiz-gateway/quiz-gateway';
import AssignmentService from '@/services/assignment-service/assignment-service';
import AuthService from '@/services/auth-service/auth-service';
import CurriculumService from '@/services/curriculum-service/curriculum-service';
import NotificationService from '@/services/notification-service/notification-service';
import PublicationService from '@/services/publication-service/publication-service';

import { prisma } from '../prisma/prisma-client';
import { createQuizSection } from './quiz-section';

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

  // ---- A published course with two models and content ----
  const created = await CurriculumService.createCourse('OVERHAUL TEST — safe to delete');
  const courseId = created!.id;
  const [first] = await CurriculumGateway.getModels(courseId);
  const second = (await CurriculumService.createModel(courseId, { title: 'Second' }))!;

  // Two pieces of content are two sections: a section is the content itself.
  const sectionA = await CurriculumService.createSection(courseId, {
    modelId: first.id,
    title: 'Alpha',
    type: 'TEXT',
    textContent: 'one',
  });
  const sectionTwo = await CurriculumService.createSection(courseId, {
    modelId: first.id,
    title: 'Alpha, continued',
    type: 'TEXT',
    textContent: 'two',
  });
  await CurriculumService.updateCourse(courseId, { sequential: true });
  await PublicationService.publish(courseId, null);

  const user = await AuthService.getOrCreateUser(email);

  console.log('model colours are a closed set');
  check('a palette colour is accepted', parseModelColor(MODEL_COLORS[0]), MODEL_COLORS[0]);
  check('empty clears the tint', parseModelColor(''), null);
  try {
    parseModelColor('#ff0000');
    check('refused', 'no error', 'an error');
  } catch (error) {
    check(
      'an off-palette colour is refused',
      (error as Error).message,
      'that is not one of the model colours',
    );
  }

  console.log('\nand a model remembers the one it was given');
  await CurriculumService.updateModel(second.id, { color: MODEL_COLORS[2] });
  const tinted = await CurriculumGateway.getModelById(second.id);
  check('colour stored', tinted?.color, MODEL_COLORS[2]);
  await CurriculumService.updateModel(second.id, { color: null });
  check('and cleared', (await CurriculumGateway.getModelById(second.id))?.color, null);

  console.log('\nviewing a section records it');
  await CurriculumService.recordSectionView(user.id, sectionA!.id);
  const progress = await CurriculumService.getLearnerProgress(user.id);
  check('the section is recorded', progress.viewedSectionIds, [sectionA!.id]);

  console.log('\nthe second section is not viewed until it is opened');
  check('still unseen', progress.viewedSectionIds.includes(sectionTwo!.id), false);
  await CurriculumService.recordSectionView(user.id, sectionTwo!.id);
  const after = await CurriculumService.getLearnerProgress(user.id);
  check('now seen', [...after.viewedSectionIds].sort(), [sectionA!.id, sectionTwo!.id].sort());
  check('newest first, for Continue', after.sectionViews[0]?.sectionId, sectionTwo!.id);

  console.log('\nrecording the same section twice does not double it');
  await CurriculumService.recordSectionView(user.id, sectionA!.id);
  const twice = await CurriculumService.getLearnerProgress(user.id);
  check('two rows, not three', twice.viewedSectionIds.length, 2);

  // ---- What a new-content email would say ----
  console.log('\nwhat is new is named by model and section');
  // Stands in for a learner's completion date: everything above already exists,
  // and only what is created after this line should be reported as new. The
  // pause is so the database clock is unambiguously past it.
  const before = new Date();
  await new Promise((resolve) => setTimeout(resolve, 50));

  await CurriculumService.createSection(courseId, {
    modelId: second.id,
    title: 'Bravo',
    type: 'TEXT',
  });
  const items = await NotificationService.newItemsSince(courseId, before);
  check('one new item', items.length, 1);
  check('named', items[0]?.title, 'Bravo');
  check('under its model', items[0]?.model, '2. Second');
  check('with its number', items[0]?.number, '2.1');

  console.log('\na new quiz is one line, not two');
  // A quiz arrives as a QUIZ section with its quiz inside, so both rows are
  // new at once — and the section line covers the quiz.
  const { quiz } = await createQuizSection(courseId, {
    modelId: first.id,
    title: 'Quiz on Alpha',
  });
  const withQuiz = await NotificationService.newItemsSince(courseId, before);
  check('two things to report', withQuiz.length, 2);
  check(
    'the quiz is listed once, by its section',
    withQuiz.filter((item) => item.title === 'Quiz on Alpha').map((item) => item.kind),
    ['section'],
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
    (await CurriculumService.getLearnerProgress(user.id)).viewedSectionIds.length,
    2,
  );

  await AssignmentService.remove(assignment.id);
  const wiped = await CurriculumService.getLearnerProgress(user.id);
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
