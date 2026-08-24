/**
 * File: jest.config.ts
 * Description: Jest configuration for the backend — separate unit and
 *   integration projects, path alias resolution and coverage thresholds.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
import type { Config } from 'jest';

/**
 * Two projects, because the two kinds of test have genuinely different needs.
 *
 * Unit tests (§5.1.1) "run in isolation" and "mock all third-party services" —
 * they must not need a database, so they can run on any machine and in any CI
 * job. Integration tests (§5.1.1, §5.5) exist precisely to exercise the real
 * PostgreSQL and are skipped when DATABASE_URL is absent rather than failing,
 * so a developer without Docker running still gets a useful `npm test`.
 */
/**
 * `sanitize-html` reaches htmlparser2 v12, which ships ESM only — as do the five
 * small packages under it (domhandler, domutils, dom-serializer, domelementtype,
 * entities). Node 24 can `require()` those; Jest's CommonJS runtime cannot, so
 * every suite that touches `config/rich-text` died at import with "Cannot use
 * import statement outside a module".
 *
 * Rather than stubbing the sanitiser — which is the §3.3.2 control and has its
 * own tests — those packages are handed to ts-jest with an inline
 * `module: CommonJS`, which downlevels them on the way in. Everything else in
 * node_modules is still left alone.
 *
 * This is also why the npm scripts no longer pass `--experimental-vm-modules`.
 * That flag makes Jest decide a file's module kind from its package's
 * `"type": "module"`, so the CommonJS this transform emits gets evaluated as ESM
 * and dies on `exports is not defined` — the same suites failing again for the
 * opposite reason. The flag was never load-bearing: nothing here imports a
 * genuinely ESM-only module at runtime (`heic-convert` is CommonJS), and the
 * whole suite passes without it.
 */
const ESM_DEPENDENCIES = [
  'htmlparser2',
  'domhandler',
  'domutils',
  'dom-serializer',
  'domelementtype',
  'entities',
];

const esmPackages = `(?:${ESM_DEPENDENCIES.join('|')})`;

const transformIgnorePatterns = [`node_modules/(?!.*${esmPackages}/)`];

/**
 * Scoped to those packages' own files rather than to `.js` generally: a bare
 * `^.+\\.js$` also swallows the generated Prisma client, which is large,
 * already CommonJS, and produces a warning per file for nothing.
 */
