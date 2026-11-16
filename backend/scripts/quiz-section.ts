/**
 * File: quiz-section.ts
 * Description: Shared helper for the smoke scripts — makes a quiz the way a
 *   course holds one, as a QUIZ section with its quiz inside.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-11-13
 */
import QuizGateway from '@/gateways/quiz-gateway/quiz-gateway';
import CurriculumService from '@/services/curriculum-service/curriculum-service';
import QuizService from '@/services/quiz-service/quiz-service';

import { prisma } from '../prisma/prisma-client';

/**
 * Adds a quiz to a course.
 *
 * A quiz in a course is a section of type QUIZ, created together with its quiz,
 * so the scripts ask for the pair in one call rather than each repeating the
 * two steps. Anything beyond the title and kind goes through the ordinary quiz
 * update, exactly as the editor does it.
 */
export async function createQuizSection(
  courseId: string,
  data: {
    title: string;
    modelId?: string;
    type?: string;
    position?: number;
    timeLimitMinutes?: number;
  },
) {
  const section = await CurriculumService.createSection(courseId, {
    modelId: data.modelId,
    title: data.title,
    type: 'QUIZ',
    quizType: data.type,
    position: data.position,
  });
  if (!section) throw new Error('the quiz section could not be created');

  const row = await prisma.quiz.findFirstOrThrow({ where: { sectionId: section.id } });
  if (data.timeLimitMinutes !== undefined) {
    await QuizService.updateQuiz(row.id, { timeLimitMinutes: data.timeLimitMinutes });
  }

  const quiz = await QuizGateway.getQuizById(row.id);
  if (!quiz) throw new Error('the quiz could not be read back');
  return { section, quiz };
}
