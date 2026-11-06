/**
 * File: canvas-model.test.ts
 * Description: Unit tests for canvas resizing, rotating, cropping, layering and colour maths.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-10-15
 */
import {
  CANVAS_HEIGHT,
  CanvasImageItem,
  CanvasItem,
  cropBox,
  growTextBox,
  HANDLES,
  hexToRgb,
  layoutOf,
  MIN_ITEM_SIZE,
  newImage,
  newShape,
  panCrop,
  resizeBox,
  restack,
  rgbToHex,
  rotationToward,
  SHAPES,
  uncrop,
} from '@/components/canvas/canvas-model';

const handle = (id: string) => HANDLES.find((h) => h.id === id)!;

const box = (overrides: Partial<CanvasItem> = {}) =>
  ({ x: 100, y: 100, width: 200, height: 100, rotation: 0, ...overrides }) as CanvasItem;

/** Where a point given in the box's own frame (from its centre) lands on the slide. */
function worldPoint(
  b: { x: number; y: number; width: number; height: number; rotation: number },
  lx: number,
  ly: number,
) {
  const radians = (b.rotation * Math.PI) / 180;
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  return {
    x: cx + lx * Math.cos(radians) - ly * Math.sin(radians),
    y: cy + lx * Math.sin(radians) + ly * Math.cos(radians),
  };
}

const picture = (overrides: Partial<CanvasImageItem> = {}): CanvasImageItem => ({
  ...newImage('pic', { width: 200, height: 100 }),
  x: 100,
  y: 100,
  width: 200,
  height: 100,
  ...overrides,
});

describe('resizeBox', () => {
  it('grows from the bottom-right corner without moving the top-left', () => {
    expect(resizeBox(box(), handle('se'), 20, 10)).toEqual({
      x: 100,
      y: 100,
      width: 220,
      height: 110,
    });
  });

  it('moves the top-left when dragging the top-left corner', () => {
    expect(resizeBox(box(), handle('nw'), -20, -10)).toEqual({
      x: 80,
      y: 90,
      width: 220,
      height: 110,
    });
  });

  it('ignores the off-axis part of an edge drag', () => {
    expect(resizeBox(box(), handle('e'), 30, 50)).toEqual({
      x: 100,
      y: 100,
      width: 230,
      height: 100,
    });
  });

  it('measures the drag in the rotated frame and keeps the opposite edge still', () => {
    const start = box({ rotation: 90 });
    // Turned a quarter clockwise, the box's right edge faces down the screen.
    const next = { ...resizeBox(start, handle('e'), 0, 40), rotation: 90 };
    expect(next.width).toBeCloseTo(240);
    expect(next.height).toBeCloseTo(100);

    const leftBefore = worldPoint(start, -start.width / 2, 0);
    const leftAfter = worldPoint(next, -next.width / 2, 0);
    expect(leftAfter.x).toBeCloseTo(leftBefore.x);
    expect(leftAfter.y).toBeCloseTo(leftBefore.y);
  });

  it('keeps the proportions from a corner when asked', () => {
    const next = resizeBox(box(), handle('se'), 100, 0, true);
    expect(next.width / next.height).toBeCloseTo(2);
    expect(next.width).toBeCloseTo(300);
  });

  it('never shrinks below the smallest grabbable size', () => {
    const next = resizeBox(box(), handle('se'), -1000, -1000);
    expect(next.width).toBe(MIN_ITEM_SIZE);
    expect(next.height).toBe(MIN_ITEM_SIZE);
  });
});

describe('cropping', () => {
  it('trims the left edge without moving or resizing the picture underneath', () => {
    const next = cropBox(picture(), handle('w'), 20, 0);
    expect(next.crop.left).toBeCloseTo(0.1);
    expect(next.width).toBeCloseTo(180);
    expect(next.x).toBeCloseTo(120);
  });

  it('stops at the picture’s own edge when dragged outwards', () => {
    const next = cropBox(picture(), handle('e'), 500, 0);
    expect(next.crop.right).toBe(0);
    expect(next.width).toBeCloseTo(200);
  });

  it('always leaves some of the picture showing', () => {
    const next = cropBox(picture(), handle('s'), 0, -1000);
    expect(next.crop.bottom).toBeLessThanOrEqual(0.95);
    expect(next.height).toBeGreaterThan(0);
  });

  it.each([0, 37, 90])('undoes a crop exactly at %i°', (rotation) => {
    const start = picture({ rotation });
    const cropped = { ...start, ...cropBox(start, handle('nw'), 30, 20) };
    const restored = uncrop({ ...cropped, ...cropBox(cropped, handle('se'), -25, -15) });
    // To a tenth: positions are rounded to hundredths at each step, as stored.
    expect(restored.x).toBeCloseTo(start.x, 1);
    expect(restored.y).toBeCloseTo(start.y, 1);
    expect(restored.width).toBeCloseTo(start.width, 1);
    expect(restored.height).toBeCloseTo(start.height, 1);
    expect(restored.crop).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });

  it('pans the picture within its crop, never past an edge', () => {
    const cropped = picture({ width: 100, crop: { top: 0, bottom: 0, left: 0.25, right: 0.25 } });
    const panned = panCrop(cropped, 1000, 0);
    expect(panned.left).toBe(0);
    expect(panned.right).toBeCloseTo(0.5);
  });
});

