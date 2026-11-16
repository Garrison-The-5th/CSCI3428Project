/**
 * File: editor-sidebars.test.tsx
 * Description: Component tests for the two menus tucking away on the course
 *   editor's Modules tab — the editor's own and the app's main sidebar — and
 *   coming back as the person left them.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-11-14
 */
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';

import {
  AppSidebarContext,
  effectiveChoice,
  toggleChoice,
  useAppSidebarState,
} from '@/contexts/app-sidebar-context';
import CourseEditor from '@/pages/private/admin/course-editor';
import HttpHelper from '@/utils/http-helper';

jest.mock('@/utils/http-helper');
jest.mock('react-router-dom', () => ({
  useParams: () => ({ courseId: 'c1' }),
  useNavigate: () => jest.fn(),
}));
// The panes are not what is under test: each is a stub that says which it is.
jest.mock('@/pages/private/admin/editor/panes', () => ({
  ArchivePane: () => <p>archive pane</p>,
  CourseAccess: () => <p>access pane</p>,
  CourseMapPane: () => <p>map pane</p>,
  LandingPageEditor: () => <p>landing pane</p>,
  QuizPane: () => <p>quiz pane</p>,
  StructureEditor: () => <p>structure pane</p>,
}));
jest.mock('@/pages/private/learning/learner-previews', () => ({
  CourseLanding: () => null,
  CoursePlayer: () => null,
}));
jest.mock('@/contexts/edit-locks-context', () => ({
  EditLocksProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
jest.mock('@/services/course-map-api', () => ({ courseMapApi: {} }));
jest.mock('@/services/quiz-api', () => ({ quizApi: {}, QUIZ_TYPE_LABELS: {} }));
jest.mock('@/services/curriculum-api', () => ({
  ...jest.requireActual('@/services/curriculum-api'),
  curriculumApi: {
    getPublicationState: jest.fn().mockResolvedValue({
      hasUnpublishedChanges: false,
      unpublished: { newModelIds: [], newSectionIds: [], newQuizIds: [] },
      versions: [],
    }),
  },
}));

const http = HttpHelper as jest.Mocked<typeof HttpHelper>;
const SIDEBAR_KEY = 'course-editor-sidebar-collapsed';

const course = {
  id: 'c1',
  title: 'Fire safety',
  kind: 'LESSON',
  published: false,
  publishedVersion: 0,
  models: [{ id: 'm1', courseId: 'c1', number: 1, title: 'Basics' }],
  sections: [],
  instructors: [],
  tags: [],
};

/** The editor inside a stand-in for the app shell, which records what it is asked. */
async function renderEditor(mode: 'lesson' | 'quiz' = 'lesson') {
  const setFocusMode = jest.fn();
  const view = render(
    <AppSidebarContext.Provider value={{ setFocusMode }}>
      <CourseEditor mode={mode} />
    </AppSidebarContext.Provider>,
  );
  // The editor's own menu is there once the course has loaded.
  await screen.findByRole('button', { name: 'Landing page' });
  return { setFocusMode, ...view };
}

/** The editor menu's collapse button, whichever way it currently reads. */
const menuToggle = () => screen.getByRole('button', { name: /^(Collapse|Expand) menu$/ });
const menuIsCollapsed = () => menuToggle().getAttribute('aria-expanded') === 'false';
const openTab = (name: string) => fireEvent.click(screen.getByRole('button', { name }));

beforeEach(() => {
  localStorage.clear();
  http.get.mockResolvedValue({ courses: [course] });
});

describe('the sidebar rule', () => {
  it('shows the override while there is one, and the choice otherwise', () => {
    expect(effectiveChoice({ choice: true, override: null })).toBe(true);
    expect(effectiveChoice({ choice: true, override: false })).toBe(false);
    expect(effectiveChoice({ choice: false, override: true })).toBe(true);
  });

  it('toggles the choice and remembers it when nothing is overriding', () => {
    expect(toggleChoice({ choice: true, override: null })).toEqual({
      choice: false,
      override: null,
      persist: true,
    });
  });

  it('toggles only the override while one is set, leaving the choice alone', () => {
    expect(toggleChoice({ choice: true, override: false })).toEqual({
      choice: true,
      override: true,
      persist: false,
    });
  });
});

describe('the course editor’s own menu', () => {
  it('starts as the author left it, on any tab but Modules', async () => {
    await renderEditor();
    expect(menuIsCollapsed()).toBe(false);
  });

  it('collapses when the Modules tab is opened, without touching the saved preference', async () => {
    await renderEditor();

    openTab('Modules');

    expect(screen.getByText('structure pane')).toBeInTheDocument();
    expect(menuIsCollapsed()).toBe(true);
    // Nothing was written: collapsing for the tab is not the author's choice.
    expect(localStorage.getItem(SIDEBAR_KEY)).toBeNull();
  });

  it('restores the author’s own choice on leaving the tab', async () => {
    await renderEditor();

    openTab('Modules');
    expect(menuIsCollapsed()).toBe(true);
    openTab('Landing page');

    expect(menuIsCollapsed()).toBe(false);
  });

  it('restores a collapsed preference as collapsed', async () => {
    localStorage.setItem(SIDEBAR_KEY, '1');
    await renderEditor();
    expect(menuIsCollapsed()).toBe(true);

    openTab('Modules');
    openTab('Archive');

    expect(menuIsCollapsed()).toBe(true);
    expect(localStorage.getItem(SIDEBAR_KEY)).toBe('1');
  });

  /** The toggle stays usable inside the tab, but what it does there is for now only. */
  it('lets the menu be opened inside the Modules tab, without saving that', async () => {
    await renderEditor();
    openTab('Modules');

    fireEvent.click(menuToggle());

    expect(menuIsCollapsed()).toBe(false);
    expect(localStorage.getItem(SIDEBAR_KEY)).toBeNull();

    // Leaving and coming back collapses it again: the tab's rule, not a memory.
    openTab('Landing page');
    openTab('Modules');
    expect(menuIsCollapsed()).toBe(true);
  });

  it('still remembers a toggle made outside the Modules tab', async () => {
    await renderEditor();

    fireEvent.click(menuToggle());

    expect(menuIsCollapsed()).toBe(true);
    expect(localStorage.getItem(SIDEBAR_KEY)).toBe('1');
  });

  /** Every route into the tab is covered — the quiz shell opens straight onto it. */
  it('collapses on arrival when the editor opens on that tab', async () => {
    const { setFocusMode } = await renderEditor('quiz');

    expect(screen.getByText('quiz pane')).toBeInTheDocument();
    expect(menuIsCollapsed()).toBe(true);
    expect(setFocusMode).toHaveBeenLastCalledWith(true);
  });
});

describe('the app’s main sidebar, as the editor asks for it', () => {
  it('asks for focus on the Modules tab and lets go on leaving it', async () => {
    const { setFocusMode } = await renderEditor();
    expect(setFocusMode).toHaveBeenLastCalledWith(false);

    openTab('Modules');
    expect(setFocusMode).toHaveBeenLastCalledWith(true);

    openTab('Course access');
    expect(setFocusMode).toHaveBeenLastCalledWith(false);
  });

  it('lets go when the editor is left while the Modules tab is open', async () => {
    const { setFocusMode, unmount } = await renderEditor();
    openTab('Modules');
    expect(setFocusMode).toHaveBeenLastCalledWith(true);

    unmount();

    expect(setFocusMode).toHaveBeenLastCalledWith(false);
  });
});

describe('the app shell’s sidebar state', () => {
  it('closes for focus and comes back open afterwards', () => {
    const { result } = renderHook(() => useAppSidebarState());
    expect(result.current.sidebarOpen).toBe(true);

    act(() => result.current.appSidebar.setFocusMode(true));
    expect(result.current.sidebarOpen).toBe(false);

    act(() => result.current.appSidebar.setFocusMode(false));
    expect(result.current.sidebarOpen).toBe(true);
  });

  it('restores a closed sidebar as closed', () => {
    const { result } = renderHook(() => useAppSidebarState());
    act(() => result.current.toggleSidebar());
    expect(result.current.sidebarOpen).toBe(false);

    act(() => result.current.appSidebar.setFocusMode(true));
    act(() => result.current.appSidebar.setFocusMode(false));

    expect(result.current.sidebarOpen).toBe(false);
  });

  it('can be opened during focus, without changing what it goes back to', () => {
    const { result } = renderHook(() => useAppSidebarState());
    act(() => result.current.toggleSidebar()); // their own choice: closed
    act(() => result.current.appSidebar.setFocusMode(true));

    act(() => result.current.toggleSidebar());
    expect(result.current.sidebarOpen).toBe(true);
    // Being asked for focus again must not slam it shut on them.
    act(() => result.current.appSidebar.setFocusMode(true));
    expect(result.current.sidebarOpen).toBe(true);

    act(() => result.current.appSidebar.setFocusMode(false));
    expect(result.current.sidebarOpen).toBe(false);
  });

  /** The tour opens the sidebar for its menu steps, focus or no focus. */
  it('lets the walkthrough open it while a page has it closed', () => {
    const { result } = renderHook(() => useAppSidebarState());
    act(() => result.current.appSidebar.setFocusMode(true));
    expect(result.current.sidebarOpen).toBe(false);

    act(() => result.current.setSidebar(true));

    expect(result.current.sidebarOpen).toBe(true);
  });
});
