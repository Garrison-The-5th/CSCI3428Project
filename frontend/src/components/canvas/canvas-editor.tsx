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
 * Pictures arrive by dragging them onto the slide from the computer or through
 * the Upload button, and are stored straight away — the slide only remembers
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
import { pastePlainText, RichTextToolbar } from '@/components/common/rich-text-editor';
import { Button } from '@/components/ui/button';
import { IMAGE_ONLY_ACCEPT, imageSrc } from '@/services/curriculum-api';

interface CanvasEditorProps {
  layout: CanvasLayout;
  onChange: (layout: CanvasLayout) => void;
  /** The pictures the layout can draw from. */
  images: Record<string, CanvasImageAsset>;
  /** Stores one picture and resolves with its id once the server has it. */
  onUpload: (file: File) => Promise<{ imageId: string; asset: CanvasImageAsset }>;
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

const btn =
  'h-8 min-w-8 gap-1 px-2 text-sm bg-white text-dark-gray hover:bg-light-gray border border-gray-300';
const pressed = 'bg-navy text-white hover:bg-navy-hover hover:text-white';

/** The cursor for a handle, turned with the item so it always points along the drag. */
const CURSORS = ['ns-resize', 'nesw-resize', 'ew-resize', 'nwse-resize'];
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
      onPaste={(e) => pastePlainText(e, emit)}
      data-placeholder={editing ? 'Type here…' : 'Double-click to type'}
      className={`focus:outline-none empty:before:text-gray-400
        empty:before:content-[attr(data-placeholder)] ${editing ? 'cursor-text' : ''}`}
      style={textBoxStyle(item)}
    />
  );
};

const CanvasEditor = ({ layout, onChange, images, onUpload }: CanvasEditorProps) => {
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

  const containerRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const shapesRef = useRef<HTMLDivElement>(null);
  const adjustRef = useRef<HTMLDivElement>(null);
  useDismiss(shapesRef, shapesOpen, () => setShapesOpen(false));
  useDismiss(adjustRef, adjustOpen, () => setAdjustOpen(false));

  const sources = useImageSources(images);

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

  const emit = (next: CanvasLayout) => {
    layoutRef.current = next;
    onChange(next);
  };

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

  const updateSelected = (patch: Partial<CanvasItem>) => {
    if (selected) replaceItem(selected.id, patch);
  };

  const addItem = (item: CanvasItem) => {
    stopEditing();
    const current = layoutRef.current;
    commit({ ...current, items: [...current.items, item] });
    setSelectedId(item.id);
    setCropping(false);
  };

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

  const startEditing = (id: string) => {
    editStart.current = layoutRef.current;
    setCropping(false);
    setSelectedId(id);
    setEditingId(id);
  };

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
    element.focus();
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

  const toCanvas = (clientX: number, clientY: number): Point => {
    const rect = surfaceRef.current?.getBoundingClientRect();
    if (!rect || !scale) return { x: 0, y: 0 };
    return { x: (clientX - rect.left) / scale, y: (clientY - rect.top) / scale };
  };

  const beginGesture = (event: React.PointerEvent, gesture: Gesture) => {
    event.preventDefault();
    event.stopPropagation();
    containerRef.current?.focus({ preventScroll: true });
    const before = layoutRef.current;
    const id = gesture.start.id;

    const onMove = (move: PointerEvent) => {
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

  const onDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setDropActive(false);
    const files = Array.from(event.dataTransfer.files);
    if (files.length === 0) return;
    void addPictures(files, toCanvas(event.clientX, event.clientY));
  };

  // ---- Keyboard ----

  const deleteSelected = () => {
    if (!selected) return;
    const current = layoutRef.current;
    commit({ ...current, items: current.items.filter((item) => item.id !== selected.id) });
    setSelectedId(null);
    setEditingId(null);
    setCropping(false);
  };

  const duplicateSelected = () => {
    if (!selected) return;
    addItem({ ...selected, id: newItemId(), x: selected.x + 16, y: selected.y + 16 });
  };

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
    if (!selected) return;

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
    <div className="flex flex-col gap-2">
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
          title="Upload pictures from your computer — or drag them onto the slide"
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
            <p>Drag pictures here, or add a text box or a shape from the toolbar.</p>
          </div>
        )}
      </div>

      <p className="text-xs text-dark-gray">
        Drag to move · drag a node to resize (Shift{' '}
        {selected?.kind === 'image' ? 'frees the proportions' : 'keeps the proportions'}) · drag the
        round node to rotate · double-click text to edit · arrows nudge · Delete removes
      </p>
    </div>
  );
};

export default CanvasEditor;
