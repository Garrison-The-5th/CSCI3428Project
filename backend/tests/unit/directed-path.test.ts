/**
 * File: directed-path.test.ts
 * Description: Unit tests for the projection that turns a course map plus a
 *   learner's answers into the course they actually read.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-09-24
 */
import {
  LearnerChoices,
  projectDirectedCourse,
  SnapshotMap,
  visibleNodeIds,
} from '@/services/course-map-service/directed-path';

/**
 * The worked example from the specification, drawn out.
 *
 * root ── beekeeping ── (beekeeping on site, beekeeping developer)
 *      ├─ drone mapping
 *      └─ woodlands  ── (woodlands on site, woodlands developer)
 *
 * Used by most of these because it is the case the feature was described by:
 * two branches taken, one refused, and the same two questions asked again one
 * level down.
 */
function exampleMap(): SnapshotMap {
  return {
    nodes: [
      {
        id: 'root',
        title: 'General content',
        x: 0,
        y: 0,
        depth: 0,
        isRoot: true,
        sectionIds: ['s-general'],
      },
      {
        id: 'bees',
        title: 'Bee keeping project',
        x: 100,
        y: 100,
        depth: 1,
        isRoot: false,
        sectionIds: ['s-bees'],
      },
      {
        id: 'drones',
        title: 'Drone mapping project',
        x: 200,
        y: 100,
        depth: 1,
        isRoot: false,
        sectionIds: ['s-drones'],
      },
      {
        id: 'woods',
        title: 'Woodlands project',
        x: 300,
        y: 100,
        depth: 1,
        isRoot: false,
        sectionIds: ['s-woods'],
      },
      {
        id: 'bee-site',
        title: 'On site',
        x: 100,
        y: 200,
        depth: 2,
        isRoot: false,
        sectionIds: ['s-ppe', 's-hive'],
      },
      {
        id: 'bee-dev',
        title: 'Developer',
        x: 150,
        y: 200,
        depth: 2,
        isRoot: false,
        sectionIds: ['s-bee-files'],
      },
      {
        id: 'wood-site',
        title: 'On site',
        x: 300,
        y: 200,
        depth: 2,
        isRoot: false,
        sectionIds: ['s-chop'],
      },
      {
        id: 'wood-dev',
        title: 'Developer',
        x: 400,
        y: 200,
        depth: 2,
        isRoot: false,
        sectionIds: ['s-files'],
      },
    ],
    edges: [
      { parentId: 'root', childId: 'bees' },
      { parentId: 'root', childId: 'drones' },
      { parentId: 'root', childId: 'woods' },
      { parentId: 'bees', childId: 'bee-site' },
      { parentId: 'bees', childId: 'bee-dev' },
      { parentId: 'woods', childId: 'wood-site' },
      { parentId: 'woods', childId: 'wood-dev' },
    ],
    layers: [
      { depth: 1, quizId: 'quiz-1', modelId: 'mod-q1', sectionId: 's-q1' },
      { depth: 2, quizId: 'quiz-2', modelId: 'mod-q2', sectionId: 's-q2' },
    ],
  };
}

function section(id: string, title = id) {
  return { id, modelId: 'original', position: 1, number: '9.9', title };
}

function exampleCourse() {
  return {
    id: 'course-1',
    models: [{ id: 'original', courseId: 'course-1', number: 1, title: 'Everything', color: null }],
    sections: [
      section('s-general'),
      section('s-bees'),
      section('s-drones'),
      section('s-woods'),
      section('s-ppe'),
      section('s-hive'),
      section('s-bee-files'),
      section('s-chop'),
      section('s-files'),
      section('s-q1'),
      section('s-q2'),
    ],
  };
}

const choices = (byDepth: Record<number, string[]>): LearnerChoices => ({
  byDepth: new Map(Object.entries(byDepth).map(([depth, ids]) => [Number(depth), ids])),
});

