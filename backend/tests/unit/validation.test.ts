/**
 * File: validation.test.ts
 * Description: Unit tests for input validation — length bounds, email
 *   normalisation and URL scheme restriction.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
import {
  boundedInteger,
  cleanStringList,
  dueDateFromDays,
  endOfDueDay,
  FIELD_LIMITS,
  isLockedOut,
  isPastDue,
  normaliseEmail,
  optionalText,
  requiredText,
  safeUrl,
  withinLimit,
} from '@/config/validation';

describe('requiredText', () => {
  it('trims and returns a valid value', () => {
    expect(requiredText('  Fire safety  ', 'title', 'title')).toBe('Fire safety');
  });

  it.each([undefined, null, '', '   ', 42, {}])('rejects %p', (value) => {
    expect(() => requiredText(value, 'title', 'course title')).toThrow(/course title is required/);
  });

  it('rejects a value over the limit and says what the limit is', () => {
    const tooLong = 'x'.repeat(FIELD_LIMITS.title + 1);
    expect(() => requiredText(tooLong, 'title', 'course title')).toThrow(/too long/);
    expect(() => requiredText(tooLong, 'title', 'course title')).toThrow(
      new RegExp(String(FIELD_LIMITS.title)),
    );
  });

  it('accepts a value exactly at the limit', () => {
    const exact = 'x'.repeat(FIELD_LIMITS.title);
    expect(requiredText(exact, 'title', 'title')).toHaveLength(FIELD_LIMITS.title);
  });
});

describe('optionalText', () => {
  /**
   * The undefined/null distinction is load-bearing: callers spread the result
   * conditionally, so "not mentioned" must not be confused with "cleared".
   */
  it('passes undefined through so an absent field is not written', () => {
    expect(optionalText(undefined, 'description', 'description')).toBeUndefined();
  });

  it('turns an empty string into null so a cleared field is written as null', () => {
    expect(optionalText('   ', 'description', 'description')).toBeNull();
    expect(optionalText(null, 'description', 'description')).toBeNull();
  });

  it('enforces the limit', () => {
    expect(() =>
      optionalText('x'.repeat(FIELD_LIMITS.description + 1), 'description', 'description'),
    ).toThrow(/too long/);
  });
});

describe('cleanStringList', () => {
  it('trims, drops blanks and de-duplicates', () => {
    expect(cleanStringList([' safety ', 'safety', '', '  ', 'compliance'], 'tag', 'tags')).toEqual([
      'safety',
      'compliance',
    ]);
  });

  it('rejects a list longer than the cap', () => {
    const many = Array.from({ length: FIELD_LIMITS.listLength + 1 }, (_, i) => `tag-${i}`);
    expect(() => cleanStringList(many, 'tag', 'tags')).toThrow(/at most/);
  });

  it('rejects an entry longer than the per-entry cap', () => {
    expect(() => cleanStringList(['x'.repeat(FIELD_LIMITS.tag + 1)], 'tag', 'tags')).toThrow(
      /too long/,
    );
  });

  it('rejects a non-list', () => {
    expect(() => cleanStringList('safety', 'tag', 'tags')).toThrow(/must be a list/);
  });

  it('passes undefined through', () => {
    expect(cleanStringList(undefined, 'tag', 'tags')).toBeUndefined();
  });
});

describe('normaliseEmail', () => {
  it('lowercases and trims', () => {
    expect(normaliseEmail('  Ada@Example.COM ')).toBe('ada@example.com');
  });

  it.each(['not-an-email', 'missing@domain', '@example.com', 'spaces in@example.com'])(
    'rejects %s',
    (value) => {
      expect(() => normaliseEmail(value)).toThrow(/not a valid email/);
    },
  );

  it('rejects an address past the RFC length cap', () => {
    const local = 'a'.repeat(FIELD_LIMITS.email);
    expect(() => normaliseEmail(`${local}@example.com`)).toThrow(/too long/);
  });
});

describe('safeUrl', () => {
  it.each(['https://example.com/video', 'http://example.com/a.png'])('allows %s', (url) => {
    expect(safeUrl(url, 'link')).toBe(url);
  });

  /**
   * The whole point of this function. Each of these would execute or exfiltrate
   * when the value is later rendered as a link or an image source.
   */
  it.each([
    'javascript:alert(1)',
    'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
    'file:///etc/passwd',
    'vbscript:msgbox(1)',
  ])('rejects the dangerous scheme in %s', (url) => {
    expect(() => safeUrl(url, 'link')).toThrow(/must start with http/);
  });

  it('rejects something that is not a URL at all', () => {
    expect(() => safeUrl('just some text', 'link')).toThrow(/not a valid URL/);
  });

  it('treats empty as cleared and undefined as absent', () => {
    expect(safeUrl('', 'link')).toBeNull();
    expect(safeUrl(undefined, 'link')).toBeUndefined();
  });
});

