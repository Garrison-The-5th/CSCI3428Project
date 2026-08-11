/**
 * File: element-view.test.tsx
 * Description: Component tests for lesson content rendering and the plain-text
 *   preview helper.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
import { render, screen } from '@testing-library/react';

import ElementView, { plainPreview, toYouTubeEmbedUrl } from '@/components/common/element-view';
import type { ModuleElement } from '@/services/curriculum-api';

function element(overrides: Partial<ModuleElement>): ModuleElement {
  return {
    id: 'e1',
    moduleId: 'm1',
    order: 1,
    type: 'TEXT',
    videoUrl: null,
    imageUrl: null,
    imageData: null,
    imageType: null,
    fileName: null,
    textContent: null,
    durationMinutes: null,
    ...overrides,
  } as ModuleElement;
}

describe('plainPreview', () => {
  /**
   * Lesson text is stored as HTML, so anywhere it is shown as a label rather
   * than rendered must strip the tags first — otherwise the reader sees
   * "<h2>Title". This has bitten twice, which is why every summary in the app
   * routes through this one function.
   */
  it('strips markup so a rail label never shows raw tags', () => {
    expect(plainPreview('<h2>Fire safety</h2><p>Intro</p>')).toBe('Fire safety Intro');
  });

  it('decodes the entities the editor produces', () => {
    expect(plainPreview('Tom &amp; Jerry &lt;tag&gt; &quot;quoted&quot; &#39;apos&#39;')).toBe(
      'Tom & Jerry <tag> "quoted" \'apos\'',
    );
  });

  it('collapses whitespace so a multi-line block reads as one line', () => {
    expect(plainPreview('<p>one</p>\n\n<p>two</p>')).toBe('one two');
  });

  it('truncates with an ellipsis at the requested length', () => {
    const output = plainPreview('x'.repeat(100), 10);
    expect(output).toHaveLength(11); // 10 characters plus the ellipsis
    expect(output.endsWith('…')).toBe(true);
  });

  it('leaves a short string alone', () => {
    expect(plainPreview('short', 60)).toBe('short');
  });
});

describe('toYouTubeEmbedUrl', () => {
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ'],
    ['https://www.youtube.com/embed/dQw4w9WgXcQ'],
  ])('accepts %s and returns the embeddable form', (url) => {
    expect(toYouTubeEmbedUrl(url)).toBe('https://www.youtube.com/embed/dQw4w9WgXcQ');
  });

  it('returns null for something that is not a YouTube link', () => {
    expect(toYouTubeEmbedUrl('https://vimeo.com/12345')).toBeNull();
    expect(toYouTubeEmbedUrl('not a url')).toBeNull();
  });
});

describe('ElementView — text', () => {
  it('renders sanitised author markup', () => {
    render(<ElementView element={element({ type: 'TEXT', textContent: '<p>Hello there</p>' })} />);
    expect(screen.getByText('Hello there')).toBeInTheDocument();
  });

  it('renders nothing for an empty block outside preview mode', () => {
    const { container } = render(
      <ElementView element={element({ type: 'TEXT', textContent: '' })} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('explains an empty block to an author in preview mode', () => {
    render(<ElementView element={element({ type: 'TEXT', textContent: '' })} preview />);
    expect(screen.getByText(/Empty text block/)).toBeInTheDocument();
  });
});

describe('ElementView — video', () => {
  it('embeds a valid YouTube link', () => {
    render(
      <ElementView
        element={element({ type: 'YOUTUBE', videoUrl: 'https://youtu.be/dQw4w9WgXcQ' })}
      />,
    );

    const frame = screen.getByTitle('Module video');
    expect(frame).toHaveAttribute('src', 'https://www.youtube.com/embed/dQw4w9WgXcQ');
  });

  it('falls back to a plain link when the URL is not YouTube', () => {
    render(
      <ElementView element={element({ type: 'YOUTUBE', videoUrl: 'https://vimeo.com/12345' })} />,
    );

    const link = screen.getByRole('link', { name: /vimeo/ });
    expect(link).toHaveAttribute('href', 'https://vimeo.com/12345');
    // Opened in a new tab, so it must not be able to reach back at us.
    expect(link).toHaveAttribute('rel', 'noreferrer');
  });

  it('warns an author in preview mode that a link will not embed', () => {
    render(
      <ElementView
        element={element({ type: 'YOUTUBE', videoUrl: 'https://vimeo.com/12345' })}
        preview
      />,
    );
    expect(screen.getByText(/does not look like a YouTube link/)).toBeInTheDocument();
  });
});

describe('ElementView — image', () => {
  it('renders an uploaded image with zoom controls', () => {
    render(
      <ElementView
        element={element({ type: 'IMAGE', imageData: 'AAAA', imageType: 'image/png' })}
      />,
    );

    expect(screen.getByLabelText('Zoom in')).toBeInTheDocument();
    expect(screen.getByLabelText('Zoom out')).toBeInTheDocument();
    expect(screen.getByLabelText('Fit to screen')).toBeInTheDocument();
  });

  it('starts at 100% with zoom-out and fit disabled', () => {
    render(
      <ElementView
        element={element({ type: 'IMAGE', imageData: 'AAAA', imageType: 'image/png' })}
      />,
    );

    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(screen.getByLabelText('Zoom out')).toBeDisabled();
    expect(screen.getByLabelText('Fit to screen')).toBeDisabled();
  });

  it('prompts an author when no image has been set', () => {
    render(<ElementView element={element({ type: 'IMAGE' })} preview />);
    expect(screen.getByText(/No image yet/)).toBeInTheDocument();
  });
});

describe('ElementView — PDF', () => {
  it('renders a viewer with a download fallback', () => {
    render(
      <ElementView
        element={element({
          type: 'PDF',
          imageData: 'AAAA',
          imageType: 'application/pdf',
          fileName: 'handbook.pdf',
        })}
      />,
    );

    expect(screen.getAllByText(/Download handbook.pdf/).length).toBeGreaterThan(0);
  });

  it('explains a missing file to an author', () => {
    render(<ElementView element={element({ type: 'PDF' })} preview />);
    expect(screen.getByText(/No file attached/)).toBeInTheDocument();
  });
});
