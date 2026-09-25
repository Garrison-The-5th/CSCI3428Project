/**
 * File: quiz-editor.tsx
 * Description: Everything you can do to one quiz: rename it, set how it is marked, write questions.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-09-22
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
import { Bars3Icon, CheckIcon, PencilIcon, TrashIcon } from '@heroicons/react/24/outline';
import { useEffect, useState } from 'react';

import ConfirmDialog from '@/components/common/confirm-dialog';
import EditedTag from '@/components/common/edited-tag';
import QuestionFields, {
  emptyQuestionDraft,
  QuestionDraft,
  questionDraftIsEmpty,
  toQuestionInput,
} from '@/components/common/question-fields';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import LockOverlay from '@/components/ui/lock-overlay';
import ToggleSwitch from '@/components/ui/toggle-switch';
import { useEditLocks } from '@/contexts/edit-locks-context';
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
  /**
   * The estimate shown in Settings, and how to save it.
   *
   * Passed in because it does not live on the quiz: for a quiz set it is the
   * section's `estimatedMinutes`, which is the row carrying the quiz's name and
   * order. The editor owns the field so that everything an author sets about a
   * quiz is in one place, and the caller owns where it is written.
   */
  estimatedMinutes?: number | null;
  onSaveEstimatedMinutes?: (minutes: number) => Promise<unknown>;
  /**
   * Renames the quiz, when the caller has to do more than rename the quiz.
   *
   * A quiz set names the same thing twice — on the section that carries its
   * order and on the quiz itself — and they are one name to an author, so a
   * rename has to move both. Left out, the editor writes the quiz's own title
   * and nothing else, which is right everywhere else.
   */
  onSaveTitle?: (title: string) => Promise<unknown>;
  /**
   * Whether the deadline shuts this quiz, and how to change it.
   *
   * Passed in for the same reason the estimate is: it belongs to the course, and
   * a quiz set is a course. The editor renders the switch so that everything an
   * author sets about a quiz is in one place, and the caller owns where it goes.
   */
  lockAfterDue?: boolean;
  onSaveLockAfterDue?: (lock: boolean) => Promise<unknown>;
}

const inputClass = 'bg-white text-dark-gray';
const primaryBtn = 'bg-navy text-white hover:bg-navy-hover';

/** The two fixed rows at the top of the sidebar, which are not questions. */
type Pane = 'settings' | 'new';

