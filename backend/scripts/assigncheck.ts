/**
 * File: assigncheck.ts
 * Description: Exercises the two kinds of assignment: that a link opens exactly its own item.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-09-22
 */
/**
 * Exercises the two kinds of assignment: that a link opens exactly its own item
 * and nothing else the same person holds, that a platform assignment has no
 * usable link, and that the enrolment gate governs what a signed-in learner sees.
 */
import 'dotenv/config';

import CurriculumGateway from '@/gateways/curriculum-gateway/curriculum-gateway';
import AssignmentService, {
  AssignmentError,
} from '@/services/assignment-service/assignment-service';
import AuthService from '@/services/auth-service/auth-service';
import CurriculumService from '@/services/curriculum-service/curriculum-service';
import PublicationService from '@/services/publication-service/publication-service';
import QuizService from '@/services/quiz-service/quiz-service';

import { CourseKind } from '../generated/prisma';
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

/**
 * A published course, ready to assign, owned by `authorId`. A lesson goes out
 * with one text section; a quiz set goes out empty, and the scenario that uses
 * one adds its quiz afterwards — which is the point of that scenario.
 */
async function makeCourse(title: string, authorId: number, kind: CourseKind = CourseKind.LESSON) {
  const course = await CurriculumService.createCourse(title, kind, authorId);
  const [model] = await CurriculumGateway.getModels(course!.id);
  if (kind !== CourseKind.QUIZ_SET) {
    await CurriculumService.createSection(course!.id, {
      modelId: model.id,
      title: 'Only',
      type: 'TEXT',
    });
  }
  // Going live takes a snapshot, so this is the publish path rather than a
  // flag on the course row.
  await PublicationService.publish(course!.id, null);
  return course!.id;
}

