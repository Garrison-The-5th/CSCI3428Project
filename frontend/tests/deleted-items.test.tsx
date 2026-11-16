/**
 * File: deleted-items.test.tsx
 * Description: Component tests for where deleted things are shown — the admin
 *   recycle bin (courses and standalone quizzes only) and a course's Archive
 *   tab (its deleted models, sections and quizzes).
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-11-14
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import ArchivePane from '@/pages/private/admin/editor/archive-pane';
import TrashBin from '@/pages/private/admin-page/trash-bin';

const mockCurriculum = {
  getDeleted: jest.fn(),
  getDeletedStructure: jest.fn(),
  restoreCourse: jest.fn().mockResolvedValue({}),
  restoreAllDeleted: jest.fn().mockResolvedValue({}),
  purgeAllDeleted: jest.fn().mockResolvedValue({}),
  purgeCourse: jest.fn().mockResolvedValue({}),
  restoreModel: jest.fn().mockResolvedValue({}),
  restoreSection: jest.fn().mockResolvedValue({}),
  purgeModel: jest.fn().mockResolvedValue({}),
  purgeSection: jest.fn().mockResolvedValue({}),
};
const mockQuiz = {
  getDeletedQuizzes: jest.fn(),
  restoreQuiz: jest.fn().mockResolvedValue({}),
  restoreAllQuizzes: jest.fn().mockResolvedValue({}),
  purgeAllQuizzes: jest.fn().mockResolvedValue({}),
  purgeQuiz: jest.fn().mockResolvedValue({}),
};

jest.mock('@/services/curriculum-api', () => ({
  ...jest.requireActual('@/services/curriculum-api'),
  curriculumApi: new Proxy(
    {},
    { get: (_target, name: string) => (mockCurriculum as Record<string, unknown>)[name] },
  ),
}));
jest.mock('@/services/quiz-api', () => ({
  quizApi: new Proxy(
    {},
    { get: (_target, name: string) => (mockQuiz as Record<string, unknown>)[name] },
  ),
}));

/** Deleted just over two days ago, so twelve of the fourteen days are left. */
const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000 - 60_000).toISOString();

beforeEach(() => {
  for (const mock of [...Object.values(mockCurriculum), ...Object.values(mockQuiz)]) {
    mock.mockClear();
  }
  mockCurriculum.getDeleted.mockResolvedValue({
    courses: [{ id: 'c9', title: 'Old lesson', deletedAt: twoDaysAgo }],
    retentionDays: 14,
  });
  mockQuiz.getDeletedQuizzes.mockResolvedValue([
    { id: 'q9', title: 'Old exam', deletedAt: twoDaysAgo },
  ]);
  mockCurriculum.getDeletedStructure.mockResolvedValue({
    models: [
      {
        id: 'm2',
        title: 'Drills',
        deletedAt: twoDaysAgo,
        sections: [
          { id: 's5', title: 'Assembly point', type: 'TEXT' },
          { id: 's6', title: 'Roll call', type: 'YOUTUBE' },
        ],
      },
    ],
    sections: [{ id: 's2', title: 'Alarms', type: 'IMAGE', deletedAt: twoDaysAgo }],
    quizzes: [
      {
        id: 'q1',
        title: 'Safety check',
        sectionId: 's3',
        sectionTitle: 'Check your understanding',
        deletedAt: twoDaysAgo,
      },
    ],
    retentionDays: 14,
  });
});

