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

/** A course staged with everything it holds, so mapping is allowed. */
const stagedCourse = (overrides: Record<string, unknown> = {}) => ({
  id: 'c1',
  directedLearning: true,
  stagedAt: new Date('2026-10-01'),
  stagedContentIds: ['m1', 's1'],
  models: [{ id: 'm1' }],
  sections: [{ id: 's1', title: 'Intro' }],
  ...overrides,
});

describe('CourseMapService.connect', () => {
  beforeEach(() => {
    map.getNodeById.mockImplementation((id: string) => Promise.resolve(node(id)) as never);
    map.getEdges.mockResolvedValue([]);
    map.getLayers.mockResolvedValue([]);
    curriculum.getCourseById.mockResolvedValue(stagedCourse() as never);
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
      { id: 'e1', courseId: 'c1', parentId: 'a', childId: 'b', optionId: null, subgraphId: null },
    ]);

    await expect(CourseMapService.connect('b', 'a')).rejects.toThrow(/loop/i);
  });

  it('refuses to join two different maps', async () => {
    map.getNodeById.mockImplementation(
      (id: string) => Promise.resolve(node(id, { courseId: id === 'a' ? 'c1' : 'c2' })) as never,
    );

    await expect(CourseMapService.connect('a', 'b')).rejects.toThrow(/different maps/i);
  });

  it('refuses while something has been added since the course was last staged', async () => {
    curriculum.getCourseById.mockResolvedValue(
      stagedCourse({
        sections: [
          { id: 's1', title: 'Intro' },
          { id: 's2', title: 'New' },
        ],
      }) as never,
    );

    await expect(CourseMapService.connect('a', 'b')).rejects.toThrow(/stage the course/i);
    expect(map.createEdge).not.toHaveBeenCalled();
  });

  it('refuses to lead into the middle of a linked map', async () => {
    map.getNodeById.mockImplementation(
      (id: string) => Promise.resolve(node(id, id === 'b' ? { subgraphId: 'g1' } : {})) as never,
    );
    // Something inside the linked map already leads into `b`, so it is not its root.
    map.getEdges.mockResolvedValue([
      { id: 'e0', courseId: 'c1', parentId: 'x', childId: 'b', optionId: null, subgraphId: 'g1' },
    ]);

    await expect(CourseMapService.connect('a', 'b')).rejects.toThrow(/first node/i);
  });
});

describe('CourseMapService.disconnect', () => {
  it('refuses to cut a connection a linked map owns', async () => {
    map.getNodeById.mockImplementation((id: string) => Promise.resolve(node(id)) as never);
    map.getLayers.mockResolvedValue([]);
    curriculum.getCourseById.mockResolvedValue(stagedCourse() as never);
    map.getEdges.mockResolvedValue([
      { id: 'e1', courseId: 'c1', parentId: 'a', childId: 'b', optionId: null, subgraphId: 'g1' },
    ]);
    map.getSubgraphById.mockResolvedValue({ id: 'g1', sourceCourseId: 'c2' } as never);

    await expect(CourseMapService.disconnect('a', 'b')).rejects.toThrow(/linked in from/i);
    expect(map.deleteEdge).not.toHaveBeenCalled();
  });
});

