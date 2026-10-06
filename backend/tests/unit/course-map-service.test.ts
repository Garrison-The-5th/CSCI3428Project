/**
 * File: course-map-service.test.ts
 * Description: Unit tests for the directed-learning map — depths, connections,
 *   the generated layer quizzes and the publish gate.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-09-22
 */
import CourseMapGateway from '@/gateways/course-map-gateway/course-map-gateway';
import CurriculumGateway from '@/gateways/curriculum-gateway/curriculum-gateway';
import QuizGateway from '@/gateways/quiz-gateway/quiz-gateway';
import CourseMapService from '@/services/course-map-service/course-map-service';

jest.mock('@/gateways/course-map-gateway/course-map-gateway');
jest.mock('@/gateways/curriculum-gateway/curriculum-gateway');
jest.mock('@/gateways/quiz-gateway/quiz-gateway');

const map = CourseMapGateway as jest.Mocked<typeof CourseMapGateway>;
const curriculum = CurriculumGateway as jest.Mocked<typeof CurriculumGateway>;
const quiz = QuizGateway as jest.Mocked<typeof QuizGateway>;

const node = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  courseId: 'c1',
  title: id,
  x: 0,
  y: 0,
  depth: 0,
  isRoot: id === 'root',
  items: [],
  ...overrides,
});

describe('CourseMapService.depths', () => {
  it('counts jumps from the root', () => {
    const depths = CourseMapService.depths(
      [node('root'), node('a'), node('b')],
      [
        { parentId: 'root', childId: 'a' },
        { parentId: 'a', childId: 'b' },
      ],
    );

    expect(depths.get('root')).toBe(0);
    expect(depths.get('a')).toBe(1);
    expect(depths.get('b')).toBe(2);
  });

  it('gives a node with two parents the depth of the shallower one', () => {
    // Shared training hanging off both a depth-1 and a depth-2 node: it should
    // be offered as soon as the short route allows.
    const depths = CourseMapService.depths(
      [node('root'), node('a'), node('b'), node('shared')],
      [
        { parentId: 'root', childId: 'a' },
        { parentId: 'a', childId: 'b' },
        { parentId: 'a', childId: 'shared' },
        { parentId: 'b', childId: 'shared' },
      ],
    );

    expect(depths.get('shared')).toBe(2);
  });

  it('leaves out anything the root cannot reach', () => {
    const depths = CourseMapService.depths([node('root'), node('stranded')], []);

    expect(depths.has('stranded')).toBe(false);
  });

  it('answers with nothing when there is no root at all', () => {
    expect(CourseMapService.depths([node('a', { isRoot: false })], []).size).toBe(0);
  });
});

describe('CourseMapService.reaches', () => {
  const edges = [
    { parentId: 'root', childId: 'a' },
    { parentId: 'a', childId: 'b' },
  ];

  it('follows connections downward', () => {
    expect(CourseMapService.reaches(edges, 'root', 'b')).toBe(true);
  });

  it('does not follow them upward', () => {
    expect(CourseMapService.reaches(edges, 'b', 'root')).toBe(false);
  });

  it('terminates on a graph that already loops', () => {
    const looped = [...edges, { parentId: 'b', childId: 'root' }];
    expect(CourseMapService.reaches(looped, 'root', 'nowhere')).toBe(false);
  });
});

describe('CourseMapService.connect', () => {
  beforeEach(() => {
    map.getNodeById.mockImplementation((id: string) => Promise.resolve(node(id)) as never);
    map.getEdges.mockResolvedValue([]);
  });

  it('refuses to give the root a parent', async () => {
    map.getNodeById.mockImplementation((id: string) => Promise.resolve(node(id)) as never);

    await expect(CourseMapService.connect('a', 'root')).rejects.toThrow(
      /root node cannot have a parent/i,
    );
  });

  it('refuses a node leading to itself', async () => {
    await expect(CourseMapService.connect('a', 'a')).rejects.toThrow(/cannot lead to itself/i);
  });

  it('refuses a connection that would close a loop', async () => {
    map.getEdges.mockResolvedValue([
      { id: 'e1', courseId: 'c1', parentId: 'a', childId: 'b', optionId: null },
    ]);

    await expect(CourseMapService.connect('b', 'a')).rejects.toThrow(/loop/i);
  });

  it('refuses to join two different maps', async () => {
    map.getNodeById.mockImplementation(
      (id: string) => Promise.resolve(node(id, { courseId: id === 'a' ? 'c1' : 'c2' })) as never,
    );

    await expect(CourseMapService.connect('a', 'b')).rejects.toThrow(/different maps/i);
  });
});

