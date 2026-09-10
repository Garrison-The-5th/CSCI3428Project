/**
 * File: edit-attribution-service.ts
 * Description: Who last changed each unpublished piece of a course.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-09-04
 */
import { logger } from '@/config/logger';
import { firstName } from '@/services/edit-lease-service/edit-lease-service';

import { prisma } from '../../../prisma/prisma-client';

/** The kinds of row that carry an editor's name while a change is unpublished. */
export type EditedKind = 'MODULE' | 'SECTION' | 'ELEMENT' | 'QUIZ' | 'QUESTION';

/**
 * Who last changed each piece of a course that learners cannot see yet.
 *
 * The marks exist to answer one question in the editor — "what has moved since
 * the last publish, and who moved it" — and that is why they are cleared
 * wholesale by a publish rather than kept as history. A permanent record of
 * every edit is what version history is for; this is a working note on a draft,
 * and a note that never goes away would tag every course forever.
 *
 * Nothing here is allowed to fail a request. It hangs off the edit that mattered
 * and is worth strictly less than it, so an error is logged and swallowed.
 */
/** One row's mark: who, when, and whether "who" is the person reading it. */
export interface EditMark {
  by: string;
  at: string;
  /**
   * Their own change.
   *
   * Decided here rather than by comparing names in the browser: two colleagues
   * called Sam would both be told the change was theirs, and the page has no
   * business knowing anybody's id to tell them apart. The tag reads "you" when
   * this is set, which is the difference between "somebody has been in here"
   * and "this is where I left off".
   */
  mine: boolean;
}

export interface EditMarks {
  modules: Record<string, EditMark>;
  sections: Record<string, EditMark>;
  elements: Record<string, EditMark>;
  quizzes: Record<string, EditMark>;
  questions: Record<string, EditMark>;
}

type MarkedRow = {
  id: string;
  lastEditedAt: Date | null;
  lastEditedBy: { id: number; name: string | null; email: string } | null;
};

/** Rows to a map keyed by id, which is how the editor asks about them. */
function index(rows: MarkedRow[], readerId: number | null): Record<string, EditMark> {
  const out: Record<string, EditMark> = {};

  for (const row of rows) {
    if (!row.lastEditedBy) continue;
    out[row.id] = {
      by: firstName(row.lastEditedBy),
      at: (row.lastEditedAt ?? new Date()).toISOString(),
      mine: row.lastEditedBy.id === readerId,
    };
  }

  return out;
}

export default class EditAttributionService {
  static async stamp(kind: EditedKind, id: string, userId: number | null) {
    if (!userId || !id) return;

    const data = { lastEditedById: userId, lastEditedAt: new Date() };

    try {
      // updateMany rather than update: the row may have been deleted by the very
      // request being attributed, and a note about it must not raise.
      switch (kind) {
        case 'MODULE':
          await prisma.module.updateMany({ where: { id }, data });
          return;
        case 'SECTION':
          await prisma.section.updateMany({ where: { id }, data });
          return;
        case 'ELEMENT':
          await prisma.element.updateMany({ where: { id }, data });
          return;
        case 'QUIZ':
          await prisma.quiz.updateMany({ where: { id }, data });
          return;
        case 'QUESTION':
          await prisma.question.updateMany({ where: { id }, data });
          return;
      }
    } catch (error) {
      logger.error({ err: error }, `Could not record who edited ${kind} ${id}`);
    }
  }

  /**
   * Every unpublished change in a course, and whose it is.
   *
   * Read on its own rather than joined onto the course tree, and deliberately
   * so. That tree is what `buildSnapshot` freezes into a version, and hanging
   * editor names off it would put them in every published snapshot and into the
   * fingerprint two versions are compared by — so an edit mark would read as
   * content, and clearing the marks at publish time would itself look like a
   * change to publish.
   *
   * One flat map per kind, keyed by id, because that is how the editor asks: it
   * is drawing a module and wants to know whether this one is marked.
   */
  static async marksForCourse(courseId: string, readerId: number | null): Promise<EditMarks> {
    const editor = { select: { id: true, name: true, email: true } };
    const marked = { lastEditedById: { not: null } };

    const [modules, sections, elements, quizzes, questions] = await Promise.all([
      prisma.module.findMany({
        where: { courseId, ...marked },
        select: { id: true, lastEditedAt: true, lastEditedBy: editor },
      }),
      prisma.section.findMany({
        where: { courseId, ...marked },
        select: { id: true, lastEditedAt: true, lastEditedBy: editor },
      }),
      prisma.element.findMany({
        where: { section: { courseId }, ...marked },
        select: { id: true, lastEditedAt: true, lastEditedBy: editor },
      }),
      prisma.quiz.findMany({
        where: { section: { courseId }, ...marked },
        select: { id: true, lastEditedAt: true, lastEditedBy: editor },
      }),
      prisma.question.findMany({
        where: { quiz: { section: { courseId } }, ...marked },
        select: { id: true, lastEditedAt: true, lastEditedBy: editor },
      }),
    ]);

    return {
      modules: index(modules, readerId),
      sections: index(sections, readerId),
      elements: index(elements, readerId),
      quizzes: index(quizzes, readerId),
      questions: index(questions, readerId),
    };
  }

  /**
   * Clears every mark on a course, which a publish does.
   *
   * At that moment there is no unpublished change left to attribute, so leaving
   * the marks up would say something false about every element in the course.
   */
  static async clearForCourse(courseId: string) {
    const data = { lastEditedById: null, lastEditedAt: null };

    try {
      await prisma.$transaction([
        prisma.module.updateMany({ where: { courseId }, data }),
        prisma.section.updateMany({ where: { courseId }, data }),
        prisma.element.updateMany({ where: { section: { courseId } }, data }),
        prisma.quiz.updateMany({ where: { section: { courseId } }, data }),
        prisma.question.updateMany({ where: { quiz: { section: { courseId } } }, data }),
      ]);
    } catch (error) {
      logger.error({ err: error }, `Could not clear edit marks on course ${courseId}`);
    }
  }
}
