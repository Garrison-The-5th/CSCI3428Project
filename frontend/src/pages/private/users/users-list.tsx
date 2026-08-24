/**
 * File: users-list.tsx
 * Description: Users list for the learning platform.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
import '@/pages/private/users/users-list.css';

import { type FormEvent, useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
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
  /** Named on a course, or holding the admin role. */
  isAuthor: boolean;
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

  if (user.isAuthor) {
    roles.push({ label: 'Author', className: 'bg-navy text-white' });
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

const UsersList = () => {
  const { user } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
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

  const fetchUsers = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await HttpHelper.get('auth/all-users');
      setUsers(response.users);
    } catch (err) {
      setError('Failed to fetch users');
      logger.error('Error fetching users:', err);
    } finally {
      setLoading(false);
    }
  };

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

      <div className="grid w-full max-w-6xl grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {users.length === 0 ? (
          <p className="col-span-full p-12 text-center text-lg text-dark-gray">No users found</p>
        ) : (
          users.map((u) => (
            <Card
              key={u.id}
              className="responsive-user-card flex h-full items-center gap-4 border-2 border-border
                p-6 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-navy
                hover:bg-light-gray hover:shadow-lg"
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
                  This will be sent through the configured Google/Gmail API connection.
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
