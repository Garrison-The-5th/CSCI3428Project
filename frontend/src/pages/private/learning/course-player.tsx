/**
 * File: course-player.tsx
 * Description: Working through a course.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
/**
 * CoursePlayer - working through a course.
 *
 * Left  : the selected item (video, article, image, PDF or quiz), then tabs for
 *         Learning tools and Notes, then the course title, last-updated date and
 *         description.
 * Right : a scrollable course-content rail of sections, modules and their items.
 *
 * Opening an item records it, which is what marks its module complete and — on a
 * sequential course — unlocks whatever comes next. The left and right arrow keys
 * step through the course, so a whole lesson can be read without the mouse.
 */
import {
  ArrowLeftIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DocumentTextIcon,
  LockClosedIcon,
  PencilSquareIcon,
  PhotoIcon,
  PlayCircleIcon,
  QuestionMarkCircleIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import ElementView, { plainPreview } from '@/components/common/element-view';
import { NewBadge, newMarkers } from '@/components/common/new-badge';
import QuizRunner from '@/components/common/quiz-runner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import {
  Course,
  CourseModule,
  moduleContent,
  ModuleElement,
  NewIds,
  Note,
  sectionGroups,
  sectionTint,
} from '@/services/curriculum-api';
import { useLearnerApi } from '@/services/learner-api';
import { Quiz } from '@/services/quiz-api';
import { logger } from '@/utils/logger';

/**
 * Every item plays in a stage of this fixed height, so moving between a paragraph,
 * an image, a video and a quiz never resizes the page. Deliberately shorter than
 * the viewport to leave the tabs underneath — Learning tools and Notes — on screen
 * without scrolling. This is the knob: raise it and the tabs drop off the bottom.
 */
const STAGE_HEIGHT = 'h-[58vh] min-h-80';

/** Whatever is showing in the left pane. */
type Selection =
  | { kind: 'element'; moduleId: string; element: ModuleElement }
  | { kind: 'quiz'; moduleId: string; quiz: Quiz }
  | null;

interface CoursePlayerProps {
  /** Renders this course instead of fetching, for the authoring preview. */
  previewCourse?: Course;
  /** Preview drops the back link and keeps notes in memory only. */
  preview?: boolean;
}

