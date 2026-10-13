/**
 * File: node-contents.tsx
 * Description: The selected node's content list, reorderable and draggable both ways.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-09-22
 */
/**
 * What the selected node holds, in the order a learner will read it.
 *
 * Three drags, one meaning. Reordering inside this box, dragging something in
 * from staging or another node, and dragging something out of it are all the
 * same statement — here is what this node holds now — and all three end in one
 * call that sends the whole list.
 *
 * Select mode reaches in here too, and is shared with the staging manager rather
 * than duplicated: the point of ticking several sections is to move them
 * somewhere, and "somewhere" is as often another node as it is back to the pool.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE NAME IS SAVED WHENEVER IT STOPS BEING EDITED
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A node's name is the text of the option its layer quiz offers, so losing an
 * edit is not losing a label — it is leaving the learner with a question the
 * author thought they had rewritten.
 *
 * Blur alone did not do it. Clicking a node on the map sets the selected id, and
 * React re-renders this box with the new node *before* the browser's blur
 * arrives; by then the field had already been refilled with the new node's name,
 * so the comparison that decides whether to save was made between the new name
 * and itself and found nothing to do. The edit was on screen one moment and gone
 * the next, with no error and nothing saved.
 *
 * So the pending edit is held in a ref, tagged with the node it belongs to, and
 * flushed from two places: on blur, and from an effect keyed on the node's id —
 * whose cleanup runs when the selection changes or this box unmounts. Whichever
 * happens first clears the ref, so the other finds nothing and the rename is
 * sent exactly once.
 */
import { Bars3Icon, LockClosedIcon } from '@heroicons/react/24/outline';
import { useEffect, useRef, useState } from 'react';

import { Input } from '@/components/ui/input';
import {
  dragGroup,
  readDrag,
  writeDrag,
} from '@/pages/private/admin/editor/course-map/drag-payload';
import type { MapNode } from '@/services/course-map-api';

interface NodeContentsProps {
  node: MapNode | null;
  /** The new list, whole. Covers reordering, arriving and leaving alike. */
  onReorder: (sectionIds: string[]) => void;
  /** Named explicitly, because a rename can be flushed after the selection moved on. */
  onRename: (nodeId: string, title: string) => void;
  /** Sections dropped here that this node did not already hold. */
  onAdopt: (sectionIds: string[]) => void;
  selectMode: boolean;
  selected: ReadonlySet<string>;
  onToggleSelected: (sectionId: string) => void;
}

