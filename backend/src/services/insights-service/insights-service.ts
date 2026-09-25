/**
 * File: insights-service.ts
 * Description: Per-learner progress reporting for authors and admins.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-09-25
 */
import AssignmentGateway from '@/gateways/assignment-gateway/assignment-gateway';
import CurriculumGateway from '@/gateways/curriculum-gateway/curriculum-gateway';
import QuizGateway from '@/gateways/quiz-gateway/quiz-gateway';
import AuthService from '@/services/auth-service/auth-service';
import CourseMapService from '@/services/course-map-service/course-map-service';
import PublicationService from '@/services/publication-service/publication-service';
import QuizService from '@/services/quiz-service/quiz-service';

import { CourseKind } from '../../../generated/prisma';

/**
 * How the people who have been given learning are actually getting on.
 *
 * Everything here measures against each course's *published* version, which is
 * the only thing a learner can see. Counting a draft section against someone's
 * progress would show them stuck at 80% on work that does not exist for them
 * yet, and would move their percentage every time an author saved.
 */

/** One course as it appears under a learner's name. */
export interface LearnerCourseProgress {
  courseId: string;
  title: string;
  imageData: string | null;
  imageType: string | null;
  /**
   * Lesson or quiz set.
   *
   * The dashboard files the two apart under a learner's name. They are held the
   * same way — one assignment row each — but they are not read the same way: a
   * quiz set has no sections to be part way through, so "3/8 sections" beside a
   * quiz is a number about the plumbing rather than about the learner.
   */
  kind: CourseKind;
  dueDate: string | null;
  totalSections: number;
  completedSections: number;
  percentComplete: number;
  totalQuizzes: number;
  attemptedQuizzes: number;
  /** Mean score across attempts on this course's quizzes, or null if none yet. */
  averageScore: number | null;
  lastActivityAt: string | null;
  assignedAt: string;
  revoked: boolean;
}

/**
 * One handed-in one-time quiz, with the paper.
 *
 * These sit under the learner rather than under the quiz because that is the
 * only place they make sense: a one-time quiz is sent to one person, taken once,
 * and then gone from their side entirely — so the record of it belongs with
 * everything else that person has completed.
 */
export interface OneTimeQuizResult {
  attemptId: string;
  quizId: string;
  title: string;
  score: number;
  total: number;
  percent: number;
  completedAt: string;
  answers: Array<{
    questionId: string;
    order: number;
    prompt: string;
    chosen: string[];
    correct: string[];
    wasCorrect: boolean;
  }>;
}

export interface LearnerInsight {
  email: string;
  name: string | null;
  /** They have signed in at least once, rather than only being an address. */
  hasAccount: boolean;
  courses: LearnerCourseProgress[];
  /** One-time quizzes this person has handed in, newest first. */
  oneTimeQuizzes: OneTimeQuizResult[];
  /** Mean of the per-course percentages, for the summary line. */
  overallPercent: number;
}

