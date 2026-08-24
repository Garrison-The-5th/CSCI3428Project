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
 * Underneath, a set is still a course with one module and one section, and the
 * section is still what carries the name, the estimated time and the place in
 * the order. The author never meets any of that — they see a title, a time, and
 * the questions — and the two names are kept in step by `saveTitle`, because
 * they are one thing to whoever is typing.
 */
import { useEffect, useState } from 'react';

import QuizEditor from '@/components/common/quiz-editor';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Course, curriculumApi } from '@/services/curriculum-api';
import { quizApi, QuizType } from '@/services/quiz-api';

interface Props {
  course: Course;
  selectedSectionId: string | null;
  onSelectSection: (id: string | null) => void;
  onRefresh: () => Promise<void>;
  onNotify: (message: string, type?: 'success' | 'error') => void;
  onDelete: (target: { kind: 'quiz' | 'section'; id: string; label: string }) => void;
  run: (action: () => Promise<unknown>, success: string, failure: string) => Promise<boolean>;
}

const inputClass = 'bg-white text-dark-gray';

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
  run,
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

  const [title, setTitle] = useState(selected?.title ?? '');
  useEffect(() => setTitle(selected?.title ?? ''), [selected?.id, selected?.title]);

  /**
   * Renames the quiz and the row together.
   *
   * They carry the same name because they are one thing to an author, and a
   * rename that moved only one of them would read as a bug — the card would say
   * one thing and the editor another.
   */
  const saveTitle = async () => {
    const next = title.trim();
    if (!selected || !next || next === selected.title) {
      setTitle(selected?.title ?? '');
      return;
    }

    await run(
      async () => {
        await curriculumApi.updateSection(selected.id, { title: next });
        if (selectedQuiz) await quizApi.updateQuiz(selectedQuiz.id, { title: next });
      },
      'Quiz renamed',
      'Failed to rename the quiz',
    );
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
      <CardHeader className="flex-row flex-wrap items-end justify-between gap-3 p-4">
        <label className="flex min-w-60 flex-1 flex-col gap-1 text-sm font-medium text-dark-gray">
          Title
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            className={inputClass}
          />
        </label>

        {/* Named for what it is, because there are two minutes fields on this
            pane and they do different jobs: this one is the estimate that feeds
            the totals on the card, and "Time limit" below is the clock the
            learner actually races. Calling both "Time" had an estimate typed
            here and a quiz that then told the learner it was untimed. */}
        <label
          className="flex flex-col gap-1 text-sm font-medium text-dark-gray"
          title="Roughly how long this takes, for the totals. The countdown is set by Time limit,
            in the quiz below."
        >
          Estimated time (mins)
          <Input
            defaultValue={String(selected.estimatedMinutes)}
            onBlur={(e) =>
              run(
                () =>
                  curriculumApi.updateSection(selected.id, {
                    estimatedMinutes: Number(e.target.value) || 0,
                  }),
                '',
                'Failed to update the time',
              )
            }
            className={`${inputClass} max-w-28`}
          />
        </label>
      </CardHeader>

      <CardContent>
        <QuizEditor
          quiz={selectedQuiz}
          onChanged={onRefresh}
          onNotify={onNotify}
          // Deleting the quiz means deleting the set's one row; the shell says
          // "quiz" in the confirmation, which is what the author thinks it is.
          onDeleteQuiz={() => onDelete({ kind: 'section', id: selected.id, label: selected.title })}
          // The name lives in the header above, so the editor does not offer a
          // second field that sets the same thing.
          showTitle={false}
          typeChoices={QUIZ_SET_TYPES}
        />
      </CardContent>
    </Card>
  );
};

export default QuizSetPane;
