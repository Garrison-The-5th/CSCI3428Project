-- The default tutorial course, and where each person is in the first-login tour.

-- At most one course is the default tutorial. Prisma cannot declare a partial
-- unique index, so it is written here by hand; it is also what makes the
-- start-up bootstrap safe when two replicas boot at once — the second insert
-- fails on this index instead of creating a second tutorial.
ALTER TABLE "Course" ADD COLUMN "isDefaultTutorial" BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX "Course_isDefaultTutorial_key" ON "Course"("isDefaultTutorial") WHERE "isDefaultTutorial";

CREATE TYPE "TourStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED');
ALTER TABLE "User" ADD COLUMN "tourStatus" "TourStatus" NOT NULL DEFAULT 'NOT_STARTED';
ALTER TABLE "User" ADD COLUMN "tourStep" INTEGER NOT NULL DEFAULT 0;

-- Nobody who already uses the app is ambushed by the tour on the day this
-- ships: everyone who has signed in before is marked as having skipped it, and
-- can still take it from Replay tour on their Profile page. Rows for people who
-- have only ever been assigned work (never signed in) are left NOT_STARTED, so
-- the tour greets them on their first real sign-in. Delete this one statement
-- to show the tour to every existing user once instead.
UPDATE "User" SET "tourStatus" = 'SKIPPED' WHERE "lastSignInAt" IS NOT NULL;
