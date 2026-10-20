/**
 * File: map-canvas.tsx
 * Description: The pannable, zoomable 2D map: its toolbar, nodes, drooping connections and the string you pull.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-09-22
 */
/**
 * The map itself, and the toolbar that drives it.
 *
 * Three gestures live here and they must not be confused with each other:
 * dragging the background pans the canvas, dragging a node moves it, and
 * dragging from a node's right-hand circle pulls a string to another node's
 * left-hand dot. Each starts on a different element and each takes the pointer
 * for its duration, which is what keeps them apart without a mode switch.
 *
 * Pointer events rather than HTML5 drag-and-drop, deliberately. The lists on the
 * left use native drag because they are lists and the browser's drag is what a
 * list wants; a canvas needs continuous coordinates during the gesture, which is
 * exactly what native drag does not give you.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO COORDINATE SYSTEMS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Nodes are stored in canvas coordinates; pointers arrive in screen pixels; and
 * since the map can be zoomed, the two are no longer the same number. Every
 * conversion goes through `toCanvas` in map-geometry, and the pan offset is kept
 * in screen pixels throughout — which is why the bounds it is clamped against
 * are run through `scaleBounds` first. Getting this wrong does not throw: it
 * pins the map against an edge that is not where the content is, which is the
 * kind of bug that reads as "the map feels odd at 50%".
 *
 * The one thing the toolbar does not own is what the map *means*. Zooming,
 * recentring and searching change nothing about the course; aligning the layers
 * is the exception and says so, because `x` is reading order.
 */
import {
  ArrowsPointingInIcon,
  MagnifyingGlassIcon,
  MagnifyingGlassMinusIcon,
  MagnifyingGlassPlusIcon,
  PlusIcon,
  TrashIcon,
  ViewColumnsIcon,
} from '@heroicons/react/24/outline';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { readDrag } from '@/pages/private/admin/editor/course-map/drag-payload';
import {
  alignLayers,
  centreOn,
  clampOffset,
  clampZoom,
  CONNECT_REACH,
  contentBounds,
  fitView,
  gridStep,
  inputPort,
  MAX_ZOOM,
  MIN_ZOOM,
  NODE_HEIGHT,
  NODE_WIDTH,
  nodeAtPoint,
  outputPort,
  type Placement,
  type Point,
  scaleBounds,
  searchNodes,
  stringPath,
  toCanvas,
  ZOOM_STEP,
} from '@/pages/private/admin/editor/course-map/map-geometry';
import type { MapEdge, MapNode } from '@/services/course-map-api';

/** Which gesture currently owns the pointer, and what it needs to remember. */
type Gesture =
  | { kind: 'pan'; from: Point; offset: Point }
  | {
      kind: 'node';
      nodeId: string;
      origin: Point;
      /** Where on the node it was picked up, so it stays under the pointer as the view moves. */
      grab: Point;
    }
  | { kind: 'string'; parentId: string; to: Point }
  | null;

/**
 * How long a searched-for node keeps its extra ring.
 *
 * Long enough to find with your eye after the map has moved under you, short
 * enough that it is plainly an answer to the search rather than a new permanent
 * state of that node. The node is also selected, and that highlight stays.
 */
const FOUND_MS = 2500;

/**
 * Dragging a node this close to the frame's edge, in screen pixels, scrolls the
 * map along with it — so a node can be carried somewhere that was off screen
 * when the drag began, and the view keeps the node in sight on the way.
 */
const EDGE_ZONE = 48;
/**
 * The most the view moves per pointer event, reached only right at the edge.
 *
 * Ramped rather than constant: pointer events arrive sixty-plus times a second,
 * so a flat 18px a step sent the map flying the moment the node touched the
 * zone. Easing in from nothing at the zone's inner edge lets the author nudge
 * the view a little or carry it further by pushing closer.
 */
const EDGE_SPEED = 6;

/** How far to scroll along one axis for a pointer `at` pixels into a frame `size` wide. */
function edgePush(at: number, size: number): number {
  if (at < EDGE_ZONE) return EDGE_SPEED * (1 - Math.max(at, 0) / EDGE_ZONE);
  if (at > size - EDGE_ZONE) return -EDGE_SPEED * (1 - Math.max(size - at, 0) / EDGE_ZONE);
  return 0;
}

