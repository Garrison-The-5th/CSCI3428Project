/**
 * File: users-list.test.tsx
 * Description: Component tests for searching and filtering users, granting or removing admin access, and deleting accounts.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-10-16
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import UsersList from '@/pages/private/users/users-list';
import HttpHelper from '@/utils/http-helper';

jest.mock('@/utils/http-helper');
// One object for the whole run: the page refetches whenever `user` changes, so
// a fresh object per render would refetch forever.
jest.mock('@/contexts/auth-context', () => {
  const auth = { user: { email: 'me@example.com' } };
  return { useAuth: () => auth };
});

const http = HttpHelper as jest.Mocked<typeof HttpHelper>;

const person = (id: number, name: string, overrides: Record<string, unknown> = {}) => ({
  id,
  name,
  email: `${name.toLowerCase()}@example.com`,
  subscribed: false,
  hasAccount: true,
  isAdmin: false,
  hasAuthorRole: false,
  isAuthor: false,
  isCourseAuthor: false,
  isStudent: false,
  ...overrides,
});

const USERS = [
  person(1, 'Me', { isAdmin: true, isAuthor: true }),
  person(2, 'Ada', { isStudent: true }),
  person(3, 'Brian', { hasAuthorRole: true, isAuthor: true }),
  person(4, 'Cleo', { isStudent: true, hasAccount: false }),
  person(5, 'Dana', { isCourseAuthor: true }),
];

function renderPage(canManageAdmins = true) {
  http.get.mockResolvedValue({ users: USERS, canManageAdmins });
  http.put.mockResolvedValue({ message: 'ok' });
  return render(<UsersList />);
}

const names = () =>
  screen.getAllByRole('button', { name: /^Open / }).map((card) => card.getAttribute('aria-label'));

describe('UsersList — search and filters', () => {
  it('searches by name or email', async () => {
    renderPage();
    await screen.findByRole('button', { name: 'Open Ada' });

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search users' }), {
      target: { value: 'BRI' },
    });
    expect(names()).toEqual(['Open Brian']);
  });

  it('filters by Student, Author and Admin, either of several when more are ticked', async () => {
    renderPage();
    await screen.findByRole('button', { name: 'Open Ada' });

    fireEvent.click(screen.getByRole('button', { name: /^Admin/ }));
    expect(names()).toEqual(['Open Me']);

    fireEvent.click(screen.getByRole('button', { name: /^Student/ }));
    expect(names()).toEqual(['Open Me', 'Open Ada', 'Open Cleo']);

    fireEvent.click(screen.getByRole('button', { name: /^Admin/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Student/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Author/ }));
    expect(names()).toEqual(['Open Me', 'Open Brian', 'Open Dana']);
  });
});

describe('UsersList — admin access', () => {
  it('makes someone an admin only after the pop-up is confirmed', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Open Ada' }));

    fireEvent.click(screen.getByRole('checkbox', { name: /^admin access/i }));
    expect(http.put).not.toHaveBeenCalled();

    const confirm = screen.getByRole('dialog', { name: 'Make this person an admin?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Make admin' }));

    await waitFor(() =>
      expect(http.put).toHaveBeenCalledWith('auth/users/2/admin', { admin: true }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent('Ada is now an admin');
  });

  it('changes nothing when the pop-up is cancelled', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Open Ada' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /^admin access/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(http.put).not.toHaveBeenCalled();
    expect(screen.getByRole('checkbox', { name: /^admin access/i })).not.toBeChecked();
  });

  it('will not let you remove your own admin access', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Open Me' }));
    expect(screen.getByRole('checkbox', { name: /^admin access/i })).toBeDisabled();
    expect(screen.getByText(/cannot remove your own admin access/i)).toBeInTheDocument();
  });

  it('cannot make someone an admin before they have signed in', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Open Cleo' }));
    expect(screen.getByRole('checkbox', { name: /^admin access/i })).toBeDisabled();
  });

  it('only shows roles when Keycloak admin access is not set up', async () => {
    renderPage(false);
    fireEvent.click(await screen.findByRole('button', { name: 'Open Ada' }));
    expect(screen.getByRole('checkbox', { name: /^admin access/i })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /^author access/i })).toBeDisabled();
    expect(screen.getAllByText(/docs\/keycloak\.md/)).toHaveLength(2);
  });

  it('shows what went wrong when the server refuses', async () => {
    renderPage();
    http.put.mockRejectedValue(new Error('Keycloak did not accept the change'));
    fireEvent.click(await screen.findByRole('button', { name: 'Open Brian' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /^admin access/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Make admin' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Keycloak did not accept');
  });
});

describe('UsersList — author access', () => {
  it('makes someone an author after confirming, through its own switch', async () => {
    renderPage();
    http.put.mockResolvedValue({ user: { id: 2, isAdmin: false, hasAuthorRole: true } });
    fireEvent.click(await screen.findByRole('button', { name: 'Open Ada' }));

    fireEvent.click(screen.getByRole('checkbox', { name: /^author access/i }));
    const confirm = screen.getByRole('dialog', { name: 'Make this person an author?' });
    expect(confirm).toHaveTextContent(/create their own courses/);
    fireEvent.click(within(confirm).getByRole('button', { name: 'Make author' }));

    await waitFor(() =>
      expect(http.put).toHaveBeenCalledWith('auth/users/2/author', { author: true }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent('Ada is now an author');
    expect(screen.getByRole('checkbox', { name: /^author access/i })).toBeChecked();
  });

  it('removes author access after confirming', async () => {
    renderPage();
    http.put.mockResolvedValue({ user: { id: 3, isAdmin: false, hasAuthorRole: false } });
    fireEvent.click(await screen.findByRole('button', { name: 'Open Brian' }));

    fireEvent.click(screen.getByRole('checkbox', { name: /^author access/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove author access' }));
    await waitFor(() =>
      expect(http.put).toHaveBeenCalledWith('auth/users/3/author', { author: false }),
    );
  });

  it('shows admins as authors already, with the author switch locked on', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Open Me' }));
    const author = screen.getByRole('checkbox', { name: /^author access/i });
    expect(author).toBeChecked();
    expect(author).toBeDisabled();
  });

  it('tells a course author apart from someone who can create courses', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Open Dana' }));
    const dialog = screen.getByRole('dialog', { name: /dana/i });
    expect(within(dialog).getByText('Course author')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /^author access/i })).not.toBeChecked();
  });
});

describe('UsersList — deleting an account', () => {
  it('deletes only after the pop-up is confirmed, then drops them from the list', async () => {
    renderPage();
    http.delete.mockResolvedValue({ keycloakDeleted: true });
    fireEvent.click(await screen.findByRole('button', { name: 'Open Ada' }));

    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }));
    expect(http.delete).not.toHaveBeenCalled();

    const confirm = screen.getByRole('dialog', { name: 'Delete this account?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete account' }));

    await waitFor(() => expect(http.delete).toHaveBeenCalledWith('auth/users/2'));
    expect(await screen.findByRole('status')).toHaveTextContent(
      "Ada's account and all of their data have been deleted",
    );
    expect(names()).not.toContain('Open Ada');
  });

  it('says when the Keycloak login could not be removed', async () => {
    renderPage();
    http.delete.mockResolvedValue({ keycloakDeleted: false });
    fireEvent.click(await screen.findByRole('button', { name: 'Open Ada' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }));
    const confirm = screen.getByRole('dialog', { name: 'Delete this account?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete account' }));
    expect(await screen.findByRole('status')).toHaveTextContent(/Keycloak login is still there/);
  });

  it('keeps them, and says why, when the server refuses', async () => {
    renderPage();
    http.delete.mockRejectedValue(new Error('Keycloak did not delete the account'));
    fireEvent.click(await screen.findByRole('button', { name: 'Open Ada' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }));
    const confirm = screen.getByRole('dialog', { name: 'Delete this account?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Keycloak did not delete');
    expect(names()).toContain('Open Ada');
  });

  it('offers no delete button on your own account', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Open Me' }));
    expect(screen.queryByRole('button', { name: 'Delete account' })).not.toBeInTheDocument();
  });
});