describe('visibleNodeIds', () => {
  it('gives somebody who has answered nothing the root and nothing else', () => {
    expect([...visibleNodeIds(exampleMap(), choices({}))]).toEqual(['root']);
  });

  it('opens only the branches that were ticked', () => {
    const visible = visibleNodeIds(exampleMap(), choices({ 1: ['bees', 'woods'] }));

    expect(visible.has('bees')).toBe(true);
    expect(visible.has('woods')).toBe(true);
    // Refused at the quiz, so it is not part of this person's course at all.
    expect(visible.has('drones')).toBe(false);
  });

  it('refuses a branch whose parent was not taken, however it was answered', () => {
    // Ticking a depth-2 node without its parent can only come from a stale
    // answer or a hand-made request. Either way the route in is not there.
    const visible = visibleNodeIds(exampleMap(), choices({ 1: ['bees'], 2: ['wood-dev'] }));

    expect(visible.has('wood-dev')).toBe(false);
  });

  it('keeps a node whose other parent was dropped, as long as one route remains', () => {
    const map = exampleMap();
    // Shared training: site safety hangs off both projects.
    map.edges.push({ parentId: 'bees', childId: 'wood-site' });

    const visible = visibleNodeIds(map, choices({ 1: ['bees'], 2: ['wood-site'] }));

    expect(visible.has('wood-site')).toBe(true);
  });
});

describe('projectDirectedCourse', () => {
  it('serves the root and the first quiz to a learner who has answered nothing', () => {
    const { course } = projectDirectedCourse(exampleCourse(), exampleMap(), choices({}));

    expect(course.models.map((model) => model.title)).toEqual([
      'General content',
      'Directed learning quiz 1',
    ]);
    expect(course.sections.map((entry) => entry.id)).toEqual(['s-general', 's-q1']);
  });

  it('orders the course by depth, then left to right across the canvas', () => {
    const { course } = projectDirectedCourse(
      exampleCourse(),
      exampleMap(),
      choices({ 1: ['bees', 'woods'], 2: ['bee-site', 'wood-site', 'wood-dev'] }),
    );

    expect(course.models.map((model) => model.title)).toEqual([
      'General content',
      'Directed learning quiz 1',
      // x = 100 then x = 300: the order the boxes sit in, not the order they
      // were made in.
      'Bee keeping project',
      'Woodlands project',
      'Directed learning quiz 2',
      'On site',
      'On site',
      'Developer',
    ]);
  });

  it('leaves out the branch that was refused', () => {
    const { course } = projectDirectedCourse(
      exampleCourse(),
      exampleMap(),
      choices({ 1: ['bees', 'woods'] }),
    );

    expect(course.sections.map((entry) => entry.id)).not.toContain('s-drones');
  });

  it('keeps every section id as it was authored, so progress survives', () => {
    const { course } = projectDirectedCourse(
      exampleCourse(),
      exampleMap(),
      choices({ 1: ['bees'], 2: ['bee-site'] }),
    );

    expect(course.sections.map((entry) => entry.id)).toEqual([
      's-general',
      's-q1',
      's-bees',
      's-q2',
      's-ppe',
      's-hive',
    ]);
  });

  it('renumbers so the learner reads 1.1, 2.1, 3.1 with no holes', () => {
    const { course } = projectDirectedCourse(
      exampleCourse(),
      exampleMap(),
      choices({ 1: ['bees'], 2: ['bee-site'] }),
    );

    expect(course.sections.map((entry) => entry.number)).toEqual([
      '1.1',
      '2.1',
      '3.1',
      '4.1',
      '5.1',
      '5.2',
    ]);
  });

  it('makes each layer quiz wait on everything read before it', () => {
    const { locks } = projectDirectedCourse(
      exampleCourse(),
      exampleMap(),
      choices({ 1: ['bees'], 2: ['bee-site'] }),
    );

    expect(locks).toEqual([
      // The first quiz waits on the root's content, and nothing else exists yet.
      { quizId: 'quiz-1', sectionId: 's-q1', depth: 1, requires: ['s-general'] },
      // The second waits on that plus the branch they took at the first.
      { quizId: 'quiz-2', sectionId: 's-q2', depth: 2, requires: ['s-general', 's-bees'] },
    ]);
  });

  it('drops a node that holds nothing rather than drawing an empty model', () => {
    const map = exampleMap();
    map.nodes = map.nodes.map((node) => (node.id === 'bees' ? { ...node, sectionIds: [] } : node));

    const { course } = projectDirectedCourse(exampleCourse(), map, choices({ 1: ['bees'] }));

    expect(course.models.map((model) => model.title)).not.toContain('Bee keeping project');
  });

  it('does not offer a layer quiz when the layer above it has no content to read', () => {
    const map = exampleMap();
    // A root with nothing in it: there is no "finish this, then choose".
    map.nodes = map.nodes.map((node) => (node.isRoot ? { ...node, sectionIds: [] } : node));

    const { course } = projectDirectedCourse(exampleCourse(), map, choices({}));

    expect(course.models).toEqual([]);
  });
});

