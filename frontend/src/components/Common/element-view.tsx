/**
 * File: element-view.tsx
 * Description: Renders one piece of module content.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
/**
 * Renders one piece of module content.
 *
 * Shared by the learner pages and the authoring preview, so what a creator sees
 * while editing is literally the same component the learner gets — the two cannot
 * drift apart.
 */
import {
  ArrowsPointingOutIcon,
  MagnifyingGlassMinusIcon,
  MagnifyingGlassPlusIcon,
} from '@heroicons/react/24/outline';
import { useEffect, useRef, useState } from 'react';

import { imageSrc, ModuleElement } from '@/services/curriculum-api';

/** Accepts watch/share/embed YouTube links and returns the embeddable form. */
export function toYouTubeEmbedUrl(url: string): string | null {
  const match = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return match ? `https://www.youtube.com/embed/${match[1]}` : null;
}

/**
 * A plain one-line summary of rich lesson text, for content lists and rails.
 *
 * Lesson text is stored as markup, so anywhere it is shown as a label rather than
 * rendered must strip the tags first — otherwise the reader sees "<h2>Title".
 * Every summary in the app goes through this, so there is one place to fix.
 */
export function plainPreview(text: string, max = 60): string {
  const flat = text
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/** Zoom stops, in multiples of "fits the stage". */
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.25;

/**
 * An image with zoom controls.
 *
 * Its own component rather than a branch inside ElementView because it holds
 * state, and ElementView returns early for every other content type — hooks
 * cannot live behind those returns.
 *
 * Zoom scales the picture inside a scrolling box rather than moving a transform
 * origin around: at 1x it behaves exactly as it did before, and past that the
 * browser's own scrolling does the panning, so keyboard and trackpad work
 * without any of it being reimplemented. Dragging is added on top for the mouse.
 */
const ZoomableImage = ({ src, fill }: { src: string; fill: boolean }) => {
  const [zoom, setZoom] = useState(1);
  const viewportRef = useRef<HTMLDivElement>(null);
  // Where the pointer went down and where the box was scrolled to at that
  // moment; panning is the difference between the two.
  const dragFrom = useRef<{ x: number; y: number; left: number; top: number } | null>(null);

  const zoomBy = (delta: number) =>
    setZoom((current) =>
      Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round((current + delta) * 100) / 100)),
    );

  // Coming back to 1x leaves the box scrolled somewhere arbitrary, which reads
  // as the picture having moved. Put it back to the middle.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || zoom !== 1) return;
    viewport.scrollTo({ left: 0, top: 0 });
  }, [zoom]);

  const startPan = (event: React.PointerEvent<HTMLDivElement>) => {
    const viewport = viewportRef.current;
    if (!viewport || zoom === 1) return;
    dragFrom.current = {
      x: event.clientX,
      y: event.clientY,
      left: viewport.scrollLeft,
      top: viewport.scrollTop,
    };
    viewport.setPointerCapture(event.pointerId);
  };

  const pan = (event: React.PointerEvent<HTMLDivElement>) => {
    const viewport = viewportRef.current;
    const from = dragFrom.current;
    if (!viewport || !from) return;
    viewport.scrollLeft = from.left - (event.clientX - from.x);
    viewport.scrollTop = from.top - (event.clientY - from.y);
  };

  const endPan = (event: React.PointerEvent<HTMLDivElement>) => {
    dragFrom.current = null;
    viewportRef.current?.releasePointerCapture(event.pointerId);
  };

  const buttonClass =
    'flex h-8 w-8 items-center justify-center rounded-md border border-gray-300 bg-white ' +
    'text-dark-gray transition-colors hover:bg-light-gray disabled:opacity-40 ' +
    'disabled:hover:bg-white';

  return (
    <div className={`flex flex-col gap-2 ${fill ? 'h-full' : ''}`}>
      <div
        ref={viewportRef}
        onPointerDown={startPan}
        onPointerMove={pan}
        onPointerUp={endPan}
        onPointerCancel={endPan}
        className={`flex min-h-0 flex-1 items-center justify-center
          ${zoom > 1 ? 'cursor-grab overflow-auto active:cursor-grabbing' : 'overflow-hidden'}`}
      >
        <img
          src={src}
          alt=""
          draggable={false}
          // object-contain scales the picture down to the stage without cropping
          // or stretching it, whatever shape it happens to be. Width grows with
          // the zoom so the scroll box gets something to scroll.
          className={`rounded-lg border border-gray-300 select-none
            ${fill ? 'max-h-full object-contain' : ''}`}
          style={
            zoom === 1
              ? { maxWidth: '100%' }
              : { width: `${zoom * 100}%`, maxWidth: 'none', maxHeight: 'none' }
          }
          // A broken link should say so in the editor rather than show a dead icon.
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = 'none';
          }}
        />
      </div>

      <div className="flex shrink-0 items-center justify-center gap-2">
        <button
          type="button"
          onClick={() => zoomBy(-ZOOM_STEP)}
          disabled={zoom <= MIN_ZOOM}
          className={buttonClass}
          aria-label="Zoom out"
          title="Zoom out"
        >
          <MagnifyingGlassMinusIcon className="w-4 h-4" />
        </button>

        <span className="w-14 text-center text-xs font-medium text-dark-gray">
          {Math.round(zoom * 100)}%
        </span>

        <button
          type="button"
          onClick={() => zoomBy(ZOOM_STEP)}
          disabled={zoom >= MAX_ZOOM}
          className={buttonClass}
          aria-label="Zoom in"
          title="Zoom in"
        >
          <MagnifyingGlassPlusIcon className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={() => setZoom(1)}
          disabled={zoom === 1}
          className={buttonClass}
          aria-label="Fit to screen"
          title="Fit to screen"
        >
          <ArrowsPointingOutIcon className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

