/**
 * File: question-fields.tsx
 * Description: The prompt, hint and options editor for one multiple-choice question.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
/**
 * The prompt, hint and options editor for one multiple-choice question.
 *
 * Shared by every place a question can be written — the standalone quiz page and
 * the quiz editor inside a section — so the two cannot drift apart.
 *
 * Declared at module scope on purpose: nesting it inside a page component would
 * remount it on every keystroke and drop the caret.
 */
import { TrashIcon } from '@heroicons/react/24/outline';
import { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

export interface QuestionDraft {
  prompt: string;
  hint: string;
  hintSectionNumber: string;
  options: string[];
  /**
   * Which options are correct, by index.
   *
   * A set rather than a single index because a question may have more than one
   * right answer. One entry is an ordinary multiple-choice question and the
   * learner sees radio buttons; two or more makes it multiple-answer and they
   * see checkboxes.
   */
  correctIndexes: number[];
}

/**
 * Four blank options, because four is what a multiple-choice question almost
 * always has — starting at two made every question begin with two clicks of
 * "Add Option". Empty ones are dropped on save rather than refused, so a
 * two-answer question is still two clicks away in the other direction.
 */
export const emptyQuestionDraft = (): QuestionDraft => ({
  prompt: '',
  hint: '',
  hintSectionNumber: '',
  options: ['', '', '', ''],
  correctIndexes: [0],
});

/**
 * Mirrors the server rules — at least two options, all with text, at least one
 * correct and at least one not — so adding and editing are checked the same way.
 * Returns the API payload, or null after reporting what is wrong.
 */
export function toQuestionInput(draft: QuestionDraft, fail: (message: string) => void) {
  if (!draft.prompt.trim()) {
    fail('Question needs a prompt');
    return null;
  }

  /*
   * Blank options are dropped, not rejected.
   *
   * The form now opens with four boxes, and a question with three answers should
   * not have to have the fourth deleted before it will save. The marks move with
   * the options that survive, so ticking box 2 and leaving box 3 empty still
   * marks the right one.
   */
  const kept = draft.options
    .map((text, index) => ({ text: text.trim(), correct: draft.correctIndexes.includes(index) }))
    .filter((option) => option.text !== '');

  const options = kept.map((option) => option.text);
  const correct = new Set(kept.flatMap((option, index) => (option.correct ? [index] : [])));

  if (options.length < 2) {
    fail('Add at least 2 options');
    return null;
  }
  if (correct.size === 0) {
    fail('Mark at least one option correct');
    return null;
  }
  if (correct.size === options.length) {
    fail('Leave at least one option incorrect, or there is nothing to answer');
    return null;
  }

  return {
    prompt: draft.prompt.trim(),
    hint: draft.hint.trim() || null,
    hintSectionNumber: draft.hintSectionNumber.trim() || null,
    options: options.map((text, index) => ({ text, isCorrect: correct.has(index) })),
  };
}

/** Whether a draft has anything in it worth saving. */
export function questionDraftIsEmpty(draft: QuestionDraft): boolean {
  return (
    draft.prompt.trim() === '' &&
    draft.hint.trim() === '' &&
    draft.options.every((option) => option.trim() === '')
  );
}

interface QuestionFieldsProps {
  draft: QuestionDraft;
  /** Input groups must be unique per editor or they interfere with each other. */
  radioName: string;
  onChange: (patch: Partial<QuestionDraft>) => void;
  onTooFewOptions: () => void;
  /** Save/Cancel buttons, rendered beside "Add Option". */
  actions: ReactNode;
  /**
   * Shows the options without letting them be changed — no ticks, no removing,
   * no adding. For a directed learning quiz, whose options are the course map's
   * connections and so are edited on the map rather than here.
   */
  fixedOptions?: boolean;
}

const inputClass = 'bg-white text-dark-gray';

const QuestionFields = ({
  draft,
  radioName,
  onChange,
  onTooFewOptions,
  actions,
  fixedOptions = false,
}: QuestionFieldsProps) => {
  const correct = new Set(draft.correctIndexes);
  const multi = correct.size > 1;

  /**
   * Ticking an option.
   *
   * The single/multiple distinction is not a mode the author sets — it falls out
   * of how many boxes are ticked, which is the same thing the learner will see.
   * Untucking the last one is refused rather than silently allowed, because a
   * question with no right answer cannot be passed and the server refuses it
   * anyway; better to say so at the click than at the save.
   */
  const toggle = (index: number) => {
    const next = new Set(correct);
    if (next.has(index)) {
      if (next.size === 1) return;
      next.delete(index);
    } else {
      next.add(index);
    }
    onChange({ correctIndexes: [...next].sort((a, b) => a - b) });
  };

  return (
    <>
      <Textarea
        value={draft.prompt}
        onChange={(e) => onChange({ prompt: e.target.value })}
        placeholder="Question prompt"
        rows={2}
        className={`${inputClass} mb-3 resize-none`}
      />

      {/* Just a hint. It used to carry a section number as well, which only made
          sense for a quiz sitting inside a lesson — a standalone one has no
          section to point at, and the field was dead weight there. */}
      <Input
        value={draft.hint}
        onChange={(e) => onChange({ hint: e.target.value })}
        placeholder="Hint (optional)"
        className={`${inputClass} mb-3`}
      />

      {fixedOptions ? (
        <>
          <p className="mb-1 text-sm font-medium text-dark-gray">Options</p>
          <p className="mb-2 text-xs text-dark-gray">
            Set by the course map — one per branch the learner can pick. Change them on the Course
            mapping tab.
          </p>
          <ul className="flex flex-col gap-2">
            {draft.options.map((option, index) => (
              <li
                key={index}
                className="rounded-md border border-gray-300 bg-gray-100 px-3 py-2 text-sm
                  text-dark-gray"
              >
                {option}
              </li>
            ))}
          </ul>
          <div className="mt-4 flex flex-wrap gap-3">{actions}</div>
        </>
      ) : (
        <>
          <p className="mb-1 text-sm font-medium text-dark-gray">
            Options — tick every correct answer
          </p>
          <p className="mb-2 text-xs text-dark-gray">
            {multi
              ? `${correct.size} correct answers: the learner sees checkboxes and must pick ` +
                'all of them.'
              : 'One correct answer: the learner sees radio buttons. Tick a second to make it a ' +
                'multiple-answer question.'}
          </p>
          <div className="flex flex-col gap-2">
            {draft.options.map((option, index) => (
              <div key={index} className="flex items-center gap-3">
                <input
                  type="checkbox"
                  name={`${radioName}-${index}`}
                  checked={correct.has(index)}
                  onChange={() => toggle(index)}
                  aria-label={`Mark option ${index + 1} correct`}
                  className="h-4 w-4 shrink-0 accent-[#5b9748]"
                />
                <Input
                  value={option}
                  onChange={(e) => {
                    const options = [...draft.options];
                    options[index] = e.target.value;
                    onChange({ options });
                  }}
                  placeholder={`Option ${index + 1}`}
                  className={`${inputClass} flex-1`}
                />
                <Button
                  onClick={() => {
                    if (draft.options.length <= 2) return onTooFewOptions();
                    const options = draft.options.filter((_, i) => i !== index);
                    // Every mark after the removed option shifts down with it, so the
                    // ticks stay on the options they were actually put on.
                    const shifted = [...correct]
                      .filter((mark) => mark !== index)
                      .map((mark) => (mark > index ? mark - 1 : mark));
                    onChange({
                      options,
                      // Removing the only correct option would leave the question
                      // unanswerable, so the first option inherits the mark.
                      correctIndexes: shifted.length > 0 ? shifted : [0],
                    });
                  }}
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 hover:text-danger-hover"
                  title="Remove option"
                >
                  <TrashIcon className="w-4 h-4" />
                </Button>
              </div>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap gap-3">
            <Button
              onClick={() => onChange({ options: [...draft.options, ''] })}
              variant="outline"
              className="bg-white text-dark-gray hover:bg-light-gray"
            >
              Add Option
            </Button>
            {actions}
          </div>
        </>
      )}
    </>
  );
};

export default QuestionFields;
