/**
 * File: element-editor.test.tsx
 * Description: Component tests for editing a section's content — the editor
 *   that used to take an element now takes the section itself.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-11-14
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import ElementEditor, { elementSummary } from '@/components/common/element-editor';
import type { SectionContent } from '@/services/curriculum-api';

const mockUpdateSection = jest.fn().mockResolvedValue({});
const mockUploadSectionFile = jest.fn().mockResolvedValue({});

jest.mock('@/services/curriculum-api', () => ({
  ...jest.requireActual('@/services/curriculum-api'),
  curriculumApi: {
    updateSection: (...args: unknown[]) => mockUpdateSection(...args),
    uploadSectionFile: (...args: unknown[]) => mockUploadSectionFile(...args),
    getCanvasTemplate: jest.fn().mockResolvedValue([]),
  },
}));

function section(overrides: Partial<SectionContent>): SectionContent {
  return {
    id: 'sec-1',
    type: 'YOUTUBE',
    videoUrl: 'https://youtu.be/abc',
    imageUrl: null,
    imageData: null,
    imageType: null,
    fileName: null,
    textContent: null,
    durationMinutes: 4,
    ...overrides,
  };
}

beforeEach(() => {
  mockUpdateSection.mockClear();
  mockUploadSectionFile.mockClear();
});

describe('ElementEditor — given a section', () => {
  it('shows the section’s own content in the fields for its type', () => {
    render(<ElementEditor section={section({})} onDelete={jest.fn()} onSaved={jest.fn()} />);

    expect(screen.getByPlaceholderText('YouTube video URL')).toHaveValue('https://youtu.be/abc');
    expect(screen.getByPlaceholderText('Length (min)')).toHaveValue('4');
  });

  /** There is no element to write to any more: a save goes to the section. */
  it('saves an edit to the section', async () => {
    const onSaved = jest.fn();
    render(<ElementEditor section={section({})} onDelete={jest.fn()} onSaved={onSaved} />);

    fireEvent.change(screen.getByPlaceholderText('YouTube video URL'), {
      target: { value: 'https://youtu.be/xyz' },
    });
    fireEvent.click(screen.getByTitle('Save this item now'));

    await waitFor(() => expect(mockUpdateSection).toHaveBeenCalled());
    expect(mockUpdateSection).toHaveBeenCalledWith(
      'sec-1',
      expect.objectContaining({ videoUrl: 'https://youtu.be/xyz', durationMinutes: 4 }),
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it('uploads a file into the section', async () => {
    render(
      <ElementEditor
        section={section({ type: 'IMAGE', videoUrl: null, durationMinutes: null })}
        onDelete={jest.fn()}
        onSaved={jest.fn()}
      />,
    );
    const file = new File(['x'], 'plan.png', { type: 'image/png' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(mockUploadSectionFile).toHaveBeenCalledWith('sec-1', file));
  });

  it('asks its parent to delete the section when the bin is pressed', () => {
    const onDelete = jest.fn();
    render(<ElementEditor section={section({})} onDelete={onDelete} onSaved={jest.fn()} />);

    fireEvent.click(screen.getByTitle('Delete this item'));

    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});

describe('elementSummary', () => {
  it('summarises a section by its content, whatever its type', () => {
    expect(
      elementSummary(section({ type: 'TEXT', textContent: '<p>Know <b>your</b> exits</p>' })),
    ).toBe('Know your exits');
    expect(elementSummary(section({}))).toBe('https://youtu.be/abc');
    expect(elementSummary(section({ type: 'PDF', fileName: 'exits.pdf' }))).toBe('exits.pdf');
    expect(elementSummary(section({ type: 'IMAGE', videoUrl: null }))).toBe('No image yet');
    expect(elementSummary(section({ type: 'CANVAS' }))).toBe('Empty canvas');
    expect(elementSummary(section({ type: 'QUIZ' }))).toBe('Quiz');
  });
});