/** True while the user is typing, so the arrow keys stay theirs. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
    // A quiz radio or a button: arrow keys mean something there already.
    target.closest('[role="radiogroup"]') !== null
  );
}

const CoursePlayer = ({ previewCourse, preview = false }: CoursePlayerProps) => {
  const api = useLearnerApi();
  const { courseId } = useParams<{ courseId: string }>();
  const navigate = useNavigate();

  const [fetched, setFetched] = useState<Course | null>(null);
  const [newIds, setNewIds] = useState<NewIds | null>(null);
  const course = previewCourse ?? fetched;
  const [loading, setLoading] = useState(!previewCourse);
  const [selection, setSelection] = useState<Selection>(null);
  const [viewedModuleIds, setViewedModuleIds] = useState<Set<string>>(new Set());
  const [viewedElementIds, setViewedElementIds] = useState<Set<string>>(new Set());
  const [attemptedQuizIds, setAttemptedQuizIds] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<'tools' | 'notes'>('tools');
  const [notes, setNotes] = useState<Note[]>([]);
  const [noteDraft, setNoteDraft] = useState('');
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingBody, setEditingBody] = useState('');
  /** Sections the learner has folded away. Expanded is the default. */
  const [collapsedSectionIds, setCollapsedSectionIds] = useState<Set<string>>(new Set());

  const fetchCourse = useCallback(async () => {
    if (previewCourse || !courseId) return;
    try {
      setLoading(true);
      // One call for both kinds of visitor: a link holder can have been part
      // way through when a new version went live just as a member can.
      const withNew = await api.getCourseWithNewIds(courseId);
      setFetched(withNew?.course ?? null);
      setNewIds(withNew?.newIds ?? null);
    } catch (err) {
      logger.error('Error loading course:', err);
    } finally {
      setLoading(false);
    }
  }, [courseId]);

  /** Real stored progress — ticks and unlocking must survive a page reload. */
  const fetchProgress = useCallback(async () => {
    if (preview) return;
    try {
      const progress = await api.getProgress();
      setViewedModuleIds(new Set(progress.viewedModuleIds));
      setViewedElementIds(new Set(progress.viewedElementIds ?? []));
      setAttemptedQuizIds(new Set(progress.attemptedQuizIds));
    } catch (err) {
      logger.error('Error loading progress:', err);
    }
  }, [preview]);

  const fetchNotes = useCallback(async () => {
    // Preview notes never leave the browser, so there is nothing to load.
    if (preview || !courseId) return;
    try {
      setNotes(await api.getNotes(courseId));
    } catch (err) {
      logger.error('Error loading notes:', err);
    }
  }, [courseId]);

  useEffect(() => {
    fetchCourse();
    fetchNotes();
    fetchProgress();
    // fetchProgress is stable per api instance; re-running on every render would loop.
  }, [fetchCourse, fetchNotes]);

  /**
   * Every item in the course flattened into reading order: each module's elements
   * followed by its quizzes. Drives the opening selection, the prev/next arrows,
   * and — on a sequential course — what is unlocked.
   */
  const flatItems = useMemo<Array<NonNullable<Selection>>>(() => {
    if (!course) return [];
    return course.modules.flatMap((module) =>
      // moduleContent interleaves elements and quizzes by their shared order, so
      // a quiz placed mid-module is reached in the right place.
      moduleContent(module).map((item) =>
        item.kind === 'element'
          ? ({ kind: 'element', moduleId: module.id, element: item.element } as const)
          : ({ kind: 'quiz', moduleId: module.id, quiz: item.quiz } as const),
      ),
    );
  }, [course]);

  const idOf = (item: NonNullable<Selection>) =>
    item.kind === 'element' ? item.element.id : item.quiz.id;

  /**
   * Modules that predate per-element tracking.
   *
   * Progress used to be recorded only per module, so an old account has modules
   * marked viewed with no element rows behind them. Reading that as "nothing in
   * this module has been seen" would re-lock courses people had already worked
   * through. A viewed module with no element views at all is therefore treated
   * as fully seen; the moment any element view lands for it — which the first
   * click does — the fine-grained rule takes over.
   */
  const legacyModuleIds = useMemo(() => {
    if (!course) return new Set<string>();
    const legacy = new Set<string>();
    for (const module of course.modules) {
      if (!viewedModuleIds.has(module.id)) continue;
      const seenAny = module.elements.some((element) => viewedElementIds.has(element.id));
      if (!seenAny) legacy.add(module.id);
    }
    return legacy;
  }, [course, viewedModuleIds, viewedElementIds]);

  /** Whether one item counts as done, which is what opens the next one. */
  const itemDone = useCallback(
    (item: NonNullable<Selection>) =>
      item.kind === 'quiz'
        ? attemptedQuizIds.has(item.quiz.id)
        : viewedElementIds.has(item.element.id) || legacyModuleIds.has(item.moduleId),
    [attemptedQuizIds, viewedElementIds, legacyModuleIds],
  );

  /**
   * On a sequential course, items open one at a time: the first is always
   * available and every other waits for the one before it. Modules and sections
   * fall out of the same rule rather than being locked separately — a module is
   * locked when none of its items are reachable, and a section when none of its
   * modules are.
   *
   * Non-sequential courses lock nothing.
   */
  const unlockedItemIds = useMemo(() => {
    const unlocked = new Set<string>();
    if (!course) return unlocked;

    if (!course.sequential) {
      for (const item of flatItems) unlocked.add(idOf(item));
      return unlocked;
    }

    for (const [index, item] of flatItems.entries()) {
      // The very first item is always viewable — otherwise a sequential course
      // could never be started.
      if (index === 0) {
        unlocked.add(idOf(item));
        continue;
      }

      const previous = flatItems[index - 1];
      if (!unlocked.has(idOf(previous)) || !itemDone(previous)) break;
      unlocked.add(idOf(item));
    }

    return unlocked;
  }, [course, flatItems, itemDone]);

  const isUnlocked = (item: NonNullable<Selection>) => unlockedItemIds.has(idOf(item));

  /** A module is reachable when any of its items is. */
  const moduleUnlocked = useCallback(
    (moduleId: string) =>
      !course?.sequential ||
      flatItems.some((item) => item.moduleId === moduleId && unlockedItemIds.has(idOf(item))) ||
      // A module with no content at all cannot block anything.
      !flatItems.some((item) => item.moduleId === moduleId),
    [course, flatItems, unlockedItemIds],
  );

  /** Opening anything inside a module counts that module as seen. */
  const markViewed = useCallback(
    async (item: NonNullable<Selection>) => {
      setViewedModuleIds((prev) => new Set(prev).add(item.moduleId));
      if (item.kind === 'element') {
        if (viewedElementIds.has(item.element.id)) return;
        setViewedElementIds((prev) => new Set(prev).add(item.element.id));
      }

      // Ticks still appear while previewing, but an author browsing their own
      // draft should not accrue completion against their account.
      if (preview) return;

      try {
        // The element endpoint credits the module too, so a quiz — which has no
        // element to record — is the only case that needs the module call.
        if (item.kind === 'element') await api.recordElementView(item.element.id);
        else await api.recordModuleView(item.moduleId);
      } catch (err) {
        logger.error('Failed to record progress:', err);
      }
    },

    [viewedElementIds, preview],
  );

  // The first item opens on its own, so record it too — otherwise the learner
  // could read it and never be credited for it.
  useEffect(() => {
    if (selection || flatItems.length === 0) return;
    setSelection(flatItems[0]);
    markViewed(flatItems[0]);
  }, [flatItems, selection, markViewed]);

  const pick = useCallback(
    (next: NonNullable<Selection>) => {
      if (!unlockedItemIds.has(idOf(next))) return;
      setSelection(next);
      markViewed(next);
      // Jumping into a folded section should show where you landed.
      setCollapsedSectionIds((prev) => {
        if (prev.size === 0) return prev;
        const sectionId = course?.modules.find((m) => m.id === next.moduleId)?.sectionId;
        if (!sectionId || !prev.has(sectionId)) return prev;
        const open = new Set(prev);
        open.delete(sectionId);
        return open;
      });
    },
    [unlockedItemIds, markViewed, course],
  );

  /**
   * A module counts as finished when it has been opened and every quiz in it has
   * been attempted — the same rule the dashboard uses.
   */
  const moduleFinished = (module: CourseModule) =>
    viewedModuleIds.has(module.id) && module.quizzes.every((quiz) => attemptedQuizIds.has(quiz.id));

  const currentIndex = selection
    ? flatItems.findIndex((item) => idOf(item) === idOf(selection))
    : -1;
  const rawPrevious = currentIndex > 0 ? flatItems[currentIndex - 1] : null;
  // Stepping back is always allowed to somewhere already unlocked, which on a
  // sequential course is everything behind you anyway.
  const previousItem = rawPrevious && isUnlocked(rawPrevious) ? rawPrevious : null;
  const rawNext =
    currentIndex >= 0 && currentIndex < flatItems.length - 1 ? flatItems[currentIndex + 1] : null;
  // Walking forward must respect the lock too, not just the rail.
  const nextItem = rawNext && isUnlocked(rawNext) ? rawNext : null;

  /**
   * Left and right arrows step through the course.
   *
   * Bound to the window rather than to a focused element so it works wherever
   * the reader's attention is, and skipped while they are typing — a note or a
   * quiz answer needs its own arrow keys far more than the rail does.
   */
  const stepRef = useRef({ previousItem, nextItem, pick });
  stepRef.current = { previousItem, nextItem, pick };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTyping(event.target)) return;

      const { previousItem: back, nextItem: forward, pick: go } = stepRef.current;
      const target = event.key === 'ArrowLeft' ? back : forward;
      if (!target) return;

      event.preventDefault();
      go(target);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // ---- Notes ----

  /**
   * A note's title is the module it was written on, as "2.3 Working at height".
   * Notes taken before modules were tracked, or on a module since deleted, still
   * need something to sit under rather than appearing untitled.
   */
  const moduleTitle = (moduleId: string | null): string => {
    if (!moduleId) return 'General note';
    const module = course?.modules.find((candidate) => candidate.id === moduleId);
    return module ? `${module.number} ${module.title}` : 'Removed module';
  };

  const saveNote = async () => {
    if (!noteDraft.trim()) return;

    // In preview the author can try the notes tab, but nothing is persisted.
    if (preview) {
      setNotes((prev) => [
        {
          id: `preview-${Date.now()}`,
          courseId: course?.id ?? '',
          moduleId: selection?.moduleId ?? null,
          body: noteDraft.trim(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        ...prev,
      ]);
      setNoteDraft('');
      return;
    }

    if (!courseId) return;
    try {
      await api.createNote(courseId, noteDraft.trim(), selection?.moduleId ?? null);
      setNoteDraft('');
      await fetchNotes();
    } catch (err) {
      logger.error('Failed to save note:', err);
    }
  };

  const startEditing = (note: Note) => {
    setEditingNoteId(note.id);
    setEditingBody(note.body);
  };

  const saveEdit = async () => {
    const id = editingNoteId;
    const body = editingBody.trim();
    if (!id || !body) return;

    if (preview) {
      setNotes((prev) =>
        prev.map((note) =>
          note.id === id ? { ...note, body, updatedAt: new Date().toISOString() } : note,
        ),
      );
      setEditingNoteId(null);
      return;
    }

    try {
      await api.updateNote(id, body);
      setEditingNoteId(null);
      await fetchNotes();
    } catch (err) {
      logger.error('Failed to update note:', err);
    }
  };

  const removeNote = async (id: string) => {
    if (editingNoteId === id) setEditingNoteId(null);
    if (preview) {
      setNotes((prev) => prev.filter((note) => note.id !== id));
      return;
    }
    try {
      await api.deleteNote(id);
      await fetchNotes();
    } catch (err) {
      logger.error('Failed to delete note:', err);
    }
  };

  if (loading) {
    return (
      <div className="page-container flex flex-col">
        <div className="text-center">Loading course...</div>
      </div>
    );
  }

  if (!course) {
    return (
      <div className="page-container flex flex-col">
        <Button onClick={() => navigate('/learning')} variant="ghost" className="w-fit px-0">
          ← All courses
        </Button>
        <Card className="bg-light-gray">
          <CardContent className="py-16 text-center">
            <p>Course not found.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const itemIcon = (element: ModuleElement) =>
    element.type === 'YOUTUBE' ? (
      <PlayCircleIcon className="w-4 h-4 shrink-0" />
    ) : element.type === 'IMAGE' ? (
      <PhotoIcon className="w-4 h-4 shrink-0" />
    ) : (
      <DocumentTextIcon className="w-4 h-4 shrink-0" />
    );

  /** One-line label for the rail. Lesson text is markup, so its tags come out. */
  const itemLabel = (element: ModuleElement) =>
    element.type === 'TEXT'
      ? plainPreview(element.textContent ?? 'Article', 45) || 'Article'
      : element.type === 'YOUTUBE'
        ? 'Video'
        : plainPreview(element.fileName ?? element.type, 45);

  /** Tooltip for the prev/next buttons, so you know where they take you. */
  const navLabel = (item: NonNullable<Selection>) =>
    item.kind === 'quiz' ? item.quiz.title : itemLabel(item.element);

  const isSelected = (id: string) =>
    (selection?.kind === 'element' && selection.element.id === id) ||
    (selection?.kind === 'quiz' && selection.quiz.id === id);

  const groups = sectionGroups(course);
  // What arrived in the version this learner is reading. The helper applies the
  // roll-up rule, so a wholly new section is marked once rather than everywhere.
  const isNew = newMarkers(newIds);

  const toggleSection = (sectionId: string) =>
    setCollapsedSectionIds((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });

  return (
    <div className={preview ? 'flex flex-col' : 'page-container flex flex-col'}>
      {!preview && (
        <Button
          onClick={() => navigate(`/learning/${course.id}`)}
          variant="ghost"
          className="mb-4 w-fit gap-2 px-0 text-dark-gray hover:text-green-hover"
        >
          <ArrowLeftIcon className="w-5 h-5" /> Course overview
        </Button>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* ---- Player ---- */}
        {/* min-w-0 lets this column shrink; without it wide content stretches the
            grid track and pushes the content rail off screen. */}
        <div className="flex min-w-0 flex-col gap-6">
          <Card className="bg-light-gray shadow-sm">
            {/* min-h-0 on the children is what lets them scroll inside the stage
                rather than stretching it — a flex item defaults to min-height:auto,
                which refuses to shrink below its content. */}
            <CardContent className={`flex flex-col p-4 ${STAGE_HEIGHT}`}>
              {selection === null ? (
                <p className="py-16 text-center text-dark-gray">This course has no content yet.</p>
              ) : selection.kind === 'quiz' ? (
                <>
                  <h2 className="mb-4 shrink-0 text-xl font-semibold text-dark-gray">
                    {selection.quiz.title}
                  </h2>
                  <div className="min-h-0 flex-1 overflow-y-auto">
                    <QuizRunner
                      quiz={selection.quiz}
                      onCompleted={() => {
                        setAttemptedQuizIds((prev) => new Set(prev).add(selection.quiz.id));
                        fetchProgress();
                      }}
                    />
                  </div>
                </>
              ) : (
                <div className="min-h-0 flex-1">
                  <ElementView element={selection.element} fill />
                </div>
              )}
            </CardContent>
          </Card>

          {/* Step through the course without touching the rail. Runs past the end
              of a module straight into the next one, and answers to the arrow keys. */}
          {flatItems.length > 1 && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Button
                onClick={() => previousItem && pick(previousItem)}
                disabled={!previousItem}
                variant="outline"
                className="gap-2 bg-white text-dark-gray hover:bg-light-gray"
                title={previousItem ? `← ${navLabel(previousItem)}` : 'You are at the start'}
              >
                <ChevronLeftIcon className="w-5 h-5" />
                <span className="hidden sm:inline">Previous</span>
              </Button>

              <p className="text-center text-sm text-dark-gray">
                {currentIndex + 1} of {flatItems.length}
                <span className="block text-xs">Use ← and → to move</span>
              </p>

              <Button
                onClick={() => nextItem && pick(nextItem)}
                disabled={!nextItem}
                className={`gap-2 ${nextItem ? 'bg-navy text-white hover:bg-navy-hover' : ''}`}
                variant={nextItem ? 'default' : 'outline'}
                title={
                  nextItem
                    ? `${navLabel(nextItem)} →`
                    : rawNext
                      ? 'Finish this item to unlock the next one'
                      : 'You have reached the end'
                }
              >
                <span className="hidden sm:inline">Next</span>
                <ChevronRightIcon className="w-5 h-5" />
              </Button>
            </div>
          )}

          {/* Tabs under the player */}
          <Card className="bg-light-gray shadow-sm">
            <div className="flex gap-1 border-b border-gray-300 px-4 pt-4">
              {(['tools', 'notes'] as const).map((key) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={`rounded-t-lg px-4 py-2 text-sm font-semibold transition-colors ${
                    tab === key ? 'bg-white text-dark-gray' : 'text-dark-gray hover:bg-white/60'
                  }`}
                  aria-selected={tab === key}
                  role="tab"
                >
                  {key === 'tools' ? 'Learning tools' : 'Notes'}
                </button>
              ))}
            </div>

            <CardContent className="p-4">
              {tab === 'tools' ? (
                <p className="py-8 text-center text-dark-gray">Learning tools will appear here.</p>
              ) : (
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-2">
                    {/* A note is filed under whatever is open, which is why the
                        box says so before it is written rather than after. */}
                    <p className="text-sm font-medium text-dark-gray">
                      New note on{' '}
                      <span className="font-semibold">
                        {selection ? moduleTitle(selection.moduleId) : 'this course'}
                      </span>
                    </p>
                    <Textarea
                      value={noteDraft}
                      onChange={(e) => setNoteDraft(e.target.value)}
                      placeholder="Write a note for yourself..."
                      rows={3}
                      className="resize-none bg-white text-dark-gray"
                    />
                    <Button
                      onClick={saveNote}
                      className="w-fit bg-navy text-white hover:bg-navy-hover"
                    >
                      Save note
                    </Button>
                  </div>

                  {notes.length === 0 ? (
                    <p className="text-dark-gray">No notes yet.</p>
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {notes.map((note) => (
                        <li
                          key={note.id}
                          className="rounded-lg border border-gray-300 bg-white px-4 py-3"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <span className="min-w-0">
                              <span className="block break-words font-semibold text-dark-gray">
                                {moduleTitle(note.moduleId)}
                              </span>
                              <span className="block text-xs text-dark-gray">
                                {new Date(note.createdAt).toLocaleString()}
                                {note.updatedAt !== note.createdAt && ' · edited'}
                              </span>
                            </span>

                            <span className="flex shrink-0 items-center gap-1">
                              <Button
                                onClick={() =>
                                  editingNoteId === note.id
                                    ? setEditingNoteId(null)
                                    : startEditing(note)
                                }
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 hover:text-green-hover"
                                title={editingNoteId === note.id ? 'Stop editing' : 'Edit note'}
                              >
                                <PencilSquareIcon className="w-4 h-4" />
                              </Button>
                              <Button
                                onClick={() => removeNote(note.id)}
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 hover:text-danger-hover"
                                title="Delete note"
                              >
                                <TrashIcon className="w-4 h-4" />
                              </Button>
                            </span>
                          </div>

                          {editingNoteId === note.id ? (
                            <div className="mt-2 flex flex-col gap-2">
                              <Textarea
                                value={editingBody}
                                onChange={(e) => setEditingBody(e.target.value)}
                                rows={4}
                                className="resize-none bg-white text-dark-gray"
                              />
                              <div className="flex gap-2">
                                <Button
                                  onClick={saveEdit}
                                  disabled={!editingBody.trim()}
                                  className="bg-navy text-white hover:bg-navy-hover"
                                >
                                  Save changes
                                </Button>
                                <Button
                                  onClick={() => setEditingNoteId(null)}
                                  variant="outline"
                                  className="bg-white text-dark-gray hover:bg-light-gray"
                                >
                                  Cancel
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <p className="mt-2 whitespace-pre-wrap break-words text-dark-gray">
                              {note.body}
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Title, last updated, description */}
          <Card className="bg-light-gray shadow-sm">
            <CardContent className="p-4">
              <h2 className="text-2xl font-bold text-dark-gray">{course.title}</h2>
              <p className="mt-1 text-sm text-dark-gray">
                Last updated {new Date(course.updatedAt).toLocaleDateString()}
              </p>
              {course.description && (
                <p className="mt-4 whitespace-pre-wrap break-words text-dark-gray">
                  {course.description}
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ---- Course content rail ---- */}
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <Card className="gap-0 bg-light-gray p-0 shadow-sm">
            <div className="border-b border-gray-300 p-4">
              <h2 className="font-semibold text-dark-gray">Course content</h2>
              <p className="text-sm text-dark-gray">
                {course.sections.length} section{course.sections.length === 1 ? '' : 's'} ·{' '}
                {course.modules.length} module{course.modules.length === 1 ? '' : 's'}
              </p>
            </div>

            <div className="max-h-[70vh] overflow-y-auto p-2">
              {groups.map((group) => {
                // A section opens once anything inside it does. On a sequential
                // course that means the section before it has been worked
                // through, which is the rule stated in terms the rail can draw.
                const sectionUnlocked = group.modules.some((module) => moduleUnlocked(module.id));
                const collapsed = collapsedSectionIds.has(group.section.id) || !sectionUnlocked;
                const tint = sectionTint(group.section.color);

                return (
                  <div key={group.section.id} className="mb-3">
                    <button
                      onClick={() => sectionUnlocked && toggleSection(group.section.id)}
                      disabled={!sectionUnlocked}
                      aria-expanded={!collapsed}
                      title={
                        sectionUnlocked ? undefined : 'Finish the previous section to open this one'
                      }
                      className={`flex w-full items-center gap-2 rounded-md border-l-4 px-2 py-2
                      text-left transition-colors ${
                        sectionUnlocked ? 'cursor-pointer' : 'cursor-not-allowed text-dark-gray/50'
                      }
                      ${group.section.color ? '' : 'border-l-navy/30 bg-navy/5'}`}
                      style={tint}
                    >
                      {sectionUnlocked ? (
                        <ChevronDownIcon
                          className={`w-4 h-4 shrink-0 text-dark-gray transition-transform
                            duration-200 ${collapsed ? '-rotate-90' : ''}`}
                        />
                      ) : (
                        <LockClosedIcon className="w-4 h-4 shrink-0" />
                      )}
                      <span
                        className={`min-w-0 flex-1 text-xs font-bold uppercase tracking-wide
                        ${sectionUnlocked ? 'text-dark-gray' : 'text-dark-gray/50'}`}
                      >
                        {group.section.number}. {group.section.title}
                      </span>
                      {isNew.section(group.section.id) && <NewBadge />}
                    </button>

                    {!collapsed &&
                      group.modules.map((module: CourseModule) => {
                        const unlocked = moduleUnlocked(module.id);

                        return (
                          <section key={module.id} className="mb-2">
                            <div className="flex items-center gap-2 px-2 py-2">
                              {!unlocked ? (
                                <LockClosedIcon className="w-4 h-4 shrink-0 text-dark-gray" />
                              ) : (
                                moduleFinished(module) && (
                                  <CheckCircleIcon className="w-4 h-4 shrink-0 text-green" />
                                )
                              )}
                              <h3
                                className={`min-w-0 flex-1 text-sm font-semibold
                                ${unlocked ? 'text-dark-gray' : 'text-dark-gray/50'}`}
                              >
                                {module.number} {module.title}
                              </h3>
                              {isNew.module(module.id, module.sectionId) && <NewBadge />}
                            </div>

                            <ul className="flex flex-col">
                              {moduleContent(module).map((item) => {
                                const asSelection: NonNullable<Selection> =
                                  item.kind === 'element'
                                    ? {
                                        kind: 'element',
                                        moduleId: module.id,
                                        element: item.element,
                                      }
                                    : { kind: 'quiz', moduleId: module.id, quiz: item.quiz };
                                const itemUnlocked = isUnlocked(asSelection);

                                return (
                                  <li key={item.id}>
                                    <button
                                      disabled={!itemUnlocked}
                                      title={
                                        itemUnlocked
                                          ? undefined
                                          : 'Finish the item before this one to unlock it'
                                      }
                                      onClick={() => pick(asSelection)}
                                      className={`flex w-full items-center gap-2 rounded-md px-3
                                      py-2 text-left text-sm ${
                                        !itemUnlocked
                                          ? 'cursor-not-allowed text-dark-gray/40'
                                          : isSelected(item.id)
                                            ? 'bg-white font-semibold text-dark-gray'
                                            : 'text-dark-gray hover:bg-white/60'
                                      }`}
                                    >
                                      {!itemUnlocked ? (
                                        <LockClosedIcon className="w-4 h-4 shrink-0" />
                                      ) : item.kind === 'quiz' ? (
                                        <QuestionMarkCircleIcon className="w-4 h-4 shrink-0" />
                                      ) : (
                                        itemIcon(item.element)
                                      )}
                                      <span className="min-w-0 flex-1 truncate">
                                        {item.kind === 'quiz'
                                          ? item.quiz.title
                                          : itemLabel(item.element)}
                                      </span>
                                      {/* New wins over the tick: something
                                          they have already seen is not news, so
                                          the two never both apply. */}
                                      {isNew.item(item.id, module.id, module.sectionId) ? (
                                        <NewBadge />
                                      ) : (
                                        itemDone(asSelection) &&
                                        itemUnlocked && (
                                          <CheckCircleIcon className="w-4 h-4 shrink-0 text-green" />
                                        )
                                      )}
                                      {item.kind === 'quiz' ? (
                                        <span className="shrink-0 text-xs">
                                          {item.quiz.questions.length}q
                                        </span>
                                      ) : item.element.durationMinutes ? (
                                        <span className="shrink-0 text-xs">
                                          {item.element.durationMinutes}m
                                        </span>
                                      ) : null}
                                    </button>
                                  </li>
                                );
                              })}

                              {moduleContent(module).length === 0 && (
                                <li className="px-3 py-2 text-sm text-dark-gray">Empty</li>
                              )}
                            </ul>
                          </section>
                        );
                      })}

                    {!collapsed && group.modules.length === 0 && (
                      <p className="px-3 py-2 text-sm text-dark-gray">Empty section</p>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
};

export default CoursePlayer;
