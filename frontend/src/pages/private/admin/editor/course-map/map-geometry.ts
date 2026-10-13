/**
 * File: map-geometry.ts
 * Description: Node sizes, connector ports, drooping strings and the pan bounds.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-09-22
 */
/**
 * The map's arithmetic, kept away from the components that draw it.
 *
 * All of it is pure, which is the point: where a port sits, what a connection
 * looks like and how far the canvas may be dragged are questions with one right
 * answer each, and answering them inside a render made them impossible to test
 * and easy to get subtly inconsistent — the string you pull looked different
 * from the string you got because two places computed the same curve.
 */
import type { MapNode } from '@/services/course-map-api';

/** Every node is the same size, so ports can be found without measuring. */
export const NODE_WIDTH = 220;
export const NODE_HEIGHT = 96;

/** How much empty canvas is allowed past the outermost node. */
export const PAN_MARGIN = 160;

/**
 * How far outside a node, in screen pixels, a string may be let go and still
 * land on it.
 *
 * The box alone was too small a target: an author aiming at the input dot on the
 * left edge would let go just short of it, on bare canvas, and the string would
 * snap back. Measured on screen rather than on the canvas so it stays the same
 * size to the hand whatever the zoom.
 */
export const CONNECT_REACH = 36;

export interface Point {
  x: number;
  y: number;
}

/** The dot on the left edge, where a string is dropped. */
export function inputPort(node: Pick<MapNode, 'x' | 'y'>): Point {
  return { x: node.x, y: node.y + NODE_HEIGHT / 2 };
}

/** The circle on the right edge, where a string is pulled from. */
export function outputPort(node: Pick<MapNode, 'x' | 'y'>): Point {
  return { x: node.x + NODE_WIDTH, y: node.y + NODE_HEIGHT / 2 };
}

/**
 * A connection, drawn as a string with some weight in it.
 *
 * A straight line between two ports reads as a diagram; a string reads as
 * something you tied on, which is what the author just did. The sag is
 * proportional to how far apart the two ends are, and capped — a connection
 * across the whole canvas should hang, not loop down out of sight — and it is
 * added to the *y* of both control points, which is what pulls the middle of the
 * curve down while leaving both ends attached where they are.
 *
 * The same function draws the live string being dragged, so what the author sees
 * under the cursor is exactly what they get when they let go.
 */
export function stringPath(from: Point, to: Point): string {
  const span = Math.abs(to.x - from.x);
  const reach = Math.max(span * 0.5, 40);
  const sag = Math.min(span * 0.22 + Math.abs(to.y - from.y) * 0.08, 90);

  return [
    `M ${from.x} ${from.y}`,
    `C ${from.x + reach} ${from.y + sag},`,
    `${to.x - reach} ${to.y + sag},`,
    `${to.x} ${to.y}`,
  ].join(' ');
}

/** The box a node occupies, which is fixed because every node is the same size. */
export function nodeRect(node: Point): {
  left: number;
  top: number;
  right: number;
  bottom: number;
} {
  return {
    left: node.x,
    top: node.y,
    right: node.x + NODE_WIDTH,
    bottom: node.y + NODE_HEIGHT,
  };
}

/**
 * Which node a point falls inside, or null.
 *
 * Hit-testing rather than relying on the pointer entering the element, because
 * pulling a string captures the pointer on the port it started from — and a
 * captured pointer delivers every event to that one element, so no other node
 * is ever told the cursor arrived over it. Working it out from coordinates is
 * the only thing that stays true while a capture is in force.
 *
 * Searched from the end, because later nodes are painted over earlier ones and
 * the one you can see is the one you mean.
 *
 * `reach` grows every box by that much on all sides, in canvas units. A point
 * inside a node always wins over one that is merely within reach of another, so
 * the extra margin never steals a drop from the node the pointer is actually on.
 */
export function nodeAtPoint<T extends { id: string; x: number; y: number }>(
  nodes: T[],
  point: Point,
  reach = 0,
): T | null {
  const within = (node: T, pad: number) => {
    const box = nodeRect(node);
    return (
      point.x >= box.left - pad &&
      point.x <= box.right + pad &&
      point.y >= box.top - pad &&
      point.y <= box.bottom + pad
    );
  };

  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    if (within(nodes[index], 0)) return nodes[index];
  }
  if (reach <= 0) return null;

  // Nothing directly underneath: the nearest node whose input dot is in reach.
  let best: T | null = null;
  let bestDistance = Infinity;
  for (const node of nodes) {
    if (!within(node, reach)) continue;
    const port = inputPort(node);
    const distance = Math.hypot(point.x - port.x, point.y - port.y);
    if (distance < bestDistance) {
      best = node;
      bestDistance = distance;
    }
  }

  return best;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * How far the canvas may be dragged: the nodes' own extent, plus a margin.
 *
 * Bounded so the author cannot pan off into empty space and lose the map. The
 * margin is what keeps a node at the very edge from being pinned against the
 * frame with no room to drop anything beside it.
 */
