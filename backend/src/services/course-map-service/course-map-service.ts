/**
 * File: course-map-service.ts
 * Description: The directed-learning map — nodes, connections, staging and the generated layer quizzes.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-09-25
 */
import { ConflictError, NotFoundError } from '@/controllers/http-errors';
import CourseMapGateway from '@/gateways/course-map-gateway/course-map-gateway';
import CurriculumGateway, { CourseReach } from '@/gateways/curriculum-gateway/curriculum-gateway';
import QuizGateway from '@/gateways/quiz-gateway/quiz-gateway';
import {
  choiceEdgeIds,
  DirectedLock,
  LearnerChoices,
  ProjectableCourse,
  projectDirectedCourse,
  SnapshotMap,
  SnapshotMapLayer,
  SnapshotMapNode,
} from '@/services/course-map-service/directed-path';

import { CourseKind, QuizType } from '../../../generated/prisma';

/**
 * A course whose path is built from a map.
 *
 * The author writes ordinary sections in the Modules tab, stages them, and then
 * arranges them into nodes on a 2D map. Each node is a question the course asks
 * without asking it out loud — "does this apply to you?" — and the generated
 * layer quizzes are where it finally does. What a learner reads is whichever
 * branches they ticked, so two people on the same course can share nothing but
 * the root.
 *
 * Three rules hold the whole thing up, and everything else here serves one of
 * them:
 *
 *   The root is where everyone starts. Exactly one per map, no way to give it a
 *   parent, no way to delete it.
 *
 *   Depth is one more than the *shallowest* parent. A node reachable by a short
 *   route is offered as soon as that route allows, rather than being held back
 *   for a longer one that also reaches it.
 *
 *   A section of this course must be somewhere on the map before the course may
 *   be published. An imported course's sections need not be: importing a course
 *   is taking three sections off a shelf and leaving the fourth.
 */

/** Where the root lands on an empty canvas, and how far apart new nodes sit. */
const ROOT_POSITION = { x: 80, y: 260 };
const NODE_SPACING = { x: 320, y: 200 };

/** How far to the right of the node it was dropped on a linked map's root lands. */
const ROOT_TO_LINK = { x: 320, y: 0 };

/** The node every map has and nobody creates. */
const ROOT_TITLE = 'General content';

/**
 * What a node is called before anybody has said what it is.
 *
 * Recognised as well as written, because it is how `setNodeItems` knows a node
 * has never been named and may therefore be named for it — see `autoName`.
 */
const DEFAULT_NODE_TITLE = 'New node';

/** The one question a layer quiz asks. */
const LAYER_PROMPT = 'Which of these apply to you?';

/** A course as the author's side reads it, sections and all. */
type AuthoredCourse = NonNullable<Awaited<ReturnType<typeof CurriculumGateway.getCourseById>>>;

export interface StagingGroup {
  courseId: string;
  courseTitle: string;
  /** False on the importing course's own content, which is always first. */
  imported: boolean;
  /**
   * True on an imported course that has a map of its own. Dropping any of its
   * sections onto a node links that whole map in beneath the node, rather than
   * placing the one section — see `linkSubgraph`.
   */
  mapped: boolean;
  sections: Array<{ id: string; number: string; title: string; estimatedMinutes: number }>;
}

/** What the author is told when they try to map content that has not been staged. */
const STAGE_FIRST =
  'New sections or modules have been added since this course was last staged. ' +
  'Stage the course before mapping it.';

/** What the author is told when they try to change part of a linked map. */
function linkedRefusal(sourceTitle: string) {
  return (
    `that is part of the map linked in from ${sourceTitle} and can only be changed there — ` +
    `remove one of its nodes to unlink the whole map`
  );
}

export default class CourseMapService {
  // ---- Reading the map ----

  /**
   * Everything the mapping tab draws: the nodes and their connections, the
   * staging manager's grouped pool, and what is still standing between the
   * author and a publish.
   */
  static async getMap(courseId: string) {
    const course = await CurriculumGateway.getCourseById(courseId);
    if (!course) throw new NotFoundError(`Course with ID ${courseId} not found`);

    const [nodes, edges, imports, layers, subgraphs] = await Promise.all([
      CourseMapGateway.getNodes(courseId),
      CourseMapGateway.getEdges(courseId),
      CourseMapGateway.getImports(courseId),
      CourseMapGateway.getLayers(courseId),
      CourseMapGateway.getSubgraphs(courseId),
    ]);

    const staging = await CourseMapService.stagingPool(courseId, imports);
    const unmapped = staging.find((group) => !group.imported)?.sections ?? [];

    // The course each linked map came from, by name, so the editor can say whose
    // it is without a second request.
    const sourceTitles = new Map(
      await Promise.all(
        subgraphs.map(async (subgraph) => {
          const source = await CurriculumGateway.getCourseById(subgraph.sourceCourseId);
          return [subgraph.id, source?.title ?? 'another course'] as const;
        }),
      ),
    );
    const linkedFor = (node: { id: string; subgraphId: string | null }) =>
      node.subgraphId
        ? {
            subgraphId: node.subgraphId,
            sourceTitle: sourceTitles.get(node.subgraphId) ?? 'another course',
            /** The copy of the source's root: this course's nodes may lead into it. */
            entry: CourseMapService.isLinkedEntry(node, edges),
          }
        : null;

    return {
      directedLearning: course.directedLearning,
      stagedAt: course.stagedAt,
      /** True while mapping is refused until the course is staged again. */
      needsStaging: CourseMapService.needsStaging(course, layers),
      nodes: nodes.map((node) => ({
        id: node.id,
        title: node.title,
        x: node.x,
        y: node.y,
        depth: node.depth,
        isRoot: node.isRoot,
        /** Set on a node copied in from another course's map, which is read-only here. */
        linked: linkedFor(node),
        items: node.items.map((item) => ({
          sectionId: item.sectionId,
          sourceCourseId: item.sourceCourseId,
          number: item.section.number,
          title: item.section.title,
          estimatedMinutes: item.section.estimatedMinutes,
          /** Placed by a linked map, so it moves only when that map does. */
          locked: item.subgraphId !== null,
        })),
      })),
      edges: edges.map((edge) => ({
        parentId: edge.parentId,
        childId: edge.childId,
        /** Part of a linked map: drawn red, and cannot be cut. */
        locked: edge.subgraphId !== null,
      })),
      staging,
      layers: layers.map((layer) => ({ depth: layer.depth, quizId: layer.quizId })),
      /** Named so the editor can say exactly what is blocking the publish. */
      unmappedSectionIds: unmapped.map((section) => section.id),
    };
  }

  /**
   * The staging manager's list: this course's unplaced sections under its own
   * title, then each imported course's under theirs.
   *
   * Ordered this way because that is the order the author thinks in — their own
   * content first, and the shelves they have pulled over second.
   */
  static async stagingPool(
    courseId: string,
    imports?: Array<{ sourceCourseId: string }>,
  ): Promise<StagingGroup[]> {
    const added = imports ?? (await CourseMapGateway.getImports(courseId));
    const placed = await CourseMapGateway.placedSectionIds(courseId);

    const ids = [courseId, ...added.map((entry) => entry.sourceCourseId)];
    const courses = await Promise.all(ids.map((id) => CurriculumGateway.getCourseById(id)));
    const mapped = new Set(
      (
        await Promise.all(
          ids
            .filter((id) => id !== courseId)
            .map(async (id) => ((await CourseMapService.hasMap(id)) ? id : null)),
        )
      ).filter((id): id is string => id !== null),
    );

    return courses
      .filter((course): course is NonNullable<typeof course> => course !== null)
      .map((course) => ({
        courseId: course.id,
        courseTitle: course.title,
        imported: course.id !== courseId,
        mapped: mapped.has(course.id),
        sections: course.sections
          // See `isPlaceableSection` for what is turned away and why.
          .filter((section) => CourseMapService.isPlaceableSection(section))
          .filter((section) => !placed.has(section.id))
          .map((section) => ({
            id: section.id,
            number: section.number,
            title: section.title,
            estimatedMinutes: section.estimatedMinutes,
          })),
      }));
  }

  /**
   * The modules the map generated for its layer quizzes. Those hold their own
   * quiz and nothing else, so the structure editor's paths ask here before
   * putting a section in one.
   */
  static async layerModuleIds(courseId: string): Promise<Set<string>> {
    const layers = await CourseMapGateway.getLayers(courseId);
    return new Set((layers ?? []).map((layer) => layer.moduleId));
  }

  /** Layer sections are named by the generator and recognised by that name. */
  static isLayerSection(title: string): boolean {
    return /^Directed learning quiz \d+$/.test(title);
  }

