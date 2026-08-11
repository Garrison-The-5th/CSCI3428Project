/**
 * File: rich-text.test.ts
 * Description: Unit tests for author HTML sanitisation.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
import { looksLikeHtml, sanitizeRichText } from '@/config/rich-text';

/**
 * Lesson text is written by one person and rendered into every learner's
 * browser with `dangerouslySetInnerHTML`. That is only safe because of this
 * function, so these tests are the thing standing between an author account and
 * stored XSS across the whole platform (§3.3.2).
 */
describe('sanitizeRichText — dangerous content', () => {
  it.each([
    ['script tag', '<p>Hello</p><script>alert(1)</script>'],
    ['iframe', '<iframe src="https://evil.example"></iframe>'],
    ['object', '<object data="evil.swf"></object>'],
    ['embed', '<embed src="evil.swf">'],
    ['form', '<form action="https://evil.example"><input name="a"></form>'],
    ['style tag', '<style>body{display:none}</style>'],
    ['svg', '<svg onload="alert(1)"><circle r="1"/></svg>'],
    ['meta refresh', '<meta http-equiv="refresh" content="0;url=https://evil.example">'],
  ])('strips %s', (_label, input) => {
    const output = sanitizeRichText(input);
    expect(output).not.toMatch(/<script|<iframe|<object|<embed|<form|<style|<svg|<meta/i);
    expect(output.toLowerCase()).not.toContain('alert(1)');
  });

  it.each([
    ['onclick', '<p onclick="alert(1)">Click</p>'],
    ['onerror', '<p onerror="alert(1)">x</p>'],
    ['onmouseover', '<p onmouseover="alert(1)">x</p>'],
    ['onload', '<p onload="alert(1)">x</p>'],
  ])('strips the %s event handler', (_label, input) => {
    const output = sanitizeRichText(input);
    expect(output).not.toMatch(/on\w+\s*=/i);
  });

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
  ])('drops the link when href is %s', (href) => {
    const output = sanitizeRichText(`<a href="${href}">click</a>`);
    expect(output).not.toMatch(/javascript:|vbscript:|data:text\/html/i);
  });

  it('does not let a style attribute smuggle anything past the property allowlist', () => {
    const output = sanitizeRichText(
      '<p style="font-size:16px; behavior:url(evil.htc); expression:alert(1); ' +
        'background:url(https://evil.example/track.gif)">text</p>',
    );
    expect(output).toContain('font-size');
    expect(output).not.toMatch(/behavior|expression|background/i);
  });
});

describe('sanitizeRichText — legitimate author content survives', () => {
  it.each([
    ['bold', '<strong>bold</strong>'],
    ['italic', '<em>italic</em>'],
    ['underline', '<u>underlined</u>'],
    ['heading', '<h2>Heading</h2>'],
    ['unordered list', '<ul><li>one</li></ul>'],
    ['ordered list', '<ol><li>one</li></ol>'],
    ['blockquote', '<blockquote>quoted</blockquote>'],
    [
      'table',
      '<table><thead><tr><th>H</th></tr></thead><tbody><tr><td>C</td></tr></tbody></table>',
    ],
  ])('keeps %s', (_label, input) => {
    expect(sanitizeRichText(input)).toBe(input);
  });

  it('keeps the inline styles the toolbar writes', () => {
    const output = sanitizeRichText(
      '<p style="text-align:center;font-size:1.25rem;font-family:Georgia, serif">x</p>',
    );
    expect(output).toContain('text-align:center');
    expect(output).toContain('font-size:1.25rem');
  });

  /**
   * Alignment lands on whichever block the caret is in, so every block tag has
   * to be able to carry a style attribute — otherwise centring a heading or a
   * list item is silently dropped on save.
   */
  it.each(['h1', 'h2', 'h3', 'h4', 'blockquote', 'ul', 'ol', 'li', 'div', 'p'])(
    'allows a style attribute on <%s>',
    (tag) => {
      const output = sanitizeRichText(`<${tag} style="text-align:center">x</${tag}>`);
      expect(output).toContain('text-align:center');
    },
  );

  it('keeps http, https and mailto links', () => {
    for (const href of ['https://example.com', 'http://example.com', 'mailto:a@example.com']) {
      expect(sanitizeRichText(`<a href="${href}">link</a>`)).toContain(href);
    }
  });

  /** Anything opened in a new tab must not be able to reach back at us. */
  it('forces rel="noopener noreferrer" and target="_blank" on links', () => {
    const output = sanitizeRichText('<a href="https://example.com">link</a>');
    expect(output).toContain('rel="noopener noreferrer"');
    expect(output).toContain('target="_blank"');
  });

  it('handles empty input without throwing', () => {
    expect(sanitizeRichText('')).toBe('');
  });
});

describe('looksLikeHtml', () => {
  it.each(['<p>hi</p>', '<br>', '<strong>x</strong>'])('detects markup in %s', (value) => {
    expect(looksLikeHtml(value)).toBe(true);
  });

  it.each(['plain text', 'a < b and c > d', ''])('reports %p as plain', (value) => {
    expect(looksLikeHtml(value)).toBe(false);
  });
});