describe('CourseMapService.needsStaging', () => {
  it('is true for a course never staged', () => {
    expect(CourseMapService.needsStaging(stagedCourse({ stagedAt: null }), [])).toBe(true);
  });

  it('is false when nothing has been added since the stage', () => {
    expect(CourseMapService.needsStaging(stagedCourse(), [])).toBe(false);
  });

  it('is true once a model is added', () => {
    const course = stagedCourse({ models: [{ id: 'm1' }, { id: 'm2' }] });
    expect(CourseMapService.needsStaging(course, [])).toBe(true);
  });

  it('ignores the map’s own layer models and sections', () => {
    const course = stagedCourse({
      models: [{ id: 'm1' }, { id: 'layer-mod' }],
      sections: [
        { id: 's1', title: 'Intro' },
        { id: 'layer-sec', title: 'Directed learning quiz 1' },
      ],
    });
    expect(CourseMapService.needsStaging(course, [{ modelId: 'layer-mod' }])).toBe(false);
  });

  it('does not ask for a stage just because something was deleted', () => {
    const course = stagedCourse({ sections: [] });
    expect(CourseMapService.needsStaging(course, [])).toBe(false);
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
      /General content needs a section to publish/i,
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
    map.getSubgraphsFromSource.mockResolvedValue([]);
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
      { id: 'l1', courseId: 'c1', depth: 1, quizId: 'quiz-1', modelId: 'mod-1' },
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
      node('bee-home', { isRoot: false, title: 'At home', x: 150, depth: 2 }),
      node('wood-site', { isRoot: false, title: 'On site', x: 200, depth: 2 }),
      node('wood-home', { isRoot: false, title: 'At home', x: 250, depth: 2 }),
    ] as never);
    map.getEdges.mockResolvedValue([
      { id: 'e1', courseId: 'c1', parentId: 'root', childId: 'bees', optionId: null },
      { id: 'e2', courseId: 'c1', parentId: 'root', childId: 'woods', optionId: null },
      { id: 'e3', courseId: 'c1', parentId: 'bees', childId: 'bee-site', optionId: null },
      { id: 'e5', courseId: 'c1', parentId: 'bees', childId: 'bee-home', optionId: null },
      { id: 'e4', courseId: 'c1', parentId: 'woods', childId: 'wood-site', optionId: null },
      { id: 'e6', courseId: 'c1', parentId: 'woods', childId: 'wood-home', optionId: null },
    ] as never);
    map.getLayers.mockResolvedValue([
      { id: 'l1', courseId: 'c1', depth: 1, quizId: 'quiz-1', modelId: 'mod-1' },
      { id: 'l2', courseId: 'c1', depth: 2, quizId: 'quiz-2', modelId: 'mod-2' },
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
          { text: 'Bee keeping › At home', isCorrect: false },
          { text: 'Woodlands › On site', isCorrect: false },
          { text: 'Woodlands › At home', isCorrect: false },
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
      node('woods', { isRoot: false, title: 'Woodlands', x: 200 }),
    ] as never);
    map.getEdges.mockResolvedValue([
      { id: 'e1', courseId: 'c1', parentId: 'root', childId: 'bees', optionId: 'opt-1' },
      { id: 'e2', courseId: 'c1', parentId: 'root', childId: 'woods', optionId: 'opt-2' },
    ] as never);
    map.getLayers.mockResolvedValue([
      { id: 'l1', courseId: 'c1', depth: 1, quizId: 'quiz-1', modelId: 'mod-1' },
    ] as never);
    quiz.getQuizById.mockResolvedValue({
      id: 'quiz-1',
      questions: [
        {
          id: 'qn-1',
          prompt: 'Which of these apply to you?',
          options: [
            { id: 'opt-1', text: 'Bee keeping' },
            { id: 'opt-2', text: 'Woodlands' },
          ],
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
      { id: 'l1', courseId: 'c1', depth: 1, quizId: 'quiz-1', modelId: 'mod-1' },
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
      node('woods', { isRoot: false, title: 'Woodlands', x: 200 }),
    ] as never);
    map.getEdges.mockResolvedValue([
      { id: 'e1', courseId: 'c1', parentId: 'root', childId: 'bees', optionId: null },
      { id: 'e2', courseId: 'c1', parentId: 'root', childId: 'woods', optionId: null },
    ] as never);
    map.getLayers.mockResolvedValue([
      { id: 'l1', courseId: 'c1', depth: 1, quizId: 'quiz-1', modelId: 'mod-1' },
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
    quiz.updateQuestion.mockResolvedValue({
      id: 'qn-1',
      options: [{ id: 'opt-1' }, { id: 'opt-2' }],
    } as never);

    await CourseMapService.syncQuizzes('c1');

    const written = quiz.updateQuestion.mock.calls[0][1];
    expect(written).toEqual({
      options: [
        { text: 'Bee keeping', isCorrect: false },
        { text: 'Woodlands', isCorrect: false },
      ],
    });
    expect(quiz.updateQuiz).not.toHaveBeenCalled();
  });

  it('removes the model and quiz of a layer the map no longer has', async () => {
    map.getNodes.mockResolvedValue([node('root')] as never);
    map.getEdges.mockResolvedValue([]);
    map.getLayers.mockResolvedValue([
      { id: 'l1', courseId: 'c1', depth: 1, quizId: 'quiz-1', modelId: 'mod-1' },
    ] as never);
    map.deleteLayer.mockResolvedValue({} as never);
    quiz.hardDeleteQuiz.mockResolvedValue({} as never);
    curriculum.hardDeleteModel.mockResolvedValue({} as never);

    await CourseMapService.syncQuizzes('c1');

    expect(quiz.hardDeleteQuiz).toHaveBeenCalledWith('quiz-1');
    expect(curriculum.hardDeleteModel).toHaveBeenCalledWith('mod-1');
  });

  /*
    A map that runs in a line — or converges on one node — never forks, so there
    is nothing to ask. No quiz is generated, and any it had is removed.
  */
  it('generates no quiz where no node has two or more children', async () => {
    map.getNodes.mockResolvedValue([
      node('root'),
      node('a', { isRoot: false, title: 'A', x: 100 }),
      node('b', { isRoot: false, title: 'B', x: 200 }),
    ] as never);
    map.getEdges.mockResolvedValue([
      { id: 'e1', courseId: 'c1', parentId: 'root', childId: 'a', optionId: 'opt-1' },
      { id: 'e2', courseId: 'c1', parentId: 'a', childId: 'b', optionId: null },
    ] as never);
    map.getLayers.mockResolvedValue([
      { id: 'l1', courseId: 'c1', depth: 1, quizId: 'quiz-1', modelId: 'mod-1' },
    ] as never);
    map.deleteLayer.mockResolvedValue({} as never);
    quiz.hardDeleteQuiz.mockResolvedValue({} as never);
    curriculum.hardDeleteModel.mockResolvedValue({} as never);

    await CourseMapService.syncQuizzes('c1');

    expect(map.createLayer).not.toHaveBeenCalled();
    expect(quiz.updateQuestion).not.toHaveBeenCalled();
    expect(quiz.hardDeleteQuiz).toHaveBeenCalledWith('quiz-1');
    // The stale option is let go, so it cannot be read as a live route.
    expect(map.setEdgeOption).toHaveBeenCalledWith('e1', null);
  });

  it('offers only the forking parent’s children when a layer mixes the two', async () => {
    map.getNodes.mockResolvedValue([
      node('root'),
      node('a', { isRoot: false, title: 'A', x: 100, depth: 1 }),
      node('b', { isRoot: false, title: 'B', x: 200, depth: 1 }),
      node('a1', { isRoot: false, title: 'A1', x: 100, depth: 2 }),
      node('a2', { isRoot: false, title: 'A2', x: 150, depth: 2 }),
      node('b1', { isRoot: false, title: 'B1', x: 200, depth: 2 }),
    ] as never);
    map.getEdges.mockResolvedValue([
      { id: 'e1', courseId: 'c1', parentId: 'root', childId: 'a', optionId: null },
      { id: 'e2', courseId: 'c1', parentId: 'root', childId: 'b', optionId: null },
      { id: 'e3', courseId: 'c1', parentId: 'a', childId: 'a1', optionId: null },
      { id: 'e4', courseId: 'c1', parentId: 'a', childId: 'a2', optionId: null },
      { id: 'e5', courseId: 'c1', parentId: 'b', childId: 'b1', optionId: null },
    ] as never);
    map.getLayers.mockResolvedValue([
      { id: 'l1', courseId: 'c1', depth: 1, quizId: 'quiz-1', modelId: 'mod-1' },
      { id: 'l2', courseId: 'c1', depth: 2, quizId: 'quiz-2', modelId: 'mod-2' },
    ] as never);
    quiz.getQuizById.mockImplementation(
      (id: string) =>
        Promise.resolve({ id, questions: [{ id: `qn-${id}`, options: [] }] }) as never,
    );
    quiz.updateQuestion.mockResolvedValue({
      id: 'qn',
      options: [{ id: 'o' }, { id: 'o2' }],
    } as never);

    await CourseMapService.syncQuizzes('c1');

    expect(quiz.updateQuestion).toHaveBeenCalledWith(
      'qn-quiz-2',
      expect.objectContaining({
        options: [
          { text: 'A1', isCorrect: false },
          { text: 'A2', isCorrect: false },
        ],
      }),
    );
  });
});

describe('CourseMapService.recordChoice', () => {
  it('turns the options they ticked into the nodes those options offer', async () => {
    map.layerForQuiz.mockResolvedValue({
      id: 'l1',
      courseId: 'c1',
      depth: 1,
      quizId: 'quiz-1',
      modelId: 'mod-1',
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
      modelId: 'mod-2',
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
          ? { id: 'c1', directedLearning: true, models: [], sections: [ownSection] }
          : { id: 'lender', directedLearning: false, models: [], sections: [borrowedSection] },
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
      // A second branch, so the root forks and the learner has a choice to make.
      node('other', { isRoot: false, depth: 1, x: 100 }),
    ] as never);
    map.getEdges.mockResolvedValue([
      { id: 'e1', parentId: 'root', childId: 'branch', optionId: 'opt-1' },
      { id: 'e2', parentId: 'root', childId: 'other', optionId: 'opt-2' },
    ] as never);
    map.getLayers.mockResolvedValue([
      { id: 'l1', depth: 1, quizId: 'layer-quiz', modelId: 'mod-q1', sectionId: 's-q1' },
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

  it('draws the branch as a model rather than dropping it as empty', async () => {
    const preview = await CourseMapService.previewFor('c1', new Map([[1, ['branch']]]));

    expect(preview.course.models.map((model) => model.title)).toContain('branch');
  });

  it('still leaves out a branch the learner did not pick', async () => {
    const preview = await CourseMapService.previewFor('c1', new Map());

    expect(preview.course.sections.map((section) => section.id)).not.toContain('s-exam');
  });
});

/*
  Linked maps, worked through the example they were specified by.

  Course B is mapped BG → B1, BG → B2. Course A is mapped AG → A1, AG → A2, and
  links B in: A1 → BG, A2 → BG. A then carries on from the end of B's map with
  its own nodes: B2 → A3, A3 → A4.

  B is then remapped: B1 → B1.1, B2 → B2.1. A's copy follows straight away. The
  red connections are B's and are never cut; B2 is no longer the end of B's map,
  so A's B2 → A3 is cut, leaving A3 → A4 as a piece of its own.
*/
const edge = (id: string, parentId: string, childId: string, subgraphId: string | null = null) => ({
  id,
  courseId: 'c1',
  parentId,
  childId,
  optionId: null,
  subgraphId,
});

const courseB = (remapped: boolean) => ({
  nodes: [
    node('BG', { courseId: 'b', isRoot: true, title: 'General content', x: 0, y: 0 }),
    node('B1', { courseId: 'b', isRoot: false, title: 'B1', x: 300, y: -100 }),
    node('B2', { courseId: 'b', isRoot: false, title: 'B2', x: 300, y: 100 }),
    ...(remapped
      ? [
          node('B1.1', { courseId: 'b', isRoot: false, title: 'B1.1', x: 600, y: -100 }),
          node('B2.1', { courseId: 'b', isRoot: false, title: 'B2.1', x: 600, y: 100 }),
        ]
      : []),
  ],
  edges: [
    edge('b1', 'BG', 'B1'),
    edge('b2', 'BG', 'B2'),
    ...(remapped ? [edge('b3', 'B1', 'B1.1'), edge('b4', 'B2', 'B2.1')] : []),
  ],
});

const copy = (sourceNodeId: string, overrides: Record<string, unknown> = {}) =>
  node(`copy-${sourceNodeId}`, {
    isRoot: false,
    title: sourceNodeId,
    subgraphId: 'g1',
    sourceNodeId,
    ...overrides,
  });

/** Course A, after B has been linked in and A3, A4 hung off the end of it. */
const courseA = {
  nodes: [
    node('AG'),
    node('A1', { isRoot: false }),
    node('A2', { isRoot: false }),
    copy('BG', { x: 1000, y: 1000 }),
    copy('B1'),
    copy('B2'),
    node('A3', { isRoot: false }),
    node('A4', { isRoot: false }),
  ],
  edges: [
    edge('a1', 'AG', 'A1'),
    edge('a2', 'AG', 'A2'),
    edge('into-1', 'A1', 'copy-BG'),
    edge('into-2', 'A2', 'copy-BG'),
    edge('red-1', 'copy-BG', 'copy-B1', 'g1'),
    edge('red-2', 'copy-BG', 'copy-B2', 'g1'),
    edge('on', 'copy-B2', 'A3'),
    edge('a3', 'A3', 'A4'),
  ],
};

function mockMaps(target: typeof courseA, source: ReturnType<typeof courseB>) {
  map.getNodes.mockImplementation(((courseId: string) =>
    Promise.resolve(courseId === 'b' ? source.nodes : target.nodes)) as never);
  map.getEdges.mockImplementation(((courseId: string) =>
    Promise.resolve(courseId === 'b' ? source.edges : target.edges)) as never);
}

describe('CourseMapService.syncSubgraph', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    map.getSubgraphById.mockResolvedValue({
      id: 'g1',
      courseId: 'c1',
      sourceCourseId: 'b',
      anchorNodeId: null,
    } as never);
    curriculum.getCourseById.mockResolvedValue({ id: 'b', title: 'Course B' } as never);
    map.runTransaction.mockImplementation(((fn: (db: unknown) => unknown) => fn({})) as never);
    map.createNode.mockImplementation(((data: { sourceNodeId: string }) =>
      Promise.resolve({ id: `copy-${data.sourceNodeId}` })) as never);
    map.updateNode.mockImplementation(((id: string) => Promise.resolve({ id })) as never);
    map.setItems.mockResolvedValue(undefined);
    map.removeAuthoredSection.mockResolvedValue({ count: 0 } as never);
    map.createEdge.mockResolvedValue({} as never);
    map.deleteEdge.mockResolvedValue({ count: 0 } as never);
    map.deleteEdgeById.mockResolvedValue({} as never);
    map.clearSubgraphAnchor.mockResolvedValue({} as never);
  });

  describe('when the source is remapped', () => {
    beforeEach(() => mockMaps(courseA, courseB(true)));

    it('copies the new nodes in and joins them with red connections', async () => {
      await CourseMapService.syncSubgraph('g1');

      expect(map.createNode).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'B1.1', subgraphId: 'g1', sourceNodeId: 'B1.1' }),
        expect.anything(),
      );
      expect(map.createEdge).toHaveBeenCalledWith(
        { courseId: 'c1', parentId: 'copy-B1', childId: 'copy-B1.1', subgraphId: 'g1' },
        expect.anything(),
      );
      expect(map.createEdge).toHaveBeenCalledWith(
        { courseId: 'c1', parentId: 'copy-B2', childId: 'copy-B2.1', subgraphId: 'g1' },
        expect.anything(),
      );
    });

    it('cuts B2 → A3, since B2 is no longer the end of the linked map', async () => {
      await CourseMapService.syncSubgraph('g1');

      expect(map.deleteEdgeById).toHaveBeenCalledWith('on', expect.anything());
    });

    it('never cuts a red connection, nor A’s own connections into BG or after A3', async () => {
      await CourseMapService.syncSubgraph('g1');

      const cut = map.deleteEdgeById.mock.calls.map(([id]) => id);
      expect(cut).toEqual(['on']);
    });

    it('places a new node relative to where BG’s copy now sits', async () => {
      await CourseMapService.syncSubgraph('g1');

      expect(map.createNode).toHaveBeenCalledWith(
        expect.objectContaining({ sourceNodeId: 'B2.1', x: 1600, y: 1100 }),
        expect.anything(),
      );
    });
  });

  it('cuts nothing when the end of the linked map has not moved', async () => {
    mockMaps(courseA, courseB(false));

    await CourseMapService.syncSubgraph('g1');

    expect(map.deleteEdgeById).not.toHaveBeenCalled();
  });

  it('cuts this course’s connections to a node the source deleted, through the cascade', async () => {
    const source = courseB(false);
    source.nodes = source.nodes.filter((current) => current.id !== 'B2');
    source.edges = source.edges.filter((current) => current.childId !== 'B2');
    mockMaps(courseA, source);
    map.deleteNode.mockResolvedValue({} as never);

    await CourseMapService.syncSubgraph('g1');

    expect(map.deleteNode).toHaveBeenCalledWith('copy-B2', expect.anything());
    // Already gone with the node: asking the database again would fail.
    expect(map.deleteEdgeById).not.toHaveBeenCalledWith('on', expect.anything());
    expect(map.deleteEdgeById).not.toHaveBeenCalledWith('red-2', expect.anything());
  });

  it('on a new link, copies BG in beside the node it was dropped on and leads into it', async () => {
    map.getSubgraphById.mockResolvedValue({
      id: 'g1',
      courseId: 'c1',
      sourceCourseId: 'b',
      anchorNodeId: 'A1',
    } as never);
    mockMaps(
      {
        nodes: [node('AG'), node('A1', { isRoot: false, x: 400, y: 200 })],
        edges: [edge('a1', 'AG', 'A1')],
      },
      courseB(false),
    );

    await CourseMapService.syncSubgraph('g1');

    expect(map.createNode).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Course B: General content',
        sourceNodeId: 'BG',
        x: 720,
        y: 200,
      }),
      expect.anything(),
    );
    // A1 → BG is A's own connection, not a red one.
    expect(map.createEdge).toHaveBeenCalledWith(
      { courseId: 'c1', parentId: 'A1', childId: 'copy-BG' },
      expect.anything(),
    );
    expect(map.createEdge).toHaveBeenCalledWith(
      { courseId: 'c1', parentId: 'copy-BG', childId: 'copy-B1', subgraphId: 'g1' },
      expect.anything(),
    );
    expect(map.clearSubgraphAnchor).toHaveBeenCalledWith('g1', expect.anything());
  });

  it('removes the link when the source no longer has a map', async () => {
    mockMaps(courseA, { nodes: [], edges: [] });
    map.deleteSubgraph.mockResolvedValue({ count: 1 } as never);

    await CourseMapService.syncSubgraph('g1');

    expect(map.deleteSubgraph).toHaveBeenCalledWith('g1');
    expect(map.createNode).not.toHaveBeenCalled();
  });
});

