/**
 * File: deleted-items.tsx
 * Description: The Archive tab's list of a course's deleted models, sections and quizzes.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-11-14
 */
/**
 * Deleted items, in the course they were deleted from.
 *
 * A model, a section or a quiz deleted inside a course belongs to that course,
 * so this is where it is found — not in the admin recycle bin, which holds whole
 * courses and the quizzes that belong to none. Everything here can be restored
 * or deleted for good, and clears on its own after the same retention window
 * the bin uses.
 *
 * Three kinds of row:
 *   - a deleted model, with the sections that went with it listed underneath —
 *     restoring the model brings every one of them back;
 *   - a deleted section whose model is still there;
 *   - a deleted quiz, under the title of the section it was.
 *
 * A course quiz and its section are deleted and restored as one, so a quiz row
 * acts through its section.
 */
import { ArrowUturnLeftIcon, TrashIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useCallback, useEffect, useState } from 'react';

import ConfirmDialog from '@/components/common/confirm-dialog';
import { Button } from '@/components/ui/button';
import { curriculumApi, DeletedStructure, SECTION_TYPE_LABELS } from '@/services/curriculum-api';
import { logger } from '@/utils/logger';
import { timeLeft } from '@/utils/retention';

interface Props {
  courseId: string;
  onNotify: (message: string, type?: 'success' | 'error') => void;
  /** Called after a restore, so the editor's outline shows what came back. */
  onRestored: () => void | Promise<void>;
}

/** The permanent delete waiting on a yes. */
type Pending = { kind: 'model' | 'section' | 'quiz'; id: string; label: string } | null;

const EMPTY: DeletedStructure = { models: [], sections: [], quizzes: [], retentionDays: 14 };

