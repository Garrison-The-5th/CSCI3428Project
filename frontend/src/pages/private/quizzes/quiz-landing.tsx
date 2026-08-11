/**
 * File: quiz-landing.tsx
 * Description: The start page for a course's quizzes.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
/**
 * QuizLanding — the start page for a course's quizzes.
 *
 * Built to the same shape as the course home page, because it is the same job:
 * decide whether to begin.
 *
 * Left column : header, the list of quizzes with what each one costs in time and
 *               questions, the Learning tools / Notes tabs, then the description.
 * Right column: cover photo, a Start button carrying the first quiz's time limit,
 *               and the totals.
 */
import {
  ArrowLeftIcon,
  CheckCircleIcon,
  ClockIcon,
  QuestionMarkCircleIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { NewBadge, newMarkers } from '@/components/common/new-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Course, imageSrc, NewIds, Note, sectionGroups } from '@/services/curriculum-api';
import { useLearnerApi } from '@/services/learner-api';
import { Quiz } from '@/services/quiz-api';
import { logger } from '@/utils/logger';

/** A quiz plus where it sits in the course, for the list. */
interface QuizEntry {
  quiz: Quiz;
  sectionId: string;
  sectionTitle: string;
  moduleId: string;
  moduleNumber: string;
  moduleTitle: string;
}

function formatMinutes(minutes: number): string {
  if (minutes <= 0) return '0 min';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hour${hours === 1 ? '' : 's'}` : `${hours} h ${rest} min`;
}

const QuizLanding = () => {
  const api = useLearnerApi();
  const { courseId } = useParams<{ courseId: string }>();
  const navigate = useNavigate();

  const [course, setCourse] = useState<Course | null>(null);
  const [newIds, setNewIds] = useState<NewIds | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempted, setAttempted] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<'tools' | 'notes'>('tools');
  const [notes, setNotes] = useState<Note[]>([]);
  const [noteDraft, setNoteDraft] = useState('');

  const load = useCallback(async () => {
    if (!courseId) return;
    try {
      setLoading(true);
      // One call for both kinds of visitor — see CoursePlayer.
      const [found, progress] = await Promise.all([
        api.getCourseWithNewIds(courseId),
        api.getProgress(),
      ]);
      setCourse(found?.course ?? null);
      setNewIds(found?.newIds ?? null);
      setAttempted(new Set(progress.attemptedQuizIds));
    } catch (err) {
      logger.error('Error loading quizzes:', err);
    } finally {
      setLoading(false);
    }
  }, [courseId]);

  const loadNotes = useCallback(async () => {
    if (!courseId) return;
    try {
      setNotes(await api.getNotes(courseId));
    } catch (err) {
      logger.error('Error loading notes:', err);
    }
  }, [courseId]);

  useEffect(() => {
    load();
    loadNotes();
  }, [load, loadNotes]);

  /** Every quiz in the course, in section-then-module order. */
  const entries = useMemo<QuizEntry[]>(() => {
    if (!course) return [];
    return sectionGroups(course).flatMap((group) =>
      group.modules.flatMap((module) =>
        module.quizzes.map((quiz) => ({
          quiz,
          sectionId: group.section.id,
          sectionTitle: group.section.title,
          moduleId: module.id,
          moduleNumber: module.number,
          moduleTitle: module.title,
        })),
      ),
    );
  }, [course]);

  const saveNote = async () => {
    if (!courseId || !noteDraft.trim()) return;
    try {
      await api.createNote(courseId, noteDraft.trim(), null);
      setNoteDraft('');
      await loadNotes();
    } catch (err) {
      logger.error('Failed to save note:', err);
    }
  };

  const removeNote = async (id: string) => {
    try {
      await api.deleteNote(id);
      await loadNotes();
    } catch (err) {
      logger.error('Failed to delete note:', err);
    }
  };

  if (loading) {
    return (
      <div className="page-container flex flex-col">
        <div className="text-center">Loading quizzes...</div>
      </div>
    );
  }

  if (!course) {
    return (
      <div className="page-container flex flex-col">
        <Button onClick={() => navigate('/quizzes')} variant="ghost" className="w-fit px-0">
          ← All quizzes
        </Button>
        <Card className="bg-light-gray">
          <CardContent className="py-16 text-center">
            <p>That course could not be found.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isNew = newMarkers(newIds);
  const cover = imageSrc(course.imageData, course.imageType);
  const done = entries.filter((entry) => attempted.has(entry.quiz.id)).length;
  const questionCount = entries.reduce((sum, entry) => sum + entry.quiz.questions.length, 0);
  // Only the timed ones contribute; an untimed quiz has no minutes to add.
  const timedMinutes = entries.reduce((sum, entry) => sum + (entry.quiz.timeLimitMinutes ?? 0), 0);

  /**
   * The one the Start button opens: the first they have not attempted.
   *
   * Null once every quiz has been attempted, which is what disables Start —
   * falling back to the first would offer to "start" a course they have
   * finished, and re-taking is a deliberate act from inside the player.
   */
  const next = entries.find((entry) => !attempted.has(entry.quiz.id)) ?? null;
  const allDone = entries.length > 0 && next === null;
  const startLabel = allDone
    ? 'All quizzes done'
    : !next
      ? 'No quizzes yet'
      : next.quiz.timeLimitMinutes !== null
        ? `Start quiz · ${next.quiz.timeLimitMinutes} min`
        : 'Start quiz';

  const openQuiz = (quizId: string) => navigate(`/quizzes/${course.id}/take/${quizId}`);

  return (
    <div className="page-container flex flex-col">
      <Button
        onClick={() => navigate('/quizzes')}
        variant="ghost"
        className="mb-4 w-fit gap-2 px-0 text-dark-gray hover:text-green-hover"
      >
        <ArrowLeftIcon className="w-5 h-5" /> All quizzes
      </Button>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* ---- Main column ---- */}
        {/* min-w-0 lets this column shrink; without it wide content stretches the
            grid track and pushes the sidebar card off screen. */}
        <div className="flex min-w-0 flex-col gap-6">
          <header>
            <h1 className="page-hero-title break-words font-bold text-dark-gray">{course.title}</h1>
            <p className="mt-3 break-words text-lg text-dark-gray">
              {entries.length === 0
                ? 'This course has no quizzes yet.'
                : `${entries.length} quiz${entries.length === 1 ? '' : 'zes'} to work through.`}
            </p>
            {course.tags.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {course.tags.map((tag) => (
                  <Badge
                    key={tag}
                    variant="outline"
                    className="border-2 border-navy px-2 text-navy"
                  >
                    {tag}
                  </Badge>
                ))}
              </div>
            )}
            <p className="mt-2 text-sm text-dark-gray">
              Last updated {new Date(course.updatedAt).toLocaleDateString()}
            </p>
          </header>

          {/* The quizzes themselves */}
          <Card className="bg-light-gray shadow-sm">
            <CardHeader className="p-4">
              <CardTitle className="text-lg text-dark-gray">Quizzes</CardTitle>
              <p className="text-sm text-dark-gray">
                {done} of {entries.length} done
              </p>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {entries.length === 0 ? (
                <p className="text-dark-gray">Nothing here yet.</p>
              ) : (
                /* Deliberately not clickable. There is one way into a quiz —
                   the Start button — so the order they are taken in is the
                   course's, not whichever line caught the eye. */
                entries.map((entry) => (
                  <div
                    key={entry.quiz.id}
                    className={`flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left
                      ${
                        next?.quiz.id === entry.quiz.id
                          ? 'border-navy bg-white'
                          : 'border-gray-300 bg-white'
                      }`}
                  >
                    {attempted.has(entry.quiz.id) ? (
                      <CheckCircleIcon className="w-5 h-5 shrink-0 text-green" />
                    ) : (
                      <QuestionMarkCircleIcon className="w-5 h-5 shrink-0 text-dark-gray" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block break-words font-semibold text-dark-gray">
                        {entry.quiz.title}
                      </span>
                      <span className="block text-sm text-dark-gray">
                        {entry.moduleNumber} {entry.moduleTitle} · {entry.sectionTitle}
                      </span>
                    </span>
                    <span className="shrink-0 text-sm text-dark-gray">
                      {entry.quiz.questions.length} question
                      {entry.quiz.questions.length === 1 ? '' : 's'}
                      {entry.quiz.timeLimitMinutes !== null && (
                        <> · {entry.quiz.timeLimitMinutes} min</>
                      )}
                    </span>
                    {isNew.item(entry.quiz.id, entry.moduleId, entry.sectionId) && <NewBadge />}
                    {next?.quiz.id === entry.quiz.id && (
                      <span
                        className="shrink-0 rounded-full bg-navy px-2 py-0.5 text-xs font-semibold
                          text-white"
                      >
                        Up next
                      </span>
                    )}
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {/* Tabs, as on the player */}
          <Card className="bg-light-gray shadow-sm">
            <div className="flex gap-1 border-b border-gray-300 px-4 pt-4">
              {(['tools', 'notes'] as const).map((key) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={`rounded-t-lg px-4 py-2 text-sm font-semibold transition-colors
                  ${tab === key ? 'bg-white text-dark-gray' : 'text-dark-gray hover:bg-white/60'}`}
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
                          className="flex items-start justify-between gap-3 rounded-lg border
                            border-gray-300 bg-white px-4 py-3"
                        >
                          <span className="min-w-0">
                            <span className="block whitespace-pre-wrap break-words text-dark-gray">
                              {note.body}
                            </span>
                            <span className="mt-1 block text-xs text-dark-gray">
                              {new Date(note.createdAt).toLocaleString()}
                            </span>
                          </span>
                          <Button
                            onClick={() => removeNote(note.id)}
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 shrink-0 hover:text-danger-hover"
                            title="Delete note"
                          >
                            <TrashIcon className="w-4 h-4" />
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Description sits below the tabs, as asked */}
          {course.description && (
            <Card className="bg-light-gray shadow-sm">
              <CardHeader className="p-4">
                <CardTitle className="text-lg text-dark-gray">Description</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap break-words text-dark-gray">
                  {course.description}
                </p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* ---- Sidebar ---- */}
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <Card className="gap-0 overflow-hidden bg-light-gray p-0 shadow-lg">
            <div
              className="flex aspect-video items-center justify-center overflow-hidden bg-navy/10"
            >
              {cover ? (
                <img src={cover} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="text-sm text-dark-gray">No photo</span>
              )}
            </div>

            <CardContent className="flex flex-col gap-4 p-4">
              <Button
                onClick={() => next && openQuiz(next.quiz.id)}
                disabled={!next}
                className="w-full bg-navy py-6 text-md text-white hover:bg-navbar-hover"
              >
                {startLabel}
              </Button>

              {next && (
                <p className="-mt-2 break-words text-center text-sm text-dark-gray">
                  {next.quiz.title}
                  {next.quiz.timeLimitMinutes === null && ' · no time limit'}
                </p>
              )}

              <p className="text-sm font-semibold text-dark-gray">This includes:</p>
              <ul className="flex flex-col gap-2 text-sm text-dark-gray">
                <li className="flex items-center gap-2">
                  <QuestionMarkCircleIcon className="w-5 h-5 shrink-0" />
                  {entries.length} quiz{entries.length === 1 ? '' : 'zes'}
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircleIcon className="w-5 h-5 shrink-0" />
                  {questionCount} question{questionCount === 1 ? '' : 's'}
                </li>
                <li className="flex items-center gap-2">
                  <ClockIcon className="w-5 h-5 shrink-0" />
                  {timedMinutes > 0 ? `${formatMinutes(timedMinutes)} of timed quizzes` : 'Untimed'}
                </li>
              </ul>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
};

export default QuizLanding;