export function contentBounds(nodes: MapNode[]): Bounds {
  if (nodes.length === 0) {
    return { minX: 0, minY: 0, maxX: NODE_WIDTH, maxY: NODE_HEIGHT };
  }

  return {
    minX: Math.min(...nodes.map((node) => node.x)) - PAN_MARGIN,
    minY: Math.min(...nodes.map((node) => node.y)) - PAN_MARGIN,
    maxX: Math.max(...nodes.map((node) => node.x)) + NODE_WIDTH + PAN_MARGIN,
    maxY: Math.max(...nodes.map((node) => node.y)) + NODE_HEIGHT + PAN_MARGIN,
  };
}

/**
 * Holds an offset inside the bounds, given the size of the window onto them.
 *
 * When the content is smaller than the viewport there is nothing to pan — the
 * two clamps cross over — so the content is centred instead of being jammed
 * against one edge, which is what a naive `Math.min`/`Math.max` pair would do.
 */
export function clampOffset(offset: Point, bounds: Bounds, viewport: Point): Point {
  const clampAxis = (value: number, min: number, max: number, size: number): number => {
    const lowest = size - max;
    const highest = -min;
    if (lowest > highest) return (lowest + highest) / 2;
    return Math.min(Math.max(value, lowest), highest);
  };

  return {
    x: clampAxis(offset.x, bounds.minX, bounds.maxX, viewport.x),
    y: clampAxis(offset.y, bounds.minY, bounds.maxY, viewport.y),
  };
}

// ---- Zoom ----

/**
 * How far the map may be zoomed, and by how much a press of the button moves it.
 *
 * The floor is low enough that Recentre can honour what it promises. Below about
 * a third a node's title is a grey smear, so a map read at 20% is a map you can
 * see the shape of rather than read — but seeing the shape is exactly what
 * somebody who has just pressed "show me all of it" asked for, and a floor that
 * refused to show the whole of a large map would make that button lie. The
 * ceiling is modest because there is nothing inside a node to magnify — it is a
 * name and a line of counts — so zooming in is for placing boxes accurately.
 */
export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 2;
export const ZOOM_STEP = 1.25;

/** Held inside the allowed range, so every caller can multiply freely. */
export function clampZoom(scale: number): number {
  return Math.min(Math.max(scale, MIN_ZOOM), MAX_ZOOM);
}

/**
 * The pan bounds in screen pixels at a given zoom.
 *
 * `contentBounds` answers in canvas coordinates, which is what the nodes are
 * placed in, while the offset the canvas is dragged by is in screen pixels. At
 * 100% the two are the same number and the distinction never came up; at any
 * other zoom they are not, and clamping one against the other pins the map
 * against an edge that is not where the content is.
 */
export function scaleBounds(bounds: Bounds, scale: number): Bounds {
  return {
    minX: bounds.minX * scale,
    minY: bounds.minY * scale,
    maxX: bounds.maxX * scale,
    maxY: bounds.maxY * scale,
  };
}

/**
 * Canvas coordinates for a point on screen, at a given pan and zoom.
 *
 * The inverse of the transform the canvas is drawn with — `translate(offset)`
 * then `scale` — and so the one place that has to know the order those are
 * applied in. Everything that hit-tests, drops or drags a string asks here
 * rather than doing the arithmetic again slightly differently.
 */
export function toCanvas(screen: Point, offset: Point, scale: number): Point {
  return { x: (screen.x - offset.x) / scale, y: (screen.y - offset.y) / scale };
}

export interface View {
  offset: Point;
  scale: number;
}

/**
 * The view that shows the whole map at once, centred.
 *
 * Both halves of "recentre" fall out of one calculation. The scale is whatever
 * makes the content's extent fit inside the frame, never magnifying past 100% —
 * a two-node map blown up to fill a wide screen looks broken rather than
 * helpful — and the offset then puts the middle of that extent in the middle of
 * the frame, which is what makes the map arrive where somebody is already
 * looking.
 *
 * The extent used is `contentBounds`, margin included, so the outermost node
 * lands clear of the frame rather than flush against it.
 */
