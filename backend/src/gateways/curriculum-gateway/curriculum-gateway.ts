/**
 * File: curriculum-gateway.ts
 * Description: All database access for courses, modules, sections and progress.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
import { CourseKind, Prisma } from '../../../generated/prisma';
import { prisma } from '../../../prisma/prisma-client';

// Inside $transaction the client is a restricted PrismaClient (no $connect/$transaction/etc),
// so transactional helpers take Prisma.TransactionClient rather than `typeof prisma`.
type Db = Prisma.TransactionClient;

/**
 * Modules come back as bare headings — id, number, title — and the sections stay
 * in the flat `sections` list, tagged with `moduleId`. Nesting the sections inside
 * their module instead would send every element twice, and elements carry base64
 * images.
 */
const moduleHeadings = {
  where: { deletedAt: null },
  orderBy: { number: 'asc' as const },
} as const;

/**
 * Learners see published, non-deleted content only. Authors see everything that
 * is not deleted. `live` is the learner view.
 *
 * `sortKey` is module-then-position, so one ordering pass puts the whole course
 * in reading order without needing the modules joined in.
 */
function sectionTree(live: boolean) {
  return {
    where: live ? { deletedAt: null } : { deletedAt: null },
    orderBy: { sortKey: 'asc' as const },
    include: {
      elements: { orderBy: { order: 'asc' as const } },
      quizzes: {
        where: live ? { deletedAt: null, published: true } : { deletedAt: null },
        // Shares one sequence with elements so the two can be interleaved.
        orderBy: { order: 'asc' as const },
        include: {
          questions: {
            orderBy: { order: 'asc' as const },
            include: { options: { orderBy: { order: 'asc' as const } } },
          },
        },
      },
    },
  };
}

export default class CurriculumGateway {
  /** Learner view: published courses only. */
  static getPublishedCourses() {
    return prisma.course.findMany({
      where: { deletedAt: null, published: true },
      orderBy: { createdAt: 'asc' },
      include: { modules: moduleHeadings, sections: sectionTree(true), instructors: true },
    });
  }