describe('CourseMapService.assertMappable', () => {
  const course = (sections: Array<{ id: string; number: string; title: string }>) =>
    ({
      id: 'c1',
      directedLearning: true,
      sections,
    }) as unknown as Awaited<ReturnType<typeof curriculum.getCourseById>>;

  /** A root with something on it, which every case but one here takes for granted. */
  const filledRoot = () => node('root', { items: [{ sectionId: 'r1' }] });

  beforeEach(() => {
    map.getRoot.mockResolvedValue(filledRoot() as never);
    map.getNodes.mockResolvedValue([filledRoot()] as never);
    map.getEdges.mockResolvedValue([]);
  });

  it('says nothing about a course that is not directed', async () => {
    curriculum.getCourseById.mockResolvedValue({
      id: 'c1',
      directedLearning: false,
      sections: [{ id: 's1', number: '1.1', title: 'Unmapped' }],
    } as never);

    await expect(CourseMapService.assertMappable('c1')).resolves.toBeUndefined();
  });

  it('refuses while one of the course’s own sections is unplaced, and names it', async () => {
    curriculum.getCourseById.mockResolvedValue(
      course([{ id: 's1', number: '2.3', title: 'Hive maintenance' }]) as never,
    );
    map.placedSectionIds.mockResolvedValue(new Set());

    await expect(CourseMapService.assertMappable('c1')).rejects.toThrow(/2\.3 Hive maintenance/);
  });

  it('allows a publish once everything of this course’s is placed', async () => {
    curriculum.getCourseById.mockResolvedValue(
      course([{ id: 's1', number: '1.1', title: 'Basics' }]) as never,
    );
    map.placedSectionIds.mockResolvedValue(new Set(['s1']));

    await expect(CourseMapService.assertMappable('c1')).resolves.toBeUndefined();
  });

  it('ignores the generated layer sections, which are never staged', async () => {
    curriculum.getCourseById.mockResolvedValue(
      course([{ id: 'q1', number: '9.1', title: 'Directed learning quiz 1' }]) as never,
    );
    map.placedSectionIds.mockResolvedValue(new Set());

    await expect(CourseMapService.assertMappable('c1')).resolves.toBeUndefined();
  });

  it('refuses when a node holding content is not connected to the map', async () => {
    curriculum.getCourseById.mockResolvedValue(course([]) as never);
    map.placedSectionIds.mockResolvedValue(new Set());
    map.getNodes.mockResolvedValue([
      filledRoot(),
      node('stranded', { isRoot: false, items: [{ sectionId: 's9' }] }),
    ] as never);

    await expect(CourseMapService.assertMappable('c1')).rejects.toThrow(/not linked properly/i);
  });

  /*
    An empty unconnected node is refused too, and that is the point of the rule
    rather than an edge of it: a node is a branch point, so anything hanging
    below an empty one is unreachable however full it is.
  */
  it('refuses an unconnected node even when there is nothing in it', async () => {
    curriculum.getCourseById.mockResolvedValue(course([]) as never);
    map.placedSectionIds.mockResolvedValue(new Set());
    map.getNodes.mockResolvedValue([filledRoot(), node('loose', { isRoot: false })] as never);

    await expect(CourseMapService.assertMappable('c1')).rejects.toThrow(/not linked properly/i);
  });

  it('allows a publish when every node has a route back to the root', async () => {
    curriculum.getCourseById.mockResolvedValue(course([]) as never);
    map.placedSectionIds.mockResolvedValue(new Set());
    map.getNodes.mockResolvedValue([filledRoot(), node('bees', { isRoot: false })] as never);
    map.getEdges.mockResolvedValue([{ parentId: 'root', childId: 'bees' }] as never);

    await expect(CourseMapService.assertMappable('c1')).resolves.toBeUndefined();
  });

  /*
    The empty root is a whole-course failure rather than a local one: with no
    content at depth 0 the depth-1 layer quiz is never generated, and with no
    depth-1 quiz nothing below the root is ever chosen or visible. See the note
    on the gate itself.
  */
  it('refuses when the root has no content on it', async () => {
    curriculum.getCourseById.mockResolvedValue(course([]) as never);
    map.placedSectionIds.mockResolvedValue(new Set());
    map.getRoot.mockResolvedValue(node('root') as never);
    map.getNodes.mockResolvedValue([node('root')] as never);

    await expect(CourseMapService.assertMappable('c1')).rejects.toThrow(
      /General content needs an element to publish/i,
    );
  });

  it('says nothing when there is no map yet', async () => {
    curriculum.getCourseById.mockResolvedValue(course([]) as never);
    map.getRoot.mockResolvedValue(null);

    await expect(CourseMapService.assertMappable('c1')).rejects.toThrow(/stage it to the map/i);
  });
});

