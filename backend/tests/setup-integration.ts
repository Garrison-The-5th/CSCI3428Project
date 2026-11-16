/**
 * File: setup-integration.ts
 * Description: Environment for integration tests — a real PostgreSQL, reset
 *   between files, with a clear skip when no database is configured.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
import { prisma } from '../prisma/prisma-client';

process.env.PUBLICKEY = process.env.PUBLICKEY ?? 'integration-test-public-key';
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

/**
 * Integration tests need the real database (§5.5, "use Dockerized/Local
 * Postgres in development"). When there is none they are skipped rather than
 * failed: a developer running `npm test` without Docker up should still get a
 * green unit suite and a clear message, not a wall of connection errors.
 *
 * CI always sets DATABASE_URL, so the suite is never silently skipped there —
 * see the postgres service in .github/workflows/pr-checks.yml.
 *
 * Which database that is has already been decided, and vetted, by
 * `setup-test-db.ts`. It is deliberately never read from the app's own .env:
 * `resetDatabase` below empties every table, and pointing that at a developer's
 * working database destroys their content. It has done exactly that once.
 */
export const hasDatabase = Boolean(process.env.DATABASE_URL);

if (!hasDatabase) {
  console.warn(
    '\n  DATABASE_URL is not set — integration tests are being skipped.\n' +
      '  Start one with: docker compose up -d postgres\n',
  );
}

/**
 * Empties every table between test files.
 *
 * Ordered inside-out so foreign keys never block a delete, rather than using
 * TRUNCATE ... CASCADE, which would also silently mask a missing cascade rule
 * that the schema tests exist to catch.
 */
export async function resetDatabase(): Promise<void> {
  if (!hasDatabase) return;

  await prisma.$transaction([
    prisma.option.deleteMany(),
    prisma.question.deleteMany(),
    prisma.quizSession.deleteMany(),
    prisma.quizAttempt.deleteMany(),
    prisma.sectionProgress.deleteMany(),
    prisma.courseCompletion.deleteMany(),
    prisma.note.deleteMany(),
    prisma.assignment.deleteMany(),
    prisma.coursePublication.deleteMany(),
    prisma.quiz.deleteMany(),
    prisma.section.deleteMany(),
    prisma.model.deleteMany(),
    prisma.instructor.deleteMany(),
    prisma.course.deleteMany(),
    prisma.user.deleteMany(),
  ]);
}

beforeAll(async () => {
  if (hasDatabase) await resetDatabase();
});

afterEach(async () => {
  if (hasDatabase) await resetDatabase();
});

afterAll(async () => {
  if (hasDatabase) await prisma.$disconnect();
});