const esmJsTransform = {
  [`node_modules[\\\\/].*${esmPackages}[\\\\/].*\\.js$`]: [
    'ts-jest',
    {
      tsconfig: {
        allowJs: true,
        module: 'CommonJS',
        moduleResolution: 'node',
        target: 'ES2022',
        esModuleInterop: true,
      },
      diagnostics: false,
    },
  ],
} as const;

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',

  // Mirrors the `@/*` alias from tsconfig.json so tests import the same way the
  // source does (§1.10).
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },

  projects: [
    {
      displayName: 'unit',
      preset: 'ts-jest',
      testEnvironment: 'node',
      rootDir: '.',
      transform: {
        '^.+\\.ts$': [
          'ts-jest',
          {
            tsconfig: '<rootDir>/tsconfig.test.json',
            // 151002 suggests isolatedModules, which cannot be enabled here:
            // it conflicts with emitDecoratorMetadata, and the controllers'
            // routing decorators depend on that metadata.
            diagnostics: { ignoreCodes: [151002] },
          },
        ],
        ...esmJsTransform,
      },
      transformIgnorePatterns,
      testMatch: ['<rootDir>/tests/unit/**/*.test.ts'],
      moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
      setupFilesAfterEnv: ['<rootDir>/tests/setup-unit.ts'],
      clearMocks: true,
      restoreMocks: true,
    },
    {
      displayName: 'integration',
      preset: 'ts-jest',
      testEnvironment: 'node',
      rootDir: '.',
      transform: {
        '^.+\\.ts$': [
          'ts-jest',
          {
            tsconfig: '<rootDir>/tsconfig.test.json',
            // 151002 suggests isolatedModules, which cannot be enabled here:
            // it conflicts with emitDecoratorMetadata, and the controllers'
            // routing decorators depend on that metadata.
            diagnostics: { ignoreCodes: [151002] },
          },
        ],
        ...esmJsTransform,
      },
      transformIgnorePatterns,
      testMatch: ['<rootDir>/tests/integration/**/*.test.ts'],
      moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
      // Runs before the test file, and so before prisma-client reads the
      // environment. It decides which database may be emptied.
      setupFiles: ['<rootDir>/tests/setup-test-db.ts'],
      setupFilesAfterEnv: ['<rootDir>/tests/setup-integration.ts'],
      // A migration replay and a full course tree are slower than a unit test.
      testTimeout: 30_000,
      /*
       * Integration tests share one database and reset it between files, so
       * two files running in parallel wipe each other's rows mid-test.
       *
       * Jest ignores `maxWorkers` inside a project entry — it is a run-level
       * option only — so serialisation is enforced by the npm scripts, which
       * run this project separately with `--runInBand`. Running
       * `jest` directly across both projects will produce sporadic failures
       * here; use `npm test`.
       */
      clearMocks: true,
      restoreMocks: true,
    },
  ],

  collectCoverageFrom: [
    'src/**/*.ts',
    // Excluded deliberately: these are wiring rather than logic, and chasing
    // coverage on them produces tests that assert the framework works.
    '!src/index.ts',
    '!src/app-router.ts',
    '!src/controllers/decorators/**',
    '!src/**/*.d.ts',
  ],

  coverageDirectory: 'coverage',
  coverageReporters: ['text-summary', 'lcov', 'json-summary'],

  /**
   * Coverage floors.
   *
   * §5.1.1 sets "≥ 80% coverage on core logic module" as the target. Four areas
   * are there already and are pinned at that level so they cannot regress:
   * `config` (which holds the sanitisation, validation and upload rules),
   * `publication-service`, `insights-service` and `enrolment-service`.
   *
   * The aggregate service floor is deliberately set to just under what the
   * suite currently achieves rather than to 80%. Setting it to 80% today would
   * simply fail every build; setting it here makes it a ratchet — coverage can
   * only go up, and each service that reaches 80% gets pinned individually
   * below. `assignment-service`, `auth-service`, `curriculum-service`,
   * `email-service`, `privacy-service`, `quiz-service` and `table-service` are
   * the ones still short. That gap is recorded in docs/security-follow-ups.md.
   *
   * The global floor is lower again because gateways are thin Prisma wrappers
   * whose behaviour is really the database's; they are covered by the
   * integration suite rather than by mocking Prisma back at itself.
   */
  coverageThreshold: {
    global: { statements: 30, branches: 20, functions: 25, lines: 30 },
    './src/services/': { statements: 50, branches: 40, functions: 45, lines: 50 },

    // At or above the §5.1.1 target — pinned so they cannot slip back.
    './src/config/': { statements: 85, branches: 80, functions: 90, lines: 85 },
    './src/services/publication-service/': {
      statements: 80,
      branches: 75,
      functions: 75,
      lines: 80,
    },
    './src/services/insights-service/': {
      statements: 90,
      branches: 65,
      functions: 90,
      lines: 90,
    },
    './src/services/enrolment-service/': {
      statements: 100,
      branches: 100,
      functions: 100,
      lines: 100,
    },
    './src/services/notification-service/': {
      statements: 80,
      branches: 70,
      functions: 90,
      lines: 80,
    },
    // Export and erasure are the §3.5.3 control ("users have a method to remove
    // or export their data on demand"), so they are pinned hard: both fail
    // quietly if they fail at all — an export that drops a table still returns a
    // plausible document, and an erasure that misses a column still reports
    // success.
    './src/services/privacy-service/': {
      statements: 100,
      branches: 90,
      functions: 100,
      lines: 100,
    },
  },

  clearMocks: true,
  restoreMocks: true,
};

export default config;
