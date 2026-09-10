/**
 * File: dashboard-service.ts
 * Description: Progress figures shared by the learner dashboard and guest sessions.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
import { endOfDueDay, isLockedOut, isPastDue } from '@/config/validation';
import CurriculumGateway from '@/gateways/curriculum-gateway/curriculum-gateway';
import QuizGateway from '@/gateways/quiz-gateway/quiz-gateway';
import EnrolmentService, { dueFor } from '@/services/enrolment-service/enrolment-service';
import PublicationService from '@/services/publication-service/publication-service';
import { BROWSABLE_QUIZ_TYPES } from '@/services/quiz-service/quiz-service';

import { QuizType } from '../../../generated/prisma';

export interface CourseProgress {
  courseId: string;
  title: string;
  required: boolean;
  dueDate: string | null;
  totalSections: number;
  completedSections: number;
  percentComplete: number;
  totalMinutes: number;
  remainingMinutes: number;
  quizCount: number;
  /**
   * Past its deadline, so the way in is closed.
   *
   * Decided here rather than in the browser: the date the learner's clock reads
   * is not the one their deadline was set against, and a lock the client works
   * out for itself is a lock anybody can move.
   */
  locked: boolean;
  /** Something has appeared in this course since they started it, unread. */
  hasNewContent: boolean;
  /** How many such items there are. */
  newSectionCount: number;
}

/**
 * A quiz chased on its own. There is no course title here because there is no
 * course: a quiz that belongs to one is chased through that course instead.
 */
export interface OutstandingQuiz {
  quizId: string;
  title: string;
  questionCount: number;
  dueDate: string | null;
}

/**
 * One line on the Upcoming due dates list.
 *
 * Courses and standalone quizzes are ranked together against one clock, so the
 * list can answer "what is due next" rather than "what course is due next" —
 * which is why this is its own shape rather than a slice of `courseProgress`.
 *
 * A quiz that lives inside a course is deliberately absent: it falls due with
 * the course around it, and listing both would show one deadline twice.
 */
export interface Deadline {
  kind: 'course' | 'quiz';
  /** The course or quiz this points at, for the link. */
  id: string;
  title: string;
  /** Never null — something with no deadline is not on this list. */
  dueDate: string;
  /** Past 11:59 PM on the due day. */
  overdue: boolean;
  percentComplete: number;
  completedSections: number;
  totalSections: number;
  remainingMinutes: number;
}

/**
 * Everything the home dashboard shows.
 *
 * A section counts as done when the learner has opened it AND attempted every quiz
 * built into it — so a course is only finished once every section has been seen.
 * Only published, non-deleted content counts.
 *
 * `build` is typed against the least it needs rather than against a particular
 * query's return type. That is what lets the signed-in path hand it the trimmed
 * dashboard read while the guest path hands it full course trees: a richer object
 * satisfies a narrower shape, so neither caller has to fetch the other's data.
 */
interface DashboardCourse {
  id: string;
  title: string;
  required: boolean;
  dueDate: Date | null;
  /**
   * Whether the deadline shuts this course. Absent reads as "lock", which is
   * what a deadline meant before it was a choice.
   */
  lockAfterDue?: boolean;
  contentUpdatedAt: Date;
  sections: Array<{
    id: string;
    estimatedMinutes: number;
    quizzes: Array<{ id: string }>;
  }>;
}

interface DashboardQuiz {
  id: string;
  title: string;
  /** Absent on rows written before the three kinds existed; those were all exams. */
  type?: QuizType | null;
  sectionId: string | null;
  dueDate: Date | null;
  questions: Array<{ id: string }>;
}

