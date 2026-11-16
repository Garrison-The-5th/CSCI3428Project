/**
 * File: course-map-gateway.ts
 * Description: All database access for a course's directed-learning map.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-09-22
 */
import { Prisma } from '../../../generated/prisma';
import { prisma } from '../../../prisma/prisma-client';

type Db = Prisma.TransactionClient;

/**
 * A node with everything the editor and the learner projection read off it: its
 * placed sections in order, and the connections at both ends.
 *
 * The sections come back as headings — id, number, title — rather than as the
 * full tree. The map cares where a section sits, not what is inside it, and
 * sections carry base64 media that nothing on this page would draw.
 */
const nodeInclude = {
  items: {
    orderBy: { order: 'asc' as const },
    include: {
      section: {
        select: {
          id: true,
          courseId: true,
          number: true,
          title: true,
          estimatedMinutes: true,
          deletedAt: true,
        },
      },
    },
  },
};

/**
 * Depth first, then left to right. The same order the learner reads them in, so
 * anything walking this list is already in course order without sorting again.
 */
const nodeOrder: Prisma.CourseMapNodeOrderByWithRelationInput[] = [
  { depth: 'asc' },
  { x: 'asc' },
  { title: 'asc' },
];

export type MapNodeRow = Prisma.CourseMapNodeGetPayload<{ include: typeof nodeInclude }>;

export default class CourseMapGateway {
  // ---- Reading ----

  /** Every node on a course's map, in reading order, with its placed sections. */
  static getNodes(courseId: string, db: Db = prisma) {
    return db.courseMapNode.findMany({
      where: { courseId },
      orderBy: nodeOrder,
      include: nodeInclude,
    });
  }

  /** Every parent-to-child connection on a course's map. */
  static getEdges(courseId: string, db: Db = prisma) {
    return db.courseMapEdge.findMany({ where: { courseId } });
  }

  /** One node with its placed sections, or null. */
  static getNodeById(id: string, db: Db = prisma) {
    return db.courseMapNode.findUnique({ where: { id }, include: nodeInclude });
  }

  /** The map's root — the content every learner gets before any choice is asked. */
  static getRoot(courseId: string, db: Db = prisma) {
    return db.courseMapNode.findFirst({ where: { courseId, isRoot: true } });
  }

  /** Which course a node belongs to, for access checks; null if the node is gone. */
  static courseIdFromNode(id: string) {
    return prisma.courseMapNode
      .findUnique({ where: { id }, select: { courseId: true } })
      .then((node) => node?.courseId ?? null);
  }

  // ---- Nodes ----

  /**
   * Adds a node. Depth starts at 0 for the root and 1 for anything else; the
   * real depth is filled in by setDepths once the node is connected.
   */
  static createNode(
    data: {
      courseId: string;
      title: string;
      x: number;
      y: number;
      isRoot?: boolean;
      subgraphId?: string;
      sourceNodeId?: string;
    },
    db: Db = prisma,
  ) {
    return db.courseMapNode.create({
      data: { ...data, depth: data.isRoot ? 0 : 1 },
      include: nodeInclude,
    });
  }

  /** Renames or moves a node on the canvas. */
  static updateNode(
    id: string,
    data: { title?: string; x?: number; y?: number; depth?: number },
    db: Db = prisma,
  ) {
    return db.courseMapNode.update({ where: { id }, data, include: nodeInclude });
  }

  /** Depths are rewritten wholesale after any change to the connections. */
  static async setDepths(depths: Map<string, number>, db: Db = prisma) {
    await Promise.all(
      [...depths].map(([id, depth]) => db.courseMapNode.update({ where: { id }, data: { depth } })),
    );
  }

  /** Removes a node; its connections and placed items go with it. */
  static deleteNode(id: string, db: Db = prisma) {
    return db.courseMapNode.delete({ where: { id } });
  }

  // ---- Edges ----

  /** Connects a parent node to a child. `subgraphId` marks it as part of a linked map. */
  static createEdge(
    data: { courseId: string; parentId: string; childId: string; subgraphId?: string },
    db: Db = prisma,
  ) {
    return db.courseMapEdge.create({ data });
  }

  /** Removes one connection by its id. */
  static deleteEdgeById(id: string, db: Db = prisma) {
    return db.courseMapEdge.delete({ where: { id } });
  }

