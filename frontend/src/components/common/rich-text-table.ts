/**
 * File: rich-text-table.ts
 * Description: Table editing for the rich text editor — inserting, growing, shrinking, resizing and colouring tables.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-10-16
 */
/**
 * Table editing for the rich text editor.
 *
 * Plain DOM work on the editor's own markup, kept apart from the toolbar so it
 * can be tested without a browser. Every colour is written as an inline style on
 * the cells, because that is what the server's sanitiser lets through — a
 * class or a `<colgroup>` would be stripped on save.
 *
 * Tables are assumed to be simple grids (no merged cells), which is all the
 * editor can make.
 */

/** Upper bounds on a new table, so a slip of the mouse cannot insert 10,000 cells. */
export const MAX_TABLE_ROWS = 50;
export const MAX_TABLE_COLUMNS = 12;

/**
 * Markup for an empty table of the given size.
 *
 * No heading row and no placeholder words: the author asked for a grid, and
 * "Heading" / "Cell" were only ever deleted again. Each cell holds a `<br>` so
 * it has a line's height to click into. A paragraph follows the table so there
 * is somewhere to carry on typing below it.
 */
export function emptyTableHtml(rows: number, columns: number): string {
  const r = Math.min(MAX_TABLE_ROWS, Math.max(1, Math.round(rows)));
  const c = Math.min(MAX_TABLE_COLUMNS, Math.max(1, Math.round(columns)));
  const row = `<tr>${'<td><br></td>'.repeat(c)}</tr>`;
  return `<table><tbody>${row.repeat(r)}</tbody></table><p><br></p>`;
}

/** The table cell a node sits in, if any, without leaving the editor. */
export function cellOf(node: Node | null, editor: HTMLElement): HTMLTableCellElement | null {
  let current: Node | null = node;
  while (current && current !== editor) {
    if (current instanceof HTMLTableCellElement) return current;
    current = current.parentNode;
  }
  return null;
}

/**
 * The cells a selection covers: every cell it touches when it spans several,
 * or the one holding the caret.
 */
export function cellsInRange(range: Range, editor: HTMLElement): HTMLTableCellElement[] {
  const start = cellOf(range.startContainer, editor);
  const table = start?.closest('table');
  if (!start || !table) return [];
  if (range.collapsed) return [start];
  const touched = Array.from(table.querySelectorAll<HTMLTableCellElement>('td, th')).filter(
    (cell) => range.intersectsNode(cell),
  );
  return touched.length > 0 ? touched : [start];
}

/** An empty cell styled like the one it was made next to, so colours carry on. */
function cellLike(model: HTMLTableCellElement): HTMLTableCellElement {
  const cell = document.createElement(model.tagName.toLowerCase() as 'td' | 'th');
  const style = model.getAttribute('style');
  if (style) cell.setAttribute('style', style);
  cell.appendChild(document.createElement('br'));
  return cell;
}

export function addRow(cell: HTMLTableCellElement, where: 'above' | 'below'): void {
  const row = cell.parentElement as HTMLTableRowElement | null;
  if (!row) return;
  const next = document.createElement('tr');
  for (const existing of Array.from(row.cells)) {
    // A new row under a heading row is ordinary cells, not more headings.
    const model = existing.tagName === 'TH' && where === 'below' ? asDataCell(existing) : existing;
    next.appendChild(cellLike(model));
  }
  row.parentNode?.insertBefore(next, where === 'above' ? row : row.nextSibling);
}

function asDataCell(heading: HTMLTableCellElement): HTMLTableCellElement {
  const cell = document.createElement('td');
  const style = heading.getAttribute('style');
  if (style) cell.setAttribute('style', style);
  return cell;
}

export function addColumn(cell: HTMLTableCellElement, where: 'left' | 'right'): void {
  const table = cell.closest('table');
  if (!table) return;
  const index = cell.cellIndex;
  for (const row of Array.from(table.rows)) {
    const neighbour = row.cells[Math.min(index, row.cells.length - 1)];
    if (!neighbour) continue;
    const added = cellLike(neighbour);
    row.insertBefore(added, where === 'left' ? neighbour : neighbour.nextSibling);
  }
}

