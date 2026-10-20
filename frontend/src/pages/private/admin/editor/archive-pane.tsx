/**
 * File: archive-pane.tsx
 * Description: Kept versions, version history, and reading one against the live one.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-09-04
 */
/**
 * The Archive tab: every version this course has had, in two sections.
 *
 * Kept versions sit at the top and are never deleted. Below them is the ordinary
 * history: the version learners are reading, and the replaced ones, each with
 * the fourteen days it has left. The split is the point of the tab — the
 * fourteen-day rule is right for the dozens of versions nobody will open again
 * and wrong for the handful that matter, so the few are lifted out of it rather
 * than the rule being loosened for all of them.
 *
 * Opening a card shows that version read against the one learners are on now,
 * with what has been added and what has gone marked on it. That is why it is a
 * card and not a row: a version is a thing you go into, not a line you act on.
 */
import {
  ArchiveBoxIcon,
  ArrowLeftIcon,
  ArrowUturnLeftIcon,
  BookmarkIcon,
  BookmarkSlashIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { useCallback, useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import VersionDiffView from '@/pages/private/admin/editor/version-diff-view';
import { CourseVersion, curriculumApi, VersionDiff } from '@/services/curriculum-api';
import { logger } from '@/utils/logger';

/**
 * How long a replaced version stays readable. Mirrors ARCHIVE_DAYS in the
 * publication service — the server does the deleting; this only says when.
 */
export const ARCHIVE_DAYS = 14;

/** An action waiting on a yes, handed up to the shell's confirm dialog. */
export type PendingVersion = {
  action: 'restore' | 'delete';
  id: string;
  version: number;
} | null;

interface Props {
  versions: CourseVersion[];
  busy: boolean;
  onAsk: (pending: NonNullable<PendingVersion>) => void;
  onNotify: (message: string, type?: 'success' | 'error') => void;
  onRefresh: () => Promise<void>;
}

/** Whole days left before the sweep takes it, rounded up. */
function daysLeft(supersededAt: string): number {
  const clearsAt = new Date(supersededAt).getTime() + ARCHIVE_DAYS * 86_400_000;
  // Rounded up, so the last full day reads "1 day left" rather than "0" while
  // the version is plainly still here.
  return Math.max(0, Math.ceil((clearsAt - Date.now()) / 86_400_000));
}

const ArchivePane = ({ versions, busy, onAsk, onNotify, onRefresh }: Props) => {
  /** The version being read, if any. Null is the list. */
  const [openId, setOpenId] = useState<string | null>(null);
  const [diff, setDiff] = useState<VersionDiff | null>(null);
  const [loadingDiff, setLoadingDiff] = useState(false);

  const loadDiff = useCallback(async (versionId: string) => {
    try {
      setLoadingDiff(true);
      setDiff(await curriculumApi.getVersionDiff(versionId));
    } catch (err) {
      logger.error('Failed to compare that version:', err);
      setDiff(null);
    } finally {
      setLoadingDiff(false);
    }
  }, []);

  useEffect(() => {
    if (openId) void loadDiff(openId);
    else setDiff(null);
  }, [openId, loadDiff]);

  const setArchived = async (version: CourseVersion, archived: boolean) => {
    try {
      const result = await curriculumApi.setVersionArchived(version.id, archived);
      onNotify(result.message);
      await onRefresh();
    } catch (err) {
      logger.error('Failed to update that version:', err);
      onNotify(
        err instanceof Error && err.message ? err.message : 'Failed to update that version',
        'error',
      );
    }
  };

  // ---- Reading one version ----
  if (openId) {
    const version = versions.find((entry) => entry.id === openId);

    return (
      <div className="flex flex-col gap-4">
        <Button
          onClick={() => setOpenId(null)}
          variant="ghost"
          className="w-fit gap-2 px-0 text-dark-gray hover:text-green-hover"
        >
          <ArrowLeftIcon className="w-5 h-5" /> All versions
        </Button>

        {loadingDiff ? (
          <p className="py-16 text-center text-dark-gray">Comparing versions...</p>
        ) : diff ? (
          <VersionDiffView diff={diff} />
        ) : (
          <Card className="bg-light-gray">
            <CardContent className="py-16 text-center">
              <p>That version could not be compared.</p>
            </CardContent>
          </Card>
        )}

        {version && !version.archivedAt && version.supersededAt && (
          <Button
            onClick={() => setArchived(version, true)}
            disabled={busy}
            variant="outline"
            className="w-fit gap-2 bg-white text-dark-gray hover:bg-light-gray"
          >
            <BookmarkIcon className="w-4 h-4" /> Keep this version permanently
          </Button>
        )}
      </div>
    );
  }

  // ---- The two lists ----
  const kept = versions.filter((entry) => entry.archivedAt !== null);
  const history = versions.filter((entry) => entry.archivedAt === null);

  const card = (entry: CourseVersion) => {
    const added =
      entry.newModuleIds.length +
      entry.newSectionIds.length +
      entry.newElementIds.length +
      entry.newQuizIds.length;
    const live = entry.supersededAt === null;
    const left = entry.archivedAt || live ? null : daysLeft(entry.supersededAt!);

    return (
      <Card
        key={entry.id}
        onClick={() => setOpenId(entry.id)}
        className={`cursor-pointer gap-0 p-0 shadow-sm transition-all duration-300
          hover:-translate-y-0.5 hover:shadow-lg
          ${live ? 'border-2 border-navy bg-white' : 'border border-gray-300 bg-white'}`}
      >
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <span className="min-w-40 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-dark-gray">Version {entry.version}</span>
              {live && <Badge className="bg-navy px-2 text-white">Live</Badge>}
              {entry.archivedAt && (
                <Badge className="bg-green px-2 text-white">Kept permanently</Badge>
              )}
              {left !== null && (
                <Badge
                  className={`px-2 text-white ${left <= 3 ? 'bg-danger' : 'bg-gray-400'}`}
                  title="Deleted automatically when the countdown runs out"
                >
                  {left === 0 ? 'Clears today' : `${left} day${left === 1 ? '' : 's'} left`}
                </Badge>
              )}
            </span>
            <span className="block text-xs text-dark-gray">
              Published {new Date(entry.publishedAt).toLocaleString()}
              {entry.publishedBy && ` by ${entry.publishedBy.name ?? entry.publishedBy.email}`}
              {added > 0 && ` · ${added} new item${added === 1 ? '' : 's'}`}
              {entry.archivedAt &&
                ` · kept ${new Date(entry.archivedAt).toLocaleDateString()}` +
                  (entry.archivedBy
                    ? ` by ${entry.archivedBy.name ?? entry.archivedBy.email}`
                    : '')}
            </span>
          </span>

          {/* The live version has nothing to restore to and must not be deleted:
              it is what every learner is currently reading. */}
          {!live && (
            <span
              className="flex shrink-0 items-center gap-2"
              // The card opens the version; these do something to it.
              onClick={(e) => e.stopPropagation()}
            >
              <Button
                onClick={() => onAsk({ action: 'restore', id: entry.id, version: entry.version })}
                disabled={busy}
                variant="outline"
                className="gap-2 bg-white text-dark-gray hover:bg-light-gray"
                title="Publish this version again for learners"
              >
                <ArrowUturnLeftIcon className="w-4 h-4" />
                Restore
              </Button>

              {entry.archivedAt ? (
                <Button
                  onClick={() => setArchived(entry, false)}
                  disabled={busy}
                  variant="outline"
                  className="gap-2 bg-white text-dark-gray hover:bg-light-gray"
                  title={`Move back to version history — it will clear after ${ARCHIVE_DAYS} days`}
                >
                  <BookmarkSlashIcon className="w-4 h-4" />
                  Move to history
                </Button>
              ) : (
                <>
                  <Button
                    onClick={() => setArchived(entry, true)}
                    disabled={busy}
                    variant="outline"
                    className="gap-2 bg-white text-dark-gray hover:bg-light-gray"
                    title="Keep this version for good, exempt from the countdown"
                  >
                    <BookmarkIcon className="w-4 h-4" />
                    Keep
                  </Button>
                  <Button
                    onClick={() =>
                      onAsk({ action: 'delete', id: entry.id, version: entry.version })
                    }
                    disabled={busy}
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 hover:text-danger-hover"
                    title="Delete this version permanently"
                  >
                    <TrashIcon className="w-4 h-4" />
                  </Button>
                </>
              )}
            </span>
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold text-dark-gray">
          <ArchiveBoxIcon className="w-5 h-5" /> Archive
        </h2>
      </div>

      {/* Kept versions first, because they are the ones somebody chose. */}
      <section>
        <h3 className="mb-3 font-semibold text-dark-gray">
          Kept permanently{kept.length > 0 && ` (${kept.length})`}
        </h3>
        {kept.length === 0 ? (
          <p
            className="rounded-lg border border-dashed border-gray-300 px-4 py-6 text-center text-sm
              text-dark-gray"
          >
            Nothing kept yet.
          </p>
        ) : (
          <div className="flex flex-col gap-2">{kept.map(card)}</div>
        )}
      </section>

      <section>
        <h3 className="mb-3 font-semibold text-dark-gray">
          Version history{history.length > 0 && ` (${history.length})`}
        </h3>
        {history.length === 0 ? (
          <p className="py-8 text-center text-dark-gray">Never published.</p>
        ) : (
          <div className="flex flex-col gap-2">{history.map(card)}</div>
        )}
      </section>
    </div>
  );
};

export default ArchivePane;