describe('CourseMapService.deleteNode on a linked map', () => {
  it('removes the whole linked map rather than the one node', async () => {
    map.getNodeById.mockResolvedValue(node('copy-a', { isRoot: false, subgraphId: 'g1' }) as never);
    map.getLayers.mockResolvedValue([]);
    map.getSubgraphsFromSource.mockResolvedValue([]);
    curriculum.getCourseById.mockResolvedValue(stagedCourse({ directedLearning: false }) as never);
    map.deleteSubgraph.mockResolvedValue({ count: 1 } as never);

    await CourseMapService.deleteNode('copy-a');

    expect(map.deleteSubgraph).toHaveBeenCalledWith('g1');
    expect(map.deleteNode).not.toHaveBeenCalled();
  });
});

describe('CourseMapService.connect with a linked map', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    map.getLayers.mockResolvedValue([]);
    curriculum.getCourseById.mockResolvedValue(stagedCourse({ directedLearning: false }) as never);
    map.getNodeById.mockImplementation(((id: string) =>
      Promise.resolve(courseA.nodes.find((current) => current.id === id) ?? null)) as never);
    map.getEdges.mockResolvedValue(courseA.edges);
    map.createEdge.mockResolvedValue({} as never);
    map.getSubgraphs.mockResolvedValue([]);
    map.getImports.mockResolvedValue([]);
    map.getNodes.mockResolvedValue([]);
    map.placedSectionIds.mockResolvedValue(new Set());
  });

  it('lets this course lead into the linked map’s root, from more than one node', async () => {
    map.getEdges.mockResolvedValue(courseA.edges.filter((current) => current.id !== 'into-2'));

    await CourseMapService.connect('A2', 'copy-BG');

    expect(map.createEdge).toHaveBeenCalledWith({
      courseId: 'c1',
      parentId: 'A2',
      childId: 'copy-BG',
    });
  });

  it('refuses to lead into the middle of a linked map', async () => {
    await expect(CourseMapService.connect('A2', 'copy-B1')).rejects.toThrow(/first node/i);
    expect(map.createEdge).not.toHaveBeenCalled();
  });

  it('lets a node at the end of the linked map lead on to this course’s nodes', async () => {
    await CourseMapService.connect('copy-B1', 'A4');

    expect(map.createEdge).toHaveBeenCalledWith({
      courseId: 'c1',
      parentId: 'copy-B1',
      childId: 'A4',
    });
  });

  it('refuses to lead on from a node the linked map already leads on from', async () => {
    await expect(CourseMapService.connect('copy-BG', 'A4')).rejects.toThrow(/end of a linked map/i);
    expect(map.createEdge).not.toHaveBeenCalled();
  });
});

