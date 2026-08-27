/**
 * File: assigncheck.ts
 * Description: Exercises the two kinds of assignment: that a link opens exactly its own item.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
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

/** A published course with one section, ready to assign, owned by `authorId`. */
async function makeCourse(title: string, authorId: number) {
  const course = await CurriculumService.createCourse(title, undefined, authorId);
  const [module] = await CurriculumGateway.getModules(course!.id);
  await CurriculumService.createSection(course!.id, { moduleId: module.id, title: 'Only' });
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
    const session = await AssignmentService.getSessionCatalogue(link.token);
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
    await AssignmentService.resolveToken(enrolled.token);
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

  console.log('\na quiz inside an enrolled course is reachable; one outside is not');
  const [sectionOfBravo] = (await CurriculumGateway.getCourseById(bravo))!.sections;
  const hidden = await QuizService.createQuiz({ title: 'Hidden', sectionId: sectionOfBravo.id });
  await QuizService.updateQuiz(hidden.id, { published: true });

  const [sectionOfAlpha] = (await CurriculumGateway.getCourseById(alpha))!.sections;
  const visible = await QuizService.createQuiz({ title: 'Visible', sectionId: sectionOfAlpha.id });
  await QuizService.updateQuiz(visible.id, { published: true });

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

  await PublicationService.publish(alpha, null);
  await PublicationService.publish(bravo, null);

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
    await AssignmentService.resolveToken(links[0].token);
    check('refused', 'no error', 'an error');
  } catch (error) {
    check('refused as revoked', (error as AssignmentError).reason, 'revoked');
  }

  console.log('\n...and the other links are untouched');
  const stillGood = await AssignmentService.getSessionCatalogue(links[1].token);
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
