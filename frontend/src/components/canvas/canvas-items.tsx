/**
 * File: canvas-items.tsx
 * Description: Draws canvas items — pictures, shapes and text — for both the editor and the learner.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-10-15
 */
/**
 * How each kind of canvas item is drawn.
 *
 * Shared by the editor and the learner view, so a slide looks the same while it
 * is being built as it does once published.
 */
import { CSSProperties, ReactNode } from 'react';

import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  CanvasImageItem,
  CanvasItem,
  CanvasShapeItem,
  CanvasTextItem,
  imageFilter,
  SHAPE_BY_KIND,
  ShapeKind,
} from '@/components/canvas/canvas-model';

/**
 * Where an item sits on the surface. Rotation turns it about its own centre,
 * which is what the handles in the editor assume too.
 */
export function itemFrameStyle(item: CanvasItem): CSSProperties {
  return {
    position: 'absolute',
    left: item.x,
    top: item.y,
    width: item.width,
    height: item.height,
    transform: item.rotation ? `rotate(${item.rotation}deg)` : undefined,
    transformOrigin: 'center center',
  };
}

/**
 * A shape, drawn as a vector over a transparent background.
 *
 * Only the shape itself is visible — the box around it is see-through, the way
 * a cut-out PNG would be — but as a vector it stays sharp at any size and its
 * colour can change. The 100×100 drawing is stretched to the item, and the
 * outline is kept a constant thickness however far it is stretched.
 *
 * `hit` makes the inside of the shape (not its bounding box) the thing that
 * catches clicks, so an outline circle does not block what sits behind its
 * corners.
 */
export const ShapeGraphic = ({
  shape,
  color,
  outline,
  outlineWidth,
  filled,
  hit = false,
  className,
}: {
  shape: ShapeKind;
  color: string;
  outline: string;
  outlineWidth: number;
  filled: boolean;
  hit?: boolean;
  className?: string;
}) => {
  const definition = SHAPE_BY_KIND[shape];
  const pointerEvents = hit ? ('all' as const) : ('none' as const);
  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className={className}
      style={{ width: '100%', height: '100%', overflow: 'visible', display: 'block' }}
      aria-hidden="true"
    >
      {/* A line is a hairline to click, so it gets a wide invisible twin to aim at. */}
      {hit && definition.strokeOnly && (
        <path
          d={definition.path}
          fill="none"
          stroke="transparent"
          strokeWidth={16}
          vectorEffect="non-scaling-stroke"
          style={{ pointerEvents: 'stroke' }}
        />
      )}
      <path
        d={definition.path}
        fill={filled && !definition.strokeOnly ? color : 'none'}
        stroke={outlineWidth > 0 ? outline : 'none'}
        strokeWidth={outlineWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        fillRule="nonzero"
        style={{ pointerEvents: definition.strokeOnly ? 'none' : pointerEvents }}
      />
      {definition.solidPath && (
        <path d={definition.solidPath} fill={outline} stroke="none" style={{ pointerEvents }} />
      )}
    </svg>
  );
};

/** The colour a shape's outline is drawn in: its own unless a border colour is set. */
export const shapeOutline = (item: CanvasShapeItem) => item.borderColor ?? item.color;

/**
 * A picture inside its crop frame.
 *
 * The whole picture is drawn at its uncropped size and shifted so the cropped
 * part lands in the frame; the frame clips the rest. `ghost` draws the hidden
 * part faintly as well, which is what the editor shows while cropping.
 */
export const CanvasPicture = ({
  item,
  src,
  ghost = false,
}: {
  item: CanvasImageItem;
  src: string | null;
  ghost?: boolean;
}) => {
  const { crop } = item;
  const fullWidth = item.width / (1 - crop.left - crop.right);
  const fullHeight = item.height / (1 - crop.top - crop.bottom);
  const placed: CSSProperties = {
    position: 'absolute',
    left: -crop.left * fullWidth,
    top: -crop.top * fullHeight,
    width: fullWidth,
    height: fullHeight,
  };
  const flip =
    item.flipX || item.flipY ? `scale(${item.flipX ? -1 : 1}, ${item.flipY ? -1 : 1})` : undefined;

  if (!src) {
    return (
      <div
        className="flex h-full w-full items-center justify-center bg-light-gray text-xs
          text-dark-gray"
      >
        Picture missing
      </div>
    );
  }

  /** The <img> for a picture item, with the given positioning style. */
  const picture = (style: CSSProperties) => (
    <img
      src={src}
      alt=""
      draggable={false}
      style={{
        ...placed,
        ...style,
        maxWidth: 'none',
        objectFit: 'fill',
        transform: flip,
        filter: imageFilter(item),
        userSelect: 'none',
      }}
    />
  );

  return (
    <>
      {ghost && picture({ opacity: 0.3 })}
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>{picture({})}</div>
      {item.borderWidth > 0 && item.borderColor && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            border: `${item.borderWidth}px solid ${item.borderColor}`,
            pointerEvents: 'none',
          }}
        />
      )}
    </>
  );
};

/** The box styling of a text item; its contents are drawn by whoever holds it. */
export function textBoxStyle(item: CanvasTextItem): CSSProperties {
  return {
    width: '100%',
    minHeight: '100%',
    boxSizing: 'border-box',
    padding: item.padding,
    background: item.background ?? 'transparent',
    border:
      item.borderWidth > 0 && item.borderColor
        ? `${item.borderWidth}px solid ${item.borderColor}`
        : undefined,
    overflowWrap: 'break-word',
  };
}

/**
 * The fixed 960×540 surface, scaled to the room it is given.
 *
 * Everything inside is laid out in canvas units and the whole surface is scaled
 * with one transform, so text wraps at exactly the same words at every size.
 */
export const CanvasSurface = ({
  scale,
  background,
  children,
  className,
  surfaceProps,
}: {
  scale: number;
  background: string;
  children: ReactNode;
  className?: string;
  surfaceProps?: React.HTMLAttributes<HTMLDivElement> & { ref?: React.Ref<HTMLDivElement> };
}) => (
  <div
    className={`relative overflow-hidden ${className ?? ''}`}
    style={{ width: CANVAS_WIDTH * scale, height: CANVAS_HEIGHT * scale }}
  >
    <div
      {...surfaceProps}
      // The slide sets its own text colour: it has its own background, so it
      // must not pick up the page's dark-mode text and vanish against white.
      className="rich-text absolute left-0 top-0 text-[#333333]"
      style={{
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
        background,
        transform: `scale(${scale})`,
        transformOrigin: '0 0',
        fontSize: 16,
        lineHeight: 1.4,
      }}
    >
      {children}
    </div>
  </div>
);
