/**
 * File: rich-text.ts
 * Description: Sanitises author-written HTML before it is stored.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
import sanitizeHtml from 'sanitize-html';

/**
 * Cleans author-written rich text before it is stored.
 *
 * Lesson text is written by one person and rendered into every learner's browser,
 * so it is untrusted input no matter who typed it. Sanitising on write means the
 * database only ever holds safe markup and no render path can forget to escape.
 *
 * The allowlist covers what the editor toolbar can produce and nothing else:
 * no <script>, no <iframe>, no event handlers, no javascript: URLs.
 */
const ALLOWED_TAGS = [
  'p',
  'br',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'h1',
  'h2',
  'h3',
  'h4',
  'ul',
  'ol',
  'li',
  'blockquote',
  'code',
  'pre',
  'a',
  'span',
  'div',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
];

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const RGB_COLOR = /^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/i;

export function sanitizeRichText(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      a: ['href', 'target', 'rel'],
      // The toolbar writes font size, family and alignment as inline styles.
      // Alignment lands on whichever block the caret is in, so every block tag the
      // allowlist permits has to be able to carry a style attribute — otherwise
      // centring a heading or a list item is silently dropped on save.
      ...Object.fromEntries(
        ['span', 'div', 'p', 'h1', 'h2', 'h3', 'h4', 'blockquote', 'ul', 'ol', 'li'].map((tag) => [
          tag,
          ['style'],
        ]),
      ),
      td: ['colspan', 'rowspan', 'style'],
      th: ['colspan', 'rowspan', 'style'],
    },
    // Only these style properties survive, so style="" cannot smuggle anything.
    // Colours are hex or rgb() only — no url(), no expression(), no keywords
    // beyond `transparent`, which is how a table's lines are hidden.
    allowedStyles: {
      '*': {
        'font-size': [/^\d+(?:\.\d+)?(?:px|pt|em|rem|%)$/],
        color: [HEX_COLOR, RGB_COLOR],
        'background-color': [HEX_COLOR, RGB_COLOR],
        'border-color': [HEX_COLOR, RGB_COLOR, /^transparent$/],
        'font-family': [/^[\w\s,'"-]+$/],
        'font-weight': [/^(?:bold|normal|[1-9]00)$/],
        'font-style': [/^(?:italic|normal)$/],
        'text-align': [/^(?:left|right|center|justify)$/],
        'text-decoration': [/^(?:underline|line-through|none)$/],
      },
      // Columns and rows the author has dragged to a size.
      ...Object.fromEntries(
        ['td', 'th'].map((tag) => [tag, { width: [/^\d{1,4}px$/], height: [/^\d{1,4}px$/] }]),
      ),
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    // Anything opened in a new tab must not be able to reach back at us.
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer', target: '_blank' }),
    },
  });
}

/** True when the string carries markup rather than being plain typed text. */
export function looksLikeHtml(value: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(value);
}
