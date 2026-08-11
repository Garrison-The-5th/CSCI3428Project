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
  FIELD_LIMITS,
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
