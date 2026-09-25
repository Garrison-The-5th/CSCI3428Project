/**
 * File: drag-payload.ts
 * Description: What a drag of one or many sections carries, written and read in one place.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-09-22
 */
/**
 * The one description of what a section drag carries.
 *
 * Three places write a drag — the staging manager, a node's content list, and
 * nothing else — and four read one: those two, the canvas, and the node box on
 * it. When each did its own `getData` the single-section and many-section cases
 * drifted apart, and a drop handler that had only learned about one of them
 * silently moved the wrong number of things.
 *
 * TWO KEYS, DELIBERATELY
 *
 * `text/section-ids` is the real payload and is always written. `text/section-id`
 * is written too, holding the first id, purely so that anything still asking the
 * old question gets a true answer rather than an empty string. Reading goes the
 * other way round — the list first, the single id as a fallback — so a drag that
 * carries five sections is never quietly treated as one.
 *
 * `text/from-node` is separate from both because it answers a different
 * question: not what is being dragged, but whether it is currently on a node.
 * The staging manager only accepts a drop that says yes — something dragged from
 * inside the pool has nowhere to return to.
 */

const IDS = 'text/section-ids';
const ID = 'text/section-id';
const FROM_NODE = 'text/from-node';

/** Puts a drag together. `fromNodeId` is set only when it started on a node. */
export function writeDrag(
  dataTransfer: DataTransfer,
  sectionIds: string[],
  fromNodeId?: string,
): void {
  dataTransfer.setData(IDS, JSON.stringify(sectionIds));
  dataTransfer.setData(ID, sectionIds[0] ?? '');
  if (fromNodeId) dataTransfer.setData(FROM_NODE, fromNodeId);
  dataTransfer.effectAllowed = 'move';
}

/**
 * What a drop is carrying, as a list — one section is a list of one.
 *
 * Never throws on a malformed payload. A drop can arrive from outside the app
 * entirely (a file, a selection from another page), and the honest answer to
 * "which sections is this" for those is none.
 */
export function readDrag(dataTransfer: DataTransfer): string[] {
  const many = dataTransfer.getData(IDS);
  if (many) {
    try {
      const parsed: unknown = JSON.parse(many);
      if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
    } catch {
      // Falls through to the single-id key below.
    }
  }

  const one = dataTransfer.getData(ID);
  return one ? [one] : [];
}

/** Whether this drag started on a node, rather than inside the staging pool. */
export function draggedFromNode(dataTransfer: DataTransfer): boolean {
  return dataTransfer.getData(FROM_NODE) !== '';
}

/**
 * The sections a gesture on `sectionId` should actually move.
 *
 * Dragging something that is part of a selection drags the whole selection;
 * dragging anything else drags that one thing and leaves the selection alone.
 * That is the rule every file manager uses, and it is what stops a careless drag
 * on an unrelated row from carrying off a selection made minutes ago.
 */
export function dragGroup(sectionId: string, selected: ReadonlySet<string>): string[] {
  return selected.has(sectionId) ? [...selected] : [sectionId];
}
