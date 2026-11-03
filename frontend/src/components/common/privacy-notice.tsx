/**
 * File: privacy-notice.tsx
 * Description: Explains what personal data is held and offers export and erasure.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
import { ArrowDownTrayIcon, ShieldCheckIcon, TrashIcon } from '@heroicons/react/24/outline';
import { useState } from 'react';

import ConfirmDialog from '@/components/common/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useGuest } from '@/contexts/guest-context';
import HttpHelper from '@/utils/http-helper';
import { logger } from '@/utils/logger';
import { API_BASE_URL } from '@/utils/utils';

/**
 * The plain-language half of §3.5.3.
 *
 * The standard requires two things that are easy to conflate: users must be
 * given "clear language regarding the collection and use of supplied personal
 * information", and they must have "a method to remove or export their data on
 * demand". A settings toggle buried in an admin screen satisfies neither, so
 * both live here, in the place a learner already goes to contact somebody.
 *
 * Erasure is described honestly rather than as a clean delete. Anonymising and
 * keeping the completion record is the right behaviour for a compliance
 * platform, and telling someone their data is gone when a record remains would
 * be worse than the record itself.
 */
interface PrivacyNoticeProps {
  onNotify?: (message: string, type?: 'success' | 'error') => void;
}

/**
 * Explains what personal data is held and offers export and erasure. Guests on an assignment link
 * are told to ask whoever sent it instead, since a link alone cannot prove who they are.
 */
const PrivacyNotice = ({ onNotify }: PrivacyNoticeProps) => {
  const { isGuest } = useGuest();
  const [confirmingErase, setConfirmingErase] = useState(false);
  const [busy, setBusy] = useState(false);

  /**
   * Reports a result through `onNotify` when the parent gives one; otherwise errors are only
   * logged.
   */
  const notify = (message: string, type: 'success' | 'error' = 'success') => {
    if (onNotify) onNotify(message, type);
    else if (type === 'error') logger.error(message);
  };

  /**
   * Downloads the export as a file.
   *
   * Fetched through HttpHelper for the bearer token, then turned into a blob —
   * a plain link cannot carry an Authorization header, and putting the token in
   * a query string to work around that is exactly what §3.9.1 forbids.
   */
  const exportData = async () => {
    try {
      setBusy(true);
      const token = await HttpHelper.checkToken();
      const response = await fetch(`${API_BASE_URL}/me/data`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error('Export failed');

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'my-learning-data.json';
      anchor.click();
      URL.revokeObjectURL(url);
      notify('Your data has been downloaded');
    } catch (err) {
      logger.error('Failed to export personal data', err);
      notify('Could not export your data', 'error');
    } finally {
      setBusy(false);
    }
  };

  /** Erases the signed-in person's personal data after they confirm. */
  const eraseData = async () => {
    try {
      setBusy(true);
      const response = await HttpHelper.delete('me/data');
      notify(response.message ?? 'Your personal data has been erased');
    } catch (err) {
      logger.error('Failed to erase personal data', err);
      notify('Could not erase your data', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Card className="mt-8 w-full max-w-3xl bg-light-gray shadow-sm" data-tour="privacy-card">
        <CardHeader className="flex-row items-center gap-3 p-4">
          <ShieldCheckIcon className="w-6 h-6 shrink-0 text-navy" />
          <CardTitle className="text-lg text-dark-gray">Your data and privacy</CardTitle>
        </CardHeader>

        <CardContent className="flex flex-col gap-4 text-dark-gray">
          <div>
            <p className="font-semibold">What we hold about you</p>
            <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-sm">
              <li>Your name and email address, from your sign-in.</li>
              <li>Which courses and quizzes you have been assigned, and by whom.</li>
              <li>Which sections you have opened and when.</li>
              <li>Your quiz attempts and scores.</li>
              <li>Any notes you write while working through a course.</li>
            </ul>
          </div>

          <div>
            <p className="font-semibold">Why we hold it</p>
            <p className="mt-1 text-sm">
              To show you your own progress, and so that your organisation can evidence that
              required training was completed. It is not used for anything else, is not sold, and is
              not shared outside your organisation.
            </p>
          </div>

          <div>
            <p className="font-semibold">How long we keep it</p>
            <p className="mt-1 text-sm">
              Training records are kept for as long as your organisation needs to evidence
              compliance. Notes are yours and are deleted as soon as you delete them or ask for
              erasure. Content you delete goes to a recycle bin and is cleared after 14 days.
            </p>
          </div>

          {isGuest ? (
            <p className="rounded-lg border border-navy/30 bg-navy/5 p-3 text-sm">
              You are here on an assignment link. To export or erase your data, contact whoever sent
              you the link — we cannot verify your identity strongly enough from a link alone.
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-3 border-t border-gray-300 pt-4">
              <Button
                onClick={exportData}
                disabled={busy}
                variant="outline"
                className="gap-2 bg-white text-dark-gray hover:bg-light-gray"
              >
                <ArrowDownTrayIcon className="w-5 h-5" /> Download my data
              </Button>
              <Button
                onClick={() => setConfirmingErase(true)}
                disabled={busy}
                variant="outline"
                className="gap-2 bg-white text-danger hover:bg-light-gray"
              >
                <TrashIcon className="w-5 h-5" /> Erase my data
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmingErase}
        title="Erase your personal data"
        confirmLabel="Erase my data"
        message={
          <>
            This removes your name, email address and all of your notes.
            <br />
            <br />
            Records that training was completed are <span className="font-semibold">kept</span>,
            without your name attached, because your organisation may be required to evidence them.
            This cannot be undone.
          </>
        }
        onConfirm={() => {
          setConfirmingErase(false);
          eraseData();
        }}
        onCancel={() => setConfirmingErase(false)}
      />
    </>
  );
};

export default PrivacyNotice;
