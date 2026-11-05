/**
 * File: canvas-editor.tsx
 * Description: Builds a canvas slide — pictures, text boxes and shapes, placed, sized, rotated and layered.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-10-15
 */
/**
 * The canvas editor.
 *
 * Click an item to select it; drag it to move it; drag one of the eight nodes
 * around it to stretch or shrink it, or the round node above it to turn it.
 * Pictures keep their proportions from a corner unless Shift is held; shapes
 * and text boxes do the opposite. Double-click a text box to write in it, with
 * the same toolbar a text block has.
 *
 * Pictures arrive by dragging them onto the slide from the computer, pasting
 * them, or through the Upload button, and are stored straight away — the slide only remembers
 * which picture goes where. Everything else is layout, saved by the element's
 * own auto-save like any other edit.
 *
 * The editor keeps its own undo history of layouts, separate from the text
 * toolbar's undo, which works inside the text box being written in.
 */
import {
  AdjustmentsHorizontalIcon,
  ArrowsRightLeftIcon,
  ArrowsUpDownIcon,
  ArrowUpTrayIcon,
  ArrowUturnLeftIcon,
  ArrowUturnRightIcon,
  ChevronDoubleDownIcon,
  ChevronDoubleUpIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  PencilSquareIcon,
  ScissorsIcon,
  Square2StackIcon,
  StarIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { CSSProperties, Fragment, RefObject, useEffect, useRef, useState } from 'react';

import {
  CanvasPicture,
  CanvasSurface,
  itemFrameStyle,
  ShapeGraphic,
  shapeOutline,
  textBoxStyle,
} from '@/components/canvas/canvas-items';
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  CanvasImageAsset,
  CanvasImageItem,
  CanvasItem,
  CanvasLayout,
  CanvasTextItem,
  cropBox,
  Handle,
  HANDLES,
  newImage,
  newItemId,
  newShape,
  newTextBox,
  panCrop,
  resizeBox,
  restack,
  rotationToward,
  ShapeKind,
  SHAPES,
  uncrop,
} from '@/components/canvas/canvas-model';
import { useBoxSize, useImageSources } from '@/components/canvas/canvas-view';
import ColorPicker from '@/components/common/color-picker';
import {
  indentOnTab,
  pastePlainText,
  RichTextToolbar,
} from '@/components/common/rich-text-editor';
import { Button } from '@/components/ui/button';
import { IMAGE_ONLY_ACCEPT, imageSrc } from '@/services/curriculum-api';

interface CanvasEditorProps {
  layout: CanvasLayout;
  onChange: (layout: CanvasLayout) => void;
  /** The pictures the layout can draw from. */
  images: Record<string, CanvasImageAsset>;
  /** Stores one picture and resolves with its id once the server has it. */
  onUpload: (file: File) => Promise<{ imageId: string; asset: CanvasImageAsset }>;
  /**
   * The items every new canvas in this course starts with, or null while they
   * load. Leave out, with `onToggleDefault`, to hide the Default button.
   */
  defaults?: CanvasItem[] | null;
  /** Makes an item one of the course's defaults, or stops it being one. */
  onToggleDefault?: (item: CanvasItem, include: boolean) => Promise<void>;
}

/**
 * What a copied item carries: the item, and for a picture the picture itself,
 * so it can be pasted into a different canvas, which has its own picture pool.
 */
interface CanvasClipboard {
  items: CanvasItem[];
  assets: Record<string, CanvasImageAsset>;
}

/** The clipboard format a copied canvas item travels under. */
const CLIPBOARD_TYPE = 'application/x-fec-canvas-items';

/**
 * The last thing copied, kept in memory as well, for browsers that will not
 * carry a custom clipboard format. Shared by every canvas on the page, so an
 * item copied from one canvas pastes into the next.
 */
let lastCopied: { stamp: string; data: CanvasClipboard } | null = null;

/** Reads a copied-items payload, or null when it is not one. */
function parseClipboard(raw: string): CanvasClipboard | null {
  try {
    const value = JSON.parse(raw) as CanvasClipboard;
    return Array.isArray(value?.items) && value.assets && typeof value.assets === 'object'
      ? value
      : null;
  } catch {
    return null;
  }
}

/** A stored picture as a file, so it can be uploaded into another canvas. */
function assetToFile(asset: CanvasImageAsset): File {
  const bytes = Uint8Array.from(atob(asset.data), (c) => c.charCodeAt(0));
  const extension = asset.mimeType.split('/')[1]?.replace('jpeg', 'jpg') ?? 'png';
  return new File([bytes], asset.fileName ?? `pasted.${extension}`, { type: asset.mimeType });
}

/** Image files on the clipboard — a screenshot, or a picture copied from a page. */
function clipboardImages(data: DataTransfer): File[] {
  const files = Array.from(data.files).filter((file) => file.type.startsWith('image/'));
  if (files.length > 0) return files;
  return Array.from(data.items)
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter((file): file is File => !!file);
}

/** True when two numbers are the same once the server has rounded them. */
const near = (a: unknown, b: unknown) =>
  typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 0.01 : a === b;

/**
 * Whether an item still matches its copy in the course defaults. Text is not
 * compared — a default text box is stored empty — and colours are compared
 * without regard to case, which the server lowercases.
 */
function matchesDefault(item: CanvasItem, saved: CanvasItem): boolean {
  const a = item as unknown as Record<string, unknown>;
  const b = saved as unknown as Record<string, unknown>;
  return Object.keys(a).every((key) => {
    if (key === 'html') return true;
    const [x, y] = [a[key], b[key]];
    if (typeof x === 'string' && typeof y === 'string') return x.toLowerCase() === y.toLowerCase();
    if (x && y && typeof x === 'object' && typeof y === 'object') {
      return Object.keys(x).every((k) =>
        near((x as Record<string, unknown>)[k], (y as Record<string, unknown>)[k]),
      );
    }
    return near(x, y);
  });
}

type Point = { x: number; y: number };

type Gesture =
  | { kind: 'move'; start: CanvasItem; from: Point }
  | { kind: 'resize'; start: CanvasItem; from: Point; handle: Handle }
  | { kind: 'rotate'; start: CanvasItem }
  | { kind: 'crop'; start: CanvasImageItem; from: Point; handle: Handle }
  | { kind: 'pan'; start: CanvasImageItem; from: Point };

const HISTORY_LIMIT = 100;
const HANDLE_PX = 10;
const ROTATE_OFFSET_PX = 28;
/** How far the pointer must travel, in screen pixels, before a press becomes a drag. */
const MOVE_THRESHOLD_PX = 4;
/** How wide the grab strip around a text box being written in is, in screen pixels. */
const EDIT_GRAB_PX = 10;

