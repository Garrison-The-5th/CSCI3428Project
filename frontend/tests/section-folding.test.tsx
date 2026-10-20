/**
 * File: section-folding.test.tsx
 * Description: Component tests for folding sections — in the course player's content rail
 *   and in the course editor's outline.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-10-20
 */
import { fireEvent, render, screen } from '@testing-library/react';

import StructureEditor from '@/pages/private/admin/editor/structure-editor';
import CoursePlayer from '@/pages/private/learning/course-player';
import type { Course, SectionElement } from '@/services/curriculum-api';

// The real router needs TextEncoder, which jsdom lacks; the player only reads these.
jest.mock('react-router-dom', () => ({
  useParams: () => ({}),
  useNavigate: () => jest.fn(),
  useSearchParams: () => [new URLSearchParams()],
}));
jest.mock('@/services/learner-api', () => ({
  useLearnerApi: () => ({
    recordElementView: jest.fn().mockResolvedValue(undefined),
    recordSectionView: jest.fn().mockResolvedValue(undefined),
  }),
}));
jest.mock('@/services/course-map-api', () => ({ courseMapApi: {} }));

const element = (id: string, text: string): SectionElement => ({
  id,
  order: 1,
  type: 'TEXT',
  videoUrl: null,
  imageUrl: null,
  imageData: null,
  imageType: null,
  fileName: null,
  textContent: `<p>${text}</p>`,
  durationMinutes: null,
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
  modules: [{ id: 'm1', courseId: 'c1', number: 1, title: 'Basics' }],
  sections: [
    {
      id: 's1',
      courseId: 'c1',
      moduleId: 'm1',
      position: 1,
      number: '1.1',
      title: 'Exits',
      estimatedMinutes: 5,
      elements: [element('e1', 'Find your nearest exit')],
      quizzes: [],
    },
    {
      id: 's2',
      courseId: 'c1',
      moduleId: 'm1',
      position: 2,
      number: '1.2',
      title: 'Alarms',
      estimatedMinutes: 5,
      elements: [element('e2', 'Know the alarm sound')],
      quizzes: [],
    },
  ],
} as unknown as Course;

function renderPlayer() {
  return render(<CoursePlayer previewCourse={course} preview />);
}

describe('CoursePlayer — folding sections', () => {
  it('collapses and expands one section’s items from its heading', () => {
    renderPlayer();
    const heading = screen.getByRole('button', { name: /1\.2 Alarms/ });
    const items = document.getElementById('section-items-s2')!;

    expect(heading).toHaveAttribute('aria-expanded', 'true');
    expect(items).toBeVisible();

    fireEvent.click(heading);
    expect(heading).toHaveAttribute('aria-expanded', 'false');
    expect(items).not.toBeVisible();
    // The other section is left alone.
    expect(document.getElementById('section-items-s1')).toBeVisible();

    fireEvent.click(heading);
    expect(items).toBeVisible();
  });
});

jest.mock('@/contexts/edit-locks-context', () => ({
  useEditLocks: () => ({
    lockedModules: {},
    claim: jest.fn(),
    marks: { modules: {}, sections: {}, elements: {}, quizzes: {}, questions: {} },
  }),
}));
jest.mock('@/services/quiz-api', () => ({ quizApi: {} }));

describe('StructureEditor — folding sections', () => {
  it('hides and shows a section’s content in the outline', () => {
    render(
      <StructureEditor
        course={course}
        selectedSectionId={null}
        onSelectSection={jest.fn()}
        onRefresh={jest.fn().mockResolvedValue(undefined)}
        onNotify={jest.fn()}
        onDelete={jest.fn()}
        run={jest.fn().mockResolvedValue(true)}
        setCourse={jest.fn()}
      />,
    );

    expect(document.getElementById('section-content-s2')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Hide Alarms content' }));
    expect(document.getElementById('section-content-s2')).toBeNull();
    expect(document.getElementById('section-content-s1')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Show Alarms content' }));
    expect(document.getElementById('section-content-s2')).not.toBeNull();
  });
});
