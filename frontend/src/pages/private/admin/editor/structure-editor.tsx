/**
 * File: structure-editor.tsx
 * Description: The course structure editor — models, and the sections inside them.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
/**
 * The course structure editor.
 *
 * A course is two layers: models, and the sections inside them. A section is
 * one piece of content — a text, a video, a picture, a PDF, a canvas or a quiz
 * — and its type is chosen when it is added, so there is no such thing as a
 * blank section and nothing nested underneath one.
 *
 * Left  : the add-model and add-section forms, a rule, then the course as a
 *         collapsible outline — model headings with their sections underneath,
 *         one row per section with a badge saying what it is. Numbers are never
 *         typed: a section is 2.3 because it is the third section of the second
 *         model, so dragging is what renumbers the course.
 * Right : the selected section's number, title and time, then its content in
 *         the editor for its type.
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
import ModelColorPicker from '@/pages/private/admin/editor/model-color-picker';
import {
  Course,
  CourseSection,
  curriculumApi,
  ModelGroup,
  modelGroups,
  modelTint,
  NewIds,
  quizOf,
  SECTION_TYPE_LABELS,
  SECTION_TYPES,
  SectionType,
} from '@/services/curriculum-api';
import { logger } from '@/utils/logger';

interface Props {
  course: Course;
  selectedSectionId: string | null;
  onSelectSection: (id: string | null) => void;
  onRefresh: () => Promise<void>;
  onNotify: (message: string, type?: 'success' | 'error') => void;
  onDelete: (target: { kind: 'section' | 'model' | 'quiz'; id: string; label: string }) => void;
  run: (action: () => Promise<unknown>, success: string, failure: string) => Promise<boolean>;
  setCourse: (updater: (prev: Course | null) => Course | null) => void;
  /** What has been edited but not published, for the New tags. */
  unpublished?: NewIds | null;
}

const inputClass = 'bg-white text-dark-gray';
const primaryBtn = 'bg-navy text-white hover:bg-navy-hover';

/**
 * What a section's row says under its title: for content, the same one-line
 * summary the editor heads it with; for a quiz, how many questions it has.
 */
function sectionSummary(section: CourseSection): string {
  const quiz = quizOf(section);
  if (section.type === 'QUIZ') {
    if (!quiz) return 'No quiz';
    return `${quiz.questions.length} question${quiz.questions.length === 1 ? '' : 's'}`;
  }
  return elementSummary(section);
}

/** What is being dragged, so a section is never dropped onto a model list. */
type Drag = { kind: 'section'; id: string } | { kind: 'model'; id: string } | null;

/**
 * Whether a model was generated for a course map's layer quiz.
 *
 * Recognised by its name, which the generator owns and an author cannot reach —
 * the model is locked below, and a hand-made model of the same name would be
 * locked with it, which is the safe way round to be wrong.
 */
