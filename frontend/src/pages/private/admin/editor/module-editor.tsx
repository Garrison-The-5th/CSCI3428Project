/**
 * File: module-editor.tsx
 * Description: Module Editor.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
/**
 * Module Editor.
 *
 * Left  : the add-section and add-module forms, a rule, then the course as a
 *         collapsible outline — section headings with their modules underneath.
 *         Numbers are never typed: a module is 2.3 because it is the third module
 *         of the second section, so dragging is what renumbers the course.
 * Right : the selected module's title and time, a rule, the add-content row
 *         pinned above the list, then the content itself.
 */
import {
  ArrowUpTrayIcon,
  Bars3Icon,
  ChevronDownIcon,
  FolderPlusIcon,
  PencilSquareIcon,
  PlusIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { useEffect, useRef, useState } from 'react';

import ElementEditor from '@/components/common/element-editor';
import { NewBadge, newMarkers } from '@/components/common/new-badge';
import QuizEditor from '@/components/common/quiz-editor';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { saveLabel, useAutoSave } from '@/hooks/use-auto-save';
import SectionColorPicker from '@/pages/private/admin/editor/section-color-picker';
import {
  Course,
  CourseModule,
  curriculumApi,
  ElementType,
  moduleContent,
  NewIds,
  SectionGroup,
  sectionGroups,
  sectionTint,
  UPLOAD_ACCEPT,
} from '@/services/curriculum-api';
import { quizApi } from '@/services/quiz-api';
import { logger } from '@/utils/logger';

interface Props {
  course: Course;
  selectedModuleId: string | null;
  onSelectModule: (id: string | null) => void;
  onRefresh: () => Promise<void>;
  onNotify: (message: string, type?: 'success' | 'error') => void;
  onDelete: (target: {
    kind: 'module' | 'section' | 'quiz' | 'element';
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
 * more thing to drop into a module, so it sits in the same list. PDF is absent
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

/** What is being dragged, so a module is never dropped onto a section list. */
type Drag = { kind: 'module'; id: string } | { kind: 'section'; id: string } | null;

const ModuleEditor = ({
  course,
  selectedModuleId,
  onSelectModule,
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
  /** The section whose title is being edited inline, and the text so far. */
  const [editingSection, setEditingSection] = useState<{ id: string; title: string } | null>(null);

  const groups = sectionGroups(course);
  const isNew = newMarkers(unpublished);

  /** Saves an inline section rename, or quietly drops an empty one. */
  const saveSectionTitle = async () => {
    const editing = editingSection;
    setEditingSection(null);
    if (!editing) return;

    const title = editing.title.trim();
    const current = groups.find((group) => group.section.id === editing.id)?.section.title;
    if (!title || title === current) return;

    await run(
      () => curriculumApi.updateSection(editing.id, { title }),
      'Section renamed',
      'Failed to rename the section',
    );
  };

  const [newSection, setNewSection] = useState({ title: '', number: '' });
  const [newModule, setNewModule] = useState({ title: '', estimatedMinutes: '', sectionId: '' });
  const [newElement, setNewElement] = useState<{ type: NewContentType; value: string }>({
    type: 'TEXT',
    value: '',
  });
  const [drag, setDrag] = useState<Drag>(null);
  const [contentDragId, setContentDragId] = useState<string | null>(null);
  const [openQuizId, setOpenQuizId] = useState<string | null>(null);
  /** Collapsed rather than expanded, so reopening the editor looks unchanged. */
  const [collapsedSectionIds, setCollapsedSectionIds] = useState<Set<string>>(new Set());

  const selectedModule = course.modules.find((m) => m.id === selectedModuleId) ?? null;

  const [moduleDraft, setModuleDraft] = useState({ title: '', estimatedMinutes: '' });

  useEffect(() => {
    if (!selectedModule) return;
    setModuleDraft({
      title: selectedModule.title,
      estimatedMinutes: String(selectedModule.estimatedMinutes),
    });
  }, [selectedModule?.id]);

  const { state: moduleState } = useAutoSave(
    moduleDraft,
    async (value) => {
      if (!selectedModule) return;
      if (!value.title.trim()) return;
      await curriculumApi.updateModule(selectedModule.id, {
        title: value.title.trim(),
        estimatedMinutes: Number(value.estimatedMinutes) || 0,
      });
      await onRefresh();
    },
    { enabled: Boolean(selectedModule) },
  );

  const toggleSection = (sectionId: string) =>
    setCollapsedSectionIds((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });

  /** The number you type is the place it takes; everything after shuffles down. */
  const addSection = async () => {
    if (!newSection.title.trim()) return onNotify('Give the section a title', 'error');

    const typed = newSection.number.trim();
    if (typed && !/^\d+$/.test(typed)) {
      return onNotify('A section number is a whole number, like 2', 'error');
    }

    const place = typed ? Number(typed) : groups.length + 1;
    const ok = await run(
      () =>
        curriculumApi.createSection(course.id, {
          title: newSection.title.trim(),
          number: place,
        }),
      `Section added`,
      'Failed to add section',
    );
    if (ok) setNewSection({ title: '', number: '' });
  };

  /** Lands at the end of the chosen section and takes the next number there. */
  const addModule = async () => {
    if (!newModule.title.trim()) return onNotify('Give the module a title', 'error');
    if (groups.length === 0) {
      return onNotify('Add a section first — modules live inside one', 'error');
    }

    const sectionId = newModule.sectionId || groups[groups.length - 1].section.id;
    const ok = await run(
      () =>
        curriculumApi.createModule(course.id, {
          sectionId,
          title: newModule.title.trim(),
          estimatedMinutes: Number(newModule.estimatedMinutes) || 0,
        }),
      'Module added',
      'Failed to add module',
    );
    if (ok) setNewModule({ title: '', estimatedMinutes: '', sectionId });
  };

  const addQuiz = async (title: string) => {
    if (!selectedModule || !title.trim()) return;
    try {
      const response = await quizApi.createQuiz({
        title: title.trim(),
        moduleId: selectedModule.id,
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
    if (!selectedModule || !value || addingRef.current) return;

    addingRef.current = true;
    try {
      // The two paths split here: everything else is an element on the module, a
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
        () => curriculumApi.createElement(selectedModule.id, payload),
        '',
        'Failed to add content',
      );
      // Left in place on failure, so a network blip does not eat what was typed.
      if (ok) setNewElement({ type: newElement.type, value: '' });
    } finally {
      addingRef.current = false;
    }
  };

  /** Dragging content renumbers the module's whole sequence, quizzes included. */
  const handleContentDrop = async (targetId: string) => {
    if (!selectedModule || !contentDragId || contentDragId === targetId) {
      return setContentDragId(null);
    }
    const ordered = moduleContent(selectedModule);
    const from = ordered.findIndex((i) => i.id === contentDragId);
    const to = ordered.findIndex((i) => i.id === targetId);
    setContentDragId(null);
    if (from < 0 || to < 0) return;

    const next = [...ordered];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);

    await run(
      () =>
        curriculumApi.reorderModuleContent(
          selectedModule.id,
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
  const applyStructure = async (next: SectionGroup[]) => {
    const previous = course;

    setCourse((prev) =>
      prev
        ? {
            ...prev,
            sections: next.map((group, index) => ({ ...group.section, number: index + 1 })),
            modules: next.flatMap((group, sectionIndex) =>
              group.modules.map((module, moduleIndex) => ({
                ...module,
                sectionId: group.section.id,
                position: moduleIndex + 1,
                number: `${sectionIndex + 1}.${moduleIndex + 1}`,
              })),
            ),
          }
        : prev,
    );

    try {
      await curriculumApi.reorderStructure(
        course.id,
        next.map((group) => ({
          id: group.section.id,
          moduleIds: group.modules.map((module) => module.id),
        })),
      );
      await onRefresh();
    } catch (err) {
      logger.error('Failed to reorder the course:', err);
      onNotify('Failed to reorder the course', 'error');
      setCourse(() => previous);
    }
  };

  /** Drops a module before `targetModuleId`, or on the end of a section. */
  const handleModuleDrop = async (sectionId: string, targetModuleId: string | null) => {
    const dragged = drag;
    setDrag(null);
    if (dragged?.kind !== 'module' || dragged.id === targetModuleId) return;

    const next = groups.map((group) => ({
      ...group,
      modules: group.modules.filter((module) => module.id !== dragged.id),
    }));

    const moved = course.modules.find((module) => module.id === dragged.id);
    const target = next.find((group) => group.section.id === sectionId);
    if (!moved || !target) return;

    const at = targetModuleId
      ? target.modules.findIndex((module) => module.id === targetModuleId)
      : target.modules.length;
    target.modules.splice(at < 0 ? target.modules.length : at, 0, moved);

    await applyStructure(next);
  };

  /** Dragging a section heading moves it and everything inside it. */
  const handleSectionDrop = async (targetSectionId: string) => {
    const dragged = drag;
    setDrag(null);
    if (dragged?.kind !== 'section' || dragged.id === targetSectionId) return;

    const next = [...groups];
    const from = next.findIndex((group) => group.section.id === dragged.id);
    const to = next.findIndex((group) => group.section.id === targetSectionId);
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
            Sections hold modules: section 2&rsquo;s third module is 2.3. Drag to reorder — numbers
            follow. The circle sets a colour for the whole section.
          </p>
        </CardHeader>

        <CardContent className="flex flex-col gap-3">
          {/* New section */}
          <div className="flex flex-col gap-2 rounded-lg border border-navy/30 bg-white/60 p-3">
            <p className="text-sm font-semibold text-dark-gray">New section</p>
            <div className="flex gap-2">
              <Input
                value={newSection.number}
                onChange={(e) => setNewSection({ ...newSection, number: e.target.value })}
                placeholder={String(groups.length + 1)}
                title="Where in the course it goes"
                className={`${inputClass} max-w-20`}
              />
              <Input
                value={newSection.title}
                onChange={(e) => setNewSection({ ...newSection, title: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && addSection()}
                placeholder="Section title"
                className={inputClass}
              />
            </div>
            <Button onClick={addSection} className={primaryBtn}>
              <FolderPlusIcon className="w-5 h-5 stroke-2" /> Add section
            </Button>
          </div>

          {/* New module */}
          <div className="flex flex-col gap-2 rounded-lg border border-navy/30 bg-white/60 p-3">
            <p className="text-sm font-semibold text-dark-gray">New module</p>
            <div className="flex gap-2">
              <select
                value={newModule.sectionId || groups[groups.length - 1]?.section.id || ''}
                onChange={(e) => setNewModule({ ...newModule, sectionId: e.target.value })}
                disabled={groups.length === 0}
                className="h-9 min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-2
                  text-sm text-dark-gray"
              >
                {groups.map((group) => (
                  <option key={group.section.id} value={group.section.id}>
                    {group.section.number}. {group.section.title}
                  </option>
                ))}
              </select>
              <Input
                value={newModule.estimatedMinutes}
                onChange={(e) => setNewModule({ ...newModule, estimatedMinutes: e.target.value })}
                placeholder="Mins"
                className={`${inputClass} max-w-20`}
              />
            </div>
            <Input
              value={newModule.title}
              onChange={(e) => setNewModule({ ...newModule, title: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && addModule()}
              placeholder="New module title"
              className={inputClass}
            />
            <Button onClick={addModule} className={primaryBtn} disabled={groups.length === 0}>
              <PlusIcon className="w-5 h-5 stroke-2" /> Add module
            </Button>
          </div>

          <hr className="h-px border-t-0 bg-gray-300" />

          {groups.length === 0 ? (
            <p className="text-sm text-dark-gray">No sections yet. Add one to get started.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {groups.map((group) => {
                const collapsed = collapsedSectionIds.has(group.section.id);
                const minutes = group.modules.reduce((sum, m) => sum + m.estimatedMinutes, 0);

                return (
                  <div key={group.section.id} className="flex flex-col gap-1">
                    {/* Section heading — drag it to move the whole section */}
                    <div
                      draggable
                      onDragStart={() => setDrag({ kind: 'section', id: group.section.id })}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => handleSectionDrop(group.section.id)}
                      onDragEnd={() => setDrag(null)}
                      className={`flex cursor-grab items-center gap-1 rounded-md border px-2 py-2
                        ${group.section.color ? '' : 'border-navy/40 bg-navy/5'}
                        ${drag?.kind === 'section' && drag.id === group.section.id ? 'opacity-50' : ''}`}
                      // The tint the learner will see, previewed where it is set.
                      style={sectionTint(group.section.color)}
                    >
                      <Bars3Icon className="w-4 h-4 shrink-0 text-dark-gray" />

                      {editingSection?.id === group.section.id ? (
                        // Renaming takes over the row: the drag handle and the
                        // collapse toggle would both fight a text field.
                        <Input
                          autoFocus
                          value={editingSection.title}
                          onChange={(e) =>
                            setEditingSection({ id: group.section.id, title: e.target.value })
                          }
                          onBlur={saveSectionTitle}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveSectionTitle();
                            if (e.key === 'Escape') setEditingSection(null);
                          }}
                          onClick={(e) => e.stopPropagation()}
                          aria-label="Section title"
                          className={`${inputClass} h-8 min-w-0 flex-1`}
                        />
                      ) : (
                        <button
                          onClick={() => toggleSection(group.section.id)}
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
                                {group.section.number}. {group.section.title}
                              </span>
                              {isNew.section(group.section.id) && <NewBadge />}
                            </span>
                            <span className="block text-xs">
                              {group.modules.length} module
                              {group.modules.length === 1 ? '' : 's'}
                              {minutes > 0 && ` · ${minutes} min`}
                            </span>
                          </span>
                        </button>
                      )}

                      {group.section.id !== 'unsectioned' && (
                        <>
                          <SectionColorPicker
                            color={group.section.color}
                            label={group.section.title}
                            onSelect={(color) =>
                              run(
                                () => curriculumApi.updateSection(group.section.id, { color }),
                                color ? 'Section colour set' : 'Section colour cleared',
                                'Failed to change the section colour',
                              )
                            }
                          />
                          <Button
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingSection({
                                id: group.section.id,
                                title: group.section.title,
                              });
                            }}
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 shrink-0 hover:text-green-hover"
                            title="Rename section"
                          >
                            <PencilSquareIcon className="w-4 h-4" />
                          </Button>
                          <Button
                            onClick={() =>
                              onDelete({
                                kind: 'section',
                                id: group.section.id,
                                label: `${group.section.number}. ${group.section.title}`,
                              })
                            }
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 shrink-0 hover:text-danger-hover"
                            title="Delete section"
                          >
                            <TrashIcon className="w-4 h-4" />
                          </Button>
                        </>
                      )}
                    </div>

                    {!collapsed && (
                      <div
                        className="flex flex-col gap-1 pl-4"
                        // Dropping in the gap under the last module appends here,
                        // which is the only way into an empty section.
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => handleModuleDrop(group.section.id, null)}
                      >
                        {group.modules.length === 0 ? (
                          <p className="px-2 py-2 text-xs text-dark-gray">
                            Empty — drag a module here.
                          </p>
                        ) : (
                          group.modules.map((module: CourseModule) => (
                            <div
                              key={module.id}
                              draggable
                              onDragStart={() => setDrag({ kind: 'module', id: module.id })}
                              onDragOver={(e) => e.preventDefault()}
                              onDrop={(e) => {
                                e.stopPropagation();
                                handleModuleDrop(group.section.id, module.id);
                              }}
                              onDragEnd={() => setDrag(null)}
                              className={`flex cursor-grab items-center gap-2 rounded-md border px-3
                                py-2
                                ${module.id === selectedModuleId ? 'border-navy bg-white' : 'border-gray-300 bg-white/60'}
                                ${drag?.kind === 'module' && drag.id === module.id ? 'opacity-50' : ''}`}
                              // The colour is the section's, so its modules read
                              // as belonging together down the whole outline.
                              style={
                                group.section.color
                                  ? {
                                      borderLeftWidth: '4px',
                                      borderLeftColor: group.section.color,
                                    }
                                  : undefined
                              }
                            >
                              <Bars3Icon className="w-4 h-4 shrink-0 text-dark-gray" />
                              <button
                                onClick={() => onSelectModule(module.id)}
                                className="min-w-0 flex-1 text-left text-sm text-dark-gray"
                              >
                                <span className="flex flex-wrap items-center gap-2">
                                  <span>
                                    <span className="font-semibold">{module.number}</span>{' '}
                                    {module.title}
                                  </span>
                                  {isNew.module(module.id, module.sectionId) && <NewBadge />}
                                </span>
                                <span className="block text-xs">
                                  {module.elements.length} items
                                  {module.quizzes.length > 0 && ` · ${module.quizzes.length} quiz`}
                                  {module.estimatedMinutes > 0 &&
                                    ` · ${module.estimatedMinutes} min`}
                                </span>
                              </button>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---- Selected module ---- */}
      <Card className="bg-light-gray shadow-sm">
        {!selectedModule ? (
          <CardContent className="py-16 text-center">
            <p>Add a module on the left, or pick one to edit.</p>
          </CardContent>
        ) : (
          <>
            <CardHeader className="flex-row flex-wrap items-end justify-between gap-3 p-4">
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex flex-col gap-1 text-sm font-medium text-dark-gray">
                  Number
                  {/* Read-only: the number is where the module sits, so it moves
                      by dragging rather than by typing. */}
                  <span
                    className="flex h-9 items-center rounded-md border border-gray-300 bg-gray-100
                      px-3 font-semibold"
                    title="Set by the module's place in its section — drag to change it"
                  >
                    {selectedModule.number}
                  </span>
                </div>
                <label
                  className="flex min-w-60 flex-1 flex-col gap-1 text-sm font-medium text-dark-gray"
                >
                  Title
                  <Input
                    value={moduleDraft.title}
                    onChange={(e) => setModuleDraft({ ...moduleDraft, title: e.target.value })}
                    className={inputClass}
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm font-medium text-dark-gray">
                  Time (mins)
                  <Input
                    value={moduleDraft.estimatedMinutes}
                    onChange={(e) =>
                      setModuleDraft({ ...moduleDraft, estimatedMinutes: e.target.value })
                    }
                    className={`${inputClass} max-w-28`}
                  />
                </label>
              </div>

              <div className="flex shrink-0 items-center gap-3">
                <span className="text-xs text-dark-gray">{saveLabel(moduleState)}</span>
                <Button
                  onClick={() =>
                    onDelete({
                      kind: 'module',
                      id: selectedModule.id,
                      label: `${selectedModule.number} ${selectedModule.title}`,
                    })
                  }
                  variant="ghost"
                  size="icon"
                  className="hover:text-danger-hover"
                  title="Delete module"
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
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        run(
                          () => curriculumApi.uploadModuleImage(selectedModule.id, file),
                          'File added',
                          'Failed to upload',
                        );
                      }
                      e.target.value = '';
                    }}
                  />
                  <Button
                    onClick={() => uploadRef.current?.click()}
                    variant="outline"
                    className="bg-white text-dark-gray hover:bg-light-gray"
                  >
                    <ArrowUpTrayIcon className="w-5 h-5" /> Upload
                  </Button>

                  <Button onClick={addElement} className={primaryBtn}>
                    <PlusIcon className="w-5 h-5 stroke-2" /> Add
                  </Button>
                </div>
              </div>

              {/* Existing content, draggable */}
              {moduleContent(selectedModule).length === 0 ? (
                <p className="text-sm text-dark-gray">Nothing in this module yet.</p>
              ) : (
                moduleContent(selectedModule).map((item) =>
                  item.kind === 'element' ? (
                    <ElementEditor
                      key={item.id}
                      element={item.element}
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
                          className="flex min-w-0 flex-1 items-center gap-2 text-left"
                          aria-expanded={openQuizId === item.quiz.id}
                        >
                          <ChevronDownIcon
                            className={`w-4 h-4 shrink-0 text-dark-gray transition-transform
                              duration-200 ${openQuizId === item.quiz.id ? 'rotate-180' : ''}`}
                          />
                          <span className="min-w-0 flex-1 truncate text-sm text-dark-gray">
                            <span className="font-semibold">QUIZ</span> {item.quiz.title} ·{' '}
                            {item.quiz.questions.length} question
                            {item.quiz.questions.length === 1 ? '' : 's'}
                            {item.quiz.timeLimitMinutes !== null &&
                              ` · ${item.quiz.timeLimitMinutes} min`}
                            {!item.quiz.published && ' · draft'}
                          </span>
                        </button>
                      </div>

                      {openQuizId === item.quiz.id && (
                        <div className="border-t border-navy/30 bg-light-gray p-4">
                          <QuizEditor
                            quiz={item.quiz}
                            onChanged={onRefresh}
                            onNotify={onNotify}
                            onDeleteQuiz={() =>
                              onDelete({
                                kind: 'quiz',
                                id: item.quiz.id,
                                label: item.quiz.title,
                              })
                            }
                          />
                        </div>
                      )}
                    </div>
                  ),
                )
              )}
            </CardContent>
          </>
        )}
      </Card>
    </div>
  );
};

export default ModuleEditor;
