/**
 * File: quiz-editor.tsx
 * Description: Everything you can do to one quiz: rename it, publish it, choose whether answers.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
/**
 * Everything you can do to one quiz: rename it, publish it, choose whether answers
 * are revealed, set a due date, and write its questions.
 *
 * Used both on the standalone quiz page and inline in a module, so a quiz created
 * while editing a lesson is authored in place — already attached to that module,
 * sitting exactly where it was dropped in the content order.
 */
import { PencilIcon, TrashIcon } from '@heroicons/react/24/outline';
import { useEffect, useState } from 'react';

import ConfirmDialog from '@/components/common/confirm-dialog';
import QuestionFields, {
  emptyQuestionDraft,
  QuestionDraft,
  toQuestionInput,
} from '@/components/common/question-fields';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import ToggleSwitch from '@/components/ui/toggle-switch';
import { saveLabel, useAutoSave } from '@/hooks/use-auto-save';
import { Quiz, quizApi, QuizQuestion } from '@/services/quiz-api';
import { logger } from '@/utils/logger';

interface QuizEditorProps {
  quiz: Quiz;
  /** Reload the parent once something changes. */
  onChanged: () => Promise<void> | void;
  onNotify: (message: string, type?: 'success' | 'error') => void;
  /** Deleting the quiz is the parent's business, so it can confirm consistently. */
  onDeleteQuiz: () => void;
  /** Hide the title field where the parent already shows it. */
  showTitle?: boolean;
}

const inputClass = 'bg-white text-dark-gray';
const primaryBtn = 'bg-navy text-white hover:bg-navy-hover';

