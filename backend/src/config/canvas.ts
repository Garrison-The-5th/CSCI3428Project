/**
 * File: canvas.ts
 * Description: The shape of a CANVAS element, and the rules that clean one before it is stored.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-10-15
 */
import { randomUUID } from 'crypto';

import { sanitizeRichText } from '@/config/rich-text';
import { withinLimit } from '@/config/validation';

/**
 * A canvas is a free-form slide: pictures, text boxes and shapes placed, sized,
 * rotated and layered by hand.
 *
 * Everything is stored in one JSON column, in two halves:
 *
 * - `items` — the layout. Small, and rewritten by every auto-save.
 * - `images` — the pictures the layout draws from, as base64. Large, and only
 *   ever written by the upload route.
 *
 * The split is what keeps auto-save cheap and safe at once. Moving a picture
 * sends a few numbers rather than megabytes back up (the JSON body limit is
 * 2MB), and a picture can only enter the pool through `normalizeUpload`, which
 * checks the bytes really are an image. A layout that names a picture the pool
 * does not hold has that item dropped, so the save route cannot be used to
 * smuggle in a file the upload route would have refused.
 *
 * Kept in step with frontend/src/components/canvas/canvas-model.ts.
 */

/** The logical size every canvas is laid out at; it is scaled to fit when shown. */
export const CANVAS_WIDTH = 960;
export const CANVAS_HEIGHT = 540;

export const SHAPE_KINDS = [
  'rectangle',
  'rounded-rectangle',
  'circle',
  'triangle',
  'right-triangle',
  'diamond',
  'pentagon',
  'hexagon',
  'star',
  'heart',
  'plus',
  'arrow',
  'double-arrow',
  'curved-arrow',
  'chevron',
  'line',
  'line-arrow',
  'speech-bubble',
  'round-speech-bubble',
  'thought-bubble',
] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number];

/** Enough for any slide anyone would build, and a ceiling on what one save can hold. */
export const MAX_CANVAS_ITEMS = 200;
export const MAX_CANVAS_IMAGES = 20;
/** Base64 across the whole pool. Each file is already capped at 10MB by the upload. */
export const MAX_CANVAS_IMAGE_BYTES = 30 * 1024 * 1024;

/**
 * How long a picture nothing points at is kept.
 *
 * An upload and an auto-save can cross in flight: the save was sent before the
 * picture was placed, so it does not mention it. Pruning unreferenced pictures
 * at once would delete a fresh upload out from under the author. An hour is far
 * longer than any such race, and short enough that deleted pictures do not
 * linger in every published snapshot.
 */
const ORPHAN_GRACE_MS = 60 * 60 * 1000;

const MIN_SIZE = 4;
const MAX_SIZE = 4_000;
const MAX_BORDER = 40;
const MAX_PADDING = 80;

export interface CanvasImageAsset {
  data: string;
  mimeType: string;
  fileName: string | null;
  uploadedAt: string;
}

interface CanvasItemBase {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  borderColor: string | null;
  borderWidth: number;
}

export interface CanvasImageItem extends CanvasItemBase {
  kind: 'image';
  imageId: string;
  /** Fractions of the picture hidden on each side. */
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
  color: string;
  filled: boolean;
}

export interface CanvasTextItem extends CanvasItemBase {
  kind: 'text';
  html: string;
  background: string | null;
  padding: number;
}

export type CanvasItem = CanvasImageItem | CanvasShapeItem | CanvasTextItem;

export interface CanvasData {
  version: 1;
  background: string;
  /** Back to front: the last item is drawn on top. */
  items: CanvasItem[];
  images: Record<string, CanvasImageAsset>;
}

/** A blank white canvas with no items and no pictures — what a new canvas element starts as. */
export function emptyCanvas(): CanvasData {
  return { version: 1, background: '#ffffff', items: [], images: {} };
}

// ---- Primitive cleaners: anything malformed falls back rather than failing ----

type Loose = Record<string, unknown>;