/**
 * The same map, with the layer quizzes' sections carrying real options.
 *
 * One option per edge, named for it, so a narrowed question can be read back as
 * the list of routes it offers.
 */
function mapWithOptions(): SnapshotMap {
  const map = exampleMap();
  map.edges = map.edges.map((edge) => ({
    ...edge,
    optionId: `opt-${edge.parentId}-${edge.childId}`,
  }));
  return map;
}

interface QuizzedSection {
  id: string;
  modelId: string;
  position: number;
  number: string;
  title: string;
  /** Declared on every section, so the array has one type rather than a union. */
  quizzes?: Array<{ id: string; questions: Array<{ options: Array<{ id: string }> }> }>;
}

function courseWithQuizOptions() {
  const map = mapWithOptions();
  const depthOf = new Map(map.nodes.map((node) => [node.id, node.depth]));
  const optionsFor = (depth: number) =>
    map.edges
      .filter((edge) => depthOf.get(edge.childId) === depth)
      .map((edge) => ({ id: edge.optionId as string }));

  const course = exampleCourse();
  const sections: QuizzedSection[] = course.sections.map((current) => {
    if (current.id !== 's-q1' && current.id !== 's-q2') return current;
    const depth = current.id === 's-q1' ? 1 : 2;
    return {
      ...current,
      quizzes: [{ id: `quiz-${depth}`, questions: [{ options: optionsFor(depth) }] }],
    };
  });

  return { ...course, sections };
}

/** The options a given layer quiz offers, in the projected course. */
function optionsOffered(course: { sections: QuizzedSection[] }, sectionId: string) {
  const section = course.sections.find((current) => current.id === sectionId);
  return (section?.quizzes?.[0]?.questions?.[0]?.options ?? []).map((option) => option.id);
}

describe('a layer quiz only offers the routes this learner can reach', () => {
  it('drops the branches hanging off a project they did not take', () => {
    const { course } = projectDirectedCourse(
      courseWithQuizOptions(),
      mapWithOptions(),
      choices({ 1: ['bees'] }),
    );

    // Only bee-site and bee-dev hang off `bees`; the two woodlands routes hang
    // off a node this learner never picked and could never reach by answering.
    expect(optionsOffered(course, 's-q2')).toEqual(['opt-bees-bee-site', 'opt-bees-bee-dev']);
  });

  it('offers both when both parents were taken', () => {
    const { course } = projectDirectedCourse(
      courseWithQuizOptions(),
      mapWithOptions(),
      choices({ 1: ['bees', 'woods'] }),
    );

    expect(optionsOffered(course, 's-q2')).toEqual([
      'opt-bees-bee-site',
      'opt-bees-bee-dev',
      'opt-woods-wood-site',
      'opt-woods-wood-dev',
    ]);
  });

  /** Everything at depth 1 hangs off the root, which everybody can see. */
  it('leaves the first quiz alone, since every route into it starts at the root', () => {
    const { course } = projectDirectedCourse(
      courseWithQuizOptions(),
      mapWithOptions(),
      choices({}),
    );

    expect(optionsOffered(course, 's-q1')).toEqual([
      'opt-root-bees',
      'opt-root-drones',
      'opt-root-woods',
    ]);
  });

  /**
   * A snapshot published before edges carried their option id cannot be
   * narrowed. An over-broad question is what it used to get and is plainly
   * better than a blank one.
   */
  it('leaves an older snapshot’s quiz whole rather than emptying it', () => {
    const { course } = projectDirectedCourse(
      courseWithQuizOptions(),
      exampleMap(),
      choices({ 1: ['bees'] }),
    );

    expect(optionsOffered(course, 's-q2')).toHaveLength(4);
  });
});