export function fitView(nodes: MapNode[], viewport: Point): View {
  const bounds = contentBounds(nodes);
  const width = Math.max(bounds.maxX - bounds.minX, 1);
  const height = Math.max(bounds.maxY - bounds.minY, 1);

  // A frame that has not been measured yet has no answer; 1 keeps the map where
  // it is rather than dividing by zero and losing it.
  if (viewport.x <= 0 || viewport.y <= 0) return { offset: { x: 0, y: 0 }, scale: 1 };

  const scale = clampZoom(Math.min(viewport.x / width, viewport.y / height, 1));
  const centre = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };

  return {
    scale,
    offset: {
      x: viewport.x / 2 - centre.x * scale,
      y: viewport.y / 2 - centre.y * scale,
    },
  };
}

/**
 * The view that puts one node in the middle of the frame, at the current zoom.
 *
 * Used by the search box. The zoom is deliberately left alone: somebody looking
 * for a node has usually just set the zoom they want to work at, and answering a
 * search by also changing it means they have to set it again before they can do
 * anything with what they found.
 */
export function centreOn(node: Point, viewport: Point, scale: number): Point {
  return {
    x: viewport.x / 2 - (node.x + NODE_WIDTH / 2) * scale,
    y: viewport.y / 2 - (node.y + NODE_HEIGHT / 2) * scale,
  };
}

// ---- Aligning the layers ----

/** Where the tidied map starts, and how far apart it puts things. */
export const LAYOUT_ORIGIN = { x: 80, y: 80 };
export const LAYOUT_GAP = { x: 120, y: 48 };

/** One column's worth of horizontal travel, and one row's of vertical. */
const COLUMN = NODE_WIDTH + LAYOUT_GAP.x;
const ROW = NODE_HEIGHT + LAYOUT_GAP.y;

export interface Placement {
  id: string;
  x: number;
  y: number;
}

/**
 * Redraws the whole map as columns, one per layer.
 *
 * Two things are being fixed at once, and they are not the same thing. Every
 * node the same number of jumps from the root shares an `x`, which is what makes
 * a layer visible as a layer — and on a directed course that is more than
 * cosmetic, since everything in a column is offered by one quiz. Then the nodes
 * in each column are given a `y` each, far enough apart that no two boxes touch.
 *
 * WHY THE ORDER WITHIN A COLUMN IS NOT ARBITRARY
 *
 * A column sorted by name, or left in whatever order the database returned,
 * produces a correct picture whose strings cross each other for no reason. So
 * each node is placed at the average height of the parents that point at it —
 * the barycentre heuristic — and the column is then sorted by that. A node with
 * one parent ends up level with it; a node shared by two ends up between them;
 * and strings only cross where the connections genuinely do.
 *
 * Because the columns are walked shallowest first, every parent has already been
 * placed by the time its children ask where it is, so one pass is enough and no
 * iteration to a fixed point is needed.
 *
 * Nodes the root cannot reach keep their own column past the end. They are on
 * the canvas but not in the course, and tidying them into the tree would draw
 * them as part of a structure they are not in — the publish gate has something
 * to say about them, and this should not hide it.
 */
export function alignLayers(
  nodes: Array<{ id: string; isRoot: boolean; title: string }>,
  edges: Array<{ parentId: string; childId: string }>,
): Placement[] {
  const depths = depthsFrom(nodes, edges);
  const parentsOf = new Map<string, string[]>();
  for (const edge of edges) {
    parentsOf.set(edge.childId, [...(parentsOf.get(edge.childId) ?? []), edge.parentId]);
  }

  const reached = nodes.filter((node) => depths.has(node.id));
  const stranded = nodes.filter((node) => !depths.has(node.id));
  const deepest = reached.reduce((most, node) => Math.max(most, depths.get(node.id) ?? 0), 0);

  const placed = new Map<string, Placement>();
  const out: Placement[] = [];

  for (let depth = 0; depth <= deepest; depth += 1) {
    const column = reached.filter((node) => depths.get(node.id) === depth);

    // Where each node would like to be: level with the middle of its parents.
    // Nodes with no placed parent — the root, and anything whose parents are all
    // deeper than it — keep their reading order by falling to the end.
    const wanted = new Map<string, number>();
    for (const node of column) {
      const ys = (parentsOf.get(node.id) ?? [])
        .map((parentId) => placed.get(parentId)?.y)
        .filter((y): y is number => y !== undefined);
      wanted.set(node.id, ys.length === 0 ? Number.MAX_SAFE_INTEGER : average(ys));
    }

    const ordered = [...column].sort(
      (a, b) =>
        (wanted.get(a.id) ?? 0) - (wanted.get(b.id) ?? 0) ||
        a.title.localeCompare(b.title) ||
        a.id.localeCompare(b.id),
    );

    ordered.forEach((node, index) => {
      const at = {
        id: node.id,
        x: LAYOUT_ORIGIN.x + depth * COLUMN,
        // Evenly spaced from the top of the column rather than around the
        // parent's height: honouring the barycentre exactly is what lets two
        // nodes overlap, and the order it asked for is the part that mattered.
        y: LAYOUT_ORIGIN.y + index * ROW,
      };
      placed.set(node.id, at);
      out.push(at);
    });
  }

  stranded
    .slice()
    .sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id))
    .forEach((node, index) => {
      out.push({
        id: node.id,
        // One clear column past the tree, so "not connected to anything" reads
        // off the picture rather than having to be counted out of it.
        x: LAYOUT_ORIGIN.x + (deepest + 1) * COLUMN + LAYOUT_GAP.x,
        y: LAYOUT_ORIGIN.y + index * ROW,
      });
    });

  return out;
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Jumps from the root, by the shortest route — the browser's copy of the rule
 * the server stores in `depth`.
 *
 * Worked out here rather than read off the nodes because aligning is the one
 * moment the two can legitimately disagree: the author may have just drawn a
 * connection, and the layout should tidy the map they are looking at rather than
 * the one the last response described.
 */
