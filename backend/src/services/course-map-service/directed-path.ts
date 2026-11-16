/**
 * File: directed-path.ts
 * Description: Turning a course map plus a learner's answers into their course.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-09-25
 */
/**
 * The projection: a directed course's snapshot, narrowed to one learner.
 *
 * Deliberately pure and free of imports. Two callers need it — the learner's
 * course endpoint and the authoring preview — and putting it in either service
 * would have made the other import that service, so it sits on its own with
 * nothing but types.
 *
 * What comes out is an ordinary course tree. The branches this learner did not
 * pick are gone, and what is left has been rewritten into models and sections
 * in the order the map lays out — the root's content, then the quiz that asks
 * what applies to them, then the branches they picked, then the next quiz, and
 * so on down. That shape is the whole trick: the player, the progress
 * calculation and the dashboard all read a normal course and never learn that a
 * map was involved.
 *
 * Ids are never minted here. A section keeps the id it was authored with
 * wherever the map puts it, because progress is keyed on that id and a learner
 * who drops a branch and takes it back must find their training where they left
 * it. Only `number`, `position`, `sortKey` and `modelId` — all of them display
 * and ordering — are rewritten.
 */

/** A node as it is frozen into a published snapshot. */
export interface SnapshotMapNode {
  id: string;
  title: string;
  x: number;
  y: number;
  depth: number;
  isRoot: boolean;
  /** The sections placed on it, in the author's order. */
  sectionIds: string[];
}

/**
 * One connection, as it is frozen into a snapshot.
 *
 * The two ends, and the option that offers this route.
 *
 * `optionId` was left out at first, on the grounds that nothing on the learner
 * path read it — a choice is stored against the node, so that it survives the
 * author redrawing the connection. Narrowing a layer quiz to the routes a given
 * learner can reach is what needs it: without it there is no way to say which of
 * a quiz's options belongs to which connection, and the quiz has to be offered
 * whole to everybody. Matching by position or by option text was the
 * alternative, and both are the kind of coupling that is right until somebody
 * renames a node.
 *
 * Optional, because snapshots published before this exist and cannot grow the
 * field. Those degrade to the old behaviour — every option offered — rather than
 * to an empty question; see `narrowToReachable`.
 */
export interface SnapshotMapEdge {
  parentId: string;
  childId: string;
  optionId?: string | null;
}

/** One generated layer quiz, and the model holding it. */
export interface SnapshotMapLayer {
  depth: number;
  quizId: string;
  modelId: string;
  sectionId: string;
}

export interface SnapshotMap {
  nodes: SnapshotMapNode[];
  edges: SnapshotMapEdge[];
  layers: SnapshotMapLayer[];
}

/** What a learner has picked, by layer. */
export interface LearnerChoices {
  /** depth → the node ids they ticked at that layer's quiz. */
  byDepth: Map<number, string[]>;
}

/**
 * What the player needs to know that an ordinary course does not carry: which
 * sections a layer quiz waits on.
 *
 * A layer quiz is the end of the layer above it — the learner reads that layer's
 * content and is then asked what to do next — so it stays shut until that
 * content has been seen. Expressed as plain section ids rather than as a rule,
 * because the player already knows how to ask whether a section has been viewed
 * and should not have to learn what a depth is.
 */
export interface DirectedLock {
  quizId: string;
  sectionId: string;
  depth: number;
  requires: string[];
}

/**
 * The minimum a course must look like for this to rewrite it.
 *
 * Only the four fields that say where a section sits. `sortKey` is deliberately
 * absent: it is a stored ordering key on the authoring rows and never travels in
 * a snapshot, which keeps its sections in reading order by array order alone —
 * and array order is exactly what this rewrites.
 */
interface ProjectableSection {
  id: string;
  modelId: string | null;
  position: number;
  number: string;
  /**
   * The quizzes in this section, where the caller has any.
   *
   * Read for one purpose only: a layer quiz's section is rewritten so that it
   * offers this learner the branches they can actually reach. Everything else
   * about a quiz is left exactly as it was found, and a caller whose sections
   * carry no quizzes at all — the tests below, mostly — is unaffected.
   */
  quizzes?: ProjectableQuiz[];
}

