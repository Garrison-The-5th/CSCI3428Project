/**
 * File: tour-store.test.tsx
 * Description: Tests for where the walkthrough keeps its place — the account for a
 *   signed-in user, the browser for a guest — and the Profile page's Replay button.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-10-30
 */
import { act, fireEvent, render, screen } from '@testing-library/react';

import { useTour } from '@/components/tour/tour-context';
import Profile from '@/pages/private/profile/profile';
import { accountTourStore, digest, FRESH_TOUR, guestTourStore } from '@/services/tour-store';
import HttpHelper from '@/utils/http-helper';

jest.mock('@/utils/http-helper');
jest.mock('@/components/tour/tour-context', () => ({ useTour: jest.fn() }));
jest.mock('@/contexts/auth-context', () => ({
  useAuth: () => ({ user: { name: 'Ada', email: 'ada@example.com', sub: 'kc-1' } }),
}));
const guest = { isGuest: false, email: null as string | null };
jest.mock('@/contexts/guest-context', () => ({ useGuest: () => guest }));

const mockHttp = HttpHelper as jest.Mocked<typeof HttpHelper>;
const mockUseTour = useTour as jest.MockedFunction<typeof useTour>;

const TOKEN = 'a-real-looking-assignment-token-abc123';

beforeEach(() => {
  localStorage.clear();
  guest.isGuest = false;
  guest.email = null;
});

describe('a signed-in user’s tour', () => {
  /** On the account, so it follows them to another device. */
  it('is saved to the server', async () => {
    mockHttp.put.mockResolvedValue({});

    await accountTourStore.save({ status: 'IN_PROGRESS', step: 4 });

    expect(mockHttp.put).toHaveBeenCalledWith('me/tour', { status: 'IN_PROGRESS', step: 4 });
  });

  it('is read from the server, with the tutorial it leads into', async () => {
    mockHttp.get.mockResolvedValue({ status: 'COMPLETED', step: 15, tutorialCourseId: 'tut' });

    expect(await accountTourStore.load()).toEqual({
      status: 'COMPLETED',
      step: 15,
      tutorialCourseId: 'tut',
    });
    expect(mockHttp.get).toHaveBeenCalledWith('me/tour');
  });
});

describe('a guest’s tour', () => {
  it('is never shown before', async () => {
    expect(await guestTourStore(TOKEN).load()).toEqual(FRESH_TOUR);
  });

  /** A one-time link may be opened once, so a reload must not lose the place. */
  it('survives a reload — a new store over the same link reads it back', async () => {
    await guestTourStore(TOKEN).save({ status: 'IN_PROGRESS', step: 7 });

    expect(await guestTourStore(TOKEN).load()).toEqual({ status: 'IN_PROGRESS', step: 7 });
  });

  /** The token is a credential, kept in sessionStorage on purpose. */
  it('never writes the link’s token into storage', async () => {
    await guestTourStore(TOKEN).save({ status: 'SKIPPED', step: 2 });

    const keys = Object.keys(localStorage);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toBe(`tour:guest:${await digest(TOKEN)}`);
    expect(keys[0]).not.toContain(TOKEN);
    expect(localStorage.getItem(keys[0])).not.toContain(TOKEN);
  });

  it('keeps two links apart', async () => {
    await guestTourStore(TOKEN).save({ status: 'COMPLETED', step: 15 });

    expect(await guestTourStore('another-token').load()).toEqual(FRESH_TOUR);
  });

  it('treats a junk value as never shown rather than failing', async () => {
    localStorage.setItem(`tour:guest:${await digest(TOKEN)}`, '{"status":"WHATEVER"}');

    expect(await guestTourStore(TOKEN).load()).toEqual(FRESH_TOUR);
  });
});

describe('the Replay tour button on Profile', () => {
  const tour = (active: boolean, replay = jest.fn()) => ({
    active,
    stepIndex: 0,
    start: jest.fn(),
    replay,
    skip: jest.fn(),
    next: jest.fn(),
    back: jest.fn(),
  });

  async function renderProfile() {
    jest.useFakeTimers();
    render(<Profile />);
    // Profile shows a spinner for a moment first.
    await act(async () => {
      jest.advanceTimersByTime(400);
    });
    jest.useRealTimers();
  }

  it('restarts the tour', async () => {
    const replay = jest.fn();
    mockUseTour.mockReturnValue(tour(false, replay));
    await renderProfile();

    fireEvent.click(screen.getByRole('button', { name: 'Replay tour' }));

    expect(replay).toHaveBeenCalled();
  });

  /** It is the same tour for a guest, so the same button. */
  it('is offered to a guest too', async () => {
    guest.isGuest = true;
    guest.email = 'guest@example.com';
    mockUseTour.mockReturnValue(tour(false));
    await renderProfile();

    expect(screen.getByRole('button', { name: 'Replay tour' })).toBeInTheDocument();
  });

  it('is hidden while the tour is already running', async () => {
    mockUseTour.mockReturnValue(tour(true));
    await renderProfile();

    expect(screen.queryByRole('button', { name: 'Replay tour' })).not.toBeInTheDocument();
  });
});
