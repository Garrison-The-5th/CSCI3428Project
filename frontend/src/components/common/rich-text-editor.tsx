/**
 * File: rich-text-editor.tsx
 * Description: A small rich text editor: bold, italic, underline, headings, lists, quotes,.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
/**
 * A small rich text editor: bold, italic, underline, headings, lists, quotes,
 * alignment, links, font family and size, and tables.
 *
 * Built on contenteditable with the browser's own editing commands rather than a
 * third-party editor, which keeps the bundle small and avoids another dependency
 * to track. The markup it produces is deliberately plain, and the server
 * sanitises it on the way in — nothing here is trusted.
 */
import { ArrowUturnLeftIcon, ArrowUturnRightIcon } from '@heroicons/react/24/outline';
import { useCallback, useEffect, useRef } from 'react';

import { Button } from '@/components/ui/button';

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
}

/**
 * The first entry of each list is its label, not a choice: the picker snaps back
 * to it after every pick, so the same font can be applied twice in a row. That
 * is also why Default is a real value — as the label it could never be chosen.
 */
const FONTS = [
  { label: 'Font', value: '' },
  { label: 'Default', value: 'inherit' },
  { label: 'Sans', value: 'Helvetica, Arial, sans-serif' },
  { label: 'Serif', value: 'Georgia, serif' },
  { label: 'Mono', value: 'ui-monospace, Menlo, monospace' },
];

const SIZES = [
  { label: 'Size', value: '' },
  { label: 'Small', value: '0.875rem' },
  { label: 'Normal', value: '1rem' },
  { label: 'Large', value: '1.25rem' },
  { label: 'Huge', value: '1.5rem' },
];

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

const RichTextEditor = ({ value, onChange, placeholder }: RichTextEditorProps) => {
  const ref = useRef<HTMLDivElement>(null);

  /**
   * The last selection made inside the editor.
   *
   * Opening the font or size picker moves focus to it, and in several browsers
   * that drops the text selection on the way — so by the time a font is chosen
   * there is nothing left to apply it to. Remembering the range as it changes
   * lets the pick be applied to what the author actually highlighted.
   */
  const savedRange = useRef<Range | null>(null);
  useEffect(() => {
    const remember = () => {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      if (ref.current?.contains(range.commonAncestorContainer)) {
        savedRange.current = range.cloneRange();
      }
    };
    document.addEventListener('selectionchange', remember);
    return () => document.removeEventListener('selectionchange', remember);
  }, []);

  // Only push external changes in when they differ, or every keystroke would
  // rewrite the DOM and throw the caret back to the start.
  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== value) {
      ref.current.innerHTML = value || '';
    }
  }, [value]);

  const emit = useCallback(() => {
    if (ref.current) onChange(ref.current.innerHTML);
  }, [onChange]);

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
   * Applies a font or size to the highlighted text.
   *
   * With nothing highlighted it applies from the caret on instead, the way a
   * word processor does: an empty styled span is dropped at the caret and the
   * caret put inside it, so what is typed next takes the style. The span holds a
   * zero-width space because browsers will not keep a caret in an empty one.
   */
  const wrapSelection = (style: string, cssValue: string) => {
    const editor = ref.current;
    if (!cssValue || !editor) return;

    editor.focus();
    const selection = window.getSelection();
    if (!selection) return;

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
    selection.removeAllRanges();
    selection.addRange(range);

    const span = document.createElement('span');
    span.setAttribute('style', `${style}: ${cssValue}`);
    try {
      const next = document.createRange();
      if (range.collapsed) {
        span.textContent = '\u200B';
        range.insertNode(span);
        next.setStart(span.firstChild as Text, 1);
        next.collapse(true);
      } else {
        const contents = range.extractContents();
        // Restyling text that already has this property would otherwise nest the
        // new span outside the old one, and the inner — older — value would
        // still win: pick Large over Small text and nothing visibly changes. So
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
      selection.removeAllRanges();
      selection.addRange(next);
      savedRange.current = next.cloneRange();
      emit();
    } catch {
      // A selection spanning odd boundaries can refuse to wrap; leave it be.
    }
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

  const insertTable = () => {
    const rows = 2;
    const columns = 2;
    const header = `<tr>${'<th>Heading</th>'.repeat(columns)}</tr>`;
    const body = `<tr>${'<td>Cell</td>'.repeat(columns)}</tr>`.repeat(rows);
    exec('insertHTML', `<table><thead>${header}</thead><tbody>${body}</tbody></table><p><br></p>`);
  };

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

  return (
    <div className="rounded-lg border border-gray-300 bg-white">
      <div className="flex flex-wrap items-center gap-1 border-b border-gray-300 p-2">
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

        <select
          onChange={(e) => {
            wrapSelection('font-size', e.target.value);
            e.target.value = '';
          }}
          className="h-8 rounded-md border border-gray-300 bg-white px-1 text-sm text-dark-gray"
          title="Size — applies to the highlighted text, or to what you type next"
        >
          {SIZES.map((s) => (
            <option key={s.label} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>

        <span className="mx-1 h-6 w-px bg-gray-300" />

        <Button onClick={insertTable} className={btn} title="Insert table">
          Table
        </Button>
        <Button onClick={addLink} className={btn} title="Insert link">
          Link
        </Button>
        <Button onClick={clearAll} className={btn} title="Clear all text">
          Clear
        </Button>
      </div>

      <div
        ref={ref}
        contentEditable
        role="textbox"
        aria-multiline="true"
        aria-label={placeholder ?? 'Lesson text'}
        onInput={emit}
        onBlur={emit}
        // Paste as plain text so formatting from Word or a web page cannot drag
        // in markup the sanitiser would strip anyway.
        onPaste={(e) => {
          e.preventDefault();
          const text = e.clipboardData.getData('text/plain');
          document.execCommand('insertText', false, text);
          emit();
        }}
        className="rich-text min-h-40 p-3 text-dark-gray focus:outline-none"
        suppressContentEditableWarning
      />
    </div>
  );
};

export default RichTextEditor;
