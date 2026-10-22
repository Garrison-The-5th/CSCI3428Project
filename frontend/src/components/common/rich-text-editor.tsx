/**
 * File: rich-text-editor.tsx
 * Description: A small rich text editor: formatting, colour, links and tables.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-10-16
 */
/**
 * A small rich text editor: bold, italic, underline, headings, lists, quotes,
 * alignment, links, font family, size and colour, and tables that can be
 * sized, grown and coloured.
 *
 * Built on contenteditable with the browser's own editing commands rather than a
 * third-party editor, which keeps the bundle small and avoids another dependency
 * to track. The markup it produces is deliberately plain, and the server
 * sanitises it on the way in — nothing here is trusted.
 *
 * The toolbar is its own export so a canvas text box can be given exactly the
 * same tools: it works on whichever editable element it is pointed at.
 */
import { ArrowUturnLeftIcon, ArrowUturnRightIcon } from '@heroicons/react/24/outline';
import { RefObject, useCallback, useEffect, useRef, useState } from 'react';

import ColorPicker from '@/components/common/color-picker';
import {
  addColumn,
  addRow,
  cellOf,
  cellsInRange,
  cssColorToHex,
  deleteColumn,
  deleteRow,
  emptyTableHtml,
  enableTableResizing,
  MAX_TABLE_COLUMNS,
  MAX_TABLE_ROWS,
  setCellFill,
  setCellText,
  setTableLines,
  tableLines,
} from '@/components/common/rich-text-table';
import { Button } from '@/components/ui/button';

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
}

/**
 * The first entry is the list's label, not a choice: the picker snaps back to it
 * after every pick, so the same font can be applied twice in a row.
 */
const FONTS = [
  { label: 'Font', value: '' },
  { label: 'Sans', value: 'Helvetica, Arial, sans-serif' },
  { label: 'Serif', value: 'Georgia, serif' },
  { label: 'Mono', value: 'ui-monospace, Menlo, monospace' },
];

/** Font sizes are typed in points, the unit authors know from Word and Google Docs. */
const MIN_POINTS = 6;
const MAX_POINTS = 96;

/** The size a new table picker offers by hovering, before typing a bigger one. */
const GRID_ROWS = 8;
const GRID_COLUMNS = 10;

const btn =
  'h-8 min-w-8 px-2 text-sm bg-white text-dark-gray hover:bg-light-gray border border-gray-300';

/** Four rules, the short pair shifted to show which edge the text sits against. */
const AlignIcon = ({ side }: { side: 'left' | 'center' | 'right' }) => {
  const x = { left: 2, center: 4.5, right: 7 }[side];
  return (
    <svg
      viewBox="0 0 16 16"
      className="w-4 h-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M2 2.5h12" />
      <path d={`M${x} 6.5h7`} />
      <path d="M2 10.5h12" />
      <path d={`M${x} 14.5h7`} />
    </svg>
  );
};

/** The point size text is drawn at, from its computed pixel size. */
function pointsOf(element: Element): number {
  const pixels = parseFloat(getComputedStyle(element).fontSize) || 16;
  return Math.round(pixels * 0.75 * 2) / 2;
}

/**
 * Picks the size of a new table: hover the grid and click, or type the numbers
 * for something bigger than the grid shows.
 */