  /**
   * Whether a section may be put on a map at all.
   *
   * Two kinds are turned away, and everything that reads the pool — the staging
   * manager, the door `setNodeItems` checks, and the publish gate — asks this one
   * question so the three can never disagree about what is placeable.
   *
   *   A layer quiz's own section is generated by the map, not staged into it. It
   *   is where the map's output goes, and offering it back would let an author
   *   map the map.
   *
   *   A section holding a one-time link. A one-time quiz is reached through its
   *   emailed link and nothing else: one attempt, then it closes itself. Placing
   *   one on a map would put it in a run of content a learner walks through, so
   *   it would be opened by reading the lesson rather than by following the link,
   *   and "one attempt, then gone" would stop being true of it. Today nothing can
   *   construct that case — `QuizService` refuses a one-time quiz in a lesson
   *   section, and only lessons can be imported into staging — so this filter is
   *   currently belt to that braces. It is stated here anyway because the
   *   guarantee belongs to the map: if either of those rules is ever relaxed, the
   *   map should not be the thing that quietly breaks.
   */
  static isPlaceableSection(section: {
    title: string;
    quizzes?: Array<{ type?: QuizType | null }>;
  }): boolean {
    if (CourseMapService.isLayerSection(section.title)) return false;
    return !(section.quizzes ?? []).some((quiz) => quiz.type === QuizType.ONE_TIME);
  }

  // ---- Turning it on ----

  /**
   * Switches a course to directed learning, or back.
   *
   * Turning it on mints the root, because a map with nowhere to start is not a
   * map. Turning it off leaves every node, connection and placement exactly
   * where it is: somebody who flicks the toggle to see what happens should be
   * able to flick it back, and the generated quizzes are cleared instead, since
   * those are the half that a learner would otherwise still be served.
   */
  static async setDirected(courseId: string, directedLearning: boolean) {
    const course = await CurriculumGateway.getCourseById(courseId);
    if (!course) throw new NotFoundError(`Course with ID ${courseId} not found`);

    if (directedLearning && course.kind !== CourseKind.LESSON) {
      throw new Error(
        'only a lesson can be directed — a quiz set is one module of quizzes, with no path to direct',
      );
    }

    await CurriculumGateway.updateCourse(courseId, { directedLearning });

    if (directedLearning) await CourseMapService.ensureRoot(courseId);
    else await CourseMapService.clearLayers(courseId);

    return CourseMapService.getMap(courseId);
  }

  /** The root, made on demand so no course carries one it never asked for. */
  static async ensureRoot(courseId: string) {
    const existing = await CourseMapGateway.getRoot(courseId);
    if (existing) return existing;

    return CourseMapGateway.createNode({
      courseId,
      title: ROOT_TITLE,
      x: ROOT_POSITION.x,
      y: ROOT_POSITION.y,
      isRoot: true,
    });
  }

  /**
   * Stage: the soft publish between writing content and mapping it.
   *
   * Settles the root, brings the layer quizzes back in line with the map as it
   * stands, and stamps the course. Nothing here reaches a learner — publishing
   * is still what does that — so this is safe to press at any point, and is
   * exactly what an author should press after adding a section they now want to
   * place.
   */
  static async stage(courseId: string) {
    const course = await CurriculumGateway.getCourseById(courseId);
    if (!course) throw new NotFoundError(`Course with ID ${courseId} not found`);
    if (!course.directedLearning) {
      throw new Error('turn on directed learning before staging this course to the map');
    }

    await CourseMapService.ensureRoot(courseId);
    await CourseMapService.syncQuizzes(courseId);

    // Read after the sync, which may have minted or removed a layer module.
    const layers = await CourseMapGateway.getLayers(courseId);
    await CurriculumGateway.updateCourse(courseId, {
      stagedAt: new Date(),
      stagedContentIds: CourseMapService.contentIds(course, layers),
    });

    return CourseMapService.getMap(courseId);
  }

  /**
   * The modules and sections the author wrote, by id.
   *
   * The map's own layer modules and sections are left out: they come and go as
   * the map changes, and counting them would have every connection drawn demand
   * a fresh stage.
   */
  static contentIds(
    course: { modules: Array<{ id: string }>; sections: Array<{ id: string; title: string }> },
    layers: Array<{ moduleId: string }>,
  ): string[] {
    const layerModules = new Set(layers.map((layer) => layer.moduleId));
    return [
      ...course.modules.filter((module) => !layerModules.has(module.id)).map((m) => m.id),
      ...course.sections
        .filter((section) => !CourseMapService.isLayerSection(section.title))
        .map((section) => section.id),
    ];
  }

  /**
   * Whether anything has been written since the last stage — or the course has
   * never been staged at all — which is when mapping is refused.
   *
   * Only additions count. A section deleted since the stage is simply no longer
   * there to place, and asking for a stage over it would be asking for nothing.
   */
  static needsStaging(
    course: {
      stagedAt: Date | null;
      stagedContentIds: string[];
      modules: Array<{ id: string }>;
      sections: Array<{ id: string; title: string }>;
    },
    layers: Array<{ moduleId: string }>,
  ): boolean {
    if (!course.stagedAt) return true;
    const staged = new Set(course.stagedContentIds);
    return CourseMapService.contentIds(course, layers).some((id) => !staged.has(id));
  }

  /**
   * Refuses a change to the map while the course needs staging.
   *
   * The editor checks first and says so without asking; this is the door, for a
   * page that was open before somebody added a section in another tab.
   */
  static async assertStaged(courseId: string) {
    const course = await CurriculumGateway.getCourseById(courseId);
    if (!course) throw new NotFoundError(`Course with ID ${courseId} not found`);
    const layers = await CourseMapGateway.getLayers(courseId);
    if (CourseMapService.needsStaging(course, layers)) throw new ConflictError(STAGE_FIRST);
  }

  // ---- Nodes ----

  /**
   * Adds an unconnected node to a staged map. With no position given it is
   * placed clear of the existing nodes; with no title it gets the default name.
   */
  static async createNode(courseId: string, data: { title?: string; x?: number; y?: number }) {
    await CourseMapService.assertStaged(courseId);

    const title = String(data.title ?? DEFAULT_NODE_TITLE).trim() || DEFAULT_NODE_TITLE;

    const existing = await CourseMapGateway.getNodes(courseId);
    // Dropped clear of whatever is already on the canvas, so a new node is never
    // born underneath another one where it cannot be seen to be dragged out.
    const fallbackX = ROOT_POSITION.x + NODE_SPACING.x;
    const fallbackY =
      existing.length > 0
        ? Math.max(...existing.map((node) => node.y)) + NODE_SPACING.y
        : ROOT_POSITION.y;

    const node = await CourseMapGateway.createNode({
      courseId,
      title,
      x: Math.round(Number(data.x ?? fallbackX)),
      y: Math.round(Number(data.y ?? fallbackY)),
    });

    await CourseMapService.syncQuizzes(courseId);
    return node;
  }

  /** Renames or moves a node. A linked map's nodes can be moved but not renamed. */
  static async updateNode(id: string, data: { title?: string; x?: number; y?: number }) {
    const node = await CourseMapGateway.getNodeById(id);
    if (!node) throw new NotFoundError(`Node with ID ${id} not found`);
    await CourseMapService.assertStaged(node.courseId);

    const title = data.title !== undefined ? String(data.title).trim() : undefined;
    if (title !== undefined && !title) throw new Error('a node needs a name');
    // A linked node's name is the source course's — moving it is still allowed,
    // since where it sits on this canvas is this course's business.
    if (title !== undefined && title !== node.title && node.subgraphId) {
      throw new Error(await CourseMapService.linkedMessage(node.subgraphId));
    }

    const moved = {
      ...(data.x !== undefined ? { x: Math.round(Number(data.x)) } : {}),
      ...(data.y !== undefined ? { y: Math.round(Number(data.y)) } : {}),
    };

    const before = await CourseMapGateway.getNodes(node.courseId);
    const updated = await CourseMapGateway.updateNode(id, {
      ...(title !== undefined ? { title } : {}),
      ...moved,
    });

    /*
      Whether this actually changed the course, as opposed to the picture of it.

      Dragging a box is usually tidying, and tidying is not an edit: a course
      whose nodes were nudged into line this morning should not spend the rest of
      the week claiming there is something to publish.

      It is not *always* tidying, though, and the difference is worth being
      careful about. A node's `x` is the reading order among everything at its
      own depth — `byPosition` in directed-path.ts sorts the learner's path by
      it, and `syncQuizzes` lists a layer quiz's options by it — so dragging one
      box past another at the same depth genuinely reorders the branches a
      learner is offered. That is a change to the course and has to register as
      one, or it goes out at the next publish with nothing having said so.

      So the question asked is the narrow one: does anything come out in a
      different order than it did a moment ago? Vertical moves never do. Nor do
      horizontal ones that stay on their own side of their neighbours, which is
      what almost every drag is.
    */
    const reordered =
      CourseMapService.readingOrder(before) !==
      CourseMapService.readingOrder(
        before.map((current) => (current.id === id ? { ...current, ...moved } : current)),
      );

    // A rename always rewrites the option that offers this node, so it always
    // syncs. A move only does when it moved something past something else.
    if (title !== undefined || reordered) await CourseMapService.syncQuizzes(node.courseId);

    return updated;
  }