async function main() {
  const email = 'assigncheck@example.test';
  const other = 'assigncheck-other@example.test';
  const authorEmail = 'assigncheck-author@example.test';

  // Courses belong to whoever made them, so the author view below is asked for
  // as a person rather than as a role.
  const author = await AuthService.getOrCreateUser(authorEmail);

  const alpha = await makeCourse('ASSIGN TEST Alpha — safe to delete', author.id);
  const bravo = await makeCourse('ASSIGN TEST Bravo — safe to delete', author.id);
  const charlie = await makeCourse('ASSIGN TEST Charlie — safe to delete', author.id);

  console.log('three courses to one person means three separate links');
  // Annotated rather than left to evolve: `assign` returns a union (the
  // notified and not-notified shapes), which an empty literal cannot widen to.
  const links: Array<Awaited<ReturnType<typeof AssignmentService.assign>>> = [];
  for (const courseId of [alpha, bravo, charlie]) {
    links.push(await AssignmentService.assign({ email, type: 'LINK', courseId }));
  }
  check('three tokens', new Set(links.map((l) => l.token)).size, 3);
  check('all links', new Set(links.map((l) => l.type)), new Set(['LINK']) as unknown);

  console.log('\nand each link opens only its own course');
  for (const [index, link] of links.entries()) {
    const session = await AssignmentService.getSessionCatalogue(link.token!);
    check(
      `link ${index + 1} sees one course`,
      session.courses.map((c) => c.id),
      [[alpha, bravo, charlie][index]],
    );
  }

  console.log('\nno email went out, but the assignment stands');
  check('delivery reported', links[0].delivery.sent, false);
  check('reason given', links[0].delivery.reason, 'Email is not configured, so nothing was sent.');
  check('notifiedAt left unset', links[0].notifiedAt ?? null, null);

  console.log("\na platform assignment's token is not a usable link");
  const enrolled = await AssignmentService.assign({
    email: other,
    type: 'PLATFORM',
    courseId: alpha,
  });
  try {
    await AssignmentService.resolveToken(enrolled.token!);
    check('refused', 'no error', 'an error');
  } catch (error) {
    check('refused with sign-in', (error as AssignmentError).reason, 'sign-in');
  }

  console.log('\nthe signed-in learner sees only what they are enrolled on');
  await AuthService.getOrCreateUser(email);
  await AuthService.getOrCreateUser(other);

  const linkHolderSees = await CurriculumService.getCoursesForLearner(email);
  check(
    'link assignments do not enrol',
    linkHolderSees.map((c) => c.id),
    [],
  );

  const enrolledSees = await CurriculumService.getCoursesForLearner(other);
  check(
    'enrolled on alpha only',
    enrolledSees.map((c) => c.id),
    [alpha],
  );

  console.log('\nenrolling on a second course adds it, and nothing else');
  await AssignmentService.assign({ email: other, type: 'PLATFORM', courseId: charlie });
  const now = await CurriculumService.getCoursesForLearner(other);
  check('two courses', new Set(now.map((c) => c.id)), new Set([alpha, charlie]) as unknown);

  console.log('\na quiz inside an enrolled quiz set is reachable; one outside is not');
  /*
    Both quizzes live in quiz sets, not in lessons.

    The Quizzes tab lists what was built on the Create a quiz side. A lesson's
    quizzes belong to the lesson around them and are taken in place, from the
    Learning tab — `QuizService.getQuizzesForLearner` filters to `QUIZ_SET` for
    exactly that reason. This scenario is about enrolment deciding reach, so it
    is asked of the kind of course the tab actually lists; asking it of a lesson
    only proved that lessons are absent from it, which is a different fact.
  */
  const outside = await makeCourse('ASSIGN TEST Delta — safe to delete', author.id, 'QUIZ_SET');
  const inside = await makeCourse('ASSIGN TEST Echo — safe to delete', author.id, 'QUIZ_SET');
  await AssignmentService.assign({ email: other, type: 'PLATFORM', courseId: inside });

  // Added after the publish above. In a course a quiz is a section of type
  // QUIZ, made together with its quiz.
  const { quiz: hidden } = await createQuizSection(outside, { title: 'Hidden' });
  const { quiz: visible } = await createQuizSection(inside, { title: 'Visible' });

  /*
   * A question, so the redaction checks below have an answer key to redact.
   *
   * Without one this script created no options at all, and the author-view
   * assertion — "the same tree still carries answers for an author" — was really
   * asking whether *anything else* in the database happened to have a quiz with
   * options. It passed on a developer's working database and failed the moment
   * one was reset, which is the wrong way round for a check of this kind.
   */
  await QuizService.addQuestion(visible.id, {
    prompt: 'Which of these is redacted for a learner?',
    options: [
      { text: 'The answer key', isCorrect: true },
      { text: 'The question text', isCorrect: false },
    ],
  });

  // Marking the quiz published is not enough on its own: learners read the
  // course's published snapshot, and this quiz is not in it yet.
  check(
    'a quiz added since the last publish is not reachable',
    (await QuizService.getQuizzesForLearner(other)).map((q) => q.title),
    [],
  );

  await PublicationService.publish(inside, null);
  await PublicationService.publish(outside, null);

  const reachable = await QuizService.getQuizzesForLearner(other);
  check(
    "sees the enrolled course's quiz once published",
    reachable.map((q) => q.title),
    ['Visible'],
  );

  console.log('\nthe answer key never leaves on a learner-facing read');
  // Counting isCorrect in the serialised payload is the honest test: it is what
  // actually crosses the wire, whatever the types claim.
  const countAnswers = (payload: unknown) =>
    (JSON.stringify(payload).match(/"isCorrect"/g) ?? []).length;

  check(
    'learner course list',
    countAnswers(await CurriculumService.getCoursesForLearner(other)),
    0,
  );
  check(
    'learner single course',
    countAnswers(await CurriculumService.getCourseForLearner(other, alpha)),
    0,
  );
  check('learner quiz list', countAnswers(await QuizService.getQuizzesForLearner(other)), 0);
  check(
    'learner single quiz',
    countAnswers(await QuizService.getQuizForLearner(other, visible.id)),
    0,
  );

  // The same tree still carries answers for an author, or quizzes could not be
  // edited — which is exactly why the learner path needs its own redaction.
  const authorView = await CurriculumService.getCoursesForAuthor(author.id, false);
  check('author view keeps them', countAnswers(authorView) > 0, true);

  // And it is their view, not everyone's: somebody else holding the same role
  // is offered none of it.
  const stranger = await AuthService.getOrCreateUser(other);
  check(
    'another author sees none of them',
    (await CurriculumService.getCoursesForAuthor(stranger.id, false))
      .map((course) => course.id)
      .filter((id) => [alpha, bravo, charlie].includes(id)),
    [],
  );

  console.log('\na course you are not enrolled on reads as not found');
  check('not enrolled', await CurriculumService.getCourseForLearner(other, bravo), null);
  check('unreachable quiz', await QuizService.getQuizForLearner(other, hidden.id), null);

  console.log('\nassigning the same item twice is refused');
  try {
    await AssignmentService.assign({ email: other, type: 'PLATFORM', courseId: alpha });
    check('refused', 'no error', 'an error');
  } catch (error) {
    check('refused', (error as Error).message, `${other} is already assigned this item`);
  }

  console.log('\na revoked link stops working');
  await AssignmentService.revoke(links[0].id);
  try {
    await AssignmentService.resolveToken(links[0].token!);
    check('refused', 'no error', 'an error');
  } catch (error) {
    check('refused as revoked', (error as AssignmentError).reason, 'revoked');
  }

  console.log('\n...and the other links are untouched');
  const stillGood = await AssignmentService.getSessionCatalogue(links[1].token!);
  check(
    'link 2 still opens bravo',
    stillGood.courses.map((c) => c.id),
    [bravo],
  );

  for (const courseId of [alpha, bravo, charlie]) {
    await prisma.course.delete({ where: { id: courseId } });
  }
  await prisma.user.deleteMany({ where: { email: { in: [email, other, authorEmail] } } });
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
