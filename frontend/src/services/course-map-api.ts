/**
 * File: course-map-api.ts
 * Description: Client for the directed-learning map endpoints.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-09-22
 */
import type { Course, CourseKind } from '@/services/curriculum-api';
import HttpHelper from '@/utils/http-helper';

/** One section placed on a node. */
export interface MapItem {
  sectionId: string;
  /** Which course it came from — this one, or a course added to staging. */
  sourceCourseId: string;
  number: string;
  title: string;
  estimatedMinutes: number;
  /** Placed by a linked map, so it moves only when that map does. */
  locked?: boolean;
}

/** A map linked in from another course, which owns it. */
export interface LinkedMap {
  subgraphId: string;
  sourceTitle: string;
  /** The copy of the source's root — the one linked node this course may lead into. */
  entry?: boolean;
}

export interface MapNode {
  id: string;
  title: string;
  /**
   * Where the box sits on the canvas.
   *
   * `x` is also the learner's reading order among everything at the same depth,
   * which is why dragging a box is a change to the course rather than to the
   * picture of it.
   */
  x: number;
  y: number;
  /** Jumps from the root, by the shortest route in. */
  depth: number;
  isRoot: boolean;
  items: MapItem[];
  /** Set on a node copied in from another course's map: read-only here. */
  linked?: LinkedMap | null;
}

export interface MapEdge {
  parentId: string;
  childId: string;
  /** Part of a linked map: drawn red, and cannot be cut. */
  locked?: boolean;
}

/** One group in the staging manager: a course, and what of it is unplaced. */
export interface StagingGroup {
  courseId: string;
  courseTitle: string;
  /** False on this course's own content, which is always the first group. */
  imported: boolean;
  /**
   * An imported course with a map of its own. Dropping any of its sections on a
   * node links that whole map in beneath the node.
   */
  mapped?: boolean;
  sections: Array<{ id: string; number: string; title: string; estimatedMinutes: number }>;
}

export interface CourseMap {
  directedLearning: boolean;
  stagedAt: string | null;
  /**
   * True when sections or models have been added since the last stage (or it
   * has never been staged). Mapping is refused until the course is staged.
   */
  needsStaging?: boolean;
  nodes: MapNode[];
  edges: MapEdge[];
  staging: StagingGroup[];
  layers: Array<{ depth: number; quizId: string }>;
  /** This course's own sections that are still off the map, and so block a publish. */
  unmappedSectionIds: string[];
}

/**
 * One layer quiz option, and the branch ticking it opens.
 *
 * The preview needs this because nothing it does is submitted: the server
 * normally turns ticked options into chosen nodes when a paper comes in, and
 * with no paper the browser has to do the same translation itself. A node
 * offered by two parents has two options and either means the same thing, which
 * is why this is a list of options rather than a list of nodes.
 */
export interface PreviewOptionNode {
  optionId: string;
  nodeId: string;
  depth: number;
}

export interface DirectedPreview {
  /** The course narrowed to the branches these answers picked. */
  course: Course;
  /** Which sections each layer quiz waits on, exactly as a learner gets them. */
  locks: NonNullable<Course['directedLocks']>;
  optionNodes: PreviewOptionNode[];
  /** Which layer each generated quiz belongs to. */
  quizDepths: Array<{ quizId: string; depth: number }>;
}

/** A course that could be added to staging. */
export interface ImportableCourse {
  id: string;
  title: string;
  /**
   * Lesson or quiz set.
   *
   * Both can be staged. A quiz set stores one section per quiz, so what it
   * contributes to the pool is its exams — which is why the dialog names the two
   * apart rather than calling a set's quizzes "sections".
   */
  kind?: CourseKind;
  shortDescription: string | null;
  sectionCount: number;
}

export const courseMapApi = {
  getMap: (courseId: string): Promise<CourseMap> => HttpHelper.get(`course-map/${courseId}`),

  setDirected: (courseId: string, directedLearning: boolean) =>
    HttpHelper.put(`course-map/${courseId}/directed`, { directedLearning }),

  /** The soft publish: settles the root and rebuilds the layer quizzes. */
  stage: (courseId: string) => HttpHelper.post(`course-map/${courseId}/stage`, {}),

  createNode: (courseId: string, data: { title?: string; x?: number; y?: number } = {}) =>
    HttpHelper.post(`course-map/${courseId}/nodes`, data),

  /**
   * Every node's position at once — what Align layers sends.
   *
   * One call rather than a move per node: `x` is the order a layer quiz lists
   * its options in, so a run of single moves would rebuild those quizzes once
   * per node off a half-tidied map. See `CourseMapService.setLayout`.
   */
  setLayout: (
    courseId: string,
    positions: Array<{ id: string; x: number; y: number }>,
  ): Promise<{ map: CourseMap }> => HttpHelper.put(`course-map/${courseId}/layout`, { positions }),

  updateNode: (nodeId: string, data: { title?: string; x?: number; y?: number }) =>
    HttpHelper.put(`course-map/nodes/${nodeId}`, data),

  deleteNode: (nodeId: string) => HttpHelper.delete(`course-map/nodes/${nodeId}`),

  /**
   * A node's whole content list, in its new order.
   *
   * One call for all three drags the editor offers — reorder inside a node, move
   * between nodes, and drop back into staging — because each of them is the same
   * fact about one node: here is what it holds now.
   */
  setItems: (nodeId: string, sectionIds: string[]): Promise<{ map: CourseMap }> =>
    HttpHelper.put(`course-map/nodes/${nodeId}/items`, { sectionIds }),

  connect: (parentId: string, childId: string): Promise<{ map: CourseMap }> =>
    HttpHelper.post(`course-map/nodes/${parentId}/children`, { childId }),

  disconnect: (parentId: string, childId: string): Promise<{ map: CourseMap }> =>
    HttpHelper.delete(`course-map/nodes/${parentId}/children/${childId}`),

  /**
   * The course as this map would deliver it, for a given set of answers.
   *
   * What the Course content preview reads on a mapped course. The answers travel
   * in the request and are never stored, so an author walking their own branches
   * does not end up with a learning path recorded against them.
   */
  directedPreview: (
    courseId: string,
    choices: Record<number, string[]>,
  ): Promise<DirectedPreview> => HttpHelper.post(`course-map/${courseId}/preview`, { choices }),

  availableCourses: (courseId: string): Promise<{ courses: ImportableCourse[] }> =>
    HttpHelper.get(`course-map/${courseId}/available`),

  addImport: (courseId: string, sourceCourseId: string) =>
    HttpHelper.post(`course-map/${courseId}/imports`, { sourceCourseId }),

  removeImport: (courseId: string, sourceCourseId: string) =>
    HttpHelper.delete(`course-map/${courseId}/imports/${sourceCourseId}`),
};
