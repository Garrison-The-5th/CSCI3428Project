/**
 * File: setup.ts
 * Description: Test environment for the frontend — jest-dom matchers and stubs
 *   for the browser APIs jsdom does not implement.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
import '@testing-library/jest-dom';

/**
 * `import.meta.env` only exists inside a Vite build. Anything importing
 * `utils/logger` or `utils/utils` reads it, so it is defined here rather than
 * mocked per test file.
 */
(globalThis as unknown as { importMetaEnv: Record<string, unknown> }).importMetaEnv = {
  DEV: false,
  PROD: true,
  MODE: 'test',
};

// jsdom implements neither of these, and the course player and timer both use
// them. Without stubs the components throw on mount rather than rendering.
if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }),
  });
}

if (!window.HTMLElement.prototype.scrollIntoView) {
  window.HTMLElement.prototype.scrollIntoView = jest.fn();
}

// The zoomable image and the draggable quiz timer both capture the pointer.
// jsdom implements no scrolling at all, and the zoomable image recentres
// itself by calling scrollTo when it returns to 1x.
if (!window.HTMLElement.prototype.scrollTo) {
  window.HTMLElement.prototype.scrollTo = jest.fn();
}

if (!window.HTMLElement.prototype.setPointerCapture) {
  window.HTMLElement.prototype.setPointerCapture = jest.fn();
  window.HTMLElement.prototype.releasePointerCapture = jest.fn();
}

/**
 * jsdom implements no `PointerEvent` whatsoever.
 *
 * Testing Library checks for the constructor and, not finding it, falls back to
 * a plain `Event` — which carries no coordinates, so `clientX` and `clientY`
 * arrive as null and anything working in pixels quietly computes NaN. Extending
 * `MouseEvent` is enough: it already carries the coordinates, and the pointer
 * fields below are the ones our handlers actually read.
 */
if (!window.PointerEvent) {
  class PointerEventPolyfill extends MouseEvent {
    readonly pointerId: number;
    readonly pointerType: string;
    readonly isPrimary: boolean;

    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 0;
      this.pointerType = params.pointerType ?? 'mouse';
      this.isPrimary = params.isPrimary ?? true;
    }
  }

  window.PointerEvent = PointerEventPolyfill as unknown as typeof PointerEvent;
}

// sessionStorage is where the guest token lives; jsdom provides it, but tests
// must not leak a session between files.
afterEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});
