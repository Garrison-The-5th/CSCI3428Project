/**
 * File: vite.config.ts
 * Description: Vite build configuration — path alias and the NODE_ENV define
 *   the browser logger depends on.
 * Author: TTG Full-Stack Web Boilerplate
 * Modified by: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Date: 2026-08-10
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

import kcConfig from '../config/keycloak.json';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** The origin of a URL, or nothing when it is not one. */
function originOf(url: string | undefined): string | null {
  try {
    return url ? new URL(url).origin : null;
  } catch {
    return null;
  }
}

/**
 * The page's Content Security Policy, written into index.html at build time.
 *
 * It belongs to the pages rather than to the API: the backend already sends
 * one, but only on its JSON replies, which a browser never renders. Built here
 * because what it allows depends on this build — the Keycloak server named in
 * config/keycloak.json — and nginx serves the files as they are.
 *
 * - script-src 'self': only the bundle runs. A tag that got past the server's
 *   HTML sanitiser still could not execute.
 * - style-src 'unsafe-inline': React style props, Emotion and the charts all
 *   write inline styles. Styles cannot run code.
 * - img-src https:: authors may link an image by URL. Narrow this to named
 *   hosts if that feature is not needed.
 * - object-src data: blob:: PDFs are shown from a data: URL.
 * - frame-src: the YouTube embed, and Keycloak.
 * - localhost:5002 is the API when the app is served on localhost (see
 *   utils/utils.ts); deployed, it is same-origin under /api.
 *
 * frame-ancestors cannot be set from a meta tag, so nginx sends that one.
 */
function contentSecurityPolicy(): Plugin {
  const keycloak = originOf(kcConfig['auth-server-url']) ?? '';
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src 'self' http://localhost:5002 ${keycloak}`,
    `frame-src https://www.youtube.com https://www.youtube-nocookie.com ${keycloak}`,
    "object-src 'self' data: blob:",
    "media-src 'self' data: blob:",
    "base-uri 'self'",
    `form-action 'self' ${keycloak}`,
  ]
    .map((directive) => directive.trim())
    .join('; ');

  return {
    name: 'content-security-policy',
    // Build only: the dev server injects its own inline scripts for hot reload.
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<head>',
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`,
      );
    },
  };
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), contentSecurityPolicy()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  /**
   * `process` does not exist in a browser, so every reference to it has to be
   * gone by the time the bundle runs. Declaring the replacement here rather
   * than relying on Vite's built-in shimming makes that explicit and
   * version-proof: `utils/logger.ts` reads `process.env.NODE_ENV` to decide
   * whether to emit debug output, and if the replacement ever stopped happening
   * the app would throw `ReferenceError: process is not defined` on load rather
   * than fail quietly.
   *
   * Keyed off Vite's own `mode`, so `vite build` yields 'production' and the
   * dev server yields 'development'.
   */
  define: {
    'process.env.NODE_ENV': JSON.stringify(mode === 'production' ? 'production' : 'development'),
  },
}));
