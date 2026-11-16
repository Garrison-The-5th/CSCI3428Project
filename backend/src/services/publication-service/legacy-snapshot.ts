/**
 * File: legacy-snapshot.ts
 * Description: Reads published versions stored in an older shape as the current one.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-11-13
 */
import { createHash } from 'crypto';

import type {
  CourseSnapshot,
  SnapshotQuiz,
  SnapshotSection,
} from '@/services/publication-service/publication-service';

/**
 * Published versions are stored as JSON and never rewritten.
 *
 * A snapshot is the one thing a learner part way through a course is reading,
 * and the archive's whole promise is that an old version stays exactly what was
 * published. So when the course structure changes, the tables are migrated and
 * the snapshots are left alone — and every stored shape that ever existed is
 * converted here, on the single path everything reads a snapshot through. The
 * next publish of a course writes the current shape and retires its old one.
 *
 * Three shapes have existed:
 *
 *   1. The first naming, where the outer container was called a section and the
 *      inner one a module.
 *   2. Three layers: `modules` → `sections` → `elements`, with a section's
 *      quizzes beside its elements in one shared `order`.
 *   3. Two layers, the current one: `models` → `sections`, where a section *is*
 *      one piece of content and says which with `type`.
 *
 * Pure, and free of database access on purpose: a snapshot has to be readable
 * from the snapshot alone.
 */

type Json = Record<string, unknown>;

/** The content fields that moved from an element onto its section. */
const CONTENT_FIELDS = [
  'videoUrl',
  'imageUrl',
  'imageData',
  'imageType',
  'fileName',
  'textContent',
  'canvasData',
  'durationMinutes',
] as const;

/**
 * The id of the section an element or quiz was given when it moved out of the
 * section it shared.
 *
 * Derived from the item's own id rather than minted, and derived the same way
 * the migration does it in SQL — `md5('<kind>:<id>')::uuid`. That agreement is
 * the whole point: a learner's progress was migrated onto these ids in the
 * database, and the version they are reading has to arrive at the same ids or
 * everything they had read would look unread.
 */
export function splitSectionId(kind: 'element' | 'quiz', itemId: string): string {
  const hex = createHash('md5').update(`${kind}:${itemId}`).digest('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

/**
 * Shape 1 → shape 2.
 *
 * Versions published under the first naming carry `sections` for what became a
 * module and `modules` for what became a section, with `sectionId`/`moduleId`
 * pointing the wrong way to match. The tell is unambiguous: only such a
 * snapshot has entries in `modules` that carry elements.
 */
function fromFirstNaming(snapshot: Json): Json {
  const outer = snapshot.modules as Json[] | undefined;
  const swapped = Array.isArray(outer) && outer.some((entry) => Array.isArray(entry?.elements));
  if (!swapped) return snapshot;

  const oldInner = snapshot.modules as Json[];
  const oldOuter = (snapshot.sections ?? []) as Json[];

  return {
    ...snapshot,
    // Neither existed before quiz sets did, and everything published then was a
    // lesson with untinted sections.
    kind: snapshot.kind ?? 'LESSON',
    modules: oldOuter.map((entry) => ({
      id: String(entry.id),
      courseId: String(entry.courseId),
      number: Number(entry.number),
      title: String(entry.title),
      color: (entry.color as string | null) ?? null,
    })),
    sections: oldInner.map((entry) => {
      const { sectionId, quizzes, ...rest } = entry;
      return {
        ...rest,
        moduleId: (sectionId as string | null) ?? null,
        color: (entry.color as string | null) ?? null,
        quizzes: ((quizzes ?? []) as Json[]).map((quiz) => {
          const { moduleId, hintModuleNumber, questions, ...quizRest } = quiz;
          void hintModuleNumber;
          return {
            ...quizRest,
            // Everything that predates the three kinds was an exam that showed
            // its result, which is what those defaults mean.
            type: quiz.type ?? 'EXAM',
            showResults: (quiz.showResults as boolean) ?? true,
            sectionId: (moduleId as string | null) ?? null,
            questions: ((questions ?? []) as Json[]).map((question) => {
              const { hintModuleNumber: hintNumber, ...questionRest } = question;
              return { ...questionRest, hintSectionNumber: (hintNumber as string | null) ?? null };
            }),
          };
        }),
      };
    }),
  };
}

/** One thing inside a three-layer section: an element or a quiz, in their shared order. */
type LegacyItem =
  { kind: 'element'; order: number; row: Json } | { kind: 'quiz'; order: number; row: Json };

/**
 * A three-layer section's items in reading order.
 *
 * By `order`, elements before quizzes on a tie, then by id compared byte for
 * byte — the same three keys, in the same order, as the migration's ORDER BY
 * (which sorts ids under the "C" collation for exactly this reason).
 */
function itemsOf(section: Json): LegacyItem[] {
  const items: LegacyItem[] = [
    ...((section.elements ?? []) as Json[]).map((row): LegacyItem => ({
      kind: 'element',
      order: Number(row.order ?? 0),
      row,
    })),
    ...((section.quizzes ?? []) as Json[]).map((row): LegacyItem => ({
      kind: 'quiz',
      order: Number(row.order ?? 0),
      row,
    })),
  ];

  const rank = (item: LegacyItem) => (item.kind === 'element' ? 0 : 1);
  return items.sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    const idA = String(a.row.id);
    const idB = String(b.row.id);
    return idA < idB ? -1 : idA > idB ? 1 : 0;
  });
}