describe('rotationToward', () => {
  const b = box({ x: 0, y: 0, width: 100, height: 100 });

  it('points the top of the box at the pointer', () => {
    expect(rotationToward(b, 50, -100)).toBe(0);
    expect(rotationToward(b, 200, 50)).toBe(90);
    expect(rotationToward(b, 50, 200)).toBe(180);
  });

  it('clicks onto a right angle when close to one', () => {
    expect(rotationToward(b, 200, 55)).toBe(90);
  });

  it('snaps to 15° steps with Shift', () => {
    expect(rotationToward(b, 200, 20, true) % 15).toBe(0);
  });
});

describe('restack', () => {
  const items = ['a', 'b', 'c'].map((id) => ({ ...newShape('circle'), id }));
  const order = (list: CanvasItem[]) => list.map((item) => item.id).join('');

  it.each([
    ['front', 'a', 'bca'],
    ['back', 'c', 'cab'],
    ['forward', 'a', 'bac'],
    ['backward', 'c', 'acb'],
    ['forward', 'c', 'abc'],
    ['backward', 'a', 'abc'],
  ] as const)('%s on %s gives %s', (to, id, expected) => {
    expect(order(restack(items, id, to))).toBe(expected);
  });
});

describe('new items and stored data', () => {
  it('fits a large picture onto the slide at its own proportions', () => {
    const item = newImage('pic', { width: 4000, height: 3000 });
    expect(item.width / item.height).toBeCloseTo(4 / 3, 1);
    expect(item.width).toBeLessThanOrEqual(960 * 0.6);
  });

  it('has a drawing for every shape', () => {
    for (const shape of SHAPES) expect(shape.path).toMatch(/^M/);
    expect(SHAPES.map((s) => s.kind)).toEqual(
      expect.arrayContaining(['rectangle', 'circle', 'arrow', 'curved-arrow', 'speech-bubble']),
    );
  });

  it('reads a missing canvas as a blank white slide', () => {
    expect(layoutOf(null)).toEqual({ background: '#ffffff', items: [] });
  });

  it('converts between hex and RGB both ways', () => {
    expect(hexToRgb('#1f4e79')).toEqual({ r: 31, g: 78, b: 121 });
    expect(rgbToHex(31, 78, 121)).toBe('#1f4e79');
    expect(rgbToHex(300, -5, 12.6)).toBe('#ff000d');
  });
});

describe('growTextBox', () => {
  const box = { x: 100, y: 100, width: 320, height: 80, rotation: 0 };

  it('does nothing when the text already fits', () => {
    expect(growTextBox(box, 60)).toBeNull();
    expect(growTextBox(box, 80)).toBeNull();
  });

  it('grows downward from the top edge while there is room', () => {
    expect(growTextBox(box, 120)).toEqual({ x: 100, y: 100, width: 320, height: 120 });
  });

  it('is pushed up instead of growing off the bottom of the slide', () => {
    const low = { ...box, y: CANVAS_HEIGHT - 80 };
    const grown = growTextBox(low, 200)!;
    expect(grown.height).toBe(200);
    expect(grown.y + grown.height).toBe(CANVAS_HEIGHT);
  });

  it('stops at the top of the slide when the text is taller than it', () => {
    const grown = growTextBox({ ...box, y: 300 }, CANVAS_HEIGHT + 100)!;
    expect(grown.y).toBe(0);
    expect(grown.height).toBe(CANVAS_HEIGHT + 100);
  });

  it('keeps the top edge of a rotated box in place as it grows', () => {
    const turned = { ...box, rotation: 30 };
    const grown = growTextBox(turned, 140)!;
    // The top edge's midpoint, before and after, in slide coordinates.
    const topMid = (b: { x: number; y: number; width: number; height: number }) => {
      const r = (30 * Math.PI) / 180;
      const cx = b.x + b.width / 2;
      const cy = b.y + b.height / 2;
      const h = b.height / 2;
      return { x: cx + h * Math.sin(r), y: cy - h * Math.cos(r) };
    };
    expect(topMid(grown).x).toBeCloseTo(topMid(turned).x, 1);
    expect(topMid(grown).y).toBeCloseTo(topMid(turned).y, 1);
  });
});
