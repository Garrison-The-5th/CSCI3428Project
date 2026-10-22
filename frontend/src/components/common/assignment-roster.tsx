/**
 * File: assignment-roster.tsx
 * Description: Everyone who holds one course or quiz, and what can be done to each of them.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
/**
 * Everyone who holds one course or quiz, and what can be done to each of them.
 *
 * Its own component because two pages need exactly this list — the Students half
 * of Course access, and the drill-down on the admin dashboard. What an
 * assignment can be made to do is a single question, and it should have a single
 * answer wherever it is asked.
 *
 * Per row: copy the link (link assignments only), resend the email, a switch for
 * whether the link works, that person's own due date, and remove.
 */
import { ClipboardIcon, PaperAirplaneIcon, TrashIcon } from '@heroicons/react/24/outline';
import { useState } from 'react';

import ConfirmDialog from '@/components/common/confirm-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Assignment, assignmentApi, assignmentUrl } from '@/services/assignment-api';
import { logger } from '@/utils/logger';

interface AssignmentRosterProps {
  assignments: Assignment[];
  /** What is being assigned, for the confirm dialog's wording. */
  label: string;
  /** Which per-person figure is worth showing: sections done, or quiz attempts. */
  progressOf: 'course' | 'quiz';
  onNotify: (message: string, type?: 'success' | 'error') => void;
  /** Re-read the list after anything changes. */
  onRefresh: () => Promise<void> | void;
}

/** An ISO timestamp as the yyyy-mm-dd a date input wants, or '' for no date. */
function dateValue(iso: string | null): string {
  return iso ? new Date(iso).toISOString().slice(0, 10) : '';
}