describe('CourseMapService.syncQuizzes', () => {
  beforeEach(() => {
    curriculum.getCourseById.mockResolvedValue({
      id: 'c1',
      directedLearning: true,
      sections: [],
    } as never);
    map.setDepths.mockResolvedValue(undefined);
    map.pruneChoices.mockResolvedValue(undefined);
    map.setEdgeOption.mockResolvedValue({} as never);
    curriculum.touchDraft.mockResolvedValue({} as never);
  });

  it('does nothing at all on a course that is not directed', async () => {
    curriculum.getCourseById.mockResolvedValue({ id: 'c1', directedLearning: false } as never);

    await CourseMapService.syncQuizzes('c1');

    expect(map.setDepths).not.toHaveBeenCalled();
  });

  it('writes one option per connection, named by the child, at depth one', async () => {
    map.getNodes.mockResolvedValue([
      node('root'),
      node('bees', { isRoot: false, title: 'Bee keeping', x: 100 }),
      node('woods', { isRoot: false, title: 'Woodlands', x: 200 }),
    ] as never);
    map.getEdges.mockResolvedValue([
      { id: 'e1', courseId: 'c1', parentId: 'root', childId: 'bees', optionId: null },
      { id: 'e2', courseId: 'c1', parentId: 'root', childId: 'woods', optionId: null },
    ] as never);
    map.getLayers.mockResolvedValue([
      { id: 'l1', courseId: 'c1', depth: 1, quizId: 'quiz-1', moduleId: 'mod-1' },
    ] as never);
    quiz.getQuizById.mockResolvedValue({
      id: 'quiz-1',
      questions: [{ id: 'qn-1', options: [] }],
    } as never);
    quiz.updateQuestion.mockResolvedValue({
      id: 'qn-1',
      options: [{ id: 'opt-1' }, { id: 'opt-2' }],
    } as never);
    quiz.updateQuiz.mockResolvedValue({} as never);

    await CourseMapService.syncQuizzes('c1');

    expect(quiz.updateQuestion).toHaveBeenCalledWith(
      'qn-1',
      expect.objectContaining({
        // Every parent at this layer is the root, so prefixing each option with
        // "General content ›" would say nothing the learner did not know.
        options: [
          { text: 'Bee keeping', isCorrect: false },
          { text: 'Woodlands', isCorrect: false },
        ],
      }),
    );
  });

  it('names an option by its parent once a layer has more than one', async () => {
    map.getNodes.mockResolvedValue([
      node('root'),
      node('bees', { isRoot: false, title: 'Bee keeping', x: 100, depth: 1 }),
      node('woods', { isRoot: false, title: 'Woodlands', x: 200, depth: 1 }),
      node('bee-site', { isRoot: false, title: 'On site', x: 100, depth: 2 }),
      node('wood-site', { isRoot: false, title: 'On site', x: 200, depth: 2 }),
    ] as never);
    map.getEdges.mockResolvedValue([
      { id: 'e1', courseId: 'c1', parentId: 'root', childId: 'bees', optionId: null },
      { id: 'e2', courseId: 'c1', parentId: 'root', childId: 'woods', optionId: null },
      { id: 'e3', courseId: 'c1', parentId: 'bees', childId: 'bee-site', optionId: null },
      { id: 'e4', courseId: 'c1', parentId: 'woods', childId: 'wood-site', optionId: null },
    ] as never);
    map.getLayers.mockResolvedValue([
      { id: 'l1', courseId: 'c1', depth: 1, quizId: 'quiz-1', moduleId: 'mod-1' },
      { id: 'l2', courseId: 'c1', depth: 2, quizId: 'quiz-2', moduleId: 'mod-2' },
    ] as never);
    quiz.getQuizById.mockImplementation(
      (id: string) =>
        Promise.resolve({ id, questions: [{ id: `qn-${id}`, options: [] }] }) as never,
    );
    quiz.updateQuestion.mockResolvedValue({
      id: 'qn',
      options: [{ id: 'o' }, { id: 'o2' }],
    } as never);
    quiz.updateQuiz.mockResolvedValue({} as never);

    await CourseMapService.syncQuizzes('c1');

    // Two nodes called "On site" under different projects. Without the parent in
    // the label the learner would be asked the same question twice.
    expect(quiz.updateQuestion).toHaveBeenCalledWith(
      'qn-quiz-2',
      expect.objectContaining({
        options: [
          { text: 'Bee keeping › On site', isCorrect: false },
          { text: 'Woodlands › On site', isCorrect: false },
        ],
      }),
    );
  });

  /**
   * Rewriting a question replaces its options and so mints new option ids. Those
   * travel into the published snapshot, so doing it on every map touch — a node
   * dragged an inch included — would make every version differ from the last on
   * ids alone, and the editor would report unpublished changes for ever.
   */
  it('leaves a layer alone when the map already says exactly that', async () => {
    map.getNodes.mockResolvedValue([
      node('root'),
      node('bees', { isRoot: false, title: 'Bee keeping', x: 100 }),
    ] as never);
    map.getEdges.mockResolvedValue([
      { id: 'e1', courseId: 'c1', parentId: 'root', childId: 'bees', optionId: 'opt-1' },
    ] as never);
    map.getLayers.mockResolvedValue([
      { id: 'l1', courseId: 'c1', depth: 1, quizId: 'quiz-1', moduleId: 'mod-1' },
    ] as never);
    quiz.getQuizById.mockResolvedValue({
      id: 'quiz-1',
      questions: [
        {
          id: 'qn-1',
          prompt: 'Which of these apply to you?',
          options: [{ id: 'opt-1', text: 'Bee keeping' }],
        },
      ],
    } as never);
    quiz.updateQuiz.mockResolvedValue({} as never);

    await CourseMapService.syncQuizzes('c1');

    expect(quiz.updateQuestion).not.toHaveBeenCalled();
  });

  /** Two nodes trading names leaves the option list identical and the routes crossed. */
  it('rewrites when the texts match but point at the wrong connections', async () => {
    map.getNodes.mockResolvedValue([
      node('root'),
      node('a', { isRoot: false, title: 'First', x: 100 }),
      node('b', { isRoot: false, title: 'Second', x: 200 }),
    ] as never);
    map.getEdges.mockResolvedValue([
      // The options below are in the right order and say the right things, but
      // each is pointed at the other node's route.
      { id: 'e1', courseId: 'c1', parentId: 'root', childId: 'a', optionId: 'opt-2' },
      { id: 'e2', courseId: 'c1', parentId: 'root', childId: 'b', optionId: 'opt-1' },
    ] as never);
    map.getLayers.mockResolvedValue([
      { id: 'l1', courseId: 'c1', depth: 1, quizId: 'quiz-1', moduleId: 'mod-1' },
    ] as never);
    quiz.getQuizById.mockResolvedValue({
      id: 'quiz-1',
      questions: [
        {
          id: 'qn-1',
          prompt: 'Which of these apply to you?',
          options: [
            { id: 'opt-1', text: 'First' },
            { id: 'opt-2', text: 'Second' },
          ],
        },
      ],
    } as never);
    quiz.updateQuestion.mockResolvedValue({
      id: 'qn-1',
      options: [{ id: 'opt-1' }, { id: 'opt-2' }],
    } as never);
    quiz.updateQuiz.mockResolvedValue({} as never);

    await CourseMapService.syncQuizzes('c1');

    expect(quiz.updateQuestion).toHaveBeenCalled();
  });

  /**
   * The title, prompt and hint are the author's to word. The map rewrites the
   * options when it changes, and must leave the wording exactly as it was.
   */
  it("keeps the author's title, prompt and hint when the options change", async () => {
    map.getNodes.mockResolvedValue([
      node('root'),
      node('bees', { isRoot: false, title: 'Bee keeping', x: 100 }),
    ] as never);
    map.getEdges.mockResolvedValue([
      { id: 'e1', courseId: 'c1', parentId: 'root', childId: 'bees', optionId: null },
    ] as never);
    map.getLayers.mockResolvedValue([
      { id: 'l1', courseId: 'c1', depth: 1, quizId: 'quiz-1', moduleId: 'mod-1' },
    ] as never);
    quiz.getQuizById.mockResolvedValue({
      id: 'quiz-1',
      title: 'Where do you volunteer?',
      questions: [
        {
          id: 'qn-1',
          prompt: 'Which projects are you part of?',
          hint: 'Pick every one',
          options: [{ id: 'opt-old', text: 'Woodlands' }],
        },
      ],
    } as never);
    quiz.updateQuestion.mockResolvedValue({ id: 'qn-1', options: [{ id: 'opt-1' }] } as never);

    await CourseMapService.syncQuizzes('c1');

    const written = quiz.updateQuestion.mock.calls[0][1];
    expect(written).toEqual({ options: [{ text: 'Bee keeping', isCorrect: false }] });
    expect(quiz.updateQuiz).not.toHaveBeenCalled();
  });

  it('removes the module and quiz of a layer the map no longer has', async () => {
    map.getNodes.mockResolvedValue([node('root')] as never);
    map.getEdges.mockResolvedValue([]);
    map.getLayers.mockResolvedValue([
      { id: 'l1', courseId: 'c1', depth: 1, quizId: 'quiz-1', moduleId: 'mod-1' },
    ] as never);
    map.deleteLayer.mockResolvedValue({} as never);
    quiz.hardDeleteQuiz.mockResolvedValue({} as never);
    curriculum.hardDeleteModule.mockResolvedValue({} as never);

    await CourseMapService.syncQuizzes('c1');

    expect(quiz.hardDeleteQuiz).toHaveBeenCalledWith('quiz-1');
    expect(curriculum.hardDeleteModule).toHaveBeenCalledWith('mod-1');
  });
});

