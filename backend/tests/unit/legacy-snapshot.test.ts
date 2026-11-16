/**
 * File: legacy-snapshot.test.ts
 * Description: Unit tests for reading published versions stored in an older
 *   shape as the current two-layer one.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-11-13
 */
import { createHash } from 'crypto';

import { splitSectionId, upgradeSnapshot } from '@/services/publication-service/legacy-snapshot';

/**
 * A published version is never rewritten, so every course published before the
 * structure became two layers is still stored the old way. These are the rules
 * that turn one into the other on read — and they have to be the migration's
 * rules exactly, because learners' progress was moved onto the ids the
 * migration produced. `two-layer-migration.test.ts` runs the same fixture
 * through the SQL and checks the two arrive at the same ids.
 */

/** An old three-layer snapshot: one module, one section holding three elements and a quiz. */
function threeLayerSnapshot() {
  return {
    id: 'c1',
    title: 'Fire safety',
    kind: 'LESSON',
    sequential: true,
    modules: [{ id: 'mod-1', courseId: 'c1', number: 1, title: 'Basics', color: '#c7d9f0' }],
    sections: [
      {
        id: 'sec-1',
        courseId: 'c1',
        moduleId: 'mod-1',
        position: 1,
        number: '1.1',
        title: 'Extinguishers',
        estimatedMinutes: 15,
        color: '#f0d9c7',
        elements: [
          // Out of order on purpose: `order` decides, not where it sits in the list.
          {
            id: 'el-b',
            order: 2,
            type: 'YOUTUBE',
            videoUrl: 'https://youtu.be/x',
            durationMinutes: 4,
          },
          { id: 'el-a', order: 1, type: 'TEXT', textContent: '<p>Read this first</p>' },
          { id: 'el-c', order: 4, type: 'IMAGE', imageData: 'AAAA', imageType: 'image/png' },
        ],
        quizzes: [
          {
            id: 'quiz-1',
            title: 'Quick check',
            type: 'LEARNING_CHECK',
            sectionId: 'sec-1',
            order: 3,
            questions: [
              { id: 'q1', order: 1, prompt: 'Which?', hintSectionNumber: '1.2', options: [] },
            ],
          },
        ],
      },
      {
        id: 'sec-2',
        courseId: 'c1',
        moduleId: 'mod-1',
        position: 2,
        number: '1.2',
        title: 'Exits',
        estimatedMinutes: 5,
        color: null,
        elements: [{ id: 'el-d', order: 1, type: 'TEXT', textContent: 'Know your exits' }],
        quizzes: [],
      },
    ],
    instructors: [],
  };
}