function isLayerModel(title: string): boolean {
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
  /** In-flight latch for addSection, so a double click adds one section, not two. */
  const addingRef = useRef(false);
  const [adding, setAdding] = useState(false);
  /** The model whose title is being edited inline, and the text so far. */
  const [editingModel, setEditingModel] = useState<{ id: string; title: string } | null>(null);

  const groups = modelGroups(course);
  const isNew = newMarkers(unpublished);

  /** Saves an inline model rename, or quietly drops an empty one. */
  const saveModelTitle = async () => {
    const editing = editingModel;
    setEditingModel(null);
    if (!editing) return;

    const title = editing.title.trim();
    const current = groups.find((group) => group.model.id === editing.id)?.model.title;
    if (!title || title === current) return;

    await run(
      () => curriculumApi.updateModel(editing.id, { title }),
      'Model renamed',
      'Failed to rename the model',
    );
  };

  const [newModel, setNewModel] = useState({ title: '' });
  /**
   * The section about to be added. `type` comes first in the form and has no
   * empty option: a section is one piece of content, so what kind it is has to
   * be settled before it exists.
   */
  const [newSection, setNewSection] = useState<{
    type: SectionType;
    title: string;
    estimatedMinutes: string;
    modelId: string;
  }>({ type: 'TEXT', title: '', estimatedMinutes: '', modelId: '' });
  const [drag, setDrag] = useState<Drag>(null);
  /** Collapsed rather than expanded, so reopening the editor looks unchanged. */
  const [collapsedModelIds, setCollapsedModelIds] = useState<Set<string>>(new Set());

  /**
   * Models somebody else has open, and how this pane says which one is ours.
   *
   * A model is claimed whole rather than section by section because editing one
   * really means editing the sections inside it — there is no
   * smaller unit an author actually works in, and locking at a finer grain would
   * let two people rearrange the same model's contents against each other.
   */
  const { lockedModels, claim, marks } = useEditLocks();

  /**
   * Whichever model is expanded is the one being worked in, so that is the
   * claim. Collapsing them all gives it up — an author looking at a course
   * outline is not editing any of it.
   */
  const openModelId = useMemo(
    () => groups.find((group) => !collapsedModelIds.has(group.model.id))?.model.id ?? null,
    [groups, collapsedModelIds],
  );

  useEffect(() => {
    claim('MODEL', openModelId);
  }, [openModelId, claim]);

  const selectedSection = course.sections.find((m) => m.id === selectedSectionId) ?? null;
  /**
   * The section a layer quiz sits in. The map owns it — its name, its place and
   * what is in it — so only the quiz inside opens, and that keeps all but its
   * wording fixed.
   */
  const layerSection = selectedSection?.quizzes.some((quiz) => quiz.type === 'DIRECTED') ?? false;

  /** The quiz of the selected section, when it is a quiz section. */
  const selectedQuiz = selectedSection ? quizOf(selectedSection) : null;

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

  /** Collapses or expands a model. */
  const toggleModel = (modelId: string) =>
    setCollapsedModelIds((prev) => {
      const next = new Set(prev);
      if (next.has(modelId)) next.delete(modelId);
      else next.add(modelId);
      return next;
    });

  /** Lands at the end of the course; drag it from the outline to move it. */
  const addModel = async () => {
    if (!newModel.title.trim()) return onNotify('Give the model a title', 'error');

    const ok = await run(
      () =>
        curriculumApi.createModel(course.id, {
          title: newModel.title.trim(),
          number: groups.length + 1,
        }),
      `Model added`,
      'Failed to add model',
    );
    if (ok) setNewModel({ title: '' });
  };

  /**
   * The models a new section may go into: every one but the map's generated
   * quiz models, which hold their own quiz and nothing else. Those are appended
   * at the end of the course, so defaulting to "the last model" used to put new
   * sections straight into one.
   */
  const sectionHomes = groups.filter((group) => !isLayerModel(group.model.title));
  const defaultHome = sectionHomes[sectionHomes.length - 1]?.model.id ?? '';
  const chosenHome = sectionHomes.some((group) => group.model.id === newSection.modelId)
    ? newSection.modelId
    : defaultHome;

  /**
   * Adds a section of the chosen type to the end of the chosen model, and opens
   * it — so the author fills it in where it will live. The type goes with the
   * request; the server refuses a section without one.
   */
  const addSection = async () => {
    if (addingRef.current) return;
    if (!newSection.title.trim()) return onNotify('Give the section a title', 'error');
    if (sectionHomes.length === 0) {
      return onNotify('Add a model first — sections live inside one', 'error');
    }

    addingRef.current = true;
    setAdding(true);
    const modelId = chosenHome;
    try {
      const response = await curriculumApi.createSection(course.id, {
        type: newSection.type,
        modelId,
        title: newSection.title.trim(),
        estimatedMinutes: Number(newSection.estimatedMinutes) || 0,
      });
      await onRefresh();
      onNotify('Section added');
      setNewSection({ type: newSection.type, title: '', estimatedMinutes: '', modelId });
      if (response?.section?.id) onSelectSection(response.section.id);
      // The new section is highlighted in the outline, so its model has to be open.
      setCollapsedModelIds((prev) => {
        if (!prev.has(modelId)) return prev;
        const next = new Set(prev);
        next.delete(modelId);
        return next;
      });
    } catch (err) {
      logger.error('Failed to add section:', err);
      onNotify(
        err instanceof Error && err.message ? err.message : 'Failed to add section',
        'error',
      );
    } finally {
      addingRef.current = false;
      setAdding(false);
    }
  };

  /**
   * Sends the grid as it now stands and renumbers optimistically so the new
   * numbers appear under the cursor rather than a round trip later. The previous
   * course is kept so a failed save can put it back exactly as it was.
   */
  const applyStructure = async (next: ModelGroup[]) => {
    const previous = course;

    setCourse((prev) =>
      prev
        ? {
            ...prev,
            models: next.map((group, index) => ({ ...group.model, number: index + 1 })),
            sections: next.flatMap((group, modelIndex) =>
              group.sections.map((section, sectionIndex) => ({
                ...section,
                modelId: group.model.id,
                position: sectionIndex + 1,
                number: `${modelIndex + 1}.${sectionIndex + 1}`,
              })),
            ),
          }
        : prev,
    );

    try {
      await curriculumApi.reorderStructure(
        course.id,
        next.map((group) => ({
          id: group.model.id,
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

  /** Drops a section before `targetSectionId`, or on the end of a model. */
  const handleSectionDrop = async (modelId: string, targetSectionId: string | null) => {
    const dragged = drag;
    setDrag(null);
    if (dragged?.kind !== 'section' || dragged.id === targetSectionId) return;
    // A layer quiz's model holds its own section and nothing else, and its
    // section stays where the map put it.
    const into = groups.find((group) => group.model.id === modelId);
    const from = groups.find((group) =>
      group.sections.some((section) => section.id === dragged.id),
    );
    if (into !== from && [into, from].some((group) => group && isLayerModel(group.model.title))) {
      return onNotify(
        'Directed learning quiz models are built by the course map and cannot hold other sections',
        'error',
      );
    }

    const next = groups.map((group) => ({
      ...group,
      sections: group.sections.filter((section) => section.id !== dragged.id),
    }));

    const moved = course.sections.find((section) => section.id === dragged.id);
    const target = next.find((group) => group.model.id === modelId);
    if (!moved || !target) return;

    const at = targetSectionId
      ? target.sections.findIndex((section) => section.id === targetSectionId)
      : target.sections.length;
    target.sections.splice(at < 0 ? target.sections.length : at, 0, moved);

    await applyStructure(next);
  };

  /**
   * Dragging a model heading moves it and everything inside it.
   *
   * A *section* dropped on a heading goes on the end of that model. The heading
   * is where an author naturally aims, and for an empty model it is most of
   * what there is to aim at — ignoring the drop there made empty models look as
   * though they refused sections altogether.
   */
  const handleModelDrop = async (targetModelId: string) => {
    if (drag?.kind === 'section') return handleSectionDrop(targetModelId, null);

    const dragged = drag;
    setDrag(null);
    if (dragged?.kind !== 'model' || dragged.id === targetModelId) return;

    const next = [...groups];
    const from = next.findIndex((group) => group.model.id === dragged.id);
    const to = next.findIndex((group) => group.model.id === targetModelId);
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
          {/* New model */}
          <div className="flex flex-col gap-2 rounded-lg border border-navy/30 bg-white/60 p-3">
            <p className="text-sm font-semibold text-dark-gray">New model</p>
            {/* Only a name. The number was asked for here and it was the wrong
                question at the wrong time: a model that does not exist yet has
                no place in the course to state, and the answer was overwritten
                by the first drag anyway. It lands at the end and shows its
                number in the outline below, once it is a real model. */}
            <Input
              value={newModel.title}
              onChange={(e) => setNewModel({ ...newModel, title: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && addModel()}
              placeholder="Model title"
              className={inputClass}
            />
            <Button onClick={addModel} className={primaryBtn}>
              <FolderPlusIcon className="w-5 h-5 stroke-2" /> Add model
            </Button>
          </div>

          {/* New section */}
          <div className="flex flex-col gap-2 rounded-lg border border-navy/30 bg-white/60 p-3">
            <p className="text-sm font-semibold text-dark-gray">New section</p>
            {/* The type first, and no blank choice: a section is one piece of
                content, so what it is gets decided before it is made. */}
            <label className="flex flex-col gap-1 text-xs font-medium text-dark-gray">
              Type
              <select
                value={newSection.type}
                onChange={(e) =>
                  setNewSection({ ...newSection, type: e.target.value as SectionType })
                }
                aria-label="Section type"
                className="h-9 rounded-md border border-gray-300 bg-white px-2 text-sm font-normal
                  text-dark-gray"
              >
                {SECTION_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {SECTION_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex gap-2">
              <select
                value={chosenHome}
                onChange={(e) => setNewSection({ ...newSection, modelId: e.target.value })}
                disabled={sectionHomes.length === 0}
                aria-label="Model to add the section to"
                className="h-9 min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-2
                  text-sm text-dark-gray"
              >
                {sectionHomes.map((group) => (
                  <option key={group.model.id} value={group.model.id}>
                    {group.model.title}
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
              disabled={sectionHomes.length === 0 || adding}
            >
              <PlusIcon className="w-5 h-5 stroke-2" /> {adding ? 'Adding…' : 'Add section'}
            </Button>
          </div>

          <hr className="h-px border-t-0 bg-gray-300" />

          {groups.length === 0 ? (
            <p className="text-sm text-dark-gray">No models yet.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {groups.map((group) => {
                const collapsed = collapsedModelIds.has(group.model.id);
                const minutes = group.sections.reduce((sum, m) => sum + m.estimatedMinutes, 0);

                const lockedBy = lockedModels[group.model.id];
                /*
                  A layer quiz's model is written by the course map, not by
                  hand: its name, its place and its section are regenerated
                  whenever a node moves, so the heading goes under the same sheet
                  somebody else's edit lease uses. The quiz inside is still
                  reachable — its wording is the author's to change, and the quiz
                  editor keeps everything else fixed.
                */
                const generated = isLayerModel(group.model.title);

                return (
                  /*
                    Somebody else is in this model, so the whole group goes
                    under the sheet — heading, sections and all. Locking only the
                    heading would leave every section inside it editable, which
                    is the content the lock exists to protect.
                  */
                  <LockOverlay
                    key={group.model.id}
                    locked={Boolean(lockedBy)}
                    reason={lockedBy ? `${lockedBy} is editing this model` : undefined}
                  >
                    <div className="flex flex-col gap-1">
                      {/* Model heading — drag it to move the whole model */}
                      <LockOverlay
                        locked={generated}
                        compact
                        reason="Built from the course map — open its quiz below to reword it"
                      >
                        <div
                          draggable
                          onDragStart={() => setDrag({ kind: 'model', id: group.model.id })}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={() => handleModelDrop(group.model.id)}
                          onDragEnd={() => setDrag(null)}
                          className={`flex cursor-grab items-center gap-1 rounded-md border px-2
                            py-2 ${group.model.color ? '' : 'border-navy/40 bg-navy/5'}
                            ${drag?.kind === 'model' && drag.id === group.model.id ? 'opacity-50' : ''}`}
                          // The tint the learner will see, previewed where it is set.
                          style={modelTint(group.model.color)}
                        >
                          <Bars3Icon className="w-4 h-4 shrink-0 text-dark-gray" />

                          {editingModel?.id === group.model.id ? (
                            // Renaming takes over the row: the drag handle and the
                            // collapse toggle would both fight a text field.
                            <Input
                              autoFocus
                              value={editingModel.title}
                              onChange={(e) =>
                                setEditingModel({ id: group.model.id, title: e.target.value })
                              }
                              onBlur={saveModelTitle}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') saveModelTitle();
                                if (e.key === 'Escape') setEditingModel(null);
                              }}
                              onClick={(e) => e.stopPropagation()}
                              aria-label="Model title"
                              className={`${inputClass} h-8 min-w-0 flex-1`}
                            />
                          ) : (
                            <button
                              onClick={() => toggleModel(group.model.id)}
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
                                    {group.model.number}. {group.model.title}
                                  </span>
                                  {isNew.model(group.model.id) && <NewBadge />}
                                  <EditedTag mark={marks.models[group.model.id]} />
                                </span>
                                <span className="block text-xs">
                                  {group.sections.length} section
                                  {group.sections.length === 1 ? '' : 's'}
                                  {minutes > 0 && ` · ${minutes} min`}
                                </span>
                              </span>
                            </button>
                          )}

                          {group.model.id !== 'ungrouped' && (
                            <>
                              <ModelColorPicker
                                color={group.model.color}
                                label={group.model.title}
                                onSelect={(color) =>
                                  run(
                                    () => curriculumApi.updateModel(group.model.id, { color }),
                                    color ? 'Model colour set' : 'Model colour cleared',
                                    'Failed to change the model colour',
                                  )
                                }
                              />
                              <Button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingModel({
                                    id: group.model.id,
                                    title: group.model.title,
                                  });
                                }}
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 shrink-0 hover:text-green-hover"
                                title="Rename model"
                              >
                                <PencilSquareIcon className="w-4 h-4" />
                              </Button>
                              <Button
                                onClick={() =>
                                  onDelete({
                                    kind: 'model',
                                    id: group.model.id,
                                    label: `${group.model.number}. ${group.model.title}`,
                                  })
                                }
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 shrink-0 hover:text-danger-hover"
                                title="Delete model"
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
                          // which is the only way into an empty model.
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={() => handleSectionDrop(group.model.id, null)}
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
                                    handleSectionDrop(group.model.id, section.id);
                                  }}
                                  onDragEnd={() => setDrag(null)}
                                  className={`flex cursor-grab items-center gap-2 rounded-md border
                                    px-3 py-2
                                    ${section.id === selectedSectionId ? 'border-navy bg-white' : 'border-gray-300 bg-white/60'}
                                    ${drag?.kind === 'section' && drag.id === section.id ? 'opacity-50' : ''}`}
                                  // The colour is the model's, so its sections read
                                  // as belonging together down the whole outline.
                                  style={
                                    group.model.color
                                      ? {
                                          borderLeftWidth: '4px',
                                          borderLeftColor: group.model.color,
                                        }
                                      : undefined
                                  }
                                >
                                  <Bars3Icon className="w-4 h-4 shrink-0 text-dark-gray" />
                                  <button
                                    onClick={() => onSelectSection(section.id)}
                                    aria-current={
                                      section.id === selectedSectionId ? 'true' : undefined
                                    }
                                    className="min-w-0 flex-1 text-left text-sm text-dark-gray"
                                  >
                                    <span className="flex flex-wrap items-center gap-2">
                                      <span>
                                        <span className="font-semibold">{section.number}</span>{' '}
                                        {section.title}
                                      </span>
                                      {/* What the section is: one row, one
                                          piece of content, one badge. */}
                                      <span
                                        className="rounded bg-navy/10 px-1.5 py-0.5 text-[0.6875rem]
                                          font-semibold uppercase tracking-wide text-navy"
                                      >
                                        {SECTION_TYPE_LABELS[section.type]}
                                      </span>
                                      {isNew.section(section.id, section.modelId) && <NewBadge />}
                                      <EditedTag mark={marks.sections[section.id]} />
                                    </span>
                                    <span className="block truncate text-xs">
                                      {sectionSummary(section)}
                                      {section.estimatedMinutes > 0 &&
                                        ` · ${section.estimatedMinutes} min`}
                                    </span>
                                  </button>
                                </div>
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
                    title="Set by the section's place in its model — drag to change it"
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

                <div className="flex flex-col gap-1 text-sm font-medium text-dark-gray">
                  Type
                  {/* Read-only: chosen when the section was added. Different
                      content is a different section. */}
                  <span
                    className="flex h-9 items-center rounded-md border border-gray-300 bg-gray-100
                      px-3 font-semibold"
                    title="Chosen when the section was added — add a new section for different content"
                  >
                    {SECTION_TYPE_LABELS[selectedSection.type]}
                  </span>
                </div>
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

              {/* The section's content, in the editor for its type. */}
              {selectedSection.type !== 'QUIZ' ? (
                <ElementEditor
                  key={selectedSection.id}
                  section={selectedSection}
                  editedMark={marks.sections[selectedSection.id]}
                  onDelete={() =>
                    onDelete({
                      kind: 'section',
                      id: selectedSection.id,
                      label: `${selectedSection.number} ${selectedSection.title}`,
                    })
                  }
                  onSaved={onRefresh}
                  onNotify={onNotify}
                />
              ) : !selectedQuiz ? (
                <p className="text-sm text-dark-gray">
                  This quiz section has no quiz in it. Delete it and add a new quiz section.
                </p>
              ) : (
                <div key={selectedQuiz.id} className="rounded-lg border border-navy/40 bg-navy/5">
                  <div className="flex items-center gap-2 px-3 py-2">
                    {/* Tag underneath, so a long name cannot push the bin on the
                        right out of the row. */}
                    <span className="flex min-h-10 min-w-0 flex-1 flex-col justify-center gap-1">
                      <span className="w-full truncate text-sm text-dark-gray">
                        <span className="font-semibold">QUIZ</span> {selectedQuiz.title} ·{' '}
                        {selectedQuiz.questions.length} question
                        {selectedQuiz.questions.length === 1 ? '' : 's'}
                        {selectedQuiz.timeLimitMinutes !== null &&
                          ` · ${selectedQuiz.timeLimitMinutes} min`}
                        {!selectedQuiz.published && ' · draft'}
                      </span>
                      <EditedTag mark={marks.quizzes[selectedQuiz.id]} />
                    </span>

                    {/* Deleting the quiz lives on its row rather than inside the
                        editor: it belongs with the other things done *to* a
                        quiz, not among the fields that describe one. It takes
                        the section with it — the two are one thing. */}
                    {selectedQuiz.type !== 'DIRECTED' && (
                      <Button
                        onClick={() =>
                          onDelete({
                            kind: 'quiz',
                            id: selectedQuiz.id,
                            label: selectedQuiz.title,
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
                    <QuizEditor quiz={selectedQuiz} onChanged={onRefresh} onNotify={onNotify} />
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
