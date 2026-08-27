/**
 * File: course-editor.tsx
 * Description: The shell around the three editing modules.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
/**
 * CourseEditor — the shell around the three editing modules.
 *
 * A sidebar switches between the landing page, the sections, and access. This page
 * owns the course data and the confirm dialog; each module owns its own forms.
 * Reachable only by picking a lesson card.
 */
import {
  ArrowLeftIcon,
  ArrowUturnLeftIcon,
  ClockIcon,
  CloudArrowUpIcon,
  EyeIcon,
  QuestionMarkCircleIcon,
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
import QuizPane from '@/pages/private/admin/editor/quiz-pane';
import StructureEditor from '@/pages/private/admin/editor/structure-editor';
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
  kind: 'course' | 'module' | 'section' | 'quiz' | 'element';
  id: string;
  label: string;
} | null;

/**
 * An archived version waiting on a yes.
 *
 * Both actions ask first, for opposite reasons: restoring changes what every
 * learner on the course is reading, and deleting throws away the only copy of a
 * tree that is no longer reachable any other way.
 */
type PendingVersion = {
  action: 'restore' | 'delete';
  id: string;
  version: number;
} | null;

/**
 * The sidebar.
 *
 * One shell serves both jobs. Writing a lesson gets the course structure in the
 * second slot; building its quizzes gets the quiz pane in the same slot, labelled
 * Quiz. Every other tab — landing page, access, versions and the two previews —
 * is identical, because it is the same course either way.
 */
function panesFor(
  mode: EditorMode,
): Array<{ key: EditorPane; label: string; Icon: typeof WindowIcon }> {
  return [
    { key: 'landing', label: 'Landing page', Icon: WindowIcon },
    mode === 'quiz'
      ? { key: 'modules', label: 'Quiz', Icon: QuestionMarkCircleIcon }
      : { key: 'modules', label: 'Modules', Icon: Squares2X2Icon },
    // Named for what it governs. A quiz set is not "a course" to the person
    // building one, and the sidebar is the only place that word appears.
    { key: 'access', label: mode === 'quiz' ? 'Quiz access' : 'Course access', Icon: UsersIcon },
    { key: 'versions', label: 'Version history', Icon: ClockIcon },
    { key: 'preview-landing', label: 'Landing page preview', Icon: EyeIcon },
    { key: 'preview-content', label: 'Course content preview', Icon: EyeIcon },
  ];
}

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

/** Which job this shell is doing. */
export type EditorMode = 'lesson' | 'quiz';

interface CourseEditorProps {
  /**
   * Which course to edit. Normally taken from the route; the Create a Quiz page
   * passes it directly, because there the course is chosen from a grid rather
   * than navigated to.
   */
  courseId?: string;
  mode?: EditorMode;
  /** Where the back link goes. Defaults to the lessons list. */
  onBack?: () => void;
  backLabel?: string;
}

