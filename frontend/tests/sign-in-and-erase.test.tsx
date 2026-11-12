/**
 * File: sign-in-and-erase.test.tsx
 * Description: Tests that starting a sign-in ends a guest session, and that
 *   erasing your data signs you out — the two browser halves of keeping one
 *   learning account per person under a shared login.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Date: 2026-11-11
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import PrivacyNotice from '@/components/common/privacy-notice';
import { AuthProvider, useAuth } from '@/contexts/auth-context';
import { clearStoredGuestSession } from '@/contexts/guest-context';
import HttpHelper from '@/utils/http-helper';

const keycloak = {
  authenticated: false,
  init: jest.fn().mockResolvedValue(false),
  login: jest.fn(),
  logout: jest.fn(),
  updateToken: jest.fn(),
  hasResourceRole: jest.fn().mockReturnValue(false),
};
jest.mock('@/utils/keycloak', () => ({
  getKeycloak: () => keycloak,
  getAuthConfig: () => ({ idpHint: 'oauth2' }),
}));
jest.mock('@/utils/http-helper');
const guest = { isGuest: false };
jest.mock('@/contexts/guest-context', () => ({
  ...jest.requireActual('@/contexts/guest-context'),
  useGuest: () => guest,
}));

const mockHttp = HttpHelper as jest.Mocked<typeof HttpHelper>;

/** Where the guest session keeps the link token. */
const STORAGE_KEY = 'assignmentToken';

beforeEach(() => {
  sessionStorage.clear();
  guest.isGuest = false;
});

describe('starting a sign-in', () => {
  /** A button that signs in through the context, as every sign-in in the app does. */
  const SignIn = ({ idpHint }: { idpHint?: string }) => {
    const { login } = useAuth();
    return (
      <button type="button" onClick={() => login(idpHint ? { idpHint } : undefined)}>
        Sign in
      </button>
    );
  };

  async function renderSignIn(idpHint?: string) {
    render(
      <AuthProvider>
        <SignIn idpHint={idpHint} />
      </AuthProvider>,
    );
    // Let Keycloak's init settle, as it does before anyone can click.
    await act(async () => {});
  }

  /**
   * The token survives the trip to Keycloak and back, and while it is stored
   * every request goes through the link. A guest who signed up in the same tab
   * came back still a guest.
   */
  it('ends the guest session in this tab', async () => {
    sessionStorage.setItem(STORAGE_KEY, 'link-token');
    await renderSignIn();

    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(keycloak.login).toHaveBeenCalled();
  });

  /** The Google button signs in the same way, with its identity-provider hint. */
  it('passes sign-in options through, and still ends the guest session', async () => {
    sessionStorage.setItem(STORAGE_KEY, 'link-token');
    await renderSignIn('oauth2');

    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(keycloak.login).toHaveBeenCalledWith({ idpHint: 'oauth2' });
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('leaves the rest of the tab’s storage alone', () => {
    sessionStorage.setItem(STORAGE_KEY, 'link-token');
    sessionStorage.setItem('something-else', 'kept');

    clearStoredGuestSession();

    expect(sessionStorage.getItem('something-else')).toBe('kept');
  });
});

describe('erasing your own data', () => {
  async function erase() {
    render(<PrivacyNotice />);
    fireEvent.click(screen.getByRole('button', { name: /erase my data/i }));
    // The confirm dialog's button carries the same label; it is the last one.
    const buttons = screen.getAllByRole('button', { name: /erase my data/i });
    await act(async () => {
      fireEvent.click(buttons[buttons.length - 1]);
    });
  }

  /**
   * The login is shared and outlives the erasure. Staying signed in meant the
   * next request came straight back as them; signed out, the next sign-in
   * starts a fresh account.
   */
  it('signs them out once the erasure has gone through', async () => {
    mockHttp.delete.mockResolvedValue({ message: 'erased' });

    await erase();

    expect(mockHttp.delete).toHaveBeenCalledWith('me/data');
    await waitFor(() =>
      expect(keycloak.logout).toHaveBeenCalledWith({ redirectUri: window.location.origin }),
    );
  });

  /** A failed erasure has erased nothing, so there is no reason to sign them out. */
  it('keeps them signed in when the erasure fails', async () => {
    mockHttp.delete.mockRejectedValue(new Error('server down'));

    await erase();

    expect(keycloak.logout).not.toHaveBeenCalled();
  });
});