export default class DashboardService {
  /**
   * A signed-in learner's dashboard, over the courses they are enrolled on.
   *
   * Counts come from each course's published snapshot, not the live rows. A
   * dashboard built off the draft would tell someone they were 8 sections from
   * finishing a course that only shows them 6 — and would move their percentage
   * the moment an author started typing.
   */
  static async getDashboard(userId: number, email: string) {
    const [courses, quizzes, enrolment] = await Promise.all([
      CurriculumGateway.getCoursesForDashboard(),
      QuizGateway.getQuizzesForDashboard(),
      EnrolmentService.forEmail(email),
    ]);

    const enrolled = courses.filter((course) => enrolment.courseIds.has(course.id));
    const snapshots = await PublicationService.getLiveSnapshots(
      enrolled.map((course) => course.id),
    );

    // contentUpdatedAt lives on the course row rather than in the snapshot, so
    // the two are merged: shape and counts from the published version, the
    // "something changed" stamp from the course itself.
    const stampById = new Map(enrolled.map((course) => [course.id, course.contentUpdatedAt]));

    const enrolledCourses: DashboardCourse[] = snapshots.map((snapshot) => ({
      id: snapshot.id,
      title: snapshot.title,
      required: snapshot.required,
      // The deadline this person was given, not the one printed on the course.
      // Two people handed the same course a month apart are due on two
      // different dates, and only their assignments know which is whose; the
      // course's own date is the fallback for a course that predates deadlines
      // being assigned at all.
      dueDate: dueFor(
        enrolment.dueByCourseId,
        snapshot.id,
        snapshot.dueDate ? new Date(snapshot.dueDate) : null,
      ),
      lockAfterDue: snapshot.lockAfterDue,
      contentUpdatedAt: stampById.get(snapshot.id) ?? new Date(0),
      sections: snapshot.sections.map((section) => ({
        id: section.id,
        estimatedMinutes: section.estimatedMinutes,
        quizzes: (section.quizzes ?? []).map((quiz) => ({ id: quiz.id })),
      })),
    }));

    // Quizzes the learner can reach: those inside an enrolled course's published
    // version, plus any handed to them on their own.
    const publishedQuizIds = new Set(
      snapshots.flatMap((snapshot) =>
        snapshot.sections.flatMap((section) => (section.quizzes ?? []).map((quiz) => quiz.id)),
      ),
    );

    const enrolledQuizzes: DashboardQuiz[] = quizzes
      .filter((quiz) => enrolment.quizIds.has(quiz.id) || publishedQuizIds.has(quiz.id))
      // Same rule as the courses above: a quiz handed over on its own falls due
      // when this person's assignment says, not when the quiz row says. One
      // inside a course keeps whatever it has here and is overruled by its
      // course's deadline in `build`.
      .map((quiz) => ({
        ...quiz,
        dueDate: dueFor(enrolment.dueByQuizId, quiz.id, quiz.dueDate),
      }));

    // Worked out here because the snapshots are already in hand; asking the
    // publication service to load them again per course would double the read.
    const newCounts = new Map(
      await Promise.all(
        snapshots.map(async (snapshot): Promise<[string, number]> => {
          const ids = await PublicationService.getNewIdsForLearner(snapshot.id, userId, snapshot);
          return [
            snapshot.id,
            ids.newModuleIds.length +
              ids.newSectionIds.length +
              ids.newElementIds.length +
              ids.newQuizIds.length,
          ];
        }),
      ),
    );

    return DashboardService.build(userId, enrolledCourses, enrolledQuizzes, newCounts);
  }

