/**
 * File: quiz-player.tsx
 * Description: Working through one course's quizzes.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
/**
 * QuizPlayer - working through one course's quizzes.
 *
 * Same shape as the course content page: the selected quiz on the left with the
 * Learning tools and Notes tabs beneath it and the course details below that,
 * and a scrollable rail of the course's quizzes on the right.
 *
 * Which quiz is open lives in the URL, so a timed run survives a reload and can
 * be linked to directly from the start page.
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
import QuizRunner from '@/components/common/quiz-runner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Course, NewIds, Note, sectionGroups } from '@/services/curriculum-api';
import { useLearnerApi } from '@/services/learner-api';
import { Quiz } from '@/services/quiz-api';
import { logger } from '@/utils/logger';

/** A quiz plus where it sits in the course, for grouping in the rail. */
interface RailEntry {
  quiz: Quiz;
  sectionId: string;
  sectionNumber: number;
  sectionTitle: string;
  moduleId: string;
  moduleNumber: string;
  moduleTitle: string;
}

const QuizPlayer = () => {
  const api = useLearnerApi();
  const { courseId, quizId } = useParams<{ courseId: string; quizId: string }>();
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
  const entries = useMemo<RailEntry[]>(() => {
    if (!course) return [];
    return sectionGroups(course).flatMap((group) =>
      group.modules.flatMap((module) =>
        module.quizzes.map((quiz) => ({
          quiz,
          sectionId: group.section.id,
          sectionNumber: group.section.number,
          sectionTitle: group.section.title,
          moduleId: module.id,
          moduleNumber: module.number,
          moduleTitle: module.title,
        })),
      ),
    );
  }, [course]);

  // The URL names the open quiz. Arriving without one — or with a stale id —
  // lands on the first, replacing the entry so Back still leaves the player.
  useEffect(() => {
    if (entries.length === 0 || !courseId) return;
    if (entries.some((entry) => entry.quiz.id === quizId)) return;
    navigate(`/quizzes/${courseId}/take/${entries[0].quiz.id}`, { replace: true });
  }, [entries, quizId, courseId, navigate]);

  const selected = entries.find((entry) => entry.quiz.id === quizId) ?? null;

  const isNew = newMarkers(newIds);

  const openQuiz = (id: string) => navigate(`/quizzes/${courseId}/take/${id}`);

  /** The rail's headings: sections that actually hold a quiz, in order. */
  const railSections = useMemo(() => {
    const bySection = new Map<
      string,
      { id: string; number: number; title: string; entries: RailEntry[] }
    >();

    for (const entry of entries) {
      const rail = bySection.get(entry.sectionId) ?? {
        id: entry.sectionId,
        number: entry.sectionNumber,
        title: entry.sectionTitle,
        entries: [],
      };
      rail.entries.push(entry);
      bySection.set(entry.sectionId, rail);
    }

    return [...bySection.values()];
  }, [entries]);

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

  return (
    <div className="page-container flex flex-col">
      <Button
        onClick={() => navigate(`/quizzes/${course.id}`)}
        variant="ghost"
        className="mb-4 w-fit gap-2 px-0 text-dark-gray hover:text-green-hover"
      >
        <ArrowLeftIcon className="w-5 h-5" /> Quiz overview
      </Button>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* Selected quiz */}
        <div className="flex min-w-0 flex-col gap-6">
          <Card className="bg-light-gray shadow-sm">
            <CardContent className="p-4">
              {!selected ? (
                <p className="py-16 text-center text-dark-gray">This course has no quizzes yet.</p>
              ) : (
                <>
                  <p className="text-sm text-dark-gray">
                    {selected.sectionNumber}. {selected.sectionTitle} · {selected.moduleNumber}{' '}
                    {selected.moduleTitle}
                  </p>
                  <h2 className="mb-4 break-words text-xl font-semibold text-dark-gray">
                    {selected.quiz.title}
                  </h2>
                  <QuizRunner
                    key={selected.quiz.id}
                    quiz={selected.quiz}
                    onCompleted={() => {
                      setAttempted((prev) => new Set(prev).add(selected.quiz.id));
                    }}
                  />
                </>
              )}
            </CardContent>
          </Card>

          {/* Tabs under the quiz */}
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

          {/* Course details, as on the content page */}
          <Card className="bg-light-gray shadow-sm">
            <CardContent className="p-4">
              <h2 className="break-words text-2xl font-bold text-dark-gray">{course.title}</h2>
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

        {/* Quiz rail */}
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <Card className="gap-0 bg-light-gray p-0 shadow-sm">
            <div className="border-b border-gray-300 p-4">
              <h2 className="font-semibold text-dark-gray">Quizzes</h2>
              <p className="text-sm text-dark-gray">
                {entries.filter((e) => attempted.has(e.quiz.id)).length} of {entries.length} done
              </p>
            </div>

            <div className="max-h-[70vh] overflow-y-auto p-2">
              {entries.length === 0 ? (
                <p className="px-3 py-2 text-sm text-dark-gray">No quizzes.</p>
              ) : (
                railSections.map((rail) => (
                  <section key={rail.id} className="mb-2">
                    <h3 className="px-2 py-2 text-sm font-semibold text-dark-gray">
                      {rail.number}. {rail.title}
                    </h3>
                    <ul className="flex flex-col">
                      {rail.entries.map((entry) => (
                        <li key={entry.quiz.id}>
                          <button
                            onClick={() => openQuiz(entry.quiz.id)}
                            className={`flex w-full items-center gap-2 rounded-md px-3 py-2
                              text-left text-sm ${
                                quizId === entry.quiz.id
                                  ? 'bg-white font-semibold text-dark-gray'
                                  : 'text-dark-gray hover:bg-white/60'
                              }`}
                          >
                            {attempted.has(entry.quiz.id) ? (
                              <CheckCircleIcon className="w-4 h-4 shrink-0 text-green" />
                            ) : (
                              <QuestionMarkCircleIcon className="w-4 h-4 shrink-0" />
                            )}
                            <span className="min-w-0 flex-1">
                              <span className="block truncate">{entry.quiz.title}</span>
                              <span className="block truncate text-xs">
                                {entry.moduleNumber} {entry.moduleTitle}
                              </span>
                            </span>
                            {isNew.item(entry.quiz.id, entry.moduleId, entry.sectionId) && (
                              <NewBadge />
                            )}
                            <span className="flex shrink-0 items-center gap-1 text-xs">
                              {entry.quiz.timeLimitMinutes !== null && (
                                <>
                                  <ClockIcon className="w-3 h-3" />
                                  {entry.quiz.timeLimitMinutes}m
                                </>
                              )}
                              {entry.quiz.questions.length}q
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))
              )}
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
};

export default QuizPlayer;