describe('a layer quiz is only offered when the learner can actually reach that layer', () => {
  /*
    `drones` is a dead end: it holds content, sits at depth 1, and has no
    children. Somebody who picks only it has nothing at depth 2 to be asked
    about, so quiz 2 is a question with no answer that leads anywhere.
  */
  it('does not ask about depth 2 when the branch taken stops at depth 1', () => {
    const { course } = projectDirectedCourse(
      exampleCourse(),
      exampleMap(),
      choices({ 1: ['drones'] }),
    );

    expect(course.models.map((model) => model.title)).toEqual([
      'General content',
      'Directed learning quiz 1',
      'Drone mapping project',
    ]);
  });

  it('still asks about depth 2 when a branch taken does lead there', () => {
    const { course } = projectDirectedCourse(
      exampleCourse(),
      exampleMap(),
      choices({ 1: ['drones', 'bees'] }),
    );

    expect(course.models.map((model) => model.title)).toContain('Directed learning quiz 2');
  });

  /*
    The same failure one level down, which is how it was reported: a branch that
    ends at depth 2 while a different branch carries on to depth 3.
  */
  it('does not ask about a depth reached only by a branch that was refused', () => {
    const map = exampleMap();
    map.nodes.push({
      id: 'bee-deep',
      title: 'Advanced hives',
      x: 100,
      y: 300,
      depth: 3,
      isRoot: false,
      sectionIds: ['s-hive'],
    });
    map.edges.push({ parentId: 'bee-site', childId: 'bee-deep' });
    map.layers.push({ depth: 3, quizId: 'quiz-3', modelId: 'mod-q3', sectionId: 's-q3' });

    // Woodlands all the way down: depth 2 is reached, depth 3 is not.
    const { course } = projectDirectedCourse(
      { ...exampleCourse(), sections: [...exampleCourse().sections, section('s-q3')] },
      map,
      choices({ 1: ['woods'], 2: ['wood-site'] }),
    );

    const titles = course.models.map((model) => model.title);
    expect(titles).toContain('Directed learning quiz 2');
    expect(titles).not.toContain('Directed learning quiz 3');
  });

  /** And it is still asked of somebody whose branch does carry on that far. */
  it('asks about depth 3 for the branch that reaches it', () => {
    const map = exampleMap();
    map.nodes.push(
      {
        id: 'bee-deep',
        title: 'Advanced hives',
        x: 100,
        y: 300,
        depth: 3,
        isRoot: false,
        sectionIds: ['s-hive'],
      },
      {
        id: 'bee-queen',
        title: 'Queen rearing',
        x: 200,
        y: 300,
        depth: 3,
        isRoot: false,
        sectionIds: ['s-queen'],
      },
    );
    map.edges.push(
      { parentId: 'bee-site', childId: 'bee-deep' },
      { parentId: 'bee-site', childId: 'bee-queen' },
    );
    map.layers.push({ depth: 3, quizId: 'quiz-3', modelId: 'mod-q3', sectionId: 's-q3' });

    const { course } = projectDirectedCourse(
      {
        ...exampleCourse(),
        sections: [...exampleCourse().sections, section('s-q3'), section('s-queen')],
      },
      map,
      choices({ 1: ['bees'], 2: ['bee-site'] }),
    );

    expect(course.models.map((model) => model.title)).toContain('Directed learning quiz 3');
  });
});

