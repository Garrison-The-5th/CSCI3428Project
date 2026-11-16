/**
 * File: model-colors.ts
 * Description: The closed palette of model tints an author may choose from.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
/**
 * The tints an author may put on a model.
 *
 * A fixed list rather than a free colour picker, and deliberately pale: the tint
 * sits behind section titles, so anything saturated would fight the text it is
 * meant to be grouping. Keeping it closed also means the palette can be restyled
 * later — for a dark theme, say — without hunting down whatever hex codes
 * happened to be typed into the database.
 *
 * Kept in step with frontend/src/services/curriculumApi.ts (MODEL_COLORS).
 */
export const MODEL_COLORS = [
  '#cfe0f5', // blue
  '#d3ecd4', // green
  '#fbe3c8', // amber
  '#f7d4d6', // rose
  '#e2d7f2', // violet
  '#cfeaea', // teal
  '#efe4cd', // sand
  '#e0e2e6', // slate
] as const;

export type ModelColor = (typeof MODEL_COLORS)[number];

/**
 * Normalises a submitted colour. Empty or null clears the tint; anything outside
 * the palette is refused rather than stored, so a model can only ever hold a
 * colour the UI knows how to render.
 */
export function parseModelColor(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;

  const candidate = String(value).trim().toLowerCase();
  if (!(MODEL_COLORS as readonly string[]).includes(candidate)) {
    throw new Error('that is not one of the model colours');
  }

  return candidate;
}
