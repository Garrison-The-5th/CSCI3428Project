/**
 * File: canvas-view.tsx
 * Description: A canvas as the learner sees it — read-only, scaled to fit.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-10-15
 */
import { useEffect, useMemo, useRef, useState } from 'react';

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
  CanvasData,
  CanvasImageAsset,
  CanvasItem,
  layoutOf,
} from '@/components/canvas/canvas-model';
import { imageSrc } from '@/services/curriculum-api';

/**
 * Tracks how big a box is, so the canvas can be scaled to it.
 *
 * jsdom has no ResizeObserver, and neither do some older embedded browsers, so
 * without one the first measurement stands.
 */
export function useBoxSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, size] as const;
}

/**
 * Turns the picture pool into image sources once, rather than rebuilding a
 * multi-megabyte data URI on every render.
 */
export function useImageSources(images: Record<string, CanvasImageAsset> | undefined) {
  return useMemo(() => {
    const sources: Record<string, string> = {};
    for (const [id, image] of Object.entries(images ?? {})) {
      const src = imageSrc(image.data, image.mimeType);
      if (src) sources[id] = src;
    }
    return sources;
  }, [images]);
}

/** One item, as published. */
export const StaticCanvasItem = ({
  item,
  src,
  onTextClick,
}: {
  item: CanvasItem;
  src?: string | null;
  onTextClick?: (event: React.MouseEvent<HTMLElement>) => void;
}) => (
  <div style={{ ...itemFrameStyle(item), opacity: item.opacity }}>
    {item.kind === 'image' && <CanvasPicture item={item} src={src ?? null} />}
    {item.kind === 'shape' && (
      <ShapeGraphic
        shape={item.shape}
        color={item.color}
        outline={shapeOutline(item)}
        outlineWidth={item.borderWidth}
        filled={item.filled}
      />
    )}
    {item.kind === 'text' && (
      <div
        style={textBoxStyle(item)}
        onClick={onTextClick}
        // Safe to inject: the server sanitises text boxes on write with the same
        // allowlist as lesson text.
        // nosemgrep: typescript.react.security.audit.react-dangerouslysetinnerhtml.react-dangerouslysetinnerhtml
        dangerouslySetInnerHTML={{ __html: item.html }}
      />
    )}
  </div>
);

interface CanvasViewProps {
  data: CanvasData | null | undefined;
  /** Fit inside the container's height as well as its width — the player's fixed stage. */
  fill?: boolean;
  onTextClick?: (event: React.MouseEvent<HTMLElement>) => void;
}

const CanvasView = ({ data, fill = false, onTextClick }: CanvasViewProps) => {
  const [boxRef, box] = useBoxSize<HTMLDivElement>();
  const sources = useImageSources(data?.images);
  const layout = layoutOf(data);

  const byWidth = box.width / CANVAS_WIDTH;
  const scale = fill && box.height > 0 ? Math.min(byWidth, box.height / CANVAS_HEIGHT) : byWidth;

  return (
    <div ref={boxRef} className={`flex w-full items-center justify-center ${fill ? 'h-full' : ''}`}>
      {scale > 0 && (
        <CanvasSurface
          scale={scale}
          background={layout.background}
          className="rounded-lg ring-1 ring-gray-300"
        >
          {layout.items.map((item) => (
            <StaticCanvasItem
              key={item.id}
              item={item}
              src={item.kind === 'image' ? sources[item.imageId] : undefined}
              onTextClick={onTextClick}
            />
          ))}
        </CanvasSurface>
      )}
    </div>
  );
};

export default CanvasView;
