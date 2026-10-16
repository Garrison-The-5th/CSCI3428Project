/**
 * File: canvas.test.ts
 * Description: Unit tests for cleaning a canvas layout and managing its picture pool.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-10-15
 */
import {
  addCanvasImage,
  CanvasImageItem,
  CanvasShapeItem,
  CanvasTextItem,
  emptyCanvas,
  MAX_CANVAS_IMAGES,
  MAX_CANVAS_ITEMS,
  mergeCanvasLayout,
} from '@/config/canvas';

const NOW = new Date('2026-10-15T12:00:00Z');

/** A stored canvas holding one picture, uploaded `ageMs` before NOW. */
function withPicture(ageMs = 0) {
  return {
    ...emptyCanvas(),
    images: {
      pic: {
        data: 'AAAA',
        mimeType: 'image/png',
        fileName: 'a.png',
        uploadedAt: new Date(NOW.getTime() - ageMs).toISOString(),
      },
    },
  };
}

const shape = (overrides: Record<string, unknown> = {}) => ({
  id: 's1',
  kind: 'shape',
  shape: 'circle',
  x: 10,
  y: 20,
  width: 100,
  height: 80,
  rotation: 0,
  color: '#ff0000',
  filled: true,
  ...overrides,
});

describe('mergeCanvasLayout — structure', () => {
  it('rejects a layout that is not an object or has no item list', () => {
    expect(() => mergeCanvasLayout(null, null)).toThrow();
    expect(() => mergeCanvasLayout({ items: 'nope' }, null)).toThrow();
  });

  it(`refuses more than ${MAX_CANVAS_ITEMS} items`, () => {
    const items = Array.from({ length: MAX_CANVAS_ITEMS + 1 }, (_, i) => shape({ id: `s${i}` }));
    expect(() => mergeCanvasLayout({ items }, null)).toThrow(/at most/);
  });

  it('keeps item order, which is the layering', () => {
    const result = mergeCanvasLayout(
      { items: [shape({ id: 'back' }), shape({ id: 'front' })] },
      null,
    );
    expect(result.items.map((item) => item.id)).toEqual(['back', 'front']);
  });

  it('drops unknown kinds, unknown shapes, bad ids and duplicate ids', () => {
    const result = mergeCanvasLayout(
      {
        items: [
          shape(),
          shape(), // duplicate id
          shape({ id: 'bad id!' }),
          shape({ id: 's2', shape: 'pentacle' }),
          { id: 'v1', kind: 'video' },
        ],
      },
      null,
    );
    expect(result.items).toHaveLength(1);
  });

  it('strips fields the item kind does not have', () => {
    const [item] = mergeCanvasLayout(
      { items: [shape({ onclick: 'alert(1)', html: '<script>' })] },
      null,
    ).items;
    expect(item).not.toHaveProperty('onclick');
    expect(item).not.toHaveProperty('html');
  });
});

describe('mergeCanvasLayout — values', () => {
  it('only accepts six-digit hex colours, falling back otherwise', () => {
    const result = mergeCanvasLayout(
      {
        background: 'red; background-image: url(x)',
        items: [shape({ color: 'expression(alert(1))', borderColor: '#ABCDEF' })],
      },
      null,
    );
    const item = result.items[0] as CanvasShapeItem;
    expect(result.background).toBe('#ffffff');
    expect(item.color).toBe('#1f4e79');
    expect(item.borderColor).toBe('#abcdef');
  });

  it('clamps sizes, normalises rotation and replaces non-numbers', () => {
    const [item] = mergeCanvasLayout(
      { items: [shape({ width: 0, height: 1e9, rotation: -90, x: 'abc', opacity: 7 })] },
      null,
    ).items;
    expect(item.width).toBe(4);
    expect(item.height).toBe(4000);
    expect(item.rotation).toBe(270);
    expect(item.x).toBe(0);
    expect(item.opacity).toBe(1);
  });

  it('sanitises text box markup with the rich text allowlist', () => {
    const [item] = mergeCanvasLayout(
      {
        items: [
          {
            id: 't1',
            kind: 'text',
            html: '<p onclick="alert(1)"><strong>Hi</strong></p><script>alert(1)</script>',
          },
        ],
      },
      null,
    ).items as CanvasTextItem[];
    expect(item.html).toBe('<p><strong>Hi</strong></p>');
  });
});

describe('mergeCanvasLayout — pictures', () => {
  const picture = (overrides: Record<string, unknown> = {}) => ({
    id: 'p1',
    kind: 'image',
    imageId: 'pic',
    x: 0,
    y: 0,
    width: 200,
    height: 100,
    ...overrides,
  });

  it('drops a picture item whose picture was never uploaded', () => {
    const result = mergeCanvasLayout({ items: [picture({ imageId: 'forged' })] }, withPicture());
    expect(result.items).toHaveLength(0);
  });

  it('never takes picture data from the request', () => {
    const result = mergeCanvasLayout(
      {
        items: [picture()],
        images: { pic: { data: 'EVIL', mimeType: 'image/svg+xml' }, extra: { data: 'X' } },
      },
      withPicture(),
    );
    expect(result.images).toEqual(withPicture().images);
  });

  it('keeps a crop that leaves something visible', () => {
    const [item] = mergeCanvasLayout(
      { items: [picture({ crop: { top: 0.8, bottom: 0.8, left: 0.1, right: 2 } })] },
      withPicture(),
      NOW,
    ).items as CanvasImageItem[];
    expect(item.crop.top + item.crop.bottom).toBeLessThanOrEqual(0.95 + 1e-9);
    expect(item.crop.left + item.crop.right).toBeLessThanOrEqual(0.95 + 1e-9);
  });

  it('keeps a fresh unplaced upload, so a save racing an upload cannot delete it', () => {
    const result = mergeCanvasLayout({ items: [] }, withPicture(60_000), NOW);
    expect(result.images).toHaveProperty('pic');
  });

  it('prunes an old picture nothing points at', () => {
    const result = mergeCanvasLayout({ items: [] }, withPicture(2 * 60 * 60 * 1000), NOW);
    expect(result.images).toEqual({});
  });

  it('keeps an old picture that is still placed', () => {
    const result = mergeCanvasLayout({ items: [picture()] }, withPicture(2 * 60 * 60 * 1000), NOW);
    expect(result.images).toHaveProperty('pic');
  });
});

describe('addCanvasImage', () => {
  const upload = { data: 'BBBB', mimeType: 'image/jpeg', fileName: 'b.jpg' };

  it('adds the picture under a new id, stamped with the upload time', () => {
    const { canvas, imageId } = addCanvasImage(emptyCanvas(), upload, NOW);
    expect(canvas.images[imageId]).toEqual({ ...upload, uploadedAt: NOW.toISOString() });
  });

  it('treats a missing canvas as empty', () => {
    const { canvas } = addCanvasImage(null, upload, NOW);
    expect(Object.keys(canvas.images)).toHaveLength(1);
  });

  it(`refuses more than ${MAX_CANVAS_IMAGES} pictures`, () => {
    let stored: unknown = emptyCanvas();
    for (let i = 0; i < MAX_CANVAS_IMAGES; i += 1) {
      stored = addCanvasImage(stored, upload, NOW).canvas;
    }
    expect(() => addCanvasImage(stored, upload, NOW)).toThrow(/at most/);
  });
});