/** Just enough of a quiz to narrow which of its options are offered. */
interface ProjectableQuiz {
  questions?: Array<{ options?: Array<{ id: string }> }>;
}

interface ProjectableModel {
  id: string;
  courseId: string;
  number: number;
  title: string;
  color: string | null;
}

export interface ProjectableCourse {
  id: string;
  models: ProjectableModel[];
  sections: ProjectableSection[];
}

/**
 * Left to right, then by title so the order is total.
 *
 * `x` is the canvas position, which on a directed course is not decoration: it
 * is the reading order among everything at the same depth. Two boxes dropped at
 * exactly the same x would otherwise come back in whatever order the database
 * felt like, and a course whose order moved between page loads is worse than one
 * whose order is slightly arbitrary.
 */
function byPosition(a: SnapshotMapNode, b: SnapshotMapNode): number {
  return a.x - b.x || a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
}

/**
 * The nodes that fork: more than one connection leads out of them.
 *
 * Only a fork asks the learner anything. A node with a single way out leads
 * straight on to it — there is nothing to choose — so that connection is never
 * offered in a layer quiz and its child follows on its own. A map that runs in a
 * single line therefore generates no quiz at all.
 */
export function forkingNodeIds(edges: Array<{ parentId: string }>): Set<string> {
  const outDegree = new Map<string, number>();
  for (const edge of edges) outDegree.set(edge.parentId, (outDegree.get(edge.parentId) ?? 0) + 1);
  return new Set([...outDegree].filter(([, count]) => count >= 2).map(([id]) => id));
}

/** The connections a layer quiz offers — those leaving a fork — by id. */
export function choiceEdgeIds(edges: Array<{ id: string; parentId: string }>): Set<string> {
  const forks = forkingNodeIds(edges);
  return new Set(edges.filter((edge) => forks.has(edge.parentId)).map((edge) => edge.id));
}

/**
 * Which nodes this learner has actually reached.
 *
 * The root always. Below it, a node is in if a visible parent leads only to it
 * — no choice to make, so it follows — or if they ticked it *and* a visible
 * parent forks towards it. The "visible parent" half matters because the author
 * can delete the node that offered it long after the answer was given, and a
 * stored choice must never resurrect a branch the map no longer has a route to.
 *
 * Walked depth by depth, so a parent's verdict is always settled before its
 * children are asked about. That is what makes "any parent unlocks it" cheap:
 * by the time a node is considered, every node that could vouch for it has
 * already been decided.
 */
export function visibleNodeIds(map: SnapshotMap, choices: LearnerChoices): Set<string> {
  const visible = new Set(map.nodes.filter((node) => node.isRoot).map((node) => node.id));
  const forks = forkingNodeIds(map.edges);
  const parentsOf = new Map<string, string[]>();
  for (const edge of map.edges) {
    parentsOf.set(edge.childId, [...(parentsOf.get(edge.childId) ?? []), edge.parentId]);
  }

  const depths = [...new Set(map.nodes.map((node) => node.depth))].sort((a, b) => a - b);

  for (const depth of depths) {
    if (depth === 0) continue;
    const chosen = new Set(choices.byDepth.get(depth) ?? []);

    for (const node of map.nodes.filter((current) => current.depth === depth)) {
      const parents = (parentsOf.get(node.id) ?? []).filter((parentId) => visible.has(parentId));
      const followsOn = parents.some((parentId) => !forks.has(parentId));
      const picked = chosen.has(node.id) && parents.some((parentId) => forks.has(parentId));
      if (followsOn || picked) visible.add(node.id);
    }
  }

  return visible;
}

/**
 * One group in the learner's course: either a node's content, or the quiz that
 * decides what comes after it.
 */
type Group =
  | { kind: 'node'; id: string; title: string; sectionIds: string[] }
  | { kind: 'layer'; id: string; title: string; sectionIds: string[]; depth: number };

