/**
 * File: setup-test-db.ts
 * Description: Picks the database the integration suite is allowed to destroy.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Date: 2026-08-12
 */
/**
 * Chooses — and vets — the database the integration tests run against.
 *
 * These tests empty every table between files. That is fine against a throwaway
 * database and catastrophic against the one somebody is building a course in, so
 * the target is never simply inherited from the app's own configuration.
 *
 * The rule is: run only against a database that has been named for the purpose.
 *   1. `TEST_DATABASE_URL` is used if set. Nothing else is.
 *   2. Otherwise the suite skips, with instructions.
 * And whatever is chosen is refused if it points at the same database as
 * `DATABASE_URL`, so naming the development database explicitly does not work
 * either — the guard is on the destination, not on how it was reached.
 *
 * Runs as a Jest `setupFiles` entry, which is before the test file and therefore
 * before `prisma-client` reads the environment. Doing this in
 * `setupFilesAfterEach` would be too late: the client would already be pointed at
 * the wrong database.
 */

/** The database name out of a Postgres URL, for comparing two of them. */
function databaseOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).pathname.replace(/^\//, '').toLowerCase() || null;
  } catch {
    return null;
  }
}

/**
 * The application's own database, read from .env rather than from the
 * environment.
 *
 * Reading `process.env.DATABASE_URL` is not good enough: nothing loads .env for
 * a Jest run, so it is usually empty and the comparison below silently passes —
 * which is precisely how this guard failed the first time it was written, and
 * wiped a development database it was meant to protect. The file is the source
 * of truth for what must not be touched, so the file is what gets read.
 *
 * Parsed rather than `config()`d so that nothing here sets DATABASE_URL as a
 * side effect.
 */
function appDatabaseUrl(): string | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readFileSync } = require('fs') as typeof import('fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { join } = require('path') as typeof import('path');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { parse } = require('dotenv') as typeof import('dotenv');

    const parsed = parse(readFileSync(join(__dirname, '..', '.env')));
    return parsed.DATABASE_URL ?? process.env.DATABASE_URL;
  } catch {
    return process.env.DATABASE_URL;
  }
}

const appUrl = appDatabaseUrl();
const testUrl = process.env.TEST_DATABASE_URL;

if (!testUrl) {
  // Skipped rather than failed, so `npm test` is still useful without a spare
  // database. `setup-integration.ts` reads the absence of DATABASE_URL as "skip".
  delete process.env.DATABASE_URL;
  console.warn(
    '\n  Integration tests skipped: TEST_DATABASE_URL is not set.\n' +
      '  These tests DELETE EVERY ROW between files, so they will not run\n' +
      '  against your development database.\n\n' +
      '  Create a throwaway one and point them at it:\n' +
      '    docker compose exec postgres createdb -U <user> <db>_test\n' +
      '    TEST_DATABASE_URL="postgresql://…/<db>_test" npm run test:integration\n',
  );
} else if (databaseOf(testUrl) === null || databaseOf(testUrl) === databaseOf(appUrl)) {
  // The one mistake worth being loud about: a TEST_DATABASE_URL copied from
  // .env. Refused outright rather than skipped, because this is somebody
  // actively aiming the wipe at their own data.
  delete process.env.DATABASE_URL;
  console.error(
    '\n  Integration tests refused to run.\n' +
      `  TEST_DATABASE_URL points at "${databaseOf(testUrl) ?? '(unparseable)'}", which is the\n` +
      `  application's own database ("${databaseOf(appUrl) ?? 'unknown'}") or an unusable URL.\n` +
      '  These tests delete every row; point them at a separate database.\n',
  );
} else {
  process.env.DATABASE_URL = testUrl;
}