const TablePicker = ({ onPick }: { onPick: (rows: number, columns: number) => void }) => {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState({ rows: 0, columns: 0 });
  const [typed, setTyped] = useState({ rows: '3', columns: '3' });
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  /** Closes the picker and inserts a table of the chosen size. */
  const pick = (rows: number, columns: number) => {
    setOpen(false);
    onPick(rows, columns);
  };

  return (
    <div ref={wrapRef} className="relative">
      <Button
        onClick={() => setOpen(!open)}
        className={btn}
        title="Insert table"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        Table
      </Button>
      {open && (
        <div
          role="dialog"
          aria-label="Table size"
          className="absolute left-0 top-full z-50 mt-1 rounded-lg border border-gray-300 bg-white
            p-3 text-sm text-dark-gray shadow-lg"
        >
          <p className="mb-2 font-medium">
            {hover.rows ? `${hover.rows} × ${hover.columns}` : 'Choose a size'}
          </p>
          <div
            className="grid gap-0.5"
            style={{ gridTemplateColumns: `repeat(${GRID_COLUMNS}, 1rem)` }}
            onMouseLeave={() => setHover({ rows: 0, columns: 0 })}
          >
            {Array.from({ length: GRID_ROWS * GRID_COLUMNS }, (_, index) => {
              const row = Math.floor(index / GRID_COLUMNS) + 1;
              const column = (index % GRID_COLUMNS) + 1;
              const lit = row <= hover.rows && column <= hover.columns;
              return (
                <button
                  key={index}
                  type="button"
                  aria-label={`${row} by ${column}`}
                  onMouseEnter={() => setHover({ rows: row, columns: column })}
                  onFocus={() => setHover({ rows: row, columns: column })}
                  onClick={() => pick(row, column)}
                  className={`h-4 w-4 rounded-sm border
                  ${lit ? 'border-navy bg-navy/30' : 'border-gray-300 bg-white'}`}
                />
              );
            })}
          </div>

          <form
            className="mt-3 flex items-center gap-1"
            onSubmit={(event) => {
              event.preventDefault();
              const rows = Number(typed.rows);
              const columns = Number(typed.columns);
              if (rows >= 1 && columns >= 1) pick(rows, columns);
            }}
          >
            <input
              type="number"
              min={1}
              max={MAX_TABLE_ROWS}
              value={typed.rows}
              onChange={(e) => setTyped({ ...typed, rows: e.target.value })}
              className="h-7 w-14 rounded border border-gray-300 px-1 text-right"
              aria-label="Rows"
            />
            <span>rows ×</span>
            <input
              type="number"
              min={1}
              max={MAX_TABLE_COLUMNS}
              value={typed.columns}
              onChange={(e) => setTyped({ ...typed, columns: e.target.value })}
              className="h-7 w-14 rounded border border-gray-300 px-1 text-right"
              aria-label="Columns"
            />
            <span>columns</span>
            <Button type="submit" className={`${btn} ml-1`}>
              Insert
            </Button>
          </form>
        </div>
      )}
    </div>
  );
};

interface RichTextToolbarProps {
  /** The editable element the buttons act on. */
  editorRef: RefObject<HTMLElement | null>;
  /** Called with the editor's markup after every change a button makes. */
  onChange: (html: string) => void;
  className?: string;
}

/**
 * The formatting toolbar for a contentEditable editor: bold/italic/underline, headings, fonts,
 * sizes, colours, alignment, lists, links, tables and undo/redo. Every change is reported through
 * `onChange` as the editor's new HTML.
 */