/**
 * The reading order: the root's content, then quiz 1, then everything picked at
 * depth 1 left to right, then quiz 2, and down.
 *
 * The quiz for a depth comes *before* the nodes at that depth because it is what
 * chooses them — and after the depth above because that is the content it
 * follows on from.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A LAYER QUIZ IS ONLY ASKED WHEN THIS LEARNER CAN REACH THAT LAYER
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Two conditions, and they answer different questions.
 *
 * `anythingRead` is "is there anything before this to have read". A quiz is a
 * pause after content — finish this, now tell me what you need next — so it is
 * not asked before there is any content to have finished.
 *
 * `offerable` is "is there anything at this depth to ask *them* about", and it
 * is the one that was missing. It used to be enough that the layer above had
 * content, which is true of every branch that goes anywhere at all — so a
 * learner who picked a branch that simply ends was still handed the next quiz.
 * On the map that reads as: pick the bottom path, which stops at depth 1, and
 * still be given quiz 2, whose only option hangs off the top path you did not
 * take. They were asked a question with no answer that led anywhere, and the
 * course reported a piece of work they could never complete.
 *
 * So the real test is whether any route into this depth starts somewhere this
 * learner can already see. `visibleNodeIds` admits a node only when it was
 * ticked *and* one of its parents is visible, so an edge whose parent is not
 * visible can never produce a visible child however it is answered — and a depth
 * with no such edge has nothing to ask.
 *
 * Whether they may open a quiz that *is* offered stays a separate question,
 * answered by `DirectedLock` rather than by leaving it out: a quiz missing from
 * the rail tells a learner nothing, while a locked one tells them there is more
 * course after this.
 */
function groupsFor(map: SnapshotMap, visible: Set<string>): Group[] {
  const groups: Group[] = [];
  const depths = [...new Set(map.nodes.map((node) => node.depth))].sort((a, b) => a - b);
  const layerByDepth = new Map(map.layers.map((layer) => [layer.depth, layer]));
  const depthOf = new Map(map.nodes.map((node) => [node.id, node.depth]));
  const forks = forkingNodeIds(map.edges);
  /**
   * Quizzes are numbered in the order this learner meets them, not by depth: a
   * layer with no fork has no quiz, and "quiz 1, quiz 3" would read as a gap.
   */
  let quizNumber = 0;

  /**
   * Whether anything at all has been read so far, not merely at the depth above.
   *
   * Cumulative rather than per-depth, because a layer of empty grouping nodes in
   * the middle of a course does not undo the content above it — and the old
   * per-depth version would have suppressed every quiz below such a layer.
   */
  let anythingRead = false;

  for (const depth of depths) {
    const layer = layerByDepth.get(depth);
    // Only a fork this learner can see is anything to ask them about.
    const offerable = map.edges.some(
      (edge) =>
        depthOf.get(edge.childId) === depth &&
        visible.has(edge.parentId) &&
        forks.has(edge.parentId),
    );

    if (depth > 0 && layer && anythingRead && offerable) {
      quizNumber += 1;
      groups.push({
        kind: 'layer',
        id: layer.modelId,
        title: `Directed learning quiz ${quizNumber}`,
        sectionIds: [layer.sectionId],
        depth,
      });
    }

    const here = map.nodes
      .filter((node) => node.depth === depth && visible.has(node.id))
      .sort(byPosition);

    for (const node of here) {
      groups.push({ kind: 'node', id: node.id, title: node.title, sectionIds: node.sectionIds });
    }

    if (here.some((node) => node.sectionIds.length > 0)) anythingRead = true;
  }

  return groups;
}

export interface Projection<T> {
  course: T;
  locks: DirectedLock[];
}

/**
 * The options a layer quiz should offer this learner: the routes into it that
 * start somewhere they can already see.
 *
 * An edge whose parent is not visible can never produce a visible child however
 * it is answered — `visibleNodeIds` refuses it — so offering it asks somebody to
 * choose between branches, some of which will silently do nothing. Worse on a
 * wide map than it sounds: a learner on one project is shown every other
 * project's next step, and the one that applies to them is buried among them.
 */
function offeredOptionIds(map: SnapshotMap, visible: Set<string>, depth: number): Set<string> {
  const depthOf = new Map(map.nodes.map((node) => [node.id, node.depth]));
  const forks = forkingNodeIds(map.edges);

  return new Set(
    map.edges
      .filter(
        (edge) =>
          depthOf.get(edge.childId) === depth &&
          visible.has(edge.parentId) &&
          forks.has(edge.parentId),
      )
      .map((edge) => edge.optionId)
      .filter((optionId): optionId is string => Boolean(optionId)),
  );
}

