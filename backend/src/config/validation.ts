/**
 * File: validation.ts
 * Description: Field-level input constraints — length, pattern and allowed values.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */

/**
 * Positive validation for user input (TTG Technology Standards §3.3.1).
 *
 * The standard asks for structured data to be "strongly typed and validated
 * against a defined schema, including allowed characters, length, and pattern".
 * The services already reject empty and malformed values well; what was missing
 * was any *upper* bound. A course title had no maximum, so a megabyte of text in
 * one field was a valid course — which is a storage problem, a rendering problem
 * and a denial-of-service problem at once.
 *
 * Limits are declared here rather than inline so that one table describes the
 * whole input surface, and so the API documentation can be generated from the
 * same numbers the code enforces.
 */
export const FIELD_LIMITS = {
  /** Titles and names shown in lists and rails. */
  title: 200,
  /** The one-line pitch under a course title. */
  shortDescription: 500,
  /** Long-form prose on a course page. */
  description: 5_000,
  /** One bullet in "What you'll learn" or prerequisites. */
  bullet: 300,
  /** A tag or a language name. */
  tag: 60,
  /** How many entries a tag/bullet list may hold. */
  listLength: 50,
  /** A learner's own note. */
  noteBody: 10_000,
  /** Rich text stored for one content element, after sanitisation. */
  richText: 100_000,
  /** A quiz question prompt. */
  prompt: 1_000,
  /** One answer option. */
  option: 500,
  /** A hint shown against a question. */
  hint: 1_000,
  /** An instructor biography. */
  bio: 2_000,
  /** An email address — RFC 5321 caps the whole address at 254. */
  email: 254,
  /** A URL for a linked image or video. */
  url: 2_048,
  /** An uploaded file's original name, kept only for display on PDFs. */
  fileName: 255,
} as const;

export type FieldName = keyof typeof FIELD_LIMITS;

/**
 * Trims a required string and enforces its length.
 *
 * `label` is what the person sees in the error, so it is written for them
 * ("course title") rather than for the schema ("title").
 */
export function requiredText(value: unknown, field: FieldName, label: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${label} is required`);
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} is required`);
  }

  return withinLimit(trimmed, field, label);
}

/**
 * The optional counterpart. An absent value stays absent; an empty string
 * becomes null, because "the author cleared this field" and "the author did not
 * mention this field" are different intents and the callers rely on the
 * difference.
 */
export function optionalText(
  value: unknown,
  field: FieldName,
  label: string,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;

  if (typeof value !== 'string') {
    throw new Error(`${label} must be text`);
  }

  const trimmed = value.trim();
  if (!trimmed) return null;

  return withinLimit(trimmed, field, label);
}

/** Enforces one length limit, with a message that says what the limit is. */
export function withinLimit(value: string, field: FieldName, label: string): string {
  const limit = FIELD_LIMITS[field];
  if (value.length > limit) {
    throw new Error(
      `${label} is too long — the limit is ${limit.toLocaleString()} characters ` +
        `and this is ${value.length.toLocaleString()}.`,
    );
  }
  return value;
}

/**
 * Cleans a list of short strings: trims, drops blanks, de-duplicates, and caps
 * both the number of entries and the length of each.
 *
 * Replaces the old `cleanList`, which did the first three but neither of the
 * last two — so a tag list could be arbitrarily long and each tag arbitrarily
 * large.
 */
export function cleanStringList(
  values: unknown,
  field: FieldName,
  label: string,
): string[] | undefined {
  if (values === undefined) return undefined;
  if (!Array.isArray(values)) throw new Error(`${label} must be a list`);

  if (values.length > FIELD_LIMITS.listLength) {
    throw new Error(`${label} may hold at most ${FIELD_LIMITS.listLength} entries`);
  }

  const cleaned = [
    ...new Set(
      values
        .map((entry) => String(entry).trim())
        .filter(Boolean)
        .map((entry) => withinLimit(entry, field, label)),
    ),
  ];

  return cleaned;
}

/**
 * A rough shape check for an email address, plus the RFC length cap.
 *
 * Deliberately not a full RFC 5322 parser: the real validation is that a
 * message reaches the address, and an over-strict pattern rejects valid
 * addresses far more often than it catches typos.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normaliseEmail(value: unknown, label = 'email'): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} is required`);
  }

  const email = value.trim().toLowerCase();
  withinLimit(email, 'email', label);

  if (!EMAIL_PATTERN.test(email)) {
    throw new Error(`"${email}" is not a valid email address`);
  }

  return email;
}

/**
 * Validates a link before it is stored.
 *
 * Only http and https survive. Anything else — `javascript:`, `data:`, `file:` —
 * is a way to get script or local content to run in a learner's browser when the
 * value is later rendered as a link or an image source (§3.3.2, §3.3.3).
 */
export function safeUrl(value: unknown, label: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;

  if (typeof value !== 'string') throw new Error(`${label} must be text`);

  const trimmed = value.trim();
  withinLimit(trimmed, 'url', label);

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`${label} is not a valid URL`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${label} must start with http:// or https://`);
  }

  return trimmed;
}

/** Bounds an integer, for values that come off a form as strings. */
export function boundedInteger(
  value: unknown,
  { min, max, label }: { min: number; max: number; label: string },
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    throw new Error(`${label} must be a whole number`);
  }
  if (parsed < min || parsed > max) {
    throw new Error(`${label} must be between ${min} and ${max}`);
  }
  return parsed;
}

/**
 * How long a learner gets once something is handed to them, in days.
 *
 * Optional in both directions, and the two absences mean different things —
 * `undefined` is "the author did not touch this field", `null` is "the author
 * cleared it, so there is no deadline" — which is the same contract
 * `optionalText` keeps and which every caller here spreads on.
 *
 * The ceiling is five years. There is no honest deadline past that, and an
 * unbounded number here would be stamped straight onto an assignment's due date
 * and overflow the column.
 */
export const MAX_DAYS_REMAINING = 1825;

export function parseDaysRemaining(value: unknown, label = 'days remaining') {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;

  return boundedInteger(value, { min: 1, max: MAX_DAYS_REMAINING, label });
}

/**
 * The deadline that follows from a length: today plus that many days.
 *
 * Kept here rather than at the two call sites so an assignment made from the
 * Access pane and one made from the admin dashboard land on the same date, and
 * so the editor can show the author what the date would be using the very same
 * arithmetic.
 */
export function dueDateFromDays(days: number | null | undefined, from = new Date()): Date | null {
  if (days === null || days === undefined) return null;
  return new Date(from.getTime() + days * 86_400_000);
}
