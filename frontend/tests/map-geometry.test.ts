/**
 * File: map-geometry.test.ts
 * Description: Unit tests for the course map's ports, drooping strings and pan bounds.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-09-22
 */
import {
  alignLayers,
  centreOn,
  clampOffset,
  contentBounds,
  fitView,
  GRID_BASE,
  gridStep,
  inputPort,
  MIN_ZOOM,
  NODE_HEIGHT,
  NODE_WIDTH,
  nodeAtPoint,
  outputPort,
  PAN_MARGIN,
  SEARCH_LIMIT,
  searchNodes,
  stringPath,
  toCanvas,
} from '@/pages/private/admin/editor/course-map/map-geometry';
import type { MapNode } from '@/services/course-map-api';

const node = (x: number, y: number): MapNode => ({
  id: `${x}-${y}`,
  title: 'Node',
  x,
  y,
  depth: 1,
  isRoot: false,
  items: [],
});

describe('ports', () => {
  it('puts the input dot on the left edge, half way down', () => {
    expect(inputPort({ x: 100, y: 200 })).toEqual({ x: 100, y: 200 + NODE_HEIGHT / 2 });
  });

  it('puts the output circle on the right edge, half way down', () => {
    expect(outputPort({ x: 100, y: 200 })).toEqual({
      x: 100 + NODE_WIDTH,
      y: 200 + NODE_HEIGHT / 2,
    });
  });
});

/** Both control points are pulled below the ends, which is what makes it hang. */
function controlPointYs(path: string): number[] {
  return [...path.matchAll(/C ([\d.-]+) ([\d.-]+),\s*([\d.-]+) ([\d.-]+),/g)].flatMap((match) => [
    Number(match[2]),
    Number(match[4]),
  ]);
}

describe('stringPath', () => {
  it('starts and ends exactly on the two ports', () => {
    const path = stringPath({ x: 10, y: 20 }, { x: 300, y: 20 });

    expect(path.startsWith('M 10 20')).toBe(true);
    expect(path.endsWith('300 20')).toBe(true);
  });

  it('sags: both control points sit below the line between the ends', () => {
    const path = stringPath({ x: 0, y: 100 }, { x: 400, y: 100 });

    for (const y of controlPointYs(path)) expect(y).toBeGreaterThan(100);
  });

  it('sags further the further apart the two ends are', () => {
    const short = Math.max(...controlPointYs(stringPath({ x: 0, y: 0 }, { x: 80, y: 0 })));
    const long = Math.max(...controlPointYs(stringPath({ x: 0, y: 0 }, { x: 600, y: 0 })));

    expect(long).toBeGreaterThan(short);
  });

  it('caps the sag, so a string across the whole map hangs rather than loops away', () => {
    const far = Math.max(...controlPointYs(stringPath({ x: 0, y: 0 }, { x: 8000, y: 0 })));

    expect(far).toBeLessThanOrEqual(90);
  });
});

describe('nodeAtPoint', () => {
  const nodes = [
    { id: 'a', x: 0, y: 0 },
    { id: 'b', x: 400, y: 0 },
  ];

  it('finds the node a point falls inside', () => {
    expect(nodeAtPoint(nodes, { x: 450, y: 40 })?.id).toBe('b');
  });

  it('counts the edges as inside, so aiming at a port lands on its node', () => {
    expect(nodeAtPoint(nodes, { x: 0, y: 0 })?.id).toBe('a');
    expect(nodeAtPoint(nodes, { x: NODE_WIDTH, y: NODE_HEIGHT })?.id).toBe('a');
  });

  it('answers with nothing over empty canvas', () => {
    expect(nodeAtPoint(nodes, { x: 300, y: 300 })).toBeNull();
  });

  /** Later nodes are painted over earlier ones, so that is the one you mean. */
  it('picks the node drawn on top where two overlap', () => {
    const stacked = [
      { id: 'under', x: 0, y: 0 },
      { id: 'over', x: 10, y: 10 },
    ];

    expect(nodeAtPoint(stacked, { x: 50, y: 50 })?.id).toBe('over');
  });
});

describe('contentBounds', () => {
  it('wraps the nodes with a margin on every side', () => {
    expect(contentBounds([node(100, 200), node(500, 600)])).toEqual({
      minX: 100 - PAN_MARGIN,
      minY: 200 - PAN_MARGIN,
      maxX: 500 + NODE_WIDTH + PAN_MARGIN,
      maxY: 600 + NODE_HEIGHT + PAN_MARGIN,
    });
  });

  it('gives an empty map one node of space to drop into', () => {
    expect(contentBounds([])).toEqual({ minX: 0, minY: 0, maxX: NODE_WIDTH, maxY: NODE_HEIGHT });
  });
});