describe('the admin recycle bin', () => {
  it('shows courses and standalone quizzes, and nothing else', async () => {
    render(<TrashBin onNotify={jest.fn()} />);

    expect(await screen.findByText('Old lesson')).toBeInTheDocument();
    expect(screen.getByText('Old exam')).toBeInTheDocument();

    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Recycle bin (2)',
      'Courses',
      'Standalone quizzes',
    ]);
    expect(screen.queryByRole('heading', { name: 'Models' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Sections' })).not.toBeInTheDocument();
    // It never asks for a course's deleted models and sections.
    expect(mockCurriculum.getDeletedStructure).not.toHaveBeenCalled();
    // And says where those are instead.
    expect(screen.getByText(/Archive tab/)).toBeInTheDocument();
    expect(screen.getByText('Recycle bin (2)')).toBeInTheDocument();
  });

  it('labels Restore all for what it covers, and restores only that', async () => {
    render(<TrashBin onNotify={jest.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: /Restore all courses and quizzes/ }));

    await waitFor(() => expect(mockQuiz.restoreAllQuizzes).toHaveBeenCalled());
    expect(mockCurriculum.restoreAllDeleted).toHaveBeenCalled();
    expect(mockCurriculum.restoreModel).not.toHaveBeenCalled();
    expect(mockCurriculum.restoreSection).not.toHaveBeenCalled();
  });

  it('says what Empty recycle bin removes, and what it leaves', async () => {
    render(<TrashBin onNotify={jest.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: /Empty recycle bin/ }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(/1 course and 1 standalone quiz/);
    expect(dialog).toHaveTextContent(/Archive tab are not affected/);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Empty bin' }));

    await waitFor(() => expect(mockQuiz.purgeAllQuizzes).toHaveBeenCalled());
    expect(mockCurriculum.purgeAllDeleted).toHaveBeenCalled();
    expect(mockCurriculum.purgeModel).not.toHaveBeenCalled();
    expect(mockCurriculum.purgeSection).not.toHaveBeenCalled();
  });

  it('still warns that deleting a course for good takes its content with it', async () => {
    render(<TrashBin onNotify={jest.fn()} />);
    const row = (await screen.findByText('Old lesson')).closest('li')!;

    fireEvent.click(within(row).getByTitle('Delete permanently'));

    expect(await screen.findByRole('dialog')).toHaveTextContent(
      /Its models, sections and content go with it/,
    );
  });
});

/** The Archive pane with a course and no versions, which is all these need. */
function renderArchive() {
  const props = {
    courseId: 'c1',
    onStructureRestored: jest.fn().mockResolvedValue(undefined),
    versions: [],
    busy: false,
    onAsk: jest.fn(),
    onNotify: jest.fn(),
    onRefresh: jest.fn().mockResolvedValue(undefined),
  };
  render(<ArchivePane {...props} />);
  return props;
}

describe('a course’s Archive tab — deleted items', () => {
  it('sits under the version history and loads this course’s deleted items', async () => {
    renderArchive();

    const history = screen.getByRole('heading', { name: /Version history/ });
    const deleted = await screen.findByRole('heading', { name: /Deleted items \(3\)/ });

    expect(mockCurriculum.getDeletedStructure).toHaveBeenCalledWith('c1');
    // Under, not above.
    expect(
      history.compareDocumentPosition(deleted) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('lists a deleted model with the sections that come back with it', async () => {
    renderArchive();
    const row = (await screen.findByText('Drills')).closest('li')!;

    expect(row).toHaveTextContent('Its 2 sections come back with it:');
    expect(within(row).getByText('Assembly point')).toBeInTheDocument();
    expect(within(row).getByText('Roll call')).toBeInTheDocument();
    // When it was deleted, and how long it has left — the bin's countdown.
    expect(row).toHaveTextContent(/deleted .* · clears in 12 days/);
  });

  it('lists a deleted section on its own, and a deleted quiz under its section’s title', async () => {
    renderArchive();

    const sectionRow = (await screen.findByText('Alarms')).closest('li')!;
    expect(sectionRow).toHaveTextContent(/Image · deleted/);
    expect(sectionRow).toHaveTextContent('clears in 12 days');

    const quizRow = screen.getByText('Safety check').closest('li')!;
    expect(quizRow).toHaveTextContent('in “Check your understanding”');

    // The sections inside the deleted model are not repeated as loose sections.
    expect(screen.getAllByText('Assembly point')).toHaveLength(1);
  });

  it('restores a section, then refreshes the list and the course', async () => {
    const { onStructureRestored, onNotify } = renderArchive();

    fireEvent.click(await screen.findByRole('button', { name: 'Restore Alarms' }));

    await waitFor(() => expect(mockCurriculum.restoreSection).toHaveBeenCalledWith('s2'));
    await waitFor(() => expect(onStructureRestored).toHaveBeenCalled());
    // Loaded once on arrival and again after the restore.
    expect(mockCurriculum.getDeletedStructure).toHaveBeenCalledTimes(2);
    expect(onNotify).toHaveBeenCalledWith('"Alarms" restored');
  });

  it('restores a model through the model route', async () => {
    renderArchive();

    fireEvent.click(await screen.findByRole('button', { name: 'Restore Drills' }));

    await waitFor(() => expect(mockCurriculum.restoreModel).toHaveBeenCalledWith('m2'));
  });

  /** A course quiz and its section are one thing, so it acts through its section. */
  it('restores a quiz by restoring its section', async () => {
    renderArchive();

    fireEvent.click(await screen.findByRole('button', { name: 'Restore Safety check' }));

    await waitFor(() => expect(mockCurriculum.restoreSection).toHaveBeenCalledWith('s3'));
    expect(mockQuiz.restoreQuiz).not.toHaveBeenCalled();
  });

  it('asks before deleting for good, and only then purges', async () => {
    renderArchive();

    fireEvent.click(await screen.findByRole('button', { name: 'Delete Drills permanently' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Permanently delete Drills?');
    expect(dialog).toHaveTextContent('Every section inside it goes with it.');
    expect(mockCurriculum.purgeModel).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete forever' }));

    await waitFor(() => expect(mockCurriculum.purgeModel).toHaveBeenCalledWith('m2'));
  });

  it('says so when nothing has been deleted', async () => {
    mockCurriculum.getDeletedStructure.mockResolvedValue({
      models: [],
      sections: [],
      quizzes: [],
      retentionDays: 14,
    });
    renderArchive();

    expect(await screen.findByText('Nothing deleted.')).toBeInTheDocument();
  });
});
