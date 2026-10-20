/**
 * File: rich-text-table.test.tsx
 * Description: Tests for table editing in the rich text editor, and the toolbar's size, colour and table controls.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-10-16
 */
import { fireEvent, render, screen, within } from '@testing-library/react';

import RichTextEditor from '@/components/common/rich-text-editor';
import {
  addColumn,
  addRow,
  cellsInRange,
  cssColorToHex,
  deleteColumn,
  deleteRow,
  emptyTableHtml,
  enableTableResizing,
  MIN_CELL_SIZE,
  resizeEdgeAt,
  setCellFill,
  setCellText,
  setColumnWidth,
  setRowHeight,
  setTableLines,
  tableLines,
} from '@/components/common/rich-text-table';

/** An editor holding one table built from `emptyTableHtml`. */
function editorWith(rows: number, columns: number) {
  const editor = document.createElement('div');
  editor.innerHTML = emptyTableHtml(rows, columns);
  document.body.appendChild(editor);
  const table = editor.querySelector('table')!;
  const cell = (row: number, column: number) => table.rows[row].cells[column];
  return { editor, table, cell };
}

const shape = (table: HTMLTableElement) => Array.from(table.rows).map((row) => row.cells.length);

describe('emptyTableHtml', () => {
  it('makes a plain grid of the asked-for size, with no heading row or placeholder words', () => {
    const { table } = editorWith(3, 4);
    expect(shape(table)).toEqual([4, 4, 4]);
    expect(table.querySelector('thead, th')).toBeNull();
    expect(table.textContent).toBe('');
  });

  it('caps the size so a slip cannot insert thousands of cells', () => {
    const { table } = editorWith(5000, 5000);
    expect(table.rows.length).toBe(50);
    expect(table.rows[0].cells.length).toBe(12);
  });
});

describe('growing and shrinking a table', () => {
  it('adds rows above and below the caret’s row', () => {
    const { table, cell } = editorWith(2, 2);
    cell(0, 0).textContent = 'first';
    addRow(cell(0, 0), 'above');
    addRow(cell(1, 0), 'below');
    expect(shape(table)).toEqual([2, 2, 2, 2]);
    expect(table.rows[1].cells[0].textContent).toBe('first');
  });

  it('adds columns left and right of the caret’s column, on every row', () => {
    const { table, cell } = editorWith(2, 2);
    cell(0, 1).textContent = 'b';
    addColumn(cell(0, 1), 'left');
    addColumn(cell(0, 0), 'right');
    expect(shape(table)).toEqual([4, 4]);
    expect(table.rows[0].cells[3].textContent).toBe('b');
  });

  it('carries a cell’s colours onto the cells added beside it', () => {
    const { table, cell } = editorWith(1, 1);
    setCellFill([cell(0, 0)], '#ff0000');
    addColumn(cell(0, 0), 'right');
    expect(table.rows[0].cells[1].style.backgroundColor).toBe('rgb(255, 0, 0)');
  });

  it('removes a row or column, and the whole table once it is empty', () => {
    const { editor, table, cell } = editorWith(2, 2);
    deleteRow(cell(0, 0));
    deleteColumn(cell(0, 0));
    expect(shape(table)).toEqual([1]);
    deleteColumn(table.rows[0].cells[0]);
    expect(editor.querySelector('table')).toBeNull();
  });
});

describe('table colours', () => {
  it('colours the lines, or hides them without changing the layout', () => {
    const { table } = editorWith(2, 2);
    setTableLines(table, '#1f4e79');
    expect(tableLines(table)).toBe('#1f4e79');
    setTableLines(table, null);
    expect(tableLines(table)).toBeNull();
    expect(table.rows[1].cells[1].style.borderColor).toBe('transparent');
  });

  it('fills cells and colours their text, and clears both', () => {
    const { cell } = editorWith(1, 2);
    setCellFill([cell(0, 0), cell(0, 1)], '#00ff00');
    setCellText([cell(0, 0)], '#0000ff');
    expect(cell(0, 1).style.backgroundColor).toBe('rgb(0, 255, 0)');
    expect(cell(0, 0).style.color).toBe('rgb(0, 0, 255)');

    setCellFill([cell(0, 0)], null);
    setCellText([cell(0, 0)], null);
    expect(cell(0, 0).hasAttribute('style')).toBe(false);
  });

  it('applies to every cell a selection touches', () => {
    const { editor, cell } = editorWith(2, 3);
    const range = document.createRange();
    range.setStart(cell(0, 1), 0);
    range.setEnd(cell(1, 2), 0);
    expect(cellsInRange(range, editor).length).toBeGreaterThanOrEqual(2);
    range.collapse(true);
    expect(cellsInRange(range, editor)).toEqual([cell(0, 1)]);
  });

  it('reads colours back as hex', () => {
    expect(cssColorToHex('rgb(31, 78, 121)')).toBe('#1f4e79');
    expect(cssColorToHex('#ABCDEF')).toBe('#abcdef');
    expect(cssColorToHex('red')).toBeNull();
  });
});