const isObject = (value: unknown): value is Loose =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A finite number clamped to [min, max] and rounded to 2 decimals; `fallback` if it isn't one. */
function num(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed * 100) / 100));
}

/** Strictly `true`; anything else (including "true") is false. */
function bool(value: unknown): boolean {
  return value === true;
}

/** Only six-digit hex survives — a colour is written into a style attribute. */
function optionalColor(value: unknown): string | null {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : null;
}

/** A required colour: a valid hex value, or `fallback`. */
function color(value: unknown, fallback: string): string {
  return optionalColor(value) ?? fallback;
}

/** Degrees normalised into [0, 360), so a spun-around item stores a small number. */
function rotation(value: unknown): number {
  const degrees = num(value, 0, -100_000, 100_000);
  return Math.round((((degrees % 360) + 360) % 360) * 100) / 100;
}

/** Item ids are client-generated, so they are held to a short, safe alphabet. */
const ID_PATTERN = /^[\w-]{1,64}$/;

/**
 * The stored JSON shaped as a canvas, without re-cleaning its items — they
 * were cleaned on the way in. Anything that is not an object reads as empty.
 */
function readCanvas(value: unknown): CanvasData {
  if (!isObject(value)) return emptyCanvas();
  const images = isObject(value.images) ? (value.images as Record<string, CanvasImageAsset>) : {};
  return {
    version: 1,
    background: color(value.background, '#ffffff'),
    items: Array.isArray(value.items) ? (value.items as CanvasItem[]) : [],
    images,
  };
}

/** Whatever is stored, as a well-formed canvas. Old or missing rows read as empty. */
export function storedCanvas(value: unknown): CanvasData {
  return readCanvas(value);
}

/**
 * The geometry and border every item kind shares, each value clamped. Positions
 * may run a little off the canvas so an item can be dragged partly out of view.
 */
function cleanBase(raw: Loose, id: string): CanvasItemBase {
  return {
    id,
    x: num(raw.x, 0, -CANVAS_WIDTH * 2, CANVAS_WIDTH * 3),
    y: num(raw.y, 0, -CANVAS_HEIGHT * 2, CANVAS_HEIGHT * 3),
    width: num(raw.width, 100, MIN_SIZE, MAX_SIZE),
    height: num(raw.height, 100, MIN_SIZE, MAX_SIZE),
    rotation: rotation(raw.rotation),
    opacity: num(raw.opacity, 1, 0, 1),
    borderColor: optionalColor(raw.borderColor),
    borderWidth: num(raw.borderWidth, 0, 0, MAX_BORDER),
  };
}

/**
 * Crop insets, kept so at least a twentieth of the picture stays visible on
 * each axis — a crop that hid everything would leave an item nobody can see to
 * select.
 */
function cleanCrop(raw: unknown): CanvasImageItem['crop'] {
  const crop = isObject(raw) ? raw : {};
  let top = num(crop.top, 0, 0, 0.95);
  let bottom = num(crop.bottom, 0, 0, 0.95);
  let left = num(crop.left, 0, 0, 0.95);
  let right = num(crop.right, 0, 0, 0.95);
  if (top + bottom > 0.95) {
    const scale = 0.95 / (top + bottom);
    top *= scale;
    bottom *= scale;
  }
  if (left + right > 0.95) {
    const scale = 0.95 / (left + right);
    left *= scale;
    right *= scale;
  }
  return { top, right, bottom, left };
}

/**
 * One client-sent item rebuilt field by field from what is allowed, or null to
 * drop it. Unknown kinds, bad ids and pictures not in the stored pool are
 * dropped rather than failing the whole save.
 */
