/**
 * File: course-editor.tsx
 * Description: The shell around the three editing sections.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
/**
 * CourseEditor — the shell around the three editing sections.
 *
 * A sidebar switches between the landing page, the modules, and access. This page
 * owns the course data and the confirm dialog; each section owns its own forms.
 * Reachable only by picking a lesson card.
 */
import {
  ArrowLeftIcon,
  ClockIcon,
  CloudArrowUpIcon,
  EyeIcon,
  Squares2X2Icon,
  TrashIcon,
  UsersIcon,
  WindowIcon,
} from '@heroicons/react/24/outline';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import ConfirmDialog from '@/components/common/confirm-dialog';
import ToastNotification from '@/components/common/toast-notification';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import CourseAccess from '@/pages/private/admin/editor/course-access';
import LandingPageEditor from '@/pages/private/admin/editor/landing-page-editor';
import ModuleEditor from '@/pages/private/admin/editor/module-editor';
import CourseLanding from '@/pages/private/learning/course-landing';
import CoursePlayer from '@/pages/private/learning/course-player';
import { Course, curriculumApi, PublicationState } from '@/services/curriculum-api';
import { quizApi } from '@/services/quiz-api';
import HttpHelper from '@/utils/http-helper';
import { logger } from '@/utils/logger';

type Toast = { show: boolean; message: string; type: 'success' | 'error' };
type EditorPane =
  'landing' | 'modules' | 'access' | 'versions' | 'preview-landing' | 'preview-content';
type PendingDelete = {
  kind: 'course' | 'section' | 'module' | 'quiz' | 'element';
  id: string;
  label: string;
} | null;

const PANES: Array<{ key: EditorPane; label: string; Icon: typeof WindowIcon }> = [
  { key: 'landing', label: 'Landing page', Icon: WindowIcon },
  { key: 'modules', label: 'Modules', Icon: Squares2X2Icon },
  { key: 'access', label: 'Course access', Icon: UsersIcon },
  { key: 'versions', label: 'Version history', Icon: ClockIcon },
  { key: 'preview-landing', label: 'Landing page preview', Icon: EyeIcon },
  { key: 'preview-content', label: 'Course content preview', Icon: EyeIcon },
];

/**
 * How long a replaced version stays readable. Mirrors ARCHIVE_DAYS in
 * backend/src/services/publicationService — the server does the deleting; this
 * only has to say when.
 */
const ARCHIVE_DAYS = 14;

/** Sits above a preview so it is never mistaken for the live page. */
const PreviewBanner = ({ note }: { note: string }) => (
  <div className="mb-4 rounded-lg border-2 border-navy/30 bg-navy/5 px-4 py-3">
    <p className="text-sm font-semibold text-dark-gray">Preview — exactly what a learner sees</p>
    <p className="text-sm text-dark-gray">{note}</p>
  </div>
);

