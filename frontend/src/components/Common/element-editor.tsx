/**
 * File: element-editor.tsx
 * Description: One editable piece of module content.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
/**
 * One editable piece of module content.
 *
 * Edits save themselves a moment after typing stops — there is no save button.
 * The preview underneath is the same component the learner sees, so what you are
 * looking at is what gets published.
 */
import { Bars3Icon, ChevronDownIcon, TrashIcon } from '@heroicons/react/24/outline';
import { useEffect, useState } from 'react';

import ElementView, { plainPreview } from '@/components/common/element-view';
import RichTextEditor from '@/components/common/rich-text-editor';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { saveLabel, useAutoSave } from '@/hooks/use-auto-save';
import { curriculumApi, ModuleElement } from '@/services/curriculum-api';

interface ElementEditorProps {
  element: ModuleElement;
  onDelete: () => void;
  /** Refresh the parent once a save lands, so counts and previews stay true. */
  onSaved: () => void;
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>;
  dragging?: boolean;
}

const inputClass = 'bg-white text-dark-gray';

const ElementEditor = ({
  element,
  onDelete,
  onSaved,
  dragHandleProps,
  dragging,
}: ElementEditorProps) => {
  const [draft, setDraft] = useState({
    textContent: element.textContent ?? '',
    videoUrl: element.videoUrl ?? '',
    imageUrl: element.imageUrl ?? '',
    durationMinutes: element.durationMinutes?.toString() ?? '',
  });
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

  const { state } = useAutoSave(draft, async (value) => {
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
  const previewElement: ModuleElement = {
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

        <button
          onClick={() => setOpen(!open)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          aria-expanded={open}
        >
          <ChevronDownIcon
            className={`w-4 h-4 shrink-0 text-dark-gray transition-transform duration-200
              ${open ? 'rotate-180' : ''}`}
          />
          <span className="min-w-0 flex-1 truncate text-sm text-dark-gray">
            <span className="font-semibold">{element.type}</span> {summary}
          </span>
        </button>

        <span className="shrink-0 text-xs text-dark-gray">{saveLabel(state)}</span>

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
