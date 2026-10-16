/**
 * File: jest.config.ts
 * Description: Jest configuration for the frontend — jsdom, the `@/` alias and
 *   asset stubs so component tests run without Vite.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
import type { Config } from 'jest';

/**
 * §5.2 names Jest for unit testing and React Testing Library for component
 * behaviour. Jest does not understand Vite, so three things are bridged here:
 * the `@/` alias, CSS imports (which components import for side effects), and
 * `import.meta.env`, which only exists inside a Vite build.
 */
const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/tests', '<rootDir>/src'],
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],

  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.test.json' }],
  },

  // Checked in order, so the stubs come first: an aliased stylesheet such as
  // '@/pages/…/page.css' would otherwise resolve to the real file and fail to parse.
  moduleNameMapper: {
    // Styles carry no behaviour worth asserting; stub them so imports resolve.
    '\\.(css|scss)$': 'identity-obj-proxy',
    '\\.(svg|png|jpg|jpeg|gif|webp)$': '<rootDir>/tests/file-stub.ts',
    // Keep the alias in step with vite.config.ts and tsconfig.app.json.
    '^@/(.*)$': '<rootDir>/src/$1',
    // keycloak-js is ESM-only and Jest's CommonJS runtime cannot parse it.
    '^keycloak-js$': '<rootDir>/tests/keycloak-stub.ts',
  },

  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],

  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    // Excluded: wiring and presentational primitives, where a test would
    // assert that React renders rather than that this app behaves.
    '!src/main.tsx',
    '!src/index.tsx',
    '!src/vite-env.d.ts',
    '!src/components/ui/**',
    '!src/**/*.d.ts',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text-summary', 'lcov', 'json-summary'],

  /**
   * As on the backend, the floor is set to just under what the suite currently
   * achieves so it acts as a ratchet rather than failing every build. Raising
   * it toward the §5.1.1 target of 80% is tracked in
   * docs/security-follow-ups.md.
   */
  coverageThreshold: {
    global: { statements: 5, branches: 3, functions: 5, lines: 5 },
    './src/utils/': { statements: 60, branches: 50, functions: 55, lines: 60 },
  },

  clearMocks: true,
  restoreMocks: true,
};

export default config;
