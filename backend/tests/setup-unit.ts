/**
 * File: setup-unit.ts
 * Description: Environment for unit tests — no database, no network, no logging.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */

/**
 * §5.1.1 requires unit tests to "run in isolation" and "mock all third-party
 * services". Two things are set up here to make that true by default rather
 * than per file.
 *
 * `PUBLICKEY` exists because `auth-middleware` throws at import time without
 * it, which would take down any test that transitively imports a controller.
 * The value is never used to verify a real token in a unit test.
 *
 * Logging is silenced so a failing assertion is the only thing in the output.
 */
process.env.PUBLICKEY = process.env.PUBLICKEY ?? 'unit-test-public-key';
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

// Nothing in a unit test may touch the database. Importing the Prisma client
// opens a connection pool, so it is replaced wholesale — a test that needs real
// persistence belongs in tests/integration.
jest.mock('../prisma/prisma-client', () => ({
  prisma: new Proxy(
    {},
    {
      get() {
        throw new Error(
          'A unit test touched the database. Mock the gateway, or move the test ' +
            'to tests/integration where a real PostgreSQL is available.',
        );
      },
    },
  ),
  connectDB: jest.fn(),
  disconnectDB: jest.fn(),
}));