  /**
   * Published courses reduced to what the dashboard actually reads: counts,
   * minutes and dates.
   *
   * The full tree is enormous by comparison — every element carries its base64
   * media, every quiz its questions and options — and the dashboard renders none
   * of it. It needs to know how many sections there are and which quizzes sit in
   * them, so that is all this selects.
   */
  static getCoursesForDashboard() {
    return prisma.course.findMany({
      where: { deletedAt: null, published: true },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        title: true,
        required: true,
        dueDate: true,
        contentUpdatedAt: true,
        sections: {
          where: { deletedAt: null },
          orderBy: { sortKey: 'asc' },
          select: {
            id: true,
            estimatedMinutes: true,
            quizzes: {
              where: { deletedAt: null, published: true },
              select: { id: true },
            },
          },
        },
      },
    });
  }

  /** Author view: everything that has not been deleted, published or not. */
  static getAllCourses() {
    return prisma.course.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'asc' },
      include: { modules: moduleHeadings, sections: sectionTree(false), instructors: true },
    });
  }

  static getCourseById(id: string, live = false) {
    return prisma.course.findFirst({
      where: { id, deletedAt: null, ...(live ? { published: true } : {}) },
      include: { modules: moduleHeadings, sections: sectionTree(live), instructors: true },
    });
  }

  static createCourse(title: string, kind: CourseKind = CourseKind.LESSON) {
    return prisma.course.create({
      data: { title, kind },
      include: { modules: moduleHeadings, sections: sectionTree(false) },
    });
  }

  static updateCourse(
    id: string,
    data: Partial<{
      title: string;
      shortDescription: string | null;
      description: string | null;
      tags: string[];
      languages: string[];
      whatYouWillLearn: string[];
      prerequisites: string[];
      required: boolean;
      dueDate: Date | null;
      published: boolean;
      publishedAt: Date | null;
      publishedVersion: number;
      draftUpdatedAt: Date;
      sequential: boolean;
      imageData: string | null;
      imageType: string | null;
      instructors: { set: Array<{ id: string }> };
    }>,
  ) {
    return prisma.course.update({
      where: { id },
      data,
      include: { modules: moduleHeadings, sections: sectionTree(false), instructors: true },
    });
  }

  // ---- Per-course contributors ----

  /** Courses this person may edit because they were named on them. */
  static getEditableCourses(userId: number) {
    return prisma.course.findMany({
      where: { deletedAt: null, contributors: { some: { id: userId } } },
      orderBy: { createdAt: 'asc' },
      include: { modules: moduleHeadings, sections: sectionTree(false), instructors: true },
    });
  }

  static getContributors(courseId: string) {
    return prisma.course
      .findUnique({ where: { id: courseId } })
      .contributors({ select: { id: true, email: true, name: true } });
  }

  static setContributors(courseId: string, userIds: number[]) {
    return prisma.course.update({
      where: { id: courseId },
      data: { contributors: { set: userIds.map((id) => ({ id })) } },
      include: { contributors: { select: { id: true, email: true, name: true } } },
    });
  }

  /** True when this person is named on the course. */
  static async isContributor(userId: number, courseId: string) {
    const match = await prisma.course.findFirst({
      where: { id: courseId, contributors: { some: { id: userId } } },
      select: { id: true },
    });
    return match !== null;
  }

  /** Which course a module/section/element/quiz/question ultimately belongs to. */
  static async courseIdFromModule(moduleId: string) {
    const module = await prisma.module.findUnique({
      where: { id: moduleId },
      select: { courseId: true },
    });
    return module?.courseId ?? null;
  }

  static async courseIdFromSection(sectionId: string) {
    const section = await prisma.section.findUnique({
      where: { id: sectionId },
      select: { courseId: true },
    });
    return section?.courseId ?? null;
  }

  static async courseIdFromElement(elementId: string) {
    const element = await prisma.element.findUnique({
      where: { id: elementId },
      select: { section: { select: { courseId: true } } },
    });
    return element?.section.courseId ?? null;
  }

  static async courseIdFromQuiz(quizId: string) {
    const quiz = await prisma.quiz.findUnique({
      where: { id: quizId },
      select: { section: { select: { courseId: true } } },
    });
    return quiz?.section?.courseId ?? null;
  }

  static async courseIdFromQuestion(questionId: string) {
    const question = await prisma.question.findUnique({
      where: { id: questionId },
      select: { quiz: { select: { section: { select: { courseId: true } } } } },
    });
    return question?.quiz.section?.courseId ?? null;
  }

  // ---- Instructors ----

  static getInstructors() {
    return prisma.instructor.findMany({ orderBy: { name: 'asc' } });
  }

  static getInstructorById(id: string) {
    return prisma.instructor.findUnique({ where: { id } });
  }

  static createInstructor(data: { name: string; title?: string | null; bio?: string | null }) {
    return prisma.instructor.create({ data });
  }

  static updateInstructor(
    id: string,
    data: Partial<{
      name: string;
      title: string | null;
      bio: string | null;
      photoData: string | null;
      photoType: string | null;
    }>,
  ) {
    return prisma.instructor.update({ where: { id }, data });
  }

  static deleteInstructor(id: string) {
    return prisma.instructor.delete({ where: { id } });
  }

  // ---- Learner notes ----

  static getNotes(userId: number, courseId: string) {
    return prisma.note.findMany({
      where: { userId, courseId },
      orderBy: { createdAt: 'desc' },
    });
  }

  static createNote(data: {
    userId: number;
    courseId: string;
    sectionId?: string | null;
    body: string;
  }) {
    return prisma.note.create({ data });
  }

  static updateNote(id: string, userId: number, body: string) {
    // userId in the filter makes it impossible to edit someone else's note.
    return prisma.note.updateMany({ where: { id, userId }, data: { body } });
  }

  static deleteNote(id: string, userId: number) {
    return prisma.note.deleteMany({ where: { id, userId } });
  }

  /** Soft delete, so the course can be restored from the admin dashboard. */
  static softDeleteCourse(id: string) {
    return prisma.course.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  static restoreCourse(id: string) {
    return prisma.course.update({ where: { id }, data: { deletedAt: null } });
  }

  static getDeletedCourses() {
    return prisma.course.findMany({
      where: { deletedAt: { not: null } },
      orderBy: { deletedAt: 'desc' },
      select: { id: true, title: true, deletedAt: true },
    });
  }

  /** Only matches an already soft-deleted course, so live content can't be hard deleted. */
  static findDeletedCourse(id: string) {
    return prisma.course.findFirst({ where: { id, deletedAt: { not: null } } });
  }

  /** Permanent. Sections, elements and progress go with it via ON DELETE CASCADE. */
  static hardDeleteCourse(id: string) {
    return prisma.course.delete({ where: { id } });
  }

  /** Ids of every course still in play, for passes that touch the whole catalogue. */
  static async getLiveCourseIds() {
    const courses = await prisma.course.findMany({
      where: { deletedAt: null },
      select: { id: true },
    });
    return courses.map((course) => course.id);
  }

  static restoreAllCourses() {
    return prisma.course.updateMany({
      where: { deletedAt: { not: null } },
      data: { deletedAt: null },
    });
  }

  static purgeCourses() {
    return prisma.course.deleteMany({ where: { deletedAt: { not: null } } });
  }

  // ---- Expiring the recycle bin ----

  static purgeCoursesDeletedBefore(cutoff: Date) {
    return prisma.course.deleteMany({ where: { deletedAt: { not: null, lt: cutoff } } });
  }

  static purgeModulesDeletedBefore(cutoff: Date) {
    return prisma.module.deleteMany({ where: { deletedAt: { not: null, lt: cutoff } } });
  }

  static purgeSectionsDeletedBefore(cutoff: Date) {
    return prisma.section.deleteMany({ where: { deletedAt: { not: null, lt: cutoff } } });
  }

  /** Marks a course as having new content. Only section/quiz additions call this. */
  static touchContent(courseId: string) {
    return prisma.course.update({
      where: { id: courseId },
      data: { contentUpdatedAt: new Date() },
    });
  }

  /**
   * Records that the draft has moved on from what is published.
   *
   * Called by every content mutation, however small — a renamed module counts
   * as much as a new section, because both are held back from learners until the
   * next publish and the editor has to be able to say so.
   *
   * `updateMany` rather than `update` so a write against a course that has since
   * been deleted is a no-op instead of an exception; these calls hang off other
   * work and must not be able to fail it.
   */
  static touchDraft(courseId: string) {
    return prisma.course.updateMany({
      where: { id: courseId },
      data: { draftUpdatedAt: new Date() },
    });
  }

  static getCompletion(userId: number, courseId: string) {
    return prisma.courseCompletion.findUnique({
      where: { userId_courseId: { userId, courseId } },
    });
  }

  static getCompletions(userId: number) {
    return prisma.courseCompletion.findMany({ where: { userId } });
  }

  /** First finish wins — re-finishing after an update must not move the date,
   *  or the "new content" notice would clear itself. */
  static recordCompletion(userId: number, courseId: string, sectionCount: number) {
    return prisma.courseCompletion.upsert({
      where: { userId_courseId: { userId, courseId } },
      create: { userId, courseId, sectionCount },
      update: {},
    });
  }

  /** Called when the learner acknowledges the new content by finishing again. */
  static refreshCompletion(userId: number, courseId: string, sectionCount: number) {
    return prisma.courseCompletion.update({
      where: { userId_courseId: { userId, courseId } },
      data: { completedAt: new Date(), sectionCount, notifiedAt: null },
    });
  }

  /** Everyone who has finished this course, with the address to write to. */
  static getCompletionsForCourse(courseId: string) {
    return prisma.courseCompletion.findMany({
      where: { courseId },
      include: { user: { select: { id: true, email: true, name: true } } },
    });
  }

  static markCompletionNotified(id: string) {
    return prisma.courseCompletion.update({
      where: { id },
      data: { notifiedAt: new Date() },
    });
  }

  /**
   * Live sections of a course added since a moment, with the module they landed
   * in — which is what a "there is new content" mail has to name to be worth
   * sending. Ordered the way the course reads.
   */
  static getSectionsAddedSince(courseId: string, since: Date) {
    return prisma.section.findMany({
      where: { courseId, deletedAt: null, createdAt: { gt: since } },
      orderBy: { sortKey: 'asc' },
      select: {
        id: true,
        number: true,
        title: true,
        module: { select: { id: true, number: true, title: true } },
      },
    });
  }

  /** Published quizzes of a course added since a moment, with their section. */
  static getQuizzesAddedSince(courseId: string, since: Date) {
    return prisma.quiz.findMany({
      where: {
        deletedAt: null,
        published: true,
        createdAt: { gt: since },
        section: { courseId, deletedAt: null },
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        title: true,
        section: {
          select: {
            id: true,
            number: true,
            title: true,
            module: { select: { id: true, number: true, title: true } },
          },
        },
      },
    });
  }

  // ---- Modules ----

  static getModules(courseId: string, db: Db = prisma) {
    return db.module.findMany({
      where: { courseId, deletedAt: null },
      orderBy: { number: 'asc' },
    });
  }

  static getModuleById(id: string) {
    return prisma.module.findFirst({ where: { id, deletedAt: null } });
  }

  /**
   * The lowest module number in a course, counting recycled ones. Anything
   * parking below this is guaranteed not to collide, which is what lets a
   * renumber run past modules already parked in the bin.
   */
  static async getLowestModuleNumber(courseId: string, db: Db = prisma): Promise<number> {
    const lowest = await db.module.aggregate({ where: { courseId }, _min: { number: true } });
    return Math.min(lowest._min.number ?? 0, 0);
  }

  static createModule(
    data: { courseId: string; number: number; title: string; color?: string | null },
    db: Db = prisma,
  ) {
    return db.module.create({ data });
  }

  static updateModule(
    id: string,
    data: Partial<{ number: number; title: string; color: string | null }>,
    db: Db = prisma,
  ) {
    return db.module.update({ where: { id }, data });
  }

  /**
   * Soft delete, moving the module out of the numbering space on the way.
   *
   * A recycled module must not keep reserving its number: the modules after it
   * shift up to close the gap, and the unique index on (courseId, number) spans
   * deleted rows, so leaving it on 2 makes the new module 2 impossible. It parks
   * below every number the course has ever used, which cannot collide and cannot
   * be reached by renumbering. Restoring puts it back through the renumber pass.
   */
  static async softDeleteModule(id: string, courseId: string, db: Db = prisma) {
    const lowest = await db.module.aggregate({
      where: { courseId },
      _min: { number: true },
    });

    return db.module.update({
      where: { id },
      data: { deletedAt: new Date(), number: Math.min(lowest._min.number ?? 0, 0) - 1 },
    });
  }

  /** Comes back on the end of the course; the renumber pass tidies up from there. */
  static async restoreModule(id: string, courseId: string, db: Db = prisma) {
    const highest = await db.module.aggregate({
      where: { courseId },
      _max: { number: true },
    });

    return db.module.update({
      where: { id },
      data: { deletedAt: null, number: Math.max(highest._max.number ?? 0, 0) + 1 },
    });
  }

  /** Only matches an already soft-deleted module, so live content can't be hard deleted. */
  static findDeletedModule(id: string) {
    return prisma.module.findFirst({ where: { id, deletedAt: { not: null } } });
  }

  static hardDeleteModule(id: string) {
    return prisma.module.delete({ where: { id } });
  }

  /**
   * No `number`: a recycled module has been parked outside the numbering space,
   * and the number it used to hold now belongs to whatever closed the gap. Naming
   * it in the bin would point at the wrong module.
   */
  static getDeletedModules() {
    return prisma.module.findMany({
      where: { deletedAt: { not: null } },
      orderBy: { deletedAt: 'desc' },
      select: {
        id: true,
        title: true,
        deletedAt: true,
        course: { select: { id: true, title: true } },
      },
    });
  }

  static restoreAllModules() {
    return prisma.module.updateMany({
      where: { deletedAt: { not: null } },
      data: { deletedAt: null },
    });
  }

  static purgeModules() {
    return prisma.module.deleteMany({ where: { deletedAt: { not: null } } });
  }

  /**
   * A course's live sections, ordered by their place within a module.
   *
   * Ordered by `position` rather than `sortKey` on purpose: the renumber pass
   * runs after the numbers have been parked on throwaway values, so sortKey at
   * that moment says nothing about where anything belongs. `position` is the
   * intent — it is what a reorder writes — and is unique within a module, so
   * bucketing this list by moduleId yields each module's sections in order.
   */
  static getSectionsForRenumber(courseId: string, db: Db = prisma) {
    return db.section.findMany({
      where: { courseId, deletedAt: null },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
      select: { id: true, moduleId: true, position: true, number: true },
    });
  }

  /** Highest position used in a module, so something can be put on the end. */
  static async getHighestSectionPosition(moduleId: string, db: Db = prisma): Promise<number> {
    const highest = await db.section.aggregate({
      where: { moduleId },
      _max: { position: true },
    });
    return highest._max.position ?? 0;
  }

  static getSectionById(id: string) {
    return prisma.section.findFirst({ where: { id, deletedAt: null } });
  }

  static createSection(
    data: {
      courseId: string;
      moduleId: string;
      position: number;
      number: string;
      sortKey: string;
      title: string;
      estimatedMinutes: number;
      color?: string | null;
    },
    db: Db = prisma,
  ) {
    return db.section.create({ data });
  }

  static updateSection(
    id: string,
    data: Partial<{
      moduleId: string;
      position: number;
      number: string;
      sortKey: string;
      title: string;
      estimatedMinutes: number;
      color: string | null;
    }>,
    db: Db = prisma,
  ) {
    return db.section.update({ where: { id }, data });
  }

  /**
   * Soft delete, moving the section out of the numbering space on the way. Same
   * reason as modules: the sections after it close the gap, and the unique index
   * on (courseId, number) counts deleted rows, so a recycled 1.2 would block the
   * section that becomes 1.2. Its id makes the parked value unique by
   * construction, and no real number can look like it.
   */
  static softDeleteSection(id: string, db: Db = prisma) {
    return db.section.update({
      where: { id },
      data: { deletedAt: new Date(), number: `deleted-${id}`, sortKey: `deleted-${id}` },
    });
  }

  /**
   * Comes back on the end of its module. Its old position was reused the moment
   * it left, and two sections sharing a position would make the order between
   * them arbitrary — the end is the one slot always free.
   */
  static async restoreSection(id: string, moduleId: string, db: Db = prisma) {
    const last = await CurriculumGateway.getHighestSectionPosition(moduleId, db);
    return db.section.update({
      where: { id },
      data: { deletedAt: null, position: last + 1 },
    });
  }

  /** Only matches an already soft-deleted section, so live content can't be hard deleted. */
  static findDeletedSection(id: string) {
    return prisma.section.findFirst({ where: { id, deletedAt: { not: null } } });
  }

  /** Permanent. Elements and progress go with it via ON DELETE CASCADE. */
  static hardDeleteSection(id: string) {
    return prisma.section.delete({ where: { id } });
  }

  static restoreAllSections() {
    return prisma.section.updateMany({
      where: { deletedAt: { not: null } },
      data: { deletedAt: null },
    });
  }

  static purgeSections() {
    return prisma.section.deleteMany({ where: { deletedAt: { not: null } } });
  }

  /** No `number`, for the same reason as modules — see getDeletedModules. */
  static getDeletedSections() {
    return prisma.section.findMany({
      where: { deletedAt: { not: null } },
      orderBy: { deletedAt: 'desc' },
      select: {
        id: true,
        title: true,
        deletedAt: true,
        course: { select: { id: true, title: true } },
      },
    });
  }

  static getLastElementOrder(sectionId: string, db: Db = prisma) {
    return db.element.findFirst({ where: { sectionId }, orderBy: { order: 'desc' } });
  }

  /**
   * Highest position used in a section by either an element or a quiz. They share
   * one sequence so a quiz can sit between two pieces of content.
   */
  static async getLastContentOrder(sectionId: string, db: Db = prisma): Promise<number> {
    const [element, quiz] = await Promise.all([
      db.element.findFirst({ where: { sectionId }, orderBy: { order: 'desc' } }),
      db.quiz.findFirst({ where: { sectionId, deletedAt: null }, orderBy: { order: 'desc' } }),
    ]);
    return Math.max(element?.order ?? 0, quiz?.order ?? 0);
  }

  static setElementOrder(id: string, order: number, db: Db = prisma) {
    return db.element.update({ where: { id }, data: { order } });
  }

  static setQuizOrder(id: string, order: number, db: Db = prisma) {
    return db.quiz.update({ where: { id }, data: { order } });
  }

  /** Elements and quizzes of a section, for validating a reorder request. */
  static async getSectionContentIds(sectionId: string) {
    const [elements, quizzes] = await Promise.all([
      prisma.element.findMany({ where: { sectionId }, select: { id: true } }),
      prisma.quiz.findMany({ where: { sectionId, deletedAt: null }, select: { id: true } }),
    ]);
    return {
      elementIds: new Set(elements.map((e) => e.id)),
      quizIds: new Set(quizzes.map((q) => q.id)),
    };
  }

  static createElement(
    sectionId: string,
    data: {
      type: Prisma.ElementCreateInput['type'];
      videoUrl?: string | null;
      imageUrl?: string | null;
      imageData?: string | null;
      imageType?: string | null;
      fileName?: string | null;
      textContent?: string | null;
      durationMinutes?: number | null;
    },
    order: number,
    db: Db = prisma,
  ) {
    return db.element.create({ data: { sectionId, order, ...data } });
  }

  static updateElement(id: string, data: Prisma.ElementUpdateInput) {
    return prisma.element.update({ where: { id }, data });
  }

  static deleteElement(id: string) {
    return prisma.element.delete({ where: { id } });
  }

  /** Records that a user opened a section. Sections auto-complete on view. */
  static recordSectionView(userId: number, sectionId: string) {
    return prisma.sectionProgress.upsert({
      where: { userId_sectionId: { userId, sectionId } },
      create: { userId, sectionId },
      update: {},
    });
  }

  /**
   * When this person *started* this course, or null if they never have.
   *
   * Deliberately the earliest view rather than the latest. Anything published
   * after they began is content that appeared while they were working through
   * it, and is worth marking. Keying on the latest view instead would be
   * self-defeating: opening the course records a view, so by the next page load
   * nothing would ever have been published "since they last looked" and the
   * marks would disappear the moment they were seen.
   *
   * What clears a mark is reading the item itself, which the caller checks.
   */
  static async getFirstActivityAt(userId: number, courseId: string): Promise<Date | null> {
    const earliest = await prisma.sectionProgress.findFirst({
      where: { userId, section: { courseId } },
      orderBy: { viewedAt: 'asc' },
      select: { viewedAt: true },
    });
    return earliest?.viewedAt ?? null;
  }

  static getViewedSectionIds(userId: number) {
    return prisma.sectionProgress.findMany({
      where: { userId },
      select: { sectionId: true, viewedAt: true },
    });
  }

  /** Records that a user opened one piece of content, for item-by-item unlocking. */
  static recordElementView(userId: number, elementId: string) {
    return prisma.elementProgress.upsert({
      where: { userId_elementId: { userId, elementId } },
      create: { userId, elementId },
      update: {},
    });
  }

  /**
   * Every element this person has opened, newest first.
   *
   * `viewedAt` rides along because Continue has to resume where they actually
   * stopped, which is the most recently opened item — not the first unfinished
   * one, which could be miles behind them if they skipped ahead and came back.
   */
  static getViewedElementIds(userId: number) {
    return prisma.elementProgress.findMany({
      where: { userId },
      orderBy: { viewedAt: 'desc' },
      select: { elementId: true, viewedAt: true },
    });
  }

  static getElementById(id: string) {
    return prisma.element.findUnique({
      where: { id },
      select: { id: true, sectionId: true, section: { select: { courseId: true } } },
    });
  }

  static runTransaction<T>(fn: (db: Db) => Promise<T>) {
    return prisma.$transaction(fn);
  }
}