const btn =
  'h-8 min-w-8 gap-1 px-2 text-sm bg-white text-dark-gray hover:bg-light-gray border border-gray-300';
const pressed = 'bg-navy text-white hover:bg-navy-hover hover:text-white';

/** The cursor for a handle, turned with the item so it always points along the drag. */
const CURSORS = ['ns-resize', 'nesw-resize', 'ew-resize', 'nwse-resize'];
/**
 * The resize cursor for a handle, turned to match the item's rotation and snapped to one of the
 * four CSS resize cursors.
 */
function handleCursor(handle: Handle, rotation: number): string {
  const angle = (Math.atan2(handle.hy, handle.hx) * 180) / Math.PI + 90 + rotation;
  return CURSORS[Math.round((((angle % 180) + 180) % 180) / 45) % 4];
}

/**
 * Whether a file is one the cover photo accepts.
 *
 * Read off the same accept list the cover photo picker uses, so a canvas never
 * takes something a cover would not. The server checks the bytes regardless;
 * this is only so a dropped Word document is turned away with a reason rather
 * than a round trip.
 */
const ACCEPTED = IMAGE_ONLY_ACCEPT.split(',');
/** True when the file's type or extension is on the cover photo's accept list. */
function isAcceptedPicture(file: File): boolean {
  const extension = `.${file.name.split('.').pop()?.toLowerCase() ?? ''}`;
  return ACCEPTED.includes(file.type.toLowerCase()) || ACCEPTED.includes(extension);
}

/** A picture's own size, read once it has loaded. */
function naturalSize(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () =>
      resolve({ width: image.naturalWidth || 400, height: image.naturalHeight || 300 });
    image.onerror = () => resolve({ width: 400, height: 300 });
    image.src = src;
  });
}

/**
 * The quarter-turn buttons' icons: +90° is an arrow that heads right, curls
 * down and comes back left; -90° is the same arrow turned upside down, curling
 * up and heading right.
 */
const RotateIcon = ({ direction }: { direction: 'plus' | 'minus' }) => (
  <svg
    viewBox="0 0 24 24"
    className="h-4 w-4"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {direction === 'plus' ? (
      <>
        <path d="M4 6h8a5 5 0 0 1 0 10H6" />
        <path d="M9 13l-3 3 3 3" />
      </>
    ) : (
      <>
        <path d="M20 18h-8a5 5 0 0 1 0-10h6" />
        <path d="M15 5l3 3-3 3" />
      </>
    )}
  </svg>
);

/** Closes a pop-over when the author clicks anywhere outside it. */
function useDismiss(ref: RefObject<HTMLElement | null>, open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) close();
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open, close, ref]);
}

/**
 * A text box's contents.
 *
 * One element whether or not it is being written in, with its markup pushed in
 * only when it differs from what is there — re-rendering it from props while
 * the author types would throw the caret back to the start.
 */
const CanvasTextContent = ({
  item,
  editing,
  editorRef,
  onHtml,
}: {
  item: CanvasTextItem;
  editing: boolean;
  editorRef: RefObject<HTMLDivElement | null>;
  onHtml: (html: string, height: number) => void;
}) => {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== item.html) ref.current.innerHTML = item.html;
  }, [item.html]);

  /** Reports the box's current markup and rendered height, so it can grow to fit. */
  const emit = () => {
    if (ref.current) onHtml(ref.current.innerHTML, ref.current.offsetHeight);
  };

  return (
    <div
      ref={(element) => {
        ref.current = element;
        if (editing) editorRef.current = element;
      }}
      contentEditable={editing}
      suppressContentEditableWarning
      role={editing ? 'textbox' : undefined}
      aria-multiline={editing ? true : undefined}
      aria-label={editing ? 'Text box' : undefined}
      onInput={emit}
      onBlur={emit}
      onKeyDown={(e) => indentOnTab(e, emit)}
      onPaste={(e) => pastePlainText(e, emit)}
      data-placeholder={editing ? 'Type here…' : 'Double-click to type'}
      className={`focus:outline-none empty:before:text-gray-400
        empty:before:content-[attr(data-placeholder)] ${editing ? 'cursor-text' : ''}`}
      style={textBoxStyle(item)}
    />
  );
};

/**
 * The author's canvas editor: a fixed-size board of pictures, shapes and text boxes that can be
 * dragged, resized, rotated, cropped and styled, with undo/redo. Emits the whole layout on every
 * change; the parent saves it.
 */
