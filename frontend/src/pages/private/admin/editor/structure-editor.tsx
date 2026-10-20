/**
 * File: structure-editor.tsx
 * Description: The course structure editor — modules, their sections, and the content in them.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
/**
 * The course structure editor.
 *
 * Left  : the add-module and add-section forms, a rule, then the course as a
 *         collapsible outline — module headings with their sections underneath.
 *         Numbers are never typed: a section is 2.3 because it is the third section
 *         of the second module, so dragging is what renumbers the course.
 *         Each section's content is listed under it, tabbed in a step further,
 *         and is where a piece of content is picked and dragged to reorder.
 * Right : the selected section's number, title and time, with the content-type
 *         picker and Add beside them, then the one piece of content being edited.
 */
import {
  Bars3Icon,
  CheckIcon,
  ChevronDownIcon,
  FolderPlusIcon,
  PencilSquareIcon,
  PlusIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { useEffect, useMemo, useRef, useState } from 'react';

import EditedTag from '@/components/common/edited-tag';
import ElementEditor, { elementSummary } from '@/components/common/element-editor';
import { NewBadge, newMarkers } from '@/components/common/new-badge';
import QuizEditor from '@/components/common/quiz-editor';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import LockOverlay from '@/components/ui/lock-overlay';
import { useEditLocks } from '@/contexts/edit-locks-context';
import { saveStatus, useAutoSave } from '@/hooks/use-auto-save';
import ModuleColorPicker from '@/pages/private/admin/editor/module-color-picker';
import {
  Course,
  CourseSection,
  curriculumApi,
  ElementType,
  ModuleGroup,
  moduleGroups,
  moduleTint,
  NewIds,
  sectionContent,
  SectionContentItem,
} from '@/services/curriculum-api';
import { quizApi } from '@/services/quiz-api';
import { logger } from '@/utils/logger';

interface Props {
  course: Course;
  selectedSectionId: string | null;
  onSelectSection: (id: string | null) => void;
  onRefresh: () => Promise<void>;
  onNotify: (message: string, type?: 'success' | 'error') => void;
  onDelete: (target: {
    kind: 'section' | 'module' | 'quiz' | 'element';
    id: string;
    label: string;
  }) => void;
  run: (action: () => Promise<unknown>, success: string, failure: string) => Promise<boolean>;
  setCourse: (updater: (prev: Course | null) => Course | null) => void;
  /** What has been edited but not published, for the New tags. */
  unpublished?: NewIds | null;
}

const inputClass = 'bg-white text-dark-gray';
const primaryBtn = 'bg-navy text-white hover:bg-navy-hover';

/**
 * What the Add-content picker offers.
 *
 * A quiz is its own record rather than an element, but authors think of it as one
 * more thing to drop into a section, so it sits in the same list. PDF is absent
 * deliberately — a PDF is uploaded into an IMAGE block, which becomes one.
 */
type NewContentType = Exclude<ElementType, 'PDF'> | 'QUIZ';
const CONTENT_TYPES: NewContentType[] = ['TEXT', 'YOUTUBE', 'IMAGE', 'CANVAS', 'QUIZ'];

/** The one-line label a piece of content goes by in the course structure. */
function itemLabel(item: SectionContentItem): { type: string; text: string } {
  return item.kind === 'element'
    ? { type: item.element.type, text: elementSummary(item.element) }
    : { type: 'QUIZ', text: item.quiz.title };
}

/** What is being dragged/** What is being dragged, so a section is never dropped onto a module list. */
type Drag = { kind: 'section'; id: string } | { kind: 'module'; id: string } | null;

/**
 * Whether a module was generated for a course map's layer quiz.
 *
 * Recognised by its name, which the generator owns and an author cannot reach —
 * the module is locked below, and a hand-made module of the same name would be
 * locked with it, which is the safe way round to be wrong.
 */
function isLayerModule(title: string): boolean {
  return /^Directed learning quiz \d+$/.test(title);
}

const StructureEditor = ({
  course,
  selectedSectionId,
  onSelectSection,
  onRefresh,
  onNotify,
  onDelete,
  run,
  setCourse,
  unpublished,
}: Props) => {
  /** In-flight latch for addContent, so a double click adds one block, not two. */
  const addingRef = useRef(false);
  const [adding, setAdding] = useState(false);
  /** The module whose title is being edited inline, and the text so far. */
  const [editingModule, setEditingModule] = useState<{ id: string; title: string } | null>(null);

  const groups = moduleGroups(course);
  const isNew = newMarkers(unpublished);

  /** Saves an inline module rename, or quietly drops an empty one. */
  const saveModuleTitle = async () => {
    const editing = editingModule;
    setEditingModule(null);
    if (!editing) return;

    const title = editing.title.trim();
    const current = groups.find((group) => group.module.id === editing.id)?.module.title;
    if (!title || title === current) return;

    await run(
      () => curriculumApi.updateModule(editing.id, { title }),
      'Module renamed',
      'Failed to rename the module',
    );
  };

  const [newModule, setNewModule] = useState({ title: '' });
  const [newSection, setNewSection] = useState({ title: '', estimatedMinutes: '', moduleId: '' });
  const [newType, setNewType] = useState<NewContentType>('TEXT');
  const [drag, setDrag] = useState<Drag>(null);
  const [contentDrag, setContentDrag] = useState<{ sectionId: string; id: string } | null>(null);
  /** The piece of content open in the main editor — an element or a quiz. */
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  /** Collapsed rather than expanded, so reopening the editor looks unchanged. */
  const [collapsedModuleIds, setCollapsedModuleIds] = useState<Set<string>>(new Set());
  /** Sections folded down to their row, hiding the content listed under them. */
  const [collapsedSectionIds, setCollapsedSectionIds] = useState<Set<string>>(new Set());

  /**
   * Modules somebody else has open, and how this pane says which one is ours.
   *
   * A module is claimed whole rather than section by section because editing one
   * really means editing the sections and elements inside it — there is no
   * smaller unit an author actually works in, and locking at a finer grain would
   * let two people rearrange the same module's contents against each other.
   */
  const { lockedModules, claim, marks } = useEditLocks();

  /**
   * Whichever module is expanded is the one being worked in, so that is the
   * claim. Collapsing them all gives it up — an author looking at a course
   * outline is not editing any of it.
   */
  const openModuleId = useMemo(
    () => groups.find((group) => !collapsedModuleIds.has(group.module.id))?.module.id ?? null,
    [groups, collapsedModuleIds],
  );

  useEffect(() => {
    claim('MODULE', openModuleId);
  }, [openModuleId, claim]);

  const selectedSection = course.sections.find((m) => m.id === selectedSectionId) ?? null;
  /**
   * The section a layer quiz sits in. The map owns it — its name, its place and
   * what is in it — so only the quiz inside opens, and that keeps all but its
   * wording fixed.
   */
  const layerSection = selectedSection?.quizzes.some((quiz) => quiz.type === 'DIRECTED') ?? false;

  const selectedItems = selectedSection ? sectionContent(selectedSection) : [];
  const selectedItem = selectedItems.find((item) => item.id === selectedItemId) ?? null;

  /*
   * Something is always open while the section has content: arriving at a
   * section opens its first piece, and deleting the open one falls back to the
   * first of what is left.
   */
  useEffect(() => {
    if (selectedItem) return;
    setSelectedItemId(selectedItems[0]?.id ?? null);
  }, [selectedSection?.id, selectedItem, selectedItems[0]?.id]);

  const [sectionDraft, setSectionDraft] = useState({ title: '', estimatedMinutes: '' });

  useEffect(() => {
    if (!selectedSection) return;
    setSectionDraft({
      title: selectedSection.title,
      estimatedMinutes: String(selectedSection.estimatedMinutes),
    });
  }, [selectedSection?.id]);

  /**
   * Whether the header has moved on from the section as stored. Compared rather
   * than flagged so it is right after a save lands from anywhere — the parent
   * refetches on every write.
   */
  const sectionDirty = selectedSection
    ? sectionDraft.title !== selectedSection.title ||
      sectionDraft.estimatedMinutes !== String(selectedSection.estimatedMinutes)
    : false;

  const { state: sectionState, saveNow: saveSectionNow } = useAutoSave(
    sectionDraft,
    async (value) => {
      if (!selectedSection) return;
      if (!value.title.trim()) return;
      await curriculumApi.updateSection(selectedSection.id, {
        title: value.title.trim(),
        estimatedMinutes: Number(value.estimatedMinutes) || 0,
      });
      await onRefresh();
    },
    // Keyed on the section, so switching to another one writes what was typed
    // into this one rather than dropping it.
    { enabled: Boolean(selectedSection), resetKey: selectedSection?.id ?? null },
  );

  const toggleModule = (moduleId: string) =>
    setCollapsedModuleIds((prev) => {
      const next = new Set(prev);
      if (next.has(moduleId)) next.delete(moduleId);
      else next.add(moduleId);
      return next;
    });

  const toggleSection = (sectionId: string) =>
    setCollapsedSectionIds((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });

  /** Lands at the end of the course; drag it from the outline to move it. */
  const addModule = async () => {
    if (!newModule.title.trim()) return onNotify('Give the module a title', 'error');

    const ok = await run(
      () =>
        curriculumApi.createModule(course.id, {
          title: newModule.title.trim(),
          number: groups.length + 1,
        }),
      `Module added`,
      'Failed to add module',
    );
    if (ok) setNewModule({ title: '' });
  };

  /**
   * The modules a new section may go into: every one but the map's generated
   * quiz modules, which hold their own quiz and nothing else. Those are appended
   * at the end of the course, so defaulting to "the last module" used to put new
   * sections straight into one.
   */
  const sectionHomes = groups.filter((group) => !isLayerModule(group.module.title));
  const defaultHome = sectionHomes[sectionHomes.length - 1]?.module.id ?? '';
  const chosenHome = sectionHomes.some((group) => group.module.id === newSection.moduleId)
    ? newSection.moduleId
    : defaultHome;

  /** Lands at the end of the chosen module and takes the next number there. */
  const addSection = async () => {
    if (!newSection.title.trim()) return onNotify('Give the section a title', 'error');
    if (sectionHomes.length === 0) {
      return onNotify('Add a module first — sections live inside one', 'error');
    }

    const moduleId = chosenHome;
    const ok = await run(
      () =>
        curriculumApi.createSection(course.id, {
          moduleId,
          title: newSection.title.trim(),
          estimatedMinutes: Number(newSection.estimatedMinutes) || 0,
        }),
      'Section added',
      'Failed to add section',
    );
    if (ok) setNewSection({ title: '', estimatedMinutes: '', moduleId });
  };

  /** Opens a piece of content, along with the section it sits in. */
  const selectItem = (sectionId: string, itemId: string) => {
    onSelectSection(sectionId);
    setSelectedItemId(itemId);
  };

  /**
   * Adds a blank block of the picked type to the end of the section and opens
   * it, so the author fills it in where it will live rather than in a staging
   * box above. A quiz gets a placeholder title, renamed in its own settings.
   */
  const addContent = async () => {
    if (!selectedSection || addingRef.current) return;
    addingRef.current = true;
    setAdding(true);
    const sectionId = selectedSection.id;
    try {
      const response =
        newType === 'QUIZ'
          ? await quizApi.createQuiz({ title: 'New quiz', sectionId })
          : await curriculumApi.createElement(sectionId, { type: newType });
      await onRefresh();
      const createdId: string | undefined = response?.quiz?.id ?? response?.element?.id;
      if (createdId) setSelectedItemId(createdId);
      // The new block is highlighted in the outline, so its module has to be open.
      if (selectedSection.moduleId) {
        setCollapsedModuleIds((prev) => {
          if (!prev.has(selectedSection.moduleId!)) return prev;
          const next = new Set(prev);
          next.delete(selectedSection.moduleId!);
          return next;
        });
      }
      // And so does its section.
      setCollapsedSectionIds((prev) => {
        if (!prev.has(sectionId)) return prev;
        const next = new Set(prev);
        next.delete(sectionId);
        return next;
      });
    } catch (err) {
      logger.error('Failed to add content:', err);
      onNotify(
        err instanceof Error && err.message ? err.message : 'Failed to add content',
        'error',
      );
    } finally {
      addingRef.current = false;
      setAdding(false);
    }
  };

  /** Dragging content renumbers the section's whole sequence, quizzes included. */
  const handleContentDrop = async (section: CourseSection, targetId: string) => {
    const dragged = contentDrag;
    setContentDrag(null);
    // Content moves within its own section only.
    if (!dragged || dragged.sectionId !== section.id || dragged.id === targetId) return;
    const ordered = sectionContent(section);
    const from = ordered.findIndex((i) => i.id === dragged.id);
    const to = ordered.findIndex((i) => i.id === targetId);
    if (from < 0 || to < 0) return;

    const next = [...ordered];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);

    await run(
      () =>
        curriculumApi.reorderSectionContent(
          section.id,
          next.map((i) => ({ kind: i.kind, id: i.id })),
        ),
      '',
      'Failed to reorder content',
    );
  };

  /**
   * Sends the grid as it now stands and renumbers optimistically so the new
   * numbers appear under the cursor rather than a round trip later. The previous
   * course is kept so a failed save can put it back exactly as it was.
   */
  const applyStructure = async (next: ModuleGroup[]) => {
    const previous = course;

    setCourse((prev) =>
      prev
        ? {
            ...prev,
            modules: next.map((group, index) => ({ ...group.module, number: index + 1 })),
            sections: next.flatMap((group, moduleIndex) =>
              group.sections.map((section, sectionIndex) => ({
                ...section,
                moduleId: group.module.id,
                position: sectionIndex + 1,
                number: `${moduleIndex + 1}.${sectionIndex + 1}`,
              })),
            ),
          }
        : prev,
    );

    try {
      await curriculumApi.reorderStructure(
        course.id,
        next.map((group) => ({
          id: group.module.id,
          sectionIds: group.sections.map((section) => section.id),
        })),
      );
      await onRefresh();
    } catch (err) {
      logger.error('Failed to reorder the course:', err);
      onNotify('Failed to reorder the course', 'error');
      setCourse(() => previous);
    }
  };

  /** Drops a section before `targetSectionId`, or on the end of a module. */
  const handleSectionDrop = async (moduleId: string, targetSectionId: string | null) => {
    const dragged = drag;
    setDrag(null);
    if (dragged?.kind !== 'section' || dragged.id === targetSectionId) return;
    // A layer quiz's module holds its own section and nothing else, and its
    // section stays where the map put it.
    const into = groups.find((group) => group.module.id === moduleId);
    const from = groups.find((group) =>
      group.sections.some((section) => section.id === dragged.id),
    );
    if (into !== from && [into, from].some((group) => group && isLayerModule(group.module.title))) {
      return onNotify(
        'Directed learning quiz modules are built by the course map and cannot hold other sections',
        'error',
      );
    }

    const next = groups.map((group) => ({
      ...group,
      sections: group.sections.filter((section) => section.id !== dragged.id),
    }));

    const moved = course.sections.find((section) => section.id === dragged.id);
    const target = next.find((group) => group.module.id === moduleId);
    if (!moved || !target) return;

    const at = targetSectionId
      ? target.sections.findIndex((section) => section.id === targetSectionId)
      : target.sections.length;
    target.sections.splice(at < 0 ? target.sections.length : at, 0, moved);

    await applyStructure(next);
  };

  /**
   * Dragging a module heading moves it and everything inside it.
   *
   * A *section* dropped on a heading goes on the end of that module. The heading
   * is where an author naturally aims, and for an empty module it is most of
   * what there is to aim at — ignoring the drop there made empty modules look as
   * though they refused sections altogether.
   */
  const handleModuleDrop = async (targetModuleId: string) => {
    if (drag?.kind === 'section') return handleSectionDrop(targetModuleId, null);

    const dragged = drag;
    setDrag(null);
    if (dragged?.kind !== 'module' || dragged.id === targetModuleId) return;

    const next = [...groups];
    const from = next.findIndex((group) => group.module.id === dragged.id);
    const to = next.findIndex((group) => group.module.id === targetModuleId);
    if (from < 0 || to < 0) return;

    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);

    await applyStructure(next);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[21rem_minmax(0,1fr)]">
      {/* ---- Course outline ---- */}
      <Card className="h-fit bg-light-gray shadow-sm">
        <CardHeader className="p-4">
          <CardTitle className="text-lg text-dark-gray">Course structure</CardTitle>
        </CardHeader>

        <CardContent className="flex flex-col gap-3">
          {/* New module */}
          <div className="flex flex-col gap-2 rounded-lg border border-navy/30 bg-white/60 p-3">
            <p className="text-sm font-semibold text-dark-gray">New module</p>
            {/* Only a name. The number was asked for here and it was the wrong
                question at the wrong time: a module that does not exist yet has
                no place in the course to state, and the answer was overwritten
                by the first drag anyway. It lands at the end and shows its
                number in the outline below, once it is a real module. */}
            <Input
              value={newModule.title}
              onChange={(e) => setNewModule({ ...newModule, title: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && addModule()}
              placeholder="Module title"
              className={inputClass}
            />
            <Button onClick={addModule} className={primaryBtn}>
              <FolderPlusIcon className="w-5 h-5 stroke-2" /> Add module
            </Button>
          </div>

          {/* New section */}
          <div className="flex flex-col gap-2 rounded-lg border border-navy/30 bg-white/60 p-3">
            <p className="text-sm font-semibold text-dark-gray">New section</p>
            <div className="flex gap-2">
              <select
                value={chosenHome}
                onChange={(e) => setNewSection({ ...newSection, moduleId: e.target.value })}
                disabled={sectionHomes.length === 0}
                className="h-9 min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-2
                  text-sm text-dark-gray"
              >
                {sectionHomes.map((group) => (
                  <option key={group.module.id} value={group.module.id}>
                    {group.module.title}
                  </option>
                ))}
              </select>
              <Input
                value={newSection.estimatedMinutes}
                onChange={(e) => setNewSection({ ...newSection, estimatedMinutes: e.target.value })}
                placeholder="Mins"
                className={`${inputClass} max-w-20`}
              />
            </div>
            <Input
              value={newSection.title}
              onChange={(e) => setNewSection({ ...newSection, title: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && addSection()}
              placeholder="New section title"
              className={inputClass}
            />
            <Button
              onClick={addSection}
              className={primaryBtn}
              disabled={sectionHomes.length === 0}
            >
              <PlusIcon className="w-5 h-5 stroke-2" /> Add section
            </Button>
          </div>

          <hr className="h-px border-t-0 bg-gray-300" />

          {groups.length === 0 ? (
            <p className="text-sm text-dark-gray">No modules yet.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {groups.map((group) => {
                const collapsed = collapsedModuleIds.has(group.module.id);
                const minutes = group.sections.reduce((sum, m) => sum + m.estimatedMinutes, 0);

                const lockedBy = lockedModules[group.module.id];
                /*
                  A layer quiz's module is written by the course map, not by
                  hand: its name, its place and its section are regenerated
                  whenever a node moves, so the heading goes under the same sheet
                  somebody else's edit lease uses. The quiz inside is still
                  reachable — its wording is the author's to change, and the quiz
                  editor keeps everything else fixed.
                */
                const generated = isLayerModule(group.module.title);

                return (
                  /*
                    Somebody else is in this module, so the whole group goes
                    under the sheet — heading, sections and all. Locking only the
                    heading would leave every section inside it editable, which
                    is the content the lock exists to protect.
                  */
                  <LockOverlay
                    key={group.module.id}
                    locked={Boolean(lockedBy)}
                    reason={lockedBy ? `${lockedBy} is editing this module` : undefined}
                  >
                    <div className="flex flex-col gap-1">
                      {/* Module heading — drag it to move the whole module */}
                      <LockOverlay
                        locked={generated}
                        compact
                        reason="Built from the course map — open its quiz below to reword it"
                      >
                        <div
                          draggable
                          onDragStart={() => setDrag({ kind: 'module', id: group.module.id })}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={() => handleModuleDrop(group.module.id)}
                          onDragEnd={() => setDrag(null)}
                          className={`flex cursor-grab items-center gap-1 rounded-md border px-2
                            py-2 ${group.module.color ? '' : 'border-navy/40 bg-navy/5'}
                            ${drag?.kind === 'module' && drag.id === group.module.id ? 'opacity-50' : ''}`}
                          // The tint the learner will see, previewed where it is set.
                          style={moduleTint(group.module.color)}
                        >
                          <Bars3Icon className="w-4 h-4 shrink-0 text-dark-gray" />

                          {editingModule?.id === group.module.id ? (
                            // Renaming takes over the row: the drag handle and the
                            // collapse toggle would both fight a text field.
                            <Input
                              autoFocus
                              value={editingModule.title}
                              onChange={(e) =>
                                setEditingModule({ id: group.module.id, title: e.target.value })
                              }
                              onBlur={saveModuleTitle}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') saveModuleTitle();
                                if (e.key === 'Escape') setEditingModule(null);
                              }}
                              onClick={(e) => e.stopPropagation()}
                              aria-label="Module title"
                              className={`${inputClass} h-8 min-w-0 flex-1`}
                            />
                          ) : (
                            <button
                              onClick={() => toggleModule(group.module.id)}
                              aria-expanded={!collapsed}
                              className="flex min-w-0 flex-1 items-center gap-2 text-left"
                            >
                              <ChevronDownIcon
                                className={`w-4 h-4 shrink-0 text-dark-gray transition-transform
                                  duration-200 ${collapsed ? '-rotate-90' : ''}`}
                              />
                              <span className="min-w-0 flex-1 text-sm text-dark-gray">
                                <span className="flex flex-wrap items-center gap-2">
                                  <span className="break-words font-semibold">
                                    {group.module.number}. {group.module.title}
                                  </span>
                                  {isNew.module(group.module.id) && <NewBadge />}
                                  <EditedTag mark={marks.modules[group.module.id]} />
                                </span>
                                <span className="block text-xs">
                                  {group.sections.length} section
                                  {group.sections.length === 1 ? '' : 's'}
                                  {minutes > 0 && ` · ${minutes} min`}
                                </span>
                              </span>
                            </button>
                          )}

                          {group.module.id !== 'unmoduleed' && (
                            <>
                              <ModuleColorPicker
                                color={group.module.color}
                                label={group.module.title}
                                onSelect={(color) =>
                                  run(
                                    () => curriculumApi.updateModule(group.module.id, { color }),
                                    color ? 'Module colour set' : 'Module colour cleared',
                                    'Failed to change the module colour',
                                  )
                                }
                              />
                              <Button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingModule({
                                    id: group.module.id,
                                    title: group.module.title,
                                  });
                                }}
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 shrink-0 hover:text-green-hover"
                                title="Rename module"
                              >
                                <PencilSquareIcon className="w-4 h-4" />
                              </Button>
                              <Button
                                onClick={() =>
                                  onDelete({
                                    kind: 'module',
                                    id: group.module.id,
                                    label: `${group.module.number}. ${group.module.title}`,
                                  })
                                }
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 shrink-0 hover:text-danger-hover"
                                title="Delete module"
                              >
                                <TrashIcon className="w-4 h-4" />
                              </Button>
                            </>
                          )}
                        </div>
                      </LockOverlay>

                      {!collapsed && (
                        <div
                          className="flex flex-col gap-1 pl-4"
                          // Dropping in the gap under the last section appends here,
                          // which is the only way into an empty module.
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={() => handleSectionDrop(group.module.id, null)}
                        >
                          {group.sections.length === 0 ? (
                            <p
                              className={`rounded-md border-2 border-dashed px-2 py-4 text-center
                                text-xs text-dark-gray
                                ${drag?.kind === 'section' ? 'border-navy/50 bg-navy/5' : 'border-gray-300'}`}
                            >
                              Empty
                            </p>
                          ) : (
                            group.sections.map((section: CourseSection) => (
                              <div key={section.id} className="flex flex-col gap-1">
                                <div
                                  draggable={!generated}
                                  onDragStart={() => setDrag({ kind: 'section', id: section.id })}
                                  onDragOver={(e) => e.preventDefault()}
                                  onDrop={(e) => {
                                    e.stopPropagation();
                                    handleSectionDrop(group.module.id, section.id);
                                  }}
                                  onDragEnd={() => setDrag(null)}
                                  className={`flex cursor-grab items-center gap-2 rounded-md border
                                    px-3 py-2
                                    ${section.id === selectedSectionId ? 'border-navy bg-white' : 'border-gray-300 bg-white/60'}
                                    ${drag?.kind === 'section' && drag.id === section.id ? 'opacity-50' : ''}`}
                                  // The colour is the module's, so its sections read
                                  // as belonging together down the whole outline.
                                  style={
                                    group.module.color
                                      ? {
                                          borderLeftWidth: '4px',
                                          borderLeftColor: group.module.color,
                                        }
                                      : undefined
                                  }
                                >
                                  <Bars3Icon className="w-4 h-4 shrink-0 text-dark-gray" />
                                  {sectionContent(section).length > 0 && (
                                    <button
                                      type="button"
                                      onClick={() => toggleSection(section.id)}
                                      aria-expanded={!collapsedSectionIds.has(section.id)}
                                      aria-controls={`section-content-${section.id}`}
                                      aria-label={
                                        collapsedSectionIds.has(section.id)
                                          ? `Show ${section.title} content`
                                          : `Hide ${section.title} content`
                                      }
                                      className="shrink-0 rounded p-0.5 text-dark-gray
                                        hover:bg-light-gray"
                                    >
                                      <ChevronDownIcon
                                        className={`w-4 h-4 transition-transform duration-200
                                          ${collapsedSectionIds.has(section.id) ? '-rotate-90' : ''}`}
                                      />
                                    </button>
                                  )}
                                  <button
                                    onClick={() => onSelectSection(section.id)}
                                    className="min-w-0 flex-1 text-left text-sm text-dark-gray"
                                  >
                                    <span className="flex flex-wrap items-center gap-2">
                                      <span>
                                        <span className="font-semibold">{section.number}</span>{' '}
                                        {section.title}
                                      </span>
                                      {isNew.section(section.id, section.moduleId) && <NewBadge />}
                                      <EditedTag mark={marks.sections[section.id]} />
                                    </span>
                                    <span className="block text-xs">
                                      {section.elements.length} items
                                      {section.quizzes.length > 0 &&
                                        ` · ${section.quizzes.length} quiz`}
                                      {section.estimatedMinutes > 0 &&
                                        ` · ${section.estimatedMinutes} min`}
                                    </span>
                                  </button>
                                </div>

                                {/* The section's content, a step further in — the
                                  same way sections sit under their module. */}
                                {sectionContent(section).length > 0 &&
                                  !collapsedSectionIds.has(section.id) && (
                                    <ul
                                      id={`section-content-${section.id}`}
                                      className="flex flex-col gap-1 pl-4"
                                    >
                                      {sectionContent(section).map((item) => {
                                        const { type, text } = itemLabel(item);
                                        const active =
                                          section.id === selectedSectionId &&
                                          item.id === selectedItemId;
                                        // A layer quiz stays where the map put it.
                                        const movable = !generated;
                                        return (
                                          <li
                                            key={item.id}
                                            draggable={movable}
                                            onDragStart={(e) => {
                                              // Not a section drag as well.
                                              e.stopPropagation();
                                              setContentDrag({
                                                sectionId: section.id,
                                                id: item.id,
                                              });
                                            }}
                                            onDragOver={(e) => e.preventDefault()}
                                            onDrop={(e) => {
                                              if (!contentDrag) return;
                                              e.stopPropagation();
                                              handleContentDrop(section, item.id);
                                            }}
                                            onDragEnd={() => setContentDrag(null)}
                                            className={`flex items-center gap-2 rounded-md border
                                              px-2 py-1.5 ${movable ? 'cursor-grab' : ''} ${
                                                active
                                                  ? 'border-navy bg-navy text-white'
                                                  : `border-gray-300 bg-white/60 text-dark-gray
                                                    hover:bg-white`
                                              } ${contentDrag?.id === item.id ? 'opacity-50' : ''}`}
                                          >
                                            {movable && (
                                              <Bars3Icon className="w-3.5 h-3.5 shrink-0" />
                                            )}
                                            <button
                                              onClick={() => selectItem(section.id, item.id)}
                                              aria-current={active ? 'true' : undefined}
                                              className="flex min-w-0 flex-1 items-center gap-2
                                                text-left text-xs"
                                            >
                                              <span className="min-w-0 flex-1 truncate">
                                                <span className="font-semibold">{type}</span> {text}
                                              </span>
                                              {isNew.item(
                                                item.id,
                                                section.id,
                                                section.moduleId,
                                              ) && <NewBadge />}
                                            </button>
                                          </li>
                                        );
                                      })}
                                    </ul>
                                  )}
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  </LockOverlay>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---- Selected section ---- */}
      <Card className="bg-light-gray shadow-sm">
        {!selectedSection ? (
          <CardContent className="py-16 text-center">
            <p>No section selected.</p>
          </CardContent>
        ) : (
          <>
            <CardHeader className="flex-row flex-wrap items-end justify-between gap-3 p-4">
              <div className="flex flex-1 flex-wrap items-end gap-3">
                <div className="flex flex-col gap-1 text-sm font-medium text-dark-gray">
                  Number
                  {/* Read-only: the number is where the section sits, so it moves
                      by dragging rather than by typing. */}
                  <span
                    className="flex h-9 items-center rounded-md border border-gray-300 bg-gray-100
                      px-3 font-semibold"
                    title="Set by the section's place in its module — drag to change it"
                  >
                    {selectedSection.number}
                  </span>
                </div>
                <label
                  className="flex min-w-60 flex-1 flex-col gap-1 text-sm font-medium text-dark-gray"
                >
                  Title
                  <Input
                    value={sectionDraft.title}
                    onChange={(e) => setSectionDraft({ ...sectionDraft, title: e.target.value })}
                    disabled={layerSection}
                    className={`${inputClass} disabled:cursor-not-allowed disabled:bg-gray-100`}
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm font-medium text-dark-gray">
                  Time (mins)
                  <Input
                    value={sectionDraft.estimatedMinutes}
                    onChange={(e) =>
                      setSectionDraft({ ...sectionDraft, estimatedMinutes: e.target.value })
                    }
                    disabled={layerSection}
                    className={`${inputClass} max-w-28 disabled:cursor-not-allowed
                      disabled:bg-gray-100`}
                  />
                </label>

                {/* Adding content. A layer quiz's section holds its quiz and
                    nothing else, so it has none to offer. */}
                {!layerSection && (
                  <div className="flex items-end gap-2">
                    <label className="flex flex-col gap-1 text-sm font-medium text-dark-gray">
                      Content
                      <select
                        value={newType}
                        onChange={(e) => setNewType(e.target.value as NewContentType)}
                        aria-label="Content type to add"
                        className="h-9 rounded-md border border-gray-300 bg-white px-2 text-sm
                          font-normal text-dark-gray"
                      >
                        {CONTENT_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </label>
                    <Button onClick={addContent} disabled={adding} className={primaryBtn}>
                      <PlusIcon className="w-5 h-5 stroke-2" /> {adding ? 'Adding…' : 'Add'}
                    </Button>
                  </div>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-3">
                <span className="text-xs text-dark-gray">
                  {saveStatus(sectionState, sectionDirty)}
                </span>
                <Button
                  onClick={saveSectionNow}
                  disabled={sectionState === 'saving'}
                  variant="ghost"
                  size="icon"
                  className="hover:text-green-hover"
                  title="Save this section now"
                >
                  <CheckIcon className="w-6 h-6" />
                </Button>
                {!layerSection && (
                  <Button
                    onClick={() =>
                      onDelete({
                        kind: 'section',
                        id: selectedSection.id,
                        label: `${selectedSection.number} ${selectedSection.title}`,
                      })
                    }
                    variant="ghost"
                    size="icon"
                    className="hover:text-danger-hover"
                    title="Delete section"
                  >
                    <TrashIcon className="w-6 h-6" />
                  </Button>
                )}
              </div>
            </CardHeader>

            <CardContent className="flex flex-col gap-4">
              <hr className="h-px border-t-0 bg-gray-300" />

              {/* Only the content being worked on. Everything else in the
                  section is listed in the course structure, and picked there. */}
              {!selectedItem ? (
                <p className="text-sm text-dark-gray">Nothing in this section yet.</p>
              ) : selectedItem.kind === 'element' ? (
                <ElementEditor
                  key={selectedItem.id}
                  element={selectedItem.element}
                  editedMark={marks.elements[selectedItem.id]}
                  onDelete={() =>
                    onDelete({
                      kind: 'element',
                      id: selectedItem.id,
                      label: selectedItem.element.type,
                    })
                  }
                  onSaved={onRefresh}
                  onNotify={onNotify}
                />
              ) : (
                <div key={selectedItem.id} className="rounded-lg border border-navy/40 bg-navy/5">
                  <div className="flex items-center gap-2 px-3 py-2">
                    {/* Tag underneath, so a long name cannot push the bin on the
                        right out of the row. */}
                    <span className="flex min-h-10 min-w-0 flex-1 flex-col justify-center gap-1">
                      <span className="w-full truncate text-sm text-dark-gray">
                        <span className="font-semibold">QUIZ</span> {selectedItem.quiz.title} ·{' '}
                        {selectedItem.quiz.questions.length} question
                        {selectedItem.quiz.questions.length === 1 ? '' : 's'}
                        {selectedItem.quiz.timeLimitMinutes !== null &&
                          ` · ${selectedItem.quiz.timeLimitMinutes} min`}
                        {!selectedItem.quiz.published && ' · draft'}
                      </span>
                      <EditedTag mark={marks.quizzes[selectedItem.id]} />
                    </span>

                    {/* Deleting the quiz lives on its row rather than inside the
                        editor: it belongs with the other things done *to* a
                        quiz, not among the fields that describe one. */}
                    {selectedItem.quiz.type !== 'DIRECTED' && (
                      <Button
                        onClick={() =>
                          onDelete({
                            kind: 'quiz',
                            id: selectedItem.quiz.id,
                            label: selectedItem.quiz.title,
                          })
                        }
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0 hover:text-danger-hover"
                        title="Delete quiz"
                      >
                        <TrashIcon className="w-4 h-4" />
                      </Button>
                    )}
                  </div>

                  <div className="border-t border-navy/30 bg-light-gray p-4">
                    <QuizEditor
                      quiz={selectedItem.quiz}
                      onChanged={onRefresh}
                      onNotify={onNotify}
                    />
                  </div>
                </div>
              )}
            </CardContent>
          </>
        )}
      </Card>
    </div>
  );
};

export default StructureEditor;
