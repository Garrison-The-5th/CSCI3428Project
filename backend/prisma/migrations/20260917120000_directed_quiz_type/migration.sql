-- The layer quiz of a directed course.
--
-- Alone in its own migration because Postgres will not let a value added to an
-- enum be used in the same transaction that added it, and Prisma wraps each
-- migration in one. The tables that reference it land in the next migration.
ALTER TYPE "QuizType" ADD VALUE 'DIRECTED';
