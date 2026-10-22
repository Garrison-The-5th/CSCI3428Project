/**
 * File: trash-bin.tsx
 * Description: The recycle bin.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
/**
 * The recycle bin.
 *
 * Courses, modules, sections and quizzes are soft deleted, so they land here.
 * Each can be restored or permanently removed, and the whole bin can be restored
 * or emptied at once. The server clears anything older than its retention window
 * on its own, so every row says how long it has left rather than only when it
 * arrived — the countdown is the part that matters.
 */
import { ArrowUturnLeftIcon, TrashIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useCallback, useEffect, useState } from 'react';

import ConfirmDialog from '@/components/common/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  curriculumApi,
  DeletedCourse,
  DeletedModule,
  DeletedSection,
} from '@/services/curriculum-api';
import { DeletedQuiz, quizApi } from '@/services/quiz-api';
import { logger } from '@/utils/logger';

/** What the confirm dialog is asking about. `all` empties the whole bin. */
type Pending =
  | { kind: 'course' | 'module' | 'section' | 'quiz'; id: string; label: string }
  | { kind: 'all' }
  | null;

interface TrashBinProps {
  onNotify: (message: string, type?: 'success' | 'error') => void;
}

/** "3 days left", or "clearing soon" once it is inside the last day. */
function timeLeft(deletedAt: string, retentionDays: number): string {
  const expiresAt = new Date(deletedAt).getTime() + retentionDays * 86_400_000;
  const days = Math.ceil((expiresAt - Date.now()) / 86_400_000);
  if (days <= 0) return 'clearing now';
  if (days === 1) return 'clears tomorrow';
  return `clears in ${days} days`;
}

/**
 * The recycle bin: deleted courses, modules, sections and quizzes this person may edit, each
 * restorable or deletable for good, plus restore-all and empty-bin. Items expire after
 * `retentionDays`.
 */