function cleanItem(raw: unknown, images: Record<string, CanvasImageAsset>): CanvasItem | null {
  if (!isObject(raw)) return null;
  if (typeof raw.id !== 'string' || !ID_PATTERN.test(raw.id)) return null;
  const base = cleanBase(raw, raw.id);

  if (raw.kind === 'image') {
    // Only pictures that came through the upload route may be drawn.
    if (typeof raw.imageId !== 'string' || !Object.hasOwn(images, raw.imageId)) return null;
    return {
      ...base,
      kind: 'image',
      imageId: raw.imageId,
      crop: cleanCrop(raw.crop),
      flipX: bool(raw.flipX),
      flipY: bool(raw.flipY),
      brightness: num(raw.brightness, 100, 0, 200),
      contrast: num(raw.contrast, 100, 0, 200),
      saturation: num(raw.saturation, 100, 0, 200),
    };
  }

  if (raw.kind === 'shape') {
    if (!SHAPE_KINDS.includes(raw.shape as ShapeKind)) return null;
    return {
      ...base,
      kind: 'shape',
      shape: raw.shape as ShapeKind,
      color: color(raw.color, '#1f4e79'),
      filled: bool(raw.filled),
    };
  }

  if (raw.kind === 'text') {
    const html = typeof raw.html === 'string' ? raw.html : '';
    return {
      ...base,
      kind: 'text',
      // The same allowlist as a TEXT element: a text box is rendered as markup.
      html: withinLimit(sanitizeRichText(html), 'richText', 'text box'),
      background: optionalColor(raw.background),
      padding: num(raw.padding, 8, 0, MAX_PADDING),
    };
  }

  return null;
}

/** Drops pictures nothing points at, once they are old enough not to be mid-upload. */
function prunePool(
  images: Record<string, CanvasImageAsset>,
  items: CanvasItem[],
  now: Date,
): Record<string, CanvasImageAsset> {
  const used = new Set(
    items.filter((item): item is CanvasImageItem => item.kind === 'image').map((i) => i.imageId),
  );
  return Object.fromEntries(
    Object.entries(images).filter(([id, image]) => {
      if (used.has(id)) return true;
      const uploaded = Date.parse(image.uploadedAt);
      return Number.isFinite(uploaded) && now.getTime() - uploaded < ORPHAN_GRACE_MS;
    }),
  );
}

/**
 * Builds the canvas to store from a layout sent by the editor.
 *
 * Only the layout is taken from the request. The picture pool always comes from
 * what is already stored, whatever the request says about it.
 */
export function mergeCanvasLayout(layout: unknown, stored: unknown, now = new Date()): CanvasData {
  if (!isObject(layout)) throw new Error('canvas must be an object');
  if (!Array.isArray(layout.items)) throw new Error('canvas items must be a list');
  if (layout.items.length > MAX_CANVAS_ITEMS) {
    throw new Error(`A canvas may hold at most ${MAX_CANVAS_ITEMS} items`);
  }

  const current = storedCanvas(stored);
  const seen = new Set<string>();
  const items: CanvasItem[] = [];
  for (const raw of layout.items) {
    const item = cleanItem(raw, current.images);
    // A repeated id would make two items move as one in the editor.
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
  }

  return {
    version: 1,
    background: color(layout.background, current.background),
    items,
    images: prunePool(current.images, items, now),
  };
}

/**
 * Adds an uploaded picture to the pool and returns its id.
 *
 * The caller has already run the file through `normalizeUpload`; this only
 * enforces how many pictures, and how much picture, one canvas may carry.
 */
export function addCanvasImage(
  stored: unknown,
  upload: { data: string; mimeType: string; fileName: string | null },
  now = new Date(),
): { canvas: CanvasData; imageId: string } {
  const current = storedCanvas(stored);
  const images = prunePool(current.images, current.items, now);

  if (Object.keys(images).length >= MAX_CANVAS_IMAGES) {
    throw new Error(`A canvas may hold at most ${MAX_CANVAS_IMAGES} pictures`);
  }
  const total =
    Object.values(images).reduce((sum, image) => sum + image.data.length, 0) + upload.data.length;
  if (total > MAX_CANVAS_IMAGE_BYTES) {
    throw new Error('This canvas is full — remove a picture before adding another');
  }

  const imageId = randomUUID();
  images[imageId] = { ...upload, uploadedAt: now.toISOString() };
  return { canvas: { ...current, images }, imageId };
}