interface ElementViewProps {
  element: ModuleElement;
  /** Preview mode explains empty/invalid content instead of rendering nothing. */
  preview?: boolean;
  /**
   * Size to the container rather than to the content.
   *
   * The player gives every item the same fixed stage, so switching between a
   * paragraph and a video does not resize the page and push the notes tab off
   * screen. Overflowing text and PDFs scroll inside the stage; images and videos
   * scale down to fit it. Left off, each item is its natural size — which is what
   * the small inline preview in the module editor wants.
   */
  fill?: boolean;
}

const ElementView = ({ element, preview = false, fill = false }: ElementViewProps) => {
  const missing = (message: string) =>
    preview ? (
      <p className="rounded border border-dashed border-gray-300 p-3 text-sm text-dark-gray">
        {message}
      </p>
    ) : null;

  if (element.type === 'TEXT') {
    if (!element.textContent?.trim()) return missing('Empty text block');

    // Safe to inject: the server sanitises lesson text on write against a strict
    // allowlist, so what is stored can only be the tags the editor produces.
    return (
      <div
        className={`rich-text break-words text-dark-gray ${fill ? 'h-full overflow-y-auto' : ''}`}
        dangerouslySetInnerHTML={{ __html: element.textContent }}
      />
    );
  }

  if (element.type === 'PDF') {
    const src = imageSrc(element.imageData, element.imageType);
    if (!src) return missing('No file attached');
    const name = element.fileName || 'document.pdf';

    return (
      <figure className={`mx-auto flex w-full max-w-3xl flex-col ${fill ? 'h-full' : ''}`}>
        <object
          data={src}
          type="application/pdf"
          // min-h-0 lets the viewer shrink inside the flex column; without it the
          // object keeps its intrinsic height and pushes the caption out of view.
          className={`w-full rounded-lg border border-gray-300
            ${fill ? 'min-h-0 flex-1' : 'h-[32rem]'}`}
        >
          <p className="p-4 text-dark-gray">
            <a href={src} download={name} className="text-green underline">
              Download {name}
            </a>
          </p>
        </object>
        <figcaption className="mt-2 shrink-0 text-center text-sm">
          <a href={src} download={name} className="text-green underline">
            Download {name}
          </a>
        </figcaption>
      </figure>
    );
  }

  if (element.type === 'IMAGE') {
    const src = imageSrc(element.imageData, element.imageType, element.imageUrl);
    if (!src) return missing('No image yet — paste a URL or upload a file');
    return <ZoomableImage src={src} fill={fill} />;
  }

  // YOUTUBE
  if (!element.videoUrl?.trim()) return missing('No video link yet');

  const embedUrl = toYouTubeEmbedUrl(element.videoUrl);
  if (!embedUrl) {
    return preview ? (
      <p className="rounded border border-dashed border-danger p-3 text-sm text-dark-gray">
        That does not look like a YouTube link — it will show as a plain link.
      </p>
    ) : (
      <a
        href={element.videoUrl}
        target="_blank"
        rel="noreferrer"
        className="break-words text-green underline"
      >
        {element.videoUrl}
      </a>
    );
  }

  return (
    // Filling by height and letting aspect-video derive the width keeps the player
    // correctly proportioned on the stage instead of letterboxing it.
    <div className={`mx-auto aspect-video ${fill ? 'h-full max-w-full' : 'w-full max-w-3xl'}`}>
      <iframe
        src={embedUrl}
        title="Module video"
        allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        className="h-full w-full rounded-lg border border-gray-300"
      />
    </div>
  );
};

export default ElementView;