/** Removes the cell's row; a table left with no rows goes too. */
export function deleteRow(cell: HTMLTableCellElement): void {
  const table = cell.closest('table');
  cell.parentElement?.remove();
  if (table && table.rows.length === 0) table.remove();
}

/** Removes the cell's column; a table left with no columns goes too. */
export function deleteColumn(cell: HTMLTableCellElement): void {
  const table = cell.closest('table');
  if (!table) return;
  const index = cell.cellIndex;
  for (const row of Array.from(table.rows)) {
    row.cells[index]?.remove();
    if (row.cells.length === 0) row.remove();
  }
  if (table.rows.length === 0) table.remove();
}

/**
 * The colour of a table's lines, or `null` to hide them.
 *
 * Hidden is a transparent border rather than none, so the table keeps exactly
 * the same layout whichever way it is switched.
 */
export function setTableLines(table: HTMLTableElement, color: string | null): void {
  for (const cell of Array.from(table.querySelectorAll<HTMLTableCellElement>('td, th'))) {
    cell.style.borderColor = color ?? 'transparent';
  }
}

/** Fills cells with a colour, or clears the fill with `null`. */
export function setCellFill(cells: HTMLTableCellElement[], color: string | null): void {
  for (const cell of cells) setOrClear(cell, 'background-color', color);
}

/** Colours the text in cells, or returns it to the default with `null`. */
export function setCellText(cells: HTMLTableCellElement[], color: string | null): void {
  for (const cell of cells) setOrClear(cell, 'color', color);
}

function setOrClear(element: HTMLElement, property: string, value: string | null): void {
  if (value) element.style.setProperty(property, value);
  else element.style.removeProperty(property);
  if (!element.getAttribute('style')?.trim()) element.removeAttribute('style');
}

/** What a table's lines are set to: a colour, `null` for hidden, or `undefined` for the default. */
export function tableLines(table: HTMLTableElement): string | null | undefined {
  const cell = table.querySelector<HTMLTableCellElement>('td, th');
  const value = cell?.style.borderColor;
  if (!value) return undefined;
  if (value === 'transparent') return null;
  return cssColorToHex(value) ?? undefined;
}

/** `rgb(31, 78, 121)` or `#1f4e79` as `#1f4e79`; anything else as null. */
export function cssColorToHex(value: string): string | null {
  const hex = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (hex) return `#${hex[1].toLowerCase()}`;
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(value);
  if (!rgb) return null;
  return `#${[rgb[1], rgb[2], rgb[3]]
    .map((part) => Math.min(255, Number(part)).toString(16).padStart(2, '0'))
    .join('')}`;
}

/** How close to a cell's right or bottom edge, in pixels, the pointer must be to grab it. */
export const RESIZE_EDGE = 5;

/** The smallest a column or row can be dragged down to, so a cell can never vanish. */
export const MIN_CELL_SIZE = 24;

/**
 * Which edge of a cell, if any, a point is on: its right edge resizes the
 * column, its bottom edge the row. Left and top edges belong to the cells
 * before them, so every line between two cells has exactly one owner.
 */
export function resizeEdgeAt(
  cell: HTMLTableCellElement,
  x: number,
  y: number,
): 'column' | 'row' | null {
  const box = cell.getBoundingClientRect();
  if (Math.abs(x - box.right) <= RESIZE_EDGE && y >= box.top && y <= box.bottom) return 'column';
  if (Math.abs(y - box.bottom) <= RESIZE_EDGE && x >= box.left && x <= box.right) return 'row';
  return null;
}

/** Sets the width of the cell's whole column, in pixels. */
export function setColumnWidth(cell: HTMLTableCellElement, px: number): void {
  const table = cell.closest('table');
  if (!table) return;
  const width = `${Math.max(MIN_CELL_SIZE, Math.round(px))}px`;
  const index = cell.cellIndex;
  for (const row of Array.from(table.rows)) {
    const target = row.cells[index];
    if (target) target.style.width = width;
  }
}

