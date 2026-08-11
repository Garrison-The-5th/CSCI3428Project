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
import { defineConfig } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
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
