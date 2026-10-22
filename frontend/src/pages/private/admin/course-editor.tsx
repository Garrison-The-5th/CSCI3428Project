/**
 * File: course-editor.tsx
 * Description: The shell around the three editing modules.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-09-22
 */
/**
 * CourseEditor — the shell around the three editing modules.
 *
 * A sidebar switches between the landing page, the sections, and access. This page
 * owns the course data and the confirm dialog; each module owns its own forms.
 * Reachable only by picking a lesson card.
 */
import {
  ArchiveBoxIcon,
  ArrowLeftIcon,
  ChevronDoubleLeftIcon,
  ChevronDoubleRightIcon,
  CloudArrowUpIcon,
  DocumentMagnifyingGlassIcon,
  MapIcon,
  PlayCircleIcon,
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
import { EditLocksProvider } from '@/contexts/edit-locks-context';
import {
  ArchivePane,
  CourseAccess,
  CourseMapPane,
  LandingPageEditor,
  type PendingVersion,
  QuizPane,
  StructureEditor,
} from '@/pages/private/admin/editor/panes';
import { CourseLanding, CoursePlayer } from '@/pages/private/learning/learner-previews';
import { courseMapApi } from '@/services/course-map-api';
import { Course, curriculumApi, PublicationState } from '@/services/curriculum-api';
import { Quiz, QUIZ_TYPE_LABELS, quizApi } from '@/services/quiz-api';
import HttpHelper from '@/utils/http-helper';
import { logger } from '@/utils/logger';

type Toast = { show: boolean; message: string; type: 'success' | 'error' };
type EditorPane =
  'landing' | 'modules' | 'mapping' | 'access' | 'versions' | 'preview-landing' | 'preview-content';
type PendingDelete = {
  kind: 'course' | 'module' | 'section' | 'quiz' | 'element';
  id: string;
  label: string;
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
    // Only a lesson has a path through it to direct. A quiz set is one module of
    // quizzes, which is not a journey anybody can be sent different ways along.
    ...(mode === 'quiz'
      ? []
      : [{ key: 'mapping' as const, label: 'Course mapping', Icon: MapIcon }]),
    // Named for what it governs. A quiz set is not "a course" to the person
    // building one, and the sidebar is the only place that word appears.
    { key: 'access', label: mode === 'quiz' ? 'Quiz access' : 'Course access', Icon: UsersIcon },
    // Named Archive rather than Version history: the tab holds both, and the
    // kept versions are the half somebody chose to put there.
    { key: 'versions', label: 'Archive', Icon: ArchiveBoxIcon },
    // Each icon is distinct, because collapsed the sidebar shows nothing else.
    { key: 'preview-landing', label: 'Landing page preview', Icon: DocumentMagnifyingGlassIcon },
    { key: 'preview-content', label: 'Course content preview', Icon: PlayCircleIcon },
  ];
}

/**
 * The quizzes this publish would fix the kind of.
 *
 * `typeLocked` is set by the first publish and never cleared, so an unlocked
 * quiz is one that has never been out — which includes a quiz added last week to
 * a course published last year. The server locks every unlocked quiz in the
 * course when it publishes, so this is the same set it is about to settle.
 */
function quizzesTypeLockedByPublish(course: Course): Quiz[] {
  return course.sections.flatMap((section) =>
    section.quizzes.filter((quiz) => quiz.typeLocked !== true),
  );
}

/** Sits above a preview so it is never mistaken for the live page. */
const PreviewBanner = () => (
  <div className="mb-4 rounded-lg border-2 border-navy/30 bg-navy/5 px-4 py-3">
    <p className="text-sm font-semibold text-dark-gray">Preview</p>
  </div>
);

/** Where the sidebar's collapsed state is remembered between visits. */
const SIDEBAR_KEY = 'course-editor-sidebar-collapsed';

