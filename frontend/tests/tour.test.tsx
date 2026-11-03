/**
 * File: tour.test.tsx
 * Description: Component tests for the first-login walkthrough — finding targets,
 *   moving between steps and pages, and remembering where somebody got to.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-10-30
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'fs';
import { join } from 'path';
import * as React from 'react';
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

import { TourProvider, useTour } from '@/components/tour/tour-context';
import { signalTour } from '@/components/tour/tour-signal';
import { PLAYER_STEP_SIGNAL, TOUR_STEPS } from '@/components/tour/tour-steps';
import { TARGET_TIMEOUT_MS } from '@/components/tour/use-tour-target';

const api = {
  getTour: jest.fn(),
  saveTour: jest.fn(),
};
const guest = { isGuest: false, token: null as string | null };

jest.mock('@/services/learner-api', () => ({ makeLearnerApi: () => api }));
jest.mock('@/contexts/guest-context', () => ({ useGuest: () => guest }));

/** Index of a step by name, so tests read as the script does. */
const at = (id: string) => TOUR_STEPS.findIndex((step) => step.id === id);

/** Where the router is, for asserting navigation. */
const Where = () => <p data-testid="where">{useLocation().pathname}</p>;

const ReplayButton = () => {
  const { replay } = useTour();
  return <button onClick={replay}>Replay tour</button>;
};

/**
 * A stand-in app: the sidebar items and page targets the steps point at, on the
 * routes they live on. The real pages are tested elsewhere; this is the engine.
 */
function App({ withHomeCard = true }: { withHomeCard?: boolean }) {
  return (
    <>
      <nav className="app-sidebar">
        <Link to="/" data-tour="nav-home">
          Home
        </Link>
        <Link to="/profile" data-tour="nav-profile">
          Profile
        </Link>
        <Link to="/learning" data-tour="nav-learning">
          Learning
        </Link>
      </nav>
      <Routes>
        <Route
          path="/"
          element={
            <div data-tour-ready="home">
              {withHomeCard && (
                <Link to="/learning/tut" data-tour="outstanding-tutorial-card">
                  Getting started
                </Link>
              )}
            </div>
          }
        />
        <Route
          path="/profile"
          element={
            <>
              <div data-tour="profile-card">Details</div>
              <div data-tour="privacy-card">Privacy</div>
              <ReplayButton />
            </>
          }
        />
        <Route path="/learning" element={<div data-tour-ready="learning" />} />
        <Route path="/learning/tut/content" element={<div data-tour="player-stage" />} />
        <Route path="*" element={<p>elsewhere</p>} />
      </Routes>
      <Where />
    </>
  );
}

function renderTour({
  path = '/',
  saved = { status: 'NOT_STARTED', step: 0 },
  enabled = true,
  setSidebarOpen = jest.fn(),
  app = <App />,
}: {
  path?: string;
  saved?: { status: string; step: number };
  enabled?: boolean;
  setSidebarOpen?: jest.Mock;
  app?: React.ReactNode;
} = {}) {
  api.getTour.mockResolvedValue({ ...saved, tutorialCourseId: 'tut' });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <TourProvider enabled={enabled} sidebarOpen={false} setSidebarOpen={setSidebarOpen}>
        {app}
      </TourProvider>
    </MemoryRouter>,
  );
}

/** The card once it has faded in — before then its buttons do nothing. */
const card = async () => {
  const element = await screen.findByTestId('tour-card');
  await waitFor(() => expect(screen.getByTestId('tour-card')).toHaveClass('opacity-100'));
  return element;
};
const where = () => screen.getByTestId('where').textContent;

beforeEach(() => {
  api.getTour.mockReset();
  api.saveTour.mockReset().mockResolvedValue(undefined);
  guest.isGuest = false;
  guest.token = null;
  // jsdom lays nothing out, so every element measures 0×0 and would read as
  // hidden. Give the tour's targets a size; everything else stays empty.
  jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const sized = this.dataset.tour !== undefined;
    return {
      top: 10,
      left: 10,
      width: sized ? 100 : 0,
      height: sized ? 40 : 0,
      right: sized ? 110 : 10,
      bottom: sized ? 50 : 10,
      x: 10,
      y: 10,
      toJSON: () => ({}),
    } as DOMRect;
  });
});