const CourseEditor = ({
  courseId: courseIdProp,
  mode = 'lesson',
  onBack,
  backLabel = 'All lessons',
}: CourseEditorProps = {}) => {
  const params = useParams<{ courseId: string }>();
  const courseId = courseIdProp ?? params.courseId;
  const navigate = useNavigate();

  const [course, setCourse] = useState<Course | null>(null);
  const [loading, setLoading] = useState(true);
  // The quiz shell opens on its own pane: somebody who came here to write
  // questions should not have to click past the landing page first.
  const [pane, setPane] = useState<EditorPane>(mode === 'quiz' ? 'modules' : 'landing');
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete>(null);
  const [toast, setToast] = useState<Toast>({ show: false, message: '', type: 'success' });
  const [publication, setPublication] = useState<PublicationState | null>(null);
  const [publishing, setPublishing] = useState(false);
  /** The archived version awaiting confirmation, and which way it is going. */
  const [pendingVersion, setPendingVersion] = useState<PendingVersion>(null);
  /** Set while a restore or delete is in flight, so both buttons on every row stop. */
  const [versionBusy, setVersionBusy] = useState(false);

  const notify = (message: string, type: 'success' | 'error' = 'success') =>
    setToast({ show: true, message, type });

  /** Leaving the editor. The quiz page reopens its own grid rather than routing. */
  const goBack = () => (onBack ? onBack() : navigate('/admin/learning'));

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
      // The editable endpoint returns exactly what this person may open — the
      // lessons they made and the ones they were named on — so a lesson that is
      // not theirs simply is not in the list, and the page reports it missing.
      const editable = await HttpHelper.get('curriculum/courses/editable');
      const list: Course[] = editable.courses ?? [];
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

  /**
   * Carries out whichever action the confirmation was for.
   *
   * Both reload the whole course rather than patching the list in place: a
   * restore moves the live pointer, supersedes what was live, and mints a new
   * row, so the header, the unpublished-changes marker and the history all
   * change together and are better re-read than reconstructed.
   */
  const confirmVersionAction = async () => {
    const target = pendingVersion;
    setPendingVersion(null);
    if (!target || versionBusy) return;

    try {
      setVersionBusy(true);
      const response =
        target.action === 'restore'
          ? await curriculumApi.restoreVersion(target.id)
          : await curriculumApi.deleteVersion(target.id);
      await fetchCourse();
      notify(response.message);
    } catch (err) {
      logger.error(`Failed to ${target.action} version:`, err);
      notify(
        err instanceof Error && err.message
          ? err.message
          : `Failed to ${target.action} version ${target.version}`,
        'error',
      );
    } finally {
      setVersionBusy(false);
    }
  };

  // Keep a section selected so the section pane is never blank on arrival.
  useEffect(() => {
    if (!selectedSectionId && course?.sections.length) setSelectedSectionId(course.sections[0].id);
  }, [course, selectedSectionId]);

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
      if (ok) goBack();
    } else if (target.kind === 'module') {
      const ok = await run(
        () => curriculumApi.deleteModule(target.id),
        'Module moved to the recycle bin',
        'Failed to delete module',
      );
      // Its sections went with it, so whatever was selected may be gone.
      if (ok) setSelectedSectionId(null);
    } else if (target.kind === 'section') {
      // In a quiz set a section *is* a quiz, so the message says what the author
      // thinks they deleted rather than what the row is called underneath.
      const ok = await run(
        () => curriculumApi.deleteSection(target.id),
        course?.kind === 'QUIZ_SET'
          ? 'Quiz moved to the recycle bin'
          : 'Section moved to the recycle bin',
        course?.kind === 'QUIZ_SET' ? 'Failed to delete quiz' : 'Failed to delete section',
      );
      if (ok) setSelectedSectionId(null);
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
        <Button onClick={goBack} variant="ghost" className="w-fit px-0">
          ← {backLabel}
        </Button>
        <Card className="bg-light-gray">
          <CardContent className="py-16 text-center">
            <p>That lesson could not be found.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const totalMinutes = course.sections.reduce((s, m) => s + m.estimatedMinutes, 0);
  /**
   * A quiz set has one module nobody sees and a section per quiz, so counting
   * modules and sections at it would describe the plumbing rather than the
   * thing. It gets a quiz count instead.
   */
  const isQuizSet = course.kind === 'QUIZ_SET';
  const quizCount = course.sections.reduce((sum, section) => sum + section.quizzes.length, 0);
  const hasChanges = publication?.hasUnpublishedChanges ?? false;
  const unpublished = publication?.unpublished;
  const unpublishedCount =
    (unpublished?.newModuleIds.length ?? 0) +
    (unpublished?.newSectionIds.length ?? 0) +
    (unpublished?.newElementIds.length ?? 0) +
    (unpublished?.newQuizIds.length ?? 0);

  return (
    <div className="page-container flex flex-col">
      <Button
        onClick={goBack}
        variant="ghost"
        className="mb-4 w-fit gap-2 px-0 text-dark-gray hover:text-green-hover"
      >
        <ArrowLeftIcon className="w-5 h-5" /> {backLabel}
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
            {isQuizSet ? (
              <>
                {quizCount} quiz{quizCount === 1 ? '' : 'zes'} · {totalMinutes} min
              </>
            ) : (
              <>
                {course.modules.length} module{course.modules.length === 1 ? '' : 's'} ·{' '}
                {course.sections.length} sections · {totalMinutes} min
              </>
            )}{' '}
            · changes save automatically
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
              ? `Learners are seeing version ${course.publishedVersion}. ` +
                'You have unpublished changes.'
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
        {/* ---- Module sidebar ---- */}
        <nav className="h-fit md:sticky md:top-20">
          <ul className="flex flex-col gap-1">
            {panesFor(mode).map(({ key, label, Icon }) => (
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

        {/* ---- Module content ---- */}
        <div className="min-w-0">
          {pane === 'landing' && (
            <LandingPageEditor
              course={course}
              onRefresh={fetchCourse}
              onNotify={notify}
              run={run}
            />
          )}

          {pane === 'modules' && mode === 'quiz' && (
            <QuizPane
              course={course}
              selectedSectionId={selectedSectionId}
              onSelectSection={setSelectedSectionId}
              onRefresh={fetchCourse}
              onNotify={notify}
              onDelete={setPendingDelete}
              run={run}
            />
          )}

          {pane === 'modules' && mode === 'lesson' && (
            <StructureEditor
              course={course}
              selectedSectionId={selectedSectionId}
              onSelectSection={setSelectedSectionId}
              onRefresh={fetchCourse}
              onNotify={notify}
              onDelete={setPendingDelete}
              run={run}
              setCourse={setCourse}
              unpublished={publication?.unpublished}
            />
          )}

          {/*
            Anyone who can open this editor either made the lesson or was named on
            it, and either way may share it: there is no wider admin who can reach
            it over their head, so there is nobody left to defer to.
          */}
          {pane === 'access' && (
            <CourseAccess course={course} canManageAuthors mode={mode} onNotify={notify} />
          )}

          {pane === 'versions' && (
            <Card className="bg-light-gray shadow-sm">
              <CardContent className="flex flex-col gap-4 p-4">
                <div>
                  <h2 className="text-lg font-semibold text-dark-gray">Version history</h2>
                  <p className="text-sm text-dark-gray">
                    Each publish freezes the course as it stood. The version learners are reading is
                    kept indefinitely; replaced versions are archived for {ARCHIVE_DAYS} days and
                    then cleared automatically — the countdown on each one says how long is left.
                    Restore puts an archived version back in front of learners as a new version, so
                    nothing is lost and a restore can itself be undone.
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
                        entry.newModuleIds.length +
                        entry.newSectionIds.length +
                        entry.newElementIds.length +
                        entry.newQuizIds.length;
                      const live = entry.supersededAt === null;
                      const clearsAt = live
                        ? null
                        : new Date(
                            new Date(entry.supersededAt!).getTime() + ARCHIVE_DAYS * 86_400_000,
                          );
                      // Rounded up, so the last full day still reads "1 day left"
                      // rather than "0" while the version is plainly still here.
                      const daysLeft = clearsAt
                        ? Math.max(0, Math.ceil((clearsAt.getTime() - Date.now()) / 86_400_000))
                        : null;

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
                              {daysLeft !== null && (
                                <Badge
                                  className={`px-2 text-white ${
                                    daysLeft <= 3 ? 'bg-danger' : 'bg-gray-400'
                                  }`}
                                  title={`Deleted automatically on ${clearsAt!.toLocaleDateString()}`}
                                >
                                  {daysLeft === 0
                                    ? 'Clears today'
                                    : `${daysLeft} day${daysLeft === 1 ? '' : 's'} left`}
                                </Badge>
                              )}
                            </span>
                            <span className="block text-xs text-dark-gray">
                              Published {new Date(entry.publishedAt).toLocaleString()}
                              {entry.publishedBy &&
                                ` by ${entry.publishedBy.name ?? entry.publishedBy.email}`}
                              {added > 0 && ` · ${added} new item${added === 1 ? '' : 's'}`}
                              {clearsAt && ` · clears ${clearsAt.toLocaleDateString()}`}
                            </span>
                          </span>

                          {/* Only an archived version offers these. The live one
                              has nothing to restore to and must not be deleted —
                              it is what every learner is currently reading. */}
                          {!live && (
                            <span className="flex shrink-0 items-center gap-2">
                              <Button
                                onClick={() =>
                                  setPendingVersion({
                                    action: 'restore',
                                    id: entry.id,
                                    version: entry.version,
                                  })
                                }
                                disabled={versionBusy}
                                variant="outline"
                                className="gap-2 bg-white text-dark-gray hover:bg-light-gray"
                                title="Publish this version again for learners"
                              >
                                <ArrowUturnLeftIcon className="w-4 h-4" />
                                Restore
                              </Button>
                              <Button
                                onClick={() =>
                                  setPendingVersion({
                                    action: 'delete',
                                    id: entry.id,
                                    version: entry.version,
                                  })
                                }
                                disabled={versionBusy}
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 hover:text-danger-hover"
                                title="Delete this archived version now"
                              >
                                <TrashIcon className="w-4 h-4" />
                              </Button>
                            </span>
                          )}
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
            {pendingDelete?.kind === 'course' && ' Its modules and content go with it.'}
            {pendingDelete?.kind === 'module' &&
              ' Every section inside it goes too, and the modules after it move up.'}
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

      <ConfirmDialog
        open={pendingVersion !== null}
        title={
          pendingVersion?.action === 'restore'
            ? `Restore version ${pendingVersion.version}`
            : `Delete version ${pendingVersion?.version ?? ''}`
        }
        message={
          pendingVersion?.action === 'restore' ? (
            <>
              Publish version <span className="font-semibold">{pendingVersion.version}</span> again?
              Learners will start reading it immediately.
              <br />
              It goes out under a new version number, so the one it replaces is archived rather than
              lost and you can come back to it. Your unpublished edits are left alone.
            </>
          ) : (
            <>
              Permanently delete version{' '}
              <span className="font-semibold">{pendingVersion?.version}</span>?
              <br />
              This is the only copy — it cannot be restored afterwards.
            </>
          )
        }
        confirmLabel={pendingVersion?.action === 'restore' ? 'Restore' : 'Delete'}
        onConfirm={confirmVersionAction}
        onCancel={() => setPendingVersion(null)}
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