/**
 * Narrows a layer quiz's section to the options this learner can reach.
 *
 * Returns the section untouched when narrowing would leave a question with
 * nothing in it. That happens on a snapshot published before edges carried their
 * option id, and on a map whose quizzes have not been regenerated since an edge
 * was drawn — and in both cases an over-broad question is plainly better than a
 * blank one. The learner's answer is mapped back through the same edges when it
 * is recorded, so a stray option they were shown still resolves correctly.
 */
function narrowToReachable<S extends ProjectableSection>(section: S, offered: Set<string>): S {
  if (!section.quizzes?.length) return section;

  const quizzes = section.quizzes.map((quiz) => ({
    ...quiz,
    questions: (quiz.questions ?? []).map((question) => {
      const kept = (question.options ?? []).filter((option) => offered.has(option.id));
      return kept.length > 0 ? { ...question, options: kept } : question;
    }),
  }));

  /*
    One cast, at the one place the generic cannot follow.

    Everything above preserves every field it did not mean to change — the
    quizzes, questions and options that come out are the ones that went in, minus
    some options — but `S` is whatever the caller's section type is, and
    TypeScript cannot see that a spread of its `quizzes` is still its `quizzes`.
  */
  return { ...section, quizzes } as unknown as S;
}

/**
 * Rewrites a course into one learner's path through it.
 *
 * Sections the map never placed are dropped rather than appended. On a directed
 * course the map is the course: a section nobody mapped is content the author
 * has not finished deciding about, and publishing is already refused while any
 * of this course's own sections are in that state.
 */
export function projectDirectedCourse<T extends ProjectableCourse>(
  course: T,
  map: SnapshotMap,
  choices: LearnerChoices,
): Projection<T> {
  const visible = visibleNodeIds(map, choices);
  const groups = groupsFor(map, visible);
  const sectionById = new Map(course.sections.map((section) => [section.id, section]));

  const models: ProjectableModel[] = [];
  const sections: T['sections'] = [];
  const locks: DirectedLock[] = [];
  /** Content seen so far, which is what each layer quiz waits on. */
  const readSoFar: string[] = [];

  groups.forEach((group, index) => {
    const number = index + 1;
    const placed = group.sectionIds
      .map((id) => sectionById.get(id))
      .filter((section): section is T['sections'][number] => section !== undefined);

    // A node with nothing in it is a decision, not a chapter. Drawing an empty
    // model would tell the learner a part of their course is missing.
    if (placed.length === 0) return;

    models.push({ id: group.id, courseId: course.id, number, title: group.title, color: null });

    placed.forEach((section, position) => {
      const placedHere = {
        ...section,
        modelId: group.id,
        position: position + 1,
        number: `${number}.${position + 1}`,
      };

      // Only a layer quiz's section is narrowed. An ordinary section's quizzes
      // are the author's and have nothing to do with the map.
      sections.push(
        group.kind === 'layer'
          ? narrowToReachable(placedHere, offeredOptionIds(map, visible, group.depth))
          : placedHere,
      );
    });

    if (group.kind === 'layer') {
      const layer = map.layers.find((current) => current.depth === group.depth);
      if (layer) {
        locks.push({
          quizId: layer.quizId,
          sectionId: layer.sectionId,
          depth: group.depth,
          requires: [...readSoFar],
        });
      }
    } else {
      readSoFar.push(...placed.map((section) => section.id));
    }
  });

  // Renumbered from 1 so the learner reads 1.1, 1.2, 2.1 — the empty groups
  // skipped above would otherwise leave holes in the numbering.
  const renumbered = models.map((model, index) => ({ ...model, number: index + 1 }));
  const numberById = new Map(renumbered.map((model) => [model.id, model.number]));

  return {
    course: {
      ...course,
      models: renumbered,
      sections: sections.map((section) => {
        const modelNumber = numberById.get(String(section.modelId)) ?? 1;
        const [, position] = section.number.split('.');
        return { ...section, number: `${modelNumber}.${position}` };
      }),
    },
    locks,
  };
}