describe('the script', () => {
  /**
   * The server refuses a step past TOUR_STEP_COUNT, so the two lengths must
   * agree or the last steps could never be saved. Read from the backend source
   * because the two packages share no code.
   */
  it('has as many steps as the server allows', () => {
    const source = readFileSync(join(__dirname, '../../backend/src/config/validation.ts'), 'utf8');
    const count = Number(/TOUR_STEP_COUNT = (\d+)/.exec(source)?.[1]);

    expect(TOUR_STEPS).toHaveLength(count);
  });

  it('teaches the learner items only', () => {
    const admin = ['/admin', 'create', 'course-editor', 'users'];
    for (const step of TOUR_STEPS) {
      for (const target of [...(step.target ?? []), ...(step.alsoHighlight ?? [])]) {
        expect(admin.some((word) => target.includes(word))).toBe(false);
      }
    }
  });

  /** The four "learn by doing" steps, in the brief's numbering. */
  it('makes steps 3, 9, 10 and 13 wait for the learner to act', () => {
    const waiting = TOUR_STEPS.map((step, index) => [index + 1, step.advance.kind] as const)
      .filter(([, kind]) => kind === 'route' || kind === 'signal')
      .map(([number]) => number);

    expect(waiting).toEqual([3, 9, 10, 13]);
  });
});

describe('starting', () => {
  it('starts a first visit at the welcome step and records it as begun', async () => {
    renderTour();

    expect(await card()).toHaveTextContent('Welcome');
    expect(screen.getByText('1 of 15')).toBeInTheDocument();
    expect(api.saveTour).toHaveBeenCalledWith({ status: 'IN_PROGRESS', step: 0 });
  });

  it.each(['COMPLETED', 'SKIPPED'])('stays away from somebody who has %s it', async (status) => {
    renderTour({ saved: { status, step: 4 } });

    await waitFor(() => expect(api.getTour).toHaveBeenCalled());
    expect(screen.queryByTestId('tour-card')).not.toBeInTheDocument();
  });

  it.each(['/login', '/about', '/public', '/unauthorized', '/a/sometoken'])(
    'never starts on %s',
    async (path) => {
      renderTour({ path });

      await act(async () => undefined);
      expect(api.getTour).not.toHaveBeenCalled();
      expect(screen.queryByTestId('tour-card')).not.toBeInTheDocument();
    },
  );

  it('waits for the app shell', async () => {
    renderTour({ enabled: false });

    await act(async () => undefined);
    expect(api.getTour).not.toHaveBeenCalled();
  });

  /** A reload mid-tour lands on the same step, on the page it belongs to. */
  it('resumes part way through on the right page', async () => {
    renderTour({ path: '/', saved: { status: 'IN_PROGRESS', step: at('privacy') } });

    expect(await card()).toHaveTextContent('Your data and privacy');
    // The card can render a tick before the navigation it started has.
    await waitFor(() => expect(where()).toBe('/profile'));
  });
});

