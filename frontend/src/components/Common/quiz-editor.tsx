/**
 * File: quiz-editor.tsx
 * Description: Everything you can do to one quiz: rename it, set how it is marked, write questions.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
/**
 * Everything you can do to one quiz: rename it, choose whether answers are
 * revealed, set a due date and a time limit, and write its questions.
 *
 * Used both on the standalone quiz page and inline in a section, so a quiz created
 * while editing a lesson is authored in place — already attached to that section,
 * sitting exactly where it was dropped in the content order.
 *
 * Publishing is deliberately not here. A quiz used to carry its own publish
 * state on top of its course's, which meant an author could press Publish, be
 * told the course was live, and still be serving a section with the quiz missing
 * from it — the snapshot dropped anything not separately published, and nothing
 * on screen said a second switch existed. A course is published whole now, from
 * the one button above the editor, and that covers every quiz in it.
 */
import { CheckIcon, PencilIcon, TrashIcon } from '@heroicons/react/24/outline';
import { useEffect, useState } from 'react';

import ConfirmDialog from '@/components/common/confirm-dialog';
import QuestionFields, {
  emptyQuestionDraft,
  QuestionDraft,
  questionDraftIsEmpty,
  toQuestionInput,
} from '@/components/common/question-fields';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import ToggleSwitch from '@/components/ui/toggle-switch';
import { saveStatus, useAutoSave } from '@/hooks/use-auto-save';
import {
  Quiz,
  QUIZ_TYPE_HINTS,
  QUIZ_TYPE_LABELS,
  quizApi,
  quizCapabilities,
  QuizQuestion,
  QuizType,
} from '@/services/quiz-api';
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
  /**
   * Which kinds this quiz may be switched to.
   *
   * Left unset the editor works it out from where the quiz sits, which is right
   * for a lesson. A quiz set overrides it: its quizzes each own a section, so
   * the position alone cannot tell the two contexts apart — see quiz-set-pane.
   */
  typeChoices?: QuizType[];
  /**
   * Kinds to show greyed out, mapped to why they cannot be picked.
   *
   * The one caller is a quiz set that has grown past a single quiz, where a
   * one-time link no longer fits — see services/one-time-link.ts.
   */
  unavailableTypes?: Partial<Record<QuizType, string>>;
}

const inputClass = 'bg-white text-dark-gray';
const primaryBtn = 'bg-navy text-white hover:bg-navy-hover';

/**
 * The date a deadline of this many days would land on.
 *
 * The author is setting a length, so the date is the part they cannot see for
 * themselves — "14" says nothing about whether it clears the end of the month.
 * Worked out from today because today is when they are looking; the real one is
 * stamped when the quiz is actually handed over.
 */
const dueIfAssignedToday = (days: string) => {
  const parsed = Number(days);
  if (!Number.isInteger(parsed) || parsed < 1) return null;
  return new Date(Date.now() + parsed * 86_400_000).toLocaleDateString();
};