describe('boundedInteger', () => {
  it('accepts a value in range, including string input from a form', () => {
    expect(boundedInteger('30', { min: 1, max: 100, label: 'minutes' })).toBe(30);
  });

  it.each([0, 101, -5])('rejects %p as out of range', (value) => {
    expect(() => boundedInteger(value, { min: 1, max: 100, label: 'minutes' })).toThrow(
      /between 1 and 100/,
    );
  });

  it.each(['abc', 1.5, NaN, Infinity])('rejects %p as not a whole number', (value) => {
    expect(() => boundedInteger(value, { min: 1, max: 100, label: 'minutes' })).toThrow(
      /whole number/,
    );
  });
});

describe('withinLimit', () => {
  it('returns the value unchanged when it fits', () => {
    expect(withinLimit('short', 'title', 'title')).toBe('short');
  });
});

/**
 * Turning "they get three days" into a date: today's date plus the days, at
 * 11:59 PM.
 *
 * A deadline is a day on a calendar, so the clock time something was handed over
 * at decides nothing about which day it lands on — and the day it lands on runs
 * to 11:59 PM, so a length is a count of whole days rather than of hours.
 */
describe('dueDateFromDays', () => {
  const morning = new Date('2026-03-10T09:00:00');
  const evening = new Date('2026-03-10T16:00:00');

  it('adds the days to today', () => {
    const due = dueDateFromDays(2, morning)!;
    expect([due.getFullYear(), due.getMonth(), due.getDate()]).toEqual([2026, 2, 12]);
  });

  /** The hour it was set at must not move the date it lands on. */
  it('lands on the same day whatever time of day it was set', () => {
    expect(dueDateFromDays(2, evening)!.getDate()).toBe(12);
    expect(dueDateFromDays(2, new Date('2026-03-10T23:30:00'))!.getDate()).toBe(12);
  });

  it('lands at 11:59 PM whatever time of day it was set', () => {
    for (const due of [dueDateFromDays(1, morning)!, dueDateFromDays(1, evening)!]) {
      expect([due.getHours(), due.getMinutes(), due.getSeconds()]).toEqual([23, 59, 0]);
    }
  });

  /** Adding days rather than milliseconds, so month ends carry properly. */
  it('rolls over the end of a month', () => {
    const due = dueDateFromDays(3, new Date('2026-01-30T09:00:00'))!;
    expect([due.getMonth(), due.getDate()]).toEqual([1, 2]);
  });

  it.each([null, undefined])('gives no deadline for %p days', (days) => {
    expect(dueDateFromDays(days)).toBeNull();
  });
});

describe('endOfDueDay', () => {
  /** Dates set before this rule existed sit at midnight; they mean 11:59 PM. */
  it('moves a midnight deadline to the end of its day', () => {
    const settled = endOfDueDay(new Date('2026-03-10T00:00:00'))!;
    expect([settled.getDate(), settled.getHours(), settled.getMinutes()]).toEqual([10, 23, 59]);
  });

  it('leaves a deadline that is already at 11:59 PM alone', () => {
    const already = new Date('2026-03-10T23:59:00');
    expect(endOfDueDay(already)!.getTime()).toBe(already.getTime());
  });

  it('passes null through', () => {
    expect(endOfDueDay(null)).toBeNull();
  });
});

describe('isPastDue', () => {
  const due = new Date('2026-03-10T00:00:00');

  /** The whole of the due day is still theirs — that is what 11:59 PM means. */
  it('is not past due during the day it falls on', () => {
    expect(isPastDue(due, new Date('2026-03-10T23:58:00'))).toBe(false);
  });

  it('is past due once that day is over', () => {
    expect(isPastDue(due, new Date('2026-03-11T00:00:00'))).toBe(true);
  });

  it('is never past due with no deadline', () => {
    expect(isPastDue(null, new Date('2099-01-01T00:00:00'))).toBe(false);
  });
});

/**
 * Being past a deadline and being shut out by one are two different facts.
 *
 * Only the author decides the second. A course reports itself overdue either
 * way — that is `isPastDue`, and the learner still sees the date and the red
 * text — but whether the way in closes is a choice per course.
 */
describe('isLockedOut', () => {
  const gone = new Date('2026-03-10T00:00:00');
  const after = new Date('2026-03-11T00:00:00');

  it('locks a passed deadline when the course says to', () => {
    expect(isLockedOut(gone, true, after)).toBe(true);
  });

  it('leaves a passed deadline open when the course says not to', () => {
    expect(isLockedOut(gone, false, after)).toBe(false);
    // Still overdue, which is what the learner is told either way.
    expect(isPastDue(gone, after)).toBe(true);
  });

  /**
   * Null on a course predating the column, and on anything reached without a
   * course behind it. Locking is what a deadline meant then, so that is the
   * answer where nobody has said otherwise.
   */
  it.each([null, undefined])('locks when the choice is %p', (choice) => {
    expect(isLockedOut(gone, choice, after)).toBe(true);
  });

  it('never locks before the deadline, whatever the setting', () => {
    const during = new Date('2026-03-10T23:58:00');
    expect(isLockedOut(gone, true, during)).toBe(false);
    expect(isLockedOut(gone, false, during)).toBe(false);
  });

  it('never locks with no deadline at all', () => {
    expect(isLockedOut(null, true, after)).toBe(false);
  });
});