const TrashBin = ({ onNotify }: TrashBinProps) => {
  const [courses, setCourses] = useState<DeletedCourse[]>([]);
  const [modules, setModules] = useState<DeletedModule[]>([]);
  const [sections, setSections] = useState<DeletedSection[]>([]);
  const [quizzes, setQuizzes] = useState<DeletedQuiz[]>([]);
  const [retentionDays, setRetentionDays] = useState(14);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending>(null);

  const fetchDeleted = useCallback(async () => {
    try {
      setLoading(true);
      const [curriculum, deletedQuizzes] = await Promise.all([
        curriculumApi.getDeleted(),
        quizApi.getDeletedQuizzes(),
      ]);
      setCourses(curriculum.courses ?? []);
      setModules(curriculum.modules ?? []);
      setSections(curriculum.sections ?? []);
      setQuizzes(deletedQuizzes);
      if (curriculum.retentionDays) setRetentionDays(curriculum.retentionDays);
    } catch (err) {
      logger.error('Error loading the recycle bin:', err);
      onNotify('Failed to load deleted items', 'error');
    } finally {
      setLoading(false);
    }
    // onNotify is rebuilt each render on the shell; depending on it would loop.
  }, []);

  useEffect(() => {
    fetchDeleted();
  }, [fetchDeleted]);

  /** Runs one bin action, then reloads the bin and reports the outcome. */
  const run = async (action: () => Promise<unknown>, success: string, failure: string) => {
    try {
      setBusy(true);
      await action();
      await fetchDeleted();
      onNotify(success);
    } catch (err) {
      logger.error(`${failure}:`, err);
      onNotify(err instanceof Error && err.message ? err.message : failure, 'error');
    } finally {
      setBusy(false);
    }
  };

  /** Restores everything in the bin — curriculum first, then quizzes. */
  const restoreAll = () =>
    run(
      async () => {
        await curriculumApi.restoreAllDeleted();
        await quizApi.restoreAllQuizzes();
      },
      'Everything restored',
      'Failed to restore everything',
    );

  /** Permanently deletes everything in the bin. */
  const emptyBin = () =>
    run(
      async () => {
        await curriculumApi.purgeAllDeleted();
        await quizApi.purgeAllQuizzes();
      },
      'Recycle bin emptied',
      'Failed to empty the recycle bin',
    );

  /** Permanently deletes one binned item, calling the endpoint for its kind. */
  const purgeOne = (target: Exclude<Pending, null | { kind: 'all' }>) => {
    const call =
      target.kind === 'course'
        ? () => curriculumApi.purgeCourse(target.id)
        : target.kind === 'module'
          ? () => curriculumApi.purgeModule(target.id)
          : target.kind === 'section'
            ? () => curriculumApi.purgeSection(target.id)
            : () => quizApi.purgeQuiz(target.id);

    return run(call, `"${target.label}" permanently deleted`, 'Failed to delete permanently');
  };

  const total = courses.length + modules.length + sections.length + quizzes.length;

  const row = (
    kind: 'course' | 'module' | 'section' | 'quiz',
    id: string,
    title: string,
    origin: string,
    deletedAt: string,
    onRestore: () => void,
  ) => (
    <li
      key={id}
      className="flex items-center justify-between gap-3 rounded-lg border border-gray-300 bg-white
        px-4 py-3"
    >
      <span className="min-w-0">
        <span className="block break-words font-semibold text-dark-gray">{title}</span>
        <span className="block text-sm text-dark-gray">
          {origin && `${origin} · `}
          deleted {new Date(deletedAt).toLocaleString()} ·{' '}
          <span className="font-medium">{timeLeft(deletedAt, retentionDays)}</span>
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <Button
          onClick={onRestore}
          disabled={busy}
          variant="outline"
          className="gap-2 bg-white text-dark-gray hover:bg-light-gray"
        >
          <ArrowUturnLeftIcon className="w-4 h-4" /> Restore
        </Button>
        <Button
          onClick={() => setPending({ kind, id, label: title })}
          disabled={busy}
          variant="ghost"
          size="icon"
          className="hover:text-danger-hover"
          title="Delete permanently"
        >
          <XMarkIcon className="w-5 h-5" />
        </Button>
      </span>
    </li>
  );

  return (
    <>
      <Card className="bg-light-gray shadow-sm">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-4 p-4">
          <div className="flex items-center gap-3">
            <TrashIcon className="w-6 h-6 text-dark-gray" />
            <div>
              <CardTitle className="text-lg text-dark-gray">
                Recycle bin{total > 0 ? ` (${total})` : ''}
              </CardTitle>
              <p className="text-sm text-dark-gray">
                Deleted items are cleared automatically after {retentionDays} days.
              </p>
            </div>
          </div>

          {total > 0 && (
            <div className="flex flex-wrap items-center gap-3">
              <Button
                onClick={restoreAll}
                disabled={busy}
                variant="outline"
                className="gap-2 bg-white text-dark-gray hover:bg-light-gray"
              >
                <ArrowUturnLeftIcon className="w-4 h-4" /> Restore all
              </Button>
              <Button
                onClick={() => setPending({ kind: 'all' })}
                disabled={busy}
                variant="destructive"
                className="gap-2 bg-danger text-white hover:bg-danger-hover"
              >
                <TrashIcon className="w-4 h-4" /> Empty recycle bin
              </Button>
            </div>
          )}
        </CardHeader>

        <CardContent className="flex flex-col gap-6">
          {loading ? (
            <p className="py-8 text-center text-dark-gray">Loading...</p>
          ) : total === 0 ? (
            <p className="py-8 text-center text-dark-gray">
              Nothing deleted. Items you remove will appear here.
            </p>
          ) : (
            <>
              {courses.length > 0 && (
                <section>
                  <h3 className="mb-2 font-semibold text-dark-gray">Courses</h3>
                  <ul className="flex flex-col gap-2">
                    {courses.map((course) =>
                      row('course', course.id, course.title, '', course.deletedAt, () =>
                        run(
                          () => curriculumApi.restoreCourse(course.id),
                          `"${course.title}" restored`,
                          'Failed to restore course',
                        ),
                      ),
                    )}
                  </ul>
                </section>
              )}

              {modules.length > 0 && (
                <section>
                  <h3 className="mb-2 font-semibold text-dark-gray">Modules</h3>
                  <ul className="flex flex-col gap-2">
                    {modules.map((module) =>
                      row(
                        'module',
                        module.id,
                        module.title,
                        `${module.course?.title ?? 'Unknown course'} · comes back at the end`,
                        module.deletedAt,
                        () =>
                          run(
                            () => curriculumApi.restoreModule(module.id),
                            `"${module.title}" restored`,
                            'Failed to restore module',
                          ),
                      ),
                    )}
                  </ul>
                </section>
              )}

              {sections.length > 0 && (
                <section>
                  <h3 className="mb-2 font-semibold text-dark-gray">Sections</h3>
                  <ul className="flex flex-col gap-2">
                    {sections.map((section) =>
                      row(
                        'section',
                        section.id,
                        section.title,
                        section.course?.title ?? 'Unknown course',
                        section.deletedAt,
                        () =>
                          run(
                            () => curriculumApi.restoreSection(section.id),
                            `"${section.title}" restored`,
                            'Failed to restore section',
                          ),
                      ),
                    )}
                  </ul>
                </section>
              )}

              {quizzes.length > 0 && (
                <section>
                  <h3 className="mb-2 font-semibold text-dark-gray">Quizzes</h3>
                  <ul className="flex flex-col gap-2">
                    {quizzes.map((quiz) =>
                      row(
                        'quiz',
                        quiz.id,
                        quiz.title,
                        quiz.section?.course?.title ?? '',
                        quiz.deletedAt,
                        () =>
                          run(
                            () => quizApi.restoreQuiz(quiz.id),
                            `"${quiz.title}" restored`,
                            'Failed to restore quiz',
                          ),
                      ),
                    )}
                  </ul>
                </section>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={pending !== null}
        title={pending?.kind === 'all' ? 'Empty recycle bin' : 'Delete permanently'}
        confirmLabel={pending?.kind === 'all' ? 'Empty bin' : 'Delete forever'}
        message={
          pending?.kind === 'all' ? (
            <>
              Permanently delete all {total} item{total === 1 ? '' : 's'} in the recycle bin?
              <br />
              This cannot be undone.
            </>
          ) : (
            <>
              Permanently delete <span className="font-semibold">{pending?.label}</span>?
              {pending?.kind === 'course' && ' Its sections and content go with it.'}
              <br />
              This cannot be undone.
            </>
          )
        }
        onConfirm={() => {
          const target = pending;
          setPending(null);
          if (!target) return;
          if (target.kind === 'all') emptyBin();
          else purgeOne(target);
        }}
        onCancel={() => setPending(null)}
      />
    </>
  );
};

export default TrashBin;
