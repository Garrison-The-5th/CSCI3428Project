/**
 * File: course-map-pane.tsx
 * Description: The Course mapping tab — staging, the selected node, and the map.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-09-22
 */
/**
 * Course mapping.
 *
 * Left: what is waiting to be placed, and what the selected node holds. Right:
 * the map itself, taking whatever is left of the screen. Content moves between
 * the two lists and the map by dragging, and every such move ends in one call —
 * `setItems` on the node that changed — because a node's content list is the
 * only thing any of those drags is actually a statement about.
 *
 * The whole map comes back from every mutation rather than being patched in
 * place. Connecting two nodes changes depths, which changes the layer quizzes,
 * which changes which node is offered where: too much moves at once for the
 * browser to reconstruct honestly, and the server has just worked it all out.
 */
import { ArrowPathIcon, ExclamationTriangleIcon, MapIcon } from '@heroicons/react/24/outline';
import { useCallback, useEffect, useState } from 'react';

import ConfirmDialog from '@/components/common/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import ToggleSwitch from '@/components/ui/toggle-switch';
import AddCourseDialog from '@/pages/private/admin/editor/course-map/add-course-dialog';
import MapCanvas from '@/pages/private/admin/editor/course-map/map-canvas';
import { depthsFrom } from '@/pages/private/admin/editor/course-map/map-geometry';
import NodeContents from '@/pages/private/admin/editor/course-map/node-contents';
import StagingManager from '@/pages/private/admin/editor/course-map/staging-manager';
import { type CourseMap, courseMapApi, type MapNode } from '@/services/course-map-api';
import type { Course } from '@/services/curriculum-api';
import { logger } from '@/utils/logger';

interface CourseMapPaneProps {
  course: Course;
  onNotify: (message: string, type?: 'success' | 'error') => void;
  /** Reloads the course, so the Modules tab picks up a generated layer quiz. */
  onRefresh: () => Promise<void> | void;
}