const DeletedItems = ({ courseId, onNotify, onRestored }: Props) => {
  const [deleted, setDeleted] = useState<DeletedStructure>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setDeleted(await curriculumApi.getDeletedStructure(courseId));
    } catch (err) {
      logger.error('Error loading deleted items:', err);
      onNotify('Failed to load deleted items', 'error');
    } finally {
      setLoading(false);
    }
    // onNotify is rebuilt each render on the shell; depending on it would loop.
  }, [courseId]);

  useEffect(() => {
    load();
  }, [load]);

  /** Runs one action, reloads the list, and reports the outcome. */
  const run = async (
    action: () => Promise<unknown>,
    success: string,
    failure: string,
    restored = false,
  ) => {
    try {
      setBusy(true);
      await action();
      await load();
      if (restored) await onRestored();
      onNotify(success);
    } catch (err) {
      logger.error(`${failure}:`, err);
      onNotify(err instanceof Error && err.message ? err.message : failure, 'error');
    } finally {
      setBusy(false);
    }
  };

  /** Permanently deletes one item. A quiz goes through its section — they are one thing. */
  const purge = (target: NonNullable<Pending>) =>
    run(
      () =>
        target.kind === 'model'
          ? curriculumApi.purgeModel(target.id)
          : curriculumApi.purgeSection(target.id),
      `"${target.label}" permanently deleted`,
      'Failed to delete permanently',
    );

  const total = deleted.models.length + deleted.sections.length + deleted.quizzes.length;

  /** The two buttons every row ends with. */
  const actions = (onRestore: () => void, onPurge: () => void, label: string) => (
    <span className="flex shrink-0 items-center gap-2">
      <Button
        onClick={onRestore}
        disabled={busy}
        variant="outline"
        className="gap-2 bg-white text-dark-gray hover:bg-light-gray"
        aria-label={`Restore ${label}`}
      >
        <ArrowUturnLeftIcon className="w-4 h-4" /> Restore
      </Button>
      <Button
        onClick={onPurge}
        disabled={busy}
        variant="ghost"
        size="icon"
        className="hover:text-danger-hover"
        title="Delete permanently"
        aria-label={`Delete ${label} permanently`}
      >
        <XMarkIcon className="w-5 h-5" />
      </Button>
    </span>
  );

  /** "deleted <when> · clears in N days" */
  const when = (deletedAt: string) => (
    <>
      deleted {new Date(deletedAt).toLocaleString()} ·{' '}
      <span className="font-medium">{timeLeft(deletedAt, deleted.retentionDays)}</span>
    </>
  );

  const rowClass =
    'flex items-center justify-between gap-3 rounded-lg border border-gray-300 bg-white px-4 py-3';

  return (
    <section aria-labelledby="deleted-items-heading">
      <h3
        id="deleted-items-heading"
        className="mb-1 flex items-center gap-2 font-semibold text-dark-gray"
      >
        <TrashIcon className="w-5 h-5" /> Deleted items{total > 0 && ` (${total})`}
      </h3>
      <p className="mb-3 text-sm text-dark-gray">
        Models, sections and quizzes deleted from this lesson. They are cleared automatically after{' '}
        {deleted.retentionDays} days.
      </p>

      {loading ? (
        <p className="py-6 text-center text-dark-gray">Loading...</p>
      ) : total === 0 ? (
        <p
          className="rounded-lg border border-dashed border-gray-300 px-4 py-6 text-center text-sm
            text-dark-gray"
        >
          Nothing deleted.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {deleted.models.length > 0 && (
            <div>
              <h4 className="mb-2 text-sm font-semibold text-dark-gray">Models</h4>
              <ul className="flex flex-col gap-2">
                {deleted.models.map((model) => (
                  <li key={model.id} className={rowClass}>
                    <span className="min-w-0">
                      <span className="block break-words font-semibold text-dark-gray">
                        {model.title}
                      </span>
                      <span className="block text-sm text-dark-gray">
                        comes back at the end · {when(model.deletedAt)}
                      </span>
                      {model.sections.length > 0 && (
                        <>
                          <span className="mt-2 block text-sm text-dark-gray">
                            {model.sections.length === 1
                              ? 'Its section comes back with it:'
                              : `Its ${model.sections.length} sections come back with it:`}
                          </span>
                          <ul className="mt-1 flex flex-col gap-1 pl-4">
                            {model.sections.map((section) => (
                              <li key={section.id} className="break-words text-sm text-dark-gray">
                                <span className="font-semibold">
                                  {SECTION_TYPE_LABELS[section.type]}
                                </span>{' '}
                                {section.title}
                              </li>
                            ))}
                          </ul>
                        </>
                      )}
                    </span>
                    {actions(
                      () =>
                        run(
                          () => curriculumApi.restoreModel(model.id),
                          `"${model.title}" restored`,
                          'Failed to restore model',
                          true,
                        ),
                      () => setPending({ kind: 'model', id: model.id, label: model.title }),
                      model.title,
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {deleted.sections.length > 0 && (
            <div>
              <h4 className="mb-2 text-sm font-semibold text-dark-gray">Sections</h4>
              <ul className="flex flex-col gap-2">
                {deleted.sections.map((section) => (
                  <li key={section.id} className={rowClass}>
                    <span className="min-w-0">
                      <span className="block break-words font-semibold text-dark-gray">
                        {section.title}
                      </span>
                      <span className="block text-sm text-dark-gray">
                        {SECTION_TYPE_LABELS[section.type]} · {when(section.deletedAt)}
                      </span>
                    </span>
                    {actions(
                      () =>
                        run(
                          () => curriculumApi.restoreSection(section.id),
                          `"${section.title}" restored`,
                          'Failed to restore section',
                          true,
                        ),
                      () => setPending({ kind: 'section', id: section.id, label: section.title }),
                      section.title,
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {deleted.quizzes.length > 0 && (
            <div>
              <h4 className="mb-2 text-sm font-semibold text-dark-gray">Quizzes</h4>
              <ul className="flex flex-col gap-2">
                {deleted.quizzes.map((quiz) => (
                  <li key={quiz.id} className={rowClass}>
                    <span className="min-w-0">
                      <span className="block break-words font-semibold text-dark-gray">
                        {quiz.title}
                      </span>
                      <span className="block text-sm text-dark-gray">
                        Quiz · in “{quiz.sectionTitle}” · {when(quiz.deletedAt)}
                      </span>
                    </span>
                    {actions(
                      () =>
                        run(
                          () => curriculumApi.restoreSection(quiz.sectionId),
                          `"${quiz.title}" restored`,
                          'Failed to restore quiz',
                          true,
                        ),
                      () => setPending({ kind: 'quiz', id: quiz.sectionId, label: quiz.title }),
                      quiz.title,
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={pending !== null}
        title="Delete permanently"
        confirmLabel="Delete forever"
        message={
          <>
            Permanently delete <span className="font-semibold">{pending?.label}</span>?
            {pending?.kind === 'model' && ' Every section inside it goes with it.'}
            <br />
            This cannot be undone.
          </>
        }
        onConfirm={() => {
          const target = pending;
          setPending(null);
          if (target) purge(target);
        }}
        onCancel={() => setPending(null)}
      />
    </section>
  );
};

export default DeletedItems;