describe('CourseMapService.disconnect with a linked map', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    map.getLayers.mockResolvedValue([]);
    curriculum.getCourseById.mockResolvedValue(stagedCourse({ directedLearning: false }) as never);
    map.getNodeById.mockImplementation(((id: string) =>
      Promise.resolve(courseA.nodes.find((current) => current.id === id) ?? null)) as never);
    map.getEdges.mockResolvedValue(courseA.edges);
    map.getSubgraphById.mockResolvedValue({ id: 'g1', sourceCourseId: 'b' } as never);
    map.deleteEdge.mockResolvedValue({ count: 1 } as never);
  });

  it('lets this course cut its own connection into BG', async () => {
    await CourseMapService.disconnect('A1', 'copy-BG');
    expect(map.deleteEdge).toHaveBeenCalledWith('A1', 'copy-BG');
  });

  it('never cuts a red connection', async () => {
    await expect(CourseMapService.disconnect('copy-BG', 'copy-B1')).rejects.toThrow(
      /linked in from/i,
    );
    expect(map.deleteEdge).not.toHaveBeenCalled();
  });
});

describe('CourseMapService.propagate', () => {
  it('rewrites every course the map is linked into, without waiting for a publish', async () => {
    jest.clearAllMocks();
    map.getSubgraphsFromSource.mockResolvedValue([
      { id: 'g1', courseId: 'c1', sourceCourseId: 'b', anchorNodeId: null },
    ] as never);
    const sync = jest.spyOn(CourseMapService, 'syncSubgraph').mockResolvedValue(undefined);
    const quizzes = jest.spyOn(CourseMapService, 'syncQuizzes').mockResolvedValue(undefined);

    await CourseMapService.propagate('b', new Set());

    expect(sync).toHaveBeenCalledWith('g1');
    expect(quizzes).toHaveBeenCalledWith('c1', expect.any(Set));
    sync.mockRestore();
    quizzes.mockRestore();
  });
});