describe('CourseMapService.recordChoice', () => {
  it('turns the options they ticked into the nodes those options offer', async () => {
    map.layerForQuiz.mockResolvedValue({
      id: 'l1',
      courseId: 'c1',
      depth: 1,
      quizId: 'quiz-1',
      moduleId: 'mod-1',
    } as never);
    map.getEdges.mockResolvedValue([
      { id: 'e1', courseId: 'c1', parentId: 'root', childId: 'bees', optionId: 'o-bees' },
      { id: 'e2', courseId: 'c1', parentId: 'root', childId: 'drones', optionId: 'o-drones' },
    ] as never);
    map.saveChoice.mockResolvedValue({} as never);

    await CourseMapService.recordChoice(7, 'quiz-1', ['o-bees']);

    expect(map.saveChoice).toHaveBeenCalledWith(7, 'c1', 1, ['bees']);
  });

  it('records one node once, however many routes to it were ticked', async () => {
    map.layerForQuiz.mockResolvedValue({
      id: 'l1',
      courseId: 'c1',
      depth: 2,
      quizId: 'quiz-2',
      moduleId: 'mod-2',
    } as never);
    // Shared training offered under two parents, so two options mean one node.
    map.getEdges.mockResolvedValue([
      { id: 'e1', courseId: 'c1', parentId: 'bees', childId: 'safety', optionId: 'o-a' },
      { id: 'e2', courseId: 'c1', parentId: 'woods', childId: 'safety', optionId: 'o-b' },
    ] as never);
    map.saveChoice.mockResolvedValue({} as never);

    await CourseMapService.recordChoice(7, 'quiz-2', ['o-a', 'o-b']);

    expect(map.saveChoice).toHaveBeenCalledWith(7, 'c1', 2, ['safety']);
  });

  it('ignores a quiz that is not a layer quiz', async () => {
    map.layerForQuiz.mockResolvedValue(null);

    await expect(CourseMapService.recordChoice(7, 'ordinary-exam', ['o'])).resolves.toBeNull();
    expect(map.saveChoice).not.toHaveBeenCalled();
  });
});

