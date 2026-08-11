/**
 * File: dashboard-service.ts
 * Description: Progress figures shared by the learner dashboard and guest sessions.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
import CurriculumGateway from '@/gateways/curriculum-gateway/curriculum-gateway';
import QuizGateway from '@/gateways/quiz-gateway/quiz-gateway';
import EnrolmentService from '@/services/enrolment-service/enrolment-service';
import PublicationService from '@/services/publication-service/publication-service';

export interface CourseProgress {
  courseId: string;
  title: string;
  required: boolean;
  dueDate: string | null;
  totalModules: number;
  completedModules: number;
  percentComplete: number;
  totalMinutes: number;
  remainingMinutes: number;
  quizCount: number;
  /** Something has appeared in this course since they started it, unread. */
  hasNewContent: boolean;
  /** How many such items there are. */
  newModuleCount: number;
}

export interface OutstandingQuiz {
  quizId: string;
  title: string;
  courseTitle: string | null;
  questionCount: number;
  dueDate: string | null;
}

/**
 * Everything the home dashboard shows.
 *
 * A module counts as done when the learner has opened it AND attempted every quiz
 * built into it — so a course is only finished once every module has been seen.
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
  contentUpdatedAt: Date;
  modules: Array<{
    id: string;
    estimatedMinutes: number;
    quizzes: Array<{ id: string }>;
  }>;
}

interface DashboardQuiz {
  id: string;
  title: string;
  moduleId: string | null;
  dueDate: Date | null;
  questions: Array<{ id: string }>;
}

export default class DashboardService {
  /**
   * A signed-in learner's dashboard, over the courses they are enrolled on.
   *
   * Counts come from each course's published snapshot, not the live rows. A
   * dashboard built off the draft would tell someone they were 8 modules from
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
      dueDate: snapshot.dueDate ? new Date(snapshot.dueDate) : null,
      contentUpdatedAt: stampById.get(snapshot.id) ?? new Date(0),
      modules: snapshot.modules.map((module) => ({
        id: module.id,
        estimatedMinutes: module.estimatedMinutes,
        quizzes: (module.quizzes ?? []).map((quiz) => ({ id: quiz.id })),
      })),
    }));

    // Quizzes the learner can reach: those inside an enrolled course's published
    // version, plus any handed to them on their own.
    const publishedQuizIds = new Set(
      snapshots.flatMap((snapshot) =>
        snapshot.modules.flatMap((module) => (module.quizzes ?? []).map((quiz) => quiz.id)),
      ),
    );

    const enrolledQuizzes = quizzes.filter(
      (quiz) => enrolment.quizIds.has(quiz.id) || publishedQuizIds.has(quiz.id),
    );

    // Worked out here because the snapshots are already in hand; asking the
    // publication service to load them again per course would double the read.
    const newCounts = new Map(
      await Promise.all(
        snapshots.map(async (snapshot): Promise<[string, number]> => {
          const ids = await PublicationService.getNewIdsForLearner(snapshot.id, userId, snapshot);
          return [
            snapshot.id,
            ids.newSectionIds.length +
              ids.newModuleIds.length +
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
      CurriculumGateway.getViewedModuleIds(userId),
      QuizGateway.getAttemptsForUser(userId),
    ]);

    const viewedModuleIds = new Set(views.map((view) => view.moduleId));
    const attemptedQuizIds = new Set(attempts.map((attempt) => attempt.quizId));

    const courseTitleById = new Map(courses.map((course) => [course.id, course.title]));
    const courseDueById = new Map(courses.map((course) => [course.id, course.dueDate]));
    const moduleToCourse = new Map<string, string>();
    courses.forEach((course) =>
      course.modules.forEach((module) => moduleToCourse.set(module.id, course.id)),
    );

    const isModuleComplete = (module: (typeof courses)[number]['modules'][number]) =>
      viewedModuleIds.has(module.id) &&
      module.quizzes.every((quiz) => attemptedQuizIds.has(quiz.id));

    const courseProgress: CourseProgress[] = courses.map((course) => {
      const totalModules = course.modules.length;
      const completedModules = course.modules.filter(isModuleComplete).length;
      const totalMinutes = course.modules.reduce((sum, module) => sum + module.estimatedMinutes, 0);
      const remainingMinutes = course.modules
        .filter((module) => !isModuleComplete(module))
        .reduce((sum, module) => sum + module.estimatedMinutes, 0);

      const newCount = newCountByCourse.get(course.id) ?? 0;
      const hasNewContent = newCount > 0;

      return {
        courseId: course.id,
        title: course.title,
        required: course.required,
        dueDate: course.dueDate ? course.dueDate.toISOString() : null,
        totalModules,
        completedModules,
        percentComplete:
          totalModules === 0 ? 0 : Math.round((completedModules / totalModules) * 100),
        totalMinutes,
        remainingMinutes,
        quizCount: course.modules.reduce((sum, module) => sum + module.quizzes.length, 0),
        hasNewContent,
        newModuleCount: newCount,
      };
    });

    // Record the first completion, and once they have worked through newly added
    // material, move the date forward so the notice clears itself.
    await Promise.all(
      courseProgress
        .filter((course) => course.totalModules > 0 && course.percentComplete === 100)
        .map(async (course) => {
          if (course.hasNewContent) {
            await CurriculumGateway.refreshCompletion(userId, course.courseId, course.totalModules);
            // They are caught up as of this response.
            course.hasNewContent = false;
            course.newModuleCount = 0;
            return;
          }
          await CurriculumGateway.recordCompletion(userId, course.courseId, course.totalModules);
        }),
    );

    const outstandingCourses = courseProgress.filter(
      (course) => course.totalModules > 0 && course.completedModules < course.totalModules,
    );

    const outstandingQuizzes: OutstandingQuiz[] = quizzes
      .filter((quiz) => !attemptedQuizIds.has(quiz.id))
      .map((quiz) => {
        // Quizzes belong to a module, and the module belongs to a course.
        const courseId = quiz.moduleId ? moduleToCourse.get(quiz.moduleId) : undefined;
        // A quiz with no due date of its own falls back to its course's.
        const due = quiz.dueDate ?? (courseId ? (courseDueById.get(courseId) ?? null) : null);

        return {
          quizId: quiz.id,
          title: quiz.title,
          courseTitle: courseId ? (courseTitleById.get(courseId) ?? null) : null,
          questionCount: quiz.questions.length,
          dueDate: due ? due.toISOString() : null,
        };
      });

    // Soonest due first; courses without a due date are not deadlines.
    const upcomingDeadlines = courseProgress
      .filter((course) => course.dueDate !== null && course.percentComplete < 100)
      .sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : a.dueDate! > b.dueDate! ? 1 : 0));

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
