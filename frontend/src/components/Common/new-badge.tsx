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
 * The rule matters more than the pill. A newly published section arrives with
 * every module and every element inside it also new, so tagging each one would
 * put New on twenty lines to say one thing. Instead the tag goes at the highest
 * level that is new and stops there:
 *
 *   whole section new  -> tag the section heading only
 *   module new         -> tag the module only
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
  section: (sectionId: string) => boolean;
  module: (moduleId: string, sectionId: string | null) => boolean;
  item: (itemId: string, moduleId: string, sectionId: string | null) => boolean;
  /** True when anything at all is new, for a page-level notice. */
  any: boolean;
}

export function newMarkers(ids: NewIds | null | undefined): NewMarkers {
  const sections = new Set(ids?.newSectionIds ?? []);
  const modules = new Set(ids?.newModuleIds ?? []);
  const items = new Set([...(ids?.newElementIds ?? []), ...(ids?.newQuizIds ?? [])]);

  const sectionIsNew = (sectionId: string | null) => sectionId !== null && sections.has(sectionId);

  return {
    section: (sectionId) => sections.has(sectionId),
    // Suppressed when the whole section is new — the heading already says so.
    module: (moduleId, sectionId) => !sectionIsNew(sectionId) && modules.has(moduleId),
    // Suppressed when the module or section above it is new, for the same reason.
    item: (itemId, moduleId, sectionId) =>
      !sectionIsNew(sectionId) && !modules.has(moduleId) && items.has(itemId),
    any: sections.size + modules.size + items.size > 0,
  };
}

export default NewBadge;
