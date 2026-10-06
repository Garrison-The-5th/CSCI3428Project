/**
 * File: quiz-pane.tsx
 * Description: Building a lesson's quizzes, as one pane of the course editor.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Date: 2026-08-11
 */
/**
 * The Quiz pane.
 *
 * Sits in the same shell as the lesson editor and takes the same slot the course
 * structure does — the sidebar just says Quiz instead of Modules. Left is the
 * selected section's quizzes; right is the rail of modules and sections, so
 * picking where a quiz goes reads exactly as it does when writing the lesson.
 *
 * The quiz editor itself is untouched: this only decides which quizzes are on
 * screen and where a new one lands.
 */
import { PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import { useEffect, useState } from 'react';

import QuizEditor from '@/components/common/quiz-editor';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import QuizSetPane from '@/pages/private/admin/editor/quiz-set-pane';
import { Course, curriculumApi, moduleGroups, moduleTint } from '@/services/curriculum-api';
import { QUIZ_TYPE_HINTS, QUIZ_TYPE_LABELS, quizApi, QuizType } from '@/services/quiz-api';

interface Props {
  course: Course;
  selectedSectionId: string | null;
  onSelectSection: (id: string | null) => void;
  onRefresh: () => Promise<void>;
  onNotify: (message: string, type?: 'success' | 'error') => void;
  onDelete: (target: { kind: 'quiz' | 'section'; id: string; label: string }) => void;
  run: (action: () => Promise<unknown>, success: string, failure: string) => Promise<boolean>;
}

const inputClass = 'bg-white text-dark-gray';
const primaryBtn = 'bg-navy text-white hover:bg-navy-hover';

/**
 * What can be created from inside a lesson.
 *
 * A one-time quiz is deliberately absent: it is reached only through its link and
 * cannot sit in a section, so offering it here would be offering something the
 * server refuses. Those are made on the Create a Quiz page instead.
 */
const IN_SECTION_TYPES: QuizType[] = ['EXAM', 'LEARNING_CHECK'];

const QuizPane = ({
  course,
  selectedSectionId,
  onSelectSection,
  onRefresh,
  onNotify,
  onDelete,
  run,
}: Props) => {
  /** New-quiz title and kind, keyed by the section or module it will land in. */
  const [drafts, setDrafts] = useState<Record<string, { title: string; type: QuizType }>>({});

  /*
   * A quiz set is a different job and gets a different pane.
   *
   * Chosen here rather than in the shell so the sidebar has one entry pointing at
   * one component, and so adding a third shape later does not mean another
   * branch — and another import — in the editor itself.
   *
   * Declared after the hooks above so the early return below cannot change how
   * many run on a render.
   */
  const isQuizSet = course.kind === 'QUIZ_SET';

  const groups = moduleGroups(course);
  const selectedSection = course.sections.find((s) => s.id === selectedSectionId) ?? null;
  /** A layer quiz's section holds that quiz alone — see structure-editor. */
  const layerSection = selectedSection?.quizzes.some((quiz) => quiz.type === 'DIRECTED') ?? false;

  // Keep a section selected so the editor pane is never blank on arrival.
  useEffect(() => {
    if (course.sections.length === 0) return;
    if (course.sections.some((section) => section.id === selectedSectionId)) return;
    onSelectSection(course.sections[0].id);
  }, [course, selectedSectionId, onSelectSection]);

  const draftFor = (key: string) => drafts[key] ?? { title: '', type: 'EXAM' as QuizType };
  const setDraft = (key: string, patch: Partial<{ title: string; type: QuizType }>) =>
    setDrafts((prev) => ({ ...prev, [key]: { ...draftFor(key), ...patch } }));

  const createInSection = async (sectionId: string) => {
    const draft = draftFor(sectionId);
    const title = draft.title.trim();
    if (!title) return onNotify('Quiz needs a title', 'error');

    const ok = await run(
      () => quizApi.createQuiz({ title, sectionId, type: draft.type }),
      `${QUIZ_TYPE_LABELS[draft.type]} "${title}" created`,
      'Failed to create quiz',
    );
    if (ok) setDraft(sectionId, { title: '' });
  };

  /**
   * Starting a module that has no sections yet.
   *
   * A quiz has to live in a section, so an empty module cannot take one directly.
   * Rather than sending the author to the lesson editor to make a section first
   * and come back, the section is created here and named after the quiz — which
   * is almost always what it would have been called anyway, and is renameable in
   * the lesson editor if not.
   */
  const createInEmptyModule = async (moduleId: string) => {
    const draft = draftFor(moduleId);
    const title = draft.title.trim();
    if (!title) return onNotify('Quiz needs a title', 'error');

    const ok = await run(
      async () => {
        const created = await curriculumApi.createSection(course.id, {
          moduleId,
          title,
          estimatedMinutes: 0,
        });
        const sectionId = created?.section?.id;
        if (!sectionId) throw new Error('The section could not be created');
        await quizApi.createQuiz({ title, sectionId, type: draft.type });
        onSelectSection(sectionId);
      },
      `Section and quiz "${title}" created`,
      'Failed to create the quiz',
    );

    if (ok) setDraft(moduleId, { title: '' });
  };

  const typePicker = (key: string) => (
    <select
      value={draftFor(key).type}
      onChange={(e) => setDraft(key, { type: e.target.value as QuizType })}
      title={QUIZ_TYPE_HINTS[draftFor(key).type]}
      className="h-9 rounded-md border border-gray-300 bg-white px-2 text-sm text-dark-gray"
    >
      {IN_SECTION_TYPES.map((type) => (
        <option key={type} value={type}>
          {QUIZ_TYPE_LABELS[type]}
        </option>
      ))}
    </select>
  );

  const quizCount = course.sections.reduce((sum, section) => sum + section.quizzes.length, 0);

  if (isQuizSet) {
    return (
      <QuizSetPane
        course={course}
        selectedSectionId={selectedSectionId}
        onSelectSection={onSelectSection}
        onRefresh={onRefresh}
        onNotify={onNotify}
        onDelete={onDelete}
      />
    );
  }

  if (course.sections.length === 0) {
    return (
      <Card className="bg-light-gray">
        <CardContent className="py-16 text-center">
          <p>
            This lesson has no sections yet. Add one under Modules, then come back to build its
            quizzes.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      {/* ---- Quiz editor for the selected section ---- */}
      <div className="flex min-w-0 flex-col gap-6">
        {!selectedSection ? (
          <Card className="bg-light-gray">
            <CardContent className="py-16 text-center">
              <p>Pick a section to edit its quizzes.</p>
            </CardContent>
          </Card>
        ) : (
          <>
            <Card className="bg-light-gray shadow-sm">
              <CardHeader className="p-4">
                <CardTitle className="text-lg text-dark-gray">
                  {selectedSection.number} {selectedSection.title}
                </CardTitle>
                <p className="text-sm text-dark-gray">
                  {selectedSection.quizzes.length} quiz
                  {selectedSection.quizzes.length === 1 ? '' : 'zes'} in this section
                </p>
              </CardHeader>

              {!layerSection && (
                <CardContent>
                  <div
                    className="flex flex-wrap items-center gap-3 rounded-lg border-2 border-dashed
                      border-navy/30 p-4"
                  >
                    {typePicker(selectedSection.id)}
                    <Input
                      value={draftFor(selectedSection.id).title}
                      onChange={(e) => setDraft(selectedSection.id, { title: e.target.value })}
                      onKeyDown={(e) => e.key === 'Enter' && createInSection(selectedSection.id)}
                      placeholder={`New quiz for ${selectedSection.number} ${selectedSection.title}`}
                      className={`${inputClass} min-w-60 flex-1`}
                    />
                    <Button
                      onClick={() => createInSection(selectedSection.id)}
                      className={primaryBtn}
                    >
                      <PlusIcon className="w-5 h-5 stroke-2" /> Add Quiz
                    </Button>
                    <p className="w-full text-xs text-dark-gray">
                      {QUIZ_TYPE_HINTS[draftFor(selectedSection.id).type]}
                    </p>
                  </div>
                </CardContent>
              )}
            </Card>

            {selectedSection.quizzes.length === 0 ? (
              <Card className="bg-light-gray">
                <CardContent className="py-16 text-center">
                  <p>No quizzes in this section yet. Add one above.</p>
                </CardContent>
              </Card>
            ) : (
              selectedSection.quizzes.map((quiz) => (
                <Card key={quiz.id} className="gap-4 border border-gray-300 bg-white shadow-sm">
                  {/* Deleting the quiz sits on the card that holds it rather
                      than among the settings inside: it is something done to the
                      quiz, not one of its properties. */}
                  <CardHeader className="flex-row items-center justify-between gap-3 p-4 pb-0">
                    <CardTitle className="min-w-0 truncate text-base text-dark-gray">
                      {quiz.title}
                    </CardTitle>
                    {quiz.type !== 'DIRECTED' && (
                      <Button
                        onClick={() => onDelete({ kind: 'quiz', id: quiz.id, label: quiz.title })}
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0 hover:text-danger-hover"
                        title="Delete quiz"
                      >
                        <TrashIcon className="w-5 h-5" />
                      </Button>
                    )}
                  </CardHeader>
                  <CardContent className="p-4">
                    <QuizEditor quiz={quiz} onChanged={onRefresh} onNotify={onNotify} />
                  </CardContent>
                </Card>
              ))
            )}
          </>
        )}
      </div>

      {/* ---- Section rail, mirroring the course content page ---- */}
      <aside className="lg:sticky lg:top-20 lg:self-start">
        <Card className="gap-0 bg-light-gray p-0 shadow-sm">
          <div className="border-b border-gray-300 p-4">
            <h2 className="font-semibold text-dark-gray">Sections</h2>
            <p className="text-sm text-dark-gray">
              {course.sections.length} section{course.sections.length === 1 ? '' : 's'} ·{' '}
              {quizCount} quiz{quizCount === 1 ? '' : 'zes'}
            </p>
          </div>

          <div className="max-h-[70vh] overflow-y-auto p-2">
            {groups.map((group) => (
              <div key={group.module.id} className="mb-3">
                <h3
                  className={`rounded-md border-l-4 px-2 py-1 text-xs font-bold uppercase
                  tracking-wide text-dark-gray
                  ${group.module.color ? '' : 'border-l-navy/30 bg-navy/5'}`}
                  style={moduleTint(group.module.color)}
                >
                  {group.module.number}. {group.module.title}
                </h3>

                <ul className="mt-1 flex flex-col">
                  {group.sections.map((section) => {
                    const count = section.quizzes.length;

                    return (
                      <li key={section.id}>
                        <button
                          onClick={() => onSelectSection(section.id)}
                          className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left
                          text-sm ${
                            section.id === selectedSectionId
                              ? 'bg-white font-semibold text-dark-gray'
                              : 'text-dark-gray hover:bg-white/60'
                          }`}
                        >
                          <span className="min-w-0 flex-1 truncate">
                            {section.number} {section.title}
                          </span>
                          <span
                            className={`shrink-0 rounded-full px-2 text-xs
                            ${count > 0 ? 'bg-navy text-white' : 'bg-gray-300 text-dark-gray'}`}
                          >
                            {count}
                          </span>
                        </button>
                      </li>
                    );
                  })}

                  {group.sections.length === 0 && (
                    // An empty module is workable rather than a dead end: naming a
                    // quiz here creates its first section along with it.
                    <li
                      className="flex flex-col gap-2 rounded-md border-2 border-dashed
                        border-navy/30 p-2"
                    >
                      <span className="text-xs text-dark-gray">
                        Empty module — name a quiz and its first section is made for you.
                      </span>
                      {typePicker(group.module.id)}
                      <Input
                        value={draftFor(group.module.id).title}
                        onChange={(e) => setDraft(group.module.id, { title: e.target.value })}
                        onKeyDown={(e) => e.key === 'Enter' && createInEmptyModule(group.module.id)}
                        placeholder="New quiz title"
                        className={`${inputClass} h-8`}
                      />
                      <Button
                        onClick={() => createInEmptyModule(group.module.id)}
                        className={`${primaryBtn} h-8`}
                      >
                        <PlusIcon className="w-4 h-4 stroke-2" /> Add quiz
                      </Button>
                    </li>
                  )}
                </ul>
              </div>
            ))}
          </div>
        </Card>
      </aside>
    </div>
  );
};

export default QuizPane;