describe('RichTextEditor toolbar', () => {
  it('offers no “Default” font, since it did nothing', () => {
    render(<RichTextEditor value="" onChange={jest.fn()} />);
    const fonts = screen.getByTitle(/^Font —/);
    expect(within(fonts).queryByText('Default')).toBeNull();
    expect(within(fonts).getByText('Serif')).toBeInTheDocument();
  });

  it('takes the font size as a typed number of points', () => {
    render(<RichTextEditor value="" onChange={jest.fn()} />);
    const size = screen.getByRole('spinbutton', { name: 'Font size in points' });
    expect(size).toHaveAttribute('min', '6');
    expect(screen.queryByText('Large')).toBeNull();
  });

  it('applies a typed size to the text when Enter is pressed', () => {
    const onChange = jest.fn();
    render(<RichTextEditor value="" onChange={onChange} />);
    const size = screen.getByRole('spinbutton', { name: 'Font size in points' });
    fireEvent.change(size, { target: { value: '18' } });
    fireEvent.keyDown(size, { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith(expect.stringContaining('font-size: 18pt'));
  });

  it('has a text colour picker', () => {
    render(<RichTextEditor value="" onChange={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Text colour' }));
    expect(screen.getByRole('dialog', { name: 'Text colour' })).toBeInTheDocument();
  });

  it('asks how many rows and columns before inserting a table', () => {
    render(<RichTextEditor value="" onChange={jest.fn()} />);
    fireEvent.click(screen.getByTitle('Insert table'));
    const picker = screen.getByRole('dialog', { name: 'Table size' });
    expect(within(picker).getByRole('spinbutton', { name: 'Rows' })).toBeInTheDocument();
    expect(within(picker).getByRole('spinbutton', { name: 'Columns' })).toBeInTheDocument();
    expect(within(picker).getByRole('button', { name: '3 by 4' })).toBeInTheDocument();
  });
});

describe('resizing cells', () => {
  /** Gives a cell a fixed box on screen, since jsdom lays nothing out. */
  const placeAt = (cell: HTMLElement, left: number, top: number, width: number, height: number) => {
    cell.getBoundingClientRect = () =>
      ({ left, top, right: left + width, bottom: top + height, width, height }) as DOMRect;
  };

  it('sets the width of the whole column and the height of the whole row', () => {
    const { table, cell } = editorWith(2, 3);
    setColumnWidth(cell(0, 1), 150);
    setRowHeight(cell(1, 0), 60);
    expect(Array.from(table.rows).map((row) => row.cells[1].style.width)).toEqual([
      '150px',
      '150px',
    ]);
    expect(table.rows[0].cells[0].style.width).toBe('');
    expect(Array.from(table.rows[1].cells).map((c) => c.style.height)).toEqual([
      '60px',
      '60px',
      '60px',
    ]);
    expect(table.rows[0].cells[0].style.height).toBe('');
  });

  it('never shrinks a cell below the minimum', () => {
    const { cell } = editorWith(1, 1);
    setColumnWidth(cell(0, 0), -40);
    setRowHeight(cell(0, 0), 3);
    expect(cell(0, 0).style.width).toBe(`${MIN_CELL_SIZE}px`);
    expect(cell(0, 0).style.height).toBe(`${MIN_CELL_SIZE}px`);
  });

  it('finds the right and bottom edges of a cell, and nothing in its middle', () => {
    const { cell } = editorWith(1, 1);
    placeAt(cell(0, 0), 0, 0, 100, 40);
    expect(resizeEdgeAt(cell(0, 0), 99, 20)).toBe('column');
    expect(resizeEdgeAt(cell(0, 0), 50, 41)).toBe('row');
    expect(resizeEdgeAt(cell(0, 0), 50, 20)).toBeNull();
  });

  it('resizes a column by dragging its right edge, and reports once at the end', () => {
    const { editor, table, cell } = editorWith(2, 2);
    placeAt(cell(0, 0), 0, 0, 100, 40);
    const onResized = jest.fn();
    const stop = enableTableResizing(() => editor, onResized);

    fireEvent.pointerDown(cell(0, 0), { button: 0, clientX: 100, clientY: 20 });
    fireEvent.pointerMove(cell(0, 0), { clientX: 160, clientY: 20 });
    expect(onResized).not.toHaveBeenCalled();
    fireEvent.pointerUp(cell(0, 0), { clientX: 160, clientY: 20 });

    expect(Array.from(table.rows).map((row) => row.cells[0].style.width)).toEqual([
      '160px',
      '160px',
    ]);
    expect(onResized).toHaveBeenCalledTimes(1);
    stop();
  });

  it('resizes a row by dragging its bottom edge', () => {
    const { editor, table, cell } = editorWith(2, 2);
    placeAt(cell(0, 1), 100, 0, 100, 40);
    const stop = enableTableResizing(
      () => editor,
      () => {},
    );

    fireEvent.pointerDown(cell(0, 1), { button: 0, clientX: 150, clientY: 40 });
    fireEvent.pointerMove(cell(0, 1), { clientX: 150, clientY: 90 });
    fireEvent.pointerUp(cell(0, 1), { clientX: 150, clientY: 90 });

    expect(Array.from(table.rows[0].cells).map((c) => c.style.height)).toEqual(['90px', '90px']);
    expect(table.rows[1].cells[0].style.height).toBe('');
    stop();
  });

  it('leaves a press inside a cell alone, so the caret can still be placed', () => {
    const { editor, cell } = editorWith(1, 1);
    placeAt(cell(0, 0), 0, 0, 100, 40);
    const stop = enableTableResizing(
      () => editor,
      () => {},
    );

    fireEvent.pointerDown(cell(0, 0), { button: 0, clientX: 50, clientY: 20 });
    fireEvent.pointerMove(cell(0, 0), { clientX: 90, clientY: 20 });
    fireEvent.pointerUp(cell(0, 0), { clientX: 90, clientY: 20 });

    expect(cell(0, 0).style.width).toBe('');
    stop();
  });
});
