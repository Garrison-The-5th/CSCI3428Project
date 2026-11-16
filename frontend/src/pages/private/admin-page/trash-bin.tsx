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
 * Courses and standalone quizzes are soft deleted, so they land here. (A quiz
 * set is a course, so it is among the courses.) Each can be restored or
 * permanently removed, and the whole bin can be restored or emptied at once.
 *
 * Nothing from inside a course is here. A model, a section or a quiz deleted
 * from a course that is still live is in that course's own Archive tab, and
 * neither Restore all nor Empty recycle bin reaches it. The server clears anything older than its retention window
 * on its own, so every row says how long it has left rather than only when it
 * arrived — the countdown is the part that matters.
 */
import { ArrowUturnLeftIcon, TrashIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useCallback, useEffect, useState } from 'react';

import ConfirmDialog from '@/components/common/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { curriculumApi, DeletedCourse } from '@/services/curriculum-api';
import { DeletedQuiz, quizApi } from '@/services/quiz-api';
import { logger } from '@/utils/logger';
import { timeLeft } from '@/utils/retention';

/** What the confirm dialog is asking about. `all` empties the whole bin. */
type Pending = { kind: 'course' | 'quiz'; id: string; label: string } | { kind: 'all' } | null;

interface TrashBinProps {
  onNotify: (message: string, type?: 'success' | 'error') => void;
}

/**
 * The recycle bin: the deleted courses this person may edit and the deleted standalone quizzes,
 * each restorable or deletable for good, plus restore-all and empty-bin. Items expire after
 * `retentionDays`.
 */
const TrashBin = ({ onNotify }: TrashBinProps) => {
  const [courses, setCourses] = useState<DeletedCourse[]>([]);
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

  /** Restores everything in the bin: the courses, then the standalone quizzes. */
  const restoreAll = () =>
    run(
      async () => {
        await curriculumApi.restoreAllDeleted();
        await quizApi.restoreAllQuizzes();
      },
      'Courses and standalone quizzes restored',
      'Failed to restore everything',
    );

  /** Permanently deletes everything in the bin: the courses and the standalone quizzes. */
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
        : () => quizApi.purgeQuiz(target.id);

    return run(call, `"${target.label}" permanently deleted`, 'Failed to delete permanently');
  };

  const total = courses.length + quizzes.length;

  const row = (
    kind: 'course' | 'quiz',
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
                Deleted courses and standalone quizzes. They are cleared automatically after{' '}
                {retentionDays} days.
              </p>
              <p className="text-sm text-dark-gray">
                A model, section or quiz deleted from inside a course is in that course&rsquo;s
                Archive tab.
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
                <ArrowUturnLeftIcon className="w-4 h-4" /> Restore all courses and quizzes
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
              Nothing deleted. Courses and standalone quizzes you remove will appear here.
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

              {quizzes.length > 0 && (
                <section>
                  <h3 className="mb-2 font-semibold text-dark-gray">Standalone quizzes</h3>
                  <ul className="flex flex-col gap-2">
                    {quizzes.map((quiz) =>
                      row('quiz', quiz.id, quiz.title, 'Belongs to no course', quiz.deletedAt, () =>
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
              Permanently delete the {courses.length} course{courses.length === 1 ? '' : 's'} and{' '}
              {quizzes.length} standalone quiz{quizzes.length === 1 ? '' : 'zes'} in the recycle
              bin? Each course&rsquo;s models, sections and content go with it.
              <br />
              This cannot be undone. Items in a live course&rsquo;s Archive tab are not affected.
            </>
          ) : (
            <>
              Permanently delete <span className="font-semibold">{pending?.label}</span>?
              {pending?.kind === 'course' && ' Its models, sections and content go with it.'}
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
