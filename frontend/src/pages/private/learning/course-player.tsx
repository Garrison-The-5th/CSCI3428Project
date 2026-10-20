/**
 * File: course-player.tsx
 * Description: Working through a course.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-09-25
 */
/**
 * CoursePlayer - working through a course.
 *
 * Left  : the selected item (video, article, image, PDF or quiz), then tabs for
 *         Learning tools and Notes, then the course title, last-updated date and
 *         description.
 * Right : a scrollable course-content rail of modules, sections and their items.
 *
 * Opening an item records it, which is what marks its section complete and — on a
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
  PresentationChartBarIcon,
  QuestionMarkCircleIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

import ElementView, { plainPreview } from '@/components/common/element-view';
import { NewBadge, newMarkers } from '@/components/common/new-badge';
import QuizRunner from '@/components/common/quiz-runner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { courseMapApi, type DirectedPreview } from '@/services/course-map-api';
import { NO_PROGRESS, shutLayerQuizIds as layerQuizzesStillShut } from '@/services/course-progress';
import {
  Course,
  CourseSection,
  moduleGroups,
  moduleTint,
  NewIds,
  Note,
  sectionContent,
  SectionElement,
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
  | { kind: 'element'; sectionId: string; element: SectionElement }
  | { kind: 'quiz'; sectionId: string; quiz: Quiz }
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
  const [searchParams] = useSearchParams();

  const [fetched, setFetched] = useState<Course | null>(null);
  const [newIds, setNewIds] = useState<NewIds | null>(null);
  /**
   * The preview of a mapped course, and the answers it is drawn for.
   *
   * A directed course is not the course in the editor: the editor holds every
   * section an author has written, and the map decides which of them a given
   * learner is ever shown, in what order, behind which quizzes. Previewing the
   * editor's version of it therefore previewed a course nobody will ever be
   * given — every branch at once, in module order, with the layer quizzes
   * sitting among them doing nothing.
   *
   * So the preview asks the server for the same projection a learner gets, and
   * re-asks it whenever the author answers a layer quiz. The answers live here
   * and are never stored: an author walking their own branches must not end up
   * with a learning path recorded against them.
   */
  const [previewChoices, setPreviewChoices] = useState<Record<number, string[]>>({});
  const [directedPreview, setDirectedPreview] = useState<DirectedPreview | null>(null);
  /*
    The projected course wins where there is one, with its locks folded onto it.

    Folded here rather than kept beside it because that is the shape the rest of
    this file already reads — the learner endpoint hands back one course carrying
    `directedLocks`, and the gating below asks the course rather than asking
    where the course came from. Everything downstream — the rail, the arrows, the
    unlocking, the progress ticks — then reads an ordinary course and never
    learns a map was involved, which is the same trick the learner path uses.
  */
  const course = useMemo(
    () =>
      directedPreview
        ? { ...directedPreview.course, directedLocks: directedPreview.locks }
        : (previewCourse ?? fetched),
    [directedPreview, previewCourse, fetched],
  );
  const [loading, setLoading] = useState(!previewCourse);
  const [selection, setSelection] = useState<Selection>(null);
  const [viewedSectionIds, setViewedSectionIds] = useState<Set<string>>(new Set());
  const [viewedElementIds, setViewedElementIds] = useState<Set<string>>(new Set());
  const [attemptedQuizIds, setAttemptedQuizIds] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<'tools' | 'notes'>('tools');
  const [notes, setNotes] = useState<Note[]>([]);
  const [noteDraft, setNoteDraft] = useState('');
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingBody, setEditingBody] = useState('');
  /** Modules the learner has folded away. Expanded is the default. */
  const [collapsedModuleIds, setCollapsedModuleIds] = useState<Set<string>>(new Set());
  /** Sections the learner has folded down to their heading. Expanded is the default. */
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

  /**
   * Re-reads the projection whenever the author's answers change.
   *
   * Only for a mapped course in the preview: everything else here is either a
   * real learner, who is served the projection by the ordinary course endpoint,
   * or an unmapped course, which has no branches to walk.
   */
  useEffect(() => {
    if (!preview || !previewCourse?.directedLearning) return;

    let cancelled = false;
    courseMapApi
      .directedPreview(previewCourse.id, previewChoices)
      .then((result) => !cancelled && setDirectedPreview(result))
      .catch((err) => logger.error('Could not preview the course map:', err));

    return () => {
      cancelled = true;
    };
  }, [preview, previewCourse?.id, previewCourse?.directedLearning, previewChoices]);

  /**
   * Records a layer quiz answered in the preview.
   *
   * Nothing is submitted in a preview, so the translation the server normally
   * does at submission — ticked options to chosen branches — is done here from
   * the map the projection came with. The answers replace rather than add to
   * what was there for that layer, exactly as a real submission does, so
   * unticking a branch in the preview drops it just as it would for a learner.
   */
  const recordPreviewChoice = useCallback(
    (quizId: string, chosenOptionIds: string[]) => {
      const map = directedPreview;
      if (!map) return;

      const depth = map.quizDepths.find((entry) => entry.quizId === quizId)?.depth;
      if (depth === undefined) return;

      const chosen = new Set(chosenOptionIds);
      const nodeIds = [
        ...new Set(
          map.optionNodes
            .filter((entry) => chosen.has(entry.optionId))
            .map((entry) => entry.nodeId),
        ),
      ];

      setPreviewChoices((current) => ({ ...current, [depth]: nodeIds }));
    },
    [directedPreview],
  );

  /** Real stored progress — ticks and unlocking must survive a page reload. */
  const fetchProgress = useCallback(async () => {
    if (preview) return;
    try {
      const progress = await api.getProgress();
      setViewedSectionIds(new Set(progress.viewedSectionIds));
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
   * Every item in the course flattened into reading order: each section's elements
   * followed by its quizzes. Drives the opening selection, the prev/next arrows,
   * and — on a sequential course — what is unlocked.
   */
  const flatItems = useMemo<Array<NonNullable<Selection>>>(() => {
    if (!course) return [];
    return course.sections.flatMap((section) =>
      // sectionContent interleaves elements and quizzes by their shared order, so
      // a quiz placed mid-section is reached in the right place.
      sectionContent(section).map((item) =>
        item.kind === 'element'
          ? ({ kind: 'element', sectionId: section.id, element: item.element } as const)
          : ({ kind: 'quiz', sectionId: section.id, quiz: item.quiz } as const),
      ),
    );
  }, [course]);

  const idOf = (item: NonNullable<Selection>) =>
    item.kind === 'element' ? item.element.id : item.quiz.id;

  /**
   * Sections that predate per-element tracking.
   *
   * Progress used to be recorded only per section, so an old account has sections
   * marked viewed with no element rows behind them. Reading that as "nothing in
   * this section has been seen" would re-lock courses people had already worked
   * through. A viewed section with no element views at all is therefore treated
   * as fully seen; the moment any element view lands for it — which the first
   * click does — the fine-grained rule takes over.
   */
  const legacySectionIds = useMemo(() => {
    if (!course) return new Set<string>();
    const legacy = new Set<string>();
    for (const section of course.sections) {
      if (!viewedSectionIds.has(section.id)) continue;
      const seenAny = section.elements.some((element) => viewedElementIds.has(element.id));
      if (!seenAny) legacy.add(section.id);
    }
    return legacy;
  }, [course, viewedSectionIds, viewedElementIds]);

  /** Whether one item counts as done, which is what opens the next one. */
  const itemDone = useCallback(
    (item: NonNullable<Selection>) =>
      item.kind === 'quiz'
        ? attemptedQuizIds.has(item.quiz.id)
        : viewedElementIds.has(item.element.id) || legacySectionIds.has(item.sectionId),
    [attemptedQuizIds, viewedElementIds, legacySectionIds],
  );

  /**
   * Layer quizzes still waiting on the content above them.
   *
   * A layer quiz is the end of its layer — read what everyone at this level
   * reads, then say what applies to you next — so it stays shut until that
   * content has been seen. The server names the sections it waits on rather than
   * sending a rule, so this only has to ask a question the player could already
   * answer.
   *
   * The rule itself lives in course-progress.ts, because the landing page has to
   * shut exactly the same doors — it did not for a while, and offered a link
   * into a quiz this player then refused to open.
   */
  const shutLayerQuizIds = useMemo(
    () =>
      course
        ? layerQuizzesStillShut(course, { ...NO_PROGRESS, viewedSectionIds: [...viewedSectionIds] })
        : new Set<string>(),
    [course, viewedSectionIds],
  );

  /**
   * On a sequential course, items open one at a time: the first is always
   * available and every other waits for the one before it. Sections and modules
   * fall out of the same rule rather than being locked separately — a section is
   * locked when none of its items are reachable, and a module when none of its
   * sections are.
   *
   * Non-sequential courses lock nothing — except a layer quiz, which is not a
   * matter of pace. Both passes end by shutting those, so everything downstream
   * of this set agrees about what is reachable.
   */
  const unlockedItemIds = useMemo(() => {
    const unlocked = new Set<string>();
    if (!course) return unlocked;

    const shutLayers = (ids: Set<string>) => {
      for (const item of flatItems) {
        if (item.kind === 'quiz' && shutLayerQuizIds.has(item.quiz.id)) ids.delete(idOf(item));
      }
      return ids;
    };

    if (!course.sequential) {
      for (const item of flatItems) unlocked.add(idOf(item));
      return shutLayers(unlocked);
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

    return shutLayers(unlocked);
  }, [course, flatItems, itemDone, shutLayerQuizIds]);

  const isUnlocked = (item: NonNullable<Selection>) => unlockedItemIds.has(idOf(item));

  /**
   * A section is reachable when any of its items is.
   *
   * The pace setting is checked second rather than first, because a layer quiz's
   * section can be shut on a course that is not sequential at all — the branch
   * point is part of how the course is built, not a preference about how fast to
   * go through it.
   */
  const sectionUnlocked = useCallback(
    (sectionId: string) => {
      const items = flatItems.filter((item) => item.sectionId === sectionId);
      // A section with no content at all cannot block anything.
      if (items.length === 0) return true;
      if (items.some((item) => unlockedItemIds.has(idOf(item)))) return true;
      return (
        !course?.sequential &&
        !items.some((item) => item.kind === 'quiz' && shutLayerQuizIds.has(item.quiz.id))
      );
    },
    [course, flatItems, unlockedItemIds, shutLayerQuizIds],
  );

  /** Opening anything inside a section counts that section as seen. */
  const markViewed = useCallback(
    async (item: NonNullable<Selection>) => {
      setViewedSectionIds((prev) => new Set(prev).add(item.sectionId));
      if (item.kind === 'element') {
        if (viewedElementIds.has(item.element.id)) return;
        setViewedElementIds((prev) => new Set(prev).add(item.element.id));
      }

      // Ticks still appear while previewing, but an author browsing their own
      // draft should not accrue completion against their account.
      if (preview) return;

      try {
        // The element endpoint credits the section too, so a quiz — which has no
        // element to record — is the only case that needs the section call.
        if (item.kind === 'element') await api.recordElementView(item.element.id);
        else await api.recordSectionView(item.sectionId);
      } catch (err) {
        logger.error('Failed to record progress:', err);
      }
    },

    [viewedElementIds, preview],
  );

  /**
   * What opens on arrival.
   *
   * `?item=` is how the course page's shortcuts say where to land; without one,
   * the course opens at the top as it always has. The id is checked against what
   * is actually unlocked rather than trusted, so an old or shared link into
   * locked content falls back to the beginning instead of stepping over the
   * sequence — the landing page already refuses to offer such a link, and this is
   * the same rule enforced where it matters.
   *
   * Recorded on open like any other item, because the learner is now reading it.
   */
  useEffect(() => {
    if (selection || flatItems.length === 0) return;

    const wanted = searchParams.get('item');
    const requested = wanted ? flatItems.find((item) => idOf(item) === wanted) : undefined;
    const target = requested && unlockedItemIds.has(idOf(requested)) ? requested : flatItems[0];

    setSelection(target);
    markViewed(target);
  }, [flatItems, selection, markViewed, searchParams, unlockedItemIds]);

  const pick = useCallback(
    (next: NonNullable<Selection>, force = false) => {
      if (!force && !unlockedItemIds.has(idOf(next))) return;
      setSelection(next);
      markViewed(next);
      // Jumping into a folded module should show where you landed.
      setCollapsedModuleIds((prev) => {
        if (prev.size === 0) return prev;
        const moduleId = course?.sections.find((m) => m.id === next.sectionId)?.moduleId;
        if (!moduleId || !prev.has(moduleId)) return prev;
        const open = new Set(prev);
        open.delete(moduleId);
        return open;
      });
      setCollapsedSectionIds((prev) => {
        if (!prev.has(next.sectionId)) return prev;
        const open = new Set(prev);
        open.delete(next.sectionId);
        return open;
      });
    },
    [unlockedItemIds, markViewed, course],
  );

  /**
   * A section counts as finished when it has been opened and every quiz in it has
   * been attempted — the same rule the dashboard uses.
   */
  const sectionFinished = (section: CourseSection) =>
    viewedSectionIds.has(section.id) &&
    section.quizzes.every((quiz) => attemptedQuizIds.has(quiz.id));

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
   * Moves on from a quiz that has just been handed in.
   *
   * Forced past the lock deliberately. Submitting is exactly what unlocks the
   * next item, but the attempt has only just been recorded and `unlockedItemIds`
   * is derived state — reading it here would see the world as it was a moment
   * before the submission and refuse to move. The quiz being finished is the
   * fact; the recomputed lock catches up on the next render.
   */
  const advanceAfterQuiz = useCallback(() => {
    const next = flatItems[currentIndex + 1];
    if (next) pick(next, true);
  }, [flatItems, currentIndex, pick]);

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
   * A note's title is the section it was written on, as "2.3 Working at height".
   * Notes taken before sections were tracked, or on a section since deleted, still
   * need something to sit under rather than appearing untitled.
   */
  const sectionTitle = (sectionId: string | null): string => {
    if (!sectionId) return 'General note';
    const section = course?.sections.find((candidate) => candidate.id === sectionId);
    return section ? `${section.number} ${section.title}` : 'Removed section';
  };

  const saveNote = async () => {
    if (!noteDraft.trim()) return;

    // In preview the author can try the notes tab, but nothing is persisted.
    if (preview) {
      setNotes((prev) => [
        {
          id: `preview-${Date.now()}`,
          courseId: course?.id ?? '',
          sectionId: selection?.sectionId ?? null,
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
      await api.createNote(courseId, noteDraft.trim(), selection?.sectionId ?? null);
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

  /**
   * A course past its deadline shows nothing here.
   *
   * The landing page closes every way in, but a bookmark or a pasted URL is not
   * a way in it controls — so the player refuses on its own account rather than
   * trusting that nobody arrived by the back door. `locked` is the server's
   * answer; an author previewing their own course has no deadline to be past.
   */
  if (!preview && course.locked === true) {
    const dueOn = course.dueDate ? new Date(course.dueDate).toLocaleDateString() : null;

    return (
      <div className="page-container flex flex-col">
        <Button
          onClick={() => navigate(`/learning/${course.id}`)}
          variant="ghost"
          className="w-fit px-0"
        >
          ← Back to {course.title}
        </Button>
        <Card className="bg-light-gray">
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <LockClosedIcon className="w-10 h-10 text-dark-gray/50" aria-hidden="true" />
            <p className="font-semibold text-dark-gray">This course has closed.</p>
            <p className="max-w-prose text-dark-gray">
              {dueOn ? `The deadline passed on ${dueOn}.` : 'The deadline has passed.'} Ask whoever
              assigned it to you if you still need to work through it.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const itemIcon = (element: SectionElement) =>
    element.type === 'YOUTUBE' ? (
      <PlayCircleIcon className="w-4 h-4 shrink-0" />
    ) : element.type === 'IMAGE' ? (
      <PhotoIcon className="w-4 h-4 shrink-0" />
    ) : element.type === 'CANVAS' ? (
      <PresentationChartBarIcon className="w-4 h-4 shrink-0" />
    ) : (
      <DocumentTextIcon className="w-4 h-4 shrink-0" />
    );

  /** One-line label for the rail. Lesson text is markup, so its tags come out. */
  const itemLabel = (element: SectionElement) =>
    element.type === 'TEXT'
      ? plainPreview(element.textContent ?? 'Article', 45) || 'Article'
      : element.type === 'YOUTUBE'
        ? 'Video'
        : element.type === 'CANVAS'
          ? 'Slide'
          : plainPreview(element.fileName ?? element.type, 45);

  /** Tooltip for the prev/next buttons, so you know where they take you. */
  const navLabel = (item: NonNullable<Selection>) =>
    item.kind === 'quiz' ? item.quiz.title : itemLabel(item.element);

  const isSelected = (id: string) =>
    (selection?.kind === 'element' && selection.element.id === id) ||
    (selection?.kind === 'quiz' && selection.quiz.id === id);

  const groups = moduleGroups(course);
  // What arrived in the version this learner is reading. The helper applies the
  // roll-up rule, so a wholly new module is marked once rather than everywhere.
  const isNew = newMarkers(newIds);

  const toggleModule = (moduleId: string) =>
    setCollapsedModuleIds((prev) => {
      const next = new Set(prev);
      if (next.has(moduleId)) next.delete(moduleId);
      else next.add(moduleId);
      return next;
    });

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
                // The quiz owns the whole stage, title and all. An exam opens on
                // its details behind a Start button and becomes its questions
                // from there, without the player having to know which of the two
                // is on screen — see quiz-runner.
                <div className="min-h-0 flex-1 overflow-y-auto">
                  <QuizRunner
                    key={selection.quiz.id}
                    quiz={selection.quiz}
                    // Nothing is handed in while previewing: no run is opened, no
                    // attempt recorded, and a one-time link is not used up by the
                    // author checking it. See quiz-runner.
                    preview={preview}
                    /*
                      Given only for a layer quiz, and that is what decides
                      whether Complete quiz works in the preview at all.

                      An ordinary quiz has nothing left to mean with nothing
                      submitted, so its button sits disabled and says why. A
                      layer quiz does: its answer is a statement about which
                      branches to show, which is exactly what the author is here
                      to try, so it is applied to the projection instead of to
                      the database.
                    */
                    onPreviewSubmit={
                      selection.quiz.type === 'DIRECTED'
                        ? (chosenOptionIds) => {
                            setAttemptedQuizIds((prev) => new Set(prev).add(selection.quiz.id));
                            recordPreviewChoice(selection.quiz.id, chosenOptionIds);
                          }
                        : undefined
                    }
                    onCompleted={() => {
                      setAttemptedQuizIds((prev) => new Set(prev).add(selection.quiz.id));
                      fetchProgress();
                      // Answering a layer quiz *is* a change to the course: the
                      // branches they ticked are added and the ones they dropped
                      // go, so the course is read again rather than patched.
                      if (selection.quiz.type === 'DIRECTED') fetchCourse();
                    }}
                    // With results on this is the Next button under the ring;
                    // with them off the runner calls it the moment the paper is
                    // handed in, so the learner never sees a score.
                    onFinished={advanceAfterQuiz}
                    finishLabel={currentIndex < flatItems.length - 1 ? 'Next' : 'Finish'}
                  />
                </div>
              ) : (
                <div className="min-h-0 flex-1">
                  <ElementView element={selection.element} fill />
                </div>
              )}
            </CardContent>
          </Card>

          {/* Step through the course without touching the rail. Runs past the end
              of a section straight into the next one, and answers to the arrow keys. */}
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
                        {selection ? sectionTitle(selection.sectionId) : 'this course'}
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
                                {sectionTitle(note.sectionId)}
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
                {course.modules.length} module{course.modules.length === 1 ? '' : 's'} ·{' '}
                {course.sections.length} section{course.sections.length === 1 ? '' : 's'}
              </p>
            </div>

            <div className="max-h-[70vh] overflow-y-auto p-2">
              {groups.map((group) => {
                // A module opens once anything inside it does. On a sequential
                // course that means the module before it has been worked
                // through, which is the rule stated in terms the rail can draw.
                const moduleUnlocked = group.sections.some((section) =>
                  sectionUnlocked(section.id),
                );
                const collapsed = collapsedModuleIds.has(group.module.id) || !moduleUnlocked;
                const tint = moduleTint(group.module.color);

                return (
                  <div key={group.module.id} className="mb-3">
                    <button
                      onClick={() => moduleUnlocked && toggleModule(group.module.id)}
                      disabled={!moduleUnlocked}
                      aria-expanded={!collapsed}
                      title={
                        moduleUnlocked ? undefined : 'Finish the previous module to open this one'
                      }
                      className={`flex w-full items-center gap-2 rounded-md border-l-4 px-2 py-2
                      text-left transition-colors ${
                        moduleUnlocked ? 'cursor-pointer' : 'cursor-not-allowed text-dark-gray/50'
                      }
                      ${group.module.color ? '' : 'border-l-navy/30 bg-navy/5'}`}
                      style={tint}
                    >
                      {moduleUnlocked ? (
                        <ChevronDownIcon
                          className={`w-4 h-4 shrink-0 text-dark-gray transition-transform
                            duration-200 ${collapsed ? '-rotate-90' : ''}`}
                        />
                      ) : (
                        <LockClosedIcon className="w-4 h-4 shrink-0" />
                      )}
                      <span
                        className={`min-w-0 flex-1 text-xs font-bold uppercase tracking-wide
                        ${moduleUnlocked ? 'text-dark-gray' : 'text-dark-gray/50'}`}
                      >
                        {group.module.number}. {group.module.title}
                      </span>
                      {isNew.module(group.module.id) && <NewBadge />}
                    </button>

                    {!collapsed &&
                      group.sections.map((section: CourseSection) => {
                        const unlocked = sectionUnlocked(section.id);
                        const sectionCollapsed = collapsedSectionIds.has(section.id);

                        return (
                          <section key={section.id} className="mb-2">
                            <h3>
                              <button
                                type="button"
                                onClick={() => toggleSection(section.id)}
                                aria-expanded={!sectionCollapsed}
                                aria-controls={`section-items-${section.id}`}
                                className="flex w-full cursor-pointer items-center gap-2 rounded-md
                                  px-2 py-2 text-left hover:bg-white/60"
                              >
                                <ChevronDownIcon
                                  className={`w-4 h-4 shrink-0 text-dark-gray transition-transform
                                  duration-200 ${sectionCollapsed ? '-rotate-90' : ''}`}
                                />
                                {!unlocked ? (
                                  <LockClosedIcon className="w-4 h-4 shrink-0 text-dark-gray" />
                                ) : (
                                  sectionFinished(section) && (
                                    <CheckCircleIcon className="w-4 h-4 shrink-0 text-green" />
                                  )
                                )}
                                <span
                                  className={`min-w-0 flex-1 text-sm font-semibold
                                  ${unlocked ? 'text-dark-gray' : 'text-dark-gray/50'}`}
                                >
                                  {section.number} {section.title}
                                </span>
                                {isNew.section(section.id, section.moduleId) && <NewBadge />}
                              </button>
                            </h3>

                            <ul
                              id={`section-items-${section.id}`}
                              hidden={sectionCollapsed}
                              className="flex flex-col"
                            >
                              {sectionContent(section).map((item) => {
                                const asSelection: NonNullable<Selection> =
                                  item.kind === 'element'
                                    ? {
                                        kind: 'element',
                                        sectionId: section.id,
                                        element: item.element,
                                      }
                                    : { kind: 'quiz', sectionId: section.id, quiz: item.quiz };
                                const itemUnlocked = isUnlocked(asSelection);

                                return (
                                  <li key={item.id}>
                                    <button
                                      disabled={!itemUnlocked}
                                      title={
                                        itemUnlocked
                                          ? undefined
                                          : item.kind === 'quiz' &&
                                              shutLayerQuizIds.has(item.quiz.id)
                                            ? 'Work through this layer’s training first'
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
                                      {isNew.item(item.id, section.id, section.moduleId) ? (
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

                              {sectionContent(section).length === 0 && (
                                <li className="px-3 py-2 text-sm text-dark-gray">Empty</li>
                              )}
                            </ul>
                          </section>
                        );
                      })}

                    {!collapsed && group.sections.length === 0 && (
                      <p className="px-3 py-2 text-sm text-dark-gray">Empty module</p>
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