describe('finding what a step points at', () => {
  /** Pages load their data first; the target turns up later. */
  it('waits for a target that renders late', async () => {
    const Late = () => {
      const [shown, setShown] = React.useState(false);
      React.useEffect(() => {
        const timer = setTimeout(() => setShown(true), 50);
        return () => clearTimeout(timer);
      }, []);
      return shown ? <div data-tour="profile-card">Details</div> : <p>Loading…</p>;
    };
    renderTour({
      path: '/profile',
      saved: { status: 'IN_PROGRESS', step: at('profile-card') },
      app: (
        <Routes>
          <Route path="/profile" element={<Late />} />
        </Routes>
      ),
    });

    // Still hidden, but already saying so if the wait runs long.
    expect(await screen.findByTestId('tour-card')).toHaveTextContent('One moment');
    await waitFor(() => expect(screen.getByTestId('tour-card')).toHaveTextContent('Your name'));
  });

  /** Never stuck behind an overlay pointing at nothing. */
  it('falls back to a plain card when the target never comes', async () => {
    jest.useFakeTimers();
    renderTour({
      path: '/profile',
      saved: { status: 'IN_PROGRESS', step: at('profile-card') },
      app: (
        <Routes>
          <Route path="/profile" element={<p>No card here</p>} />
        </Routes>
      ),
    });

    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      jest.advanceTimersByTime(TARGET_TIMEOUT_MS + 10);
    });
    // Then the "One moment…" card fades out and the fallback takes its place.
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });

    expect(screen.getByTestId('tour-card')).toHaveTextContent('Your name');
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
    jest.useRealTimers();
  });

  /**
   * Somebody who has already finished the tutorial has no card on Home. The
   * page says it has loaded, so the tour points at Learning straight away.
   */
  it('sends them to Learning when the tutorial is not on Home', async () => {
    renderTour({
      saved: { status: 'IN_PROGRESS', step: at('tutorial-card') },
      app: <App withHomeCard={false} />,
    });

    await waitFor(() =>
      expect(screen.getByTestId('tour-card')).toHaveTextContent('Click Learning'),
    );
  });
});

describe('moving through it', () => {
  it('goes forward and back with the buttons', async () => {
    renderTour({ saved: { status: 'IN_PROGRESS', step: at('home') } });

    expect(await card()).toHaveTextContent('Home');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(await card()).toHaveTextContent('Welcome');
    fireEvent.click(screen.getByRole('button', { name: 'Start the tour' }));
    expect(await card()).toHaveTextContent('Your dashboard');
  });

  /** No flash: the old step fades out in place before the new one is drawn. */
  it('fades the old step out before showing the next', async () => {
    renderTour();
    await card();

    fireEvent.click(screen.getByRole('button', { name: 'Start the tour' }));

    const fading = screen.getByTestId('tour-card');
    expect(fading).toHaveTextContent('Welcome');
    expect(fading).toHaveClass('opacity-0');
    expect(await card()).toHaveTextContent('Your dashboard');
  });

  /** A "do it" step offers no Next: the real click is the only way on. */
  it('waits for the learner to reach the page a step asks for', async () => {
    renderTour({ saved: { status: 'IN_PROGRESS', step: at('profile-link') } });

    expect(await card()).toHaveTextContent('Click Profile to continue');
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Profile', { selector: 'a' }));

    await waitFor(() => expect(screen.getByTestId('tour-card')).toHaveTextContent('Your details'));
    expect(api.saveTour).toHaveBeenLastCalledWith({
      status: 'IN_PROGRESS',
      step: at('profile-card'),
    });
  });

  it('advances when the player reports a step', async () => {
    renderTour({
      path: '/learning/tut/content',
      saved: { status: 'IN_PROGRESS', step: at('player-step') },
      app: (
        <Routes>
          <Route
            path="/learning/tut/content"
            element={<div data-tour="player-prev-next">Previous Next</div>}
          />
          <Route path="*" element={<p>elsewhere</p>} />
        </Routes>
      ),
    });

    expect(await card()).toHaveTextContent('Try it');
    act(() => signalTour(PLAYER_STEP_SIGNAL));

    await waitFor(() =>
      expect(screen.getByTestId('tour-card')).toHaveTextContent('Learning tools and Notes'),
    );
  });

  /** Wandering off the path offers the way back rather than snapping them there. */
  it('offers to continue when the learner goes somewhere else', async () => {
    renderTour({ saved: { status: 'IN_PROGRESS', step: at('home') } });
    await card();

    fireEvent.click(screen.getByText('Learning', { selector: 'a' }));

    expect(await screen.findByText('Continue the tour?')).toBeInTheDocument();
    await card();
    fireEvent.click(screen.getByRole('button', { name: 'Continue tour' }));
    await waitFor(() => expect(where()).toBe('/'));
    expect(await card()).toHaveTextContent('Your dashboard');
  });

  it('records completion on the last step', async () => {
    renderTour({
      path: '/learning/tut/content',
      saved: { status: 'IN_PROGRESS', step: at('done') },
    });

    await card();
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));

    expect(api.saveTour).toHaveBeenLastCalledWith({ status: 'COMPLETED', step: at('done') });
    // It fades out first, then goes.
    await waitFor(() => expect(screen.queryByTestId('tour-card')).not.toBeInTheDocument());
  });

  it('opens the sidebar for the steps about it', async () => {
    const setSidebarOpen = jest.fn();
    renderTour({ saved: { status: 'IN_PROGRESS', step: at('home') }, setSidebarOpen });

    await card();
    await waitFor(() => expect(setSidebarOpen).toHaveBeenCalledWith(true));
  });
});

