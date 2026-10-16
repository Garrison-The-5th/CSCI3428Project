/**
 * File: canvas-editor.test.tsx
 * Description: Component tests for the canvas editor and the learner's canvas view.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-10-15
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';

import CanvasEditor from '@/components/canvas/canvas-editor';
import {
  CanvasImageAsset,
  CanvasLayout,
  CanvasShapeItem,
  EMPTY_LAYOUT,
  newShape,
} from '@/components/canvas/canvas-model';
import CanvasView from '@/components/canvas/canvas-view';

/** jsdom lays nothing out, so the editor is told it has a slide's width of room. */
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => 960,
  });
});

/** The editor is controlled; this holds its layout the way the element editor does. */
function Harness({
  initial = EMPTY_LAYOUT,
  onUpload = jest.fn(),
  spy,
}: {
  initial?: CanvasLayout;
  onUpload?: (file: File) => Promise<{ imageId: string; asset: CanvasImageAsset }>;
  spy?: (layout: CanvasLayout) => void;
}) {
  const [layout, setLayout] = useState(initial);
  const [images, setImages] = useState<Record<string, CanvasImageAsset>>({});
  return (
    <CanvasEditor
      layout={layout}
      onChange={(next) => {
        setLayout(next);
        spy?.(next);
      }}
      images={images}
      onUpload={async (file) => {
        const result = await onUpload(file);
        setImages((prev) => ({ ...prev, [result.imageId]: result.asset }));
        return result;
      }}
    />
  );
}

const lastLayout = (spy: jest.Mock) => spy.mock.calls[spy.mock.calls.length - 1][0] as CanvasLayout;

