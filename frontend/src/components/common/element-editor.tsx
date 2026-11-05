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
 *
 * It is the one thing in the main editor, so it is always open: picking another
 * piece of content in the course structure is how an author moves between them.
 */
import { ArrowUpTrayIcon, CheckIcon, TrashIcon } from '@heroicons/react/24/outline';
import { useEffect, useRef, useState } from 'react';

import CanvasEditor from '@/components/canvas/canvas-editor';
import { CanvasImageAsset, CanvasItem, layoutOf } from '@/components/canvas/canvas-model';
import EditedTag from '@/components/common/edited-tag';
import ElementView, { plainPreview } from '@/components/common/element-view';
import RichTextEditor from '@/components/common/rich-text-editor';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Spinner from '@/components/ui/spinner';
import { saveStatus, useAutoSave } from '@/hooks/use-auto-save';
import { curriculumApi, EditMark, SectionElement, UPLOAD_ACCEPT } from '@/services/curriculum-api';

interface ElementEditorProps {
  element: SectionElement;
  onDelete: () => void;
  /** Refresh the parent once a save lands, so counts and previews stay true. */
  onSaved: () => void | Promise<void>;
  onNotify?: (message: string, type?: 'success' | 'error') => void;
  /**
   * Set when this element has been changed since the last publish, naming who
   * changed it. Absent is the common case and draws nothing.
   */
  editedMark?: EditMark;
}

const inputClass = 'bg-white text-dark-gray';

/** "2 pictures, 1 text box" — what the collapsed row says about a canvas. */
function canvasSummary(items: Array<{ kind: string }>): string {
  if (items.length === 0) return 'Empty canvas';
  const names: Record<string, [string, string]> = {
    image: ['picture', 'pictures'],
    text: ['text box', 'text boxes'],
    shape: ['shape', 'shapes'],
  };
  return Object.entries(names)
    .map(([kind, [one, many]]) => {
      const count = items.filter((item) => item.kind === kind).length;
      return count ? `${count} ${count === 1 ? one : many}` : '';
    })
    .filter(Boolean)
    .join(', ');
}

/** What a block says about itself while it holds nothing yet. */
const EMPTY_SUMMARY: Record<SectionElement['type'], string> = {
  TEXT: 'Empty text',
  YOUTUBE: 'No link yet',
  IMAGE: 'No image yet',
  CANVAS: 'Empty canvas',
  PDF: 'Uploaded PDF',
};

/**
 * The one-line description of a block — the course structure lists content by
 * it, and the editor heads the open block with it.
 */
export function elementSummary(
  element: SectionElement,
  draft?: {
    textContent: string;
    videoUrl: string;
    imageUrl: string;
    canvas?: { items: Array<{ kind: string }> };
  },
): string {
  const text = draft?.textContent ?? element.textContent ?? '';
  const video = draft?.videoUrl ?? element.videoUrl ?? '';
  const image = draft?.imageUrl ?? element.imageUrl ?? '';
  switch (element.type) {
    case 'TEXT':
      return plainPreview(text) || EMPTY_SUMMARY.TEXT;
    case 'YOUTUBE':
      return video || EMPTY_SUMMARY.YOUTUBE;
    case 'CANVAS':
      return canvasSummary(draft?.canvas?.items ?? layoutOf(element.canvasData).items);
    case 'PDF':
      return element.fileName ?? EMPTY_SUMMARY.PDF;
    default:
      return element.fileName ?? (image || EMPTY_SUMMARY.IMAGE);
  }
}