  /**
   * The order everything comes out in, as one comparable string.
   *
   * Exactly the sort the learner's path and the layer quizzes use — depth, then
   * `x`, then title, then id — so "would this change what anybody sees" can be
   * answered by comparing two of these rather than by reasoning about it. The
   * tie-breakers matter: two boxes dropped at the same `x` have to come out in
   * some settled order, and it has to be the same settled order here as there.
   */
  static readingOrder(nodes: Array<{ id: string; depth: number; x: number; title: string }>) {
    return [...nodes]
      .sort(
        (a, b) =>
          a.depth - b.depth ||
          a.x - b.x ||
          a.title.localeCompare(b.title) ||
          a.id.localeCompare(b.id),
      )
      .map((node) => node.id)
      .join(',');
  }

  /**
   * Moves many nodes at once, which is what tidying the map into layers is.
   *
   * One call rather than one per node, and not only to save round trips. Every
   * `updateNode` re-runs `syncQuizzes`, and `x` is the order a layer quiz lists
   * its options in — so aligning a twenty-node map one request at a time would
   * rewrite the same quizzes twenty times, each on a half-moved map, and leave
   * whichever arrived last as the answer. Written together, the quizzes are
   * rebuilt once, from the map as it finally stands.
   *
   * Nodes named that do not belong to this course are dropped rather than
   * refused: the request is a picture of the canvas, and a node deleted by
   * somebody else while it was being dragged is not an error worth failing the
   * whole layout over.
   */
  static async setLayout(courseId: string, positions: Array<{ id: string; x: number; y: number }>) {
    await CourseMapService.assertStaged(courseId);
    const nodes = await CourseMapGateway.getNodes(courseId);
    const mine = new Map(nodes.map((node) => [node.id, node]));
    const wanted = positions.filter((at) => mine.has(at.id));

    await CurriculumGateway.runTransaction(async (db) => {
      for (const at of wanted) {
        await CourseMapGateway.updateNode(
          at.id,
          { x: Math.round(Number(at.x)), y: Math.round(Number(at.y)) },
          db,
        );
      }
    });

    // Tidying the canvas is not an edit to the course, for the reason set out on
    // `updateNode`. Aligning the layers usually does reorder something, since it
    // lays every column out afresh — but "usually" is not "always", and a map
    // that was already tidy should come back from this button unchanged in every
    // sense, including in whether it claims to need publishing.
    const moved = new Map(wanted.map((at) => [at.id, at]));
    const after = nodes.map((node) => ({ ...node, ...(moved.get(node.id) ?? {}) }));

    if (CourseMapService.readingOrder(nodes) !== CourseMapService.readingOrder(after)) {
      await CourseMapService.syncQuizzes(courseId);
    }

    return CourseMapService.getMap(courseId);
  }

  /**
   * Deletes a node, returning its sections to staging.
   *
   * Its children are not deleted with it — they are orphaned, and show on the
   * map as unconnected until the author gives them a new parent. That is the
   * honest outcome: the author removed one box, and quietly taking a whole
   * subtree of other people's work with it is not what they asked for.
   *
   * A node that belongs to a linked map is the exception, and deliberately so:
   * the linked map is one piece, so removing any of it unlinks all of it.
   */
  static async deleteNode(id: string) {
    const node = await CourseMapGateway.getNodeById(id);
    if (!node) throw new NotFoundError(`Node with ID ${id} not found`);
    if (node.isRoot) {
      throw new Error('the root node cannot be deleted — it is where every learner starts');
    }
    await CourseMapService.assertStaged(node.courseId);

    if (node.subgraphId) {
      await CourseMapGateway.deleteSubgraph(node.subgraphId);
      await CourseMapService.syncQuizzes(node.courseId);
      return { id };
    }

    await CourseMapGateway.deleteNode(id);
    await CourseMapService.syncQuizzes(node.courseId);
    return { id };
  }

  // ---- Connections ----

  /**
   * Draws a connection from one node to another.
   *
   * Refused in three cases, each of which would break something downstream: a
   * node cannot be its own parent, the root cannot be given one, and nothing may
   * close a loop — a cycle has no shallowest parent, so depth would not settle
   * and the learner's path would never end.
   */
  static async connect(parentId: string, childId: string) {
    const [parent, child] = await Promise.all([
      CourseMapGateway.getNodeById(parentId),
      CourseMapGateway.getNodeById(childId),
    ]);

    if (!parent) throw new NotFoundError(`Node with ID ${parentId} not found`);
    if (!child) throw new NotFoundError(`Node with ID ${childId} not found`);
    if (parent.courseId !== child.courseId) {
      throw new Error('those nodes are on different maps');
    }
    if (parentId === childId) throw new Error('a node cannot lead to itself');
    if (child.isRoot) {
      throw new Error('the root node cannot have a parent — it is where every learner starts');
    }
    await CourseMapService.assertStaged(parent.courseId);
    const edges = await CourseMapGateway.getEdges(parent.courseId);

    /*
      A linked map is one fixed piece, owned by the course it came from. This
      course may join it in two places only:

        into its root — the copy of the source's General content — which is how
        the linked map is reached at all;

        out of a node at the end of it, one the source's map does not lead on
        from, which is how this course carries on afterwards.

      Anything else would change the linked map's own shape, which only its own
      course may do.
    */
    if (child.subgraphId && !CourseMapService.isLinkedEntry(child, edges)) {
      throw new Error(
        `${child.title} is inside the map linked in from another course — only that map’s ` +
          'first node can be led into',
      );
    }
    if (parent.subgraphId && CourseMapService.leadsOnInLinkedMap(parent, edges)) {
      throw new Error(
        `${parent.title} already leads on within the map linked in from another course — ` +
          'only a node at the end of a linked map can lead on to this course’s own nodes',
      );
    }

    if (edges.some((edge) => edge.parentId === parentId && edge.childId === childId)) {
      return CourseMapService.getMap(parent.courseId);
    }
    if (CourseMapService.reaches(edges, childId, parentId)) {
      throw new Error('that would make a loop — the course would have no way out of it');
    }

    await CourseMapGateway.createEdge({ courseId: parent.courseId, parentId, childId });
    await CourseMapService.syncQuizzes(parent.courseId);
    return CourseMapService.getMap(parent.courseId);
  }

  /**
   * Removes the connection between two nodes. Connections a linked map drew are
   * fixed and refused; the source course owns them.
   */
  static async disconnect(parentId: string, childId: string) {
    const parent = await CourseMapGateway.getNodeById(parentId);
    if (!parent) throw new NotFoundError(`Node with ID ${parentId} not found`);
    await CourseMapService.assertStaged(parent.courseId);

    const edges = await CourseMapGateway.getEdges(parent.courseId);
    const edge = edges.find(
      (current) => current.parentId === parentId && current.childId === childId,
    );
    if (edge?.subgraphId) throw new Error(await CourseMapService.linkedMessage(edge.subgraphId));

    await CourseMapGateway.deleteEdge(parentId, childId);
    await CourseMapService.syncQuizzes(parent.courseId);
    return CourseMapService.getMap(parent.courseId);
  }