const CanvasEditor = ({
  layout,
  onChange,
  images,
  onUpload,
  defaults,
  onToggleDefault,
}: CanvasEditorProps) => {
  const [boxRef, box] = useBoxSize<HTMLDivElement>();
  const scale = box.width > 0 ? box.width / CANVAS_WIDTH : 0;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [cropping, setCropping] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const [shapesOpen, setShapesOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [savingDefault, setSavingDefault] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const shapesRef = useRef<HTMLDivElement>(null);
  const adjustRef = useRef<HTMLDivElement>(null);
  useDismiss(shapesRef, shapesOpen, () => setShapesOpen(false));
  useDismiss(adjustRef, adjustOpen, () => setAdjustOpen(false));

  const sources = useImageSources(images);
  /** The newest picture pool, for pastes that finish after an upload. */
  const imagesRef = useRef(images);
  imagesRef.current = images;

  /**
   * The newest layout, for code that runs outside a render — window drag
   * listeners, and uploads that finish one after another. Written by `emit` as
   * well as on render, so two changes in a row build on each other rather than
   * both on the same stale copy.
   */
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  // ---- History ----

  const past = useRef<CanvasLayout[]>([]);
  const future = useRef<CanvasLayout[]>([]);
  const [, setHistoryTick] = useState(0);

  /** Hands a new layout to the parent (which auto-saves it), without touching history. */
  const emit = (next: CanvasLayout) => {
    layoutRef.current = next;
    onChange(next);
  };

  /** Pushes `before` onto the undo stack (capped at HISTORY_LIMIT) and clears redo. */
  const remember = (before: CanvasLayout) => {
    lastStep.current = null;
    past.current = [...past.current.slice(-(HISTORY_LIMIT - 1)), before];
    future.current = [];
    setHistoryTick((tick) => tick + 1);
  };

  /**
   * A change that is one step on its own — a button press, a nudge, an upload.
   *
   * Changes sharing a `key` that arrive in quick succession fold into one step,
   * so dragging a colour slider or holding an arrow key is one thing to undo
   * rather than a hundred.
   */
  const lastStep = useRef<{ key: string; at: number } | null>(null);
  const commit = (next: CanvasLayout, key?: string) => {
    const now = Date.now();
    const previous = lastStep.current;
    const continuing = key && previous?.key === key && now - previous.at < 800;
    if (!continuing) remember(layoutRef.current);
    lastStep.current = key ? { key, at: now } : null;
    emit(next);
  };

  /**
   * Moves one step between the undo and redo stacks — `undo` and `redo` are this in opposite
   * directions.
   */
  const travel = (from: typeof past, to: typeof future) => {
    const target = from.current[from.current.length - 1];
    if (!target) return;
    from.current = from.current.slice(0, -1);
    to.current = [...to.current, layoutRef.current];
    setHistoryTick((tick) => tick + 1);
    setEditingId(null);
    setCropping(false);
    if (selectedId && !target.items.some((item) => item.id === selectedId)) setSelectedId(null);
    emit(target);
  };
  const undo = () => travel(past, future);
  const redo = () => travel(future, past);

  // ---- Item helpers ----

  const selected = layout.items.find((item) => item.id === selectedId) ?? null;

  /**
   * Applies `patch` to one item. With `record`, it is an undoable step (repeats of the same kind of
   * change fold together); without, it is a live update mid-gesture.
   */
  const replaceItem = (id: string, patch: Partial<CanvasItem>, record = true) => {
    const current = layoutRef.current;
    const next = {
      ...current,
      items: current.items.map((item) =>
        item.id === id ? ({ ...item, ...patch } as CanvasItem) : item,
      ),
    };
    if (record) commit(next, `${id}:${Object.keys(patch).sort().join(',')}`);
    else emit(next);
  };

  /** Applies `patch` to the selected item, if there is one. */
  const updateSelected = (patch: Partial<CanvasItem>) => {
    if (selected) replaceItem(selected.id, patch);
  };

  /** Puts a new item on top of the canvas and selects it. */
  const addItem = (item: CanvasItem) => {
    stopEditing();
    const current = layoutRef.current;
    commit({ ...current, items: [...current.items, item] });
    setSelectedId(item.id);
    setCropping(false);
  };

  /**
   * Selects an item (or nothing), closing crop mode, the adjust panel and any text editing that
   * belonged to the previous selection.
   */
  const select = (id: string | null) => {
    if (id !== selectedId) {
      setCropping(false);
      setAdjustOpen(false);
    }
    if (id !== editingId) stopEditing();
    setSelectedId(id);
  };

  // ---- Text editing ----

  /** The layout as it was when writing began, so the whole edit undoes as one step. */
  const editStart = useRef<CanvasLayout | null>(null);

  /**
   * Puts a text box into typing mode, remembering the layout so the whole edit undoes as one step.
   */
  const startEditing = (id: string) => {
    editStart.current = layoutRef.current;
    setCropping(false);
    setSelectedId(id);
    setEditingId(id);
  };

  /** Leaves typing mode, recording the edit as one undo step if anything changed. */
  const stopEditing = () => {
    if (editingId && editStart.current && editStart.current !== layoutRef.current) {
      remember(editStart.current);
    }
    editStart.current = null;
    editorRef.current = null;
    setEditingId(null);
  };

  // Put the caret in the box as soon as it becomes editable.
  useEffect(() => {
    const element = editorRef.current;
    if (!editingId || !element) return;
    // Without preventScroll the browser scrolls the page to the box as it focuses.
    element.focus({ preventScroll: true });
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, [editingId]);

  /** Typing grows the box to fit, so text never spills out under whatever is below it. */
  const onTextHtml = (id: string, html: string, contentHeight: number) => {
    const item = layoutRef.current.items.find((candidate) => candidate.id === id);
    if (!item || item.kind !== 'text') return;
    const height = Math.max(item.height, Math.ceil(contentHeight));
    if (html === item.html && height === item.height) return;
    replaceItem(id, { html, height }, false);
  };

  // ---- Pointer gestures ----

  /** Converts a screen position to canvas coordinates, undoing the on-screen scale. */
  const toCanvas = (clientX: number, clientY: number): Point => {
    const rect = surfaceRef.current?.getBoundingClientRect();
    if (!rect || !scale) return { x: 0, y: 0 };
    return { x: (clientX - rect.left) / scale, y: (clientY - rect.top) / scale };
  };

  /**
   * Starts a move, resize, rotate, crop or pan (moving a picture inside its crop) drag. Updates are
   * live while the pointer moves; the whole drag becomes one undo step on release.
   */
  const beginGesture = (event: React.PointerEvent, gesture: Gesture) => {
    event.preventDefault();
    event.stopPropagation();
    const id = gesture.start.id;
    // Moving or resizing the box being written in leaves the caret where it is,
    // so typing carries on once the drag ends.
    if (id !== editingId) containerRef.current?.focus({ preventScroll: true });
    const before = layoutRef.current;

    /**
     * A move only starts once the pointer has travelled a few pixels, so a
     * click — or the two clicks of a double-click — never nudges the item.
     */
    const startX = event.clientX;
    const startY = event.clientY;
    let moving = gesture.kind !== 'move';

    /** Applies the gesture for the pointer's current position. */
    const onMove = (move: PointerEvent) => {
      if (!moving) {
        if (Math.hypot(move.clientX - startX, move.clientY - startY) < MOVE_THRESHOLD_PX) return;
        moving = true;
      }
      const point = toCanvas(move.clientX, move.clientY);
      const dx = 'from' in gesture ? point.x - gesture.from.x : 0;
      const dy = 'from' in gesture ? point.y - gesture.from.y : 0;
      const { start } = gesture;

      switch (gesture.kind) {
        case 'move':
          replaceItem(id, { x: Math.round(start.x + dx), y: Math.round(start.y + dy) }, false);
          break;
        case 'resize': {
          // Pictures hold their shape by default and Shift frees them; for
          // everything else Shift is what holds it.
          const keepAspect = start.kind === 'image' ? !move.shiftKey : move.shiftKey;
          replaceItem(id, resizeBox(start, gesture.handle, dx, dy, keepAspect), false);
          break;
        }
        case 'rotate':
          replaceItem(
            id,
            { rotation: rotationToward(start, point.x, point.y, move.shiftKey) },
            false,
          );
          break;
        case 'crop':
          replaceItem(id, cropBox(gesture.start, gesture.handle, dx, dy), false);
          break;
        case 'pan':
          replaceItem(id, { crop: panCrop(gesture.start, dx, dy) }, false);
          break;
      }
    };

    /** Ends the gesture and records it for undo if anything changed. */
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      // The whole drag is one step to undo, and a click that moved nothing is none.
      if (layoutRef.current !== before) remember(before);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  /**
   * Selects an item and starts dragging it — panning the picture instead while cropping, and doing
   * nothing for the text box being typed in, where the pointer places the caret.
   */
  const onItemPointerDown = (event: React.PointerEvent, item: CanvasItem) => {
    if (event.button !== 0) return;
    // Writing in a text box: the pointer is for placing the caret, not dragging.
    if (item.id === editingId) {
      event.stopPropagation();
      return;
    }
    select(item.id);
    const from = toCanvas(event.clientX, event.clientY);
    if (cropping && item.id === selectedId && item.kind === 'image') {
      beginGesture(event, { kind: 'pan', start: item, from });
    } else {
      beginGesture(event, { kind: 'move', start: item, from });
    }
  };

  // ---- Pictures ----

  /**
   * Uploads the given files and places each as a picture, at `at` if dropped or the centre
   * otherwise. Unsupported files are reported, not uploaded.
   */
  const addPictures = async (files: File[], at?: Point) => {
    setError(null);
    const rejected = files.filter((file) => !isAcceptedPicture(file));
    if (rejected.length > 0) {
      setError(
        `${rejected.map((file) => file.name).join(', ')} ${rejected.length === 1 ? 'is not a' : 'are not'} ` +
          'supported picture type. Use JPEG, PNG, GIF, WebP, BMP or HEIC.',
      );
    }

    // One after another, so they stack in the order they were picked.
    for (const [index, file] of files.filter(isAcceptedPicture).entries()) {
      setUploading((count) => count + 1);
      try {
        const { imageId, asset } = await onUpload(file);
        const src = imageSrc(asset.data, asset.mimeType);
        const size = src ? await naturalSize(src) : { width: 400, height: 300 };
        // Several dropped at once fan out a little rather than landing on top of one another.
        const centre = at
          ? { x: at.x + index * 24, y: at.y + index * 24 }
          : { x: CANVAS_WIDTH / 2 + index * 24, y: CANVAS_HEIGHT / 2 + index * 24 };
        addItem(newImage(imageId, size, centre));
      } catch (err) {
        setError(err instanceof Error ? err.message : `Could not upload ${file.name}`);
      } finally {
        setUploading((count) => count - 1);
      }
    }
  };

  /** Adds pictures dropped onto the canvas where they were dropped. */
  const onDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setDropActive(false);
    const files = Array.from(event.dataTransfer.files);
    if (files.length === 0) return;
    void addPictures(files, toCanvas(event.clientX, event.clientY));
  };

  // ---- Clipboard ----

  /** Set by a copy shortcut, and written onto the clipboard by the copy event it triggers. */
  const pendingCopy = useRef<CanvasClipboard | null>(null);
  /** Whether the paste event for the latest paste shortcut has arrived. */
  const pasteHandled = useRef(false);

  /**
   * Copies the selected item: onto the system clipboard under the canvas's own
   * format, and into memory. A picture's data goes with it, so it can be pasted
   * into a canvas that does not have it.
   */
  const copySelected = () => {
    if (!selected) return;
    const assets: Record<string, CanvasImageAsset> = {};
    if (selected.kind === 'image' && imagesRef.current[selected.imageId]) {
      assets[selected.imageId] = imagesRef.current[selected.imageId];
    }
    const data: CanvasClipboard = { items: [selected], assets };
    lastCopied = { stamp: newItemId(), data };
    pendingCopy.current = data;
    // Fires the copy event even where nothing on the page is highlighted, which
    // some browsers otherwise skip. The listener below fills it in.
    document.execCommand('copy');
    pendingCopy.current = null;
  };

  /**
   * Puts copied items onto this canvas, on top, a step down and right of
   * anything already in the same spot. A picture this canvas does not hold is
   * uploaded into it first.
   */
  const pasteItems = async (data: CanvasClipboard) => {
    setError(null);
    for (const copied of data.items) {
      let item: CanvasItem = { ...copied, id: newItemId() };
      if (item.kind === 'image' && !imagesRef.current[item.imageId]) {
        const asset = data.assets[item.imageId];
        if (!asset) continue;
        setUploading((count) => count + 1);
        try {
          const { imageId } = await onUpload(assetToFile(asset));
          item = { ...item, imageId };
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Could not paste that picture');
          continue;
        } finally {
          setUploading((count) => count - 1);
        }
      }
      while (layoutRef.current.items.some((other) => other.x === item.x && other.y === item.y)) {
        item = { ...item, x: item.x + 16, y: item.y + 16 };
      }
      addItem(item);
    }
  };

  /**
   * Handles a paste onto the canvas: copied canvas items first, then pictures
   * from the computer's clipboard. Returns false if there was nothing to use.
   */
  const pasteFrom = (data: DataTransfer): boolean => {
    const copied = parseClipboard(data.getData(CLIPBOARD_TYPE));
    if (copied) {
      void pasteItems(copied);
      return true;
    }
    const files = clipboardImages(data);
    if (files.length > 0) {
      void addPictures(files);
      return true;
    }
    // A browser that dropped the custom format still has the marker text.
    const text = data.getData('text/plain');
    if (lastCopied && text === `canvas-item:${lastCopied.stamp}`) {
      void pasteItems(lastCopied.data);
      return true;
    }
    return false;
  };

  /**
   * The paste shortcut. Most browsers follow it with a paste event, handled
   * above; where none comes — Safari, with nothing editable focused — the
   * clipboard is read directly instead (which may ask for permission).
   */
  const onPasteShortcut = () => {
    pasteHandled.current = false;
    window.setTimeout(async () => {
      if (pasteHandled.current) return;
      try {
        const files: File[] = [];
        for (const entry of await navigator.clipboard.read()) {
          const type = entry.types.find((t) => t.startsWith('image/'));
          if (type) {
            const blob = await entry.getType(type);
            files.push(new File([blob], `pasted.${type.split('/')[1]}`, { type }));
          }
        }
        if (files.length > 0) void addPictures(files);
        else if (lastCopied) void pasteItems(lastCopied.data);
      } catch {
        if (lastCopied) void pasteItems(lastCopied.data);
      }
    }, 100);
  };

  // Clipboard events go to the document, not the canvas. They are only taken
  // while the canvas has focus and nothing editable inside it does — copying or
  // pasting text in a text box works as normal. Kept in a ref so the listeners,
  // attached once, see the current selection.
  const clipboardRef = useRef({ pasteFrom, copySelected });
  clipboardRef.current = { pasteFrom, copySelected };
  useEffect(() => {
    /** True while the canvas, not a field inside it, has the keyboard. */
    const canvasFocused = () => {
      const active = document.activeElement as HTMLElement | null;
      return (
        !!active &&
        !!rootRef.current?.contains(active) &&
        !active.isContentEditable &&
        !['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName)
      );
    };
    const onCopy = (event: ClipboardEvent) => {
      const data = pendingCopy.current;
      if (!data || !event.clipboardData) return;
      event.preventDefault();
      event.clipboardData.setData(CLIPBOARD_TYPE, JSON.stringify(data));
      event.clipboardData.setData('text/plain', `canvas-item:${lastCopied?.stamp ?? ''}`);
    };
    const onPaste = (event: ClipboardEvent) => {
      if (!canvasFocused() || !event.clipboardData) return;
      pasteHandled.current = true;
      if (clipboardRef.current.pasteFrom(event.clipboardData)) event.preventDefault();
    };
    document.addEventListener('copy', onCopy);
    document.addEventListener('paste', onPaste);
    return () => {
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('paste', onPaste);
    };
  }, []);

  // ---- Course defaults ----

  const savedDefault = selected ? defaults?.find((item) => item.id === selected.id) : undefined;
  const defaultState = !savedDefault
    ? 'off'
    : selected && matchesDefault(selected, savedDefault)
      ? 'on'
      : 'changed';

  /** Adds the selected item to the course defaults, updates its copy there, or takes it out. */
  const toggleDefault = async () => {
    if (!selected || !onToggleDefault) return;
    setSavingDefault(true);
    setError(null);
    try {
      await onToggleDefault(selected, defaultState !== 'on');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the course defaults');
    } finally {
      setSavingDefault(false);
    }
  };

  // ---- Keyboard ----

  /** Removes the selected item. */
  const deleteSelected = () => {
    if (!selected) return;
    const current = layoutRef.current;
    commit({ ...current, items: current.items.filter((item) => item.id !== selected.id) });
    setSelectedId(null);
    setEditingId(null);
    setCropping(false);
  };

  /** Copies the selected item, offset slightly so the copy is visible. */
  const duplicateSelected = () => {
    if (!selected) return;
    addItem({ ...selected, id: newItemId(), x: selected.x + 16, y: selected.y + 16 });
  };

  /**
   * Keyboard shortcuts: Escape backs out one level, Delete/Backspace removes, Enter starts typing
   * in a text box, arrows nudge, and Ctrl/⌘ Z/Y/D/C/X/V undo, redo, duplicate, copy, cut and
   * paste. Ignored while typing in a field.
   */
  const onKeyDown = (event: React.KeyboardEvent) => {
    const target = event.target as HTMLElement;
    const typing =
      target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);

    if (event.key === 'Escape') {
      if (editingId) stopEditing();
      else if (cropping) setCropping(false);
      else select(null);
      return;
    }
    if (typing) return;

    const command = event.metaKey || event.ctrlKey;
    if (command && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
      return;
    }
    if (command && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      redo();
      return;
    }
    if (command && event.key.toLowerCase() === 'v') {
      // Left to the browser, which raises the paste event handled above.
      onPasteShortcut();
      return;
    }
    if (!selected) return;

    if (command && (event.key.toLowerCase() === 'c' || event.key.toLowerCase() === 'x')) {
      event.preventDefault();
      copySelected();
      if (event.key.toLowerCase() === 'x') deleteSelected();
      return;
    }

    if (command && event.key.toLowerCase() === 'd') {
      event.preventDefault();
      duplicateSelected();
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      deleteSelected();
    } else if (event.key === 'Enter' && selected.kind === 'text') {
      event.preventDefault();
      startEditing(selected.id);
    } else if (event.key.startsWith('Arrow')) {
      event.preventDefault();
      const step = event.shiftKey ? 10 : 1;
      const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
      const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
      updateSelected({ x: selected.x + dx, y: selected.y + dy });
    }
  };

  // ---- Drawing ----

  /** Draws one item, with its selection frame and handles when selected. */
  const renderItem = (item: CanvasItem) => {
    const editing = item.id === editingId;
    const frame: CSSProperties = {
      ...itemFrameStyle(item),
      opacity: item.opacity,
      // A shape is only clickable where it is drawn — see ShapeGraphic.
      pointerEvents: item.kind === 'shape' ? 'none' : 'auto',
      cursor: editing ? 'text' : 'move',
      // An unbordered text box would be invisible when empty, so the editor
      // outlines it faintly. Learners never see this.
      outline:
        item.kind === 'text' && !(item.borderWidth > 0 && item.borderColor)
          ? `${1 / (scale || 1)}px dashed rgba(0, 0, 0, 0.25)`
          : undefined,
    };

    return (
      <div
        key={item.id}
        style={frame}
        onPointerDown={(event) => onItemPointerDown(event, item)}
        onDoubleClick={() => item.kind === 'text' && startEditing(item.id)}
      >
        {item.kind === 'image' && (
          <CanvasPicture
            item={item}
            src={sources[item.imageId] ?? null}
            ghost={cropping && item.id === selectedId}
          />
        )}
        {item.kind === 'shape' && (
          <ShapeGraphic
            shape={item.shape}
            color={item.color}
            outline={shapeOutline(item)}
            outlineWidth={item.borderWidth}
            filled={item.filled}
            hit
          />
        )}
        {item.kind === 'text' && (
          <CanvasTextContent
            item={item}
            editing={editing}
            editorRef={editorRef}
            onHtml={(html, height) => onTextHtml(item.id, html, height)}
          />
        )}
      </div>
    );
  };

  /** The eight nodes and the turn handle around whatever is selected. */
  const renderSelection = (item: CanvasItem) => {
    const unit = 1 / (scale || 1);
    const handleSize = HANDLE_PX * unit;
    const editing = item.id === editingId;
    const cropMode = cropping && item.kind === 'image';

    return (
      <div
        style={{
          ...itemFrameStyle(item),
          outline: `${1.5 * unit}px solid ${cropMode ? '#111111' : '#2563eb'}`,
          pointerEvents: 'none',
        }}
      >
        {/* Grabbing anywhere inside the selection moves it, even where another
            item overlaps — except while writing, when clicks go to the text. */}
        {!editing && (
          <div
            data-testid="canvas-selection-body"
            style={{ position: 'absolute', inset: 0, pointerEvents: 'auto', cursor: 'move' }}
            onPointerDown={(event) => onItemPointerDown(event, item)}
            onDoubleClick={() => item.kind === 'text' && startEditing(item.id)}
          />
        )}

        {/* While writing, clicks inside the box place the caret, so the box is
            moved by a strip just outside its edge instead — as in a slide app. */}
        {editing &&
          (
            [
              { top: -EDIT_GRAB_PX * unit, left: 0, right: 0, height: EDIT_GRAB_PX * unit },
              { bottom: -EDIT_GRAB_PX * unit, left: 0, right: 0, height: EDIT_GRAB_PX * unit },
              { left: -EDIT_GRAB_PX * unit, top: 0, bottom: 0, width: EDIT_GRAB_PX * unit },
              { right: -EDIT_GRAB_PX * unit, top: 0, bottom: 0, width: EDIT_GRAB_PX * unit },
            ] as CSSProperties[]
          ).map((edge, index) => (
            <div
              key={index}
              data-testid="canvas-edit-grab"
              title="Drag to move the text box"
              style={{ position: 'absolute', ...edge, pointerEvents: 'auto', cursor: 'move' }}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                beginGesture(event, {
                  kind: 'move',
                  start: item,
                  from: toCanvas(event.clientX, event.clientY),
                });
              }}
            />
          ))}

        {HANDLES.map((handle) => (
          <div
            key={handle.id}
            role="presentation"
            data-handle={handle.id}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              const from = toCanvas(event.clientX, event.clientY);
              if (cropMode) {
                beginGesture(event, { kind: 'crop', start: item as CanvasImageItem, from, handle });
              } else {
                beginGesture(event, { kind: 'resize', start: item, from, handle });
              }
            }}
            style={{
              position: 'absolute',
              left: `${((handle.hx + 1) / 2) * 100}%`,
              top: `${((handle.hy + 1) / 2) * 100}%`,
              width: handleSize,
              height: handleSize,
              transform: 'translate(-50%, -50%)',
              background: cropMode ? '#111111' : '#ffffff',
              border: `${1.5 * unit}px solid ${cropMode ? '#ffffff' : '#2563eb'}`,
              borderRadius: cropMode ? 0 : 2 * unit,
              cursor: handleCursor(handle, item.rotation),
              pointerEvents: 'auto',
            }}
          />
        ))}

        {!cropMode && (
          <>
            <div
              style={{
                position: 'absolute',
                left: '50%',
                top: -ROTATE_OFFSET_PX * unit,
                width: 1.5 * unit,
                height: ROTATE_OFFSET_PX * unit,
                background: '#2563eb',
                transform: 'translateX(-50%)',
              }}
            />
            <div
              role="presentation"
              data-handle="rotate"
              title="Drag to rotate (Shift snaps to 15°)"
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                beginGesture(event, { kind: 'rotate', start: item });
              }}
              style={{
                position: 'absolute',
                left: '50%',
                top: -ROTATE_OFFSET_PX * unit,
                width: handleSize * 1.3,
                height: handleSize * 1.3,
                transform: 'translate(-50%, -50%)',
                borderRadius: '50%',
                background: '#ffffff',
                border: `${1.5 * unit}px solid #2563eb`,
                cursor: 'grab',
                pointerEvents: 'auto',
              }}
            />
          </>
        )}
      </div>
    );
  };

  // ---- Toolbar pieces ----

  /** The border-width slider shared by every item kind's toolbar. */
  const borderWidthControl = (item: CanvasItem, max = 20) => (
    <label className="flex h-8 items-center gap-2 text-sm text-dark-gray">
      Border
      <input
        type="range"
        min={0}
        max={max}
        value={item.borderWidth}
        onChange={(e) => {
          const borderWidth = Number(e.target.value);
          // Giving a picture or text box a border with no colour yet picks one,
          // or the slider would appear to do nothing.
          const needsColour = item.kind !== 'shape' && borderWidth > 0 && !item.borderColor;
          replaceItem(
            item.id,
            needsColour ? { borderWidth, borderColor: '#333333' } : { borderWidth },
          );
        }}
        className="w-20"
        aria-label="Border thickness"
      />
      <span className="w-6 text-xs">{item.borderWidth}</span>
    </label>
  );

  /** Border colour for pictures and text boxes: picking one also turns the border on. */
  const borderColourControl = (item: CanvasItem) => (
    <ColorPicker
      label="Border colour"
      value={item.borderColor}
      noneLabel="No border"
      onChange={(borderColor) =>
        replaceItem(item.id, {
          borderColor,
          borderWidth: borderColor ? item.borderWidth || 2 : 0,
        })
      }
    />
  );

  /** Toolbar controls for a selected shape: colour, fill and border. */
  const shapeToolbar = (item: Extract<CanvasItem, { kind: 'shape' }>) => {
    const strokeOnly = SHAPES.find((s) => s.kind === item.shape)?.strokeOnly;
    return (
      <>
        <ColorPicker
          label="Shape colour"
          value={item.color}
          onChange={(color) => color && replaceItem(item.id, { color })}
        />
        <Button
          onClick={() => replaceItem(item.id, { filled: !item.filled })}
          disabled={strokeOnly}
          className={`${btn} ${item.filled ? pressed : ''}`}
          aria-pressed={item.filled}
          title={
            strokeOnly
              ? 'A line has no inside to fill'
              : item.filled
                ? 'Remove the fill'
                : 'Fill the shape with its colour'
          }
        >
          <span
            className="h-4 w-4 rounded-sm border border-gray-300"
            style={{ background: item.filled ? item.color : 'transparent' }}
          />
          Fill
        </Button>
        <ColorPicker
          label="Border colour"
          value={item.borderColor}
          noneLabel="Same as shape"
          noneDisplay={item.color}
          onChange={(borderColor) => replaceItem(item.id, { borderColor })}
        />
        {borderWidthControl(item)}
      </>
    );
  };

  /** Toolbar controls for a selected picture: crop, flip and brightness/contrast/saturation. */
  const imageToolbar = (item: CanvasImageItem) => {
    const cropped = Object.values(item.crop).some((side) => side > 0);
    return (
      <>
        <Button
          onClick={() => setCropping(!cropping)}
          className={`${btn} ${cropping ? pressed : ''}`}
          aria-pressed={cropping}
          title={
            cropping
              ? 'Finish cropping'
              : 'Crop — drag the nodes to trim the edges, drag the picture to choose what shows'
          }
        >
          <ScissorsIcon className="h-4 w-4" /> {cropping ? 'Done' : 'Crop'}
        </Button>
        {cropped && (
          <Button onClick={() => commit(withItem(uncrop(item)))} className={btn}>
            Reset crop
          </Button>
        )}
        <Button
          onClick={() => replaceItem(item.id, { flipX: !item.flipX })}
          className={`${btn} ${item.flipX ? pressed : ''}`}
          aria-pressed={item.flipX}
          title="Flip left to right"
        >
          <ArrowsRightLeftIcon className="h-4 w-4" />
        </Button>
        <Button
          onClick={() => replaceItem(item.id, { flipY: !item.flipY })}
          className={`${btn} ${item.flipY ? pressed : ''}`}
          aria-pressed={item.flipY}
          title="Flip upside down"
        >
          <ArrowsUpDownIcon className="h-4 w-4" />
        </Button>

        <div ref={adjustRef} className="relative">
          <Button
            onClick={() => setAdjustOpen(!adjustOpen)}
            className={btn}
            aria-expanded={adjustOpen}
            title="Brightness, contrast and colour"
          >
            <AdjustmentsHorizontalIcon className="h-4 w-4" /> Adjust
          </Button>
          {adjustOpen && (
            // A grid rather than a row per slider, so every slider starts and
            // ends at the same place whatever its label's length.
            <div
              className="absolute left-0 top-full z-50 mt-1 grid w-80
                grid-cols-[5.5rem_minmax(0,1fr)_2.75rem] items-center gap-x-3 gap-y-2 rounded-lg
                border border-gray-300 bg-white p-3 text-sm text-dark-gray shadow-lg"
            >
              {(
                [
                  ['brightness', 'Brightness'],
                  ['contrast', 'Contrast'],
                  ['saturation', 'Colour'],
                ] as const
              ).map(([key, label]) => (
                <Fragment key={key}>
                  <label htmlFor={`adjust-${key}`} className="whitespace-nowrap">
                    {label}
                  </label>
                  <input
                    id={`adjust-${key}`}
                    type="range"
                    min={0}
                    max={200}
                    value={item[key]}
                    onChange={(e) => replaceItem(item.id, { [key]: Number(e.target.value) })}
                    className="w-full min-w-0"
                  />
                  <span className="text-right text-xs tabular-nums">{item[key]}%</span>
                </Fragment>
              ))}
              <Button
                onClick={() =>
                  replaceItem(item.id, { brightness: 100, contrast: 100, saturation: 100 })
                }
                className={`${btn} col-span-3 justify-self-end`}
              >
                Reset
              </Button>
            </div>
          )}
        </div>

        {borderColourControl(item)}
        {borderWidthControl(item)}
      </>
    );
  };

  /** Toolbar controls for a selected text box: edit, background and border. */
  const textToolbar = (item: CanvasTextItem) => (
    <>
      {editingId !== item.id && (
        <Button onClick={() => startEditing(item.id)} className={btn} title="Write in this box">
          <PencilSquareIcon className="h-4 w-4" /> Edit text
        </Button>
      )}
      <ColorPicker
        label="Background"
        value={item.background}
        noneLabel="None"
        onChange={(background) => replaceItem(item.id, { background })}
      />
      {borderColourControl(item)}
      {borderWidthControl(item)}
    </>
  );

  /** The current layout with one item swapped for a new version of it. */
  const withItem = (next: CanvasItem): CanvasLayout => ({
    ...layoutRef.current,
    items: layoutRef.current.items.map((item) => (item.id === next.id ? next : item)),
  });

  return (
    <div ref={rootRef} className="flex flex-col gap-2">
      {/* Adding things, and the slide as a whole. */}
      <div className="flex flex-wrap items-center gap-1">
        <input
          ref={fileRef}
          type="file"
          accept={IMAGE_ONLY_ACCEPT}
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            // Cleared first, so choosing the same file again after a failure still fires.
            e.target.value = '';
            void addPictures(files);
          }}
        />
        <Button
          onClick={() => fileRef.current?.click()}
          className={btn}
          title="Upload pictures from your computer — or drag or paste them onto the slide"
        >
          <ArrowUpTrayIcon className="h-4 w-4" /> Upload picture
        </Button>
        <Button
          onClick={() => {
            const item = newTextBox();
            addItem(item);
            startEditing(item.id);
          }}
          className={btn}
          title="Add a text box"
        >
          <span className="font-serif font-bold">T</span> Text box
        </Button>

        <div ref={shapesRef} className="relative">
          <Button
            onClick={() => setShapesOpen(!shapesOpen)}
            className={btn}
            aria-haspopup="menu"
            aria-expanded={shapesOpen}
          >
            Shapes <ChevronDownIcon className="h-3 w-3" />
          </Button>
          {shapesOpen && (
            <div
              role="menu"
              className="absolute left-0 top-full z-50 mt-1 grid w-72 grid-cols-5 gap-1 rounded-lg
                border border-gray-300 bg-white p-2 shadow-lg"
            >
              {SHAPES.map((shape) => (
                <button
                  key={shape.kind}
                  type="button"
                  role="menuitem"
                  title={shape.label}
                  aria-label={shape.label}
                  onClick={() => {
                    addItem(newShape(shape.kind as ShapeKind));
                    setShapesOpen(false);
                  }}
                  className="flex h-12 items-center justify-center rounded-md p-2
                    hover:bg-light-gray"
                >
                  <span className="block h-7 w-7">
                    <ShapeGraphic
                      shape={shape.kind}
                      color="#1f4e79"
                      outline="#1f4e79"
                      outlineWidth={1.5}
                      filled={false}
                    />
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <span className="mx-1 h-6 w-px bg-gray-300" />

        <ColorPicker
          label="Slide colour"
          value={layout.background}
          onChange={(background) =>
            background && commit({ ...layoutRef.current, background }, 'background')
          }
        />

        <span className="mx-1 h-6 w-px bg-gray-300" />

        <Button
          onClick={undo}
          disabled={past.current.length === 0}
          className={btn}
          title="Undo (Ctrl/⌘ Z)"
          aria-label="Undo"
        >
          <ArrowUturnLeftIcon className="h-4 w-4" />
        </Button>
        <Button
          onClick={redo}
          disabled={future.current.length === 0}
          className={btn}
          title="Redo (Ctrl/⌘ Shift Z)"
          aria-label="Redo"
        >
          <ArrowUturnRightIcon className="h-4 w-4" />
        </Button>

        {uploading > 0 && (
          <span className="ml-2 text-sm text-dark-gray" role="status">
            Uploading {uploading === 1 ? 'picture' : `${uploading} pictures`}…
          </span>
        )}
      </div>

      {error && (
        <p
          className="rounded-md border border-danger bg-white px-3 py-2 text-sm text-dark-gray"
          role="alert"
        >
          {error}{' '}
          <button type="button" onClick={() => setError(null)} className="underline">
            Dismiss
          </button>
        </p>
      )}

      {/* What can be done to the selected item. */}
      {selected && (
        <div
          className="flex flex-wrap items-center gap-1 rounded-md border border-gray-300
            bg-light-gray p-1"
        >
          <Button
            onClick={() =>
              commit({
                ...layoutRef.current,
                items: restack(layoutRef.current.items, selected.id, 'front'),
              })
            }
            className={btn}
            title="Bring to front"
          >
            <ChevronDoubleUpIcon className="h-4 w-4" /> Front
          </Button>
          <Button
            onClick={() =>
              commit({
                ...layoutRef.current,
                items: restack(layoutRef.current.items, selected.id, 'forward'),
              })
            }
            className={btn}
            title="Bring forward one layer"
            aria-label="Bring forward"
          >
            <ChevronUpIcon className="h-4 w-4" />
          </Button>
          <Button
            onClick={() =>
              commit({
                ...layoutRef.current,
                items: restack(layoutRef.current.items, selected.id, 'backward'),
              })
            }
            className={btn}
            title="Send backward one layer"
            aria-label="Send backward"
          >
            <ChevronDownIcon className="h-4 w-4" />
          </Button>
          <Button
            onClick={() =>
              commit({
                ...layoutRef.current,
                items: restack(layoutRef.current.items, selected.id, 'back'),
              })
            }
            className={btn}
            title="Send to back"
          >
            <ChevronDoubleDownIcon className="h-4 w-4" /> Back
          </Button>

          <span className="mx-1 h-6 w-px bg-gray-300" />

          {selected.kind === 'shape' && shapeToolbar(selected)}
          {selected.kind === 'image' && imageToolbar(selected)}
          {selected.kind === 'text' && textToolbar(selected)}

          <span className="mx-1 h-6 w-px bg-gray-300" />

          <label className="flex h-8 items-center gap-1 text-sm text-dark-gray">
            Rotate
            <input
              type="number"
              min={0}
              max={359}
              value={Math.round(selected.rotation)}
              onChange={(e) => {
                const degrees = Number(e.target.value);
                if (Number.isFinite(degrees))
                  updateSelected({ rotation: ((degrees % 360) + 360) % 360 });
              }}
              className="h-8 w-16 rounded-md border border-gray-300 bg-white px-1 text-right"
              aria-label="Rotation in degrees"
            />
            °
          </label>
          <Button
            onClick={() => updateSelected({ rotation: (selected.rotation + 90) % 360 })}
            className={btn}
            title="Rotate +90°"
            aria-label="Rotate +90°"
          >
            <RotateIcon direction="plus" />
          </Button>
          <Button
            onClick={() => updateSelected({ rotation: (selected.rotation + 270) % 360 })}
            className={btn}
            title="Rotate -90°"
            aria-label="Rotate -90°"
          >
            <RotateIcon direction="minus" />
          </Button>
          <label className="flex h-8 items-center gap-1 text-sm text-dark-gray">
            Opacity
            <input
              type="range"
              min={10}
              max={100}
              value={Math.round(selected.opacity * 100)}
              onChange={(e) => replaceItem(selected.id, { opacity: Number(e.target.value) / 100 })}
              className="w-20"
              aria-label="Opacity"
            />
          </label>

          <span className="mx-1 h-6 w-px bg-gray-300" />

          {onToggleDefault && (
            <Button
              onClick={() => void toggleDefault()}
              disabled={savingDefault || defaults === null}
              className={`${btn} ${defaultState === 'on' ? pressed : ''}`}
              aria-pressed={defaultState === 'on'}
              title={
                defaultState === 'on'
                  ? 'Every new canvas in this course starts with this. Click to stop that.'
                  : defaultState === 'changed'
                    ? 'This has changed since it was made a default. Click to update the default.'
                    : 'Start every new canvas in this course with this' +
                      (selected.kind === 'text' ? ' (as an empty box of the same size)' : '')
              }
            >
              <StarIcon className="h-4 w-4" />
              {defaultState === 'changed' ? 'Update default' : 'Default'}
            </Button>
          )}
          <Button
            onClick={duplicateSelected}
            className={btn}
            title="Duplicate (Ctrl/⌘ D)"
            aria-label="Duplicate"
          >
            <Square2StackIcon className="h-4 w-4" />
          </Button>
          <Button
            onClick={deleteSelected}
            className={`${btn} hover:text-danger-hover`}
            title="Delete (Delete key)"
            aria-label="Delete item"
          >
            <TrashIcon className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* The full text toolbar, acting on the box being written in. */}
      {editingId && selected?.kind === 'text' && (
        <RichTextToolbar
          editorRef={editorRef}
          onChange={(html) =>
            onTextHtml(editingId, html, editorRef.current?.offsetHeight ?? selected.height)
          }
          className="rounded-md border border-gray-300 bg-white"
        />
      )}

      <div
        ref={(element) => {
          (boxRef as React.MutableRefObject<HTMLDivElement | null>).current = element;
          containerRef.current = element;
        }}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes('Files')) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
          setDropActive(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropActive(false);
        }}
        onDrop={onDrop}
        className="relative w-full focus:outline-none"
        aria-label="Canvas — select an item to move, resize or rotate it"
      >
        {scale > 0 && (
          <CanvasSurface
            scale={scale}
            background={layout.background}
            className="rounded-lg ring-1 ring-gray-300"
            surfaceProps={{
              ref: surfaceRef,
              // Clicking empty slide clears the selection and finishes any writing.
              onPointerDown: (event) => {
                if (event.target === event.currentTarget) {
                  select(null);
                  containerRef.current?.focus({ preventScroll: true });
                }
              },
            }}
          >
            {layout.items.map(renderItem)}
            {selected && renderSelection(selected)}
          </CanvasSurface>
        )}

        {dropActive && (
          <div
            className="pointer-events-none absolute inset-0 flex items-center justify-center
              rounded-lg border-4 border-dashed border-navy bg-white/70 text-lg font-semibold
              text-navy"
          >
            Drop pictures to add them
          </div>
        )}

        {layout.items.length === 0 && !dropActive && scale > 0 && (
          <div
            className="pointer-events-none absolute inset-0 flex flex-col items-center
              justify-center gap-1 text-center text-sm text-dark-gray/70"
          >
            <p className="font-semibold">An empty canvas</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default CanvasEditor;
