/**
 * File: map-canvas.test.tsx
 * Description: Component tests for pulling a string between two nodes on the
 *   course map, which pointer capture makes impossible to do by hover alone.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-09-22
 */
import { fireEvent, render, screen } from '@testing-library/react';

import MapCanvas from '@/pages/private/admin/editor/course-map/map-canvas';
import { NODE_HEIGHT, NODE_WIDTH } from '@/pages/private/admin/editor/course-map/map-geometry';
import type { MapNode } from '@/services/course-map-api';

/**
 * The frame the canvas measures itself against.
 *
 * jsdom lays nothing out, so every rect is zero and the canvas would believe it
 * had no viewport. Stubbed at the origin so a client coordinate and a canvas
 * coordinate are the same number, which keeps these tests readable.
 */
function stubLayout() {
  jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    width: 1200,
    height: 800,
    right: 1200,
    bottom: 800,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
}

const node = (id: string, x: number, y: number, isRoot = false): MapNode => ({
  id,
  title: id,
  x,
  y,
  depth: isRoot ? 0 : 1,
  isRoot,
  items: [],
});

const nodes = [node('root', 0, 0, true), node('bees', 400, 0), node('woods', 800, 0)];

/**
 * How far the canvas has panned itself, read back off the layer's transform.
 *
 * The canvas centres content smaller than the viewport, so it is never at the
 * origin — and a client coordinate is a canvas coordinate plus this. Read from
 * the DOM rather than assumed, so these tests aim where a person would click
 * rather than where the maths happens to be today.
 */
function canvasOffset(): { x: number; y: number } {
  const layer = document.querySelector<HTMLElement>('[style*="translate"]');
  const found = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(layer?.style.transform ?? '');
  return { x: Number(found?.[1] ?? 0), y: Number(found?.[2] ?? 0) };
}

/** A point inside a node, as a cursor position on the page. */
function onNode(target: MapNode, dx = NODE_WIDTH / 2, dy = NODE_HEIGHT / 2) {
  const offset = canvasOffset();
  return { clientX: target.x + dx + offset.x, clientY: target.y + dy + offset.y };
}

function setup(overrides: Partial<React.ComponentProps<typeof MapCanvas>> = {}) {
  const props = {
    nodes,
    edges: [],
    selectedNodeId: null,
    onSelect: jest.fn(),
    onMove: jest.fn(),
    onConnect: jest.fn(),
    onDisconnect: jest.fn(),
    onAddNode: jest.fn(),
    onDeleteNode: jest.fn(),
    onLayout: jest.fn(),
    onDropSections: jest.fn(),
    ...overrides,
  };

  render(<MapCanvas {...props} />);
  return props;
}

/**
 * Pulling a string: press the source node's connector, move to a point, release.
 *
 * Every event after the press goes to the port, because that is what pointer
 * capture means — which is exactly the thing that used to break this. The
 * component has to work out what is under the cursor from coordinates, so the
 * moves are deliberately sent to the port rather than to the node being aimed at.
 */
function pullString(from: string, to: { clientX: number; clientY: number }) {
  const port = screen.getByLabelText(`Connect from ${from}`);
  const source = nodes.find((current) => current.id === from)!;

  fireEvent.pointerDown(port, { pointerId: 1, ...onNode(source, NODE_WIDTH) });
  fireEvent.pointerMove(port, { pointerId: 1, ...to });
  fireEvent.pointerUp(port, { pointerId: 1, ...to });
}

beforeEach(stubLayout);
afterEach(() => jest.restoreAllMocks());

describe('pulling a string between nodes', () => {
  it('connects when the string is released over another node', () => {
    const { onConnect } = setup();

    pullString('root', onNode(nodes[1]));

    expect(onConnect).toHaveBeenCalledWith('root', 'bees');
  });

  it('connects to whichever node the cursor is actually over, not the nearest', () => {
    const { onConnect } = setup();

    pullString('root', onNode(nodes[2]));

    expect(onConnect).toHaveBeenCalledWith('root', 'woods');
  });

  it('lands on a node anywhere inside its box, not only dead centre', () => {
    const { onConnect } = setup();

    // The top-left corner, by the input dot, which is where somebody aiming at
    // that dot would actually let go.
    pullString('root', onNode(nodes[1], 1, 1));

    expect(onConnect).toHaveBeenCalledWith('root', 'bees');
  });

  it('does nothing when the string is released over empty canvas', () => {
    const { onConnect } = setup();

    // Well clear of all three boxes, which sit in a row across the top.
    pullString('root', onNode(nodes[2], NODE_WIDTH + 300, NODE_HEIGHT + 300));

    expect(onConnect).not.toHaveBeenCalled();
  });

  it('refuses to land on the root, which nothing may come before', () => {
    const { onConnect } = setup();

    pullString('bees', onNode(nodes[0]));

    expect(onConnect).not.toHaveBeenCalled();
  });

  it('refuses to land back on the node it came from', () => {
    const { onConnect } = setup();

    pullString('bees', onNode(nodes[1]));

    expect(onConnect).not.toHaveBeenCalled();
  });

  /** The root is where every learner starts, so it is given nothing to drop on. */
  it('draws an input dot on every node except the root', () => {
    setup();

    expect(screen.getByLabelText('Connect from root')).toBeInTheDocument();
    expect(screen.queryByTestId('input-port-root')).not.toBeInTheDocument();
    expect(screen.getByTestId('input-port-bees')).toBeInTheDocument();
  });
});

describe('moving a node', () => {
  it('reports the new position once, when the drag ends', () => {
    const { onMove } = setup();
    const box = screen.getByRole('button', { name: /^bees/ });

    fireEvent.pointerDown(box, { pointerId: 2, clientX: 500, clientY: 50 });
    fireEvent.pointerMove(box, { pointerId: 2, clientX: 560, clientY: 130 });
    expect(onMove).not.toHaveBeenCalled();

    fireEvent.pointerUp(box, { pointerId: 2, clientX: 560, clientY: 130 });

    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove).toHaveBeenCalledWith('bees', 460, 80);
  });

  /** A click that registers as a nought-pixel drag is a click, not a reorder. */
  it('says nothing when the node did not actually move', () => {
    const { onMove } = setup();
    const box = screen.getByRole('button', { name: /^bees/ });

    fireEvent.pointerDown(box, { pointerId: 3, clientX: 500, clientY: 50 });
    fireEvent.pointerUp(box, { pointerId: 3, clientX: 500, clientY: 50 });

    expect(onMove).not.toHaveBeenCalled();
  });
});