const ElementEditor = ({
  element,
  onDelete,
  onSaved,
  onNotify,
  editedMark,
}: ElementEditorProps) => {
  const uploadRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  /** What is actually stored, in the shape the form holds it. */
  const stored = {
    textContent: element.textContent ?? '',
    videoUrl: element.videoUrl ?? '',
    imageUrl: element.imageUrl ?? '',
    durationMinutes: element.durationMinutes?.toString() ?? '',
    // Only the layout: a canvas's pictures are uploaded on their own and never
    // ride along with an auto-save.
    canvas: layoutOf(element.canvasData),
  };

  const [draft, setDraft] = useState(stored);

  /**
   * Pictures uploaded onto a canvas since the element was last fetched. The
   * server has them already; holding them here means they show the moment the
   * upload lands rather than after the next refresh.
   */
  const [uploaded, setUploaded] = useState<Record<string, CanvasImageAsset>>({});
  const canvasImages = { ...element.canvasData?.images, ...uploaded };

  /**
   * The items every new canvas in this course starts with — null while they
   * load, and left empty if they cannot be loaded, so the canvas still works.
   */
  const [canvasDefaults, setCanvasDefaults] = useState<CanvasItem[] | null>(null);
  useEffect(() => {
    if (element.type !== 'CANVAS') return;
    let live = true;
    setCanvasDefaults(null);
    curriculumApi
      .getCanvasTemplate(element.id)
      .then((items) => live && setCanvasDefaults(items))
      .catch(() => live && setCanvasDefaults([]));
    return () => {
      live = false;
    };
  }, [element.id, element.type]);

  // Pull in changes that came from elsewhere (a reorder, another tab).
  useEffect(() => {
    setDraft({
      textContent: element.textContent ?? '',
      videoUrl: element.videoUrl ?? '',
      imageUrl: element.imageUrl ?? '',
      durationMinutes: element.durationMinutes?.toString() ?? '',
      canvas: layoutOf(element.canvasData),
    });
    setUploaded({});
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
      canvas: element.type === 'CANVAS' ? value.canvas : undefined,
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

  const summary = elementSummary(element, draft);

  /** Puts a file from the author's computer into this block, replacing what it held. */
  const upload = async (file: File) => {
    setUploading(true);
    try {
      await curriculumApi.uploadElementFile(element.id, file);
      await onSaved();
      onNotify?.('File added');
    } catch (err) {
      onNotify?.(err instanceof Error && err.message ? err.message : 'Failed to upload', 'error');
    } finally {
      setUploading(false);
    }
  };

  const takesUpload = element.type === 'IMAGE' || element.type === 'PDF';
  const uploadButton = takesUpload && (
    <>
      <input
        ref={uploadRef}
        type="file"
        accept={UPLOAD_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          // Cleared first, so picking the same file again after a failure still fires.
          e.target.value = '';
          if (file) upload(file);
        }}
      />
      <Button
        onClick={() => uploadRef.current?.click()}
        disabled={uploading}
        variant="outline"
        className="bg-white text-dark-gray hover:bg-light-gray"
      >
        {uploading ? (
          <>
            <Spinner className="w-5 h-5" /> Uploading…
          </>
        ) : (
          <>
            <ArrowUpTrayIcon className="w-5 h-5" /> Upload
          </>
        )}
      </Button>
    </>
  );

  return (
    <div
      className={`rounded-lg border bg-white
        ${element.type === 'PDF' ? 'border-navy/30' : 'border-gray-300'}`}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="flex min-h-10 min-w-0 flex-1 flex-col justify-center gap-1">
          <span className="w-full truncate text-sm text-dark-gray">
            <span className="font-semibold">{element.type}</span> {summary}
          </span>
          <EditedTag mark={editedMark} />
        </span>

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
          <div className="flex flex-wrap gap-3">
            <Input
              value={draft.imageUrl}
              onChange={(e) => setDraft({ ...draft, imageUrl: e.target.value })}
              placeholder="Paste an image URL, or upload one"
              className={`${inputClass} min-w-60 flex-1`}
            />
            {uploadButton}
          </div>
        )}

        {element.type === 'IMAGE' && element.imageData && (
          <div className="flex flex-wrap items-center gap-3">
            <p className="min-w-0 flex-1 truncate text-sm text-dark-gray">
              {element.fileName ?? 'Uploaded image'}
            </p>
            {uploadButton}
          </div>
        )}

        {element.type === 'CANVAS' && (
          <CanvasEditor
            layout={draft.canvas}
            onChange={(canvas) => setDraft((prev) => ({ ...prev, canvas }))}
            images={canvasImages}
            onUpload={async (file) => {
              const { imageId, ...asset } = await curriculumApi.uploadCanvasImage(element.id, file);
              setUploaded((prev) => ({ ...prev, [imageId]: asset }));
              return { imageId, asset };
            }}
            defaults={canvasDefaults}
            onToggleDefault={async (item, include) => {
              setCanvasDefaults(
                await curriculumApi.setCanvasTemplateItem(element.id, item, include),
              );
              onNotify?.(
                include
                  ? 'New canvases in this course will start with this'
                  : 'Removed from the course defaults',
              );
            }}
          />
        )}

        {element.type === 'PDF' && (
          <div className="flex flex-wrap items-center gap-3">
            <p className="min-w-0 flex-1 truncate text-sm text-dark-gray">
              {element.fileName ?? 'Uploaded PDF'}
            </p>
            {uploadButton}
          </div>
        )}

        {/* A canvas is built on the slide itself and the text editor already
            shows text as it will look, so a second copy underneath would only
            repeat them. A block with nothing in it has nothing to show. */}
        {element.type !== 'CANVAS' &&
          element.type !== 'TEXT' &&
          summary !== EMPTY_SUMMARY[element.type] && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-dark-gray">
                Preview
              </p>
              <div className="rounded-lg border border-gray-300 bg-light-gray p-4">
                <ElementView element={previewElement} preview />
              </div>
            </div>
          )}
      </div>
    </div>
  );
};

export default ElementEditor;
