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
 * Right : the selected section's title and time, a rule, the add-content row
 *         pinned above the list, then the content itself.
 */
import {
  ArrowUpTrayIcon,
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
import ElementEditor from '@/components/common/element-editor';
import { NewBadge, newMarkers } from '@/components/common/new-badge';
import QuizEditor from '@/components/common/quiz-editor';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import LockOverlay from '@/components/ui/lock-overlay';
import Spinner from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
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
  UPLOAD_ACCEPT,
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
 * deliberately — those arrive through Upload, not by typing a value.
 */
type NewContentType = Exclude<ElementType, 'PDF'> | 'QUIZ';
const CONTENT_TYPES: NewContentType[] = ['TEXT', 'YOUTUBE', 'IMAGE', 'QUIZ'];

const CONTENT_PLACEHOLDER: Record<NewContentType, string> = {
  TEXT: 'Start typing to add a text block...',
  YOUTUBE: 'Paste a YouTube link',
  IMAGE: 'Image URL',
  QUIZ: 'New quiz title',
};

/** What is being dragged, so a section is never dropped onto a module list. */
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
  const uploadRef = useRef<HTMLInputElement>(null);
  /** In-flight latch for addElement — see the comment there. */
  const addingRef = useRef(false);
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
  const [newElement, setNewElement] = useState<{ type: NewContentType; value: string }>({
    type: 'TEXT',
    value: '',
  });
  const [drag, setDrag] = useState<Drag>(null);
  const [contentDragId, setContentDragId] = useState<string | null>(null);
  /**
   * The section an upload is in flight for, or null.
   *
   * Kept as the section id rather than a flag so a slow upload cannot leave a
   * spinner sitting under a different section the author has clicked onto while
   * they waited. A photo off a phone takes seconds on the deployed app — several
   * megabytes up, then a HEIC re-encode on the server — and until it lands there
   * is nothing on screen to say the Upload button did anything at all.
   */
  const [uploadingSectionId, setUploadingSectionId] = useState<string | null>(null);
  const [openQuizId, setOpenQuizId] = useState<string | null>(null);
  /** Collapsed rather than expanded, so reopening the editor looks unchanged. */
  const [collapsedModuleIds, setCollapsedModuleIds] = useState<Set<string>>(new Set());

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
    { enabled: Boolean(selectedSection) },
  );

  const toggleModule = (moduleId: string) =>
    setCollapsedModuleIds((prev) => {
      const next = new Set(prev);
      if (next.has(moduleId)) next.delete(moduleId);
      else next.add(moduleId);
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

  /** Lands at the end of the chosen module and takes the next number there. */
  const addSection = async () => {
    if (!newSection.title.trim()) return onNotify('Give the section a title', 'error');
    if (groups.length === 0) {
      return onNotify('Add a module first — sections live inside one', 'error');
    }

    const moduleId = newSection.moduleId || groups[groups.length - 1].module.id;
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

  const addQuiz = async (title: string) => {
    if (!selectedSection || !title.trim()) return;
    try {
      const response = await quizApi.createQuiz({
        title: title.trim(),
        sectionId: selectedSection.id,
      });
      setNewElement({ type: 'QUIZ', value: '' });
      await onRefresh();
      // Drop straight into the new quiz so questions can be written immediately.
      if (response?.quiz?.id) setOpenQuizId(response.quiz.id);
      onNotify('Quiz added');
    } catch (err) {
      logger.error('Failed to add quiz:', err);
      onNotify('Failed to add quiz', 'error');
    }
  };

  /**
   * Adds whatever is in the box: on Enter, on the Add button, or on clicking away
   * with something typed.
   *
   * The guard is what makes all three safe together. Blur fires *before* the Add
   * button's click, so a single press would otherwise run this twice — once
   * leaving the field, once on the button — and create two copies. The flag holds
   * for the whole round trip; by the time it clears the box is empty, so the
   * second call falls out on the value check instead.
   */
  const addElement = async () => {
    const value = newElement.value.trim();
    if (!selectedSection || !value || addingRef.current) return;

    addingRef.current = true;
    try {
      // The two paths split here: everything else is an element on the section, a
      // quiz is its own record. The author picked both from the same list.
      if (newElement.type === 'QUIZ') {
        await addQuiz(value);
        return;
      }

      const payload =
        newElement.type === 'TEXT'
          ? { type: newElement.type, textContent: value }
          : newElement.type === 'YOUTUBE'
            ? { type: newElement.type, videoUrl: value }
            : { type: newElement.type, imageUrl: value };

      const ok = await run(
        () => curriculumApi.createElement(selectedSection.id, payload),
        '',
        'Failed to add content',
      );
      // Left in place on failure, so a network blip does not eat what was typed.
      if (ok) setNewElement({ type: newElement.type, value: '' });
    } finally {
      addingRef.current = false;
    }
  };

  /** Dragging content renumbers the section's whole sequence, quizzes included. */
  const handleContentDrop = async (targetId: string) => {
    if (!selectedSection || !contentDragId || contentDragId === targetId) {
      return setContentDragId(null);
    }
    const ordered = sectionContent(selectedSection);
    const from = ordered.findIndex((i) => i.id === contentDragId);
    const to = ordered.findIndex((i) => i.id === targetId);
    setContentDragId(null);
    if (from < 0 || to < 0) return;

    const next = [...ordered];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);

    await run(
      () =>
        curriculumApi.reorderSectionContent(
          selectedSection.id,
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

  /** Dragging a module heading moves it and everything inside it. */
  const handleModuleDrop = async (targetModuleId: string) => {
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
          <p className="text-sm text-dark-gray">
            Modules hold sections: module 2&rsquo;s third section is 2.3. Drag to reorder — numbers
            follow. The circle sets a colour for the whole module.
          </p>
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
                value={newSection.moduleId || groups[groups.length - 1]?.module.id || ''}
                onChange={(e) => setNewSection({ ...newSection, moduleId: e.target.value })}
                disabled={groups.length === 0}
                className="h-9 min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-2
                  text-sm text-dark-gray"
              >
                {groups.map((group) => (
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
            <Button onClick={addSection} className={primaryBtn} disabled={groups.length === 0}>
              <PlusIcon className="w-5 h-5 stroke-2" /> Add section
            </Button>
          </div>

          <hr className="h-px border-t-0 bg-gray-300" />

          {groups.length === 0 ? (
            <p className="text-sm text-dark-gray">No modules yet. Add one to get started.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {groups.map((group) => {
                const collapsed = collapsedModuleIds.has(group.module.id);
                const minutes = group.sections.reduce((sum, m) => sum + m.estimatedMinutes, 0);

                const lockedBy = lockedModules[group.module.id];
                /*
                  A layer quiz's module is written by the course map, not by
                  hand: its title, its section and the quiz inside it are all
                  regenerated whenever a node moves. Editing it would be undone
                  on the next change, so it goes under the same sheet that
                  somebody else's edit lease uses — visible, and not editable.
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
                    locked={Boolean(lockedBy) || generated}
                    reason={
                      lockedBy
                        ? `${lockedBy} is editing this module`
                        : generated
                          ? 'Built from the course map — edit it on the Course mapping tab'
                          : undefined
                    }
                  >
                    <div className="flex flex-col gap-1">
                      {/* Module heading — drag it to move the whole module */}
                      <div
                        draggable
                        onDragStart={() => setDrag({ kind: 'module', id: group.module.id })}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => handleModuleDrop(group.module.id)}
                        onDragEnd={() => setDrag(null)}
                        className={`flex cursor-grab items-center gap-1 rounded-md border px-2 py-2
                          ${group.module.color ? '' : 'border-navy/40 bg-navy/5'}
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

                      {!collapsed && (
                        <div
                          className="flex flex-col gap-1 pl-4"
                          // Dropping in the gap under the last section appends here,
                          // which is the only way into an empty module.
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={() => handleSectionDrop(group.module.id, null)}
                        >
                          {group.sections.length === 0 ? (
                            <p className="px-2 py-2 text-xs text-dark-gray">
                              Empty — drag a section here.
                            </p>
                          ) : (
                            group.sections.map((section: CourseSection) => (
                              <div
                                key={section.id}
                                draggable
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
            <p>Add a section on the left, or pick one to edit.</p>
          </CardContent>
        ) : (
          <>
            <CardHeader className="flex-row flex-wrap items-end justify-between gap-3 p-4">
              <div className="flex flex-wrap items-end gap-3">
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
                    className={inputClass}
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm font-medium text-dark-gray">
                  Time (mins)
                  <Input
                    value={sectionDraft.estimatedMinutes}
                    onChange={(e) =>
                      setSectionDraft({ ...sectionDraft, estimatedMinutes: e.target.value })
                    }
                    className={`${inputClass} max-w-28`}
                  />
                </label>
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
              </div>
            </CardHeader>

            <CardContent className="flex flex-col gap-4">
              <hr className="h-px border-t-0 bg-gray-300" />

              {/* Add content stays at the top */}
              <div
                className="flex flex-col gap-3 rounded-lg border-2 border-dashed border-navy/30 p-3"
              >
                <p className="text-sm font-semibold text-dark-gray">Add content</p>

                <div className="flex flex-wrap items-start gap-3">
                  <select
                    value={newElement.type}
                    onChange={(e) =>
                      setNewElement({ type: e.target.value as NewContentType, value: '' })
                    }
                    className="h-9 rounded-md border border-gray-300 bg-white px-2 text-sm
                      text-dark-gray"
                  >
                    {CONTENT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>

                  {newElement.type === 'TEXT' ? (
                    <Textarea
                      value={newElement.value}
                      onChange={(e) => setNewElement({ ...newElement, value: e.target.value })}
                      onBlur={addElement}
                      placeholder={CONTENT_PLACEHOLDER.TEXT}
                      rows={2}
                      className={`${inputClass} min-w-60 flex-1 resize-none`}
                    />
                  ) : (
                    <Input
                      value={newElement.value}
                      onChange={(e) => setNewElement({ ...newElement, value: e.target.value })}
                      onBlur={addElement}
                      onKeyDown={(e) => e.key === 'Enter' && addElement()}
                      placeholder={CONTENT_PLACEHOLDER[newElement.type]}
                      className={`${inputClass} min-w-60 flex-1`}
                    />
                  )}

                  <input
                    ref={uploadRef}
                    type="file"
                    accept={UPLOAD_ACCEPT}
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      // Cleared before the await, so picking the same file again
                      // after a failure still fires a change event.
                      e.target.value = '';
                      if (!file) return;

                      const sectionId = selectedSection.id;
                      setUploadingSectionId(sectionId);
                      try {
                        // `run` refreshes the course before it resolves, so the
                        // placeholder is replaced by the real thing rather than
                        // clearing a moment before it appears.
                        await run(
                          () => curriculumApi.uploadSectionImage(sectionId, file),
                          'File added',
                          'Failed to upload',
                        );
                      } finally {
                        setUploadingSectionId((current) =>
                          current === sectionId ? null : current,
                        );
                      }
                    }}
                  />
                  <Button
                    onClick={() => uploadRef.current?.click()}
                    disabled={uploadingSectionId === selectedSection.id}
                    variant="outline"
                    className="bg-white text-dark-gray hover:bg-light-gray"
                  >
                    {uploadingSectionId === selectedSection.id ? (
                      <>
                        <Spinner className="w-5 h-5" /> Uploading…
                      </>
                    ) : (
                      <>
                        <ArrowUpTrayIcon className="w-5 h-5" /> Upload
                      </>
                    )}
                  </Button>

                  <Button onClick={addElement} className={primaryBtn}>
                    <PlusIcon className="w-5 h-5 stroke-2" /> Add
                  </Button>
                </div>
              </div>

              {/* Existing content, draggable */}
              {sectionContent(selectedSection).length === 0 ? (
                // Silent while an upload is in flight: the placeholder below is
                // what is in the section, and the two would contradict.
                <>
                  {uploadingSectionId !== selectedSection.id && (
                    <p className="text-sm text-dark-gray">Nothing in this section yet.</p>
                  )}
                </>
              ) : (
                sectionContent(selectedSection).map((item) =>
                  item.kind === 'element' ? (
                    <ElementEditor
                      key={item.id}
                      element={item.element}
                      editedMark={marks.elements[item.id]}
                      dragging={contentDragId === item.id}
                      dragHandleProps={{
                        draggable: true,
                        onDragStart: () => setContentDragId(item.id),
                        onDragOver: (e) => e.preventDefault(),
                        onDrop: () => handleContentDrop(item.id),
                        onDragEnd: () => setContentDragId(null),
                      }}
                      onDelete={() =>
                        onDelete({ kind: 'element', id: item.id, label: item.element.type })
                      }
                      onSaved={onRefresh}
                    />
                  ) : (
                    <div
                      key={item.id}
                      className={`rounded-lg border border-navy/40 bg-navy/5
                        ${contentDragId === item.id ? 'opacity-50' : ''}`}
                    >
                      <div className="flex items-center gap-2 px-3 py-2">
                        {/* Only the handle drags, so the editor inside stays usable */}
                        <div
                          draggable
                          onDragStart={() => setContentDragId(item.id)}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={() => handleContentDrop(item.id)}
                          onDragEnd={() => setContentDragId(null)}
                          className="cursor-grab p-1"
                          title="Drag to reorder"
                        >
                          <Bars3Icon className="w-4 h-4 shrink-0 text-dark-gray" />
                        </div>

                        <button
                          onClick={() =>
                            setOpenQuizId(openQuizId === item.quiz.id ? null : item.quiz.id)
                          }
                          className="flex min-h-10 min-w-0 flex-1 items-center gap-2 text-left"
                          aria-expanded={openQuizId === item.quiz.id}
                        >
                          <ChevronDownIcon
                            className={`w-4 h-4 shrink-0 text-dark-gray transition-transform
                              duration-200 ${openQuizId === item.quiz.id ? 'rotate-180' : ''}`}
                          />
                          {/* Tag underneath, so a long name cannot push the
                              bin on the right out of the row. */}
                          <span className="flex min-w-0 flex-1 flex-col items-start gap-1">
                            <span className="w-full truncate text-sm text-dark-gray">
                              <span className="font-semibold">QUIZ</span> {item.quiz.title} ·{' '}
                              {item.quiz.questions.length} question
                              {item.quiz.questions.length === 1 ? '' : 's'}
                              {item.quiz.timeLimitMinutes !== null &&
                                ` · ${item.quiz.timeLimitMinutes} min`}
                              {!item.quiz.published && ' · draft'}
                            </span>
                            <EditedTag mark={marks.quizzes[item.id]} />
                          </span>
                        </button>

                        {/* Deleting the quiz lives on its row rather than
                            inside the editor: it belongs with the other things
                            done *to* a quiz, not among the fields that describe
                            one. */}
                        <Button
                          onClick={() =>
                            onDelete({ kind: 'quiz', id: item.quiz.id, label: item.quiz.title })
                          }
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 shrink-0 hover:text-danger-hover"
                          title="Delete quiz"
                        >
                          <TrashIcon className="w-4 h-4" />
                        </Button>
                      </div>

                      {openQuizId === item.quiz.id && (
                        <div className="border-t border-navy/30 bg-light-gray p-4">
                          <QuizEditor quiz={item.quiz} onChanged={onRefresh} onNotify={onNotify} />
                        </div>
                      )}
                    </div>
                  ),
                )
              )}

              {/*
                Stands where the upload is about to appear — new content is added
                to the end of the section, so this is the spot the image will
                take. A placeholder in the list rather than a spinner on the
                button alone, because that is where the author is looking for it.
              */}
              {uploadingSectionId === selectedSection.id && (
                <div
                  className="flex h-24 items-center justify-center gap-3 rounded-lg border
                    border-dashed border-gray-300 bg-light-gray"
                  role="status"
                  aria-live="polite"
                >
                  <Spinner className="h-6 w-6" />
                  <span className="text-sm text-dark-gray">Uploading…</span>
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