  /**
   * Same figures over an explicit slice of the catalogue — used by guest sessions,
   * where someone only sees what was assigned to their email.
   */
  static async build(
    userId: number,
    courses: DashboardCourse[],
    quizzes: DashboardQuiz[],
    /**
     * How many items are new to this learner, per course.
     *
     * Passed in rather than worked out here so the dashboard badge and the pills
     * inside the course cannot disagree — both now come from
     * PublicationService.getNewIdsForLearner. Deriving it locally from
     * contentUpdatedAt was a second, subtly different rule: it fired only for
     * learners who had *completed* the course, so someone part way through got a
     * course full of New pills and no badge pointing them at it.
     */
    newCountByCourse: Map<string, number> = new Map(),
  ) {
    const [views, attempts] = await Promise.all([
      CurriculumGateway.getViewedSectionIds(userId),
      QuizGateway.getAttemptsForUser(userId),
    ]);

    const viewedSectionIds = new Set(views.map((view) => view.sectionId));
    const attemptedQuizIds = new Set(attempts.map((attempt) => attempt.quizId));

    const sectionToCourse = new Map<string, string>();
    courses.forEach((course) =>
      course.sections.forEach((section) => sectionToCourse.set(section.id, course.id)),
    );

    // One clock for the whole response: a course locking half way through
    // building it would put the dashboard at odds with itself.
    const now = new Date();

    const isSectionComplete = (section: (typeof courses)[number]['sections'][number]) =>
      viewedSectionIds.has(section.id) &&
      section.quizzes.every((quiz) => attemptedQuizIds.has(quiz.id));

    const courseProgress: CourseProgress[] = courses.map((course) => {
      const totalSections = course.sections.length;
      const completedSections = course.sections.filter(isSectionComplete).length;
      const totalMinutes = course.sections.reduce(
        (sum, section) => sum + section.estimatedMinutes,
        0,
      );
      const remainingMinutes = course.sections
        .filter((section) => !isSectionComplete(section))
        .reduce((sum, section) => sum + section.estimatedMinutes, 0);

      const newCount = newCountByCourse.get(course.id) ?? 0;
      const hasNewContent = newCount > 0;

      const due = endOfDueDay(course.dueDate);

      return {
        courseId: course.id,
        title: course.title,
        required: course.required,
        dueDate: due ? due.toISOString() : null,
        // Past the deadline is not the same as shut — see `isLockedOut`.
        locked: isLockedOut(due, course.lockAfterDue, now),
        totalSections,
        completedSections,
        percentComplete:
          totalSections === 0 ? 0 : Math.round((completedSections / totalSections) * 100),
        totalMinutes,
        remainingMinutes,
        quizCount: course.sections.reduce((sum, section) => sum + section.quizzes.length, 0),
        hasNewContent,
        newSectionCount: newCount,
      };
    });

    // Record the first completion, and once they have worked through newly added
    // material, move the date forward so the notice clears itself.
    await Promise.all(
      courseProgress
        .filter((course) => course.totalSections > 0 && course.percentComplete === 100)
        .map(async (course) => {
          if (course.hasNewContent) {
            await CurriculumGateway.refreshCompletion(
              userId,
              course.courseId,
              course.totalSections,
            );
            // They are caught up as of this response.
            course.hasNewContent = false;
            course.newSectionCount = 0;
            return;
          }
          await CurriculumGateway.recordCompletion(userId, course.courseId, course.totalSections);
        }),
    );

    const outstandingCourses = courseProgress.filter(
      (course) => course.totalSections > 0 && course.completedSections < course.totalSections,
    );

    /**
     * Quizzes chased in their own right: the ones handed to this person on their
     * own, and still to be done.
     *
     * A quiz that belongs to a course — a lesson's exam, or one section of a
     * quiz set — is part of the course around it and is chased through that
     * course's progress instead. It falls due with the course too, so listing it
     * here as well split one piece of work into two entries carrying the same
     * deadline, and sent the learner to the Quizzes tab for something that is
     * taken inside a lesson.
     *
     * Because everything left has no course behind it, its deadline is its own —
     * the one stamped on the assignment that handed it over.
     */
    const standaloneQuizzes = quizzes
      // Only exams are outstanding work in their own right. A learning check is
      // part of the section it sits in; a one-time quiz is chased by the email it
      // arrived in and never appears on a signed-in list at all.
      .filter((quiz) => BROWSABLE_QUIZ_TYPES.includes(quiz.type ?? QuizType.EXAM))
      .filter((quiz) => quiz.sectionId === null || !sectionToCourse.has(quiz.sectionId))
      .filter((quiz) => !attemptedQuizIds.has(quiz.id))
      .map((quiz) => ({ ...quiz, dueDate: endOfDueDay(quiz.dueDate) }));

    const outstandingQuizzes: OutstandingQuiz[] = standaloneQuizzes.map((quiz) => ({
      quizId: quiz.id,
      title: quiz.title,
      questionCount: quiz.questions.length,
      dueDate: quiz.dueDate ? quiz.dueDate.toISOString() : null,
    }));

    /**
     * Everything with a deadline still to meet, soonest first.
     *
     * Courses and standalone quizzes rank against one clock, because the
     * question the list answers is "what is due next", not "which course is due
     * next". Anything without a due date is absent — that is not a deadline —
     * and so is finished work, which has no deadline left to meet.
     */
    const upcomingDeadlines: Deadline[] = [
      ...courseProgress
        .filter((course) => course.dueDate !== null && course.percentComplete < 100)
        .map((course): Deadline => ({
          kind: 'course',
          id: course.courseId,
          title: course.title,
          dueDate: course.dueDate!,
          // Overdue, not locked: a course somebody may still finish is still
          // late, and this list exists to say so.
          overdue: course.dueDate !== null && isPastDue(new Date(course.dueDate), now),
          percentComplete: course.percentComplete,
          completedSections: course.completedSections,
          totalSections: course.totalSections,
          remainingMinutes: course.remainingMinutes,
        })),
      ...standaloneQuizzes.flatMap((quiz): Deadline[] => {
        if (!quiz.dueDate) return [];

        return [
          {
            kind: 'quiz',
            id: quiz.id,
            title: quiz.title,
            dueDate: quiz.dueDate.toISOString(),
            overdue: isPastDue(quiz.dueDate, now),
            // A quiz is one sitting rather than a set of sections, so there is
            // no part-way to report: it is outstanding, or it is not here.
            percentComplete: 0,
            completedSections: 0,
            totalSections: 0,
            remainingMinutes: 0,
          },
        ];
      }),
    ].sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));

    const updatedCourses = courseProgress.filter((course) => course.hasNewContent);

    return {
      courseProgress,
      updatedCourses,
      outstandingCourses,
      outstandingQuizzes,
      upcomingDeadlines,
      totals: {
        coursesOutstanding: outstandingCourses.length,
        quizzesOutstanding: outstandingQuizzes.length,
        minutesRemaining: outstandingCourses.reduce(
          (sum, course) => sum + course.remainingMinutes,
          0,
        ),
      },
    };
  }
}
