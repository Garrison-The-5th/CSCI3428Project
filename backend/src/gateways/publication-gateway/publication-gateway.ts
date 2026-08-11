/**
 * File: publication-gateway.ts
 * Description: All database access for published course versions.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
import { Prisma } from '../../../generated/prisma';
import { prisma } from '../../../prisma/prisma-client';

/**
 * Reads and writes of published course versions.
 *
 * The snapshot column is JSON, so nothing here knows its shape — that lives in
 * publicationService, which is the only thing that builds one.
 */
export default class PublicationGateway {
  /** The version a learner is currently served, or null if never published. */
  static getLive(courseId: string, version: number) {
    if (version < 1) return Promise.resolve(null);
    return prisma.coursePublication.findUnique({
      where: { courseId_version: { courseId, version } },
    });
  }

  /**
   * The live publication of every published course, in one read.
   *
   * The catalogue pages need all of them at once, and asking per course turns
   * one query into one per course.
   */
  static async getLiveForCourses(pairs: Array<{ courseId: string; version: number }>) {
    const wanted = pairs.filter((pair) => pair.version >= 1);
    if (wanted.length === 0) return [];

    return prisma.coursePublication.findMany({
      where: {
        OR: wanted.map((pair) => ({ courseId: pair.courseId, version: pair.version })),
      },
    });
  }

  static create(data: {
    courseId: string;
    version: number;
    snapshot: Prisma.InputJsonValue;
    publishedById: number | null;
    newSectionIds: string[];
    newModuleIds: string[];
    newElementIds: string[];
    newQuizIds: string[];
  }) {
    return prisma.coursePublication.create({ data });
  }

  /** Marks the previous live version as replaced, which starts its archive clock. */
  static supersede(courseId: string, version: number) {
    return prisma.coursePublication.updateMany({
      where: { courseId, version, supersededAt: null },
      data: { supersededAt: new Date() },
    });
  }

  /**
   * Versions for the editor's archive list. The snapshot itself is left out —
   * it carries every element's base64 media, and the list only needs the
   * headline figures.
   */
  static listForCourse(courseId: string) {
    return prisma.coursePublication.findMany({
      where: { courseId },
      orderBy: { version: 'desc' },
      select: {
        id: true,
        version: true,
        publishedAt: true,
        supersededAt: true,
        newSectionIds: true,
        newModuleIds: true,
        newElementIds: true,
        newQuizIds: true,
        publishedBy: { select: { id: true, email: true, name: true } },
      },
    });
  }

  static getById(id: string) {
    return prisma.coursePublication.findUnique({ where: { id } });
  }

  /**
   * Every version published after a moment, newest last.
   *
   * What is new to a learner is not one version's delta but the union of every
   * delta since they last looked — otherwise republishing a course without
   * adding anything would wipe the marks off content they still have not seen.
   */
  static listPublishedSince(courseId: string, since: Date) {
    return prisma.coursePublication.findMany({
      where: { courseId, publishedAt: { gt: since } },
      orderBy: { version: 'asc' },
      select: {
        version: true,
        publishedAt: true,
        newSectionIds: true,
        newModuleIds: true,
        newElementIds: true,
        newQuizIds: true,
      },
    });
  }

  /**
   * Clears archived versions past the retention window.
   *
   * `supersededAt: { not: null }` is what protects the live version: it is never
   * superseded, so however old it gets it is never a candidate here.
   */
  static purgeSupersededBefore(cutoff: Date) {
    return prisma.coursePublication.deleteMany({
      where: { supersededAt: { not: null, lt: cutoff } },
    });
  }
}