  /** Whether `to` is reachable from `from` by following connections downward. */
  static reaches(
    edges: Array<{ parentId: string; childId: string }>,
    from: string,
    to: string,
  ): boolean {
    const children = new Map<string, string[]>();
    for (const edge of edges) {
      children.set(edge.parentId, [...(children.get(edge.parentId) ?? []), edge.childId]);
    }

    const seen = new Set<string>();
    const queue = [from];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current === to) return true;
      if (seen.has(current)) continue;
      seen.add(current);
      queue.push(...(children.get(current) ?? []));
    }

    return false;
  }

  /**
   * How far each node is from the root, by the shortest route.
   *
   * A plain breadth-first walk, which is what makes "shallowest parent wins"
   * fall out rather than having to be enforced: the first time the walk arrives
   * at a node it has come the shortest way, so the depth it is given then is the
   * one it keeps.
   *
   * Nodes the walk never reaches are left out. They are on the canvas but not in
   * the course, and the publish gate is where that is reported.
   */
  static depths(
    nodes: Array<{ id: string; isRoot: boolean }>,
    edges: Array<{ parentId: string; childId: string }>,
  ): Map<string, number> {
    const children = new Map<string, string[]>();
    for (const edge of edges) {
      children.set(edge.parentId, [...(children.get(edge.parentId) ?? []), edge.childId]);
    }

    const depths = new Map<string, number>();
    const root = nodes.find((node) => node.isRoot);
    if (!root) return depths;

    const queue: Array<[string, number]> = [[root.id, 0]];
    while (queue.length > 0) {
      const [id, depth] = queue.shift()!;
      if (depths.has(id)) continue;
      depths.set(id, depth);
      for (const childId of children.get(id) ?? []) {
        if (!depths.has(childId)) queue.push([childId, depth + 1]);
      }
    }

    return depths;
  }

  // ---- Content ----

  /**
   * Replaces a node's content list.
   *
   * One call covers all three drags the editor offers, because they are the same
   * fact stated about one node: reordering inside it, dragging in from staging
   * or another node, and dragging back out to staging. A section arriving from
   * somewhere else is removed from wherever it was first, so nothing can sit in
   * two places and be read twice.
   */
  static async setNodeItems(nodeId: string, sectionIds: string[]) {
    const node = await CourseMapGateway.getNodeById(nodeId);
    if (!node) throw new NotFoundError(`Node with ID ${nodeId} not found`);
    await CourseMapService.assertStaged(node.courseId);
    if (node.subgraphId) throw new Error(await CourseMapService.linkedMessage(node.subgraphId));

    const wanted = [...new Set(sectionIds.map(String))];
    const wantedSet = new Set(wanted);

    /*
      What a linked map placed here stays here.

      Those placements belong to the source course's map, so they leave only when
      the link does. A list that drops one is refused rather than half-obeyed;
      one that merely reorders them is fine, since the order on this node is this
      course's to choose.
    */
    const locked = node.items.filter((item) => item.subgraphId !== null);
    const droppedLocked = locked.find((item) => !wantedSet.has(item.sectionId));
    if (droppedLocked) {
      throw new Error(await CourseMapService.linkedMessage(droppedLocked.subgraphId!));
    }
    const lockedHere = new Map(locked.map((item) => [item.sectionId, item]));

    // Nor may a section a linked map placed on some *other* node be pulled here.
    const elsewhere = await CourseMapService.lockedPlacements(node.courseId);
    const stolen = wanted.find((id) => !lockedHere.has(id) && elsewhere.has(id));
    if (stolen) throw new Error(await CourseMapService.linkedMessage(elsewhere.get(stolen)!));

    const allowed = await CourseMapService.placeableSections(node.courseId);
    const held = new Set(node.items.map((item) => item.sectionId));
    const mapped = await CourseMapService.mappedImports(node.courseId);

    /*
      A section arriving from a course that has its own map brings the whole map.

      Its sections are not placed one by one. Instead the source's map is linked
      in with this node standing in for its root — see `linkSubgraph` — which
      places every section that map holds, in the shape it holds them.
    */
    const linking = new Set<string>();
    const items: Array<{ sectionId: string; sourceCourseId: string; subgraphId?: string | null }> =
      [];

    for (const sectionId of wanted) {
      const kept = lockedHere.get(sectionId);
      if (kept) {
        items.push({ sectionId, sourceCourseId: kept.sourceCourseId, subgraphId: kept.subgraphId });
        continue;
      }

      const sourceCourseId = allowed.get(sectionId);
      if (!sourceCourseId) {
        throw new Error(
          'that content is not in this map’s staging — add its course to staging first',
        );
      }

      if (!held.has(sectionId) && mapped.has(sourceCourseId)) {
        linking.add(sourceCourseId);
        continue;
      }

      items.push({ sectionId, sourceCourseId });
    }

    await CurriculumGateway.runTransaction(async (db) => {
      for (const item of items) {
        if (item.subgraphId) continue;
        await CourseMapGateway.removeAuthoredSection(node.courseId, item.sectionId, db);
      }
      await CourseMapGateway.setItems(nodeId, items, db);
    });

    for (const sourceCourseId of linking) {
      await CourseMapService.linkSubgraph(node.courseId, nodeId, sourceCourseId);
    }

    await CourseMapService.autoName(node, items);
    await CourseMapService.syncQuizzes(node.courseId);
    return CourseMapService.getMap(node.courseId);
  }

  /** Sections a linked map has placed on this course's map, and which link placed each. */
  static async lockedPlacements(courseId: string): Promise<Map<string, string>> {
    const nodes = await CourseMapGateway.getNodes(courseId);
    return new Map(
      nodes
        .flatMap((node) => node.items)
        .filter((item) => item.subgraphId !== null)
        .map((item) => [item.sectionId, item.subgraphId!]),
    );
  }

  /** The refusal for touching a linked map, naming the course it belongs to. */
  static async linkedMessage(subgraphId: string): Promise<string> {
    const subgraph = await CourseMapGateway.getSubgraphById(subgraphId);
    const source = subgraph ? await CurriculumGateway.getCourseById(subgraph.sourceCourseId) : null;
    return linkedRefusal(source?.title ?? 'another course');
  }

  /**
   * Names a still-unnamed node after the module its first section came from.
   *
   * A node's name is not a label on a box: it becomes the text of the option the
   * layer quiz offers, so "New node" is a question put to the learner in the
   * author's own placeholder. The author has just said what belongs here by
   * dragging it in, and the module that content sits under is the best name
   * anybody has for the group at that moment — drag two sections of "Bee
   * keeping" onto a node and the node is what the course calls bee keeping.
   *
   * Only ever while the node is still called `DEFAULT_NODE_TITLE`. A name the
   * author typed is a decision, and adding a third section to a node must not
   * quietly rename it back to whatever module that section happened to be in.
   * The root is exempt for the same reason it cannot be renamed at all: it is
   * where every learner starts, and it offers no option to label.
   */
  static async autoName(
    node: { id: string; courseId: string; title: string; isRoot: boolean },
    items: Array<{ sectionId: string; sourceCourseId: string }>,
  ) {
    if (node.isRoot || node.title !== DEFAULT_NODE_TITLE || items.length === 0) return;

    const first = items[0];
    const source = await CurriculumGateway.getCourseById(first.sourceCourseId);
    const section = source?.sections.find((current) => current.id === first.sectionId);
    if (!section) return;

    // The module the section sits under, or the section's own name when it sits
    // under none — a section with no module is loose content, and its own title
    // is then the only description of it there is.
    const module = source?.modules.find((current) => current.id === section.moduleId);
    const name = (module?.title ?? section.title).trim();
    if (!name || name === node.title) return;

    await CourseMapGateway.updateNode(node.id, { title: name });
  }

  /** Every section this map may place, and which course each came from. */
  static async placeableSections(courseId: string): Promise<Map<string, string>> {
    const imports = await CourseMapGateway.getImports(courseId);
    const ids = [courseId, ...imports.map((entry) => entry.sourceCourseId)];
    const courses = await Promise.all(ids.map((id) => CurriculumGateway.getCourseById(id)));

    const allowed = new Map<string, string>();
    for (const course of courses) {
      if (!course) continue;
      for (const section of course.sections) {
        if (!CourseMapService.isPlaceableSection(section)) continue;
        allowed.set(section.id, course.id);
      }
    }

    return allowed;
  }

  // ---- Imported courses ----

  /**
   * Courses this person could add to staging: the ones they made or were named
   * on, minus this one and minus what is already there.
   *
   * The same rule that decides what appears on their Create a Lesson page, and
   * for the same reason — importing a course puts its sections in front of
   * somebody who is about to place them, which is a form of reading it.
   */
  static async availableCourses(courseId: string, userId: number, isGlobalAuthor: CourseReach) {
    const [editable, imports] = await Promise.all([
      CurriculumGateway.getCoursesForAuthor(userId, isGlobalAuthor),
      CourseMapGateway.getImports(courseId),
    ]);

    const taken = new Set([courseId, ...imports.map((entry) => entry.sourceCourseId)]);

    /*
      Quiz sets are offered as well as lessons.

      A quiz set stores one section per quiz, so its sections are exactly the
      right shape to place: dragging one onto a node puts that exam into the
      branch, and a learner who picks that branch sits it where it sits on the
      map. That is worth having — a compliance course that branches into three
      trades wants the trade's own assessment at the end of its branch, and
      before this the only way was to rewrite the exam inside the lesson.

      What is still refused is the one-time link, and that is refused per section
      rather than per course — see `isPlaceableSection`. A set whose only quiz is
      a one-time link therefore appears here with a count of nothing, which is
      the honest answer: the course can be added, and there is nothing in it this
      map may take.
    */
    return editable
      .filter((course) => !taken.has(course.id))
      .map((course) => ({
        id: course.id,
        title: course.title,
        kind: course.kind,
        shortDescription: course.shortDescription,
        sectionCount: course.sections.filter((section) =>
          CourseMapService.isPlaceableSection(section),
        ).length,
      }));
  }

  static async addImport(
    courseId: string,
    sourceCourseId: string,
    userId: number,
    isGlobalAuthor: CourseReach,
  ) {
    if (sourceCourseId === courseId) {
      throw new Error('this course is already in staging — its content is the first group');
    }

    // Checked here rather than trusted from the list: the list is a convenience,
    // and this is the door.
    if (!(await CurriculumGateway.canEditCourse(userId, sourceCourseId, isGlobalAuthor))) {
      throw new NotFoundError(`Course with ID ${sourceCourseId} not found`);
    }

    await CourseMapGateway.addImport(courseId, sourceCourseId);
    return CourseMapService.getMap(courseId);
  }

  /**
   * Drops an imported course, and anything of its that was placed.
   *
   * Leaving the placements behind would keep serving sections from a course this
   * map no longer claims any relationship with, which is worse than the author
   * having to place them again.
   */
  static async removeImport(courseId: string, sourceCourseId: string) {
    await CourseMapService.assertStaged(courseId);
    // A linked map from this course goes with it, nodes and all.
    await CourseMapGateway.deleteSubgraphsFromSource(courseId, sourceCourseId);

    const nodes = await CourseMapGateway.getNodes(courseId);
    const orphaned = nodes.flatMap((node) =>
      node.items.filter((item) => item.sourceCourseId === sourceCourseId),
    );

    await CurriculumGateway.runTransaction(async (db) => {
      for (const item of orphaned) {
        await CourseMapGateway.removeSection(courseId, item.sectionId, db);
      }
      await CourseMapGateway.removeImport(courseId, sourceCourseId, db);
    });

    await CourseMapService.syncQuizzes(courseId);
    return CourseMapService.getMap(courseId);
  }

  // ---- Linked maps ----

  /** Whether a course has a map worth linking: a root, and something on it. */
  static async hasMap(courseId: string): Promise<boolean> {
    const nodes = await CourseMapGateway.getNodes(courseId);
    return nodes.some((node) => node.isRoot) && nodes.some((node) => node.items.length > 0);
  }

  /** The imported courses on this map's staging that have maps of their own. */
  static async mappedImports(courseId: string): Promise<Set<string>> {
    const imports = await CourseMapGateway.getImports(courseId);
    const mapped = await Promise.all(
      imports.map(async (entry) =>
        (await CourseMapService.hasMap(entry.sourceCourseId)) ? entry.sourceCourseId : null,
      ),
    );
    return new Set(mapped.filter((id): id is string => id !== null));
  }

  /**
   * Whether linking `sourceCourseId` into `courseId` would close a loop — the
   * source already carrying this course's map, directly or through others.
   * Left alone, each course would keep rewriting the other for ever.
   */
  static async linksBack(courseId: string, sourceCourseId: string): Promise<boolean> {
    const seen = new Set<string>();
    const queue = [sourceCourseId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current === courseId) return true;
      if (seen.has(current)) continue;
      seen.add(current);
      const links = await CourseMapGateway.getSubgraphs(current);
      queue.push(...links.map((link) => link.sourceCourseId));
    }
    return false;
  }

  /**
   * Whether a node is the copy of a linked map's root — the one node of it that
   * nothing inside the linked map leads into.
   */
  static isLinkedEntry(
    node: { id: string; subgraphId: string | null },
    edges: Array<{ childId: string; subgraphId: string | null }>,
  ): boolean {
    if (!node.subgraphId) return false;
    return !edges.some((edge) => edge.childId === node.id && edge.subgraphId === node.subgraphId);
  }

  /** Whether a linked node leads on to anything within its own linked map. */
  static leadsOnInLinkedMap(
    node: { id: string; subgraphId: string | null },
    edges: Array<{ parentId: string; subgraphId: string | null }>,
  ): boolean {
    if (!node.subgraphId) return false;
    return edges.some((edge) => edge.parentId === node.id && edge.subgraphId === node.subgraphId);
  }

  /**
   * Links another course's whole map into this one, joined on after the node it
   * was dropped on.
   *
   * Every source node is copied in, its root included, and connected exactly as
   * it is in the source — see `syncSubgraph`, which also draws the one
   * connection from the drop target into the copy's root. That connection is
   * this course's own and can be cut and redrawn like any other.
   */
  static async linkSubgraph(courseId: string, anchorNodeId: string, sourceCourseId: string) {
    const existing = await CourseMapGateway.getSubgraphs(courseId);
    if (existing.some((subgraph) => subgraph.sourceCourseId === sourceCourseId)) {
      throw new Error('that course’s map is already linked into this one');
    }
    if (await CourseMapService.linksBack(courseId, sourceCourseId)) {
      throw new Error(
        'that course already includes this one’s map, so it cannot be linked back in',
      );
    }

    const subgraph = await CourseMapGateway.createSubgraph({
      courseId,
      sourceCourseId,
      anchorNodeId,
    });
    await CourseMapService.syncSubgraph(subgraph.id);
  }

  /**
   * Rewrites one linked map from its source, so the two courses agree again.
   *
   * Nodes are matched to their source by `sourceNodeId` and updated in place
   * rather than recreated: a learner's choices are stored against node ids, and
   * an author upstream renaming a box must not wipe everybody's path here. A new
   * node is placed where it sits relative to the source's root, offset from
   * where that root's copy sits here; one that already exists keeps wherever it
   * was moved to on this canvas.
   *
   * ─────────────────────────────────────────────────────────────────────────────
   * WHAT IS CUT WHEN THE SOURCE CHANGES
   * ─────────────────────────────────────────────────────────────────────────────
   *
   * The red connections — the source's own — are never cut here; they are
   * rewritten to match the source exactly. What can be cut is this course's
   * own connections to the linked map, and only where the source has made them
   * break the rules `connect` enforces:
   *
   *   one leading out of a linked node that the source now leads on from — the
   *   end of the linked map has moved, so carrying on from there would join one
   *   of the source's own layers. Whatever this course hung there is left as a
   *   piece of its own, for the author to reconnect;
   *
   *   one leading into a linked node that is no longer the linked map's root.
   *
   * Connections into the root's copy are never cut: the root never changes.
   */
  static async syncSubgraph(subgraphId: string) {
    const subgraph = await CourseMapGateway.getSubgraphById(subgraphId);
    if (!subgraph) return;

    const [sourceNodes, sourceEdges, targetNodes, targetEdges, sourceCourse] = await Promise.all([
      CourseMapGateway.getNodes(subgraph.sourceCourseId),
      CourseMapGateway.getEdges(subgraph.sourceCourseId),
      CourseMapGateway.getNodes(subgraph.courseId),
      CourseMapGateway.getEdges(subgraph.courseId),
      CurriculumGateway.getCourseById(subgraph.sourceCourseId),
    ]);

    const sourceRoot = sourceNodes.find((node) => node.isRoot);
    if (!sourceRoot) {
      // Nothing left to link: the source no longer has a map.
      await CourseMapGateway.deleteSubgraph(subgraph.id);
      return;
    }

    const anchor = subgraph.anchorNodeId
      ? (targetNodes.find((node) => node.id === subgraph.anchorNodeId) ?? null)
      : null;
    const mirrors = new Map(
      targetNodes
        .filter((node) => node.subgraphId === subgraph.id && node.sourceNodeId)
        .map((node) => [node.sourceNodeId!, node]),
    );

    // Where the root's copy sits, which everything new is placed relative to: as
    // it is, or a column to the right of the node the map was dropped on.
    const rootMirror = mirrors.get(sourceRoot.id);
    const origin = rootMirror
      ? { x: rootMirror.x, y: rootMirror.y }
      : anchor
        ? { x: anchor.x + ROOT_TO_LINK.x, y: anchor.y }
        : { x: sourceRoot.x, y: sourceRoot.y };

    /*
      A section can only sit in one place on a map. Anything the author placed
      themselves that the linked map now wants is taken off where they put it —
      the link is the one that cannot be rearranged.
    */
    const linkedSections = new Set(
      sourceNodes.flatMap((node) => node.items.map((item) => item.sectionId)),
    );

    await CourseMapGateway.runTransaction(async (db) => {
      for (const sectionId of linkedSections) {
        await CourseMapGateway.removeAuthoredSection(subgraph.courseId, sectionId, db);
      }

      // Made before the root was copied in, the root's content sat on the node
      // the map was dropped on. It moves to the root's own copy now.
      if (anchor) {
        await CourseMapGateway.setItems(
          anchor.id,
          anchor.items
            .filter((item) => item.subgraphId !== subgraph.id)
            .map((item) => ({
              sectionId: item.sectionId,
              sourceCourseId: item.sourceCourseId,
              subgraphId: item.subgraphId,
            })),
          db,
        );
      }

      /** Source node id → its copy on this map. */
      const copyOf = new Map<string, string>();

      for (const source of sourceNodes) {
        const title = source.isRoot
          ? `${sourceCourse?.title ?? 'Linked course'}: ${source.title}`
          : source.title;
        const mirror = mirrors.get(source.id);
        const node = mirror
          ? await CourseMapGateway.updateNode(mirror.id, { title }, db)
          : await CourseMapGateway.createNode(
              {
                courseId: subgraph.courseId,
                title,
                x: origin.x + (source.x - sourceRoot.x),
                y: origin.y + (source.y - sourceRoot.y),
                subgraphId: subgraph.id,
                sourceNodeId: source.id,
              },
              db,
            );
        copyOf.set(source.id, node.id);

        await CourseMapGateway.setItems(
          node.id,
          source.items.map((item) => ({
            sectionId: item.sectionId,
            sourceCourseId: item.sourceCourseId,
            subgraphId: subgraph.id,
          })),
          db,
        );
      }

      // Nodes the source no longer has. Every connection to them goes with them,
      // through the cascade — so those are left out of everything below.
      const removed = new Set<string>();
      for (const [sourceNodeId, mirror] of mirrors) {
        if (!sourceNodes.some((node) => node.id === sourceNodeId)) {
          await CourseMapGateway.deleteNode(mirror.id, db);
          removed.add(mirror.id);
        }
      }

      // The red connections: exactly the source's, between the copies.
      const wanted = new Set(
        sourceEdges
          .filter((edge) => copyOf.has(edge.parentId) && copyOf.has(edge.childId))
          .map((edge) => `${copyOf.get(edge.parentId)}->${copyOf.get(edge.childId)}`),
      );
      const live = targetEdges.filter(
        (edge) => !removed.has(edge.parentId) && !removed.has(edge.childId),
      );
      for (const edge of live.filter((current) => current.subgraphId === subgraph.id)) {
        if (!wanted.has(`${edge.parentId}->${edge.childId}`)) {
          await CourseMapGateway.deleteEdgeById(edge.id, db);
        }
      }
      const present = new Set(
        live
          .filter((edge) => edge.subgraphId === subgraph.id)
          .map((edge) => `${edge.parentId}->${edge.childId}`),
      );
      for (const key of wanted) {
        if (present.has(key)) continue;
        const [parentId, childId] = key.split('->');
        // A connection of this course's own between the same two nodes cannot
        // exist — nothing may lead into a non-root copy — but if one somehow
        // does, the red one replaces it.
        await CourseMapGateway.deleteEdge(parentId, childId, db);
        await CourseMapGateway.createEdge(
          { courseId: subgraph.courseId, parentId, childId, subgraphId: subgraph.id },
          db,
        );
      }

      // This course's own connections that the new shape no longer allows.
      const copies = new Set(copyOf.values());
      const rootCopy = copyOf.get(sourceRoot.id)!;
      const leadsOn = new Set([...wanted].map((key) => key.split('->')[0]));
      for (const edge of live.filter((current) => current.subgraphId === null)) {
        const outOfMiddle = copies.has(edge.parentId) && leadsOn.has(edge.parentId);
        const intoMiddle = copies.has(edge.childId) && edge.childId !== rootCopy;
        if (outOfMiddle || intoMiddle) await CourseMapGateway.deleteEdgeById(edge.id, db);
      }

      // The node it was dropped on leads into the root's copy, once. After that
      // the connection is the author's own, to keep or cut like any other.
      if (anchor) {
        const already = targetEdges.some(
          (edge) => edge.parentId === anchor.id && edge.childId === rootCopy,
        );
        if (!already) {
          await CourseMapGateway.createEdge(
            { courseId: subgraph.courseId, parentId: anchor.id, childId: rootCopy },
            db,
          );
        }
        await CourseMapGateway.clearSubgraphAnchor(subgraph.id, db);
      }
    });
  }

  /**
   * Carries a change to this course's map into every course it is linked into,
   * and on outward from those.
   *
   * Their copies are rewritten straight away — the author there does not have
   * to do anything — but nothing reaches their learners until they publish
   * again, because learners read the published snapshot.
   *
   * `visited` is what stops it going round: `linkSubgraph` refuses a loop, but a
   * propagation that could not end would be the worst way to find one it missed.
   */
  static async propagate(courseId: string, visited: Set<string>) {
    visited.add(courseId);
    const links = await CourseMapGateway.getSubgraphsFromSource(courseId);

    for (const link of links ?? []) {
      if (visited.has(link.courseId)) continue;
      await CourseMapService.syncSubgraph(link.id);
      await CourseMapService.syncQuizzes(link.courseId, visited);
    }
  }

  // ---- The generated quizzes ----

  /**
   * Brings the layer quizzes back in line with the map.
   *
   * One quiz per depth rather than one per parent: everything the same number of
   * jumps from the root is asked about in a single question, so a learner on
   * three branches answers once at each level instead of three times.
   *
   * An option is minted per *connection*, not per node. A node hanging off two
   * parents is genuinely offered twice — once under each — and ticking either
   * brings it in, which is what makes shared training shared rather than
   * duplicated.
   *
   * Runs after every change to the map as well as at staging. Regenerating only
   * on stage would leave the map inert until the author pressed a button they
   * had no reason to think was involved, which is a trap rather than a workflow.
   */
  static async syncQuizzes(courseId: string, visited: Set<string> = new Set()) {
    const course = await CurriculumGateway.getCourseById(courseId);
    // Off, the map cannot be edited, so there is nothing new to carry outward.
    if (!course || !course.directedLearning) return;

    const [nodes, edges, layers] = await Promise.all([
      CourseMapGateway.getNodes(courseId),
      CourseMapGateway.getEdges(courseId),
      CourseMapGateway.getLayers(courseId),
    ]);

    const depths = CourseMapService.depths(nodes, edges);
    await CourseMapGateway.setDepths(depths);
    await CourseMapGateway.pruneChoices(courseId, [...depths.keys()]);

    const byId = new Map(nodes.map((node) => [node.id, node]));

    /*
      Only a real fork asks a question.

      A node with one way out leads its learners straight on — there is nothing to
      choose, so no option is minted for it and its child simply follows, the
      same way the root's content does. See `isChoiceEdge` in directed-path.ts,
      which applies the same rule on the learner's side. A layer with no fork
      in it at all has no quiz.
    */
    const choice = choiceEdgeIds(edges);

    // Connections that no longer offer anything let go of their option, so a
    // stale id cannot be mistaken for a live route.
    await Promise.all(
      edges
        .filter((edge) => !choice.has(edge.id) && edge.optionId !== null)
        .map((edge) => CourseMapGateway.setEdgeOption(edge.id, null)),
    );

    /** Depth → the connections that offer a node at that depth, in reading order. */
    const routes = new Map<
      number,
      Array<{ edge: (typeof edges)[number]; child: (typeof nodes)[number] }>
    >();

    for (const edge of edges) {
      const child = byId.get(edge.childId);
      const parentDepth = depths.get(edge.parentId);
      const childDepth = depths.get(edge.childId);
      // Only routes the walk actually took. An edge into an unreachable node
      // offers nothing, and an edge from one is offered by nobody.
      if (!child || parentDepth === undefined || childDepth === undefined) continue;
      if (!choice.has(edge.id)) continue;
      routes.set(childDepth, [...(routes.get(childDepth) ?? []), { edge, child }]);
    }

    const live = new Set<number>();

    for (const [depth, entries] of [...routes].sort(([a], [b]) => a - b)) {
      live.add(depth);
      const ordered = [...entries].sort(
        (a, b) =>
          a.child.x - b.child.x ||
          a.child.title.localeCompare(b.child.title) ||
          a.child.id.localeCompare(b.child.id),
      );

      // Named by the parent only when the layer has more than one, because at
      // depth 1 every route comes from the root and "General content › Bee
      // keeping" says nothing the learner did not already know.
      const parents = new Set(ordered.map((entry) => entry.edge.parentId));
      const options = ordered.map((entry) => ({
        edgeId: entry.edge.id,
        text:
          parents.size > 1
            ? `${byId.get(entry.edge.parentId)?.title ?? ''} › ${entry.child.title}`
            : entry.child.title,
      }));

      await CourseMapService.writeLayer(
        courseId,
        depth,
        options,
        layers,
        new Map(edges.map((edge) => [edge.id, edge.optionId])),
      );
    }

    // Layers the map no longer has. Their module and section go with the quiz,
    // so a depth that has been flattened away leaves nothing behind in the
    // Modules tab.
    for (const layer of layers.filter((current) => !live.has(current.depth))) {
      await CourseMapGateway.deleteLayer(layer.id);
      await QuizGateway.hardDeleteQuiz(layer.quizId);
      await CurriculumGateway.hardDeleteModule(layer.moduleId);
    }

    await CurriculumGateway.touchDraft(courseId);
    await CourseMapService.propagate(courseId, visited);
  }

  /**
   * Writes one layer's quiz, reusing whatever is already there.
   *
   * Reuse matters more than it looks. The quiz id is what a learner's attempt is
   * recorded against and what the module is known by, so recreating it on every
   * rename would throw away everyone's history to change a word.
   */
  static async writeLayer(
    courseId: string,
    depth: number,
    options: Array<{ edgeId: string; text: string }>,
    layers: Array<{ id: string; depth: number; quizId: string; moduleId: string }>,
    /** What each connection currently points at, so an unchanged layer is left alone. */
    edgeOptionIds: Map<string, string | null>,
  ) {
    const title = `Directed learning quiz ${depth}`;
    const existing = layers.find((layer) => layer.depth === depth);

    const quizId = existing
      ? existing.quizId
      : await CourseMapService.mintLayer(courseId, depth, title);

    const quiz = await QuizGateway.getQuizById(quizId);
    if (!quiz) return;

    // One question, rewritten in place rather than replaced, for the same reason
    // the quiz is: its id is what an attempt names.
    const question = quiz.questions[0];

    /*
      Nothing to do when the quiz already says this.

      Worth checking rather than rewriting blindly, because rewriting a question
      replaces its options and so mints new option ids — and this runs on every
      change to the map, a node being dragged an inch included. Those ids travel
      into the published snapshot, so churning them would make every version
      differ from the last on ids alone, and the editor would report unpublished
      changes for ever on a course nobody had touched.

      Both halves are compared: the text, and which connection each option is
      already pointed at. Text alone is not enough — two nodes swapping names
      leaves the list identical and the routes crossed.

      The prompt is not compared, and nor is the title: both are the author's to
      word once the layer exists, and the map only ever writes them at birth.
    */
    const settled =
      question !== undefined &&
      question.options.length === options.length &&
      options.every(
        (option, index) =>
          question.options[index]?.text === option.text &&
          edgeOptionIds.get(option.edgeId) === question.options[index]?.id,
      );

    if (settled) return;

    const written = question
      ? await QuizGateway.updateQuestion(question.id, {
          // The prompt and hint are left as the author worded them; only the
          // options belong to the map.
          //
          // Nothing here is right or wrong — the answer is a fact about the
          // learner, not a thing to be marked — so every option is `false` and
          // the mark is discarded at submission.
          options: options.map((option) => ({ text: option.text, isCorrect: false })),
        })
      : await QuizGateway.runTransaction((db) =>
          QuizGateway.createQuestion(
            quizId,
            { prompt: LAYER_PROMPT },
            1,
            options.map((option) => ({ text: option.text, isCorrect: false })),
            db,
          ),
        );

    // Point each connection back at the option that now offers it. Written after
    // the options exist, and by position, because the options were just created
    // in exactly the order the routes were given in.
    await Promise.all(
      options.map((option, index) =>
        written.options[index]
          ? CourseMapGateway.setEdgeOption(option.edgeId, written.options[index].id)
          : Promise.resolve(),
      ),
    );
  }

  /**
   * Mints the module, section and quiz for a layer that does not have one yet.
   *
   * The module is a real module in the course, appended at the end, so the quiz
   * shows up in the Modules tab exactly where the author would look for it. It
   * is written by the map, though, so the structure editor renders it read-only
   * — see `isLayerSection`.
   */
  static async mintLayer(courseId: string, depth: number, title: string): Promise<string> {
    // One past the highest in use rather than one past the count. The two agree
    // while a course's numbering is dense and part company the moment it is not,
    // and the unique index on (courseId, number) turns that disagreement into a
    // refused insert rather than a wrong number.
    const number = (await CurriculumGateway.getHighestModuleNumber(courseId)) + 1;

    const module = await CurriculumGateway.createModule({ courseId, number, title });

    const section = await CurriculumGateway.createSection({
      courseId,
      moduleId: module.id,
      position: 1,
      // Safe by construction: the module is brand new, so nothing else in this
      // course can already be numbered inside it.
      number: `${number}.1`,
      sortKey: `${String(number).padStart(6, '0')}.000001`,
      title,
      estimatedMinutes: 0,
    });

    const quiz = await QuizGateway.createQuiz({
      title,
      description: 'Pick the training that applies to you. You can change this at any time.',
      type: QuizType.DIRECTED,
      sectionId: section.id,
      order: 1,
      published: true,
      // Never timed: this is not a test, and putting a clock on "what do you do
      // here" would be a strange kind of pressure.
      timeLimitMinutes: null,
    });

    const layer = await CourseMapGateway.createLayer({
      courseId,
      depth,
      quizId: quiz.id,
      moduleId: module.id,
    });

    return layer.quizId;
  }

  /** Removes every generated quiz, used when directed learning is switched off. */
  static async clearLayers(courseId: string) {
    const layers = await CourseMapGateway.getLayers(courseId);

    for (const layer of layers) {
      await CourseMapGateway.deleteLayer(layer.id);
      await QuizGateway.hardDeleteQuiz(layer.quizId);
      await CurriculumGateway.hardDeleteModule(layer.moduleId);
    }
  }

  // ---- Publishing ----

  /**
   * Refuses the publish while any of this course's own sections is off the map.
   *
   * A directed course is delivered by the map and nothing else, so an unmapped
   * section is not merely unordered — it is content no learner can ever be given.
   * Publishing anyway would quietly drop it, which is the kind of silence that
   * is found out months later.
   *
   * Imported sections are exempt by design: pulling in a four-section course to
   * use three of it is the point of importing.
   */
  static async assertMappable(courseId: string) {
    const course = await CurriculumGateway.getCourseById(courseId);
    if (!course || !course.directedLearning) return;

    const root = await CourseMapGateway.getRoot(courseId);
    if (!root) throw new Error('this course has no map yet — stage it to the map first');

    const [nodes, edges] = await Promise.all([
      CourseMapGateway.getNodes(courseId),
      CourseMapGateway.getEdges(courseId),
    ]);

    /*
      An empty root collapses the entire course, not just the root.

      `groupsFor` in directed-path.ts emits a layer's quiz only when the depth
      above it had content — `previousHadContent`, which for depth 1 is "does the
      root hold any section". So a root with an empty section list means no group
      is emitted for the depth-1 layer quiz, and `projectDirectedCourse` drops the
      empty root group as well (`placed.length === 0`).

      The knock-on is total rather than local. The depth-1 quiz is the only thing
      that records a choice at depth 1, and `visibleNodeIds` admits a node only
      when it was ticked at its own depth *and* one of its parents is already
      visible. With no depth-1 quiz to answer, no depth-1 node is ever visible; no
      depth-1 node visible means depth 2 has no visible parent to hang off, and so
      on down. The learner's projection comes back as a course with no modules and
      no sections at all.

      It is refused here rather than rendered, because the failure is silent: the
      author publishes a map they can see perfectly well on the canvas, and every
      learner is handed an empty course.
    */
    const rootNode = nodes.find((node) => node.isRoot);
    if (rootNode && rootNode.items.length === 0) {
      throw new Error(`${ROOT_TITLE} needs an element to publish`);
    }

    const placed = await CourseMapGateway.placedSectionIds(courseId);
    const missing = course.sections
      .filter((section) => CourseMapService.isPlaceableSection(section))
      .filter((section) => !placed.has(section.id));

    if (missing.length > 0) {
      const named = missing
        .slice(0, 5)
        .map((section) => `${section.number} ${section.title}`)
        .join(', ');
      throw new Error(
        `every section has to be on the map before this course can go out — still unmapped: ` +
          `${named}${missing.length > 5 ? ` and ${missing.length - 5} more` : ''}`,
      );
    }

    /*
      Every node has to have a route back to the root, empty ones included.

      This used to ask only about nodes holding content, on the reasoning that an
      empty unreachable node serves nothing and so breaks nothing. That was true
      of the node itself and wrong about the map: a node is a branch point, and
      anything hanging *below* an unreachable one is unreachable too, however
      full it is. An author who connects a subtree to the wrong box has drawn a
      map that looks complete and delivers none of that subtree, and the old rule
      let it through as long as the one box they got wrong happened to be empty.

      Asked of `depths`, which is a breadth-first walk out from the root — so
      "has a route to the root" and "the walk reached it" are the same question,
      and the answer agrees by construction with the depth every layer quiz is
      built from.
    */
    const depths = CourseMapService.depths(nodes, edges);
    const stranded = nodes.filter((node) => !depths.has(node.id));

    if (stranded.length > 0) throw new Error('some nodes are not linked properly');
  }

  // ---- Snapshots and learners ----

  /**
   * The map as it goes into a published version.
   *
   * Frozen with the course for the same reason everything else is: a learner
   * part way through must not have their path redrawn under them because an
   * author moved a box this morning.
   */
  static async buildSnapshotMap(courseId: string): Promise<SnapshotMap | null> {
    const course = await CurriculumGateway.getCourseById(courseId);
    if (!course || !course.directedLearning) return null;

    const [nodes, edges, layers] = await Promise.all([
      CourseMapGateway.getNodes(courseId),
      CourseMapGateway.getEdges(courseId),
      CourseMapGateway.getLayers(courseId),
    ]);

    const quizzes = await Promise.all(
      layers.map(async (layer) => ({ layer, quiz: await QuizGateway.getQuizById(layer.quizId) })),
    );

    return {
      nodes: nodes.map((node): SnapshotMapNode => ({
        id: node.id,
        title: node.title,
        x: node.x,
        y: node.y,
        depth: node.depth,
        isRoot: node.isRoot,
        sectionIds: node.items.map((item) => item.sectionId),
      })),
      // `optionId` travels with the edge so a learner's copy of a layer quiz can
      // be narrowed to the routes they can actually reach — see
      // `narrowToReachable` in directed-path.ts.
      edges: edges.map((edge) => ({
        parentId: edge.parentId,
        childId: edge.childId,
        optionId: edge.optionId,
      })),
      layers: quizzes
        .filter((entry) => entry.quiz?.sectionId)
        .map(({ layer, quiz }): SnapshotMapLayer => ({
          depth: layer.depth,
          quizId: layer.quizId,
          moduleId: layer.moduleId,
          sectionId: quiz!.sectionId!,
        })),
    };
  }

  /**
   * The course as the map would deliver it, for somebody who has ticked this.
   *
   * The authoring preview's answer to "what does my map actually do". It runs
   * the same `projectDirectedCourse` the learner endpoint runs — the whole point
   * of that function living on its own with no imports — over the live authoring
   * rows rather than over a published snapshot, because the author is checking
   * what they have just drawn and has not published it yet.
   *
   * `optionNodes` is what makes the preview interactive rather than a static
   * picture. The generated layer quizzes are real quizzes with real options, but
   * nothing is submitted in a preview, so the browser has to turn the options an
   * author ticked into the node ids a choice is made of. That translation is a
   * fact about the map — an option belongs to a connection, and a connection
   * names a child — so it is answered here rather than guessed at in the editor.
   *
   * Nothing is written. A preview that recorded choices would put the author on
   * their own course.
   */
  static async previewFor(courseId: string, byDepth: Map<number, string[]>) {
    const course = await CurriculumGateway.getCourseById(courseId);
    if (!course) throw new NotFoundError(`Course with ID ${courseId} not found`);
    const nothingToProject = { course, locks: [], optionNodes: [], quizDepths: [] };
    if (!course.directedLearning) return nothingToProject;

    const map = await CourseMapService.buildSnapshotMap(courseId);
    if (!map) return nothingToProject;

    // Everything the map places, not only what this course wrote — see
    // `deliveredSections`. Without this the preview quietly loses every node
    // built out of staged content.
    const delivered = { ...course, sections: await CourseMapService.deliveredSections(course) };

    const [edges, layers] = await Promise.all([
      CourseMapGateway.getEdges(courseId),
      CourseMapGateway.getLayers(courseId),
    ]);
    const depthByQuiz = new Map(layers.map((layer) => [layer.quizId, layer.depth]));
    const depthOfNode = new Map(map.nodes.map((node) => [node.id, node.depth]));

    const projected = projectDirectedCourse(delivered, map, { byDepth });

    return {
      course: projected.course,
      locks: projected.locks,
      optionNodes: edges
        .filter((edge) => edge.optionId !== null)
        .map((edge) => ({
          optionId: edge.optionId!,
          nodeId: edge.childId,
          // The depth a tick at this option is recorded against is the child's,
          // not the parent's: a node offered by two parents has two options and
          // either one means the same thing about the same layer.
          depth: depthOfNode.get(edge.childId) ?? 0,
        })),
      /** Which layer each generated quiz belongs to, so a submission knows its depth. */
      quizDepths: [...depthByQuiz].map(([quizId, depth]) => ({ quizId, depth })),
    };
  }

  /**
   * Every section this course delivers: the ones it wrote, and the ones its map
   * borrows from other courses.
   *
   * Stated once because two places have to agree about it, and for a while did
   * not. `buildSnapshot` appended the borrowed ones so a learner was actually
   * served them; the authoring preview projected the course exactly as
   * `getCourseById` returned it, which is this course's own sections and nothing
   * else. `projectDirectedCourse` then could not find the borrowed ids, treated
   * the node holding them as empty, and dropped it — so a branch built out of
   * staged content was missing from the one screen whose whole job is to show
   * the author what a learner gets.
   */
  static async deliveredSections(course: AuthoredCourse): Promise<AuthoredCourse['sections']> {
    // Only a directed course has a map to borrow through, and asking anyway
    // would cost a query per read of every ordinary course.
    if (!course.directedLearning) return course.sections;

    const borrowed = await CourseMapService.borrowedSections(course.id);
    return [...course.sections, ...borrowed];
  }

  /**
   * The sections this map places that belong to somebody else's course.
   *
   * Returned whole — elements, quizzes and all — because they are going into
   * this course's published snapshot, and a learner handed this course has to be
   * able to read them there. Before this they were placed on the map, drawn in
   * the editor, and then silently dropped at publication: `buildSnapshot` copies
   * `course.sections`, an imported section is not one of those, and
   * `projectDirectedCourse` skips a node whose sections it cannot find. The map
   * said the branch was there and the learner was given an empty one.
   *
   * Read from the source course's own rows rather than from its snapshot, so
   * borrowing works whether or not the lender has ever been published: this
   * course is what is being published, and what goes out is what its map places
   * at that moment.
   */
  static async borrowedSections(courseId: string) {
    const nodes = await CourseMapGateway.getNodes(courseId);
    const foreign = nodes
      .flatMap((node) => node.items)
      .filter((item) => item.sourceCourseId !== courseId);

    if (foreign.length === 0) return [];

    const wanted = new Set(foreign.map((item) => item.sectionId));
    const sources = await Promise.all(
      [...new Set(foreign.map((item) => item.sourceCourseId))].map((id) =>
        CurriculumGateway.getCourseById(id),
      ),
    );

    return sources
      .filter((source): source is NonNullable<typeof source> => source !== null)
      .flatMap((source) => source.sections.filter((section) => wanted.has(section.id)));
  }

  /**
   * A published course narrowed to the branches one learner picked.
   *
   * ─────────────────────────────────────────────────────────────────────────────
   * EVERY READ OF A DIRECTED COURSE *FOR A PERSON* HAS TO COME THROUGH HERE
   * ─────────────────────────────────────────────────────────────────────────────
   *
   * This was written once, privately, inside the two endpoints that serve a
   * learner their course — and every other place that measures a course against
   * a person went on counting the whole map. The learner's own Learning tab was
   * therefore right while their dashboard, their progress ring, the admin's
   * roster and the insights page were all measuring them against branches they
   * had never been offered and could never open.
   *
   * It is not a rounding error. Somebody on one of four branches finishes
   * everything they will ever be shown and the dashboard calls it 40%, so the
   * course stays outstanding for ever and `CourseCompletion` — which is stamped
   * at 100% and nowhere else — is never written at all.
   *
   * Nothing is stored and nothing is cached: the answer depends on this person's
   * choices, so it is asked per person, per read.
   */
  static async forLearner<
    T extends ProjectableCourse & { directedLearning?: boolean; map?: SnapshotMap | null },
  >(course: T, userId: number | null): Promise<T & { directedLocks?: DirectedLock[] }> {
    if (!course.directedLearning || !course.map) return course;

    // Somebody with no answers yet gets the root's content and the first quiz,
    // which is where a course should start: it cannot ask what applies to you
    // before you have read what everybody reads.
    const rows = userId ? await CourseMapGateway.getChoices(userId, course.id) : [];
    const projected = projectDirectedCourse(course, course.map, {
      byDepth: new Map(rows.map((row) => [row.depth, row.chosenNodeIds])),
    });

    return { ...projected.course, directedLocks: projected.locks };
  }

  /** What this learner has picked so far, keyed by layer. */
  static async choicesFor(userId: number, courseId: string): Promise<LearnerChoices> {
    const rows = await CourseMapGateway.getChoices(userId, courseId);
    return { byDepth: new Map(rows.map((row) => [row.depth, row.chosenNodeIds])) };
  }

  /**
   * Records what somebody picked at a layer quiz.
   *
   * Called from the quiz submission path, which hands over the option ids they
   * ticked. Those are turned into node ids here, because a node offered by two
   * parents has two options and either one means the same thing — and because an
   * author redrawing a connection mints a new option, which must not erase an
   * answer already given.
   */
  static async recordChoice(userId: number, quizId: string, chosenOptionIds: string[]) {
    const layer = await CourseMapGateway.layerForQuiz(quizId);
    if (!layer) return null;

    const edges = await CourseMapGateway.getEdges(layer.courseId);
    const chosen = new Set(chosenOptionIds);
    const nodeIds = [
      ...new Set(
        edges
          .filter((edge) => edge.optionId && chosen.has(edge.optionId))
          .map((edge) => edge.childId),
      ),
    ];

    return CourseMapGateway.saveChoice(userId, layer.courseId, layer.depth, nodeIds);
  }
}