const QuizEditor = ({
  quiz,
  onChanged,
  onNotify,
  showTitle = true,
  typeChoices,
  unavailableTypes,
  estimatedMinutes,
  onSaveEstimatedMinutes,
  onSaveTitle,
  lockAfterDue,
  onSaveLockAfterDue,
}: QuizEditorProps) => {
  /**
   * What the right-hand pane is showing: Settings, a new question, or one of
   * the existing questions.
   *
   * Settings on open, always. It is the only thing that is true of the quiz as a
   * whole, and an editor that opened on whichever question happened to be first
   * made the quiz's own properties feel like something hidden behind them.
   */
  const [pane, setPane] = useState<Pane | string>('settings');

  /** The question being dragged, for reordering the sidebar. */
  const [dragId, setDragId] = useState<string | null>(null);

  /**
   * Questions somebody else has open, and how this editor says it has one.
   *
   * Read from context rather than passed in: the panes between here and the
   * course editor have no interest in who is editing what, and threading it
   * through them would put the plumbing in three files that never use it.
   * Outside a course editor there is no provider and nothing is ever locked,
   * which is the right answer for a preview.
   */
  const { lockedQuestions, claim, marks } = useEditLocks();
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
    const next = value.trim();
    if (!next) return;
    // The caller renames it where a rename means more than one write — see
    // `onSaveTitle`. Otherwise the quiz's own title is the whole of it.
    await (onSaveTitle ? onSaveTitle(next) : quizApi.updateQuiz(quiz.id, { title: next }));
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

  /**
   * Opens one question in the right-hand pane, claiming it as we go.
   *
   * The claim is the caller's to make — it knows the course the quiz belongs to
   * and this does not — so this only reports the move.
   */
  const openQuestion = (question: QuizQuestion) => {
    if (lockedQuestions[question.id]) return;
    setPane(question.id);
    startEditing(question);
    claim('QUESTION', question.id);
  };

  /** Leaves whatever question was open, giving up its claim. */
  const leaveQuestion = (next: Pane) => {
    setPane(next);
    setEditingId(null);
    claim('QUESTION', null);
  };

  /**
   * Drops the dragged question in front of the one it was released on.
   *
   * The whole order is sent rather than a "move this there" instruction: the
   * server refuses a list that is not exactly this quiz's questions, which turns
   * a stale tab into a refusal instead of a silently scrambled quiz.
   */
  const dropOn = async (targetId: string) => {
    const from = dragId;
    setDragId(null);
    if (!from || from === targetId) return;

    const ids = quiz.questions.map((question) => question.id);
    const without = ids.filter((id) => id !== from);
    const at = without.indexOf(targetId);
    if (at < 0) return;

    await run(
      () =>
        quizApi.reorderQuestions(quiz.id, [...without.slice(0, at), from, ...without.slice(at)]),
      'Questions reordered',
      'Failed to reorder the questions',
    );
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

  /**
   * Everything true of the quiz as a whole. The first thing the sidebar offers
   * and what the editor opens on.
   */
  const settingsPane = (
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
          <Input value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} />
        </label>
      )}

      {/* What kind of quiz this is. Everything below reads off it, so it sits
            first: changing it is what turns other controls on and off.

            Fixed once the quiz has been published. Its kind decides how a
            learner can be given it, and there is no edit that undoes having
            given it the old way — an exam shared with somebody who has an
            account sits on their Quizzes tab, and relabelling it a one-time link
            afterwards leaves it sitting there. */}
      <label className="flex flex-col gap-1 text-sm font-medium text-dark-gray">
        Quiz type
        {/*
            Only the picker goes under the sheet, and only as wide as it is.

            The label and the hints below it are still worth reading on a locked
            quiz — more so, in fact, since they say what kind it settled on. It
            is the choice that is closed, not the explanation of it. The wrapper
            is bounded to the dropdown's width rather than left to fill the pane
            and grey out the empty space beside it.

            No caption on the sheet either. It would have to be short enough to
            fit a 14rem control and would still be a worse explanation than the
            paragraph directly underneath, which has room to give the reason. The
            padlock says "locked"; the prose says why.
          */}
        {/* The width is set on the wrapper and the control fills it, so the
            sheet and the dropdown are the same box by construction rather than
            by two numbers that have to be kept equal. */}
        <LockOverlay locked={quiz.typeLocked === true} className="w-56 max-w-full">
          <select
            value={quiz.type}
            onChange={(e) => changeType(e.target.value as QuizType)}
            disabled={quiz.typeLocked === true}
            className="h-9 w-full rounded-md border border-gray-300 bg-white px-2 text-sm
              text-dark-gray disabled:cursor-not-allowed disabled:bg-gray-100"
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
        </LockOverlay>
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

      {quiz.typeLocked && (
        <p className="max-w-prose text-xs text-dark-gray">
          This quiz has been published, it cannot be changed.
        </p>
      )}

      {/* No publish control here on purpose — see the note at the top of the file. */}

      {/*
        The switches, in alphabetical order.

        There is no meaningful precedence between them — they are four unrelated
        yes/no questions about the same quiz — so any order is arbitrary and an
        arbitrary order that an author can predict beats one they have to search.
        Stacked rather than laid across the pane so the list stays scannable when
        one of them is hidden.
      */}
      <div className="flex flex-col items-start gap-3">
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
            hint="Adds Restart Quiz to the result screen, and when they come back to it"
          />
        )}

        {/* What the deadline actually does, which is the author's to decide —
            see the same switch on a lesson's landing page. */}
        {onSaveLockAfterDue && (
          <ToggleSwitch
            checked={lockAfterDue !== false}
            onChange={(v) =>
              run(
                () => onSaveLockAfterDue(v),
                v ? 'Locked once the due date passes' : 'Learners can carry on past the due date',
                'Failed to change what the deadline does',
              )
            }
            label="Lock after the due date"
            hint="Off, and it is still marked overdue but can still be taken"
          />
        )}

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
      </div>

      {/*
        No deadline field anywhere here.

        A quiz's deadline is never its own. One inside a course falls due with
        the course around it — one piece of work, one date — and a quiz set is a
        course, so its deadline is set where every other course's is: on the
        landing page, in days. Offering a second number here could only disagree
        with that one.
      */}

      {/*
        The two minutes fields, side by side and below the switches.

        They are the pair most easily confused — this is the estimate that feeds
        the card totals, that is the clock the learner races — and reading them
        against each other is the fastest way to keep them apart. Naming them
        differently was not enough while they sat in different rows.
      */}
      <div className="flex flex-wrap items-start gap-6">
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

        {onSaveEstimatedMinutes && (
          <label
            className="flex flex-col gap-1 text-sm font-medium text-dark-gray"
            title="Roughly how long this takes, for the totals. The countdown is Time limit."
          >
            Estimated time (mins)
            <Input
              type="number"
              min={0}
              defaultValue={String(estimatedMinutes ?? 0)}
              onBlur={(e) =>
                run(
                  () => onSaveEstimatedMinutes(Number(e.target.value) || 0),
                  'Estimate updated',
                  'Failed to update the estimate',
                )
              }
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              className={`${inputClass} max-w-28`}
            />
          </label>
        )}
      </div>

      {/*
        No delete button here.

        Deleting the quiz is not a setting, and it sat one careless click from
        the fields around it. It belongs with the other destructive actions in
        the shell that owns the quiz, which is also the only place that knows
        what deleting it takes with it.
      */}

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
  );

  /** The form for whichever question is open, filling the right-hand pane. */
  const questionPane = (question: QuizQuestion) => {
    const dirty = JSON.stringify(editDraft) !== JSON.stringify(toDraft(question));

    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h4 className="min-w-0 break-words font-semibold text-dark-gray">
            Question {question.order}
          </h4>
          <span className="flex shrink-0 items-center gap-1">
            <span className="text-xs text-dark-gray">{saveStatus(editState, dirty)}</span>
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
          </span>
        </div>

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
                onClick={() => leaveQuestion('settings')}
                variant="outline"
                className="bg-white text-dark-gray hover:bg-light-gray"
              >
                Done
              </Button>
            </>
          }
        />
      </div>
    );
  };

  /** A blank question, which is always the second row in the sidebar. */
  const newQuestionPane = (
    <div className="flex flex-col gap-3">
      <h4 className="font-semibold text-dark-gray">New question</h4>
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
  );

  /** One of the two fixed rows at the top of the sidebar. */
  const fixedRow = (key: Pane, label: string, hint: string) => (
    <button
      onClick={() => leaveQuestion(key)}
      className={`flex w-full flex-col gap-0.5 rounded-md px-3 py-2 text-left ${
        pane === key ? 'bg-navy text-white' : 'text-dark-gray hover:bg-white'
      }`}
    >
      <span className="text-sm font-semibold">{label}</span>
      <span className={`text-xs ${pane === key ? 'text-white/80' : 'text-dark-gray'}`}>{hint}</span>
    </button>
  );

  const openQuestionRow = quiz.questions.find((question) => question.id === pane) ?? null;

  return (
    <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
      {/*
        The list of what this quiz is made of, and the only way between the
        pieces. Settings first, a new question second, then the questions
        themselves in the order a learner meets them — which is also the order
        they can be dragged into.
      */}
      <aside
        className="flex h-fit flex-col gap-1 rounded-lg border border-gray-300 bg-light-gray p-2"
      >
        {fixedRow('settings', 'Settings', 'Title, type, timing')}
        {fixedRow('new', 'New question', 'Add one to the end')}

        <hr className="my-1 h-px border-t-0 bg-gray-300" />

        {quiz.questions.length === 0 ? (
          <p className="px-3 py-4 text-center text-xs text-dark-gray">No questions yet.</p>
        ) : (
          quiz.questions.map((question) => {
            const lockedBy = lockedQuestions[question.id];
            const isOpen = pane === question.id;

            return (
              <div
                key={question.id}
                draggable={!lockedBy}
                onDragStart={() => setDragId(question.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => dropOn(question.id)}
                onDragEnd={() => setDragId(null)}
                className={`flex items-center gap-1 rounded-md px-1 ${
                  isOpen ? 'bg-navy text-white' : 'text-dark-gray hover:bg-white'
                }
                  ${dragId === question.id ? 'opacity-50' : ''}`}
              >
                <Bars3Icon
                  className={`w-4 h-4 shrink-0 ${lockedBy ? 'opacity-30' : 'cursor-grab'}`}
                  aria-hidden="true"
                />

                {/*
                  The prompt is the question's name here; there is nothing
                  shorter that identifies it. The "last edited by" tag goes
                  underneath rather than beside it, because a name long enough to
                  fill the row used to push the buttons on the right past the
                  edge of the sidebar and put delete out of reach.
                */}
                <button
                  onClick={() => openQuestion(question)}
                  disabled={Boolean(lockedBy)}
                  title={lockedBy ? `${lockedBy} is editing this` : question.prompt}
                  className="flex min-h-14 min-w-0 flex-1 flex-col items-start justify-center gap-1
                    py-2 text-left text-sm disabled:cursor-not-allowed"
                >
                  <span className="w-full truncate">
                    {question.order}. {question.prompt || 'Untitled question'}
                  </span>
                  <EditedTag mark={marks.questions[question.id]} />
                </button>

                <span className="flex shrink-0 items-center gap-0.5">
                  <span className={`text-[10px] ${isOpen ? 'text-white/80' : 'text-dark-gray'}`}>
                    {isOpen ? saveStatus(editState, false) : 'Saved'}
                  </span>
                  {/*
                    Red while somebody else has it open, which is the one state
                    where clicking would lose work rather than merely be
                    inconvenient. It is the pencil that turns, not the row: the
                    row still has to be readable.
                  */}
                  <Button
                    onClick={() => openQuestion(question)}
                    disabled={Boolean(lockedBy)}
                    variant="ghost"
                    size="icon"
                    className={`h-7 w-7 ${
                      lockedBy
                        ? 'text-danger disabled:opacity-100'
                        : isOpen
                          ? 'text-white hover:text-white'
                          : 'hover:text-green-hover'
                      }`}
                    title={lockedBy ? `${lockedBy} is editing this` : 'Edit question'}
                  >
                    <PencilIcon className="w-4 h-4" />
                  </Button>
                  <Button
                    onClick={() => setPendingQuestion({ id: question.id, label: question.prompt })}
                    disabled={Boolean(lockedBy)}
                    variant="ghost"
                    size="icon"
                    className={`h-7 w-7 ${
                      isOpen ? 'text-white hover:text-white' : 'hover:text-danger-hover'
                    }`}
                    title={lockedBy ? `${lockedBy} is editing this` : 'Delete question'}
                  >
                    <TrashIcon className="w-4 h-4" />
                  </Button>
                </span>
              </div>
            );
          })
        )}
      </aside>

      <div className="min-w-0 rounded-lg border border-gray-300 bg-white p-4">
        {pane === 'settings'
          ? settingsPane
          : pane === 'new'
            ? newQuestionPane
            : openQuestionRow
              ? questionPane(openQuestionRow)
              : /* The open question was deleted or reordered away underneath us. */
                settingsPane}
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