/*
  Moving a box is tidying; moving it past another box is an edit.

  `x` is the reading order among everything at one depth — the learner's path is
  sorted by it and a layer quiz lists its options by it — so the two cases have
  to be told apart rather than both treated as "a node moved".
*/
describe('CourseMapService.readingOrder', () => {
  const at = (id: string, x: number, depth = 1) => ({ id, x, depth, title: id });

  it('is unchanged by a move that stays on its own side of its neighbours', () => {
    const before = [at('a', 0), at('b', 300), at('c', 600)];
    const after = [at('a', 0), at('b', 350), at('c', 600)];

    expect(CourseMapService.readingOrder(before)).toBe(CourseMapService.readingOrder(after));
  });

  it('is unchanged by a purely vertical move', () => {
    const before = [at('a', 0), at('b', 300)];

    expect(CourseMapService.readingOrder(before)).toBe(
      CourseMapService.readingOrder([...before].reverse()),
    );
  });

  it('changes when one node is dragged past another at the same depth', () => {
    const before = [at('a', 0), at('b', 300)];
    const after = [at('a', 400), at('b', 300)];

    expect(CourseMapService.readingOrder(before)).not.toBe(CourseMapService.readingOrder(after));
  });

  it('keeps the depths apart, so a deep node never sorts among a shallow one', () => {
    const order = CourseMapService.readingOrder([at('deep', 0, 2), at('shallow', 999, 1)]);

    expect(order).toBe('shallow,deep');
  });

  /** Two boxes dropped at the same x still have to come out in a settled order. */
  it('settles a tie on x by title', () => {
    expect(CourseMapService.readingOrder([at('b', 10), at('a', 10)])).toBe('a,b');
  });
});

