/**
 * File: timercheck.ts
 * Description: Exercises the timed-quiz session against the real database: that the clock is.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-09-22
 */
/**
 * Exercises the timed-quiz session against the real database: that the clock is
 * anchored server-side, that coming back does not restart it, and that running
 * out is recorded rather than losing the answers.
 */
import 'dotenv/config';

import CurriculumGateway from '@/gateways/curriculum-gateway/curriculum-gateway';
import QuizGateway from '@/gateways/quiz-gateway/quiz-gateway';
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

async function main() {
  const course = await CurriculumService.createCourse('TIMER TEST — safe to delete');
  const courseId = course!.id;
  const [module] = await CurriculumGateway.getModules(courseId);
  const section = await CurriculumService.createSection(courseId, {
    moduleId: module.id,
    title: 'Holder',
  });
  const user = await AuthService.getOrCreateUser('timercheck@example.test');

  const timed = await QuizService.createQuiz({
    title: 'Timed',
    sectionId: section!.id,
    timeLimitMinutes: 30,
  });
  const untimed = await QuizService.createQuiz({ title: 'Untimed', sectionId: section!.id });

  // Retakes allowed on the timed one, because the last scenario here is about a
  // closed run handing out a fresh clock — which is a second sitting, and an
  // exam is a single sitting unless its author says otherwise. See
  // Quiz.allowMultipleAttempts and QuizService.isSingleSitting.
  await QuizService.updateQuiz(timed.id, { allowMultipleAttempts: true });

  const question = await QuizService.addQuestion(timed.id, {
    prompt: 'Pick the right one',
    options: [
      { text: 'right', isCorrect: true },
      { text: 'wrong', isCorrect: false },
    ],
  });
  const right = question.options.find((o) => o.isCorrect)!;

  /*
    Published, and published last.

    A quiz is reached through its course's snapshot, so nothing below this runs
    at all until the course has a version — and the snapshot has to be taken
    after the questions exist, or the learner is handed an empty paper. Quizzes
    themselves no longer carry a publish state to set; `createQuiz` writes one
    that is already true, because the course's publication is what gates it.
  */
  await PublicationService.publish(courseId, null);

  /*
    A second course, deliberately left unpublished, for the refusal below.

    It used to be a third quiz in this same course, back when a quiz had its own
    draft flag to leave unset. It has not had one for a while: "draft" now means
    the course has never been published, so that is what this is.
  */
  const hidden = await CurriculumService.createCourse('TIMER TEST unpublished — safe to delete');
  const [hiddenModule] = await CurriculumGateway.getModules(hidden!.id);
  const hiddenSection = await CurriculumService.createSection(hidden!.id, {
    moduleId: hiddenModule.id,
    title: 'Holder',
  });
  const draft = await QuizService.createQuiz({ title: 'Draft', sectionId: hiddenSection!.id });

  // Neither door opens: `quizForRun` cannot find it in any snapshot, and both
  // starting and submitting go through that one lookup.
  console.log('a quiz in an unpublished course can be neither started nor submitted to');
  for (const [label, run] of [
    ['start', () => QuizService.startSession(user.id, draft.id)],
    ['submit', () => QuizService.submitAttempt(user.id, draft.id, {})],
  ] as const) {
    try {
      await run();
      check(label, 'no error', 'an error');
    } catch (error) {
      check(label, (error as Error).message, `Quiz with ID ${draft.id} not found`);
    }
  }

  console.log('\nan untimed quiz has no deadline');
  const noClock = await QuizService.startSession(user.id, untimed.id);
  check('secondsRemaining', noClock.secondsRemaining, null);
  check('expiresAt', noClock.expiresAt, null);
  check('timeLimitMinutes', noClock.timeLimitMinutes, null);

  console.log("\na timed quiz starts on the author's limit");
  const first = await QuizService.startSession(user.id, timed.id);

  /*
   * `sessionId` is nullable now that a learning check reports a run without
   * opening one — it has no clock, so there is nothing to resume and a row would
   * stay open forever. A timed exam always has one, so this narrows it once here
   * rather than at each of the updates below, and fails loudly if that ever
   * stops being true.
   */
  const sessionId = first.sessionId;
  if (!sessionId) throw new Error('a timed quiz must open a session');

  check('timeLimitMinutes', first.timeLimitMinutes, 30);
  check('expired', first.expired, false);
  check(
    'about 30 minutes left',
    first.secondsRemaining !== null &&
      first.secondsRemaining > 1790 &&
      first.secondsRemaining <= 1800,
    true,
  );

  console.log('\nleaving and coming back resumes the same run, not a new one');
  // Wind the clock back 10 minutes to stand in for time away from the page.
  await prisma.quizSession.update({
    where: { id: sessionId },
    data: {
      startedAt: new Date(Date.now() - 10 * 60_000),
      expiresAt: new Date(Date.now() + 20 * 60_000),
    },
  });

  const resumed = await QuizService.startSession(user.id, timed.id);
  check('same session', resumed.sessionId, first.sessionId);
  check(
    'about 20 minutes left, not a fresh 30',
    resumed.secondsRemaining !== null &&
      resumed.secondsRemaining > 1190 &&
      resumed.secondsRemaining <= 1200,
    true,
  );

  console.log('\na run whose clock has passed reports itself expired');
  await prisma.quizSession.update({
    where: { id: sessionId },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });

  const overdue = await QuizService.startSession(user.id, timed.id);
  check('same session', overdue.sessionId, first.sessionId);
  check('expired', overdue.expired, true);
  check('secondsRemaining', overdue.secondsRemaining, 0);

  console.log('\nsubmitting late still grades, and says the clock had run out');
  const late = await QuizService.submitAttempt(user.id, timed.id, { [question.id]: right.id });
  check('score', [late.score, late.total], [1, 1]);
  check('timedOut', late.timedOut, true);

  console.log('\nthe run is closed, so starting again hands out a fresh clock');
  const second = await QuizService.startSession(user.id, timed.id);
  check('a new session', second.sessionId !== first.sessionId, true);
  check('expired', second.expired, false);
  check(
    'a full 30 minutes again',
    second.secondsRemaining !== null && second.secondsRemaining > 1790,
    true,
  );

  console.log('\nsubmitting inside the limit is not flagged');
  const onTime = await QuizService.submitAttempt(user.id, timed.id, { [question.id]: right.id });
  check('timedOut', onTime.timedOut, false);

  console.log('\nthe attempts were recorded against the learner');
  const attempts = await QuizGateway.getAttemptsForUser(user.id);
  check('two attempts', attempts.filter((a) => a.quizId === timed.id).length, 2);

  await prisma.course.delete({ where: { id: courseId } });
  await prisma.course.delete({ where: { id: hidden!.id } });
  await prisma.user.delete({ where: { id: user.id } });
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
