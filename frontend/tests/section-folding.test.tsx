/**
 * File: section-folding.test.tsx
 * Description: Component tests for the two-layer course outline — folding by
 *   model in the course player's rail and in the course editor, and what a
 *   section's row and the Add section form look like now that a section is
 *   one typed piece of content.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-10-20
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import StructureEditor from '@/pages/private/admin/editor/structure-editor';
import CoursePlayer from '@/pages/private/learning/course-player';
import type { Course, CourseSection } from '@/services/curriculum-api';

const mockRecordSectionView = jest.fn().mockResolvedValue(undefined);
const mockCreateSection = jest.fn();

// The real router needs TextEncoder, which jsdom lacks; the player only reads these.
jest.mock('react-router-dom', () => ({
  useParams: () => ({ courseId: 'c1' }),
  useNavigate: () => jest.fn(),
  useSearchParams: () => [new URLSearchParams()],
}));
const mockGetCourse = jest.fn();
jest.mock('@/services/learner-api', () => ({
  useLearnerApi: () => ({
    recordSectionView: mockRecordSectionView,
    getCourseWithNewIds: mockGetCourse,
    getProgress: jest.fn().mockResolvedValue({ viewedSectionIds: [], attemptedQuizIds: [] }),
    getNotes: jest.fn().mockResolvedValue([]),
  }),
}));
jest.mock('@/services/course-map-api', () => ({ courseMapApi: {} }));
jest.mock('@/contexts/edit-locks-context', () => ({
  useEditLocks: () => ({
    lockedModels: {},
    claim: jest.fn(),
    marks: { models: {}, sections: {}, quizzes: {}, questions: {} },
  }),
}));
jest.mock('@/services/quiz-api', () => ({ quizApi: {}, QUIZ_TYPE_LABELS: {} }));
jest.mock('@/services/curriculum-api', () => ({
  ...jest.requireActual('@/services/curriculum-api'),
  curriculumApi: {
    createSection: (...args: unknown[]) => mockCreateSection(...args),
    getCanvasTemplate: jest.fn().mockResolvedValue([]),
  },
}));

/** A section of one type, in one model. */
const section = (
  id: string,
  modelId: string,
  number: string,
  title: string,
  over: Partial<CourseSection> = {},
): CourseSection => ({
  id,
  courseId: 'c1',
  modelId,
  position: Number(number.split('.')[1]),
  number,
  title,
  estimatedMinutes: 5,
  type: 'TEXT',
  videoUrl: null,
  imageUrl: null,
  imageData: null,
  imageType: null,
  fileName: null,
  textContent: `<p>${title} text</p>`,
  durationMinutes: null,
  quizzes: [],
  ...over,
});

const course = {
  id: 'c1',
  title: 'Fire safety',
  shortDescription: null,
  description: null,
  tags: [],
  languages: [],
  whatYouWillLearn: [],
  prerequisites: [],
  required: false,
  dueDate: null,
  published: true,
  sequential: false,
  instructors: [],
  updatedAt: '2026-11-01T00:00:00Z',
  models: [
    { id: 'm1', courseId: 'c1', number: 1, title: 'Basics' },
    { id: 'm2', courseId: 'c1', number: 2, title: 'Drills' },
  ],
  sections: [
    section('s1', 'm1', '1.1', 'Exits'),
    section('s2', 'm1', '1.2', 'Alarms', {
      type: 'YOUTUBE',
      textContent: null,
      videoUrl: 'https://youtu.be/abc',
    }),
    section('s3', 'm2', '2.1', 'Assembly point'),
  ],
} as unknown as Course;

beforeEach(() => {
  mockRecordSectionView.mockClear();
  mockCreateSection.mockReset();
});

describe('CoursePlayer — the rail is models and their sections', () => {
  it('lists one row per section under its model, with nothing nested beneath', () => {
    render(<CoursePlayer previewCourse={course} preview />);

    const basics = document.getElementById('model-sections-m1')!;
    const rows = within(basics).getAllByRole('button');

    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('1.1 Exits'),
      expect.stringContaining('1.2 Alarms'),
    ]);
    // A section is the content: there is no second list inside a row's item.
    expect(basics.querySelectorAll('ul')).toHaveLength(0);
    expect(document.querySelector('[id^="section-items-"]')).toBeNull();
  });

  it('folds and unfolds one model from its heading, leaving the others alone', () => {
    render(<CoursePlayer previewCourse={course} preview />);
    const heading = screen.getByRole('button', { name: /1\. Basics/ });
    const sections = document.getElementById('model-sections-m1')!;

    expect(heading).toHaveAttribute('aria-expanded', 'true');
    expect(heading).toHaveAttribute('aria-controls', 'model-sections-m1');
    expect(sections).toBeVisible();

    fireEvent.click(heading);
    expect(heading).toHaveAttribute('aria-expanded', 'false');
    expect(sections).not.toBeVisible();
    // The other model is left alone.
    expect(document.getElementById('model-sections-m2')).toBeVisible();

    fireEvent.click(heading);
    expect(sections).toBeVisible();
  });

  it('shows a section’s own content when its row is picked', () => {
    render(<CoursePlayer previewCourse={course} preview />);

    // Opens on the first section's text…
    expect(screen.getByText('Exits text')).toBeInTheDocument();

    // …and picking another section's row shows that section instead.
    fireEvent.click(screen.getByRole('button', { name: /2\.1 Assembly point/ }));
    expect(screen.getByText('Assembly point text')).toBeInTheDocument();
    expect(screen.queryByText('Exits text')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /2\.1 Assembly point/ })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });
});