/**
 * The preview has to be built from the same content the publish is.
 *
 * A map may place another course's sections, and those are not in
 * `getCourseById(courseId).sections` — they belong to the course that wrote
 * them. `buildSnapshot` appends them so a learner is actually served them; the
 * preview did not, so `projectDirectedCourse` could not find them, dropped the
 * node holding them as empty, and the author saw a branch that vanished on the
 * one screen meant to show them what a learner gets.
 */
describe('CourseMapService.previewFor', () => {
  const ownSection = { id: 's-own', number: '1.1', title: 'Start', quizzes: [] };
  const borrowedSection = {
    id: 's-exam',
    number: '1.1',
    title: 'Safety exam',
    quizzes: [{ id: 'q-exam', title: 'Safety exam' }],
  };

  beforeEach(() => {
    curriculum.getCourseById.mockImplementation(((id: string) =>
      Promise.resolve(
        id === 'c1'
          ? { id: 'c1', directedLearning: true, modules: [], sections: [ownSection] }
          : { id: 'lender', directedLearning: false, modules: [], sections: [borrowedSection] },
      )) as never);

    // The root holds this course's own section; the branch holds one borrowed
    // from another course, which is what staging an exam onto a node produces.
    map.getNodes.mockResolvedValue([
      node('root', {
        depth: 0,
        items: [{ sectionId: 's-own', sourceCourseId: 'c1' }],
      }),
      node('branch', {
        isRoot: false,
        depth: 1,
        items: [{ sectionId: 's-exam', sourceCourseId: 'lender' }],
      }),
    ] as never);
    map.getEdges.mockResolvedValue([
      { id: 'e1', parentId: 'root', childId: 'branch', optionId: 'opt-1' },
    ] as never);
    map.getLayers.mockResolvedValue([
      { id: 'l1', depth: 1, quizId: 'layer-quiz', moduleId: 'mod-q1', sectionId: 's-q1' },
    ] as never);
    quiz.getQuizById.mockResolvedValue({ id: 'layer-quiz', sectionId: 's-q1' } as never);
  });

  it('serves a borrowed section on the branch that was picked', async () => {
    const preview = await CourseMapService.previewFor('c1', new Map([[1, ['branch']]]));

    expect(preview.course.sections.map((section) => section.id)).toContain('s-exam');
  });

  it('carries the quizzes on that borrowed section, which is what was staged', async () => {
    const preview = await CourseMapService.previewFor('c1', new Map([[1, ['branch']]]));

    const served = preview.course.sections.find((section) => section.id === 's-exam');
    expect((served as unknown as typeof borrowedSection)?.quizzes.map((q) => q.id)).toEqual([
      'q-exam',
    ]);
  });

  it('draws the branch as a module rather than dropping it as empty', async () => {
    const preview = await CourseMapService.previewFor('c1', new Map([[1, ['branch']]]));

    expect(preview.course.modules.map((module) => module.title)).toContain('branch');
  });

  it('still leaves out a branch the learner did not pick', async () => {
    const preview = await CourseMapService.previewFor('c1', new Map());

    expect(preview.course.sections.map((section) => section.id)).not.toContain('s-exam');
  });
});
