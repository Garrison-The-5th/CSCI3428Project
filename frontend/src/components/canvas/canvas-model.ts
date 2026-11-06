/**
 * File: canvas-model.ts
 * Description: The canvas element's data, and the geometry for moving, sizing, rotating and cropping on it.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-10-15
 */
/**
 * A canvas is a free-form slide: pictures, text boxes and shapes, each placed,
 * sized, rotated and layered by hand.
 *
 * Everything is laid out on a fixed 960×540 surface and scaled to whatever room
 * it is shown in, so a slide looks the same in the editor, in the section
 * preview and on a learner's phone — text included, because the scaling is a
 * transform over the whole surface rather than a reflow.
 *
 * Kept in step with backend/src/config/canvas.ts, which cleans every layout
 * before it is stored and refuses anything outside these shapes.
 */

export const CANVAS_WIDTH = 960;
export const CANVAS_HEIGHT = 540;

/** Smallest an item may be dragged to, in canvas units — still big enough to grab. */
export const MIN_ITEM_SIZE = 8;

export interface CanvasImageAsset {
  /** base64, without the `data:` prefix. */
  data: string;
  mimeType: string;
  fileName: string | null;
  uploadedAt: string;
}

interface CanvasItemBase {
  id: string;
  /** Top-left of the unrotated box, in canvas units. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Degrees clockwise, about the box's centre. */
  rotation: number;
  /** 0–1. */
  opacity: number;
  borderColor: string | null;
  borderWidth: number;
}

export interface CanvasImageItem extends CanvasItemBase {
  kind: 'image';
  imageId: string;
  /** Fraction of the picture hidden on each side, as seen (after flipping). */
  crop: { top: number; right: number; bottom: number; left: number };
  flipX: boolean;
  flipY: boolean;
  /** Percentages, 100 meaning unchanged. */
  brightness: number;
  contrast: number;
  saturation: number;
}

export interface CanvasShapeItem extends CanvasItemBase {
  kind: 'shape';
  shape: ShapeKind;
  /** The shape's colour: its outline, and its inside once filled. */
  color: string;
  filled: boolean;
}

export interface CanvasTextItem extends CanvasItemBase {
  kind: 'text';
  /** Rich text, sanitised by the server with the same allowlist as a TEXT element. */
  html: string;
  background: string | null;
  padding: number;
}

export type CanvasItem = CanvasImageItem | CanvasShapeItem | CanvasTextItem;

/** What the editor saves. Pictures are uploaded separately and never sent with it. */
export interface CanvasLayout {
  background: string;
  /** Back to front: the last item is drawn on top. */
  items: CanvasItem[];
}

/** What is stored and published: the layout plus the pictures it draws from. */
export interface CanvasData extends CanvasLayout {
  version: 1;
  images: Record<string, CanvasImageAsset>;
}

export const EMPTY_LAYOUT: CanvasLayout = { background: '#ffffff', items: [] };

/** The editable part of a stored canvas. Missing or malformed reads as blank. */
export function layoutOf(data: CanvasData | null | undefined): CanvasLayout {
  if (!data || !Array.isArray(data.items)) return EMPTY_LAYOUT;
  return { background: data.background || '#ffffff', items: data.items };
}

// ---- Shapes ----

export type ShapeKind =
  | 'rectangle'
  | 'rounded-rectangle'
  | 'circle'
  | 'triangle'
  | 'right-triangle'
  | 'diamond'
  | 'pentagon'
  | 'hexagon'
  | 'star'
  | 'heart'
  | 'plus'
  | 'arrow'
  | 'double-arrow'
  | 'curved-arrow'
  | 'chevron'
  | 'line'
  | 'line-arrow'
  | 'speech-bubble'
  | 'round-speech-bubble'
  | 'thought-bubble';