const CourseMapPane = ({ course, onNotify, onRefresh }: CourseMapPaneProps) => {
  const [map, setMap] = useState<CourseMap | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<MapNode | null>(null);
  /**
   * Picking several sections to move at once.
   *
   * Owned here rather than by either list, because one selection spans both: a
   * module's worth of sections ticked in the staging manager is dragged onto a
   * node, and sections ticked inside a node are dragged to another node or back
   * to the pool. Two selections would have made "drag what is ticked" mean
   * different things depending on where the pointer went down.
   */
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** The red "stage first" pop-up, shown when a change is tried on an unstaged map. */
  const [mustStage, setMustStage] = useState(false);
  const [staging, setStaging] = useState(false);

  const toggleSelected = useCallback((sectionId: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(sectionId)) next.add(sectionId);
      return next;
    });
  }, []);

  // Leaving select mode clears the ticks. A selection that survived the mode
  // being switched off would come back to life, and to sections the author had
  // long since stopped thinking about, the next time it was switched on.
  const toggleSelectMode = useCallback(() => {
    setSelectMode((on) => !on);
    setSelected(new Set());
  }, []);

  /**
   * Re-reads the whole map.
   *
   * Used by the actions whose endpoint answers with only the row it changed — a
   * rename, a move, a new node. Connecting and placing content return the map
   * themselves, because those are the changes that move depths and quizzes
   * around and are not worth a second round trip.
   */
  const refetch = useCallback(() => courseMapApi.getMap(course.id), [course.id]);

  const load = useCallback(async () => {
    try {
      setMap(await refetch());
    } catch (err) {
      logger.error('Error loading course map:', err);
      onNotify('Failed to load the course map', 'error');
    } finally {
      setLoading(false);
    }
  }, [refetch]);

  useEffect(() => {
    load();
  }, [load]);

  // Staged from the header's button: the map has to hear about it, or it would
  // go on refusing changes the server would now accept.
  useEffect(() => {
    if (course.stagedAt) load();
  }, [course.stagedAt]);

  // Keep something selected, so the second box is never blank on arrival. The
  // root is the honest default: it is the one node every map has.
  useEffect(() => {
    if (selectedNodeId && map?.nodes.some((node) => node.id === selectedNodeId)) return;
    setSelectedNodeId(map?.nodes.find((node) => node.isRoot)?.id ?? map?.nodes[0]?.id ?? null);
  }, [map, selectedNodeId]);

  /**
   * Runs a change, takes the map it returns, and reloads the course behind it.
   *
   * The course reload is what puts a newly generated "Directed learning quiz N"
   * module in the Modules tab without the author having to go and look.
   */
  const run = useCallback(
    async (action: () => Promise<{ map: CourseMap } | CourseMap>, failure: string) => {
      try {
        const result = await action();
        setMap('map' in result ? result.map : result);
        await onRefresh();
        return true;
      } catch (err) {
        logger.error(`${failure}:`, err);
        onNotify(err instanceof Error && err.message ? err.message : failure, 'error');
        // The map on screen may now disagree with the server — a refused
        // connection leaves the string drawn — so it is re-read rather than left.
        await load();
        return false;
      }
    },
    [load, onRefresh, onNotify],
  );

  const selectedNode = map?.nodes.find((node) => node.id === selectedNodeId) ?? null;

  /**
   * Lets a change through only once everything written has been staged.
   *
   * The gesture itself is allowed — the author can drag, pull a string, drop a
   * section — but nothing is saved: a moved node goes back, a string lets go,
   * and the red pop-up says why. The server refuses the same changes, so a page
   * left open while someone added a section elsewhere cannot slip one through.
   */
  const allowed = () => {
    if (!map?.needsStaging) return true;
    setMustStage(true);
    return false;
  };

  /** Stages from the pop-up, so the author does not have to go and find the button. */
  const stageNow = async () => {
    try {
      setStaging(true);
      setMap((await courseMapApi.stage(course.id)).map ?? (await refetch()));
      setMustStage(false);
      await onRefresh();
      onNotify('Staged — your content is ready to map');
    } catch (err) {
      logger.error('Failed to stage:', err);
      onNotify(err instanceof Error && err.message ? err.message : 'Failed to stage', 'error');
    } finally {
      setStaging(false);
    }
  };

  /**
   * Nodes with no route back to the root, which is one of the two things that
   * refuses a publish. See the note where it is drawn.
   */
  const reachable = depthsFrom(map?.nodes ?? [], map?.edges ?? []);
  const unlinked = (map?.nodes ?? []).filter((node) => !reachable.has(node.id));
  const rootTitle = map?.nodes.find((node) => node.isRoot)?.title ?? 'the root';

  /**
   * Drops the ticks once what was ticked has been moved.
   *
   * Only when the move actually involved the selection. Dragging a single
   * unticked section is not a statement about the ticked ones — `dragGroup` is
   * careful about that at the other end — so clearing here regardless would
   * throw away a selection the author was still building.
   */
  const clearIfMoved = (sectionIds: string[]) => {
    if (sectionIds.some((id) => selected.has(id))) setSelected(new Set());
  };

  /**
   * Puts sections on a node, wherever they came from.
   *
   * One call however many arrive, because a node's content list is one fact
   * about that node: sending eight sections as eight calls would rebuild the
   * layer quizzes eight times and redraw the map under the author's cursor as it
   * went. Anything the node already holds is dropped from the list rather than
   * refused — dropping a selection onto the node half of it is already on is a
   * perfectly ordinary thing to do.
   */
  const place = (nodeId: string, sectionIds: string[]) => {
    const node = map?.nodes.find((current) => current.id === nodeId);
    if (!node || !allowed()) return;

    const held = node.items.map((item) => item.sectionId);
    const arriving = sectionIds.filter((id) => !held.includes(id));
    if (arriving.length === 0) return;

    const done = run(
      () => courseMapApi.setItems(nodeId, [...held, ...arriving]),
      'Failed to place that content',
    );
    clearIfMoved(sectionIds);
    return done;
  };

  /**
   * Takes sections off whichever nodes hold them, back into staging.
   *
   * Grouped by the node they are leaving, so a selection spanning two nodes is
   * two calls rather than one per section — and a selection that came off one
   * node, which is the usual case, is a single call.
   */
  const unplace = (sectionIds: string[]) => {
    const leaving = new Set(sectionIds);
    const holders = (map?.nodes ?? []).filter((node) =>
      node.items.some((item) => leaving.has(item.sectionId)),
    );
    if (holders.length === 0 || !allowed()) return;

    const done = run(
      // Sent one after another rather than together. Each of these rebuilds the
      // layer quizzes on the server, and two doing that at once would have them
      // racing over the same rows — with whichever finished last deciding what
      // the quizzes say. Serial is slower by one round trip and right.
      async () => {
        let last = await courseMapApi.setItems(
          holders[0].id,
          holders[0].items.map((item) => item.sectionId).filter((id) => !leaving.has(id)),
        );
        for (const holder of holders.slice(1)) {
          last = await courseMapApi.setItems(
            holder.id,
            holder.items.map((item) => item.sectionId).filter((id) => !leaving.has(id)),
          );
        }
        return last;
      },
      'Failed to return that content to staging',
    );
    clearIfMoved(sectionIds);
    return done;
  };

  if (loading) {
    return (
      <Card className="bg-light-gray shadow-sm">
        <CardContent className="py-16 text-center text-dark-gray">Loading the map…</CardContent>
      </Card>
    );
  }

  /*
    Directed learning is opt-in per course, so this tab opens on the switch
    rather than on an empty map. Turning it on is what mints the root, and what
    starts requiring every section to be placed before this course may go out.
  */
  if (!map?.directedLearning) {
    return (
      <Card className="bg-light-gray shadow-sm">
        <CardContent className="flex flex-col items-start gap-4 p-6">
          <div className="flex items-center gap-3">
            <MapIcon className="w-6 h-6 shrink-0 text-navy" />
            <h2 className="text-lg font-semibold text-dark-gray">Directed learning</h2>
          </div>

          <p className="max-w-2xl text-sm text-dark-gray">
            Turn this on and the course stops reading straight through. You arrange its sections
            into nodes on a map, and each layer gets a quiz asking the learner which branches apply
            to them — so two people on this course can be given entirely different training.
          </p>
          <p className="max-w-2xl text-sm text-dark-gray">
            Once it is on, every section in this course has to be placed on the map before the
            course can be published. Sections you bring in from other courses do not: taking three
            of a course’s four sections is the point of bringing one in.
          </p>

          <ToggleSwitch
            checked={false}
            label="Build this course from a map"
            onChange={() =>
              run(
                () => courseMapApi.setDirected(course.id, true).then((r) => r.map),
                'Failed to turn on directed learning',
              )
            }
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="bg-light-gray shadow-sm">
        <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-dark-gray">Course mapping</h2>
            <p className="text-sm text-dark-gray">
              {map.stagedAt
                ? `Last staged ${new Date(map.stagedAt).toLocaleString()}`
                : 'Not staged yet — press Stage to course mapping to bring your content across.'}
              {map.stagedAt && map.needsStaging && (
                <>
                  {' · '}
                  <span className="font-semibold text-danger">
                    New content since then — stage the course before mapping it
                  </span>
                </>
              )}
              {map.unmappedSectionIds.length > 0 && (
                <>
                  {' · '}
                  <span className="font-semibold">
                    {map.unmappedSectionIds.length} section
                    {map.unmappedSectionIds.length === 1 ? '' : 's'} still to place
                  </span>
                </>
              )}
              {/*
                The other thing that will refuse the publish.

                This line exists to say what stands between the author and a
                published course, and until now it said only half of it: every
                node also has to have a route back to the root, empty ones
                included, and an author who had connected a box to the wrong
                thing found that out from a toast at the end rather than from the
                page they drew it on. Worked out here from the map already in
                hand — `depthsFrom` is the same walk the server does — rather
                than asking for it, because the answer is entirely contained in
                what has already been fetched.
              */}
              {unlinked.length > 0 && (
                <>
                  {' · '}
                  <span className="font-semibold text-danger">
                    {unlinked.length} node{unlinked.length === 1 ? '' : 's'} not linked to{' '}
                    {rootTitle}
                  </span>
                </>
              )}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-3">
            <Button onClick={load} variant="ghost" size="icon" title="Reload the map">
              <ArrowPathIcon className="w-5 h-5" />
            </Button>
            <ToggleSwitch
              checked
              label="Built from a map"
              onChange={() =>
                run(
                  () => courseMapApi.setDirected(course.id, false).then((r) => r.map),
                  'Failed to turn off directed learning',
                )
              }
            />
          </div>
        </CardContent>
      </Card>

      {/*
        Two stacked lists on the left, the map taking everything else. The height
        is fixed rather than grown from content so the map has somewhere to be:
        a canvas sized by its children collapses to nothing when it is empty,
        which is exactly when the author most needs room to drop a node.
      */}
      <div className="grid h-[70vh] min-h-[32rem] gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
        {/*
          No gap between the two: the staging manager runs all the way down to
          the node box and the two read as one stacked panel, which is what they
          are — content waiting to be placed, and the place it is going. Their
          touching borders are collapsed into one by the rounding overrides
          inside each.
        */}
        <div className="flex min-h-0 flex-col">
          <div className="min-h-0 flex-1">
            <StagingManager
              groups={map.staging}
              unmappedSectionIds={map.unmappedSectionIds}
              onAddCourse={() => setAdding(true)}
              onRemoveCourse={(sourceCourseId) =>
                allowed() &&
                run(
                  () => courseMapApi.removeImport(course.id, sourceCourseId).then((r) => r.map),
                  'Failed to remove that course from staging',
                )
              }
              onReturn={unplace}
              selectMode={selectMode}
              onToggleSelectMode={toggleSelectMode}
              selected={selected}
              onToggleSelected={toggleSelected}
            />
          </div>

          <div className="flex min-h-0 flex-1 flex-col">
            <NodeContents
              node={selectedNode}
              onReorder={(sectionIds) =>
                selectedNode &&
                allowed() &&
                run(() => courseMapApi.setItems(selectedNode.id, sectionIds), 'Failed to reorder')
              }
              // Renames the node it was told about rather than whichever is
              // selected now: a rename is flushed when the author clicks away,
              // by which time the selection has already moved on.
              onRename={(nodeId, title) =>
                allowed()
                  ? run(
                      () => courseMapApi.updateNode(nodeId, { title }).then(refetch),
                      'Failed to rename that node',
                    )
                  : // Refused: the box refills from the node as it is stored.
                    setMap((current) => (current ? { ...current } : current))
              }
              onAdopt={(sectionIds) => selectedNode && place(selectedNode.id, sectionIds)}
              selectMode={selectMode}
              selected={selected}
              onToggleSelected={toggleSelected}
            />
          </div>
        </div>

        <MapCanvas
          nodes={map.nodes}
          edges={map.edges}
          selectedNodeId={selectedNodeId}
          onSelect={setSelectedNodeId}
          onMove={(nodeId, x, y) => {
            if (!allowed()) return;
            /*
              Moved on screen at once, before the server answers.

              The canvas lets go of its own copy of the dragged position the
              moment the pointer comes up, so without this the node fell back to
              where it started for the length of the round trip and then jumped
              to where it had been put. Set in the same event as the canvas lets
              go, the two land in one render and the node simply stays put. A
              refused move is put right by `run`, which re-reads the map.
            */
            setMap((current) =>
              current
                ? {
                    ...current,
                    nodes: current.nodes.map((node) =>
                      node.id === nodeId ? { ...node, x, y } : node,
                    ),
                  }
                : current,
            );
            run(
              () => courseMapApi.updateNode(nodeId, { x, y }).then(refetch),
              'Failed to move that node',
            );
          }}
          onConnect={(parentId, childId) =>
            allowed() &&
            run(() => courseMapApi.connect(parentId, childId), 'Failed to connect those nodes')
          }
          onDisconnect={(parentId, childId) =>
            allowed() &&
            run(
              () => courseMapApi.disconnect(parentId, childId),
              'Failed to disconnect those nodes',
            )
          }
          onAddNode={() =>
            // No name given: the server's placeholder is also what it recognises
            // as "never named", which is what lets the first content dropped on
            // a node name it. See `CourseMapService.autoName`.
            allowed() &&
            run(() => courseMapApi.createNode(course.id).then(refetch), 'Failed to add a node')
          }
          onDeleteNode={(node) => allowed() && setPendingDelete(node)}
          onLayout={(positions) =>
            allowed() &&
            run(
              () => courseMapApi.setLayout(course.id, positions),
              'Failed to tidy the map into layers',
            )
          }
          onDropSections={place}
        />
      </div>

      <AddCourseDialog
        open={adding}
        courseId={course.id}
        onClose={() => setAdding(false)}
        onAdd={async (sourceCourseId) => {
          const ok = await run(
            () => courseMapApi.addImport(course.id, sourceCourseId).then((r) => r.map),
            'Failed to add that course to staging',
          );
          if (ok) setAdding(false);
        }}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Remove this node"
        message={
          pendingDelete?.linked ? (
            <>
              <span className="font-semibold">{pendingDelete.title}</span> is part of the map linked
              in from <span className="font-semibold">{pendingDelete.linked.sourceTitle}</span>.
              <br />
              Removing it removes the whole linked map — every one of its nodes and connections —
              and its content goes back to the staging manager.
            </>
          ) : (
            <>
              Remove <span className="font-semibold">{pendingDelete?.title}</span> from the map?
              <br />
              Its content goes back to the staging manager, and anything connected below it is left
              unconnected rather than removed with it.
            </>
          )
        }
        confirmLabel="Remove"
        onConfirm={() => {
          const target = pendingDelete;
          setPendingDelete(null);
          if (target) {
            run(
              () => courseMapApi.deleteNode(target.id).then(refetch),
              'Failed to remove that node',
            );
          }
        }}
        onCancel={() => setPendingDelete(null)}
      />

      {/*
        The red "stage first" pop-up. Shown when a change is tried on a map whose
        course has had sections or modules added since it was last staged; the
        change itself was not saved.
      */}
      {mustStage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
          role="presentation"
          onClick={() => setMustStage(false)}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="must-stage-title"
            className="w-full max-w-md rounded-lg border-2 border-danger bg-danger p-6 text-white
              shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start gap-4">
              <ExclamationTriangleIcon className="h-7 w-7 shrink-0" />
              <div className="min-w-0 flex-1">
                <h2 id="must-stage-title" className="text-lg font-semibold">
                  Stage the course before mapping it
                </h2>
                <p className="mt-2 text-sm">
                  {map.stagedAt
                    ? 'New sections or modules have been added since this course was last staged. '
                    : 'This course has not been staged yet. '}
                  Your change has not been saved — stage the course, then make it again.
                </p>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <Button
                type="button"
                onClick={() => setMustStage(false)}
                variant="outline"
                className="border-white bg-transparent text-white hover:bg-white/10"
              >
                Close
              </Button>
              <Button
                type="button"
                onClick={stageNow}
                disabled={staging}
                className="bg-white text-danger hover:bg-white/90"
              >
                {staging ? 'Staging...' : 'Stage course now'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CourseMapPane;