  /** Removes the connection between two nodes, if there is one (no error if not). */
  static deleteEdge(parentId: string, childId: string, db: Db = prisma) {
    return db.courseMapEdge.deleteMany({ where: { parentId, childId } });
  }

  /**
   * Points a connection at the layer-quiz option that selects it. Written by
   * the quiz generator; null between drawing an edge and regenerating.
   */
  static setEdgeOption(id: string, optionId: string | null, db: Db = prisma) {
    return db.courseMapEdge.update({ where: { id }, data: { optionId } });
  }

  // ---- Items ----

  /**
   * Replaces a node's content list in one go.
   *
   * One call covers reordering inside a node, dragging between two nodes and
   * dragging back to the staging manager, because all three are the same fact
   * stated about one node: here is what it holds now, in this order.
   */
  static async setItems(
    nodeId: string,
    items: Array<{ sectionId: string; sourceCourseId: string; subgraphId?: string | null }>,
    db: Db = prisma,
  ) {
    await db.courseMapItem.deleteMany({ where: { nodeId } });
    if (items.length > 0) {
      await db.courseMapItem.createMany({
        data: items.map((item, index) => ({ ...item, nodeId, order: index })),
      });
    }
  }

  /** Every section already placed somewhere on this course's map. */
  static async placedSectionIds(courseId: string, db: Db = prisma): Promise<Set<string>> {
    const items = await db.courseMapItem.findMany({
      where: { node: { courseId } },
      select: { sectionId: true },
    });
    return new Set(items.map((item) => item.sectionId));
  }

  /**
   * The maps that place this section, other than its own course's.
   *
   * Answers "who serves this content besides whoever wrote it". A section
   * borrowed onto another course's map is delivered by that course — it is in
   * that course's published snapshot and reached by whoever holds it — so
   * anything asking whether a learner may see it has to look there too, not only
   * at the course the section was authored in.
   */
  static async coursesPlacingSection(sectionId: string, db: Db = prisma): Promise<string[]> {
    const items = await db.courseMapItem.findMany({
      where: { sectionId },
      select: { node: { select: { courseId: true } } },
    });
    return [...new Set(items.map((item) => item.node.courseId))];
  }

  /** Drops one section from wherever it sits, so it can be placed elsewhere. */
  static removeSection(courseId: string, sectionId: string, db: Db = prisma) {
    return db.courseMapItem.deleteMany({ where: { sectionId, node: { courseId } } });
  }

  /**
   * Drops a section from wherever the author put it, leaving any placement a
   * linked map owns alone — that one is the source course's to move.
   */
  static removeAuthoredSection(courseId: string, sectionId: string, db: Db = prisma) {
    return db.courseMapItem.deleteMany({
      where: { sectionId, subgraphId: null, node: { courseId } },
    });
  }

  // ---- Linked maps ----

  /**
   * A transaction with room to breathe. Rewriting a linked map touches every
   * node, item and connection in it, which on a large map can outlast Prisma's
   * five-second default.
   */
  static runTransaction<T>(fn: (db: Db) => Promise<T>) {
    return prisma.$transaction(fn, { timeout: 30_000 });
  }

  /** Every other course's map linked into this one. */
  static getSubgraphs(courseId: string, db: Db = prisma) {
    return db.courseMapSubgraph.findMany({ where: { courseId } });
  }

  /** One linked map, or null. */
  static getSubgraphById(id: string, db: Db = prisma) {
    return db.courseMapSubgraph.findUnique({ where: { id } });
  }

  /** Every course that has this one's map linked into it. */
  static getSubgraphsFromSource(sourceCourseId: string, db: Db = prisma) {
    return db.courseMapSubgraph.findMany({ where: { sourceCourseId } });
  }

  /**
   * Records a link to another course's map. The caller then copies the source's
   * nodes, connections and items in under this subgraph's id.
   */
  static createSubgraph(
    data: { courseId: string; sourceCourseId: string; anchorNodeId: string | null },
    db: Db = prisma,
  ) {
    return db.courseMapSubgraph.create({ data });
  }

  /**
   * Forgets the node a linked map was dropped on. Cleared once the connection
   * from that node into the copy's root has been drawn, so later rewrites of the
   * copy do not draw it again — from then on it is the author's own edge.
   */
  static clearSubgraphAnchor(id: string, db: Db = prisma) {
    return db.courseMapSubgraph.update({ where: { id }, data: { anchorNodeId: null } });
  }

