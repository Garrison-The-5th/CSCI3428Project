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
 * Left  : the selected section (video, article, image, PDF, canvas or quiz),
 *         then tabs for Learning tools and Notes, then the course title,
 *         last-updated date and description.
 * Right : a scrollable course-content rail of models and the sections in them.
 *
 * A course is two layers, and a section is one piece of content, so the rail
 * has one row per section and opening a row shows that section. Opening one
 * records it, which is what marks it complete and — on a sequential course —
 * unlocks whatever comes next. The left and right arrow keys
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
import { signalTour } from '@/components/tour/tour-signal';
import { PLAYER_STEP_SIGNAL } from '@/components/tour/tour-steps';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { courseMapApi, type DirectedPreview } from '@/services/course-map-api';
import {
  CourseItem,
  flattenCourse,
  idOf,
  itemDoneFor,
  sectionUnlocked as sectionIsUnlocked,
  shutLayerQuizIds as layerQuizzesStillShut,
  unlockedItemIds as unlockedIdsFor,
} from '@/services/course-progress';
import {
  Course,
  CourseSection,
  LearnerProgress,
  modelGroups,
  modelTint,
  NewIds,
  Note,
} from '@/services/curriculum-api';
import { useLearnerApi } from '@/services/learner-api';
import { logger } from '@/utils/logger';

/**
 * Every item plays in a stage of this fixed height, so moving between a paragraph,
 * an image, a video and a quiz never resizes the page. Deliberately shorter than
 * the viewport to leave the tabs underneath — Learning tools and Notes — on screen
 * without scrolling. This is the knob: raise it and the tabs drop off the bottom.
 */
const STAGE_HEIGHT = 'h-[58vh] min-h-80';

/** Whatever is showing in the left pane: one section, or nothing yet. */
type Selection = CourseItem | null;

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

