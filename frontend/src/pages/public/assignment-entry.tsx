/**
 * File: assignment-entry.tsx
 * Description: What /a/:token actually does.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
/**
 * AssignmentEntry - what /a/:token actually does.
 *
 * Validates the link, starts a guest session for the email it was issued to, then
 * drops the visitor on the normal home dashboard. From there they use the same
 * sidebar, Learning and Quizzes tabs as a signed-in learner, scoped to whatever
 * has been assigned to them.
 */
import { useEffect, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';

import { Card, CardContent } from '@/components/ui/card';
import { useGuest } from '@/contexts/guest-context';
import { assignmentApi, AssignmentFailure, AssignmentLinkError } from '@/services/assignment-api';

const FAILURE_TITLES: Record<AssignmentFailure, string> = {
  'not-found': 'Link not valid',
  revoked: 'Link turned off',
  expired: 'Link expired',
  unavailable: 'Not available',
  'sign-in': 'Sign in to continue',
  idle: 'Link closed',
  completed: 'Link no longer enabled',
  error: 'Something went wrong',
};

/**
 * What /a/:token does: checks the private link and starts a guest session for it, or explains why
 * the link cannot be opened.
 */
const AssignmentEntry = () => {
  const { token } = useParams<{ token: string }>();
  const { startSession, setEmail } = useGuest();
  const [status, setStatus] = useState<'checking' | 'ready'>('checking');
  const [failure, setFailure] = useState<{ reason: AssignmentFailure; message: string } | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!token) return;
      try {
        const user = await assignmentApi.getSession(token);
        if (cancelled) return;
        startSession(token);
        setEmail(user.email);
        setStatus('ready');
      } catch (err) {
        if (cancelled) return;
        if (err instanceof AssignmentLinkError) {
          setFailure({ reason: err.reason, message: err.message });
        } else {
          setFailure({ reason: 'error', message: 'Could not open this link.' });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token, startSession, setEmail]);

  if (failure) {
    return (
      <div className="page-container flex min-h-screen flex-col justify-center py-8">
        <Card className="mx-auto w-full max-w-xl bg-light-gray">
          <CardContent className="py-16 text-center">
            <h1 className="text-2xl font-bold text-dark-gray">{FAILURE_TITLES[failure.reason]}</h1>
            <p className="mt-2 text-dark-gray">{failure.message}</p>
            {failure.reason === 'sign-in' ? (
              <a
                href="/login"
                className="mt-4 inline-block rounded-md bg-navy px-4 py-2 font-medium text-white
                  hover:bg-navy-hover"
              >
                Sign in
              </a>
            ) : (
              <p className="mt-4 text-sm text-dark-gray">
                If you think this is a mistake, contact whoever sent you the link.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (status === 'ready') return <Navigate to="/" replace />;

  return (
    <div className="page-container flex min-h-screen flex-col justify-center py-8">
      <p className="text-center text-dark-gray">Opening your training...</p>
    </div>
  );
};

export default AssignmentEntry;