describe('CoursePlayer — as a learner', () => {
  beforeEach(() => mockGetCourse.mockResolvedValue({ course, newIds: null }));

  /**
   * The first-login tour finds its steps by these attributes. Rebuilding the
   * rail around sections must not have dropped any of them, or the step falls
   * back to a centred card with nothing to point at.
   */
  it('still carries every target the tour spotlights', async () => {
    render(<CoursePlayer />);
    await screen.findByText('Exits text');

    for (const target of ['player-stage', 'player-prev-next', 'player-tabs', 'player-rail']) {
      expect(document.querySelector(`[data-tour="${target}"]`)).not.toBeNull();
    }
  });

  /** Opening a section is all the progress content has: one call, by section. */
  it('records the section that is opened', async () => {
    render(<CoursePlayer />);
    await screen.findByText('Exits text');
    await waitFor(() => expect(mockRecordSectionView).toHaveBeenCalledWith('s1'));

    fireEvent.click(screen.getByRole('button', { name: /1\.2 Alarms/ }));

    await waitFor(() => expect(mockRecordSectionView).toHaveBeenCalledWith('s2'));
    expect(mockRecordSectionView).toHaveBeenCalledTimes(2);
  });
});

/** The structure editor with the props a test does not care about filled in. */
function renderEditor(over: Partial<Parameters<typeof StructureEditor>[0]> = {}) {
  const props = {
    course,
    selectedSectionId: null,
    onSelectSection: jest.fn(),
    onRefresh: jest.fn().mockResolvedValue(undefined),
    onNotify: jest.fn(),
    onDelete: jest.fn(),
    run: jest.fn().mockResolvedValue(true),
    setCourse: jest.fn(),
    ...over,
  };
  render(<StructureEditor {...props} />);
  return props;
}

describe('StructureEditor — the outline is models and their sections', () => {
  it('shows each section as one row with its type badge, and no element list under it', () => {
    renderEditor();

    const exits = screen.getByRole('button', { name: /1\.1 Exits/ });
    const alarms = screen.getByRole('button', { name: /1\.2 Alarms/ });

    expect(within(exits).getByText('Text')).toBeInTheDocument();
    expect(within(alarms).getByText('YouTube')).toBeInTheDocument();
    // The row summarises its own content.
    expect(within(exits).getByText(/Exits text/)).toBeInTheDocument();
    expect(within(alarms).getByText(/youtu\.be\/abc/)).toBeInTheDocument();

    expect(document.querySelector('[id^="section-content-"]')).toBeNull();
    expect(screen.queryByRole('button', { name: /Hide .* content/ })).not.toBeInTheDocument();
  });

  it('folds a model, hiding its sections and leaving the other model’s showing', () => {
    renderEditor();
    const heading = screen.getByRole('button', { name: /1\. Basics/ });

    expect(heading).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(heading);

    expect(heading).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: /1\.1 Exits/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /2\.1 Assembly point/ })).toBeInTheDocument();

    fireEvent.click(heading);
    expect(screen.getByRole('button', { name: /1\.1 Exits/ })).toBeInTheDocument();
  });

  it('opens a section when its row is picked', () => {
    const { onSelectSection } = renderEditor();

    fireEvent.click(screen.getByRole('button', { name: /1\.2 Alarms/ }));

    expect(onSelectSection).toHaveBeenCalledWith('s2');
  });

  it('edits the selected section’s own content, and says what type it is', () => {
    renderEditor({ selectedSectionId: 's2' });

    // The video section's fields, not a list of things inside it.
    expect(screen.getByPlaceholderText('YouTube video URL')).toHaveValue('https://youtu.be/abc');
    expect(screen.queryByLabelText('Content type to add')).not.toBeInTheDocument();
    expect(screen.queryByText('Nothing in this section yet.')).not.toBeInTheDocument();
  });
});

describe('StructureEditor — adding a section', () => {
  /** "It asks for the type first", and there is no blank choice. */
  it('offers the six types, with one always chosen', () => {
    renderEditor();
    const type = screen.getByLabelText('Section type') as HTMLSelectElement;

    expect([...type.options].map((option) => option.textContent)).toEqual([
      'Text',
      'YouTube',
      'Image',
      'PDF',
      'Canvas',
      'Quiz',
    ]);
    expect([...type.options].every((option) => option.value !== '')).toBe(true);
    expect(type.value).toBe('TEXT');
  });

  it('sends the chosen type with the new section, and opens it', async () => {
    mockCreateSection.mockResolvedValue({ section: { id: 'new-1' } });
    const { onSelectSection, onRefresh } = renderEditor();

    fireEvent.change(screen.getByLabelText('Section type'), { target: { value: 'QUIZ' } });
    fireEvent.change(screen.getByPlaceholderText('New section title'), {
      target: { value: 'Safety check' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Add section/ }));

    await waitFor(() => expect(onSelectSection).toHaveBeenCalledWith('new-1'));
    expect(mockCreateSection).toHaveBeenCalledWith(
      'c1',
      expect.objectContaining({ type: 'QUIZ', title: 'Safety check', modelId: 'm2' }),
    );
    expect(onRefresh).toHaveBeenCalled();
  });

  it('does not add a section without a title', () => {
    const { onNotify } = renderEditor();

    fireEvent.click(screen.getByRole('button', { name: /Add section/ }));

    expect(mockCreateSection).not.toHaveBeenCalled();
    expect(onNotify).toHaveBeenCalledWith('Give the section a title', 'error');
  });
});