/** Sets the height of the cell's whole row, in pixels. */
export function setRowHeight(cell: HTMLTableCellElement, px: number): void {
  const row = cell.parentElement as HTMLTableRowElement | null;
  if (!row) return;
  const height = `${Math.max(MIN_CELL_SIZE, Math.round(px))}px`;
  for (const target of Array.from(row.cells)) target.style.height = height;
}

/**
 * Lets the author drag the lines between table cells: a cell's right edge
 * widens or narrows its column, its bottom edge makes its row taller or shorter.
 *
 * The listeners sit on the document, in the capture phase, so a drag that
 * starts on a cell edge is claimed before the caret moves or — on the canvas —
 * before the text box itself starts being dragged. Sizes are written as inline
 * `width` / `height` on the cells, like the colours, so they survive a save.
 *
 * Returns a function that removes the listeners.
 */
export function enableTableResizing(
  editor: () => HTMLElement | null,
  onResized: () => void,
): () => void {
  let drag: {
    cell: HTMLTableCellElement;
    edge: 'column' | 'row';
    start: number;
    size: number;
  } | null = null;
  let hovering: HTMLElement | null = null;

  const edgeUnder = (event: PointerEvent) => {
    const root = editor();
    if (!root || !(event.target instanceof Node) || !root.contains(event.target)) return null;
    const cell = cellOf(event.target, root);
    if (!cell) return null;
    const edge = resizeEdgeAt(cell, event.clientX, event.clientY);
    return edge ? { root, cell, edge } : null;
  };

  const setCursor = (root: HTMLElement | null, cursor: string) => {
    if (hovering && hovering !== root) hovering.style.cursor = '';
    hovering = root;
    if (root) root.style.cursor = cursor;
  };

  const onDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    const hit = edgeUnder(event);
    if (!hit) return;
    event.preventDefault();
    event.stopPropagation();
    const box = hit.cell.getBoundingClientRect();
    drag =
      hit.edge === 'column'
        ? { cell: hit.cell, edge: 'column', start: event.clientX, size: box.width }
        : { cell: hit.cell, edge: 'row', start: event.clientY, size: box.height };
    document.body.style.cursor = hit.edge === 'column' ? 'col-resize' : 'row-resize';
  };

  const onMove = (event: PointerEvent) => {
    if (drag) {
      event.preventDefault();
      if (drag.edge === 'column') {
        setColumnWidth(drag.cell, drag.size + event.clientX - drag.start);
      } else {
        setRowHeight(drag.cell, drag.size + event.clientY - drag.start);
      }
      return;
    }
    const hit = edgeUnder(event);
    if (hit) setCursor(hit.root, hit.edge === 'column' ? 'col-resize' : 'row-resize');
    else if (hovering) setCursor(null, '');
  };

  // A click follows the pointerup of a drag; swallow it so it does not land
  // the caret, or select the canvas item, wherever the drag happened to end.
  let swallowClick = false;

  const onUp = (event: PointerEvent) => {
    if (!drag) return;
    event.preventDefault();
    event.stopPropagation();
    drag = null;
    swallowClick = true;
    document.body.style.cursor = '';
    onResized();
  };

  // Stops the browser starting a text selection or moving the caret on the
  // mousedown that follows a pointerdown on a cell edge.
  const onMouseDown = (event: MouseEvent) => {
    if (!drag) return;
    event.preventDefault();
    event.stopPropagation();
  };

  const onClick = (event: MouseEvent) => {
    if (!swallowClick) return;
    swallowClick = false;
    event.preventDefault();
    event.stopPropagation();
  };

  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('pointermove', onMove, true);
  document.addEventListener('pointerup', onUp, true);
  document.addEventListener('mousedown', onMouseDown, true);
  document.addEventListener('click', onClick, true);
  return () => {
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('pointermove', onMove, true);
    document.removeEventListener('pointerup', onUp, true);
    document.removeEventListener('mousedown', onMouseDown, true);
    document.removeEventListener('click', onClick, true);
    if (hovering) hovering.style.cursor = '';
    if (drag) document.body.style.cursor = '';
  };
}