/**
 * Shape 2 → shape 3: every element and every quiz becomes a section.
 *
 * The rules, which are the migration's:
 *
 *   - The first element keeps the section's id. A section with no elements
 *     hands its id to its first quiz instead — which is every section of a quiz
 *     set, and every generated layer-quiz section.
 *   - Everything else gets a section of its own, with the id `splitSectionId`
 *     derives, placed where it sat in the shared order.
 *   - New sections repeat the original's title (a quiz keeps its own name),
 *     model and colour. The time estimate stays whole on the original, so the
 *     course total is unchanged.
 *   - A section with nothing in it becomes an empty TEXT section.
 *
 * Numbers are rewritten model by model, since one "1.2" may now be three
 * sections, and anything that referred to a section by id or by number — the
 * course map, a question's hint — is carried across.
 */
function fromThreeLayers(snapshot: Json): CourseSnapshot {
  const { modules, sections: oldSections, map, ...course } = snapshot;
  const models = ((modules ?? []) as Json[]).map((entry) => ({
    id: String(entry.id),
    courseId: String(entry.courseId),
    number: Number(entry.number),
    title: String(entry.title),
    color: (entry.color as string | null) ?? null,
  }));
  const modelNumber = new Map(models.map((model) => [model.id, model.number]));

  /** Old section id → the ids it became, in order. */
  const became = new Map<string, string[]>();
  /** Old section number → the number its original section has now. */
  const renumbered = new Map<string, string>();
  /** Position reached so far in each model. */
  const reached = new Map<string, number>();

  const sections: SnapshotSection[] = [];

  for (const old of (oldSections ?? []) as Json[]) {
    const oldId = String(old.id);
    const modelId = (old.moduleId as string | null) ?? null;
    const items = itemsOf(old);
    const keeper = items.find((item) => item.kind === 'element') ?? items[0] ?? null;

    // The first digit: the model's own number where the model travels with the
    // snapshot, and otherwise whatever the section was already numbered under —
    // a section borrowed through a course map belongs to another course's model.
    const outer = (modelId && modelNumber.get(modelId)) ?? String(old.number ?? '1').split('.')[0];

    const place = () => {
      const key = modelId ?? `none:${outer}`;
      const position = (reached.get(key) ?? 0) + 1;
      reached.set(key, position);
      return { position, number: `${outer}.${position}` };
    };

    const heading = {
      courseId: String(old.courseId),
      modelId,
      color: (old.color as string | null) ?? null,
    };
    const noContent = Object.fromEntries(CONTENT_FIELDS.map((field) => [field, null]));

    if (!keeper) {
      const placed = place();
      sections.push({
        ...heading,
        ...noContent,
        ...placed,
        id: oldId,
        title: String(old.title),
        estimatedMinutes: Number(old.estimatedMinutes ?? 0),
        type: 'TEXT',
        textContent: '',
        quizzes: [],
      } as unknown as SnapshotSection);
      became.set(oldId, [oldId]);
      renumbered.set(String(old.number), placed.number);
      continue;
    }

    const ids: string[] = [];
    for (const item of items) {
      const isKeeper = item === keeper;
      const id = isKeeper ? oldId : splitSectionId(item.kind, String(item.row.id));
      const placed = place();
      ids.push(id);
      if (isKeeper) renumbered.set(String(old.number), placed.number);

      const own = {
        ...heading,
        ...placed,
        id,
        estimatedMinutes: isKeeper ? Number(old.estimatedMinutes ?? 0) : 0,
      };

      if (item.kind === 'element') {
        sections.push({
          ...own,
          ...noContent,
          ...Object.fromEntries(CONTENT_FIELDS.map((field) => [field, item.row[field] ?? null])),
          title: String(old.title),
          type: String(item.row.type),
          quizzes: [],
        } as unknown as SnapshotSection);
      } else {
        const quizTitle = String(item.row.title ?? '').trim();
        sections.push({
          ...own,
          ...noContent,
          title: isKeeper ? String(old.title) : quizTitle || String(old.title),
          type: 'QUIZ',
          quizzes: [{ ...(item.row as unknown as SnapshotQuiz), sectionId: id, order: 0 }],
        } as unknown as SnapshotSection);
      }
    }
    became.set(oldId, ids);
  }

  // A hint points back at a section by its number, and the numbers just moved.
  for (const section of sections) {
    for (const quiz of section.quizzes) {
      quiz.questions = (quiz.questions ?? []).map((question) => {
        const moved = question.hintSectionNumber && renumbered.get(question.hintSectionNumber);
        return moved ? { ...question, hintSectionNumber: moved } : question;
      });
    }
  }

  const oldMap = map as Json | null | undefined;
  const nextMap = oldMap
    ? {
        ...oldMap,
        // A placed section takes the sections it became with it, in order, so
        // a learner's branch still holds everything it held.
        nodes: ((oldMap.nodes ?? []) as Json[]).map((node) => ({
          ...node,
          sectionIds: ((node.sectionIds ?? []) as string[]).flatMap((id) => became.get(id) ?? [id]),
        })),
        layers: ((oldMap.layers ?? []) as Json[]).map((layer) => {
          const { moduleId, ...rest } = layer;
          return { ...rest, modelId: moduleId };
        }),
      }
    : oldMap;

  return {
    ...course,
    ...(map !== undefined ? { map: nextMap } : {}),
    models,
    sections,
  } as unknown as CourseSnapshot;
}

/**
 * Whatever shape a stored snapshot is in, read as the current one.
 *
 * A snapshot already in the current shape is handed straight back — it carries
 * `models`, which no older shape does.
 */
export function upgradeSnapshot(stored: unknown): CourseSnapshot | null {
  if (!stored || typeof stored !== 'object') return null;

  const snapshot = stored as Json;
  if (Array.isArray(snapshot.models)) return snapshot as unknown as CourseSnapshot;

  return fromThreeLayers(fromFirstNaming(snapshot));
}