export interface ShapeDefinition {
  kind: ShapeKind;
  label: string;
  /** Drawn in a 100×100 box and stretched to the item, so every shape resizes freely. */
  path: string;
  /** A line has no inside, so Fill does nothing to it. */
  strokeOnly?: boolean;
  /** Extra parts always painted in the outline colour — an arrowhead on a line. */
  solidPath?: string;
  width: number;
  height: number;
}

/** A regular polygon or star, stretched to fill the 100×100 box exactly. */
function polygonPath(points: number, innerRatio?: number): string {
  const vertices: Array<[number, number]> = [];
  const total = innerRatio ? points * 2 : points;
  for (let i = 0; i < total; i += 1) {
    const radius = innerRatio && i % 2 === 1 ? innerRatio : 1;
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / total;
    vertices.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
  }
  const xs = vertices.map(([x]) => x);
  const ys = vertices.map(([, y]) => y);
  const [minX, maxX, minY, maxY] = [
    Math.min(...xs),
    Math.max(...xs),
    Math.min(...ys),
    Math.max(...ys),
  ];
  const fit = vertices.map(
    ([x, y]) =>
      `${(((x - minX) / (maxX - minX)) * 100).toFixed(2)} ${(((y - minY) / (maxY - minY)) * 100).toFixed(2)}`,
  );
  return `M${fit.join(' L')} Z`;
}

export const SHAPES: ShapeDefinition[] = [
  { kind: 'rectangle', label: 'Square', path: 'M0 0 H100 V100 H0 Z', width: 160, height: 160 },
  {
    kind: 'rounded-rectangle',
    label: 'Rounded square',
    path: 'M15 0 H85 Q100 0 100 15 V85 Q100 100 85 100 H15 Q0 100 0 85 V15 Q0 0 15 0 Z',
    width: 160,
    height: 160,
  },
  {
    kind: 'circle',
    label: 'Circle',
    path: 'M50 0 A50 50 0 1 1 50 100 A50 50 0 1 1 50 0 Z',
    width: 160,
    height: 160,
  },
  { kind: 'triangle', label: 'Triangle', path: 'M50 0 L100 100 H0 Z', width: 160, height: 140 },
  {
    kind: 'right-triangle',
    label: 'Right triangle',
    path: 'M0 0 L100 100 H0 Z',
    width: 160,
    height: 160,
  },
  {
    kind: 'diamond',
    label: 'Diamond',
    path: 'M50 0 L100 50 L50 100 L0 50 Z',
    width: 160,
    height: 160,
  },
  { kind: 'pentagon', label: 'Pentagon', path: polygonPath(5), width: 160, height: 152 },
  {
    kind: 'hexagon',
    label: 'Hexagon',
    path: 'M25 0 H75 L100 50 L75 100 H25 L0 50 Z',
    width: 170,
    height: 150,
  },
  { kind: 'star', label: 'Star', path: polygonPath(5, 0.4), width: 160, height: 152 },
  {
    kind: 'heart',
    label: 'Heart',
    path:
      'M50 100 C20 78 0 58 0 30 C0 12 13 0 28 0 C38 0 46 6 50 15 ' +
      'C54 6 62 0 72 0 C87 0 100 12 100 30 C100 58 80 78 50 100 Z',
    width: 160,
    height: 150,
  },
  {
    kind: 'plus',
    label: 'Plus',
    path: 'M35 0 H65 V35 H100 V65 H65 V100 H35 V65 H0 V35 H35 Z',
    width: 140,
    height: 140,
  },
  {
    kind: 'arrow',
    label: 'Arrow',
    path: 'M0 30 H60 V0 L100 50 L60 100 V70 H0 Z',
    width: 200,
    height: 110,
  },
  {
    kind: 'double-arrow',
    label: 'Double arrow',
    path: 'M0 50 L25 0 V30 H75 V0 L100 50 L75 100 V70 H25 V100 Z',
    width: 220,
    height: 110,
  },
  {
    kind: 'curved-arrow',
    label: 'Curved arrow',
    path: 'M0 100 C0 45 30 20 68 20 V0 L100 35 L68 70 V50 C45 50 28 65 28 100 Z',
    width: 180,
    height: 160,
  },
  {
    kind: 'chevron',
    label: 'Chevron',
    path: 'M0 0 H70 L100 50 L70 100 H0 L30 50 Z',
    width: 140,
    height: 120,
  },
  { kind: 'line', label: 'Line', path: 'M0 50 H100', strokeOnly: true, width: 220, height: 24 },
  {
    kind: 'line-arrow',
    label: 'Line arrow',
    path: 'M0 50 H88',
    strokeOnly: true,
    solidPath: 'M80 20 L100 50 L80 80 Z',
    width: 220,
    height: 36,
  },
  {
    kind: 'speech-bubble',
    label: 'Speech bubble',
    path:
      'M6 0 H94 Q100 0 100 6 V64 Q100 70 94 70 H45 L20 100 L28 70 H6 ' + 'Q0 70 0 64 V6 Q0 0 6 0 Z',
    width: 220,
    height: 150,
  },
  {
    kind: 'round-speech-bubble',
    label: 'Round speech bubble',
    path:
      'M50 0 C78 0 100 15 100 35 C100 55 78 70 50 70 C44 70 39 69 34 68 L12 100 L20 63 ' +
      'C8 57 0 47 0 35 C0 15 22 0 50 0 Z',
    width: 220,
    height: 150,
  },
  {
    kind: 'thought-bubble',
    label: 'Thought bubble',
    path:
      'M20 55 A15 15 0 0 1 22 25 A18 18 0 0 1 50 12 A18 18 0 0 1 78 22 A15 15 0 0 1 82 55 ' +
      'A16 16 0 0 1 60 68 A18 18 0 0 1 32 68 A14 14 0 0 1 20 55 Z ' +
      'M22 84 A6 6 0 1 0 34 84 A6 6 0 1 0 22 84 Z ' +
      'M8 95 A4 4 0 1 0 16 95 A4 4 0 1 0 8 95 Z',
    width: 220,
    height: 160,
  },
];