const QuizEditor = ({
  quiz,
  onChanged,
  onNotify,
  onDeleteQuiz,
  showTitle = true,
  typeChoices,
  unavailableTypes,
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

  const { state: titleState, saveNow: saveTitleNow } = useAutoSave(title, async (value) => {
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

  // Blank means no deadline, which is why this is a string rather than a number.
  const [daysRemaining, setDaysRemaining] = useState(
    quiz.daysRemaining == null ? '' : String(quiz.daysRemaining),
  );
  useEffect(
    () => setDaysRemaining(quiz.daysRemaining == null ? '' : String(quiz.daysRemaining)),
    [quiz.id, quiz.daysRemaining],
  );

  /**
   * Saved on blur rather than per keystroke, for the same reason the time limit
   * below is: half-typed "1" on the way to "14" is a perfectly valid number of
   * days and would otherwise be written as one.
   */
  const saveDaysRemaining = async () => {
    const trimmed = daysRemaining.trim();
    const next = trimmed === '' ? null : Number(trimmed);

    if (next !== null && (!Number.isInteger(next) || next < 1)) {
      onNotify('Days remaining is a whole number of days, 1 or more', 'error');
      setDaysRemaining(quiz.daysRemaining == null ? '' : String(quiz.daysRemaining));
      return;
    }
    if (next === (quiz.daysRemaining ?? null)) return;

    await run(
      () => quizApi.updateQuiz(quiz.id, { daysRemaining: next }),
      next === null ? 'No deadline on this quiz' : `Learners get ${next} days once assigned`,
      'Failed to update the deadline',
    );
  };

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

  const can = quizCapabilities(quiz.type);

  /*
   * Which kinds this quiz is allowed to become.
   *
   * A caller that knows better says so — a quiz set passes its own list, because
   * its quizzes each sit in a section and so are indistinguishable by position
   * from a lesson's.
   *
   * Otherwise it is decided by where the quiz sits. Inside a lesson: an exam or a
   * learning check. A one-time link is reached only through its own URL, and a
   * lesson section is reached by reading the lesson, so the server refuses that
   * pair outright. Standing on its own: an exam or a one-time link — a learning
   * check is the mirror image, and only means anything between two pieces of
   * content.
   *
   * A quiz already on some other kind keeps it in the list, so an existing row
   * never shows a picker that does not include its own value.
   */
  const availableTypes = [
    ...new Set<QuizType>([
      ...(typeChoices ??
        (quiz.sectionId
          ? (['EXAM', 'LEARNING_CHECK'] as QuizType[])
          : (['EXAM', 'ONE_TIME'] as QuizType[]))),
      quiz.type,
    ]),
  ];

  /**
   * Kinds that are shown but cannot be picked here, with the reason why.
   *
   * A one-time link may sit in a quiz set, but only ever as the whole of it —
   * the link opens the entire set, so anything beside it would be handed over
   * too. A caller that knows the set has grown past one quiz says so through
   * `unavailableTypes`, and the option is greyed with that reason rather than
   * quietly dropped: an author who wants one deserves to be told what is in the
   * way, not left to guess why it vanished.
   */
  const reasonUnavailable = (type: QuizType) => unavailableTypes?.[type];

  /**
   * Changing the kind, and moving the quiz if the new kind cannot live where it
   * is.
   *
   * A one-time link cannot sit in a lesson section — it is reached through its
   * link, and a lesson section is reached by reading the lesson — so turning a
   * lesson's quiz into one has to take it out of that section. It keeps a quiz
   * set's section, which is only the row carrying its name and order. Doing the
   * move here rather than making the author do it in two steps, and saying so,
   * because silently relocating content is worse than either.
   */
  const changeType = async (next: QuizType) => {
    if (next === quiz.type) return;

    // The disabled <option> already stops this in every browser that honours it;
    // this is the same rule stated where the write happens, so no future caller
    // can route around the picker.
    const blocked = reasonUnavailable(next);
    if (blocked) return onNotify(`${QUIZ_TYPE_LABELS[next]}: ${blocked}`, 'error');

    // Only a lesson's section has to be left behind. `typeChoices` is how a quiz
    // set announces itself, and a set is the one place a one-time link may keep
    // the section it is in.
    const inQuizSet = typeChoices !== undefined;
    const leavesSection = next === 'ONE_TIME' && quiz.sectionId !== null && !inQuizSet;

    await run(
      () =>
        quizApi.updateQuiz(quiz.id, {
          type: next,
          ...(leavesSection ? { sectionId: null } : {}),
        }),
      leavesSection
        ? `Now a ${QUIZ_TYPE_LABELS[next].toLowerCase()} — taken out of its section, ` +
            'because it is only reachable through its link'
        : `Now a ${QUIZ_TYPE_LABELS[next].toLowerCase()}`,
      'Failed to change the quiz type',
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

  /**
   * A stored question in the shape the form holds it.
   *
   * One function rather than two so "what is on screen" and "what is in the
   * database" are built the same way — which is what lets them be compared for
   * the Saved / Unsaved changes line beside each row.
   */
  const toDraft = (question: QuizQuestion): QuestionDraft => {
    const correct = question.options
      .map((option, index) => (option.isCorrect ? index : -1))
      .filter((index) => index >= 0);

    return {
      prompt: question.prompt,
      hint: question.hint ?? '',
      hintSectionNumber: question.hintSectionNumber ?? '',
      options: question.options.map((option) => option.text),
      // A question always has at least one correct option, but a row that somehow
      // has none would otherwise open with nothing tickable at all.
      correctIndexes: correct.length > 0 ? correct : [0],
    };
  };

  const startEditing = (question: QuizQuestion) => {
    setEditingId(question.id);
    setEditDraft(toDraft(question));
  };

  /**
   * The question being edited saves itself, like every other field in the
   * editor. Silent — a toast per keystroke-pause would be unbearable — and it
   * simply does nothing while the draft is not yet valid, so half-typed options
   * are not written and no error is shouted at somebody mid-sentence.
   */
  const { state: editState, saveNow: saveEditNow } = useAutoSave(
    editingId ? editDraft : null,
    async (draft) => {
      if (!editingId || !draft) return;
      const payload = toQuestionInput(draft, () => {});
      if (!payload) return;
      await quizApi.updateQuestion(editingId, payload);
      await onChanged();
    },
    { enabled: editingId !== null },
  );

  /**
   * A new question saves itself once it is complete enough to be one.
   *
   * `Save Question` still exists and still works; this is for the far more
   * common case of typing a question, being called away, and coming back to find
   * it gone. It stays quiet until the draft would actually validate, then writes
   * it once and clears the form — which is exactly what the button does.
   */
  useAutoSave(draft, async (value) => {
    if (questionDraftIsEmpty(value)) return;
    const payload = toQuestionInput(value, () => {});
    if (!payload) return;
    await quizApi.addQuestion(quiz.id, payload);
    setDraft(emptyQuestionDraft());
    await onChanged();
  });

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
              <span className="flex items-center gap-1">
                <span className="text-xs font-normal">
                  {saveStatus(titleState, title.trim() !== quiz.title)}
                </span>
                <Button
                  onClick={saveTitleNow}
                  disabled={titleState === 'saving'}
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 hover:text-green-hover"
                  title="Save the title now"
                >
                  <CheckIcon className="w-4 h-4" />
                </Button>
              </span>
            </span>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={inputClass}
            />
          </label>
        )}

        {/* What kind of quiz this is. Everything below reads off it, so it sits
            first: changing it is what turns other controls on and off. */}
        <label className="flex flex-col gap-1 text-sm font-medium text-dark-gray">
          Quiz type
          <select
            value={quiz.type}
            onChange={(e) => changeType(e.target.value as QuizType)}
            className="h-9 max-w-56 rounded-md border border-gray-300 bg-white px-2 text-sm
              text-dark-gray"
          >
            {availableTypes.map((type) => (
              <option
                key={type}
                value={type}
                disabled={type !== quiz.type && reasonUnavailable(type) !== undefined}
              >
                {QUIZ_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
          <span className="max-w-prose text-xs font-normal text-dark-gray">
            {QUIZ_TYPE_HINTS[quiz.type]}
          </span>
          {/* A greyed option explains itself here rather than in the list: a
              disabled <option> shows no tooltip, so the reason would otherwise
              be nowhere an author could read it. */}
          {availableTypes
            .filter((type) => type !== quiz.type && reasonUnavailable(type) !== undefined)
            .map((type) => (
              <span key={type} className="max-w-prose text-xs font-normal text-dark-gray">
                {QUIZ_TYPE_LABELS[type]} is unavailable: {reasonUnavailable(type)}
              </span>
            ))}
        </label>

        {/* No publish control here on purpose — see the note at the top of the file. */}

        <div className="flex flex-wrap items-start gap-6">
          {/* Whether they are told how they did at all. Off sends them straight on
              to the next element without a score. */}
          <ToggleSwitch
            checked={quiz.showResults}
            onChange={(v) =>
              run(
                () => quizApi.updateQuiz(quiz.id, { showResults: v }),
                v
                  ? 'Learners will see their score after submitting'
                  : 'Learners go straight on without seeing a score',
                'Failed to change result visibility',
              )
            }
            label="Show results"
            hint="The score ring after submitting"
          />

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

          {/* Only an exam has sittings to count. A learning check keeps no mark,
              so having another go at one costs nothing and is always offered; a
              one-time link is defined by never offering it. */}
          {quiz.type === 'EXAM' && (
            <ToggleSwitch
              checked={quiz.allowMultipleAttempts === true}
              onChange={(v) =>
                run(
                  () => quizApi.updateQuiz(quiz.id, { allowMultipleAttempts: v }),
                  v ? 'Learners can retake this exam' : 'Learners get one attempt at this exam',
                  'Failed to change how many attempts are allowed',
                )
              }
              label="Allow multiple attempts"
              hint="Adds Try again to the result screen, and when they come back to it"
            />
          )}

          {/* A learning check is never chased, so it has no deadline to set.
              The deadline itself is a length rather than a date: the same quiz
              goes out to different people at different times, and one fixed date
              would give the last of them a week and the first a month. */}
          <label
            className={`flex flex-col gap-1 text-sm font-medium ${
              can.canHaveDueDate ? 'text-dark-gray' : 'text-dark-gray/40'
            }`}
          >
            Days remaining
            <Input
              type="number"
              min={1}
              disabled={!can.canHaveDueDate}
              value={can.canHaveDueDate ? daysRemaining : ''}
              onChange={(e) => setDaysRemaining(e.target.value)}
              onBlur={saveDaysRemaining}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              placeholder={can.canHaveDueDate ? 'No deadline' : 'Never due'}
              title={
                can.canHaveDueDate
                  ? 'How long a learner gets once this quiz is assigned to them.'
                  : 'A learning check is not marked, so it has no deadline'
              }
              className={`${inputClass} max-w-32 disabled:cursor-not-allowed disabled:bg-gray-100`}
            />
            {can.canHaveDueDate && (
              <span className="max-w-56 text-xs font-normal text-dark-gray">
                Days from being assigned.
                {dueIfAssignedToday(daysRemaining) &&
                  ` Assigned today, due ${dueIfAssignedToday(daysRemaining)}.`}
              </span>
            )}
          </label>

          {/* Saves on blur rather than per keystroke: half-typed "3" on the way to
              "30" is a valid time limit, and would otherwise be saved as one. */}
          <label
            className={`flex flex-col gap-1 text-sm font-medium ${
              can.canBeTimed ? 'text-dark-gray' : 'text-dark-gray/40'
            }`}
          >
            Time limit (mins)
            <Input
              type="number"
              min={1}
              disabled={!can.canBeTimed}
              value={can.canBeTimed ? timeLimit : ''}
              onChange={(e) => setTimeLimit(e.target.value)}
              onBlur={saveTimeLimit}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              placeholder={can.canBeTimed ? 'No limit' : 'Never timed'}
              title={
                can.canBeTimed
                  ? 'Minutes the learner gets once they start. Leave blank for untimed.'
                  : 'A learning check is never timed'
              }
              className={`${inputClass} max-w-28 disabled:cursor-not-allowed disabled:bg-gray-100`}
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

        {/* Where it lives, which the kind decides. Stated rather than hidden: an
            author changing the type needs to see what that did to the placement. */}
        <p className="text-xs text-dark-gray">
          {quiz.type === 'ONE_TIME'
            ? 'Reached only through the link you send. It never appears on the Quizzes tab, even ' +
              'for somebody signed in with the address it went to.'
            : quiz.sectionId
              ? 'Sits inside a section, in the content order you dropped it at.'
              : 'Stands on its own — reached from the Quizzes tab or through a shared link.'}
        </p>
      </div>

      <hr className="h-px border-t-0 bg-gray-300" />

      {/* Questions */}
      {quiz.questions.map((question) => {
        const isEditing = editingId === question.id;
        // Only the row being edited can have moved on from what is stored; every
        // other one is, by definition, exactly what came back from the server.
        const dirty = isEditing && JSON.stringify(editDraft) !== JSON.stringify(toDraft(question));

        return (
          <div key={question.id} className="rounded-lg border border-gray-300 bg-white p-4">
            <div className="flex items-start justify-between gap-4">
              <p className="min-w-0 break-words font-semibold text-dark-gray">
                {question.order}.{!isEditing && ` ${question.prompt}`}
                {isEditing && ' Editing question'}
              </p>
              <div className="flex shrink-0 items-center gap-1">
                {/* A question in the list is a stored question, and saying
                    nothing about it read as the opposite — see saveStatus. */}
                <span className="text-xs text-dark-gray">
                  {isEditing ? saveStatus(editState, dirty) : 'Saved'}
                </span>
                {isEditing && (
                  <Button
                    onClick={saveEditNow}
                    disabled={editState === 'saving'}
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 hover:text-green-hover"
                    title="Save this question now"
                  >
                    <CheckIcon className="w-4 h-4" />
                  </Button>
                )}
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
