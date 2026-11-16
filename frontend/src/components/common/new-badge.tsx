/**
 * File: new-badge.tsx
 * Description: The "New" marker, and the rule for where it is allowed to appear.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
/**
 * The "New" marker, and the rule for where it is allowed to appear.
 *
 * The rule matters more than the pill. A newly published model arrives with
 * every section and every element inside it also new, so tagging each one would
 * put New on twenty lines to say one thing. Instead the tag goes at the highest
 * level that is new and stops there:
 *
 *   whole model new  -> tag the model heading only
 *   section new         -> tag the section only
 *   only content new   -> tag those elements and quizzes
 *
 * Both readers of this use the same rule from the same place: the learner's
 * course content rail, where New means "arrived in the version you are reading",
 * and the editor, where it means "not published yet".
 */
import type { NewIds } from '@/services/curriculum-api';

/** The pill itself. */
export const NewBadge = ({ label = 'New' }: { label?: string }) => (
  <span
    className="shrink-0 rounded-full bg-new px-2 py-0.5 text-[0.625rem] font-bold uppercase
      leading-4 tracking-wide text-white"
    title="Added since you last worked through this course"
  >
    {label}
  </span>
);

/**
 * Answers "should this carry a New tag" for each level, with the roll-up rule
 * already applied.
 *
 * Built once per render from the id sets rather than asked per row, so the
 * suppression logic cannot drift between the three places that ask.
 */
export interface NewMarkers {
  model: (modelId: string) => boolean;
  section: (sectionId: string, modelId: string | null) => boolean;
  item: (itemId: string, sectionId: string, modelId: string | null) => boolean;
  /** True when anything at all is new, for a page-level notice. */
  any: boolean;
}

/**
 * Turns the server's "new since you started" ids into lookups for the rail. An item or section
 * inside a wholly new model is not marked again — the model heading already says so.
 */
export function newMarkers(ids: NewIds | null | undefined): NewMarkers {
  const models = new Set(ids?.newModelIds ?? []);
  const sections = new Set(ids?.newSectionIds ?? []);
  // The only thing inside a section that can be new on its own is its quiz.
  const items = new Set(ids?.newQuizIds ?? []);

  /** Whether the given model is itself new. */
  const modelIsNew = (modelId: string | null) => modelId !== null && models.has(modelId);

  return {
    model: (modelId) => models.has(modelId),
    // Suppressed when the whole model is new — the heading already says so.
    section: (sectionId, modelId) => !modelIsNew(modelId) && sections.has(sectionId),
    // Suppressed when the section or model above it is new, for the same reason.
    item: (itemId, sectionId, modelId) =>
      !modelIsNew(modelId) && !sections.has(sectionId) && items.has(itemId),
    any: models.size + sections.size + items.size > 0,
  };
}

export default NewBadge;