/**
 * The learner's course player: the model/section rail, the selected section, Previous/Next
 * navigation, sequential unlocking and the notes tab. With `preview` it renders an author's draft,
 * and nothing it does is saved.
 */
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
   * given — every branch at once, in model order, with the layer quizzes
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
  const [attemptedQuizIds, setAttemptedQuizIds] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<'tools' | 'notes'>('tools');
  const [notes, setNotes] = useState<Note[]>([]);
  const [noteDraft, setNoteDraft] = useState('');
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingBody, setEditingBody] = useState('');
  /** Models the learner has folded away. Expanded is the default. */
  const [collapsedModelIds, setCollapsedModelIds] = useState<Set<string>>(new Set());

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
   * Every section in the course in reading order. Drives the opening selection,
   * the prev/next arrows, and — on a sequential course — what is unlocked.
   */
  const flatItems = useMemo<CourseItem[]>(() => (course ? flattenCourse(course) : []), [course]);

  /**
   * What this learner has done, in the shape the shared rules read.
   *
   * The unlocking rules live in course-progress.ts and are *called* here rather
   * than repeated: the course page and the dashboard ask the same functions, so
   * the three cannot disagree about what is locked. This only has to hand over
   * the progress it is holding, which moves as sections are opened.
   */
  const progress = useMemo<LearnerProgress>(
    () => ({
      viewedSectionIds: [...viewedSectionIds],
      attemptedQuizIds: [...attemptedQuizIds],
    }),
    [viewedSectionIds, attemptedQuizIds],
  );

  /** Whether one item counts as done, which is what opens the next one. */
  const itemDone = useMemo(
    () => (course ? itemDoneFor(course, progress) : () => false),
    [course, progress],
  );

  /**
   * Layer quizzes still waiting on the content above them — see
   * `shutLayerQuizIds` in course-progress.ts. Kept here only to word the
   * tooltip on a row that is shut for that reason rather than for pace.
   */
  const shutLayerQuizIds = useMemo(
    () => (course ? layerQuizzesStillShut(course, progress) : new Set<string>()),
    [course, progress],
  );

  /**
   * What may be opened. On a sequential course sections open one at a time;
   * otherwise everything is open except a layer quiz that is still shut.
   */
  const unlockedItemIds = useMemo(
    () => (course ? unlockedIdsFor(course, flatItems, progress) : new Set<string>()),
    [course, flatItems, progress],
  );

  /** Whether the learner may open this item yet. */
  const isUnlocked = (item: NonNullable<Selection>) => unlockedItemIds.has(idOf(item));

  /** Whether a section's row in the rail can be opened. */
  const sectionUnlocked = useCallback(
    (sectionId: string) =>
      course ? sectionIsUnlocked(course, flatItems, unlockedItemIds, sectionId) : true,
    [course, flatItems, unlockedItemIds],
  );

  /** Opening a section counts it as seen. */
  const markViewed = useCallback(
    async (item: NonNullable<Selection>) => {
      if (viewedSectionIds.has(item.sectionId)) return;
      setViewedSectionIds((prev) => new Set(prev).add(item.sectionId));

      // Ticks still appear while previewing, but an author browsing their own
      // draft should not accrue completion against their account.
      if (preview) return;

      try {
        await api.recordSectionView(item.sectionId);
      } catch (err) {
        logger.error('Failed to record progress:', err);
      }
    },

    [viewedSectionIds, preview],
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
      // Jumping into a folded model should show where you landed.
      setCollapsedModelIds((prev) => {
        if (prev.size === 0) return prev;
        const modelId = course?.sections.find((m) => m.id === next.sectionId)?.modelId;
        if (!modelId || !prev.has(modelId)) return prev;
        const open = new Set(prev);
        open.delete(modelId);
        return open;
      });
    },
    [unlockedItemIds, markViewed, course],
  );

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
    /**
     * Left/right arrow keys step to the previous/next item, unless a modifier is held or the
     * learner is typing.
     */
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTyping(event.target)) return;

      const { previousItem: back, nextItem: forward, pick: go } = stepRef.current;
      const target = event.key === 'ArrowLeft' ? back : forward;
      if (!target) return;

      event.preventDefault();
      go(target);
      signalTour(PLAYER_STEP_SIGNAL);
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

  /**
   * Saves the note being written, tied to the current section. In preview it is kept on the page
   * only.
   */
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

  /** Opens a note for editing. */
  const startEditing = (note: Note) => {
    setEditingNoteId(note.id);
    setEditingBody(note.body);
  };

  /** Saves the note being edited. In preview it changes on the page only. */
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

  /** Deletes a note. In preview it disappears from the page only. */
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

  /** The rail icon for a section's type: quiz, video, picture, canvas, or a document. */
  const itemIcon = (section: CourseSection) =>
    section.type === 'QUIZ' ? (
      <QuestionMarkCircleIcon className="w-4 h-4 shrink-0" />
    ) : section.type === 'YOUTUBE' ? (
      <PlayCircleIcon className="w-4 h-4 shrink-0" />
    ) : section.type === 'IMAGE' ? (
      <PhotoIcon className="w-4 h-4 shrink-0" />
    ) : section.type === 'CANVAS' ? (
      <PresentationChartBarIcon className="w-4 h-4 shrink-0" />
    ) : (
      <DocumentTextIcon className="w-4 h-4 shrink-0" />
    );

  /** Tooltip for the prev/next buttons, so you know where they take you. */
  const navLabel = (item: NonNullable<Selection>) =>
    `${item.section.number} ${plainPreview(item.section.title, 45)}`;

  /** Whether this section is the one open in the player. */
  const isSelected = (sectionId: string) => selection?.sectionId === sectionId;

  const groups = modelGroups(course);
  // What arrived in the version this learner is reading. The helper applies the
  // roll-up rule, so a wholly new model is marked once rather than everywhere.
  const isNew = newMarkers(newIds);

  /** Collapses or expands a model in the rail. */
  const toggleModel = (modelId: string) =>
    setCollapsedModelIds((prev) => {
      const next = new Set(prev);
      if (next.has(modelId)) next.delete(modelId);
      else next.add(modelId);
      return next;
    });

  /** A slide with something on it, which gets a stage of its own shape. See the player card. */
  const slideStage =
    selection?.kind === 'content' &&
    selection.section.type === 'CANVAS' &&
    !!selection.section.canvasData?.items?.length;

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
          {/* A slide is the one item that does not take the fixed stage: the card
              takes the slide's own 16:9 shape instead, with no padding, so the
              slide fills it edge to edge rather than sitting in a second box. */}
          <Card className={`bg-light-gray shadow-sm ${slideStage ? 'overflow-hidden' : ''}`}>
            {/* min-h-0 on the children is what lets them scroll inside the stage
                rather than stretching it — a flex item defaults to min-height:auto,
                which refuses to shrink below its content. */}
            <CardContent
              className={`flex flex-col ${slideStage ? 'aspect-video p-0' : `p-4 ${STAGE_HEIGHT}`}`}
              data-tour="player-stage"
            >
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
                  <ElementView section={selection.section} fill />
                </div>
              )}
            </CardContent>
          </Card>

          {/* Step through the course without touching the rail. Runs past the end
              of a model straight into the next one, and answers to the arrow keys. */}
          {flatItems.length > 1 && (
            <div
              className="flex flex-wrap items-center justify-between gap-3"
              data-tour={preview ? undefined : 'player-prev-next'}
            >
              <Button
                onClick={() => {
                  if (!previousItem) return;
                  pick(previousItem);
                  // The walkthrough's "try it" step waits for exactly this.
                  signalTour(PLAYER_STEP_SIGNAL);
                }}
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
                onClick={() => {
                  if (!nextItem) return;
                  pick(nextItem);
                  signalTour(PLAYER_STEP_SIGNAL);
                }}
                disabled={!nextItem}
                className={`gap-2 ${nextItem ? 'bg-navy text-white hover:bg-navy-hover' : ''}`}
                variant={nextItem ? 'default' : 'outline'}
                title={
                  nextItem
                    ? `${navLabel(nextItem)} →`
                    : rawNext
                      ? 'Finish this section to unlock the next one'
                      : 'You have reached the end'
                }
              >
                <span className="hidden sm:inline">Next</span>
                <ChevronRightIcon className="w-5 h-5" />
              </Button>
            </div>
          )}

          {/* Tabs under the player */}
          <Card className="bg-light-gray shadow-sm" data-tour="player-tabs">
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
        <aside className="lg:sticky lg:top-20 lg:self-start" data-tour="player-rail">
          <Card className="gap-0 bg-light-gray p-0 shadow-sm">
            <div className="border-b border-gray-300 p-4">
              <h2 className="font-semibold text-dark-gray">Course content</h2>
              <p className="text-sm text-dark-gray">
                {course.models.length} model{course.models.length === 1 ? '' : 's'} ·{' '}
                {course.sections.length} section{course.sections.length === 1 ? '' : 's'}
              </p>
            </div>

            <div className="max-h-[70vh] overflow-y-auto p-2">
              {groups.map((group) => {
                // A model opens once anything inside it does. On a sequential
                // course that means the model before it has been worked
                // through, which is the rule stated in terms the rail can draw.
                const modelUnlocked = group.sections.some((section) => sectionUnlocked(section.id));
                const collapsed = collapsedModelIds.has(group.model.id) || !modelUnlocked;
                const tint = modelTint(group.model.color);

                return (
                  <div key={group.model.id} className="mb-3">
                    <button
                      onClick={() => modelUnlocked && toggleModel(group.model.id)}
                      disabled={!modelUnlocked}
                      aria-expanded={!collapsed}
                      aria-controls={`model-sections-${group.model.id}`}
                      title={
                        modelUnlocked ? undefined : 'Finish the previous model to open this one'
                      }
                      className={`flex w-full items-center gap-2 rounded-md border-l-4 px-2 py-2
                      text-left transition-colors ${
                        modelUnlocked ? 'cursor-pointer' : 'cursor-not-allowed text-dark-gray/50'
                      }
                      ${group.model.color ? '' : 'border-l-navy/30 bg-navy/5'}`}
                      style={tint}
                    >
                      {modelUnlocked ? (
                        <ChevronDownIcon
                          className={`w-4 h-4 shrink-0 text-dark-gray transition-transform
                            duration-200 ${collapsed ? '-rotate-90' : ''}`}
                        />
                      ) : (
                        <LockClosedIcon className="w-4 h-4 shrink-0" />
                      )}
                      <span
                        className={`min-w-0 flex-1 text-xs font-bold uppercase tracking-wide
                        ${modelUnlocked ? 'text-dark-gray' : 'text-dark-gray/50'}`}
                      >
                        {group.model.number}. {group.model.title}
                      </span>
                      {isNew.model(group.model.id) && <NewBadge />}
                    </button>

                    {/* One row per section: a section is one piece of content,
                        so there is nothing underneath it to fold. */}
                    <ul id={`model-sections-${group.model.id}`} hidden={collapsed}>
                      {group.sections.map((section: CourseSection) => {
                        const item = flatItems.find((entry) => entry.sectionId === section.id);
                        const unlocked = sectionUnlocked(section.id) && item !== undefined;
                        const quiz = item?.kind === 'quiz' ? item.quiz : null;

                        return (
                          <li key={section.id}>
                            <button
                              type="button"
                              disabled={!unlocked}
                              title={
                                unlocked
                                  ? undefined
                                  : quiz && shutLayerQuizIds.has(quiz.id)
                                    ? 'Work through this layer’s training first'
                                    : 'Finish the section before this one to unlock it'
                              }
                              onClick={() => item && pick(item)}
                              aria-current={isSelected(section.id) ? 'true' : undefined}
                              className={`flex w-full items-center gap-2 rounded-md px-3 py-2
                              text-left text-sm ${
                                !unlocked
                                  ? 'cursor-not-allowed text-dark-gray/40'
                                  : isSelected(section.id)
                                    ? 'bg-white font-semibold text-dark-gray'
                                    : 'text-dark-gray hover:bg-white/60'
                              }`}
                            >
                              {!unlocked ? (
                                <LockClosedIcon className="w-4 h-4 shrink-0" />
                              ) : (
                                itemIcon(section)
                              )}
                              <span className="min-w-0 flex-1 break-words">
                                {section.number} {section.title}
                              </span>
                              {/* New wins over the tick: something they have
                                  already seen is not news, so the two never
                                  both apply. */}
                              {isNew.section(section.id, section.modelId) ||
                              (quiz && isNew.item(quiz.id, section.id, section.modelId)) ? (
                                <NewBadge />
                              ) : (
                                item &&
                                itemDone(item) &&
                                unlocked && (
                                  <CheckCircleIcon className="w-4 h-4 shrink-0 text-green" />
                                )
                              )}
                              {quiz ? (
                                <span className="shrink-0 text-xs">{quiz.questions.length}q</span>
                              ) : section.durationMinutes ? (
                                <span className="shrink-0 text-xs">{section.durationMinutes}m</span>
                              ) : null}
                            </button>
                          </li>
                        );
                      })}
                    </ul>

                    {!collapsed && group.sections.length === 0 && (
                      <p className="px-3 py-2 text-sm text-dark-gray">Empty model</p>
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