/** Whether the editor's sidebar was left collapsed last time. False when storage is unavailable. */
function readSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === '1';
  } catch {
    return false;
  }
}

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
  /** Open while the author is being asked to check the quiz kinds this publish fixes. */
  const [confirmingTypeLock, setConfirmingTypeLock] = useState(false);
  /** Set while the soft publish to the course map is in flight. */
  const [staging, setStaging] = useState(false);
  /** Collapsed, the sidebar shows its icons only. */
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsed);

  /** Collapses or expands the sidebar and remembers the choice. */
  const toggleSidebar = () =>
    setSidebarCollapsed((prev) => {
      try {
        localStorage.setItem(SIDEBAR_KEY, prev ? '0' : '1');
      } catch {
        // Not remembered, which is fine.
      }
      return !prev;
    });

  /** Shows a toast. */
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
    setConfirmingTypeLock(false);
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
   * The soft publish: hands the content as it stands to the course map.
   *
   * Sits beside Publish because it is the step before it on a directed course —
   * write the content, stage it, map it, then send it out — and because that is
   * the only place an author would look for it. Nothing here reaches a learner.
   */
  const stage = async () => {
    if (!course || staging) return;
    try {
      setStaging(true);
      const response = await courseMapApi.stage(course.id);
      await fetchCourse();
      setPane('mapping');
      notify(response.message ?? 'Staged — your content is ready to map');
    } catch (err) {
      logger.error('Failed to stage:', err);
      notify(err instanceof Error && err.message ? err.message : 'Failed to stage', 'error');
    } finally {
      setStaging(false);
    }
  };

  /**
   * What the publish button does first: check, then publish.
   *
   * A quiz's kind is fixed by the publish that first sends it out and can never
   * be changed afterwards, so the author is shown which quizzes are about to be
   * settled and what they were set to. Only quizzes that have never been out are
   * listed — publishing an update to a course whose quizzes are all locked
   * already asks nothing, because nothing is being decided.
   */
  const requestPublish = () => {
    if (!course || publishing) return;
    if (quizzesTypeLockedByPublish(course).length > 0) {
      setConfirmingTypeLock(true);
      return;
    }
    publish();
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

  /**
   * Runs one edit, then reloads the course and shows `success` — or shows the error. Returns
   * whether it worked.
   */
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

  /** Carries out the delete the author just confirmed — a course, module, section or quiz. */
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
  /** The quizzes the confirmation lists, read at render so it is never stale. */
  const pendingTypeLock = quizzesTypeLockedByPublish(course);
  const hasChanges = publication?.hasUnpublishedChanges ?? false;
  const unpublished = publication?.unpublished;
  const unpublishedCount =
    (unpublished?.newModuleIds.length ?? 0) +
    (unpublished?.newSectionIds.length ?? 0) +
    (unpublished?.newElementIds.length ?? 0) +
    (unpublished?.newQuizIds.length ?? 0);

  return (
    /*
      Everything inside this editor can be locked by somebody else working in the
      same course, so the provider wraps the whole of it: the structure pane
      locks modules, the quiz editor locks questions, and neither has to be told
      about the other.
    */
    <EditLocksProvider courseId={course.id}>
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
              )}
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-3">
            {/* The step before publishing on a directed course, and so the button
              immediately before it. Offered only on a lesson, because a quiz set
              has no path through it to direct. */}
            {mode === 'lesson' && (
              <Button
                onClick={stage}
                disabled={staging}
                variant="outline"
                className="gap-2 bg-white text-dark-gray hover:bg-light-gray"
              >
                <MapIcon className="w-5 h-5" />
                {staging ? 'Staging...' : 'Stage course to mapping'}
              </Button>
            )}

            {/* Publishing a first version and publishing an update are the same
              action, but they read very differently to an author, so the button
              says which one it is about to do. */}
            {!course.published || (course.publishedVersion ?? 0) < 1 ? (
              <Button
                onClick={requestPublish}
                disabled={publishing}
                className="gap-2 bg-navy text-white hover:bg-navy-hover"
              >
                <CloudArrowUpIcon className="w-5 h-5" />
                {publishing ? 'Publishing...' : 'Publish'}
              </Button>
            ) : (
              <>
                <Button
                  onClick={requestPublish}
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
              onClick={() =>
                setPendingDelete({ kind: 'course', id: course.id, label: course.title })
              }
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

        <div
          className={`grid gap-6 ${
            sidebarCollapsed
              ? 'md:grid-cols-[3.25rem_minmax(0,1fr)]'
              : 'md:grid-cols-[14rem_minmax(0,1fr)]'
            }`}
        >
          {/* ---- Module sidebar ---- */}
          <nav className="h-fit md:sticky md:top-20">
            <button
              onClick={toggleSidebar}
              aria-expanded={!sidebarCollapsed}
              aria-label={sidebarCollapsed ? 'Expand menu' : 'Collapse menu'}
              title={sidebarCollapsed ? 'Expand menu' : 'Collapse menu'}
              className={`mb-1 hidden w-full items-center rounded-lg py-2 text-dark-gray
                transition-colors hover:bg-light-gray md:flex
                ${sidebarCollapsed ? 'justify-center px-0' : 'justify-end px-4'}`}
            >
              {sidebarCollapsed ? (
                <ChevronDoubleRightIcon className="w-5 h-5" />
              ) : (
                <ChevronDoubleLeftIcon className="w-5 h-5" />
              )}
            </button>
            <ul className="flex flex-col gap-1">
              {panesFor(mode).map(({ key, label, Icon }) => (
                <li key={key}>
                  <button
                    onClick={() => setPane(key)}
                    aria-current={pane === key ? 'page' : undefined}
                    aria-label={label}
                    title={sidebarCollapsed ? label : undefined}
                    className={`flex w-full items-center gap-3 rounded-lg py-3 text-left text-sm
                    font-medium transition-colors
                    ${sidebarCollapsed ? 'px-4 md:justify-center md:px-0' : 'px-4'}
                    ${pane === key ? 'bg-navy text-white' : 'text-dark-gray hover:bg-light-gray'}`}
                  >
                    <Icon className="w-5 h-5 shrink-0" />
                    <span className={sidebarCollapsed ? 'md:sr-only' : undefined}>{label}</span>
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
            {pane === 'mapping' && mode === 'lesson' && (
              <CourseMapPane course={course} onNotify={notify} onRefresh={fetchCourse} />
            )}

            {pane === 'access' && (
              <CourseAccess course={course} canManageAuthors mode={mode} onNotify={notify} />
            )}

            {pane === 'versions' && (
              <Card className="bg-light-gray shadow-sm">
                <CardContent className="p-4">
                  <ArchivePane
                    versions={publication?.versions ?? []}
                    busy={versionBusy}
                    onAsk={setPendingVersion}
                    onNotify={notify}
                    onRefresh={fetchPublication}
                  />
                </CardContent>
              </Card>
            )}

            {/* Previews render the real learner pages, so they cannot drift from
              what is actually shipped. */}
            {pane === 'preview-landing' && (
              <>
                <PreviewBanner />
                <CourseLanding previewCourse={course} preview />
              </>
            )}

            {pane === 'preview-content' && (
              <>
                <PreviewBanner />
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
                Publish version <span className="font-semibold">{pendingVersion.version}</span>{' '}
                again? Learners will start reading it immediately.
                <br />
                It goes out under a new version number, so the one it replaces is archived rather
                than lost and you can come back to it. Your unpublished edits are left alone.
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

        {/* Asked once per quiz, on the publish that first sends it out. The kind
            is what decides how a learner can be given the quiz, and publishing
            fixes it for good, so it is read back here while it can still be
            changed. */}
        <ConfirmDialog
          open={confirmingTypeLock}
          title="Check the quiz type"
          message={
            <>
              <p>
                Publishing locks the type of{' '}
                {pendingTypeLock.length === 1 ? 'this quiz' : 'these quizzes'}. It cannot be changed
                afterwards.
              </p>
              <ul className="mt-3 max-h-48 space-y-1 overflow-y-auto text-sm">
                {pendingTypeLock.map((quiz) => (
                  <li key={quiz.id} className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-semibold">{quiz.title}</span>
                    <span>— {QUIZ_TYPE_LABELS[quiz.type]}</span>
                  </li>
                ))}
              </ul>
            </>
          }
          confirmLabel="Publish"
          cancelLabel="Go back"
          tone="ask"
          onConfirm={publish}
          onCancel={() => setConfirmingTypeLock(false)}
        />

        <ToastNotification
          show={toast.show}
          message={toast.message}
          type={toast.type}
          onClose={() => setToast((prev) => ({ ...prev, show: false }))}
        />
      </div>
    </EditLocksProvider>
  );
};

export default CourseEditor;