const CourseEditor = () => {
  const { courseId } = useParams<{ courseId: string }>();
  const navigate = useNavigate();

  const [course, setCourse] = useState<Course | null>(null);
  const [isGlobalAuthor, setIsGlobalAuthor] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pane, setPane] = useState<EditorPane>('landing');
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete>(null);
  const [toast, setToast] = useState<Toast>({ show: false, message: '', type: 'success' });
  const [publication, setPublication] = useState<PublicationState | null>(null);
  const [publishing, setPublishing] = useState(false);

  const notify = (message: string, type: 'success' | 'error' = 'success') =>
    setToast({ show: true, message, type });

  /**
   * What learners are being served, versus what the author has been editing.
   * Read alongside the course rather than folded into it: the answer depends on
   * the publication table, and the editable endpoint knows nothing about that.
   */
  const fetchPublication = useCallback(async () => {
    if (!courseId) return;
    try {
      setPublication(await curriculumApi.getPublicationState(courseId));
    } catch (err) {
      logger.error('Error loading publication state:', err);
    }
  }, [courseId]);

  const fetchCourse = useCallback(async () => {
    if (!courseId) return;
    try {
      // The editable endpoint returns everything for a global author and only the
      // named lessons for a contributor, so one call covers both.
      const editable = await HttpHelper.get('curriculum/courses/editable');
      const list: Course[] = editable.courses ?? [];
      setIsGlobalAuthor(editable.isGlobalAuthor === true);
      setCourse(list.find((c) => c.id === courseId) ?? null);
      await fetchPublication();
    } catch (err) {
      logger.error('Error loading lesson:', err);
      notify('Failed to load this lesson', 'error');
    } finally {
      setLoading(false);
    }
  }, [courseId, fetchPublication]);

  useEffect(() => {
    fetchCourse();
  }, [fetchCourse]);

  /**
   * Puts the course live as a new version.
   *
   * One action for both cases the header offers. A course that has never been
   * published becomes visible; one that has picks up everything edited since,
   * additions and changes alike, in a single step.
   */
  const publish = async () => {
    if (!course || publishing) return;
    try {
      setPublishing(true);
      const response = await curriculumApi.publishCourse(course.id);
      await fetchCourse();
      notify(response.message);
    } catch (err) {
      logger.error('Failed to publish:', err);
      notify(err instanceof Error && err.message ? err.message : 'Failed to publish', 'error');
    } finally {
      setPublishing(false);
    }
  };

  // Keep a module selected so the module pane is never blank on arrival.
  useEffect(() => {
    if (!selectedModuleId && course?.modules.length) setSelectedModuleId(course.modules[0].id);
  }, [course, selectedModuleId]);

  const run = async (action: () => Promise<unknown>, success: string, failure: string) => {
    try {
      await action();
      await fetchCourse();
      if (success) notify(success);
      return true;
    } catch (err) {
      logger.error(`${failure}:`, err);
      notify(err instanceof Error && err.message ? err.message : failure, 'error');
      return false;
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setPendingDelete(null);

    if (target.kind === 'course') {
      const ok = await run(
        () => curriculumApi.deleteCourse(target.id),
        'Lesson moved to the recycle bin',
        'Failed to delete lesson',
      );
      if (ok) navigate('/admin/learning');
    } else if (target.kind === 'section') {
      const ok = await run(
        () => curriculumApi.deleteSection(target.id),
        'Section moved to the recycle bin',
        'Failed to delete section',
      );
      // Its modules went with it, so whatever was selected may be gone.
      if (ok) setSelectedModuleId(null);
    } else if (target.kind === 'module') {
      const ok = await run(
        () => curriculumApi.deleteModule(target.id),
        'Module moved to the recycle bin',
        'Failed to delete module',
      );
      if (ok) setSelectedModuleId(null);
    } else if (target.kind === 'quiz') {
      await run(
        () => quizApi.deleteQuiz(target.id),
        'Quiz moved to the recycle bin',
        'Failed to delete quiz',
      );
    } else {
      await run(() => curriculumApi.deleteElement(target.id), '', 'Failed to delete item');
    }
  };

  if (loading) {
    return (
      <div className="page-container flex flex-col">
        <div className="text-center">Loading lesson...</div>
      </div>
    );
  }

  if (!course) {
    return (
      <div className="page-container flex flex-col">
        <Button onClick={() => navigate('/admin/learning')} variant="ghost" className="w-fit px-0">
          ← All lessons
        </Button>
        <Card className="bg-light-gray">
          <CardContent className="py-16 text-center">
            <p>That lesson could not be found.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const totalMinutes = course.modules.reduce((s, m) => s + m.estimatedMinutes, 0);
  const hasChanges = publication?.hasUnpublishedChanges ?? false;
  const unpublished = publication?.unpublished;
  const unpublishedCount =
    (unpublished?.newSectionIds.length ?? 0) +
    (unpublished?.newModuleIds.length ?? 0) +
    (unpublished?.newElementIds.length ?? 0) +
    (unpublished?.newQuizIds.length ?? 0);

  return (
    <div className="page-container flex flex-col">
      <Button
        onClick={() => navigate('/admin/learning')}
        variant="ghost"
        className="mb-4 w-fit gap-2 px-0 text-dark-gray hover:text-green-hover"
      >
        <ArrowLeftIcon className="w-5 h-5" /> All lessons
      </Button>

      <header className="responsive-page-header flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="page-title break-words font-bold text-dark-gray">{course.title}</h1>
            <Badge
              className={
                course.published ? 'bg-navy px-2 text-white' : 'bg-gray-400 px-2 text-white'
              }
            >
              {course.published ? 'Published' : 'Draft'}
            </Badge>
          </div>
          <p className="page-subtitle mt-1 text-sm text-dark-gray">
            {course.sections.length} section{course.sections.length === 1 ? '' : 's'} ·{' '}
            {course.modules.length} modules · {totalMinutes} min · changes save automatically
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-3">
          {/* Publishing a first version and publishing an update are the same
              action, but they read very differently to an author, so the button
              says which one it is about to do. */}
          {!course.published || (course.publishedVersion ?? 0) < 1 ? (
            <Button
              onClick={publish}
              disabled={publishing}
              className="gap-2 bg-navy text-white hover:bg-navy-hover"
            >
              <CloudArrowUpIcon className="w-5 h-5" />
              {publishing ? 'Publishing...' : 'Publish'}
            </Button>
          ) : (
            <>
              <Button
                onClick={publish}
                disabled={publishing || !hasChanges}
                className={hasChanges ? 'gap-2 bg-navy text-white hover:bg-navy-hover' : 'gap-2'}
                variant={hasChanges ? 'default' : 'outline'}
                title={
                  hasChanges
                    ? 'Release everything edited since the last publish'
                    : 'Nothing has changed since the last publish'
                }
              >
                <CloudArrowUpIcon className="w-5 h-5" />
                {publishing ? 'Publishing...' : 'Publish updated course'}
              </Button>
              <Button
                onClick={() =>
                  run(
                    () => curriculumApi.updateCourse(course.id, { published: false }),
                    'Unpublished — learners can no longer reach it',
                    'Failed to unpublish',
                  )
                }
                variant="outline"
                className="bg-white text-dark-gray hover:bg-light-gray"
              >
                Unpublish
              </Button>
            </>
          )}

          <Button
            onClick={() => setPendingDelete({ kind: 'course', id: course.id, label: course.title })}
            variant="ghost"
            size="icon"
            className="hover:text-danger-hover"
            title="Delete lesson"
          >
            <TrashIcon className="w-6 h-6" />
          </Button>
        </div>
      </header>

      {/* What learners are actually being served right now. Worth stating
          plainly: with versioned publishing, the editor and the live course are
          routinely different, and an author needs to know which they are looking
          at. */}
      {course.published && (course.publishedVersion ?? 0) >= 1 && (
        <div
          className={`mt-4 flex flex-wrap items-center gap-3 rounded-lg border-2 px-4 py-3
          ${hasChanges ? 'border-new/40 bg-new-soft' : 'border-navy/30 bg-navy/5'}`}
        >
          <span className="text-sm font-semibold text-dark-gray">
            {hasChanges
              ? `Learners are seeing version ${course.publishedVersion}. You have unpublished changes.`
              : `Learners are seeing version ${course.publishedVersion} — up to date.`}
          </span>
          {hasChanges && unpublishedCount > 0 && (
            <span className="text-sm text-dark-gray">
              {unpublishedCount} new item{unpublishedCount === 1 ? '' : 's'} waiting
            </span>
          )}
        </div>
      )}

      <hr className="mt-4 mb-8 h-0.5 border-t-0 bg-navy" />

      <div className="grid gap-6 md:grid-cols-[14rem_minmax(0,1fr)]">
        {/* ---- Section sidebar ---- */}
        <nav className="h-fit md:sticky md:top-20">
          <ul className="flex flex-col gap-1">
            {PANES.map(({ key, label, Icon }) => (
              <li key={key}>
                <button
                  onClick={() => setPane(key)}
                  aria-current={pane === key ? 'page' : undefined}
                  className={`flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left text-sm
                  font-medium transition-colors
                  ${pane === key ? 'bg-navy text-white' : 'text-dark-gray hover:bg-light-gray'}`}
                >
                  <Icon className="w-5 h-5 shrink-0" />
                  {label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        {/* ---- Section content ---- */}
        <div className="min-w-0">
          {pane === 'landing' && (
            <LandingPageEditor
              course={course}
              onRefresh={fetchCourse}
              onNotify={notify}
              run={run}
            />
          )}

          {pane === 'modules' && (
            <ModuleEditor
              course={course}
              selectedModuleId={selectedModuleId}
              onSelectModule={setSelectedModuleId}
              onRefresh={fetchCourse}
              onNotify={notify}
              onDelete={setPendingDelete}
              run={run}
              setCourse={setCourse}
              unpublished={publication?.unpublished}
            />
          )}

          {pane === 'access' && (
            <CourseAccess course={course} canManageAuthors={isGlobalAuthor} onNotify={notify} />
          )}

          {pane === 'versions' && (
            <Card className="bg-light-gray shadow-sm">
              <CardContent className="flex flex-col gap-4 p-4">
                <div>
                  <h2 className="text-lg font-semibold text-dark-gray">Version history</h2>
                  <p className="text-sm text-dark-gray">
                    Each publish freezes the course as it stood. The version learners are reading is
                    kept indefinitely; replaced versions are archived for {ARCHIVE_DAYS} days and
                    then cleared.
                  </p>
                </div>

                {(publication?.versions.length ?? 0) === 0 ? (
                  <p className="py-8 text-center text-dark-gray">
                    Never published. The first publish becomes version 1.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {publication!.versions.map((entry) => {
                      const added =
                        entry.newSectionIds.length +
                        entry.newModuleIds.length +
                        entry.newElementIds.length +
                        entry.newQuizIds.length;
                      const live = entry.supersededAt === null;

                      return (
                        <li
                          key={entry.id}
                          className={`flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3
                            ${live ? 'border-navy bg-white' : 'border-gray-300 bg-white/60'}`}
                        >
                          <span className="min-w-40 flex-1">
                            <span className="flex flex-wrap items-center gap-2">
                              <span className="font-semibold text-dark-gray">
                                Version {entry.version}
                              </span>
                              {live ? (
                                <Badge className="bg-navy px-2 text-white">Live</Badge>
                              ) : (
                                <Badge className="bg-gray-400 px-2 text-white">Archived</Badge>
                              )}
                            </span>
                            <span className="block text-xs text-dark-gray">
                              Published {new Date(entry.publishedAt).toLocaleString()}
                              {entry.publishedBy &&
                                ` by ${entry.publishedBy.name ?? entry.publishedBy.email}`}
                              {added > 0 && ` · ${added} new item${added === 1 ? '' : 's'}`}
                              {!live &&
                                ` · clears ${new Date(
                                  new Date(entry.supersededAt!).getTime() +
                                    ARCHIVE_DAYS * 86_400_000,
                                ).toLocaleDateString()}`}
                            </span>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </CardContent>
            </Card>
          )}

          {/* Previews render the real learner pages, so they cannot drift from
              what is actually shipped. */}
          {pane === 'preview-landing' && (
            <>
              <PreviewBanner note="The Course content button is disabled here." />
              <CourseLanding previewCourse={course} preview />
            </>
          )}

          {pane === 'preview-content' && (
            <>
              <PreviewBanner note="Notes work but are not saved, and progress is not recorded." />
              <CoursePlayer previewCourse={course} preview />
            </>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        title={`Delete ${pendingDelete?.kind ?? 'item'}`}
        message={
          <>
            Delete <span className="font-semibold">{pendingDelete?.label}</span>?
            {pendingDelete?.kind === 'course' && ' Its sections and content go with it.'}
            {pendingDelete?.kind === 'section' &&
              ' Every module inside it goes too, and the sections after it move up.'}
            {pendingDelete?.kind !== 'element' && (
              <>
                <br />
                You can restore it from the Admin Dashboard.
              </>
            )}
          </>
        }
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />

      <ToastNotification
        show={toast.show}
        message={toast.message}
        type={toast.type}
        onClose={() => setToast((prev) => ({ ...prev, show: false }))}
      />
    </div>
  );
};

export default CourseEditor;