export const RichTextToolbar = ({ editorRef: ref, onChange, className }: RichTextToolbarProps) => {
  /**
   * The last selection made inside the editor.
   *
   * Opening the font or size picker moves focus to it, and in several browsers
   * that drops the text selection on the way — so by the time a font is chosen
   * there is nothing left to apply it to. Remembering the range as it changes
   * lets the pick be applied to what the author actually highlighted.
   */
  const savedRange = useRef<Range | null>(null);

  /** What the selection currently looks like, so the controls can show it. */
  const [sizeDraft, setSizeDraft] = useState('');
  const [textColor, setTextColor] = useState<string | null>(null);
  const [cell, setCell] = useState<HTMLTableCellElement | null>(null);
  const sizeFocused = useRef(false);

  useEffect(() => {
    /**
     * On every selection change inside this editor: saves the range, updates the size box and
     * colour swatch to match the text there, and notes which table cell the caret is in.
     */
    const remember = () => {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      const editor = ref.current;
      if (!editor?.contains(range.commonAncestorContainer)) return;
      savedRange.current = range.cloneRange();

      const at =
        range.startContainer instanceof Element
          ? range.startContainer
          : range.startContainer.parentElement;
      if (at) {
        if (!sizeFocused.current) setSizeDraft(String(pointsOf(at)));
        setTextColor(cssColorToHex(getComputedStyle(at).color));
      }
      setCell(cellOf(range.startContainer, editor));
    };
    document.addEventListener('selectionchange', remember);
    return () => document.removeEventListener('selectionchange', remember);
  }, []);

  /** Reports the editor's current HTML after a toolbar change. */
  const emit = () => {
    if (ref.current) onChange(ref.current.innerHTML);
  };

  // Dragging a cell's right or bottom edge resizes its column or row. Kept in a
  // ref so the listeners, attached once, always report through the latest emit.
  const emitRef = useRef(emit);
  emitRef.current = emit;
  useEffect(
    () =>
      enableTableResizing(
        () => ref.current,
        () => emitRef.current(),
      ),
    [],
  );

  /** Puts the remembered selection back, so a command acts on what was highlighted. */
  const restoreSelection = () => {
    const editor = ref.current;
    const saved = savedRange.current;
    editor?.focus();
    if (!editor || !saved || !editor.contains(saved.commonAncestorContainer)) return;
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(saved);
  };

  /** Runs a browser editing command against the current selection. */
  const exec = (command: string, argument?: string) => {
    ref.current?.focus();
    document.execCommand(command, false, argument);
    emit();
  };

  /**
   * Alignment, forced to write inline CSS.
   *
   * Left to itself the browser may emit a deprecated `align=""` attribute, which
   * the server's allowlist drops — the author would centre a line, save, and watch
   * it jump back. styleWithCSS makes it write `style="text-align: …"` instead,
   * which is on the allowlist and survives the round trip.
   */
  const align = (direction: 'Left' | 'Center' | 'Right') => {
    ref.current?.focus();
    document.execCommand('styleWithCSS', false, 'true');
    document.execCommand(`justify${direction}`, false);
    emit();
  };

  /**
   * Applies a font, size or colour to the highlighted text.
   *
   * With nothing highlighted it applies from the caret on instead, the way a
   * word processor does: an empty styled span is dropped at the caret and the
   * caret put inside it, so what is typed next takes the style. The span holds a
   * zero-width space because browsers will not keep a caret in an empty one.
   *
   * `keepFocus` leaves focus where it is — in the colour picker's own inputs —
   * and works on the remembered range alone. Pulling focus back into the text
   * would send the next digit typed into a colour box into the lesson instead.
   */
  const wrapSelection = (style: string, cssValue: string, keepFocus = false) => {
    const editor = ref.current;
    if (!cssValue || !editor) return;

    if (!keepFocus) editor.focus();
    const selection = window.getSelection();

    const saved = savedRange.current;
    let range: Range;
    if (saved && editor.contains(saved.commonAncestorContainer)) {
      range = saved;
    } else {
      // Never been in the editor: start from the end of what is there.
      range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
    }
    if (!keepFocus) {
      selection?.removeAllRanges();
      selection?.addRange(range);
    }

    // Exactly the contents of a span this styled last time — dragging a colour
    // slider, say. Restyle that span rather than wrapping it in yet another one.
    const container = range.startContainer;
    if (
      !range.collapsed &&
      container === range.endContainer &&
      container instanceof HTMLSpanElement &&
      range.startOffset === 0 &&
      range.endOffset === container.childNodes.length
    ) {
      container.style.setProperty(style, cssValue);
      emit();
      return;
    }

    const span = document.createElement('span');
    span.setAttribute('style', `${style}: ${cssValue}`);
    try {
      const next = document.createRange();
      if (range.collapsed) {
        span.textContent = '​';
        range.insertNode(span);
        next.setStart(span.firstChild as Text, 1);
        next.collapse(true);
      } else {
        const contents = range.extractContents();
        // Restyling text that already has this property would otherwise nest the
        // new span outside the old one, and the inner — older — value would
        // still win: pick 18pt over 10pt text and nothing visibly changes. So
        // the property comes off everything inside before the new one goes on,
        // and a span left with no styling at all is unwrapped.
        contents.querySelectorAll<HTMLElement>('[style]').forEach((element) => {
          element.style.removeProperty(style);
          if (!element.getAttribute('style')?.trim()) element.removeAttribute('style');
        });
        contents.querySelectorAll('span:not([style])').forEach((bare) => {
          bare.replaceWith(...Array.from(bare.childNodes));
        });
        span.appendChild(contents);
        range.insertNode(span);
        // Kept highlighted, so a size can follow a font without reselecting.
        next.selectNodeContents(span);
      }
      if (!keepFocus) {
        selection?.removeAllRanges();
        selection?.addRange(next);
      }
      savedRange.current = next.cloneRange();
      emit();
    } catch {
      // A selection spanning odd boundaries can refuse to wrap; leave it be.
    }
  };

  /** Applies the typed point size, if it is a sensible one. */
  const applySize = () => {
    const points = Number(sizeDraft);
    if (!Number.isFinite(points) || sizeDraft.trim() === '') return;
    const clamped = Math.min(MAX_POINTS, Math.max(MIN_POINTS, Math.round(points * 2) / 2));
    setSizeDraft(String(clamped));
    wrapSelection('font-size', `${clamped}pt`);
  };

  /**
   * Empties the editor.
   *
   * Through the browser's own delete rather than by blanking `innerHTML`, so it
   * lands on the undo stack like any other edit — Clear is one click from Undo,
   * and a misclick should cost nothing. Whatever markup the delete leaves behind
   * (an empty paragraph, a stray <br>) is swept up after.
   */
  const clearAll = () => {
    const editor = ref.current;
    if (!editor) return;
    editor.focus();
    document.execCommand('selectAll', false);
    document.execCommand('delete', false);
    if (editor.textContent?.trim() === '' && !editor.querySelector('img, table, hr')) {
      editor.innerHTML = '';
    }
    emit();
  };

  /** Inserts an empty table of the given size where the author's selection was. */
  const insertTable = (rows: number, columns: number) => {
    restoreSelection();
    document.execCommand('insertHTML', false, emptyTableHtml(rows, columns));
    emit();
  };

  /** Runs a table change on the cell the caret was last in, if it is still there. */
  const onTable = (change: (current: HTMLTableCellElement) => void) => {
    if (!cell || !ref.current?.contains(cell)) {
      setCell(null);
      return;
    }
    change(cell);
    if (!ref.current.contains(cell)) setCell(null);
    emit();
  };

  /** The cells a table colour applies to: every highlighted one, or the caret's. */
  const selectedCells = () => {
    const editor = ref.current;
    const saved = savedRange.current;
    if (editor && saved && editor.contains(saved.commonAncestorContainer)) {
      const cells = cellsInRange(saved, editor);
      if (cells.length > 0) return cells;
    }
    return cell ? [cell] : [];
  };

  /**
   * Asks for an address and links the selected text to it. Only http(s) and mailto links are
   * accepted, matching the server's sanitiser.
   */
  const addLink = () => {
    const url = window.prompt('Link address');
    if (!url) return;
    // Only http(s) and mailto survive the server's sanitiser; block the rest here
    // too so the author gets told rather than silently losing their link.
    if (!/^(https?:|mailto:)/i.test(url)) {
      window.alert('Links must start with http://, https:// or mailto:');
      return;
    }
    exec('createLink', url);
  };

  const table = cell && ref.current?.contains(cell) ? cell.closest('table') : null;

  return (
    <div className={`flex flex-col gap-1 p-2 ${className ?? ''}`}>
      <div className="flex flex-wrap items-center gap-1">
        <Button onClick={() => exec('undo')} className={btn} title="Undo" aria-label="Undo">
          <ArrowUturnLeftIcon className="w-4 h-4" />
        </Button>
        <Button onClick={() => exec('redo')} className={btn} title="Redo" aria-label="Redo">
          <ArrowUturnRightIcon className="w-4 h-4" />
        </Button>

        <span className="mx-1 h-6 w-px bg-gray-300" />

        <Button onClick={() => exec('bold')} className={`${btn} font-bold`} title="Bold">
          B
        </Button>
        <Button onClick={() => exec('italic')} className={`${btn} italic`} title="Italic">
          I
        </Button>
        <Button onClick={() => exec('underline')} className={`${btn} underline`} title="Underline">
          U
        </Button>

        <span className="mx-1 h-6 w-px bg-gray-300" />

        <Button onClick={() => exec('formatBlock', 'h2')} className={btn} title="Heading">
          H1
        </Button>
        <Button onClick={() => exec('formatBlock', 'h3')} className={btn} title="Subheading">
          H2
        </Button>
        <Button onClick={() => exec('formatBlock', 'p')} className={btn} title="Body text">
          P
        </Button>

        <span className="mx-1 h-6 w-px bg-gray-300" />

        <Button onClick={() => exec('insertUnorderedList')} className={btn} title="Bullet list">
          •
        </Button>
        <Button onClick={() => exec('insertOrderedList')} className={btn} title="Numbered list">
          1.
        </Button>
        <Button onClick={() => exec('formatBlock', 'blockquote')} className={btn} title="Quote">
          ❝
        </Button>

        <span className="mx-1 h-6 w-px bg-gray-300" />

        <Button onClick={() => align('Left')} className={btn} title="Align left">
          <AlignIcon side="left" />
        </Button>
        <Button onClick={() => align('Center')} className={btn} title="Align centre">
          <AlignIcon side="center" />
        </Button>
        <Button onClick={() => align('Right')} className={btn} title="Align right">
          <AlignIcon side="right" />
        </Button>

        <span className="mx-1 h-6 w-px bg-gray-300" />

        <select
          onChange={(e) => {
            wrapSelection('font-family', e.target.value);
            e.target.value = '';
          }}
          className="h-8 rounded-md border border-gray-300 bg-white px-1 text-sm text-dark-gray"
          title="Font — applies to the highlighted text, or to what you type next"
        >
          {FONTS.map((f) => (
            <option key={f.label} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>

        {/* Applied on Enter or on leaving the box, not per keystroke: typing
            "14" would otherwise set the text to 1pt on the way. */}
        <label
          className="flex h-8 items-center gap-1 rounded-md border border-gray-300 bg-white pl-1
            pr-2 text-sm text-dark-gray"
          title="Font size in points — applies to the highlighted text, or to what you type next"
        >
          <input
            type="number"
            min={MIN_POINTS}
            max={MAX_POINTS}
            step={0.5}
            value={sizeDraft}
            placeholder="12"
            onChange={(e) => setSizeDraft(e.target.value)}
            onFocus={() => {
              sizeFocused.current = true;
            }}
            onBlur={() => {
              sizeFocused.current = false;
              applySize();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                applySize();
              }
            }}
            className="h-7 w-12 bg-transparent text-right focus:outline-none"
            aria-label="Font size in points"
          />
          pt
        </label>

        <ColorPicker
          label="Text colour"
          value={textColor}
          noneDisplay="#333333"
          onChange={(color) => {
            if (!color) return;
            setTextColor(color);
            wrapSelection('color', color, true);
          }}
        />

        <span className="mx-1 h-6 w-px bg-gray-300" />

        <TablePicker onPick={insertTable} />
        <Button onClick={addLink} className={btn} title="Insert link">
          Link
        </Button>
        <Button onClick={clearAll} className={btn} title="Clear all text">
          Clear
        </Button>
      </div>

      {/* Only while the caret is in a table, so the bar stays short otherwise. */}
      {table && (
        <div
          className="flex flex-wrap items-center gap-1 border-t border-gray-300 pt-1"
          aria-label="Table tools"
          role="toolbar"
        >
          <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-dark-gray">
            Table
          </span>
          <Button onClick={() => onTable((c) => addRow(c, 'above'))} className={btn}>
            + Row above
          </Button>
          <Button onClick={() => onTable((c) => addRow(c, 'below'))} className={btn}>
            + Row below
          </Button>
          <Button onClick={() => onTable((c) => addColumn(c, 'left'))} className={btn}>
            + Column left
          </Button>
          <Button onClick={() => onTable((c) => addColumn(c, 'right'))} className={btn}>
            + Column right
          </Button>
          <Button onClick={() => onTable(deleteRow)} className={`${btn} hover:text-danger-hover`}>
            − Row
          </Button>
          <Button
            onClick={() => onTable(deleteColumn)}
            className={`${btn} hover:text-danger-hover`}
          >
            − Column
          </Button>

          <span className="mx-1 h-6 w-px bg-gray-300" />

          <ColorPicker
            label="Lines"
            value={tableLines(table) ?? null}
            noneLabel="No lines"
            onChange={(color) => onTable((c) => setTableLines(c.closest('table')!, color))}
          />
          <ColorPicker
            label="Cell fill"
            value={cssColorToHex(cell?.style.backgroundColor ?? '')}
            noneLabel="No fill"
            onChange={(color) => {
              setCellFill(selectedCells(), color);
              emit();
            }}
          />
          <ColorPicker
            label="Cell text"
            value={cssColorToHex(cell?.style.color ?? '')}
            noneLabel="Default"
            noneDisplay="#333333"
            onChange={(color) => {
              setCellText(selectedCells(), color);
              emit();
            }}
          />
        </div>
      )}
    </div>
  );
};

/**
 * Pastes as plain text, so formatting from Word or a web page cannot drag in
 * markup the sanitiser would strip anyway.
 */
export function pastePlainText(event: React.ClipboardEvent<HTMLElement>, after: () => void) {
  event.preventDefault();
  const text = event.clipboardData.getData('text/plain');
  document.execCommand('insertText', false, text);
  after();
}

/**
 * A contentEditable text editor with the toolbar above it. `value` is HTML; `onChange` receives the
 * new HTML on every edit.
 */
const RichTextEditor = ({ value, onChange, placeholder }: RichTextEditorProps) => {
  const ref = useRef<HTMLDivElement>(null);

  // Only push external changes in when they differ, or every keystroke would
  // rewrite the DOM and throw the caret back to the start.
  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== value) {
      ref.current.innerHTML = value || '';
    }
  }, [value]);

  /** Reports the editor's current HTML after typing or pasting. */
  const emit = useCallback(() => {
    if (ref.current) onChange(ref.current.innerHTML);
  }, [onChange]);

  return (
    <div className="rounded-lg border border-gray-300 bg-white">
      <RichTextToolbar editorRef={ref} onChange={onChange} className="border-b border-gray-300" />

      <div
        ref={ref}
        contentEditable
        role="textbox"
        aria-multiline="true"
        aria-label={placeholder ?? 'Lesson text'}
        onInput={emit}
        onBlur={emit}
        onPaste={(e) => pastePlainText(e, emit)}
        className="rich-text min-h-40 p-3 text-dark-gray focus:outline-none"
        suppressContentEditableWarning
      />
    </div>
  );
};

export default RichTextEditor;
