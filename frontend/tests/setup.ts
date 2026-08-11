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

// sessionStorage is where the guest token lives; jsdom provides it, but tests
// must not leak a session between files.
afterEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});