export default class InsightsService {
  /**
   * Learners and their progress.
   *
   * `assignedById` scopes the list to one author's own assignments; passing null
   * means everyone, which is what an admin gets. Older assignments predate the
   * assigner column, so a scoped view legitimately cannot show them — which is
   * why admins are not scoped.
   */
  static async listLearners(assignedById: number | null): Promise<LearnerInsight[]> {
    const assignments = await AssignmentGateway.listAll(assignedById);

    // Group by address rather than by user row: someone can hold work before
    // they have an account, and the two must not show up as different people.
    const byEmail = new Map<string, typeof assignments>();
    for (const assignment of assignments) {
      const key = assignment.email.toLowerCase();
      byEmail.set(key, [...(byEmail.get(key) ?? []), assignment]);
    }

    return Promise.all(
      [...byEmail.entries()].map(([email, held]) => InsightsService.buildLearner(email, held)),
    ).then((learners) =>
      learners.sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email)),
    );
  }

  /** One learner, with every course they hold. */
  static async getLearner(email: string, assignedById: number | null) {
    const assignments = (await AssignmentGateway.listAll(assignedById)).filter(
      (assignment) => assignment.email.toLowerCase() === email.toLowerCase(),
    );
    if (assignments.length === 0) return null;
    return InsightsService.buildLearner(email.toLowerCase(), assignments);
  }

  private static async buildLearner(
    email: string,
    held: Awaited<ReturnType<typeof AssignmentGateway.listAll>>,
  ): Promise<LearnerInsight> {
    const user = await AuthService.getUserByEmail(email);

    const [views, attempts] = user
      ? await Promise.all([
          CurriculumGateway.getViewedSectionIds(user.id),
          QuizGateway.getAttemptsForUser(user.id),
        ])
      : [[], []];

    const viewedIds = new Set(views.map((view) => view.sectionId));
    const viewedAt = new Map(views.map((view) => [view.sectionId, view.viewedAt]));

    const courses = await Promise.all(
      held
        .filter((assignment) => assignment.courseId !== null)
        .map(async (assignment): Promise<LearnerCourseProgress | null> => {
          const courseId = assignment.courseId!;
          const [published, row] = await Promise.all([
            PublicationService.getLiveSnapshot(courseId),
            CurriculumGateway.getCourseById(courseId),
          ]);
          // Assigned but never published, or since deleted: nothing to measure.
          if (!published || !row) return null;

          /*
            Measured against this learner's own path, not the whole map.

            A directed course's snapshot carries every branch; this person was
            only ever offered the ones they picked. Counting the rest put an
            author's roster permanently at odds with what the learner's own
            dashboard told them, and made somebody who had finished look stuck.
          */
          const snapshot = await CourseMapService.forLearner(published, user?.id ?? null);

          const sectionIds = snapshot.sections.map((section) => section.id);
          const quizIds = snapshot.sections.flatMap((section) =>
            (section.quizzes ?? []).map((quiz) => quiz.id),
          );

          const completedSections = sectionIds.filter((id) => viewedIds.has(id)).length;
          const own = attempts.filter((attempt) => quizIds.includes(attempt.quizId));

          // Best attempt per quiz, so retaking to improve a score is reflected
          // rather than averaged away by the earlier failures.
          const bestByQuiz = new Map<string, number>();
          for (const attempt of own) {
            const pct = attempt.total > 0 ? (attempt.score / attempt.total) * 100 : 0;
            bestByQuiz.set(attempt.quizId, Math.max(bestByQuiz.get(attempt.quizId) ?? 0, pct));
          }

          const scores = [...bestByQuiz.values()];
          const stamps = [
            ...sectionIds.map((id) => viewedAt.get(id)).filter((at): at is Date => Boolean(at)),
            ...own.map((attempt) => attempt.completedAt),
            ...(assignment.lastAccessedAt ? [assignment.lastAccessedAt] : []),
          ];

          return {
            courseId,
            title: snapshot.title,
            kind: row.kind,
            imageData: snapshot.imageData,
            imageType: snapshot.imageType,
            dueDate: assignment.dueDate
              ? assignment.dueDate.toISOString()
              : row.dueDate
                ? row.dueDate.toISOString()
                : null,
            totalSections: sectionIds.length,
            completedSections,
            percentComplete:
              sectionIds.length === 0
                ? 0
                : Math.round((completedSections / sectionIds.length) * 100),
            totalQuizzes: quizIds.length,
            attemptedQuizzes: bestByQuiz.size,
            averageScore:
              scores.length === 0
                ? null
                : Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length),
            lastActivityAt: stamps.length
              ? stamps.reduce((latest, stamp) => (stamp > latest ? stamp : latest)).toISOString()
              : null,
            assignedAt: assignment.assignedAt.toISOString(),
            revoked: assignment.revokedAt !== null,
          };
        }),
    );

    const live = courses.filter((course): course is LearnerCourseProgress => course !== null);

    // Not filtered by `assignedById`: a one-time quiz is handed over by link, and
    // the record of what somebody answered is the whole reason it was sent. An
    // author scoped to their own assignments still only reaches this learner
    // because one of those assignments named them.
    const papers = user ? await QuizService.getCompletedOneTimeQuizzes(user.id) : [];

    return {
      email,
      name: user?.name ?? null,
      hasAccount: user?.lastSignInAt != null,
      courses: live,
      oneTimeQuizzes: papers.map((attempt) => ({
        attemptId: attempt.id,
        quizId: attempt.quiz.id,
        title: attempt.quiz.title,
        score: attempt.score,
        total: attempt.total,
        percent: attempt.total > 0 ? Math.round((attempt.score / attempt.total) * 100) : 0,
        completedAt: attempt.completedAt.toISOString(),
        answers: attempt.answers.map((answer) => ({
          questionId: answer.questionId,
          order: answer.order,
          prompt: answer.prompt,
          chosen: answer.chosen,
          correct: answer.correct,
          wasCorrect: answer.wasCorrect,
        })),
      })),
      overallPercent:
        live.length === 0
          ? 0
          : Math.round(live.reduce((sum, course) => sum + course.percentComplete, 0) / live.length),
    };
  }
}
