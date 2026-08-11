/**
 * File: playwright.config.ts
 * Description: End-to-end test configuration — starts the API and the built
 *   frontend, then drives them through a real browser.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
import { defineConfig, devices } from '@playwright/test';

/**
 * §5.1.1 requires E2E tests that "validate real user flows" and "simulate
 * actual application behavior", covering authentication flows, critical
 * workflows, data submission paths and failure states.
 *
 * Both servers are started by Playwright rather than assumed to be running, so
 * `npm run test:e2e` works from a clean checkout and in CI without a separate
 * orchestration step.
 */
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:4173';
const API_URL = process.env.E2E_API_URL ?? 'http://localhost:5002';

export default defineConfig({
  testDir: './e2e',
  // Generous: the first run boots two servers and applies migrations.
  timeout: 45_000,
  expect: { timeout: 10_000 },

  // A flaky E2E suite is worse than none, so CI never retries into a green.
  // One retry absorbs genuine start-up races; a second would hide real flake.
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  forbidOnly: Boolean(process.env.CI),

  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : [['list']],

  use: {
    baseURL: BASE_URL,
    // Artefacts only for failures — a passing run should leave nothing behind.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: [
    {
      // The API, run from source so a failure points at a line rather than a
      // bundle.
      command: 'npm run dev --prefix ../backend',
      url: `${API_URL}/table-members/`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        NODE_ENV: 'test',
        LOG_LEVEL: 'silent',
      },
    },
    {
      // The production build, not the dev server: E2E should exercise what
      // actually ships, including the bundling and code splitting.
      command: 'npm run build && npm run preview -- --port 4173 --strictPort',
      url: BASE_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