interface MapCanvasProps {
  nodes: MapNode[];
  edges: MapEdge[];
  selectedNodeId: string | null;
  onSelect: (nodeId: string) => void;
  /** Fired once, when a node is let go of — not on every pixel of the drag. */
  onMove: (nodeId: string, x: number, y: number) => void;
  onConnect: (parentId: string, childId: string) => void;
  onDisconnect: (parentId: string, childId: string) => void;
  onAddNode: () => void;
  onDeleteNode: (node: MapNode) => void;
  /**
   * Every node's new position at once, from Align layers.
   *
   * One call rather than a move each: `x` is the learner's reading order, so a
   * run of single moves would rebuild the layer quizzes once per node off a
   * half-tidied map.
   */
  onLayout: (positions: Placement[]) => void;
  /**
   * Sections dropped from one of the lists onto a node.
   *
   * A list because a drag can carry a whole selection — see drag-payload.ts. One
   * section is a list of one, so there is no second path to keep in step.
   */
  onDropSections: (nodeId: string, sectionIds: string[]) => void;
}

const MapCanvas = ({
  nodes,
  edges,
  selectedNodeId,
  onSelect,
  onMove,
  onConnect,
  onDisconnect,
  onAddNode,
  onDeleteNode,
  onLayout,
  onDropSections,
}: MapCanvasProps) => {
  const frame = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
  /** 1 is life size. Never applied to what is stored — only to how it is drawn. */
  const [scale, setScale] = useState(1);
  const [gesture, setGesture] = useState<Gesture>(null);
  /**
   * The same gesture, readable without waiting for a render.
   *
   * Every pointer event reaches two handlers — the node or port it landed on,
   * and the frame it bubbles up to — and React has not re-rendered in between,
   * so a release read from state would be seen as live by both and the move or
   * the connection would be sent twice. Clearing this is what makes ending a
   * gesture happen once however many handlers the event passes through.
   */
  const gestureRef = useRef<Gesture>(null);

  /** Sets both, so nothing has to remember to. */
  const beginGesture = (next: Gesture) => {
    gestureRef.current = next;
    setGesture(next);
  };
  const [viewport, setViewport] = useState<Point>({ x: 0, y: 0 });
  /**
   * Where a node is while it is being dragged, before the server hears about it.
   *
   * Local because a drag is sixty updates a second and the server needs one:
   * the node renders from here until the pointer comes up, and from the real
   * data afterwards.
   */
  const [dragged, setDragged] = useState<Record<string, Point>>({});
  /**
   * The newest pan, readable inside a pointer handler that has just changed it.
   * Edge-scrolling moves the view and the node in the same event, and the node
   * has to be placed against the view as it now is, not as the last render saw it.
   */
  const offsetRef = useRef(offset);
  offsetRef.current = offset;
  /** The node the cursor is over while a string or a section is being dragged. */
  const [hovered, setHovered] = useState<string | null>(null);
  /**
   * The connection the pointer is resting on, which is what shows its cut
   * button. The button alone is a 20px target in the middle of a long string,
   * and finding it by sweeping the cursor about was the complaint.
   */
  const [hoveredEdge, setHoveredEdge] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  /** The node the last search landed on, briefly ringed. See `FOUND_MS`. */
  const [foundId, setFoundId] = useState<string | null>(null);
  const [searchMiss, setSearchMiss] = useState(false);
  /** Whether the suggestion list is down. Closed by a pick, Escape, or a blur. */
  const [suggesting, setSuggesting] = useState(false);
  /** Which suggestion the arrow keys are on, so Enter can take it. */
  const [highlighted, setHighlighted] = useState(0);
  /**
   * What is in the zoom box while it is being typed in.
   *
   * Held apart from `scale` because the two disagree mid-edit and both are
   * right: clearing the box to type "150" leaves it momentarily empty, and a
   * field driven straight off the number would refuse that and snap back to 20%
   * on the first keystroke. Null means "not being edited", and the box shows the
   * real zoom.
   */
  const [zoomDraft, setZoomDraft] = useState<string | null>(null);

  const positionOf = (node: MapNode): Point => dragged[node.id] ?? { x: node.x, y: node.y };

  /**
   * The extent of the map as it is drawn right now, the node being dragged
   * included. Measured from stored positions alone, the frame lagged behind a
   * moved node: carry one past the edge and the map would not pan out to it.
   */
  const bounds = contentBounds(nodes.map((node) => ({ ...node, ...positionOf(node) })));
  /** The same bounds in screen pixels, which is what the offset is measured in. */
  const panBounds = useMemo(
    () => scaleBounds(bounds, scale),
    [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY, scale],
  );

  useLayoutEffect(() => {
    const measure = () => {
      const box = frame.current?.getBoundingClientRect();
      if (box) setViewport({ x: box.width, y: box.height });
    };

    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  // Kept inside the bounds whenever they change under it — a node deleted from
  // the edge of the map shrinks the world, and the view has to come back with it.
  // Not while a node is being carried: the bounds move with it, and re-fitting
  // the view under the pointer mid-drag would shake the whole map. It settles
  // once the node is let go.
  useEffect(() => {
    if (gesture?.kind === 'node') return;
    setOffset((current) => clampOffset(current, panBounds, viewport));
  }, [panBounds, viewport.x, viewport.y, gesture?.kind]);

  // The found ring is a moment, not a state. Cleared on a timer, and on the next
  // search, so two searches in a row never leave two nodes ringed.
  useEffect(() => {
    if (!foundId) return;
    const timer = window.setTimeout(() => setFoundId(null), FOUND_MS);
    return () => window.clearTimeout(timer);
  }, [foundId]);

  /** Canvas coordinates for a pointer, which is what every gesture works in. */
  const pointAt = useCallback(
    (event: { clientX: number; clientY: number }): Point => {
      const box = frame.current?.getBoundingClientRect();
      if (!box) return { x: 0, y: 0 };
      return toCanvas({ x: event.clientX - box.left, y: event.clientY - box.top }, offset, scale);
    },
    [offset, scale],
  );

  // ---- Toolbar ----

  /**
   * Zooms about the middle of the frame.
   *
   * The centre is held still rather than the origin, because the middle of the
   * frame is what somebody is looking at: zooming about the origin slides
   * whatever they were studying off the edge and makes the button feel like it
   * did two things.
   */
  const zoomTo = (next: number) => {
    const middle = { x: viewport.x / 2, y: viewport.y / 2 };
    const held = toCanvas(middle, offset, scale);
    const moved = { x: middle.x - held.x * next, y: middle.y - held.y * next };

    setScale(next);
    setOffset(clampOffset(moved, scaleBounds(bounds, next), viewport));
  };

  const zoomBy = (factor: number) => {
    const next = clampZoom(scale * factor);
    if (next !== scale) zoomTo(next);
  };

  /** The whole map at once, its middle in the middle of the frame. */
  const recentre = () => {
    const view = fitView(nodes, viewport);
    setScale(view.scale);
    setOffset(clampOffset(view.offset, scaleBounds(bounds, view.scale), viewport));
  };

  /** Puts one node in the middle without touching the zoom. */
  const bringIntoView = (node: MapNode) => {
    setOffset(clampOffset(centreOn(node, viewport, scale), panBounds, viewport));
  };

  /** What the box would offer right now, best first. See `searchNodes`. */
  const suggestions = useMemo(() => searchNodes(nodes, query), [nodes, query]);

  /**
   * Goes to one node: selects it, rings it, and brings it into the middle.
   *
   * The one place a search lands, whether it was reached by clicking a
   * suggestion or by pressing Enter on the highlighted one, so the two cannot
   * come to mean different things.
   */
  const goTo = (node: MapNode) => {
    setSearchMiss(false);
    setSuggesting(false);
    setQuery(node.title);
    onSelect(node.id);
    setFoundId(node.id);
    bringIntoView(node);
  };

  /** Enter with nothing highlighted: take the best suggestion, or report a miss. */
  const search = () => {
    if (!query.trim()) return;

    const hit = suggestions[highlighted] ?? suggestions[0];
    if (!hit) return setSearchMiss(true);
    goTo(hit);
  };

  /**
   * Typing a zoom directly.
   *
   * Anything outside the range is pulled into it rather than refused, because
   * "200" typed into a box whose ceiling is 200 and "2000" typed by mistake want
   * the same answer, and an error message about a number you can simply be given
   * is noise. A box left with nothing usable in it falls back to the zoom that
   * was already showing.
   */
  const commitZoom = () => {
    const typed = Number((zoomDraft ?? '').replace('%', '').trim());
    setZoomDraft(null);
    if (!Number.isFinite(typed) || typed <= 0) return;

    const next = clampZoom(typed / 100);
    if (next === scale) return;
    zoomTo(next);
  };

  /**
   * Tidies the map into one column per layer.
   *
   * The only toolbar button that changes the course rather than the view, and it
   * says so in its title: everything in a column is offered by one quiz, and `x`
   * within that column is the order the options are listed in.
   */
  const align = () => onLayout(alignLayers(nodes, edges));

  // ---- Gestures ----

  /**
   * The node a string would land on if it were let go here.
   *
   * The root is never a candidate — it is where every learner starts, so nothing
   * can come before it — and neither is the node the string came from.
   */
  const dropTarget = (parentId: string, at: Point): MapNode | null => {
    // Only nodes that could accept the string are asked, so the extra reach
    // around each box never lands on one that would refuse it. A linked map can
    // be led into at its root's copy only; the rest of it is fixed.
    const candidates = nodes
      .filter(
        (node) =>
          !node.isRoot && node.id !== parentId && (!node.linked || node.linked.entry === true),
      )
      .map((node) => ({ ...node, ...positionOf(node) }));
    return nodeAtPoint(candidates, at, CONNECT_REACH / scale);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const gesture = gestureRef.current;
    if (!gesture) return;

    if (gesture.kind === 'pan') {
      const next = {
        x: gesture.offset.x + (event.clientX - gesture.from.x),
        y: gesture.offset.y + (event.clientY - gesture.from.y),
      };
      setOffset(clampOffset(next, panBounds, viewport));
      return;
    }

    if (gesture.kind === 'node') {
      const box = frame.current?.getBoundingClientRect();
      if (!box) return;
      const screen = { x: event.clientX - box.left, y: event.clientY - box.top };

      // Near an edge, the view scrolls towards it so the node can be carried
      // past what was on screen when the drag began.
      const push = {
        x: edgePush(screen.x, box.width),
        y: edgePush(screen.y, box.height),
      };
      let view = offsetRef.current;
      if (push.x !== 0 || push.y !== 0) {
        view = { x: view.x + push.x, y: view.y + push.y };
        offsetRef.current = view;
        setOffset(view);
      }

      // Placed against the view as it now stands, at the point it was picked up
      // by, so the node stays under the pointer however the map has moved.
      const at = toCanvas(screen, view, scale);
      setDragged((current) => ({
        ...current,
        [gesture.nodeId]: {
          x: Math.round(at.x - gesture.grab.x),
          y: Math.round(at.y - gesture.grab.y),
        },
      }));
      return;
    }

    const to = pointAt(event);
    beginGesture({ ...gesture, to });
    // Worked out from coordinates rather than from the pointer entering a node:
    // the capture taken when the string started means no other element is ever
    // told the cursor arrived. See `dropTarget`.
    setHovered(dropTarget(gesture.parentId, to)?.id ?? null);
  };

  const endGesture = () => {
    // Taken and cleared in one step: the event is about to reach this again on
    // its way up, and the second pass must find nothing to do.
    const gesture = gestureRef.current;
    gestureRef.current = null;

    if (gesture?.kind === 'node') {
      const moved = dragged[gesture.nodeId];
      // Only told when it actually went somewhere. A click that happens to
      // register as a one-pixel drag should not count as reordering the course.
      if (moved && (moved.x !== gesture.origin.x || moved.y !== gesture.origin.y)) {
        onMove(gesture.nodeId, moved.x, moved.y);
      }
      setDragged({});
    }

    if (gesture?.kind === 'string') {
      // Resolved from the gesture's own last point rather than from `hovered`,
      // so releasing acts on where the string actually is and never on a
      // highlight that a render has not caught up with.
      const target = dropTarget(gesture.parentId, gesture.to);
      if (target) onConnect(gesture.parentId, target.id);
    }

    setGesture(null);
    setHovered(null);
  };

  const edgeKey = (edge: MapEdge) => `${edge.parentId}->${edge.childId}`;
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  /**
   * Linked nodes the source's map already leads on from. Those are fixed; a
   * linked node at the end of its map may lead on to this course's own nodes.
   */
  const branchingLinked = new Set(edges.filter((edge) => edge.locked).map((edge) => edge.parentId));

  /** One toolbar button. Uniform, so the strip reads as one control. */
  const tool = (label: string, Icon: typeof PlusIcon, onClick: () => void, extra?: string) => (
    <Button
      onClick={onClick}
      variant="ghost"
      size="icon"
      title={label}
      aria-label={label}
      // Smaller than a standalone icon button so the strip lines up with the
      // Add node button beside it rather than standing a few pixels taller.
      className={`h-8 w-8 shrink-0 text-dark-gray hover:bg-navy/10 ${extra ?? ''}`}
    >
      <Icon className="w-5 h-5" />
    </Button>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/*
        The map's toolbar.

        Everything that acts on the map sits in one strip beside Add node, rather
        than being scattered around the edges of the canvas: they are one set of
        controls for one object, and an author looking for "how do I tidy this"
        should find it next to the last thing they pressed. Zoom, recentre and
        search change only the view; Align layers changes the course and is
        titled accordingly.
      */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button onClick={onAddNode} variant="outline" className="shrink-0 gap-2 bg-white">
          <PlusIcon className="w-5 h-5 stroke-2" /> Add node
        </Button>

        <div
          className="flex shrink-0 items-center gap-1 rounded-lg border-2 border-navy/20 bg-white
            px-1 py-0.5"
        >
          {tool('Zoom out', MagnifyingGlassMinusIcon, () => zoomBy(1 / ZOOM_STEP))}

          {/*
            Typed as well as read.

            The buttons step by a fixed ratio, which is the wrong tool for "show
            me this at half size": getting there takes three presses and lands
            near it rather than on it. So the readout is a field. It commits on
            blur and on Enter, and anything outside the range is pulled into it
            rather than refused — see `commitZoom`.
          */}
          <label className="flex shrink-0 items-center">
            <span className="sr-only">
              Zoom, as a percentage between {Math.round(MIN_ZOOM * 100)} and{' '}
              {Math.round(MAX_ZOOM * 100)}
            </span>
            <input
              type="text"
              inputMode="numeric"
              value={zoomDraft ?? `${Math.round(scale * 100)}%`}
              onFocus={(event) => {
                setZoomDraft(String(Math.round(scale * 100)));
                // Selected on arrival, so typing replaces the number rather than
                // appending to it — the whole value is what is being set.
                event.currentTarget.select();
              }}
              onChange={(event) => setZoomDraft(event.target.value)}
              onBlur={commitZoom}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  commitZoom();
                  event.currentTarget.blur();
                }
                // Escape abandons the edit: the draft goes and the box refills
                // from the zoom that is actually in force.
                if (event.key === 'Escape') {
                  setZoomDraft(null);
                  event.currentTarget.blur();
                }
              }}
              title={`Zoom, between ${Math.round(MIN_ZOOM * 100)}% and ${Math.round(MAX_ZOOM * 100)}%`}
              className="w-14 shrink-0 rounded-md border border-transparent bg-transparent px-1
                py-0.5 text-center text-xs font-semibold text-dark-gray tabular-nums
                hover:border-navy/20 focus:border-navy/40 focus:bg-light-gray focus:outline-none"
            />
          </label>

          {tool('Zoom in', MagnifyingGlassPlusIcon, () => zoomBy(ZOOM_STEP))}

          <span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-navy/20" />

          {tool('Recentre the map, and zoom out to show all of it', ArrowsPointingInIcon, recentre)}
          {tool(
            'Align layers — lay every node out in one column per layer. This moves the nodes, ' +
              'and a node’s position is the order its quiz offers it in.',
            ViewColumnsIcon,
            align,
          )}
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            search();
          }}
          className="relative min-w-48 flex-1"
          role="search"
        >
          <MagnifyingGlassIcon
            className="absolute top-1/2 left-3 w-5 h-5 -translate-y-1/2 text-dark-gray"
            aria-hidden="true"
          />
          <Input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSearchMiss(false);
              setSuggesting(true);
              setHighlighted(0);
            }}
            onFocus={() => setSuggesting(true)}
            // Closed on the way out, but not immediately: a click on a suggestion
            // blurs the field before it lands, and tearing the list down first
            // would mean the click never reached anything. One frame is enough
            // for the pointer to finish what it started.
            onBlur={() => window.setTimeout(() => setSuggesting(false), 120)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') return setSuggesting(false);
              if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;

              event.preventDefault();
              setSuggesting(true);
              setHighlighted((current) => {
                const last = suggestions.length - 1;
                if (last < 0) return 0;
                const step = event.key === 'ArrowDown' ? 1 : -1;
                // Wrapped, so holding one arrow cycles rather than sticking at
                // an end the author cannot see they have reached.
                return (current + step + suggestions.length) % suggestions.length;
              });
            }}
            placeholder="Search nodes"
            aria-label="Search the map for a node"
            role="combobox"
            aria-expanded={suggesting && suggestions.length > 0}
            aria-controls="map-search-suggestions"
            autoComplete="off"
            className={`bg-white pl-10 ${searchMiss ? 'border-danger' : ''}`}
          />

          {/*
            The shortlist.

            Typing a name in full and pressing Enter is the slower half of
            searching a map: the author is usually looking for a node whose name
            they half remember, and the useful answer is the handful it could be.
            So the matches are offered as a list to click — ranked by how well
            each answers what has been typed, near misses included, which is what
            `matchRank` is for.
          */}
          {suggesting && suggestions.length > 0 && (
            <ul
              id="map-search-suggestions"
              role="listbox"
              className="absolute top-full right-0 left-0 z-20 mt-1 max-h-64 overflow-y-auto
                rounded-lg border-2 border-navy/20 bg-white py-1 shadow-lg"
            >
              {suggestions.map((node, index) => (
                <li key={node.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={index === highlighted}
                    // `onMouseDown` rather than `onClick`: the field's blur fires
                    // first otherwise, and on a list that closes on blur the
                    // click would land on nothing.
                    onMouseDown={(event) => {
                      event.preventDefault();
                      goTo(node);
                    }}
                    onMouseEnter={() => setHighlighted(index)}
                    className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left
                    text-sm ${index === highlighted ? 'bg-navy/10' : 'hover:bg-light-gray'}`}
                  >
                    <span className="min-w-0 flex-1 truncate font-medium text-dark-gray">
                      {node.title}
                    </span>
                    <span className="shrink-0 text-xs text-dark-gray">
                      {node.isRoot ? 'Root' : `Layer ${node.depth || '—'}`} · {node.items.length}{' '}
                      item{node.items.length === 1 ? '' : 's'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </form>
      </div>

      {searchMiss && (
        <p className="mb-3 text-sm font-semibold text-danger">No node on this map matches that.</p>
      )}

      <div
        ref={frame}
        // `touch-none` so a drag on a tablet pans the map rather than the page.
        className={`relative min-h-0 flex-1 touch-none overflow-hidden rounded-lg border-2
          border-navy/20 bg-light-gray
          ${gesture?.kind === 'pan' ? 'cursor-grabbing' : 'cursor-grab'}`}
        /*
          The grid is painted on the frame rather than on the layer that moves,
          because the layer has no size of its own — it is a zero-sized origin
          that its children are positioned against, so a background on it would
          have nothing to tile. Panning it is therefore a matter of moving the
          background's origin by the same offset, and zooming it a matter of
          scaling the square; between them the paper stays stuck to the map.
        */
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(31,58,95,0.08) 1px, transparent 1px),' +
            'linear-gradient(to bottom, rgba(31,58,95,0.08) 1px, transparent 1px)',
          backgroundSize: `${gridStep(scale) * scale}px ${gridStep(scale) * scale}px`,
          backgroundPosition: `${offset.x}px ${offset.y}px`,
        }}
        onPointerDown={(event) => {
          // Only the background pans; a node or a port has already stopped this.
          if (event.target !== event.currentTarget) return;
          (event.target as HTMLElement).setPointerCapture(event.pointerId);
          beginGesture({ kind: 'pan', from: { x: event.clientX, y: event.clientY }, offset });
        }}
        onPointerMove={onPointerMove}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
      >
        {/*
          Everything below moves as one. Panning changes this transform and
          nothing else, so no node has to know where the view is. The origin is
          pinned to the top-left so that `toCanvas` is a plain inverse of it —
          the default origin is the centre of the element, which for a zero-sized
          layer is a point that moves as its children do.
        */}
        <div
          className="absolute top-0 left-0"
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
            transformOrigin: '0 0',
          }}
        >
          <svg
            className="pointer-events-none absolute overflow-visible"
            style={{ left: 0, top: 0, width: 1, height: 1 }}
            aria-hidden="true"
          >
            {edges.map((edge) => {
              const parent = nodeById.get(edge.parentId);
              const child = nodeById.get(edge.childId);
              if (!parent || !child) return null;

              const key = edgeKey(edge);
              const d = stringPath(outputPort(positionOf(parent)), inputPort(positionOf(child)));
              const lit = hoveredEdge === key;

              // A linked map's connections are red: fixed, and owned elsewhere.
              return (
                <g key={key}>
                  <path
                    d={d}
                    fill="none"
                    stroke={edge.locked ? '#dc2626' : '#1f3a5f'}
                    strokeOpacity={edge.locked ? 0.85 : lit ? 0.9 : 0.55}
                    strokeWidth={edge.locked ? 2.5 : lit ? 3 : 2}
                    strokeLinecap="round"
                  />
                  {/* A wide, invisible band along the string that picks up the
                      hover, so the whole length of it reveals the cut button.
                      It still pans like the background when dragged, so the
                      strip it covers is not lost to moving the view. Locked
                      connections cannot be cut and so get no band. */}
                  {!edge.locked && (
                    <path
                      d={d}
                      fill="none"
                      stroke="transparent"
                      strokeWidth={14}
                      pointerEvents="stroke"
                      onPointerEnter={() => setHoveredEdge(key)}
                      onPointerLeave={() =>
                        setHoveredEdge((current) => (current === key ? null : current))
                      }
                      onPointerDown={(event) => {
                        event.currentTarget.setPointerCapture(event.pointerId);
                        beginGesture({
                          kind: 'pan',
                          from: { x: event.clientX, y: event.clientY },
                          offset,
                        });
                      }}
                    />
                  )}
                </g>
              );
            })}

            {/* The string currently being pulled, drawn by the same function so
                it cannot look different from the connection it becomes. */}
            {gesture?.kind === 'string' && (
              <path
                d={stringPath(
                  outputPort(positionOf(nodeById.get(gesture.parentId) ?? nodes[0])),
                  gesture.to,
                )}
                fill="none"
                stroke="#1f3a5f"
                strokeWidth={2}
                strokeDasharray="6 5"
                strokeLinecap="round"
              />
            )}
          </svg>

          {/* Cutting a connection. Sits above the strings and is only a few
              pixels wide, so it never gets in the way of dragging a node. */}
          {edges.map((edge) => {
            const parent = nodeById.get(edge.parentId);
            const child = nodeById.get(edge.childId);
            // A linked map's connections cannot be cut, so they get no button.
            if (!parent || !child || edge.locked) return null;

            const from = outputPort(positionOf(parent));
            const to = inputPort(positionOf(child));
            const key = edgeKey(edge);

            return (
              <button
                key={`cut-${key}`}
                onClick={() => onDisconnect(edge.parentId, edge.childId)}
                // Keeps the string lit while the pointer crosses from it onto here.
                onPointerEnter={() => setHoveredEdge(key)}
                onPointerLeave={() =>
                  setHoveredEdge((current) => (current === key ? null : current))
                }
                title={`Disconnect ${parent.title} → ${child.title}`}
                className={`absolute z-10 grid h-5 w-5 -translate-x-1/2 -translate-y-1/2
                place-items-center rounded-full border border-navy/30 bg-white text-xs
                text-dark-gray transition-opacity hover:opacity-100 focus-visible:opacity-100
                ${hoveredEdge === key ? 'opacity-100' : 'opacity-0'}`}
                style={{
                  left: (from.x + to.x) / 2,
                  // Nudged down to meet the string, which sags between the ports.
                  top: (from.y + to.y) / 2 + Math.min(Math.abs(to.x - from.x) * 0.16, 64),
                }}
              >
                ×
              </button>
            );
          })}

          {nodes.map((node) => {
            const at = positionOf(node);
            const selected = node.id === selectedNodeId;
            /** Lit while a string or a section is about to land on this node. */
            const target = hovered === node.id;
            /** Just found by the search box, and ringed for a moment. */
            const found = foundId === node.id;

            return (
              <div
                key={node.id}
                role="button"
                tabIndex={0}
                aria-pressed={selected}
                onClick={() => onSelect(node.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelect(node.id);
                  }
                }}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
                  onSelect(node.id);
                  const pointer = pointAt(event);
                  beginGesture({
                    kind: 'node',
                    nodeId: node.id,
                    origin: { x: node.x, y: node.y },
                    grab: { x: pointer.x - node.x, y: pointer.y - node.y },
                  });
                }}
                onPointerMove={onPointerMove}
                onPointerUp={endGesture}
                // Native drag, because the thing being dropped came from a list.
                // A string being pulled does not come through here at all — the
                // capture keeps those events on the port — so this is only ever
                // sections arriving from one of the lists on the left.
                onDragOver={(event) => {
                  event.preventDefault();
                  setHovered(node.id);
                }}
                onDragLeave={() => setHovered(null)}
                onDrop={(event) => {
                  event.preventDefault();
                  setHovered(null);
                  const sectionIds = readDrag(event.dataTransfer);
                  if (sectionIds.length > 0) onDropSections(node.id, sectionIds);
                }}
                style={{ left: at.x, top: at.y, width: NODE_WIDTH, minHeight: NODE_HEIGHT }}
                className={`absolute flex touch-none flex-col rounded-lg border-2 bg-white px-3 py-2
                text-left shadow-sm transition-colors
                ${gesture?.kind === 'node' && gesture.nodeId === node.id ? 'cursor-grabbing' : 'cursor-grab'}
                ${selected ? 'ring-2 ring-navy/20' : ''}
                ${node.linked ? 'border-danger' : selected ? 'border-navy' : 'border-navy/30'}
                ${found ? 'border-navy ring-4 ring-navy/50' : ''}
                ${target ? 'border-[#5b9748] bg-[#5b9748]/5' : ''}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-dark-gray">
                    {node.title}
                  </span>
                  {!node.isRoot && (
                    <button
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        onDeleteNode(node);
                      }}
                      title="Remove this node"
                      className="shrink-0 text-dark-gray hover:text-danger-hover"
                    >
                      <TrashIcon className="w-4 h-4" />
                    </button>
                  )}
                </div>

                <span className="mt-1 text-xs text-dark-gray">
                  {node.isRoot ? 'Everyone starts here' : `Layer ${node.depth || '—'}`} ·{' '}
                  {node.items.length} item{node.items.length === 1 ? '' : 's'}
                </span>

                {node.linked && (
                  <span className="mt-0.5 truncate text-xs font-semibold text-danger">
                    Linked from {node.linked.sourceTitle}
                  </span>
                )}

                {/*
                  The root has no input dot at all, rather than a disabled one.
                  It is where every learner starts, so there is nothing that
                  could come before it and nothing to explain away.
                */}
                {!node.isRoot && (
                  <span
                    aria-hidden="true"
                    data-testid={`input-port-${node.id}`}
                    className={`absolute top-1/2 -left-2 h-4 w-4 -translate-y-1/2 rounded-full
                    border-2 bg-white ${node.linked ? 'border-danger' : 'border-navy'}
                    ${target ? 'scale-150 bg-[#5b9748]' : ''} transition-transform`}
                  />
                )}

                {/* A linked node that already leads on within its map is fixed, so
                    it has nothing to pull. One at the end of it may carry on. */}
                {!(node.linked && branchingLinked.has(node.id)) && (
                  <button
                    aria-label={`Connect from ${node.title}`}
                    title="Pull a string to another node"
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
                      beginGesture({
                        kind: 'string',
                        parentId: node.id,
                        to: outputPort({ x: node.x, y: node.y }),
                      });
                    }}
                    onPointerMove={onPointerMove}
                    onPointerUp={endGesture}
                    className="absolute top-1/2 -right-3 h-6 w-6 -translate-y-1/2 cursor-crosshair
                      rounded-full border-2 border-navy bg-white transition-transform
                      hover:scale-125"
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default MapCanvas;