describe('the keyboard', () => {
  it('skips the tour with Esc, and remembers that', async () => {
    renderTour();
    await card();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(api.saveTour).toHaveBeenLastCalledWith({ status: 'SKIPPED', step: 0 });
    // It fades out first, then goes.
    await waitFor(() => expect(screen.queryByTestId('tour-card')).not.toBeInTheDocument());
  });

  it('moves focus into the card and keeps it there', async () => {
    renderTour({ saved: { status: 'IN_PROGRESS', step: at('home') } });
    const dialog = await card();

    await waitFor(() => expect(dialog).toHaveFocus());

    const buttons = Array.from(dialog.querySelectorAll('button'));
    buttons[buttons.length - 1].focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(buttons[0]).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(buttons[buttons.length - 1]).toHaveFocus();
  });

  /** On a "do it" step the target is part of the cycle — it is the thing to press. */
  it('lets Tab reach the target on a step that waits for it', async () => {
    renderTour({ saved: { status: 'IN_PROGRESS', step: at('profile-link') } });
    const dialog = await card();
    await waitFor(() => expect(dialog).toHaveTextContent('Click Profile'));

    const buttons = Array.from(dialog.querySelectorAll('button'));
    buttons[buttons.length - 1].focus();
    fireEvent.keyDown(document, { key: 'Tab' });

    expect(screen.getByText('Profile', { selector: 'a' })).toHaveFocus();
  });

  it('announces each step politely', async () => {
    renderTour();
    await card();

    const live = document.querySelector('[aria-live="polite"]');
    await waitFor(() => expect(live).toHaveTextContent('Tour step 1 of 15: Welcome'));
  });
});

describe('replay', () => {
  it('restarts from the top, wherever it was left', async () => {
    renderTour({ path: '/profile', saved: { status: 'COMPLETED', step: 15 } });
    await waitFor(() => expect(api.getTour).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'Replay tour' }));

    expect(api.saveTour).toHaveBeenLastCalledWith({ status: 'IN_PROGRESS', step: 0 });
    expect(await card()).toHaveTextContent('Welcome');
    await waitFor(() => expect(where()).toBe('/'));
  });
});

describe('guests', () => {
  /** A link cannot export or erase; the step says who can. */
  it('tells a guest that export and erasure go through whoever sent the link', async () => {
    guest.isGuest = true;
    guest.token = 'tok';
    renderTour({ path: '/profile', saved: { status: 'IN_PROGRESS', step: at('privacy') } });

    await waitFor(() =>
      expect(screen.getByTestId('tour-card')).toHaveTextContent('ask whoever sent it'),
    );
  });

  it('tells a signed-in learner they can do it themselves', async () => {
    renderTour({ path: '/profile', saved: { status: 'IN_PROGRESS', step: at('privacy') } });

    await waitFor(() =>
      expect(screen.getByTestId('tour-card')).toHaveTextContent('download a copy'),
    );
  });
});