const AssignmentRoster = ({
  assignments,
  label,
  progressOf,
  onNotify,
  onRefresh,
}: AssignmentRosterProps) => {
  /** Ids with a request in flight, so a switch cannot be double-fired. */
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [pendingRemove, setPendingRemove] = useState<Assignment | null>(null);
  const [pendingLink, setPendingLink] = useState<Assignment | null>(null);

  /** Marks one assignment row as busy (or not), to disable its buttons while a request runs. */
  const setBusy = (id: string, busy: boolean) =>
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });

  const run = async (
    id: string,
    action: () => Promise<unknown>,
    success: string,
    failure: string,
  ) => {
    if (busyIds.has(id)) return;
    try {
      setBusy(id, true);
      await action();
      await onRefresh();
      if (success) onNotify(success);
    } catch (err) {
      logger.error(`${failure}:`, err);
      onNotify(err instanceof Error && err.message ? err.message : failure, 'error');
    } finally {
      setBusy(id, false);
    }
  };

  /**
   * Flipping the switch on turns the link back on and mails the person to say
   * so. The mail is rate limited server-side, so the switch is never disabled —
   * it always does its job, and a refused send is reported rather than pretended
   * away. Off is silent: nobody needs an email saying a link stopped working.
   */
  const toggleLink = (assignment: Assignment) => {
    if (assignment.revokedAt === null) {
      return run(
        assignment.id,
        () => assignmentApi.revoke(assignment.id),
        'Link turned off',
        'Failed to turn the link off',
      );
    }

    return run(
      assignment.id,
      async () => {
        const response = await assignmentApi.restore(assignment.id);
        onNotify(response.message, response.delivery.sent ? 'success' : 'error');
      },
      '',
      'Failed to turn the link on',
    );
  };

  /** Mails an assignment again and reports whether the email went out. */
  const resend = (assignment: Assignment) =>
    run(
      assignment.id,
      async () => {
        const response = await assignmentApi.resend(assignment.id);
        onNotify(response.message, response.delivery.sent ? 'success' : 'error');
      },
      '',
      'Failed to resend the email',
    );

  /** Sets or clears one assignment's deadline. */
  const changeDueDate = (assignment: Assignment, value: string) =>
    run(
      assignment.id,
      () => assignmentApi.setDueDate(assignment.id, value || null),
      value
        ? `${assignment.email} is now due ${new Date(value).toLocaleDateString()}`
        : `Due date cleared for ${assignment.email}`,
      'Failed to change the due date',
    );

  /**
   * Links are stored only as hashes, so the one already sent cannot be shown
   * again. Copying makes a new one — after asking, because it turns the old
   * link off.
   */
  const copy = async (assignment: Assignment) => {
    let url: string;
    try {
      url = assignmentUrl(await assignmentApi.issueLink(assignment.id));
    } catch {
      onNotify('Failed to make a new link', 'error');
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(assignment.id);
      setTimeout(() => setCopiedId(null), 2000);
      onNotify('Link copied');
    } catch {
      // Clipboard needs a secure context; show the URL so it can be copied by hand.
      window.prompt('Copy this link', url);
    }
  };

  if (assignments.length === 0) {
    return <p className="text-sm text-dark-gray">Not assigned to anyone yet.</p>;
  }

  return (
    <>
      <ul className="flex flex-col gap-2">
        {assignments.map((assignment) => {
          const revoked = assignment.revokedAt !== null;
          const expired =
            assignment.expiresAt !== null && new Date(assignment.expiresAt) < new Date();
          const busy = busyIds.has(assignment.id);

          return (
            <li
              key={assignment.id}
              className={`flex flex-wrap items-center gap-3 rounded-lg border border-gray-300 px-4
              py-3 ${revoked || expired ? 'bg-gray-100' : 'bg-white'}`}
            >
              <span className="min-w-44 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="break-words font-semibold text-dark-gray">
                    {assignment.email}
                  </span>
                  <Badge
                    variant="outline"
                    className="border-navy px-2 text-xs font-normal text-navy"
                  >
                    {assignment.type === 'LINK' ? 'Link only' : 'On platform'}
                  </Badge>
                  {assignment.notifiedAt === null && (
                    <Badge
                      variant="outline"
                      className="border-gray-400 px-2 text-xs font-normal text-dark-gray"
                      title="The assignment stands, but no email went out"
                    >
                      Not emailed
                    </Badge>
                  )}
                </span>
                <span className="block text-xs text-dark-gray">
                  {revoked
                    ? 'Turned off'
                    : expired
                      ? 'Expired'
                      : assignment.lastAccessedAt
                        ? `Opened ${new Date(assignment.lastAccessedAt).toLocaleString()}`
                        : 'Not opened yet'}
                  {progressOf === 'course' && assignment.totalSections !== undefined && (
                    <>
                      {' · '}
                      {assignment.completedSections}/{assignment.totalSections} sections
                    </>
                  )}
                  {progressOf === 'quiz' && assignment.attempts !== undefined && (
                    <>
                      {' · '}
                      {assignment.attempts} attempt{assignment.attempts === 1 ? '' : 's'}
                    </>
                  )}
                  {assignment.notifiedAt && (
                    <> · last emailed {new Date(assignment.notifiedAt).toLocaleString()}</>
                  )}
                </span>
              </span>

              {/*
                The controls line up on one baseline.

                Each is wrapped in a fixed-height row with its own caption above,
                so the date input, the buttons and the switch all sit at the same
                height however tall their labels are — otherwise the date field
                rides low against the buttons beside it.
              */}
              <div className="flex shrink-0 items-end gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-dark-gray">Due date</span>
                  <input
                    type="date"
                    value={dateValue(assignment.dueDate)}
                    disabled={busy}
                    onChange={(e) => changeDueDate(assignment, e.target.value)}
                    className="h-9 rounded-md border border-gray-300 bg-white px-2 text-sm
                      text-dark-gray disabled:opacity-60"
                  />
                </label>

                {/* A platform assignment has no URL to hand out — they sign in. */}
                {assignment.type === 'LINK' && (
                  <span className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-transparent" aria-hidden="true">
                      .
                    </span>
                    <Button
                      onClick={() => setPendingLink(assignment)}
                      variant="outline"
                      className="h-9 gap-2 bg-white text-dark-gray hover:bg-light-gray"
                      title="Make and copy a new link — the one they were sent stops working"
                    >
                      <ClipboardIcon className="w-4 h-4" />
                      {copiedId === assignment.id ? 'Copied' : 'Copy link'}
                    </Button>
                  </span>
                )}

                <span className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-transparent" aria-hidden="true">
                    .
                  </span>
                  <Button
                    onClick={() => resend(assignment)}
                    disabled={busy}
                    variant="outline"
                    className="h-9 gap-2 bg-white text-dark-gray hover:bg-light-gray"
                    title={
                      assignment.type === 'LINK'
                        ? 'Email them a new link — the old one stops working'
                        : 'Send the same email again'
                    }
                  >
                    <PaperAirplaneIcon className="w-4 h-4" /> Resend
                  </Button>
                </span>

                {/* Deliberately a switch: the state it shows is the state of the
                    link, and turning it back on re-sends the email. */}
                <label
                  className={`flex flex-col gap-1 ${busy ? 'opacity-60' : 'cursor-pointer'}`}
                  title={revoked ? 'Turn the link on and email them' : 'Turn the link off'}
                >
                  <span className="text-xs font-medium text-dark-gray">
                    {revoked ? 'Off' : 'On'}
                  </span>
                  <span className="relative inline-flex h-9 shrink-0 items-center">
                    <input
                      type="checkbox"
                      checked={!revoked}
                      disabled={busy}
                      onChange={() => toggleLink(assignment)}
                      className="peer sr-only"
                      aria-label={`Access for ${assignment.email}`}
                    />
                    <span
                      aria-hidden="true"
                      className={`block h-6 w-11 rounded-full transition-colors duration-200
                      peer-focus-visible:outline peer-focus-visible:outline-2
                      peer-focus-visible:outline-offset-2 peer-focus-visible:outline-navy
                      ${revoked ? 'bg-gray-400' : 'bg-[#5b9748]'}`}
                    />
                    <span
                      aria-hidden="true"
                      className={`absolute left-0.5 block h-5 w-5 rounded-full bg-white shadow
                      transition-transform duration-200
                      ${revoked ? 'translate-x-0' : 'translate-x-5'}`}
                    />
                  </span>
                </label>

                <span className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-transparent" aria-hidden="true">
                    .
                  </span>
                  <Button
                    onClick={() => setPendingRemove(assignment)}
                    disabled={busy}
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 hover:text-danger-hover"
                    title="Remove and clear their progress"
                  >
                    <TrashIcon className="w-5 h-5" />
                  </Button>
                </span>
              </div>
            </li>
          );
        })}
      </ul>

      <ConfirmDialog
        open={pendingLink !== null}
        tone="ask"
        title="Copy a new link?"
        confirmLabel="Make new link"
        message={
          <>
            Links are kept only in a form that cannot be read back, so this makes a new link for{' '}
            <span className="font-semibold">{pendingLink?.email}</span> and copies it.
            <br />
            The link they were sent before will stop working.
          </>
        }
        onConfirm={() => {
          const target = pendingLink;
          setPendingLink(null);
          if (target) void copy(target);
        }}
        onCancel={() => setPendingLink(null)}
      />

      {/* Removing wipes progress, which is not undoable — so it asks first. */}
      <ConfirmDialog
        open={pendingRemove !== null}
        title="Remove this person"
        confirmLabel="Remove and clear progress"
        message={
          <>
            Take <span className="font-semibold">{label}</span> away from{' '}
            <span className="font-semibold">{pendingRemove?.email}</span>?
            <br />
            Everything they have done on it is deleted. If you assign it again they start from the
            beginning.
          </>
        }
        onConfirm={() => {
          const victim = pendingRemove;
          setPendingRemove(null);
          if (!victim) return;
          run(
            victim.id,
            () => assignmentApi.remove(victim.id),
            `${victim.email} removed and their progress cleared`,
            'Failed to remove them',
          );
        }}
        onCancel={() => setPendingRemove(null)}
      />
    </>
  );
};

export default AssignmentRoster;
