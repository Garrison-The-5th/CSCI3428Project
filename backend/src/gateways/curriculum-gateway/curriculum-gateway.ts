/**
 * File: curriculum-gateway.ts
 * Description: All database access for courses, sections, modules and progress.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
import { Prisma } from '../../../generated/prisma';
import { prisma } from '../../../prisma/prisma-client';

// Inside $transaction the client is a restricted PrismaClient (no $connect/$transaction/etc),
// so transactional helpers take Prisma.TransactionClient rather than `typeof prisma`.
type Db = Prisma.TransactionClient;

/**
 * Sections come back as bare headings — id, number, title — and the modules stay
 * in the flat `modules` list, tagged with `sectionId`. Nesting the modules inside
 * their section instead would send every element twice, and elements carry base64
 * images.
 */
const sectionHeadings = {
  where: { deletedAt: null },
  orderBy: { number: 'asc' as const },
} as const;

/**
 * Learners see published, non-deleted content only. Authors see everything that
 * is not deleted. `live` is the learner view.
 *
 * `sortKey` is section-then-position, so one ordering pass puts the whole course
 * in reading order without needing the sections joined in.
 */
function moduleTree(live: boolean) {
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
      include: { sections: sectionHeadings, modules: moduleTree(true), instructors: true },
    });
  }

  /**
   * Published courses reduced to what the dashboard actually reads: counts,
   * minutes and dates.
   *
   * The full tree is enormous by comparison — every element carries its base64
   * media, every quiz its questions and options — and the dashboard renders none
   * of it. It needs to know how many modules there are and which quizzes sit in
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
        modules: {
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
      include: { sections: sectionHeadings, modules: moduleTree(false), instructors: true },
    });
  }

  static getCourseById(id: string, live = false) {
    return prisma.course.findFirst({
      where: { id, deletedAt: null, ...(live ? { published: true } : {}) },
      include: { sections: sectionHeadings, modules: moduleTree(live), instructors: true },
    });
  }

  static createCourse(title: string) {
    return prisma.course.create({
      data: { title },
      include: { sections: sectionHeadings, modules: moduleTree(false) },
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
      include: { sections: sectionHeadings, modules: moduleTree(false), instructors: true },
    });
  }

  // ---- Per-course contributors ----

  /** Courses this person may edit because they were named on them. */
  static getEditableCourses(userId: number) {
    return prisma.course.findMany({
      where: { deletedAt: null, contributors: { some: { id: userId } } },
      orderBy: { createdAt: 'asc' },
      include: { sections: sectionHeadings, modules: moduleTree(false), instructors: true },
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

  /** Which course a section/module/element/quiz/question ultimately belongs to. */
  static async courseIdFromSection(sectionId: string) {
    const section = await prisma.section.findUnique({
      where: { id: sectionId },
      select: { courseId: true },
    });
    return section?.courseId ?? null;
  }

  static async courseIdFromModule(moduleId: string) {
    const module = await prisma.module.findUnique({
      where: { id: moduleId },
      select: { courseId: true },
    });
    return module?.courseId ?? null;
  }

  static async courseIdFromElement(elementId: string) {
    const element = await prisma.element.findUnique({
      where: { id: elementId },
      select: { module: { select: { courseId: true } } },
    });
    return element?.module.courseId ?? null;
  }

  static async courseIdFromQuiz(quizId: string) {
    const quiz = await prisma.quiz.findUnique({
      where: { id: quizId },
      select: { module: { select: { courseId: true } } },
    });
    return quiz?.module?.courseId ?? null;
  }

  static async courseIdFromQuestion(questionId: string) {
    const question = await prisma.question.findUnique({
      where: { id: questionId },
      select: { quiz: { select: { module: { select: { courseId: true } } } } },
    });
    return question?.quiz.module?.courseId ?? null;
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
    moduleId?: string | null;
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

  /** Permanent. Modules, elements and progress go with it via ON DELETE CASCADE. */
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

  static purgeSectionsDeletedBefore(cutoff: Date) {
    return prisma.section.deleteMany({ where: { deletedAt: { not: null, lt: cutoff } } });
  }

  static purgeModulesDeletedBefore(cutoff: Date) {
    return prisma.module.deleteMany({ where: { deletedAt: { not: null, lt: cutoff } } });
  }

  /** Marks a course as having new content. Only module/quiz additions call this. */
  static touchContent(courseId: string) {
    return prisma.course.update({
      where: { id: courseId },
      data: { contentUpdatedAt: new Date() },
    });
  }

  /**
   * Records that the draft has moved on from what is published.
   *
   * Called by every content mutation, however small — a renamed section counts
   * as much as a new module, because both are held back from learners until the
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
  static recordCompletion(userId: number, courseId: string, moduleCount: number) {
    return prisma.courseCompletion.upsert({
      where: { userId_courseId: { userId, courseId } },
      create: { userId, courseId, moduleCount },
      update: {},
    });
  }

  /** Called when the learner acknowledges the new content by finishing again. */
  static refreshCompletion(userId: number, courseId: string, moduleCount: number) {
    return prisma.courseCompletion.update({
      where: { userId_courseId: { userId, courseId } },
      data: { completedAt: new Date(), moduleCount, notifiedAt: null },
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
   * Live modules of a course added since a moment, with the section they landed
   * in — which is what a "there is new content" mail has to name to be worth
   * sending. Ordered the way the course reads.
   */
  static getModulesAddedSince(courseId: string, since: Date) {
    return prisma.module.findMany({
      where: { courseId, deletedAt: null, createdAt: { gt: since } },
      orderBy: { sortKey: 'asc' },
      select: {
        id: true,
        number: true,
        title: true,
        section: { select: { id: true, number: true, title: true } },
      },
    });
  }

  /** Published quizzes of a course added since a moment, with their module. */
  static getQuizzesAddedSince(courseId: string, since: Date) {
    return prisma.quiz.findMany({
      where: {
        deletedAt: null,
        published: true,
        createdAt: { gt: since },
        module: { courseId, deletedAt: null },
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        title: true,
        module: {
          select: {
            id: true,
            number: true,
            title: true,
            section: { select: { id: true, number: true, title: true } },
          },
        },
      },
    });
  }

  // ---- Sections ----

  static getSections(courseId: string, db: Db = prisma) {
    return db.section.findMany({
      where: { courseId, deletedAt: null },
      orderBy: { number: 'asc' },
    });
  }

  static getSectionById(id: string) {
    return prisma.section.findFirst({ where: { id, deletedAt: null } });
  }

  /**
   * The lowest section number in a course, counting recycled ones. Anything
   * parking below this is guaranteed not to collide, which is what lets a
   * renumber run past sections already parked in the bin.
   */
  static async getLowestSectionNumber(courseId: string, db: Db = prisma): Promise<number> {
    const lowest = await db.section.aggregate({ where: { courseId }, _min: { number: true } });
    return Math.min(lowest._min.number ?? 0, 0);
  }

  static createSection(
    data: { courseId: string; number: number; title: string; color?: string | null },
    db: Db = prisma,
  ) {
    return db.section.create({ data });
  }

  static updateSection(
    id: string,
    data: Partial<{ number: number; title: string; color: string | null }>,
    db: Db = prisma,
  ) {
    return db.section.update({ where: { id }, data });
  }

  /**
   * Soft delete, moving the section out of the numbering space on the way.
   *
   * A recycled section must not keep reserving its number: the sections after it
   * shift up to close the gap, and the unique index on (courseId, number) spans
   * deleted rows, so leaving it on 2 makes the new section 2 impossible. It parks
   * below every number the course has ever used, which cannot collide and cannot
   * be reached by renumbering. Restoring puts it back through the renumber pass.
   */
  static async softDeleteSection(id: string, courseId: string, db: Db = prisma) {
    const lowest = await db.section.aggregate({
      where: { courseId },
      _min: { number: true },
    });

    return db.section.update({
      where: { id },
      data: { deletedAt: new Date(), number: Math.min(lowest._min.number ?? 0, 0) - 1 },
    });
  }

  /** Comes back on the end of the course; the renumber pass tidies up from there. */
  static async restoreSection(id: string, courseId: string, db: Db = prisma) {
    const highest = await db.section.aggregate({
      where: { courseId },
      _max: { number: true },
    });

    return db.section.update({
      where: { id },
      data: { deletedAt: null, number: Math.max(highest._max.number ?? 0, 0) + 1 },
    });
  }

  /** Only matches an already soft-deleted section, so live content can't be hard deleted. */
  static findDeletedSection(id: string) {
    return prisma.section.findFirst({ where: { id, deletedAt: { not: null } } });
  }

  static hardDeleteSection(id: string) {
    return prisma.section.delete({ where: { id } });
  }

  /**
   * No `number`: a recycled section has been parked outside the numbering space,
   * and the number it used to hold now belongs to whatever closed the gap. Naming
   * it in the bin would point at the wrong section.
   */
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

  static restoreAllSections() {
    return prisma.section.updateMany({
      where: { deletedAt: { not: null } },
      data: { deletedAt: null },
    });
  }

  static purgeSections() {
    return prisma.section.deleteMany({ where: { deletedAt: { not: null } } });
  }

  /**
   * A course's live modules, ordered by their place within a section.
   *
   * Ordered by `position` rather than `sortKey` on purpose: the renumber pass
   * runs after the numbers have been parked on throwaway values, so sortKey at
   * that moment says nothing about where anything belongs. `position` is the
   * intent — it is what a reorder writes — and is unique within a section, so
   * bucketing this list by sectionId yields each section's modules in order.
   */
  static getModulesForRenumber(courseId: string, db: Db = prisma) {
    return db.module.findMany({
      where: { courseId, deletedAt: null },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
      select: { id: true, sectionId: true, position: true, number: true },
    });
  }

  /** Highest position used in a section, so something can be put on the end. */
  static async getHighestModulePosition(sectionId: string, db: Db = prisma): Promise<number> {
    const highest = await db.module.aggregate({
      where: { sectionId },
      _max: { position: true },
    });
    return highest._max.position ?? 0;
  }

  static getModuleById(id: string) {
    return prisma.module.findFirst({ where: { id, deletedAt: null } });
  }

  static createModule(
    data: {
      courseId: string;
      sectionId: string;
      position: number;
      number: string;
      sortKey: string;
      title: string;
      estimatedMinutes: number;
    },
    db: Db = prisma,
  ) {
    return db.module.create({ data });
  }

  static updateModule(
    id: string,
    data: Partial<{
      sectionId: string;
      position: number;
      number: string;
      sortKey: string;
      title: string;
      estimatedMinutes: number;
    }>,
    db: Db = prisma,
  ) {
    return db.module.update({ where: { id }, data });
  }

  /**
   * Soft delete, moving the module out of the numbering space on the way. Same
   * reason as sections: the modules after it close the gap, and the unique index
   * on (courseId, number) counts deleted rows, so a recycled 1.2 would block the
   * module that becomes 1.2. Its id makes the parked value unique by
   * construction, and no real number can look like it.
   */
  static softDeleteModule(id: string, db: Db = prisma) {
    return db.module.update({
      where: { id },
      data: { deletedAt: new Date(), number: `deleted-${id}`, sortKey: `deleted-${id}` },
    });
  }

  /**
   * Comes back on the end of its section. Its old position was reused the moment
   * it left, and two modules sharing a position would make the order between
   * them arbitrary — the end is the one slot always free.
   */
  static async restoreModule(id: string, sectionId: string, db: Db = prisma) {
    const last = await CurriculumGateway.getHighestModulePosition(sectionId, db);
    return db.module.update({
      where: { id },
      data: { deletedAt: null, position: last + 1 },
    });
  }

  /** Only matches an already soft-deleted module, so live content can't be hard deleted. */
  static findDeletedModule(id: string) {
    return prisma.module.findFirst({ where: { id, deletedAt: { not: null } } });
  }

  /** Permanent. Elements and progress go with it via ON DELETE CASCADE. */
  static hardDeleteModule(id: string) {
    return prisma.module.delete({ where: { id } });
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

  /** No `number`, for the same reason as sections — see getDeletedSections. */
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

  static getLastElementOrder(moduleId: string, db: Db = prisma) {
    return db.element.findFirst({ where: { moduleId }, orderBy: { order: 'desc' } });
  }

  /**
   * Highest position used in a module by either an element or a quiz. They share
   * one sequence so a quiz can sit between two pieces of content.
   */
  static async getLastContentOrder(moduleId: string, db: Db = prisma): Promise<number> {
    const [element, quiz] = await Promise.all([
      db.element.findFirst({ where: { moduleId }, orderBy: { order: 'desc' } }),
      db.quiz.findFirst({ where: { moduleId, deletedAt: null }, orderBy: { order: 'desc' } }),
    ]);
    return Math.max(element?.order ?? 0, quiz?.order ?? 0);
  }

  static setElementOrder(id: string, order: number, db: Db = prisma) {
    return db.element.update({ where: { id }, data: { order } });
  }

  static setQuizOrder(id: string, order: number, db: Db = prisma) {
    return db.quiz.update({ where: { id }, data: { order } });
  }

  /** Elements and quizzes of a module, for validating a reorder request. */
  static async getModuleContentIds(moduleId: string) {
    const [elements, quizzes] = await Promise.all([
      prisma.element.findMany({ where: { moduleId }, select: { id: true } }),
      prisma.quiz.findMany({ where: { moduleId, deletedAt: null }, select: { id: true } }),
    ]);
    return {
      elementIds: new Set(elements.map((e) => e.id)),
      quizIds: new Set(quizzes.map((q) => q.id)),
    };
  }

  static createElement(
    moduleId: string,
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
    return db.element.create({ data: { moduleId, order, ...data } });
  }

  static updateElement(id: string, data: Prisma.ElementUpdateInput) {
    return prisma.element.update({ where: { id }, data });
  }

  static deleteElement(id: string) {
    return prisma.element.delete({ where: { id } });
  }

  /** Records that a user opened a module. Modules auto-complete on view. */
  static recordModuleView(userId: number, moduleId: string) {
    return prisma.moduleProgress.upsert({
      where: { userId_moduleId: { userId, moduleId } },
      create: { userId, moduleId },
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
    const earliest = await prisma.moduleProgress.findFirst({
      where: { userId, module: { courseId } },
      orderBy: { viewedAt: 'asc' },
      select: { viewedAt: true },
    });
    return earliest?.viewedAt ?? null;
  }

  static getViewedModuleIds(userId: number) {
    return prisma.moduleProgress.findMany({
      where: { userId },
      select: { moduleId: true, viewedAt: true },
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

  static getViewedElementIds(userId: number) {
    return prisma.elementProgress.findMany({
      where: { userId },
      select: { elementId: true },
    });
  }

  static getElementById(id: string) {
    return prisma.element.findUnique({
      where: { id },
      select: { id: true, moduleId: true, module: { select: { courseId: true } } },
    });
  }

  static runTransaction<T>(fn: (db: Db) => Promise<T>) {
    return prisma.$transaction(fn);
  }
}
