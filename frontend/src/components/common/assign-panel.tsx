/**
 * File: assign-panel.tsx
 * Description: Hands a course or quiz to someone by email and shows who already.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
/**
 * AssignPanel - hands a course or quiz to someone by email and shows who already
 * has it, with how far each person has got.
 *
 * Two ways to assign, and the difference matters enough to be a visible choice
 * rather than a setting. On the platform, they sign in and find it on Learning.
 * By link, the URL is the credential — anyone holding it counts as that email —
 * so the panel says so rather than leaving it implicit.
 *
 * One assignment covers one course or one quiz, so three courses means three
 * separate links. What can be done to each person afterwards lives in
 * AssignmentRoster, which the Course access page renders too.
 */
import { PlusIcon } from '@heroicons/react/24/outline';
import { useCallback, useEffect, useState } from 'react';

import AssignmentRoster from '@/components/common/assignment-roster';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Assignment, assignmentApi, AssignmentType } from '@/services/assignment-api';
import { logger } from '@/utils/logger';

interface AssignPanelProps {
  /** Exactly one of these. */
  courseId?: string;
  quizId?: string;
  /** What is being assigned, for the messages. */
  label: string;
  onNotify: (message: string, type?: 'success' | 'error') => void;
  /** Told after anything is added, changed or removed, so a host page can refresh. */
  onChanged?: () => void;
}

const inputClass = 'bg-white text-dark-gray';

const AssignPanel = ({ courseId, quizId, label, onNotify, onChanged }: AssignPanelProps) => {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [type, setType] = useState<AssignmentType>('PLATFORM');
  /**
   * How long this person gets, in days, rather than the date they get it by.
   *
   * Blank leaves it to the course or quiz, which carries its own length; the
   * server turns whichever applies into a date at the moment the assignment is
   * made. Held as a string because blank is a meaningful value here and 0 is not.
   */
  const [daysRemaining, setDaysRemaining] = useState('');
  const [expiresAt, setExpiresAt] = useState('');

  const target = courseId ? { courseId } : { quizId: quizId! };

  const fetchAssignments = useCallback(async () => {
    try {
      setLoading(true);
      setAssignments(await assignmentApi.list(courseId ? { courseId } : { quizId }));
    } catch (err) {
      logger.error('Error loading assignments:', err);
    } finally {
      setLoading(false);
    }
  }, [courseId, quizId]);

  useEffect(() => {
    fetchAssignments();
  }, [fetchAssignments]);

  const refresh = async () => {
    await fetchAssignments();
    onChanged?.();
  };

  const handleAssign = async () => {
    if (!email.trim()) return onNotify('Enter an email address', 'error');

    try {
      // The server's message says whether the email actually went out, which is
      // the part the author cannot see for themselves.
      const response = await assignmentApi.assign({
        ...target,
        type,
        email: email.trim(),
        daysRemaining: daysRemaining.trim() === '' ? null : Number(daysRemaining),
        expiresAt: expiresAt || null,
      });
      await refresh();
      onNotify(response.message, response.delivery.sent ? 'success' : 'error');
      setEmail('');
    } catch (err) {
      logger.error('Failed to assign:', err);
      onNotify(err instanceof Error && err.message ? err.message : 'Failed to assign', 'error');
    }
  };

  return (
    <Card className="bg-light-gray shadow-sm">
      <CardHeader className="p-4">
        <CardTitle className="text-lg text-dark-gray">Assign {label}</CardTitle>
        <p className="text-sm text-dark-gray">
          Everyone you add is emailed, from your address. Progress is tracked against the address
          you enter, so someone who later signs in with it keeps their history.
        </p>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {/* The choice comes first: it changes what the email contains and whether
            they ever see this on their account. */}
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium text-dark-gray">How to assign</legend>
          <div className="flex flex-wrap gap-3">
            {[
              {
                value: 'PLATFORM' as const,
                title: 'On the platform',
                note: 'They sign in and find it on their Learning page. No link is sent.',
              },
              {
                value: 'LINK' as const,
                title: 'By link only',
                note: 'One URL opens it with no sign-in. It stays off their account.',
              },
            ].map((option) => (
              <label
                key={option.value}
                className={`flex min-w-56 flex-1 cursor-pointer gap-3 rounded-lg border-2 p-3
                ${type === option.value ? 'border-navy bg-navy/5' : 'border-gray-300 bg-white'}`}
              >
                <input
                  type="radio"
                  name="assignment-type"
                  checked={type === option.value}
                  onChange={() => setType(option.value)}
                  className="mt-1 h-4 w-4 shrink-0 accent-[#5b9748]"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-dark-gray">{option.title}</span>
                  <span className="block text-xs text-dark-gray">{option.note}</span>
                </span>
              </label>
            ))}
          </div>
          {type === 'LINK' && (
            <p className="text-xs text-dark-gray">
              The link is the credential — anyone holding it counts as that person, so treat it like
              a password.
            </p>
          )}
        </fieldset>

        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-56 flex-1 flex-col gap-1 text-sm font-medium text-dark-gray">
            Email
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAssign()}
              placeholder="person@example.com"
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-dark-gray">
            Days remaining
            <Input
              type="number"
              min={1}
              value={daysRemaining}
              onChange={(e) => setDaysRemaining(e.target.value)}
              placeholder="Use default"
              title="How long this person gets, counted from today and falling due at 11:59 PM.
                Covers the quizzes inside a course too. Leave blank to use the deadline set on
                the course or quiz itself."
              className={`${inputClass} max-w-32`}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-dark-gray">
            Link expires
            <input
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              className="h-9 rounded-md border border-gray-300 bg-white px-2 text-sm text-dark-gray"
            />
          </label>
          <Button onClick={handleAssign} className="bg-navy text-white hover:bg-navy-hover">
            <PlusIcon className="w-5 h-5 stroke-2" /> Assign
          </Button>
        </div>

        {loading ? (
          <p className="text-sm text-dark-gray">Loading...</p>
        ) : (
          <AssignmentRoster
            assignments={assignments}
            label={label}
            progressOf={courseId ? 'course' : 'quiz'}
            onNotify={onNotify}
            onRefresh={refresh}
          />
        )}
      </CardContent>
    </Card>
  );
};

export default AssignPanel;