describe('CanvasEditor — shapes', () => {
  it('adds a shape from the menu, selected, with eight resize nodes and a rotate node', () => {
    const spy = jest.fn();
    const { container } = render(<Harness spy={spy} />);

    fireEvent.click(screen.getByRole('button', { name: /shapes/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Speech bubble' }));

    expect(lastLayout(spy).items).toHaveLength(1);
    expect(lastLayout(spy).items[0]).toMatchObject({ kind: 'shape', shape: 'speech-bubble' });
    const handles = container.querySelectorAll('[data-handle]');
    expect(handles).toHaveLength(9);
    expect(container.querySelector('[data-handle="rotate"]')).not.toBeNull();
  });

  it('fills the shape with its own colour', () => {
    const spy = jest.fn();
    render(<Harness spy={spy} />);
    fireEvent.click(screen.getByRole('button', { name: /shapes/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Circle' }));

    fireEvent.click(screen.getByRole('button', { name: /fill/i }));
    const shape = lastLayout(spy).items[0] as CanvasShapeItem;
    expect(shape.filled).toBe(true);
  });

  it('cannot fill a line, which has no inside', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: /shapes/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Line' }));
    expect(screen.getByRole('button', { name: /fill/i })).toBeDisabled();
  });

  it('sets the shape colour from the RGB controls', () => {
    const spy = jest.fn();
    render(<Harness spy={spy} />);
    fireEvent.click(screen.getByRole('button', { name: /shapes/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Square' }));

    fireEvent.click(screen.getByRole('button', { name: 'Shape colour' }));
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Red value' }), {
      target: { value: '255' },
    });
    expect((lastLayout(spy).items[0] as CanvasShapeItem).color).toMatch(/^#ff/);
  });
});

describe('CanvasEditor — layering, removing and undo', () => {
  const two = (): CanvasLayout => ({
    background: '#ffffff',
    items: [
      { ...newShape('circle'), id: 'back' },
      { ...newShape('rectangle'), id: 'front' },
    ],
  });

  it('moves the selected item to the back and to the front', () => {
    const spy = jest.fn();
    const { container } = render(<Harness initial={two()} spy={spy} />);
    const front = container.querySelector('path[d="M0 0 H100 V100 H0 Z"]')!; // the rectangle

    fireEvent.pointerDown(front, { button: 0 });
    fireEvent.pointerUp(window);
    fireEvent.click(screen.getByRole('button', { name: /^back$/i }));
    expect(lastLayout(spy).items.map((item) => item.id)).toEqual(['front', 'back']);

    fireEvent.click(screen.getByRole('button', { name: /^front$/i }));
    expect(lastLayout(spy).items.map((item) => item.id)).toEqual(['back', 'front']);
  });

  it('deletes the selection with the Delete key, and undoes it', () => {
    const spy = jest.fn();
    render(<Harness initial={two()} spy={spy} />);
    fireEvent.click(screen.getByRole('button', { name: /shapes/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Star' }));
    expect(lastLayout(spy).items).toHaveLength(3);

    const canvas = screen.getByLabelText(/^canvas/i);
    fireEvent.keyDown(canvas, { key: 'Delete' });
    expect(lastLayout(spy).items).toHaveLength(2);

    fireEvent.keyDown(canvas, { key: 'z', ctrlKey: true });
    expect(lastLayout(spy).items).toHaveLength(3);
  });
});

describe('CanvasEditor — text boxes', () => {
  it('adds a text box ready to type in, with the full rich text toolbar', () => {
    const spy = jest.fn();
    render(<Harness spy={spy} />);
    fireEvent.click(screen.getByRole('button', { name: /text box/i }));

    expect(lastLayout(spy).items[0]).toMatchObject({ kind: 'text' });
    expect(screen.getByRole('textbox', { name: 'Text box' })).toBeInTheDocument();
    for (const tool of ['Bold', 'Italic', 'Underline', 'Bullet list', 'Insert table']) {
      expect(screen.getByTitle(tool)).toBeInTheDocument();
    }
  });

  it('saves what is typed into the box', () => {
    const spy = jest.fn();
    render(<Harness spy={spy} />);
    fireEvent.click(screen.getByRole('button', { name: /text box/i }));

    const box = screen.getByRole('textbox', { name: 'Text box' });
    box.innerHTML = '<p>Hello</p>';
    fireEvent.input(box);
    expect(lastLayout(spy).items[0]).toMatchObject({ html: '<p>Hello</p>' });
  });
});

describe('CanvasEditor — pictures', () => {
  /** jsdom never loads images, so this one reports its size straight away. */
  const RealImage = window.Image;
  beforeEach(() => {
    window.Image = class {
      naturalWidth = 800;
      naturalHeight = 400;
      onload: (() => void) | null = null;
      set src(_value: string) {
        setTimeout(() => this.onload?.(), 0);
      }
    } as unknown as typeof Image;
  });
  afterEach(() => {
    window.Image = RealImage;
  });

  const asset: CanvasImageAsset = {
    data: 'AAAA',
    mimeType: 'image/png',
    fileName: 'a.png',
    uploadedAt: '2026-10-15T00:00:00Z',
  };

  it('uploads a dropped picture and places it at its own proportions', async () => {
    const spy = jest.fn();
    const onUpload = jest.fn().mockResolvedValue({ imageId: 'img1', asset });
    render(<Harness spy={spy} onUpload={onUpload} />);

    const file = new File(['x'], 'photo.png', { type: 'image/png' });
    await act(async () => {
      fireEvent.drop(screen.getByLabelText(/^canvas/i), { dataTransfer: { files: [file] } });
    });

    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(onUpload).toHaveBeenCalledWith(file);
    const [item] = lastLayout(spy).items;
    expect(item).toMatchObject({ kind: 'image', imageId: 'img1' });
    expect(item.width / item.height).toBeCloseTo(2);
  });

  it('turns away a file a cover photo would not take, without uploading it', async () => {
    const onUpload = jest.fn();
    render(<Harness onUpload={onUpload} />);

    const file = new File(['x'], 'notes.docx', { type: 'application/msword' });
    await act(async () => {
      fireEvent.drop(screen.getByLabelText(/^canvas/i), { dataTransfer: { files: [file] } });
    });

    expect(onUpload).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('notes.docx');
  });

  it('offers flip, crop and adjust once a picture is selected', async () => {
    const onUpload = jest.fn().mockResolvedValue({ imageId: 'img1', asset });
    render(<Harness onUpload={onUpload} />);
    const file = new File(['x'], 'photo.png', { type: 'image/png' });
    await act(async () => {
      fireEvent.drop(screen.getByLabelText(/^canvas/i), { dataTransfer: { files: [file] } });
    });

    await waitFor(() => expect(screen.getByRole('button', { name: /crop/i })).toBeInTheDocument());
    expect(screen.getByTitle('Flip left to right')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /adjust/i })).toBeInTheDocument();
  });
});

describe('CanvasView', () => {
  it('draws the layout for the learner, without any editing controls', () => {
    const { container } = render(
      <CanvasView
        data={{
          version: 1,
          background: '#ffeedd',
          images: {},
          items: [
            {
              ...newShape('heart'),
              id: 'h',
            },
            {
              id: 't',
              kind: 'text',
              html: '<p>Welcome</p>',
              x: 10,
              y: 10,
              width: 200,
              height: 50,
              rotation: 0,
              opacity: 1,
              background: null,
              borderColor: null,
              borderWidth: 0,
              padding: 8,
            },
          ],
        }}
      />,
    );

    expect(screen.getByText('Welcome')).toBeInTheDocument();
    expect(container.querySelector('svg path')).not.toBeNull();
    expect(container.querySelector('[data-handle]')).toBeNull();
  });
});
