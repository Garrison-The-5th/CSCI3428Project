/**
 * File: element-editor.tsx
 * Description: One editable piece of section content.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
/**
 * One editable piece of section content.
 *
 * Edits save themselves a moment after typing stops. There is a Save button as
 * well, which does the same write without the pause — not because auto-save is
 * unreliable, but because "it saved itself" is a claim the author has to take on
 * trust, and a button they pressed is not.
 *
 * The status beside it says which of three states the row is in — stored, being
 * written, or edited and not yet written — rather than going blank whenever
 * nothing is happening. A freshly added video or photo is already stored, and
 * showing nothing there read as the opposite.
 *
 * The preview underneath is the same component the learner sees, so what you are
 * looking at is what gets published.
 */
import { Bars3Icon, CheckIcon, ChevronDownIcon, TrashIcon } from '@heroicons/react/24/outline';
import { useEffect, useState } from 'react';

import EditedTag from '@/components/common/edited-tag';
import ElementView, { plainPreview } from '@/components/common/element-view';
import RichTextEditor from '@/components/common/rich-text-editor';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { saveStatus, useAutoSave } from '@/hooks/use-auto-save';
import { curriculumApi, EditMark, SectionElement } from '@/services/curriculum-api';

interface ElementEditorProps {
  element: SectionElement;
  onDelete: () => void;
  /** Refresh the parent once a save lands, so counts and previews stay true. */
  onSaved: () => void;
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>;
  dragging?: boolean;
  /**
   * Set when this element has been changed since the last publish, naming who
   * changed it. Absent is the common case and draws nothing.
   */
  editedMark?: EditMark;
}

const inputClass = 'bg-white text-dark-gray';

const ElementEditor = ({
  element,
  onDelete,
  onSaved,
  dragHandleProps,
  dragging,
  editedMark,
}: ElementEditorProps) => {
  /** What is actually stored, in the shape the form holds it. */
  const stored = {
    textContent: element.textContent ?? '',
    videoUrl: element.videoUrl ?? '',
    imageUrl: element.imageUrl ?? '',
    durationMinutes: element.durationMinutes?.toString() ?? '',
  };

  const [draft, setDraft] = useState(stored);
  const [open, setOpen] = useState(false);

  // Pull in changes that came from elsewhere (a reorder, another tab).
  useEffect(() => {
    setDraft({
      textContent: element.textContent ?? '',
      videoUrl: element.videoUrl ?? '',
      imageUrl: element.imageUrl ?? '',
      durationMinutes: element.durationMinutes?.toString() ?? '',
    });
  }, [element.id]);

  /**
   * Whether the form has moved on from the record.
   *
   * Compared against the element rather than tracked as a flag, so it is right
   * after a save lands from anywhere — the parent refetches on every write, and
   * a flag would have to be told about that.
   */
  const dirty = JSON.stringify(draft) !== JSON.stringify(stored);

  const { state, saveNow } = useAutoSave(draft, async (value) => {
    await curriculumApi.updateElement(element.id, {
      textContent: element.type === 'TEXT' ? value.textContent : undefined,
      videoUrl: element.type === 'YOUTUBE' ? value.videoUrl : undefined,
      // An uploaded image has its own data; only linked ones use the URL field.
      imageUrl: element.type === 'IMAGE' && !element.imageData ? value.imageUrl : undefined,
      durationMinutes: element.type === 'YOUTUBE' ? Number(value.durationMinutes) || 0 : undefined,
    });
    onSaved();
  });

  /** What the preview should render — the draft, not the last saved copy. */
  const previewElement: SectionElement = {
    ...element,
    textContent: draft.textContent,
    videoUrl: draft.videoUrl,
    imageUrl: draft.imageUrl,
    durationMinutes: Number(draft.durationMinutes) || null,
  };

  const summary =
    element.type === 'TEXT'
      ? plainPreview(draft.textContent) || 'Empty text'
      : element.type === 'YOUTUBE'
        ? draft.videoUrl || 'No link yet'
        : (element.fileName ?? draft.imageUrl ?? 'Uploaded file');

  return (
    <div
      className={`rounded-lg border bg-white ${dragging ? 'opacity-50' : ''}
        ${element.type === 'PDF' ? 'border-navy/30' : 'border-gray-300'}`}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <div {...dragHandleProps} className="cursor-grab p-1" title="Drag to reorder">
          <Bars3Icon className="w-4 h-4 shrink-0 text-dark-gray" />
        </div>

        {/* The tag goes under the summary rather than beside it: a long name
            beside it pushed the save button and the bin past the right edge,
            and an unreachable delete is worse than a taller row. */}
        <button
          onClick={() => setOpen(!open)}
          className="flex min-h-10 min-w-0 flex-1 items-center gap-2 text-left"
          aria-expanded={open}
        >
          <ChevronDownIcon
            className={`w-4 h-4 shrink-0 text-dark-gray transition-transform duration-200
              ${open ? 'rotate-180' : ''}`}
          />
          <span className="flex min-w-0 flex-1 flex-col items-start gap-1">
            <span className="w-full truncate text-sm text-dark-gray">
              <span className="font-semibold">{element.type}</span> {summary}
            </span>
            <EditedTag mark={editedMark} />
          </span>
        </button>

        <span className="shrink-0 text-xs text-dark-gray">{saveStatus(state, dirty)}</span>

        <Button
          onClick={saveNow}
          disabled={state === 'saving'}
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 hover:text-green-hover"
          title="Save this item now"
        >
          <CheckIcon className="w-4 h-4" />
        </Button>

        <Button
          onClick={onDelete}
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 hover:text-danger-hover"
          title="Delete this item"
        >
          <TrashIcon className="w-4 h-4" />
        </Button>
      </div>

      {open && (
        <div className="flex flex-col gap-4 border-t border-gray-300 p-4">
          {element.type === 'TEXT' && (
            <RichTextEditor
              value={draft.textContent}
              onChange={(html) => setDraft({ ...draft, textContent: html })}
              placeholder="Write the lesson text..."
            />
          )}

          {element.type === 'YOUTUBE' && (
            <div className="flex flex-wrap gap-3">
              <Input
                value={draft.videoUrl}
                onChange={(e) => setDraft({ ...draft, videoUrl: e.target.value })}
                placeholder="YouTube video URL"
                className={`${inputClass} min-w-60 flex-1`}
              />
              <Input
                value={draft.durationMinutes}
                onChange={(e) => setDraft({ ...draft, durationMinutes: e.target.value })}
                placeholder="Length (min)"
                className={`${inputClass} max-w-36`}
              />
            </div>
          )}

          {element.type === 'IMAGE' && !element.imageData && (
            <Input
              value={draft.imageUrl}
              onChange={(e) => setDraft({ ...draft, imageUrl: e.target.value })}
              placeholder="Image URL"
              className={inputClass}
            />
          )}

          {element.type === 'IMAGE' && element.imageData && (
            <p className="text-sm text-dark-gray">
              Uploaded image. Delete this item and upload again to replace it.
            </p>
          )}

          {element.type === 'PDF' && (
            <p className="text-sm text-dark-gray">
              Uploaded PDF{element.fileName ? `: ${element.fileName}` : ''}.
            </p>
          )}

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-dark-gray">
              Preview
            </p>
            <div className="rounded-lg border border-gray-300 bg-light-gray p-4">
              <ElementView element={previewElement} preview />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ElementEditor;