export const SHAPE_BY_KIND = Object.fromEntries(SHAPES.map((s) => [s.kind, s])) as Record<
  ShapeKind,
  ShapeDefinition
>;

// ---- New items ----

/**
 * A fresh item id — a UUID where the browser has one, otherwise a time-plus-random fallback.
 * Matches the server's id pattern either way.
 */
export function newItemId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `i${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * The geometry every new item starts with: `width` × `height`, centred on `centre`, unrotated and
 * opaque.
 */
const base = (width: number, height: number, centre: { x: number; y: number }) => ({
  id: newItemId(),
  x: Math.round(centre.x - width / 2),
  y: Math.round(centre.y - height / 2),
  width,
  height,
  rotation: 0,
  opacity: 1,
});

export const CANVAS_CENTRE = { x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT / 2 };

export const DEFAULT_SHAPE_COLOR = '#1f4e79';

/** A new outlined shape of the given kind, at its default size, centred on `centre`. */
export function newShape(kind: ShapeKind, centre = CANVAS_CENTRE): CanvasShapeItem {
  const definition = SHAPE_BY_KIND[kind];
  return {
    ...base(definition.width, definition.height, centre),
    kind: 'shape',
    shape: kind,
    color: DEFAULT_SHAPE_COLOR,
    // Null follows the shape's colour, so a fresh shape is one colour throughout.
    borderColor: null,
    borderWidth: 3,
    filled: false,
  };
}

/** A new empty text box, centred on `centre`. */
export function newTextBox(centre = CANVAS_CENTRE): CanvasTextItem {
  return {
    ...base(320, 80, centre),
    kind: 'text',
    html: '',
    background: null,
    borderColor: null,
    borderWidth: 0,
    padding: 8,
  };
}

/** A picture at its own proportions, scaled down to sit comfortably on the slide. */
export function newImage(
  imageId: string,
  natural: { width: number; height: number },
  centre = CANVAS_CENTRE,
): CanvasImageItem {
  const fit = Math.min(
    1,
    (CANVAS_WIDTH * 0.6) / natural.width,
    (CANVAS_HEIGHT * 0.6) / natural.height,
  );
  const width = Math.max(MIN_ITEM_SIZE, Math.round(natural.width * fit));
  const height = Math.max(MIN_ITEM_SIZE, Math.round(natural.height * fit));
  return {
    ...base(width, height, centre),
    kind: 'image',
    imageId,
    crop: { top: 0, right: 0, bottom: 0, left: 0 },
    flipX: false,
    flipY: false,
    brightness: 100,
    contrast: 100,
    saturation: 100,
    borderColor: null,
    borderWidth: 0,
  };
}

// ---- Layering ----

/** Moves an item to the top or bottom of the stack, or one step either way. */
export function restack(
  items: CanvasItem[],
  id: string,
  to: 'front' | 'back' | 'forward' | 'backward',
): CanvasItem[] {
  const index = items.findIndex((item) => item.id === id);
  if (index === -1) return items;
  const next = [...items];
  const [item] = next.splice(index, 1);
  const target =
    to === 'front'
      ? next.length
      : to === 'back'
        ? 0
        : to === 'forward'
          ? Math.min(next.length, index + 1)
          : Math.max(0, index - 1);
  next.splice(target, 0, item);
  return next;
}

// ---- Geometry ----

/** The eight handles: which way each one pulls on x and y. */
export const HANDLES = [
  { id: 'nw', hx: -1, hy: -1 },
  { id: 'n', hx: 0, hy: -1 },
  { id: 'ne', hx: 1, hy: -1 },
  { id: 'e', hx: 1, hy: 0 },
  { id: 'se', hx: 1, hy: 1 },
  { id: 's', hx: 0, hy: 1 },
  { id: 'sw', hx: -1, hy: 1 },
  { id: 'w', hx: -1, hy: 0 },
] as const;
export type Handle = (typeof HANDLES)[number];

type Box = Pick<CanvasItemBase, 'x' | 'y' | 'width' | 'height' | 'rotation'>;

/** Rotates the vector (x, y) by `degrees` about the origin. */
function rotate(x: number, y: number, degrees: number): { x: number; y: number } {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { x: x * cos - y * sin, y: x * sin + y * cos };
}

/** Rounded to a hundredth, which is what the server keeps. */
const r2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Resizes a box by dragging one of its handles.
 *
 * The drag is measured in the box's own rotated frame, so pulling the right edge
 * of a box turned 90° still widens it rather than making it taller. The edge or
 * corner opposite the handle stays where it is on screen — which, for a rotated
 * box, means the top-left corner has to move to compensate.
 *
 * `keepAspect` holds the proportions on a corner drag, the way Shift does in
 * most editors (and the way pictures behave by default).
 */
export function resizeBox(
  start: Box,
  handle: Pick<Handle, 'hx' | 'hy'>,
  dx: number,
  dy: number,
  keepAspect = false,
): Pick<Box, 'x' | 'y' | 'width' | 'height'> {
  const local = rotate(dx, dy, -start.rotation);
  let width = handle.hx === 0 ? start.width : start.width + handle.hx * local.x;
  let height = handle.hy === 0 ? start.height : start.height + handle.hy * local.y;

  if (keepAspect && handle.hx !== 0 && handle.hy !== 0) {
    const scale = Math.max(width / start.width, height / start.height);
    width = start.width * scale;
    height = start.height * scale;
  }

  const minScale = Math.max(MIN_ITEM_SIZE / start.width, MIN_ITEM_SIZE / start.height);
  if (keepAspect && handle.hx !== 0 && handle.hy !== 0 && width / start.width < minScale) {
    width = start.width * minScale;
    height = start.height * minScale;
  }
  width = Math.max(MIN_ITEM_SIZE, width);
  height = Math.max(MIN_ITEM_SIZE, height);

  return placeResized(start, handle, width, height);
}

/** Positions a resized box so the side opposite the handle has not moved. */
function placeResized(
  start: Box,
  handle: Pick<Handle, 'hx' | 'hy'>,
  width: number,
  height: number,
): Pick<Box, 'x' | 'y' | 'width' | 'height'> {
  const shift = rotate(
    ((width - start.width) / 2) * handle.hx,
    ((height - start.height) / 2) * handle.hy,
    start.rotation,
  );
  const cx = start.x + start.width / 2 + shift.x;
  const cy = start.y + start.height / 2 + shift.y;
  return { x: r2(cx - width / 2), y: r2(cy - height / 2), width: r2(width), height: r2(height) };
}

/**
 * Grows a text box to fit what has been typed into it, keeping it on the slide.
 *
 * The box only ever gets taller here — shrinking is left to the author's own
 * resize, so deleting a line never undoes a size they chose. It grows from its
 * top edge (for a rotated box too, which a plain height change would shift,
 * since rotation turns about the centre). Once its bottom reaches the slide's
 * edge it is pushed up instead, as far as the top of the slide; only text
 * taller than the whole slide runs off it.
 *
 * Returns null when the box already fits.
 */
export function growTextBox(
  box: Box,
  contentHeight: number,
): Pick<Box, 'x' | 'y' | 'width' | 'height'> | null {
  const height = Math.max(box.height, Math.ceil(contentHeight));
  if (height === box.height) return null;

  const grown = placeResized(box, { hx: 0, hy: 1 }, box.width, height);

  // How far the rotated box reaches above and below its centre.
  const radians = (box.rotation * Math.PI) / 180;
  const reach =
    (Math.abs(box.width * Math.sin(radians)) + Math.abs(height * Math.cos(radians))) / 2;
  const centre = grown.y + height / 2;
  const below = centre + reach - CANVAS_HEIGHT;
  const above = centre - reach;
  const lift = below > 0 ? Math.max(0, Math.min(below, above)) : 0;

  return { ...grown, y: r2(grown.y - lift) };
}

/** Never crop away more than this of the picture on either axis. */
const MAX_CROP = 0.95;

/**
 * Crops a picture by dragging one of its handles.
 *
 * The frame shrinks or grows exactly as a resize would, but the picture inside
 * it stays the same size and in the same place — the edge being dragged just
 * covers or uncovers it. Dragging past the picture's own edge stops there.
 */
export function cropBox(
  start: CanvasImageItem,
  handle: Pick<Handle, 'hx' | 'hy'>,
  dx: number,
  dy: number,
): Pick<CanvasImageItem, 'x' | 'y' | 'width' | 'height' | 'crop'> {
  const local = rotate(dx, dy, -start.rotation);
  const { crop } = start;
  // The size the whole picture is drawn at, which cropping must not change.
  const fullWidth = start.width / (1 - crop.left - crop.right);
  const fullHeight = start.height / (1 - crop.top - crop.bottom);
  const next = { ...crop };

  if (handle.hx === -1) {
    next.left = clamp(crop.left + local.x / fullWidth, 0, MAX_CROP - crop.right);
  } else if (handle.hx === 1) {
    next.right = clamp(crop.right - local.x / fullWidth, 0, MAX_CROP - crop.left);
  }
  if (handle.hy === -1) {
    next.top = clamp(crop.top + local.y / fullHeight, 0, MAX_CROP - crop.bottom);
  } else if (handle.hy === 1) {
    next.bottom = clamp(crop.bottom - local.y / fullHeight, 0, MAX_CROP - crop.top);
  }

  const width = fullWidth * (1 - next.left - next.right);
  const height = fullHeight * (1 - next.top - next.bottom);
  return {
    ...placeResized(start, handle, width, height),
    crop: {
      top: r4(next.top),
      right: r4(next.right),
      bottom: r4(next.bottom),
      left: r4(next.left),
    },
  };
}

/**
 * Slides a cropped picture around inside its frame, so the author can choose
 * which part shows without re-cropping every edge.
 */
export function panCrop(start: CanvasImageItem, dx: number, dy: number): CanvasImageItem['crop'] {
  const local = rotate(dx, dy, -start.rotation);
  const { crop } = start;
  const fullWidth = start.width / (1 - crop.left - crop.right);
  const fullHeight = start.height / (1 - crop.top - crop.bottom);
  const shiftX = clamp(-local.x / fullWidth, -crop.left, crop.right);
  const shiftY = clamp(-local.y / fullHeight, -crop.top, crop.bottom);
  return {
    top: r4(crop.top + shiftY),
    bottom: r4(crop.bottom - shiftY),
    left: r4(crop.left + shiftX),
    right: r4(crop.right - shiftX),
  };
}

/** Undoes a crop, keeping the visible part where it is on the slide. */
export function uncrop(item: CanvasImageItem): CanvasImageItem {
  const { crop } = item;
  const fullWidth = item.width / (1 - crop.left - crop.right);
  const fullHeight = item.height / (1 - crop.top - crop.bottom);
  // The uncropped picture's centre, relative to the frame's, in the frame's rotation.
  const offset = rotate(
    (fullWidth * (crop.right - crop.left)) / 2,
    (fullHeight * (crop.bottom - crop.top)) / 2,
    item.rotation,
  );
  const cx = item.x + item.width / 2 + offset.x;
  const cy = item.y + item.height / 2 + offset.y;
  return {
    ...item,
    x: r2(cx - fullWidth / 2),
    y: r2(cy - fullHeight / 2),
    width: r2(fullWidth),
    height: r2(fullHeight),
    crop: { top: 0, right: 0, bottom: 0, left: 0 },
  };
}

/**
 * The rotation that points the box's top at the pointer.
 *
 * Shift snaps to 15° steps; without it the angle still clicks onto a right
 * angle when it is within a few degrees, because "nearly straight" is almost
 * never what anyone wanted.
 */
export function rotationToward(box: Box, px: number, py: number, snap = false): number {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  let degrees = (Math.atan2(py - cy, px - cx) * 180) / Math.PI + 90;
  degrees = ((degrees % 360) + 360) % 360;
  if (snap) return (Math.round(degrees / 15) * 15) % 360;
  const nearest = Math.round(degrees / 90) * 90;
  if (Math.abs(degrees - nearest) < 4) return nearest % 360;
  return Math.round(degrees * 10) / 10;
}

/** `value` limited to the range [min, max]. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Rounded to four decimal places — enough precision for crop fractions. */
const r4 = (value: number) => Math.round(value * 10_000) / 10_000;

/** The CSS filter for a picture's brightness, contrast and saturation. */
export function imageFilter(item: CanvasImageItem): string | undefined {
  if (item.brightness === 100 && item.contrast === 100 && item.saturation === 100) return undefined;
  return `brightness(${item.brightness}%) contrast(${item.contrast}%) saturate(${item.saturation}%)`;
}

// ---- Colour ----

/** "#rrggbb" (with or without the #) as 0–255 channels. Anything unparseable reads as black. */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex);
  const value = match ? parseInt(match[1], 16) : 0;
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

/** 0–255 channels as "#rrggbb", clamping and rounding each one. */
export function rgbToHex(r: number, g: number, b: number): string {
  const part = (n: number) =>
    clamp(Math.round(n) || 0, 0, 255)
      .toString(16)
      .padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`;
}

/** True for a six-digit "#rrggbb" colour — the only form the server stores. */
export const isHexColor = (value: string) => /^#[0-9a-f]{6}$/i.test(value);