const NodeContents = ({
  node,
  onReorder,
  onRename,
  onAdopt,
  selectMode,
  selected,
  onToggleSelected,
}: NodeContentsProps) => {
  const [dragId, setDragId] = useState<string | null>(null);
  const [title, setTitle] = useState(node?.title ?? '');
  /** The node the title box is currently showing, so it refills on a new pick. */
  const [titleFor, setTitleFor] = useState(node?.id ?? null);

  /**
   * A rename typed but not yet sent, and which node it is about.
   *
   * A ref rather than state because it has to survive being read after the
   * component has already re-rendered for a different node — see the note at the
   * top of the file.
   */
  const pending = useRef<{ nodeId: string; was: string; now: string } | null>(null);
  /** The latest handler, so a flush from a cleanup never calls a stale one. */
  const renameRef = useRef(onRename);
  renameRef.current = onRename;

  /** Sends the pending rename, if there is one worth sending, and clears it. */
  const flush = () => {
    const edit = pending.current;
    pending.current = null;
    if (!edit) return;

    const wanted = edit.now.trim();
    // An empty box is not a rename — a node with no name offers a blank option —
    // so it is dropped and the field refills from the node on the next render.
    if (!wanted || wanted === edit.was) return;
    renameRef.current(edit.nodeId, wanted);
  };

  // Flushed when the selection moves to another node, and when this box goes
  // away entirely. Both are "the author has stopped editing this name", which is
  // the moment it has to be saved.
  useEffect(() => flush, [node?.id]);

  if (node && titleFor !== node.id) {
    setTitleFor(node.id);
    setTitle(node.title);
  }

  if (!node) {
    return (
      <section
        aria-label="Node contents"
        className="flex min-h-0 flex-1 flex-col items-center justify-center rounded-lg
          rounded-t-none border-2 border-navy/20 bg-white px-4 py-6 text-center"
      >
        <p className="text-sm text-dark-gray">Pick a node on the map to see what is in it.</p>
      </section>
    );
  }

  const held = node.items.map((item) => item.sectionId);
  /** A node copied in from another course's map: nothing on it is this course's to change. */
  const linked = node.linked ?? null;

  /**
   * Moves the dragged sections to sit where the one they were dropped on sits.
   *
   * Anything in the drag that this node does not already hold is an arrival
   * rather than a reorder, so the two are separated first: arrivals go through
   * `onAdopt`, which knows how to take them off whatever was holding them, and
   * what is left is reordered in place.
   */
  const dropOn = (targetId: string, dragging: string[]) => {
    setDragId(null);
    if (dragging.length === 0 || dragging.includes(targetId)) return;

    if (linked) return;
    const arriving = dragging.filter((id) => !held.includes(id));
    if (arriving.length > 0) return onAdopt(dragging);

    const without = held.filter((id) => !dragging.includes(id));
    const at = without.indexOf(targetId);
    without.splice(at < 0 ? without.length : at, 0, ...dragging);

    onReorder(without);
  };

  const pickedHere = held.filter((id) => selected.has(id)).length;

  return (
    <section
      aria-label={`Contents of ${node.title}`}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        const sectionIds = readDrag(event.dataTransfer);
        // Only what is new to this node: a drag that merely ends over the panel
        // rather than over one of its rows is an arrival, not a reorder.
        if (sectionIds.some((id) => !held.includes(id))) onAdopt(sectionIds);
      }}
      // Square along the top, where the staging manager sits directly above it.
      className="flex min-h-0 flex-1 flex-col rounded-lg rounded-t-none border-2 border-navy/20
        bg-white"
    >
      <header className="border-b border-navy/15 px-3 py-2">
        {/*
          No Select button of its own.

          There was one here, mirroring the staging manager's. It was redundant
          rather than convenient: the two drove the same mode and the same set of
          ticks, so whichever you pressed both changed, and a control that is
          only ever a second copy of another control is one more thing to explain
          for nothing. Select mode still reaches these rows — it is switched on
          from the one button above.
        */}
        <label className="text-xs font-semibold tracking-wide text-dark-gray uppercase">
          Selected node
        </label>

        <Input
          value={title}
          disabled={node.isRoot || Boolean(linked)}
          onChange={(event) => {
            setTitle(event.target.value);
            pending.current = { nodeId: node.id, was: node.title, now: event.target.value };
          }}
          onBlur={flush}
          onKeyDown={(event) => {
            // Enter is "done", the same as clicking away — and saying so here
            // rather than leaving it to the blur below means the author gets the
            // confirmation while their hands are still on the keyboard. Blurring
            // afterwards is what takes the caret out of a box they have finished
            // with; `flush` has already cleared the pending edit by then, so the
            // rename is still sent exactly once.
            if (event.key !== 'Enter') return;
            event.preventDefault();
            flush();
            event.currentTarget.blur();
          }}
          className="mt-1 h-9 bg-light-gray"
          // The root's name is what every learner's course opens with and it has
          // no quiz option to label, so there is nothing for a rename to change.
          title={
            node.isRoot
              ? 'The root node is always called this'
              : linked
                ? `Named in ${linked.sourceTitle}, which owns this node`
                : 'Rename this node'
          }
        />

        {linked && (
          <p className="mt-1 text-xs font-semibold text-danger">
            Linked from {linked.sourceTitle} — edit it there, and changes follow here automatically.
            Removing this node removes the whole linked map.
            {linked.entry
              ? ' Your nodes can lead into this one.'
              : ' If nothing in the linked map leads on from here, it can lead on to your nodes.'}
          </p>
        )}

        {selectMode && pickedHere > 0 && (
          <p className="mt-1 text-xs text-dark-gray">
            {pickedHere} picked — drag any of them to move them together
          </p>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {node.items.length === 0 ? (
          <p className="text-sm text-dark-gray">
            Nothing here yet — drag content across from the staging manager.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {node.items.map((item) => {
              const picked = selectMode && selected.has(item.sectionId);
              /** Placed by a linked map: it can be reordered here, never taken off. */
              const fixed = Boolean(item.locked) || Boolean(linked);

              return (
                <li key={item.sectionId}>
                  <div
                    draggable={!linked}
                    onDragStart={(event) => {
                      const group = selectMode
                        ? dragGroup(item.sectionId, selected)
                        : [item.sectionId];
                      setDragId(item.sectionId);
                      // Tagged with this node, so the staging manager knows the
                      // drag came off a node and a drag that merely passes over
                      // it is not read as a return.
                      writeDrag(event.dataTransfer, group, node.id);
                    }}
                    onClick={() => selectMode && !fixed && onToggleSelected(item.sectionId)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.stopPropagation();
                      event.preventDefault();
                      dropOn(item.sectionId, readDrag(event.dataTransfer));
                    }}
                    onDragEnd={() => setDragId(null)}
                    title={
                      fixed
                        ? 'Part of a linked map — it can only be removed by unlinking the map'
                        : undefined
                    }
                    className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm
                      ${linked ? 'cursor-default' : 'cursor-grab'}
                      ${picked ? 'border-navy bg-navy/10 ring-1 ring-navy/30' : fixed ? 'border-danger/40 bg-light-gray' : 'border-navy/20 bg-light-gray'}
                      ${dragId === item.sectionId ? 'opacity-50' : ''}`}
                  >
                    {fixed ? (
                      <LockClosedIcon className="w-4 h-4 shrink-0 text-danger" />
                    ) : (
                      <Bars3Icon className="w-4 h-4 shrink-0 text-dark-gray" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-dark-gray">
                      <span className="font-medium">{item.number}</span> {item.title}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
};

export default NodeContents;
