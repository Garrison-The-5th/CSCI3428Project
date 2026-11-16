/**
 * File: staging-manager.tsx
 * Description: The pool of content waiting to be placed on the map.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-09-22
 */
/**
 * Everything staged and not yet placed, grouped by the course it came from.
 *
 * This course's own content is always the first group and cannot be removed —
 * it is what is being mapped. Below it sit the courses added to staging, each of
 * which is a shelf to take sections off: they are read-only here and stay owned
 * and edited by their own course.
 *
 * Sections leave by being dragged onto a node, and come back by being dragged
 * out of one. Native HTML5 drag, which is what the structure editor's lists
 * already use and what the browser gives a list for free.
 *
 * SELECT MODE
 *
 * Placing a model's worth of sections one at a time is the same drag eight
 * times over, and each one is a round trip that redraws the map. So there is a
 * Select button: turn it on, tick as many sections as belong together, and drag
 * any one of them to move the lot. It is a mode rather than a modifier key
 * because the alternative — shift-click — is invisible, and because the
 * selection has to survive the pointer leaving this panel entirely on its way to
 * a node.
 *
 * Off, a click does nothing and a drag carries one section, exactly as before.
 */
import { CheckIcon, PlusIcon, XMarkIcon } from '@heroicons/react/24/outline';

import { Button } from '@/components/ui/button';
import {
  draggedFromNode,
  dragGroup,
  readDrag,
  writeDrag,
} from '@/pages/private/admin/editor/course-map/drag-payload';
import type { StagingGroup } from '@/services/course-map-api';

interface StagingManagerProps {
  groups: StagingGroup[];
  /** Highlighted because they are what is holding up a publish. */
  unmappedSectionIds: string[];
  onAddCourse: () => void;
  onRemoveCourse: (sourceCourseId: string) => void;
  /** Something dragged back out of a node and dropped here. */
  onReturn: (sectionIds: string[]) => void;
  /** Whether clicking a section ticks it rather than doing nothing. */
  selectMode: boolean;
  onToggleSelectMode: () => void;
  /** The ticked sections, shared with the node box so one drag can span both. */
  selected: ReadonlySet<string>;
  onToggleSelected: (sectionId: string) => void;
}

const StagingManager = ({
  groups,
  unmappedSectionIds,
  onAddCourse,
  onRemoveCourse,
  onReturn,
  selectMode,
  onToggleSelectMode,
  selected,
  onToggleSelected,
}: StagingManagerProps) => {
  const blocking = new Set(unmappedSectionIds);
  const total = groups.reduce((sum, group) => sum + group.sections.length, 0);
  /** Only what is actually in this pool, so the count never includes a node's. */
  const pickedHere = groups.reduce(
    (sum, group) => sum + group.sections.filter((section) => selected.has(section.id)).length,
    0,
  );

  return (
    <section
      aria-label="Staging manager"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        // Only content that came off a node comes back; a section dragged within
        // the pool has nowhere to return to and is ignored.
        if (!draggedFromNode(event.dataTransfer)) return;
        const sectionIds = readDrag(event.dataTransfer);
        if (sectionIds.length > 0) onReturn(sectionIds);
      }}
      // Square along the bottom and missing its bottom border: the node box sits
      // directly underneath and supplies the line between them, so the two read
      // as one panel rather than two that happen to be touching.
      className="flex h-full min-h-0 flex-col rounded-lg rounded-b-none border-2 border-b-0
        border-navy/20 bg-white"
    >
      <header className="flex items-center justify-between gap-2 border-b border-navy/15 px-3 py-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-dark-gray">Staging manager</h3>
          <p className="text-xs text-dark-gray">
            {selectMode && pickedHere > 0
              ? `${pickedHere} picked — drag any of them to move them together`
              : `${total} item${total === 1 ? '' : 's'} waiting to be placed`}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Button
            onClick={onToggleSelectMode}
            variant={selectMode ? 'default' : 'ghost'}
            size="icon"
            aria-pressed={selectMode}
            title={
              selectMode
                ? 'Stop selecting. Ticked sections are cleared.'
                : 'Select several sections, then drag any of them onto a node to move them together'
            }
            className={selectMode ? 'bg-navy text-white hover:bg-navy-hover' : ''}
          >
            <CheckIcon className="w-5 h-5 stroke-2" />
          </Button>
          <Button
            onClick={onAddCourse}
            variant="ghost"
            size="icon"
            title="Add another course to staging"
          >
            <PlusIcon className="w-5 h-5 stroke-2" />
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {groups.map((group) => (
          <div key={group.courseId} className="mb-3 last:mb-0">
            <div className="flex items-center justify-between gap-2">
              <h4
                className="min-w-0 flex-1 truncate text-xs font-semibold tracking-wide
                  text-dark-gray uppercase"
              >
                {group.courseTitle}
              </h4>
              {group.imported && (
                <button
                  onClick={() => onRemoveCourse(group.courseId)}
                  title={`Remove ${group.courseTitle} from staging`}
                  className="shrink-0 text-dark-gray hover:text-danger-hover"
                >
                  <XMarkIcon className="w-4 h-4" />
                </button>
              )}
            </div>

            {group.mapped && group.sections.length > 0 && (
              <p
                className="mt-1 rounded-md border border-danger/40 bg-danger/5 px-2 py-1 text-xs
                  text-danger"
              >
                This course has its own map. Drop any of it on a node to link the whole map in
                beneath that node — it stays fixed here and follows any changes made to it there.
              </p>
            )}

            {group.sections.length === 0 ? (
              <p className="mt-1 text-xs text-dark-gray">
                {group.imported
                  ? 'Everything from this course is placed.'
                  : 'Everything is mapped.'}
              </p>
            ) : (
              <ul className="mt-1 flex flex-col gap-1">
                {group.sections.map((section) => {
                  const picked = selectMode && selected.has(section.id);

                  return (
                    <li key={section.id}>
                      <div
                        draggable
                        onDragStart={(event) =>
                          // A drag on something ticked carries everything ticked;
                          // a drag on anything else carries only itself and leaves
                          // the selection where it is. See `dragGroup`.
                          writeDrag(
                            event.dataTransfer,
                            selectMode ? dragGroup(section.id, selected) : [section.id],
                          )
                        }
                        onClick={() => selectMode && onToggleSelected(section.id)}
                        className={`cursor-grab rounded-md border px-2 py-1.5 text-sm ${
                          picked
                            ? 'border-navy bg-navy/10 ring-1 ring-navy/30'
                            : blocking.has(section.id)
                              ? 'border-new/50 bg-new-soft'
                              : group.mapped
                                ? 'border-danger/40 bg-light-gray'
                                : 'border-navy/20 bg-light-gray'
                          }`}
                        title={
                          group.mapped
                            ? 'Drag onto a node to link this course’s whole map in beneath it'
                            : selectMode
                              ? 'Click to pick, drag to move'
                              : 'Drag onto a node'
                        }
                      >
                        <span className="font-medium text-dark-gray">{section.number}</span>{' '}
                        <span className="text-dark-gray">{section.title}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ))}
      </div>
    </section>
  );
};

export default StagingManager;