describe('clampOffset', () => {
  const bounds = { minX: 0, minY: 0, maxX: 2000, maxY: 2000 };
  const viewport = { x: 800, y: 600 };

  it('leaves an offset that is already inside alone', () => {
    expect(clampOffset({ x: -300, y: -200 }, bounds, viewport)).toEqual({ x: -300, y: -200 });
  });

  it('refuses to pan past the start of the content', () => {
    // Dragging right and right again must not open empty space before the map.
    expect(clampOffset({ x: 900, y: 0 }, bounds, viewport).x).toBeCloseTo(0);
  });

  it('refuses to pan past the end of the content', () => {
    expect(clampOffset({ x: -9000, y: 0 }, bounds, viewport).x).toBe(viewport.x - bounds.maxX);
  });

  /**
   * With less content than screen there is nothing to pan, and jamming it
   * against one edge would be an arbitrary answer to a question with a better
   * one.
   */
  it('centres content smaller than the viewport instead of pinning it', () => {
    const small = { minX: 0, minY: 0, maxX: 200, maxY: 100 };

    expect(clampOffset({ x: 5000, y: -5000 }, small, viewport)).toEqual({ x: 300, y: 250 });
  });
});

describe('toCanvas', () => {
  it('is the plain inverse of the transform at life size', () => {
    expect(toCanvas({ x: 150, y: 90 }, { x: 50, y: 20 }, 1)).toEqual({ x: 100, y: 70 });
  });

  /** The bug this exists to stop: a click landing where the map is not. */
  it('undoes the zoom as well as the pan', () => {
    expect(toCanvas({ x: 150, y: 90 }, { x: 50, y: 20 }, 2)).toEqual({ x: 50, y: 35 });
  });
});

describe('fitView', () => {
  const wide = [node(0, 0), node(2000, 1200)];

  it('zooms out far enough to show the whole map', () => {
    const view = fitView(wide, { x: 600, y: 400 });
    const bounds = contentBounds(wide);

    expect((bounds.maxX - bounds.minX) * view.scale).toBeLessThanOrEqual(600.001);
    expect((bounds.maxY - bounds.minY) * view.scale).toBeLessThanOrEqual(400.001);
    // And not further than it had to: one of the two axes should be filled.
    expect(view.scale).toBeGreaterThan(MIN_ZOOM);
  });

  it('puts the middle of the content in the middle of the frame', () => {
    const viewport = { x: 600, y: 400 };
    const view = fitView(wide, viewport);
    const bounds = contentBounds(wide);
    const centre = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };

    expect(centre.x * view.scale + view.offset.x).toBeCloseTo(viewport.x / 2);
    expect(centre.y * view.scale + view.offset.y).toBeCloseTo(viewport.y / 2);
  });

  /** A two-node map blown up to fill a wide screen looks broken, not helpful. */
  it('never magnifies past life size', () => {
    expect(fitView([node(0, 0)], { x: 4000, y: 3000 }).scale).toBe(1);
  });

  it('answers harmlessly before the frame has been measured', () => {
    expect(fitView(wide, { x: 0, y: 0 })).toEqual({ offset: { x: 0, y: 0 }, scale: 1 });
  });
});

describe('centreOn', () => {
  it('puts the middle of the node in the middle of the frame', () => {
    const offset = centreOn({ x: 400, y: 200 }, { x: 800, y: 600 }, 1);

    expect(400 + NODE_WIDTH / 2 + offset.x).toBe(400);
    expect(200 + NODE_HEIGHT / 2 + offset.y).toBe(300);
  });
});