  /** Removes the link, and with it every node, connection and item it wrote. */
  static deleteSubgraph(id: string, db: Db = prisma) {
    return db.courseMapSubgraph.deleteMany({ where: { id } });
  }

  /** Removes every link from one source course into this map, e.g. when that import is dropped. */
  static deleteSubgraphsFromSource(courseId: string, sourceCourseId: string, db: Db = prisma) {
    return db.courseMapSubgraph.deleteMany({ where: { courseId, sourceCourseId } });
  }

  // ---- Imports ----
  // An import makes another course's sections available to place on this map,
  // without copying them; they stay owned and edited by their own course.

  /** The courses this map draws on, in the order they were added. */
  static getImports(courseId: string, db: Db = prisma) {
    return db.courseMapImport.findMany({
      where: { courseId },
      orderBy: { order: 'asc' },
      select: { id: true, sourceCourseId: true, order: true },
    });
  }

  /** Adds a source course to the end of this map's import list. */
  static async addImport(courseId: string, sourceCourseId: string, db: Db = prisma) {
    const last = await db.courseMapImport.findFirst({
      where: { courseId },
      orderBy: { order: 'desc' },
      select: { order: true },
    });
    return db.courseMapImport.create({
      data: { courseId, sourceCourseId, order: (last?.order ?? -1) + 1 },
    });
  }

  /** Takes a source course off this map's import list. */
  static removeImport(courseId: string, sourceCourseId: string, db: Db = prisma) {
    return db.courseMapImport.deleteMany({ where: { courseId, sourceCourseId } });
  }

  // ---- Layer quizzes ----
  // One generated quiz per depth of the map: everything the same distance from
  // the root is offered together in a single question.

  /** The map's layer quizzes, shallowest first. */
  static getLayers(courseId: string, db: Db = prisma) {
    return db.directedLayerQuiz.findMany({ where: { courseId }, orderBy: { depth: 'asc' } });
  }

  /** Records the generated quiz and model for one depth of the map. */
  static createLayer(
    data: { courseId: string; depth: number; quizId: string; modelId: string },
    db: Db = prisma,
  ) {
    return db.directedLayerQuiz.create({ data });
  }

  /**
   * Drops a layer record only. The caller deletes the layer's quiz and model
   * separately.
   */
  static deleteLayer(id: string, db: Db = prisma) {
    return db.directedLayerQuiz.delete({ where: { id } });
  }

  /** The layer a quiz belongs to, or null if it is not a layer quiz at all. */
  static layerForQuiz(quizId: string, db: Db = prisma) {
    return db.directedLayerQuiz.findUnique({ where: { quizId } });
  }

  // ---- Learner choices ----

  /** What this learner picked at each layer of a course's map, shallowest first. */
  static getChoices(userId: number, courseId: string, db: Db = prisma) {
    return db.directedChoice.findMany({
      where: { userId, courseId },
      orderBy: { depth: 'asc' },
    });
  }

  /**
   * Records what a learner picked at one layer, replacing whatever they picked
   * before. A retake is an overwrite rather than a second row: this is their
   * current path, not the history of how they arrived at it.
   */
  static saveChoice(
    userId: number,
    courseId: string,
    depth: number,
    chosenNodeIds: string[],
    db: Db = prisma,
  ) {
    return db.directedChoice.upsert({
      where: { userId_courseId_depth: { userId, courseId, depth } },
      create: { userId, courseId, depth, chosenNodeIds },
      update: { chosenNodeIds, answeredAt: new Date() },
    });
  }

  /**
   * Forgets nodes that no longer exist, across every learner of this course.
   *
   * Run after the author deletes a node or a connection. Leaving the id behind
   * would be harmless today and a trap later — node ids are uuids, but a stale
   * id in a choice list makes "what did they pick" answer with something the map
   * no longer contains.
   */
  static async pruneChoices(courseId: string, liveNodeIds: string[], db: Db = prisma) {
    const live = new Set(liveNodeIds);
    const choices = await db.directedChoice.findMany({ where: { courseId } });

    await Promise.all(
      choices
        .map((choice) => ({
          choice,
          kept: choice.chosenNodeIds.filter((id) => live.has(id)),
        }))
        .filter(({ choice, kept }) => kept.length !== choice.chosenNodeIds.length)
        .map(({ choice, kept }) =>
          db.directedChoice.update({ where: { id: choice.id }, data: { chosenNodeIds: kept } }),
        ),
    );
  }
}