describe('splitSectionId', () => {
  /**
   * The migration writes `md5('<kind>:<id>')::uuid`. If this ever stops
   * matching, every learner on an old version loses their place.
   */
  it('derives the same id the migration does', () => {
    const hex = createHash('md5').update('element:el-b').digest('hex');
    expect(splitSectionId('element', 'el-b')).toBe(
      `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`,
    );
    expect(splitSectionId('quiz', 'quiz-1')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    // An element and a quiz that happened to share an id still get different sections.
    expect(splitSectionId('element', 'same')).not.toBe(splitSectionId('quiz', 'same'));
  });
});

describe('upgradeSnapshot', () => {
  it('hands a snapshot already in the current shape straight back', () => {
    const current = { id: 'c1', models: [], sections: [] };
    expect(upgradeSnapshot(current)).toBe(current);
  });

  it('returns null for nothing', () => {
    expect(upgradeSnapshot(null)).toBeNull();
    expect(upgradeSnapshot(undefined)).toBeNull();
  });

  it('renames modules to models and keeps their ids', () => {
    const upgraded = upgradeSnapshot(threeLayerSnapshot())!;

    expect(upgraded.models).toEqual([
      { id: 'mod-1', courseId: 'c1', number: 1, title: 'Basics', color: '#c7d9f0' },
    ]);
    expect(upgraded).not.toHaveProperty('modules');
    // Course-level fields come through untouched.
    expect(upgraded).toMatchObject({ id: 'c1', title: 'Fire safety', sequential: true });
  });

  /** D2: each element becomes its own section, in its original order. */
  it('turns each element and quiz into a section, in the order they shared', () => {
    const upgraded = upgradeSnapshot(threeLayerSnapshot())!;

    expect(upgraded.sections.map((section) => [section.number, section.type, section.id])).toEqual([
      // The first element keeps the old section's id.
      ['1.1', 'TEXT', 'sec-1'],
      ['1.2', 'YOUTUBE', splitSectionId('element', 'el-b')],
      // The quiz sat between the video and the picture, and still does.
      ['1.3', 'QUIZ', splitSectionId('quiz', 'quiz-1')],
      ['1.4', 'IMAGE', splitSectionId('element', 'el-c')],
      // The section that followed moves down, keeping its own id.
      ['1.5', 'TEXT', 'sec-2'],
    ]);
    expect(upgraded.sections.map((section) => section.position)).toEqual([1, 2, 3, 4, 5]);
    for (const section of upgraded.sections) {
      expect(section).not.toHaveProperty('elements');
      expect(section.modelId).toBe('mod-1');
    }
  });

  it('moves each element’s content onto its section', () => {
    const [text, video, , image] = upgradeSnapshot(threeLayerSnapshot())!.sections;

    expect(text).toMatchObject({ textContent: '<p>Read this first</p>', videoUrl: null });
    expect(video).toMatchObject({ videoUrl: 'https://youtu.be/x', durationMinutes: 4 });
    expect(image).toMatchObject({ imageData: 'AAAA', imageType: 'image/png', textContent: null });
  });

  it('repeats the original title and colour, and leaves the time estimate whole', () => {
    const [first, video, quiz, image] = upgradeSnapshot(threeLayerSnapshot())!.sections;

    expect(first.title).toBe('Extinguishers');
    expect(video.title).toBe('Extinguishers');
    expect(image.title).toBe('Extinguishers');
    // A quiz keeps its own name, which is what an author would look for.
    expect(quiz.title).toBe('Quick check');
    expect([first, video, quiz, image].map((section) => section.color)).toEqual(
      Array(4).fill('#f0d9c7'),
    );
    // Fifteen minutes before, fifteen minutes after — not sixty.
    expect([first, video, quiz, image].map((section) => section.estimatedMinutes)).toEqual([
      15, 0, 0, 0,
    ]);
  });

  /** D1: a quiz is its own section of type QUIZ, and keeps its id and questions. */
  it('hangs each quiz off its own QUIZ section', () => {
    const sections = upgradeSnapshot(threeLayerSnapshot())!.sections;
    const quizSection = sections[2];

    expect(quizSection.quizzes).toHaveLength(1);
    expect(quizSection.quizzes[0]).toMatchObject({
      id: 'quiz-1',
      type: 'LEARNING_CHECK',
      sectionId: quizSection.id,
    });
    expect(quizSection.quizzes[0].questions.map((question) => question.id)).toEqual(['q1']);
    // No other section carries a quiz.
    expect(sections.filter((section) => section.quizzes.length > 0)).toHaveLength(1);
  });

  /** A hint names a section by number, and the numbers have moved. */
  it('repoints a question hint at the section it named', () => {
    const quiz = upgradeSnapshot(threeLayerSnapshot())!.sections[2].quizzes[0];
    // "1.2" was the Exits section, which is now 1.5.
    expect(quiz.questions[0].hintSectionNumber).toBe('1.5');
  });

  /**
   * A quiz set's sections, and a course map's generated quiz sections, hold a
   * quiz and no elements. They become QUIZ sections in place — same id, no
   * empty text section left behind.
   */
  it('makes a section with only a quiz into that quiz’s section', () => {
    const upgraded = upgradeSnapshot({
      id: 'set-1',
      kind: 'QUIZ_SET',
      modules: [{ id: 'mod-1', courseId: 'set-1', number: 1, title: 'Fire safety' }],
      sections: [
        {
          id: 'sec-1',
          courseId: 'set-1',
          moduleId: 'mod-1',
          number: '1.1',
          title: 'Fire safety',
          elements: [],
          quizzes: [
            { id: 'quiz-1', title: 'Fire safety exam', type: 'EXAM', order: 1, questions: [] },
          ],
        },
      ],
    })!;

    expect(upgraded.sections).toHaveLength(1);
    expect(upgraded.sections[0]).toMatchObject({
      id: 'sec-1',
      type: 'QUIZ',
      title: 'Fire safety',
      number: '1.1',
    });
    expect(upgraded.sections[0].quizzes[0]).toMatchObject({ id: 'quiz-1', sectionId: 'sec-1' });
  });

  it('keeps an empty section, as an empty TEXT section', () => {
    const upgraded = upgradeSnapshot({
      id: 'c1',
      modules: [{ id: 'mod-1', courseId: 'c1', number: 1, title: 'Basics' }],
      sections: [
        {
          id: 'sec-1',
          courseId: 'c1',
          moduleId: 'mod-1',
          number: '1.1',
          title: 'Empty',
          elements: [],
          quizzes: [],
        },
      ],
    })!;

    expect(upgraded.sections).toEqual([
      expect.objectContaining({ id: 'sec-1', type: 'TEXT', textContent: '', quizzes: [] }),
    ]);
  });

  /** A directed course's map names sections by id, so it has to follow the split. */
  it('carries the course map across', () => {
    const upgraded = upgradeSnapshot({
      ...threeLayerSnapshot(),
      directedLearning: true,
      map: {
        nodes: [
          {
            id: 'root',
            title: 'General',
            x: 0,
            y: 0,
            depth: 0,
            isRoot: true,
            sectionIds: ['sec-1'],
          },
          { id: 'n1', title: 'Exits', x: 0, y: 1, depth: 1, isRoot: false, sectionIds: ['sec-2'] },
        ],
        edges: [{ parentId: 'root', childId: 'n1', optionId: 'opt-1' }],
        layers: [{ depth: 1, quizId: 'layer-quiz', moduleId: 'layer-mod', sectionId: 'layer-sec' }],
      },
    })!;

    // The node that held the section now holds everything it became, in order.
    expect(upgraded.map!.nodes[0].sectionIds).toEqual([
      'sec-1',
      splitSectionId('element', 'el-b'),
      splitSectionId('quiz', 'quiz-1'),
      splitSectionId('element', 'el-c'),
    ]);
    expect(upgraded.map!.nodes[1].sectionIds).toEqual(['sec-2']);
    expect(upgraded.map!.edges).toEqual([{ parentId: 'root', childId: 'n1', optionId: 'opt-1' }]);
    // A layer's module is now its model.
    expect(upgraded.map!.layers).toEqual([
      { depth: 1, quizId: 'layer-quiz', modelId: 'layer-mod', sectionId: 'layer-sec' },
    ]);
  });

  /**
   * The oldest shape of all, from before the two container names traded places:
   * the outer level was called `sections` and the inner one `modules`. Getting
   * this wrong does not throw — it silently swaps the two levels of every old
   * course.
   */
  it('reads a snapshot from before the containers traded names', () => {
    const upgraded = upgradeSnapshot({
      id: 'c1',
      title: 'Fire safety',
      sections: [{ id: 'outer-1', courseId: 'c1', number: 1, title: 'Intro' }],
      modules: [
        {
          id: 'inner-1',
          courseId: 'c1',
          sectionId: 'outer-1',
          number: '1.1',
          title: 'Basics',
          elements: [{ id: 'e1', order: 1, type: 'TEXT', textContent: 'Hello' }],
          quizzes: [
            {
              id: 'q1',
              title: 'Check',
              moduleId: 'inner-1',
              order: 2,
              questions: [{ id: 'qq1', hintModuleNumber: '1.1', options: [] }],
            },
          ],
        },
      ],
    })!;

    // The outer level becomes models, the inner becomes sections.
    expect(upgraded.models.map((model) => model.id)).toEqual(['outer-1']);
    expect(upgraded.sections.map((section) => [section.id, section.type, section.modelId])).toEqual(
      [
        ['inner-1', 'TEXT', 'outer-1'],
        [splitSectionId('quiz', 'q1'), 'QUIZ', 'outer-1'],
      ],
    );
    // Defaults that did not exist when the snapshot was written.
    expect(upgraded.kind).toBe('LESSON');
    const quiz = upgraded.sections[1].quizzes[0];
    expect(quiz).toMatchObject({ type: 'EXAM', showResults: true });
    expect(quiz.questions[0].hintSectionNumber).toBe('1.1');
    expect(quiz.questions[0]).not.toHaveProperty('hintModuleNumber');
  });
});