describe('alignLayers', () => {
  const box = (id: string, isRoot = false) => ({ id, isRoot, title: id });

  /** Root → a, b; a → c. Two at depth 1, one at depth 2. */
  const tree = {
    nodes: [box('root', true), box('a'), box('b'), box('c')],
    edges: [
      { parentId: 'root', childId: 'a' },
      { parentId: 'root', childId: 'b' },
      { parentId: 'a', childId: 'c' },
    ],
  };

  const placed = () => new Map(alignLayers(tree.nodes, tree.edges).map((at) => [at.id, at]));

  it('gives every node at the same depth the same x', () => {
    const at = placed();

    expect(at.get('a')!.x).toBe(at.get('b')!.x);
    expect(at.get('a')!.x).toBeGreaterThan(at.get('root')!.x);
    expect(at.get('c')!.x).toBeGreaterThan(at.get('a')!.x);
  });

  it('leaves no two boxes in a column overlapping', () => {
    const at = placed();

    expect(Math.abs(at.get('a')!.y - at.get('b')!.y)).toBeGreaterThanOrEqual(NODE_HEIGHT);
  });

  it('places every node exactly once', () => {
    expect(alignLayers(tree.nodes, tree.edges)).toHaveLength(4);
  });

  /**
   * The barycentre heuristic: a child is ordered by where its parents sit, so a
   * column comes out in an order whose strings do not cross for no reason.
   */
  it('orders a column by where its parents are, not by name', () => {
    const nodes = [box('root', true), box('alpha'), box('beta'), box('amber'), box('zulu')];
    const edges = [
      { parentId: 'root', childId: 'alpha' },
      { parentId: 'root', childId: 'beta' },
      // Depth 1 ties on barycentre — both hang off the root — so it falls to the
      // name: alpha above beta. Depth 2 then has a real answer, and it disagrees
      // with the name: zulu's parent is the upper of the two, amber's the lower.
      { parentId: 'alpha', childId: 'zulu' },
      { parentId: 'beta', childId: 'amber' },
    ];

    const at = new Map(alignLayers(nodes, edges).map((place) => [place.id, place]));

    expect(at.get('alpha')!.y).toBeLessThan(at.get('beta')!.y);
    expect(at.get('zulu')!.y).toBeLessThan(at.get('amber')!.y);
  });

  /** On the canvas but not in the course: tidied aside rather than into the tree. */
  it('keeps unreachable nodes in a column of their own, past the end', () => {
    const nodes = [box('root', true), box('a'), box('loose')];
    const edges = [{ parentId: 'root', childId: 'a' }];

    const at = new Map(alignLayers(nodes, edges).map((place) => [place.id, place]));

    expect(at.get('loose')!.x).toBeGreaterThan(at.get('a')!.x);
  });

  it('answers with nothing when there is no root to walk from', () => {
    expect(alignLayers([box('a'), box('b')], [])).toHaveLength(2);
  });
});

describe('gridStep', () => {
  const TIGHT = 20;
  const LOOSE = 80;

  it.each([0.2, 0.35, 0.5, 1, 1.5, 2])('keeps the square readable at %s', (scale) => {
    const onScreen = gridStep(scale) * scale;

    expect(onScreen).toBeGreaterThanOrEqual(TIGHT);
    expect(onScreen).toBeLessThanOrEqual(LOOSE);
  });

  it('leaves the square alone at life size', () => {
    expect(gridStep(1)).toBe(GRID_BASE);
  });

  /** Doubling, so zooming back out returns to the lines you started with. */
  it('changes the square by powers of two', () => {
    const ratio = gridStep(0.25) / GRID_BASE;

    expect(Math.log2(ratio) % 1).toBe(0);
  });
});

describe('searchNodes', () => {
  const named = (title: string) => ({ id: title, title });
  const map = [
    named('General content'),
    named('Bee keeping'),
    named('Bees'),
    named('Bees: advanced'),
    named('Woodwork'),
  ];

  const titles = (query: string) => searchNodes(map, query).map((node) => node.title);

  it('offers nothing until something is typed', () => {
    expect(searchNodes(map, '   ')).toEqual([]);
  });

  it('puts an exact name first', () => {
    expect(titles('bees')[0]).toBe('Bees');
  });

  it('prefers a name that starts with what was typed', () => {
    expect(titles('bee').slice(0, 3)).toEqual(['Bees', 'Bee keeping', 'Bees: advanced']);
  });

  /** So "keep" still finds "Bee keeping", which starts with a different word. */
  it('matches a word inside the name', () => {
    expect(titles('keep')).toContain('Bee keeping');
  });

  /** The near miss: the letters are there, in order, but not together. */
  it('still finds a name whose letters are only in order', () => {
    expect(titles('bkeep')).toContain('Bee keeping');
  });

  it('answers with nothing when no name comes close', () => {
    expect(titles('zzzz')).toEqual([]);
  });

  it('is capped, so one letter does not return the whole map', () => {
    const many = Array.from({ length: 40 }, (_, index) => named(`Node ${index}`));

    expect(searchNodes(many, 'node')).toHaveLength(SEARCH_LIMIT);
  });
});
