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
 * the quiz editor inside a module — so the two cannot drift apart.
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
  hintModuleNumber: string;
  options: string[];
  correctIndex: number;
}

export const emptyQuestionDraft = (): QuestionDraft => ({
  prompt: '',
  hint: '',
  hintModuleNumber: '',
  options: ['', ''],
  correctIndex: 0,
});

/**
 * Mirrors the server rules — at least two options, all with text, exactly one
 * correct — so adding and editing are checked the same way. Returns the API
 * payload, or null after reporting what is wrong.
 */
export function toQuestionInput(draft: QuestionDraft, fail: (message: string) => void) {
  const options = draft.options.map((text) => text.trim());

  if (!draft.prompt.trim()) {
    fail('Question needs a prompt');
    return null;
  }
  if (options.length < 2) {
    fail('Add at least 2 options');
    return null;
  }
  if (options.some((text) => !text)) {
    fail('Every option needs text');
    return null;
  }

  return {
    prompt: draft.prompt.trim(),
    hint: draft.hint.trim() || null,
    hintModuleNumber: draft.hintModuleNumber.trim() || null,
    options: options.map((text, index) => ({ text, isCorrect: index === draft.correctIndex })),
  };
}

interface QuestionFieldsProps {
  draft: QuestionDraft;
  /** Radio groups must be unique per editor or they interfere with each other. */
  radioName: string;
  onChange: (patch: Partial<QuestionDraft>) => void;
  onTooFewOptions: () => void;
  /** Save/Cancel buttons, rendered beside "Add Option". */
  actions: ReactNode;
}

const inputClass = 'bg-white text-dark-gray';

const QuestionFields = ({
  draft,
  radioName,
  onChange,
  onTooFewOptions,
  actions,
}: QuestionFieldsProps) => (
  <>
    <Textarea
      value={draft.prompt}
      onChange={(e) => onChange({ prompt: e.target.value })}
      placeholder="Question prompt"
      rows={2}
      className={`${inputClass} mb-3 resize-none`}
    />

    <div className="mb-3 flex flex-wrap gap-3">
      <Input
        value={draft.hint}
        onChange={(e) => onChange({ hint: e.target.value })}
        placeholder="Hint (optional)"
        className={`${inputClass} min-w-60 flex-1`}
      />
      <Input
        value={draft.hintModuleNumber}
        onChange={(e) => onChange({ hintModuleNumber: e.target.value })}
        placeholder="Refers to module (e.g. 1.2)"
        className={`${inputClass} max-w-56`}
      />
    </div>

    <p className="mb-2 text-sm font-medium text-dark-gray">
      Options — select the radio button for the correct answer
    </p>
    <div className="flex flex-col gap-2">
      {draft.options.map((option, index) => (
        <div key={index} className="flex items-center gap-3">
          <input
            type="radio"
            name={radioName}
            checked={draft.correctIndex === index}
            onChange={() => onChange({ correctIndex: index })}
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
              // Keep the correct answer pointing at the same option after removal.
              const correctIndex =
                draft.correctIndex === index
                  ? 0
                  : draft.correctIndex > index
                    ? draft.correctIndex - 1
                    : draft.correctIndex;
              onChange({ options, correctIndex });
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
);

export default QuestionFields;
