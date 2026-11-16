/**
 * File: quiz-set-pane.tsx
 * Description: The Quizzes pane for a quiz set — the one quiz it holds.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Date: 2026-08-20
 */
/**
 * Building a quiz set.
 *
 * A quiz set holds exactly one quiz — an exam, or a one-time link — and always
 * has. This pane used to open on a structure box: a list to add quizzes to, drag
 * into order, rename and colour. That was a list with one legal entry in it, and
 * a set of controls for arranging a sequence of one. It is gone, along with the
 * empty state that came before the author had used it: the set is created with
 * its quiz already in it, so there is nothing here but the quiz itself.
 *
 * Underneath, a set is still a course with one model and one section, and the
 * section is still what carries the name, the estimated time and the place in
 * the order. The author never meets any of that — they see a title, a time, and
 * the questions — and the two names are kept in step by `saveTitleTo`, because
 * they are one thing to whoever is typing.
 */
import { TrashIcon } from '@heroicons/react/24/outline';
import { useEffect } from 'react';

import QuizEditor from '@/components/common/quiz-editor';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Course, curriculumApi } from '@/services/curriculum-api';
import { quizApi, QuizType } from '@/services/quiz-api';

interface Props {
  course: Course;
  selectedSectionId: string | null;
  onSelectSection: (id: string | null) => void;
  onRefresh: () => Promise<void>;
  onNotify: (message: string, type?: 'success' | 'error') => void;
  onDelete: (target: { kind: 'quiz' | 'section'; id: string; label: string }) => void;
}

/**
 * What a quiz set is allowed to hold.
 *
 * An exam, or a one-time link. A learning check is deliberately absent: it only
 * means anything sitting between two pieces of content, marking a learner's way
 * through a lesson, so it has nothing to check in a set that is nothing but a
 * quiz — and it is never listed on the Quizzes tab, which is where a quiz set is
 * read from.
 *
 * This has to be stated rather than inferred. The quiz owns a section, exactly
 * as a lesson's quiz does, so by position alone the two are indistinguishable
 * and the editor would otherwise offer a lesson's pair.
 *
 * Both are always available now. The rule that a one-time link must be the only
 * quiz in its set is satisfied by construction: a set holds one quiz, so it
 * always is.
 */
const QUIZ_SET_TYPES: QuizType[] = ['EXAM', 'ONE_TIME'];

const QuizSetPane = ({
  course,
  selectedSectionId,
  onSelectSection,
  onRefresh,
  onNotify,
  onDelete,
}: Props) => {
  const sections = course.sections;
  /**
   * The set's one quiz, and the row behind it.
   *
   * `selectedSectionId` is honoured when it points at something real so the
   * shell's selection is not fought with, but it falls through to the first row,
   * which in a set is the only row.
   */
  const selected =
    sections.find((section) => section.id === selectedSectionId) ?? sections[0] ?? null;
  const selectedQuiz = selected?.quizzes[0] ?? null;

  // Keep the shell's selection pointing at it, so anything else reading that id
  // is looking at the same thing this pane is.
  useEffect(() => {
    if (selected && selected.id !== selectedSectionId) onSelectSection(selected.id);
  }, [selected, selectedSectionId, onSelectSection]);

  /**
   * Renames the quiz and the row together.
   *
   * They carry the same name because they are one thing to an author, and a
   * rename that moved only one of them would read as a bug — the card would say
   * one thing and the editor another.
   */
  const saveTitleTo = async (next: string) => {
    if (!selected || !next || next === selected.title) return;

    await curriculumApi.updateSection(selected.id, { title: next });
    if (selectedQuiz) await quizApi.updateQuiz(selectedQuiz.id, { title: next });
  };

  if (!selected || !selectedQuiz) {
    return (
      <Card className="bg-light-gray">
        <CardContent className="py-16 text-center">
          <p>
            This set has no quiz behind it, which should not happen — a set is created with one.
            Delete it and make another.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-light-gray shadow-sm">
      {/*
        Title and estimate used to sit here while type, timing and the rest sat
        inside the editor, which split one set of settings across two boxes with
        a card border between them. They are all in the editor's Settings pane
        now — renaming still moves the section and the quiz together, because
        `onSaveTitle` below is the same function that did it here.

        What is left on the header is the one thing that is not a setting.
      */}
      <CardHeader className="flex-row items-center justify-between gap-3 p-4 pb-0">
        <CardTitle className="min-w-0 truncate text-base text-dark-gray">
          {selected.title}
        </CardTitle>
        <Button
          onClick={() => onDelete({ kind: 'section', id: selected.id, label: selected.title })}
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 hover:text-danger-hover"
          title="Delete quiz"
        >
          <TrashIcon className="w-5 h-5" />
        </Button>
      </CardHeader>

      <CardContent>
        <QuizEditor
          quiz={selectedQuiz}
          onChanged={onRefresh}
          onNotify={onNotify}
          typeChoices={QUIZ_SET_TYPES}
          // The estimate belongs to the section rather than to the quiz — the
          // section is the row carrying this quiz's name and place in the set —
          // so the editor renders the field and hands the value back here.
          estimatedMinutes={selected.estimatedMinutes}
          onSaveEstimatedMinutes={(minutes) =>
            curriculumApi.updateSection(selected.id, { estimatedMinutes: minutes })
          }
          onSaveTitle={saveTitleTo}
          // A quiz set is a course underneath, so what its deadline does is a
          // property of the course rather than of the quiz inside it.
          lockAfterDue={course.lockAfterDue}
          onSaveLockAfterDue={(lock) =>
            curriculumApi.updateCourse(course.id, { lockAfterDue: lock }).then(onRefresh)
          }
        />
      </CardContent>
    </Card>
  );
};

export default QuizSetPane;