const QuizEditor = ({
  quiz,
  onChanged,
  onNotify,
  onDeleteQuiz,
  showTitle = true,
}: QuizEditorProps) => {
  const [draft, setDraft] = useState(emptyQuestionDraft());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<QuestionDraft>(emptyQuestionDraft());
  const [pendingQuestion, setPendingQuestion] = useState<{ id: string; label: string } | null>(
    null,
  );

  // Title saves itself, like everything else in the lesson editor.
  const [title, setTitle] = useState(quiz.title);
  useEffect(() => setTitle(quiz.title), [quiz.id, quiz.title]);

  const { state: titleState } = useAutoSave(title, async (value) => {
    if (!value.trim()) return;
    await quizApi.updateQuiz(quiz.id, { title: value.trim() });
    await onChanged();
  });

  // Blank means untimed, which is why this is a string rather than a number.
  const [timeLimit, setTimeLimit] = useState(
    quiz.timeLimitMinutes === null ? '' : String(quiz.timeLimitMinutes),
  );
  useEffect(
    () => setTimeLimit(quiz.timeLimitMinutes === null ? '' : String(quiz.timeLimitMinutes)),
    [quiz.id, quiz.timeLimitMinutes],
  );

  const saveTimeLimit = async () => {
    const trimmed = timeLimit.trim();
    const next = trimmed === '' ? null : Number(trimmed);

    if (next !== null && (!Number.isInteger(next) || next < 1)) {
      onNotify('A time limit is a whole number of minutes, 1 or more', 'error');
      setTimeLimit(quiz.timeLimitMinutes === null ? '' : String(quiz.timeLimitMinutes));
      return;
    }
    if (next === quiz.timeLimitMinutes) return;

    await run(
      () => quizApi.updateQuiz(quiz.id, { timeLimitMinutes: next }),
      next === null ? 'Quiz is now untimed' : `Learners get ${next} minutes`,
      'Failed to update the time limit',
    );
  };

  const run = async (action: () => Promise<unknown>, success: string, failure: string) => {
    try {
      await action();
      await onChanged();
      if (success) onNotify(success);
      return true;
    } catch (err) {
      logger.error(`${failure}:`, err);
      onNotify(err instanceof Error && err.message ? err.message : failure, 'error');
      return false;
    }
  };

  const addQuestion = async () => {
    const payload = toQuestionInput(draft, (m) => onNotify(m, 'error'));
    if (!payload) return;
    const ok = await run(
      () => quizApi.addQuestion(quiz.id, payload),
      'Question added',
      'Failed to add question',
    );
    if (ok) setDraft(emptyQuestionDraft());
  };

  const startEditing = (question: QuizQuestion) => {
    setEditingId(question.id);
    setEditDraft({
      prompt: question.prompt,
      hint: question.hint ?? '',
      hintModuleNumber: question.hintModuleNumber ?? '',
      options: question.options.map((option) => option.text),
      correctIndex: Math.max(
        0,
        question.options.findIndex((option) => option.isCorrect),
      ),
    });
  };

  const saveQuestion = async () => {
    if (!editingId) return;
    const payload = toQuestionInput(editDraft, (m) => onNotify(m, 'error'));
    if (!payload) return;
    const ok = await run(
      () => quizApi.updateQuestion(editingId, payload),
      'Question updated',
      'Failed to update question',
    );
    if (ok) {
      setEditingId(null);
      setEditDraft(emptyQuestionDraft());
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Quiz settings */}
      <div className="flex flex-col gap-3">
        {showTitle && (
          <label className="flex flex-col gap-1 text-sm font-medium text-dark-gray">
            <span className="flex items-center justify-between gap-3">
              Quiz title
              <span className="text-xs font-normal">{saveLabel(titleState)}</span>
            </span>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={inputClass}
            />
          </label>
        )}

        <div className="flex flex-wrap items-start gap-6">
          <Badge
            className={quiz.published ? 'bg-navy px-2 text-white' : 'bg-gray-400 px-2 text-white'}
          >
            {quiz.published ? 'Published' : 'Draft'}
          </Badge>

          <Button
            onClick={() =>
              run(
                () => quizApi.updateQuiz(quiz.id, { published: !quiz.published }),
                quiz.published
                  ? 'Quiz unpublished — hidden from learners'
                  : 'Quiz published — now visible to learners',
                'Failed to change publish state',
              )
            }
            className={quiz.published ? '' : primaryBtn}
            variant={quiz.published ? 'outline' : 'default'}
          >
            {quiz.published ? 'Unpublish' : 'Publish'}
          </Button>

          <ToggleSwitch
            checked={quiz.showAnswers}
            onChange={(v) =>
              run(
                () => quizApi.updateQuiz(quiz.id, { showAnswers: v }),
                v
                  ? 'Correct answers will be shown after an attempt'
                  : 'Correct answers are now hidden',
                'Failed to change answer visibility',
              )
            }
            label="Show correct answers"
            hint="After the learner submits"
          />

          <label className="flex flex-col gap-1 text-sm font-medium text-dark-gray">
            Due date
            <input
              type="date"
              value={quiz.dueDate ? quiz.dueDate.slice(0, 10) : ''}
              onChange={(e) =>
                run(
                  () => quizApi.updateQuiz(quiz.id, { dueDate: e.target.value || null }),
                  'Quiz due date updated',
                  'Failed to update due date',
                )
              }
              className="h-9 rounded-md border border-gray-300 bg-white px-2 text-sm text-dark-gray"
            />
          </label>

          {/* Saves on blur rather than per keystroke: half-typed "3" on the way to
              "30" is a valid time limit, and would otherwise be saved as one. */}
          <label className="flex flex-col gap-1 text-sm font-medium text-dark-gray">
            Time limit (mins)
            <Input
              type="number"
              min={1}
              value={timeLimit}
              onChange={(e) => setTimeLimit(e.target.value)}
              onBlur={saveTimeLimit}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              placeholder="No limit"
              title="Minutes the learner gets once they start. Leave blank for untimed."
              className={`${inputClass} max-w-28`}
            />
          </label>

          <Button
            onClick={onDeleteQuiz}
            variant="ghost"
            size="icon"
            className="ml-auto hover:text-danger-hover"
            title="Delete quiz"
          >
            <TrashIcon className="w-5 h-5" />
          </Button>
        </div>
      </div>

      <hr className="h-px border-t-0 bg-gray-300" />

      {/* Questions */}
      {quiz.questions.map((question) => {
        const isEditing = editingId === question.id;

        return (
          <div key={question.id} className="rounded-lg border border-gray-300 bg-white p-4">
            <div className="flex items-start justify-between gap-4">
              <p className="min-w-0 break-words font-semibold text-dark-gray">
                {question.order}.{!isEditing && ` ${question.prompt}`}
                {isEditing && ' Editing question'}
              </p>
              <div className="flex shrink-0 items-center">
                <Button
                  onClick={() => (isEditing ? setEditingId(null) : startEditing(question))}
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 hover:text-green-hover"
                  title={isEditing ? 'Cancel editing' : 'Edit question'}
                >
                  <PencilIcon className="w-4 h-4" />
                </Button>
                <Button
                  onClick={() => setPendingQuestion({ id: question.id, label: question.prompt })}
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 hover:text-danger-hover"
                  title="Delete question"
                >
                  <TrashIcon className="w-4 h-4" />
                </Button>
              </div>
            </div>

            {isEditing ? (
              <div className="mt-3">
                <QuestionFields
                  draft={editDraft}
                  radioName={`edit-${question.id}`}
                  onChange={(patch) => setEditDraft((prev) => ({ ...prev, ...patch }))}
                  onTooFewOptions={() => onNotify('A question needs at least 2 options', 'error')}
                  actions={
                    <>
                      <Button onClick={saveQuestion} className={primaryBtn}>
                        Save Changes
                      </Button>
                      <Button
                        onClick={() => setEditingId(null)}
                        variant="outline"
                        className="bg-white text-dark-gray hover:bg-light-gray"
                      >
                        Cancel
                      </Button>
                    </>
                  }
                />
              </div>
            ) : (
              <ul className="mt-2 flex flex-col gap-1">
                {question.options.map((option) => (
                  <li
                    key={option.id}
                    className={`text-sm ${
                      option.isCorrect ? 'font-semibold text-green' : 'text-dark-gray'
                    }`}
                  >
                    {option.text}
                    {option.isCorrect && ' ✓'}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}

      {/* New question */}
      <div className="rounded-lg border-2 border-dashed border-navy/30 p-4">
        <h4 className="mb-3 font-semibold text-dark-gray">New Question</h4>
        <QuestionFields
          draft={draft}
          radioName={`new-${quiz.id}`}
          onChange={(patch) => setDraft((prev) => ({ ...prev, ...patch }))}
          onTooFewOptions={() => onNotify('A question needs at least 2 options', 'error')}
          actions={
            <Button onClick={addQuestion} className={primaryBtn}>
              Save Question
            </Button>
          }
        />
      </div>

      <ConfirmDialog
        open={pendingQuestion !== null}
        title="Delete question"
        message={
          <>
            Delete <span className="font-semibold">{pendingQuestion?.label}</span>? This cannot be
            undone.
          </>
        }
        onConfirm={async () => {
          const target = pendingQuestion;
          setPendingQuestion(null);
          if (target) {
            await run(
              () => quizApi.deleteQuestion(target.id),
              'Question deleted',
              'Failed to delete question',
            );
          }
        }}
        onCancel={() => setPendingQuestion(null)}
      />
    </div>
  );
};

export default QuizEditor;