/**
 * The model, section and quiz the map generates for a layer. On a two-layer
 * course the section is the content, so a layer's section is a QUIZ section and
 * the quiz hangs off it — the same shape an author's quiz has.
 */
describe('CourseMapService.mintLayer', () => {
  it('makes a layer model holding one QUIZ section and its directed quiz', async () => {
    curriculum.getHighestModelNumber.mockResolvedValue(2 as never);
    curriculum.createModel.mockResolvedValue({ id: 'layer-model' } as never);
    curriculum.createSection.mockResolvedValue({ id: 'layer-section' } as never);
    quiz.createQuiz.mockResolvedValue({ id: 'layer-quiz' } as never);
    map.createLayer.mockResolvedValue({ quizId: 'layer-quiz' } as never);

    const quizId = await CourseMapService.mintLayer('c1', 1, 'Directed learning quiz 1');

    expect(quizId).toBe('layer-quiz');
    expect(curriculum.createModel).toHaveBeenCalledWith(
      expect.objectContaining({ courseId: 'c1', number: 3 }),
    );
    expect(curriculum.createSection).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: 'layer-model',
        type: 'QUIZ',
        position: 1,
        number: '3.1',
      }),
    );
    expect(quiz.createQuiz).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'DIRECTED', sectionId: 'layer-section' }),
    );
    expect(map.createLayer).toHaveBeenCalledWith({
      courseId: 'c1',
      depth: 1,
      quizId: 'layer-quiz',
      modelId: 'layer-model',
    });
  });

  /** `layerModelIds` is what makes the structure editor treat them as read-only. */
  it('names its layer models so the editor can refuse edits to them', async () => {
    map.getLayers.mockResolvedValue([{ modelId: 'layer-model' }] as never);

    expect(await CourseMapService.layerModelIds('c1')).toEqual(new Set(['layer-model']));
  });
});