export function depthsFrom(
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

/** The grid square in canvas units at 100%, before it is adapted to the zoom. */
export const GRID_BASE = 40;

/**
 * The grid square to draw at this zoom, in canvas units.
 *
 * A fixed square stops being a grid at both ends of the zoom range: at 20% the
 * lines are eight pixels apart and read as grey noise, and at 200% they are so
 * far apart that most of the canvas has none. So the square doubles or halves
 * until what lands on screen is somewhere between `LOOSE` and `TIGHT` pixels,
 * which is the band where a grid reads as paper rather than as a pattern.
 *
 * Doubling rather than scaling smoothly, so that zooming in and out returns to
 * the same lines instead of sliding them continuously under the nodes.
 */
export function gridStep(scale: number): number {
  const TIGHT = 20;
  const LOOSE = 80;

  let step = GRID_BASE;
  // Bounded rather than while(true): a scale outside the zoom range is not
  // something to loop forever over, and eight doublings covers it many times.
  for (let guard = 0; guard < 8 && step * scale < TIGHT; guard += 1) step *= 2;
  for (let guard = 0; guard < 8 && step * scale > LOOSE; guard += 1) step /= 2;

  return step;
}

// ---- Searching ----

/** How many suggestions the search box offers at once. */
export const SEARCH_LIMIT = 8;

/**
 * How well a node's name answers what has been typed, lower being better, or
 * null for no match at all.
 *
 * Four tiers, in the order somebody actually means them:
 *
 *   0  the whole name, exactly
 *   1  the name begins with it — "bee" offers "Bee keeping" before anything else
 *   2  a word inside the name begins with it, so "keep" still finds "Bee keeping"
 *   3  the letters appear in order but not together, which is what catches a
 *      near miss: "bkeep" finds "Bee keeping", and a typo that drops a letter
 *      still lands on the thing that was meant
 *
 * Ties inside a tier are broken by length, so the shortest name that matches
 * wins — on a map holding "Bees" and "Bees: advanced", typing "bees" should
 * offer the plain one first.
 */
export function matchRank(title: string, needle: string): number | null {
  const name = title.toLowerCase();
  const want = needle.toLowerCase();

  if (name === want) return 0;
  if (name.startsWith(want)) return 1;
  if (name.split(/\s+/).some((word) => word.startsWith(want))) return 2;
  if (name.includes(want)) return 2;
  return isSubsequence(want, name) ? 3 : null;
}

/** Whether every letter of `want` appears in `name`, in order. */
function isSubsequence(want: string, name: string): boolean {
  let at = 0;
  for (const letter of name) {
    if (letter === want[at]) at += 1;
    if (at === want.length) return true;
  }
  return want.length === 0;
}

/**
 * The nodes worth offering for what has been typed, best first.
 *
 * Capped, because the dropdown is a shortlist rather than a second copy of the
 * map: somebody who types one letter on a forty-node map is not being helped by
 * forty suggestions, and the answer to that is to type another letter.
 */
export function searchNodes<T extends { id: string; title: string }>(
  nodes: T[],
  query: string,
  limit = SEARCH_LIMIT,
): T[] {
  const needle = query.trim();
  if (!needle) return [];

  return nodes
    .map((node) => ({ node, rank: matchRank(node.title, needle) }))
    .filter((entry): entry is { node: T; rank: number } => entry.rank !== null)
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        a.node.title.length - b.node.title.length ||
        a.node.title.localeCompare(b.node.title),
    )
    .slice(0, limit)
    .map((entry) => entry.node);
}
