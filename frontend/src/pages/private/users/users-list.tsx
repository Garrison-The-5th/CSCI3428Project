/**
 * File: users-list.tsx
 * Description: Users list for the learning platform — search, filter by role, manage admin and author access, and delete accounts.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-10-16
 */
import '@/pages/private/users/users-list.css';

import { MagnifyingGlassIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { type FormEvent, useEffect, useMemo, useState } from 'react';

import ConfirmDialog from '@/components/common/confirm-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import ToggleSwitch from '@/components/ui/toggle-switch';
import { useAuth } from '@/contexts/auth-context';
import HttpHelper from '@/utils/http-helper';
import { logger } from '@/utils/logger';

interface User {
  id: number;
  email: string;
  name: string | null;
  subscribed: boolean;
  /** They have signed in at least once, rather than only being an address. */
  hasAccount: boolean;
  /** Holds the admin role in Keycloak: everything, including this page. */
  isAdmin: boolean;
  /** Holds the author role itself — what the Author switch shows. */
  hasAuthorRole: boolean;
  /** Can create content: holds the author role, or is an admin. */
  isAuthor: boolean;
  /** Named on at least one course, so can edit that course but not create one. */
  isCourseAuthor: boolean;
  /** Has been assigned something to learn. */
  isStudent: boolean;
}

/**
 * What to call someone, in the order it should read.
 *
 * The three states overlap: an author is usually also a student, and someone can
 * be a student without ever having signed in. So this returns a list rather than
 * picking one — "Author" and "Student" together is a true and useful thing to
 * say, and only the no-account case changes what "Student" means, which is why
 * it replaces that label rather than sitting beside it.
 */
function rolesOf(user: User): Array<{ label: string; className: string }> {
  const roles: Array<{ label: string; className: string }> = [];

  if (user.isAdmin) {
    roles.push({ label: 'Admin', className: 'bg-purple text-white' });
  }

  if (user.isAuthor) {
    roles.push({ label: 'Author', className: 'bg-navy text-white' });
  } else if (user.isCourseAuthor) {
    roles.push({ label: 'Course author', className: 'bg-navy/70 text-white' });
  }

  if (user.isStudent) {
    roles.push(
      user.hasAccount
        ? { label: 'Student', className: 'bg-[#5b9748] text-white' }
        : { label: 'Student — no account', className: 'bg-new text-white' },
    );
  }

  if (roles.length === 0) {
    roles.push({ label: 'No learning assigned', className: 'bg-gray-300 text-dark-gray' });
  }

  return roles;
}

type RoleFilter = 'student' | 'author' | 'admin';

const ROLE_FILTERS: Array<{ id: RoleFilter; label: string; matches: (user: User) => boolean }> = [
  { id: 'student', label: 'Student', matches: (user) => user.isStudent },
  // Course authors count: they author, just not courses of their own.
  { id: 'author', label: 'Author', matches: (user) => user.isAuthor || user.isCourseAuthor },
  { id: 'admin', label: 'Admin', matches: (user) => user.isAdmin },
];

/**
 * Who the list shows: everyone matching the search, narrowed to any of the
 * ticked roles. Ticking two roles widens rather than narrows — "students and
 * authors" means either, which is what someone ticking both is looking for.
 */
export function filterUsers(users: User[], query: string, roles: Set<RoleFilter>): User[] {
  const needle = query.trim().toLowerCase();
  return users.filter((user) => {
    if (needle && !`${user.name ?? ''} ${user.email}`.toLowerCase().includes(needle)) return false;
    if (roles.size === 0) return true;
    return ROLE_FILTERS.some((filter) => roles.has(filter.id) && filter.matches(user));
  });
}

/** The role a switch changes. Author is `contributor` in Keycloak. */
type ManagedRole = 'admin' | 'author';

/** What each switch says about what the role gives, and what it takes away. */
const ROLE_COPY: Record<
  ManagedRole,
  { label: string; hint: string; grant: string; revoke: string; noun: string }
> = {
  admin: {
    label: 'Admin access',
    hint: 'Everything an author can do, plus this Users page — managing accounts and roles.',
    grant:
      'will be given the admin role in Keycloak. They will be able to manage users and ' +
      'roles, as well as everything an author can do.',
    revoke:
      'will lose the admin role in Keycloak, and with it the Users page. If they also hold ' +
      'the author role they keep authoring access.',
    noun: 'an admin',
  },
  author: {
    label: 'Author access',
    hint:
      'Create their own courses and quizzes, assign learning and use the dashboard — ' +
      'everything except this Users page.',
    grant:
      'will be given the author role in Keycloak. They will be able to create their own ' +
      'courses and quizzes to share, assign learning and use the dashboard. They will not ' +
      'see the Users page or be able to change anyone’s account.',
    revoke:
      'will lose the author role in Keycloak and will no longer be able to create courses ' +
      'or quizzes. Any course they are named on as an author stays editable by them.',
    noun: 'an author',
  },
};

/**
 * The admin Users page: everyone in the system, searchable and filterable by role, with a panel per
 * person to grant or remove roles, delete them, and a form to mail newsletter subscribers.
 */
const UsersList = () => {
  const { user } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [canManageAdmins, setCanManageAdmins] = useState(false);
  const [query, setQuery] = useState('');
  const [roleFilters, setRoleFilters] = useState<Set<RoleFilter>>(new Set());
  const [openUserId, setOpenUserId] = useState<number | null>(null);
  /** The role change waiting on the confirm pop-up. */
  const [pending, setPending] = useState<{ role: ManagedRole; enabled: boolean } | null>(null);
  const [adminSaving, setAdminSaving] = useState(false);
  const [adminError, setAdminError] = useState<string | null>(null);
  const [adminNotice, setAdminNotice] = useState<string | null>(null);
  /** Whether the delete-account confirm pop-up is showing. */
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isMailDialogOpen, setIsMailDialogOpen] = useState(false);
  const [mailSubject, setMailSubject] = useState('TTG Teams update');
  const [mailBody, setMailBody] = useState('');
  const [mailSending, setMailSending] = useState(false);
  const [mailStatus, setMailStatus] = useState<{
    message: string;
    kind: 'success' | 'error';
  } | null>(null);

  useEffect(() => {
    fetchUsers();
  }, [user]);

  /** Loads every user with their role labels, and whether this admin may manage other admins. */
  const fetchUsers = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await HttpHelper.get('auth/all-users');
      setUsers(response.users);
      setCanManageAdmins(Boolean(response.canManageAdmins));
    } catch (err) {
      setError('Failed to fetch users');
      logger.error('Error fetching users:', err);
    } finally {
      setLoading(false);
    }
  };

  const shown = useMemo(() => filterUsers(users, query, roleFilters), [users, query, roleFilters]);
  const openUser = users.find((candidate) => candidate.id === openUserId) ?? null;
  /**
   * Whether this row is the signed-in admin — used to stop them removing their own admin role or
   * deleting their own account.
   */
  const isMe = (candidate: User) =>
    !!user?.email && candidate.email.toLowerCase() === user.email.toLowerCase();

  /** Turns one role filter on or off. */
  const toggleFilter = (id: RoleFilter) =>
    setRoleFilters((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /** Closes a person's panel, discarding any unconfirmed role change or delete. */
  const closeUser = () => {
    setOpenUserId(null);
    setPending(null);
    setConfirmingDelete(false);
    setAdminError(null);
  };

  /** Deletes the open person after confirmation, then drops them from the list. */
  const confirmDelete = async () => {
    if (!openUser || deleting) return;
    const target = openUser;
    setDeleting(true);
    setAdminError(null);
    try {
      const response = await HttpHelper.delete(`auth/users/${target.id}`);
      setUsers((current) => current.filter((candidate) => candidate.id !== target.id));
      const who = target.name || target.email;
      setAdminNotice(
        response?.keycloakDeleted === false
          ? `${who}'s data has been deleted, but their Keycloak login is still there. ` +
              'Remove it in Keycloak, or they can sign in again to an empty account.'
          : `${who}'s account and all of their data have been deleted.`,
      );
      setConfirmingDelete(false);
      setOpenUserId(null);
    } catch (err) {
      setAdminError(err instanceof Error ? err.message : 'Could not delete their account.');
      setConfirmingDelete(false);
    } finally {
      setDeleting(false);
    }
  };

  /** Why a role switch is off for this person, or null when it can be used. */
  const lockReason = (candidate: User, role: ManagedRole): string | null => {
    if (!canManageAdmins) {
      return 'Roles can only be shown here until Keycloak admin access is set up (docs/keycloak.md).';
    }
    if (!candidate.hasAccount) {
      return 'They need to sign in once before they can be given a role.';
    }
    if (role === 'admin' && isMe(candidate) && candidate.isAdmin) {
      return 'You cannot remove your own admin access. Ask another admin to do it.';
    }
    if (role === 'author' && candidate.isAdmin) {
      return 'Admins can already do everything an author can.';
    }
    return null;
  };

  /**
   * Applies the pending admin/author role change for the open person and updates their row from the
   * server's answer.
   */
  const confirmRoleChange = async () => {
    if (!openUser || pending === null || adminSaving) return;
    const target = openUser;
    const { role, enabled } = pending;
    setAdminSaving(true);
    setAdminError(null);
    try {
      const response = await HttpHelper.put(`auth/users/${target.id}/${role}`, {
        [role]: enabled,
      });
      // The server reads back what Keycloak now holds, so take its word.
      const isAdmin: boolean =
        response?.user?.isAdmin ?? (role === 'admin' ? enabled : target.isAdmin);
      const hasAuthorRole: boolean =
        response?.user?.hasAuthorRole ?? (role === 'author' ? enabled : target.hasAuthorRole);
      setUsers((current) =>
        current.map((candidate) =>
          candidate.id === target.id
            ? { ...candidate, isAdmin, hasAuthorRole, isAuthor: isAdmin || hasAuthorRole }
            : candidate,
        ),
      );
      const who = target.name || target.email;
      const { noun } = ROLE_COPY[role];
      setAdminNotice(
        `${who} ${enabled ? `is now ${noun}` : `is no longer ${noun}`}. ` +
          'It takes effect the next time their session refreshes, within a few minutes.',
      );
      setPending(null);
    } catch (err) {
      setAdminError(err instanceof Error ? err.message : 'Could not change their access.');
      setPending(null);
    } finally {
      setAdminSaving(false);
    }
  };

  /** Sends the composed subject and message to every newsletter subscriber. */
  const handleSendMail = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMailSending(true);
    setMailStatus(null);

    void (async () => {
      try {
        const response = await HttpHelper.post('auth/send-email-to-subscribers', {
          subject: mailSubject,
          message: mailBody,
        });
        setMailStatus({
          message:
            `Email queued for ${response.result?.sentCount ?? 0} of ` +
            `${response.result?.recipientCount ?? 0} subscribed user(s).`,
          kind: 'success',
        });
        setIsMailDialogOpen(false);
        setMailBody('');
      } catch (submitError) {
        setMailStatus({
          message: submitError instanceof Error ? submitError.message : 'Failed to send email.',
          kind: 'error',
        });
      } finally {
        setMailSending(false);
      }
    })();
  };

  if (loading) {
    return (
      <div className="page-container">
        <div className="text-center">Loading users...</div>
      </div>
    );
  }

  return (
    <div className="page-container flex flex-col items-center">
      <div className="w-full">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="page-title font-bold text-dark-gray">Users List</h1>
            <p className="page-subtitle text-dark-gray font-medium">
              Registered users in the boilerplate
            </p>
          </div>
          <Button
            type="button"
            className="admin-mail-btn"
            onClick={() => setIsMailDialogOpen(true)}
          >
            Email subscribers
          </Button>
        </div>
      </div>
      <hr className="w-full mt-4 mb-8 h-0.5 border-t-0 bg-navy" />

      {error && (
        <div className="error-message">
          {error}
          <Button onClick={fetchUsers} className="retry-btn">
            Retry
          </Button>
        </div>
      )}

      {adminNotice && (
        <p
          role="status"
          className="mb-4 flex w-full max-w-6xl items-start justify-between gap-3 rounded-md border
            border-green bg-white px-4 py-3 text-sm text-dark-gray"
        >
          {adminNotice}
          <button
            type="button"
            onClick={() => setAdminNotice(null)}
            aria-label="Dismiss"
            className="shrink-0"
          >
            <XMarkIcon className="h-4 w-4" />
          </button>
        </p>
      )}

      {/* Search and role filters. */}
      <div className="mb-6 flex w-full max-w-6xl flex-wrap items-center gap-3">
        <label className="relative min-w-60 flex-1">
          <MagnifyingGlassIcon
            className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2
              text-dark-gray/60"
          />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or email"
            aria-label="Search users"
            className="bg-white pl-10 text-dark-gray"
          />
        </label>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by role">
          {ROLE_FILTERS.map((filter) => {
            const active = roleFilters.has(filter.id);
            const count = users.filter(filter.matches).length;
            return (
              <button
                key={filter.id}
                type="button"
                onClick={() => toggleFilter(filter.id)}
                aria-pressed={active}
                className={`h-9 rounded-full border px-4 text-sm font-medium transition-colors ${
                  active
                    ? 'border-navy bg-navy text-white'
                    : 'border-gray-300 bg-white text-dark-gray hover:bg-light-gray'
                }`}
              >
                {filter.label} <span className="opacity-70">({count})</span>
              </button>
            );
          })}
          {(roleFilters.size > 0 || query) && (
            <button
              type="button"
              onClick={() => {
                setRoleFilters(new Set());
                setQuery('');
              }}
              className="text-sm text-dark-gray underline"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      <div className="grid w-full max-w-6xl grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {shown.length === 0 ? (
          <p className="col-span-full p-12 text-center text-lg text-dark-gray">
            {users.length === 0 ? 'No users found' : 'No users match your search'}
          </p>
        ) : (
          shown.map((u) => (
            <Card
              key={u.id}
              role="button"
              tabIndex={0}
              aria-label={`Open ${u.name || u.email}`}
              onClick={() => {
                setOpenUserId(u.id);
                setAdminError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setOpenUserId(u.id);
                  setAdminError(null);
                }
              }}
              className="responsive-user-card flex h-full cursor-pointer items-center gap-4 border-2
                border-border p-6 shadow-sm transition-all duration-200 hover:-translate-y-0.5
                hover:border-navy hover:bg-light-gray hover:shadow-lg focus-visible:outline-2
                focus-visible:outline-navy"
            >
              <CardContent className="flex w-full items-center gap-4 p-0">
                <div
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full
                    bg-navy text-2xl font-bold text-white"
                >
                  {(u.name || u.email).charAt(0).toUpperCase()}
                </div>
                <div className="flex min-w-0 flex-col gap-1">
                  <h3 className="break-words text-lg text-dark-gray font-semibold">
                    {u.name || 'No name'}
                  </h3>
                  <p className="break-all text-purple text-sm">{u.email}</p>
                  <div className="flex flex-wrap gap-2">
                    {rolesOf(u).map((role) => (
                      <Badge key={role.label} className={`w-fit px-2 ${role.className}`}>
                        {role.label}
                      </Badge>
                    ))}
                    <Badge
                      variant={u.subscribed ? 'secondary' : 'outline'}
                      className={u.subscribed ? 'w-fit text-green' : 'w-fit text-text-muted'}
                    >
                      {u.subscribed ? 'Subscribed' : 'Not subscribed'}
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {openUser && (
        <div className="admin-mail-backdrop" role="presentation" onClick={closeUser}>
          <Card
            className="admin-mail-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="user-detail-title"
            onClick={(event) => event.stopPropagation()}
          >
            <CardHeader className="admin-mail-header">
              <div className="flex min-w-0 items-center gap-4">
                <div
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full
                    bg-navy text-2xl font-bold text-white"
                >
                  {(openUser.name || openUser.email).charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <CardTitle id="user-detail-title" className="break-words">
                    {openUser.name || 'No name'}
                    {isMe(openUser) && (
                      <span className="ml-2 text-sm font-normal text-text-muted">(you)</span>
                    )}
                  </CardTitle>
                  <p className="break-all text-sm text-purple">{openUser.email}</p>
                </div>
              </div>
              <Button
                type="button"
                className="admin-mail-close"
                variant="ghost"
                size="icon"
                aria-label="Close"
                onClick={closeUser}
              >
                ×
              </Button>
            </CardHeader>

            <CardContent className="flex flex-col gap-5">
              <div className="flex flex-wrap gap-2">
                {rolesOf(openUser).map((role) => (
                  <Badge key={role.label} className={`w-fit px-2 ${role.className}`}>
                    {role.label}
                  </Badge>
                ))}
              </div>

              <div className="flex flex-col gap-4 rounded-lg border border-gray-300 p-4">
                {(['author', 'admin'] as const).map((role) => (
                  <ToggleSwitch
                    key={role}
                    checked={role === 'admin' ? openUser.isAdmin : openUser.isAuthor}
                    onChange={(enabled) => {
                      setAdminError(null);
                      setPending({ role, enabled });
                    }}
                    disabled={adminSaving || lockReason(openUser, role) !== null}
                    label={ROLE_COPY[role].label}
                    hint={lockReason(openUser, role) ?? ROLE_COPY[role].hint}
                  />
                ))}
                {openUser.isCourseAuthor && !openUser.isAuthor && (
                  <p className="text-xs text-dark-gray">
                    Already named as an author on at least one course, which lets them edit that
                    course. Author access lets them create their own.
                  </p>
                )}
              </div>

              {adminError && (
                <p role="alert" className="text-sm font-medium text-destructive">
                  {adminError}
                </p>
              )}

              {!isMe(openUser) && (
                <div
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border
                    border-destructive/40 p-4"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-dark-gray">Delete account</p>
                    <p className="text-xs text-dark-gray">
                      Removes their login and all of their data. This cannot be undone.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={deleting}
                    onClick={() => {
                      setAdminError(null);
                      setConfirmingDelete(true);
                    }}
                  >
                    Delete account
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <ConfirmDialog
        open={openUser !== null && pending !== null}
        tone={pending?.enabled ? 'ask' : 'danger'}
        title={
          pending?.enabled
            ? `Make this person ${ROLE_COPY[pending.role].noun}?`
            : `Remove ${pending?.role ?? 'admin'} access?`
        }
        message={
          openUser &&
          pending && (
            <>
              <p>
                <strong>{openUser.name || openUser.email}</strong>{' '}
                {pending.enabled ? ROLE_COPY[pending.role].grant : ROLE_COPY[pending.role].revoke}
              </p>
              <p className="mt-2 text-sm">
                This takes effect the next time their session refreshes, within a few minutes.
              </p>
            </>
          )
        }
        confirmLabel={
          adminSaving
            ? 'Saving…'
            : pending?.enabled
              ? `Make ${pending.role}`
              : `Remove ${pending?.role ?? 'admin'} access`
        }
        onConfirm={() => void confirmRoleChange()}
        onCancel={() => setPending(null)}
      />

      <ConfirmDialog
        open={openUser !== null && confirmingDelete}
        title="Delete this account?"
        message={
          openUser && (
            <>
              <p>
                <strong>{openUser.name || openUser.email}</strong> will be deleted for good: their
                Keycloak login, assignments, progress, quiz results, course completions and notes.
              </p>
              <p className="mt-2 text-sm">
                Courses and quizzes they created stay, with no author credited. This cannot be
                undone.
              </p>
            </>
          )
        }
        confirmLabel={deleting ? 'Deleting…' : 'Delete account'}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setConfirmingDelete(false)}
      />

      {isMailDialogOpen && (
        <div
          className="admin-mail-backdrop"
          role="presentation"
          onClick={() => setIsMailDialogOpen(false)}
        >
          <Card
            className="admin-mail-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-mail-title"
            onClick={(event) => event.stopPropagation()}
          >
            <CardHeader className="admin-mail-header">
              <div>
                <CardTitle id="admin-mail-title">Email subscribed users</CardTitle>
                <p className="admin-mail-subtitle">
                  This will be sent from the configured no-reply mailbox.
                </p>
              </div>
              <Button
                type="button"
                className="admin-mail-close"
                variant="ghost"
                size="icon"
                aria-label="Close email dialog"
                onClick={() => setIsMailDialogOpen(false)}
              >
                ×
              </Button>
            </CardHeader>

            <CardContent>
              <form className="admin-mail-form" onSubmit={handleSendMail}>
                <label htmlFor="admin-mail-subject">Subject</label>
                <Input
                  id="admin-mail-subject"
                  value={mailSubject}
                  onChange={(event) => setMailSubject(event.target.value)}
                  required
                />

                <label htmlFor="admin-mail-body">Message</label>
                <Textarea
                  id="admin-mail-body"
                  value={mailBody}
                  onChange={(event) => setMailBody(event.target.value)}
                  rows={8}
                  required
                  placeholder="Write the email you want to send to all subscribed users..."
                />

                <div className="admin-mail-actions">
                  <Button
                    type="button"
                    className="admin-mail-cancel"
                    variant="outline"
                    onClick={() => setIsMailDialogOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" className="admin-mail-send" disabled={mailSending}>
                    {mailSending ? 'Sending...' : 'Send email'}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {mailStatus && (
        <p
          className={`mt-4 text-sm font-medium ${
            mailStatus.kind === 'success' ? 'text-green' : 'text-destructive'
          }`}
        >
          {mailStatus.message}
        </p>
      )}
    </div>
  );
};

export default UsersList;