/*
  Only a fork asks a question. A node with one child leads straight on to it, so
  a map that converges on a single node — or runs in a line — asks nothing there.
*/
describe('a node with only one child is followed without a quiz', () => {
  function lineMap(): SnapshotMap {
    return {
      nodes: [
        { id: 'root', title: 'General', x: 0, y: 0, depth: 0, isRoot: true, sectionIds: ['s-a'] },
        { id: 'next', title: 'Next', x: 100, y: 0, depth: 1, isRoot: false, sectionIds: ['s-b'] },
        { id: 'last', title: 'Last', x: 200, y: 0, depth: 2, isRoot: false, sectionIds: ['s-c'] },
      ],
      edges: [
        { parentId: 'root', childId: 'next' },
        { parentId: 'next', childId: 'last' },
      ],
      // A stale layer from before the rule: it must still not be asked.
      layers: [{ depth: 1, quizId: 'quiz-1', modelId: 'mod-q1', sectionId: 's-q1' }],
    };
  }

  const lineCourse = () => ({
    id: 'course-1',
    models: exampleCourse().models,
    sections: [section('s-a'), section('s-b'), section('s-c'), section('s-q1')],
  });

  it('serves the whole line to somebody who has answered nothing', () => {
    expect([...visibleNodeIds(lineMap(), choices({}))]).toEqual(['root', 'next', 'last']);
  });

  it('asks no quiz along the way', () => {
    const { course, locks } = projectDirectedCourse(lineCourse(), lineMap(), choices({}));

    expect(course.models.map((model) => model.title)).toEqual(['General', 'Next', 'Last']);
    expect(locks).toEqual([]);
  });

  it('follows the single child of a picked branch straight on', () => {
    const map = exampleMap();
    map.nodes.push({
      id: 'bee-deep',
      title: 'Advanced hives',
      x: 100,
      y: 300,
      depth: 3,
      isRoot: false,
      sectionIds: ['s-hive'],
    });
    map.edges.push({ parentId: 'bee-site', childId: 'bee-deep' });

    const { course } = projectDirectedCourse(
      exampleCourse(),
      map,
      choices({ 1: ['bees'], 2: ['bee-site'] }),
    );

    const titles = course.models.map((model) => model.title);
    expect(titles).toContain('Advanced hives');
    expect(titles).not.toContain('Directed learning quiz 3');
  });
});

/**
 * Two layers, on a directed course: what the learner is served is models and
 * the sections inside them, and a layer quiz is an ordinary QUIZ section that
 * happens to sit in a model the map generated.
 */
describe('the projection on a two-layer course', () => {
  /** The example course with each section saying what it holds. */
  function typedCourse() {
    const course = exampleCourse();
    return {
      ...course,
      sections: course.sections.map((entry) => ({
        ...entry,
        type: entry.id.startsWith('s-q') ? 'QUIZ' : 'TEXT',
      })),
    };
  }

  it('puts each layer quiz in its layer model, as a QUIZ section', () => {
    const { course } = projectDirectedCourse(typedCourse(), exampleMap(), choices({ 1: ['bees'] }));

    const layerSection = course.sections.find((entry) => entry.id === 's-q1')!;
    // The layer's own model — the id the map recorded for it — not the model
    // the section was authored in.
    expect(layerSection.modelId).toBe('mod-q1');
    expect(layerSection.type).toBe('QUIZ');
    expect(course.models.find((model) => model.id === 'mod-q1')?.title).toBe(
      'Directed learning quiz 1',
    );
  });

  it('keeps every section’s type and id through the rewrite', () => {
    const { course } = projectDirectedCourse(typedCourse(), exampleMap(), choices({ 1: ['bees'] }));

    expect(course.sections.find((entry) => entry.id === 's-general')?.type).toBe('TEXT');
    expect(course.sections.find((entry) => entry.id === 's-bees')?.type).toBe('TEXT');
    // Every section sits in a model the projection actually produced.
    const modelIds = new Set(course.models.map((model) => model.id));
    for (const entry of course.sections) expect(modelIds.has(String(entry.modelId))).toBe(true);
    // Nothing is called a module, and nothing carries elements.
    expect(course).not.toHaveProperty('modules');
    for (const entry of course.sections) expect(entry).not.toHaveProperty('elements');
  });

  /** A layer quiz waits on the sections above it — sections, not elements. */
  it('locks a layer quiz on the sections that come before it', () => {
    const { locks } = projectDirectedCourse(typedCourse(), exampleMap(), choices({}));

    expect(locks).toEqual([
      expect.objectContaining({ quizId: 'quiz-1', sectionId: 's-q1', requires: ['s-general'] }),
    ]);
  });
});
