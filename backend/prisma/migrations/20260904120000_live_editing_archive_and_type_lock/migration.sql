-- Four things ship together here, because they are one piece of work: making it
-- safe and legible for two people to author the same course at once.
--
--   * a permanent archive, so a version that matters is never swept up by the
--     fourteen-day purge;
--   * per-row edit attribution, so an unpublished change can say who made it;
--   * advisory edit leases, so two authors do not silently overwrite each other;
--   * a lock on a quiz's type once it has been published.

-- A version somebody deliberately kept. Null means the ordinary rules apply:
-- live versions are kept while live, replaced ones for fourteen days. Clearing
-- this drops the version back into that ordinary history rather than deleting
-- it — see PublicationService.unarchiveVersion.
ALTER TABLE "CoursePublication" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "CoursePublication" ADD COLUMN "archivedById" INTEGER;
ALTER TABLE "CoursePublication"
  ADD CONSTRAINT "CoursePublication_archivedById_fkey"
  FOREIGN KEY ("archivedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "CoursePublication_archivedById_idx" ON "CoursePublication"("archivedById");

-- What a quiz is stops being the author's to change once a learner can hold it.
-- Every quiz that already belongs to a published course is locked by the
-- backfill below; anything still in draft stays open until its first publish.
ALTER TABLE "Quiz" ADD COLUMN "typeLocked" BOOLEAN NOT NULL DEFAULT false;

UPDATE "Quiz" SET "typeLocked" = true
WHERE "sectionId" IN (
  SELECT s."id" FROM "Section" s
  JOIN "Course" c ON c."id" = s."courseId"
  WHERE c."publishedVersion" >= 1
);

-- Who last touched each piece of a draft, and when. Cleared for a whole course
-- at publish time: the question these answer is "what has changed that learners
-- cannot see yet", and a publish is the moment the answer becomes "nothing".
ALTER TABLE "Module" ADD COLUMN "lastEditedById" INTEGER;
ALTER TABLE "Module" ADD COLUMN "lastEditedAt" TIMESTAMP(3);
ALTER TABLE "Section" ADD COLUMN "lastEditedById" INTEGER;
ALTER TABLE "Section" ADD COLUMN "lastEditedAt" TIMESTAMP(3);
ALTER TABLE "Element" ADD COLUMN "lastEditedById" INTEGER;
ALTER TABLE "Element" ADD COLUMN "lastEditedAt" TIMESTAMP(3);
ALTER TABLE "Quiz" ADD COLUMN "lastEditedById" INTEGER;
ALTER TABLE "Quiz" ADD COLUMN "lastEditedAt" TIMESTAMP(3);
ALTER TABLE "Question" ADD COLUMN "lastEditedById" INTEGER;
ALTER TABLE "Question" ADD COLUMN "lastEditedAt" TIMESTAMP(3);

ALTER TABLE "Module" ADD CONSTRAINT "Module_lastEditedById_fkey"
  FOREIGN KEY ("lastEditedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Section" ADD CONSTRAINT "Section_lastEditedById_fkey"
  FOREIGN KEY ("lastEditedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Element" ADD CONSTRAINT "Element_lastEditedById_fkey"
  FOREIGN KEY ("lastEditedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Quiz" ADD CONSTRAINT "Quiz_lastEditedById_fkey"
  FOREIGN KEY ("lastEditedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Question" ADD CONSTRAINT "Question_lastEditedById_fkey"
  FOREIGN KEY ("lastEditedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Module_lastEditedById_idx" ON "Module"("lastEditedById");
CREATE INDEX "Section_lastEditedById_idx" ON "Section"("lastEditedById");
CREATE INDEX "Element_lastEditedById_idx" ON "Element"("lastEditedById");
CREATE INDEX "Quiz_lastEditedById_idx" ON "Quiz"("lastEditedById");
CREATE INDEX "Question_lastEditedById_idx" ON "Question"("lastEditedById");

-- Advisory claims on a module or a question, renewed by whoever holds them.
-- Deliberately not a database lock: a browser can leave without saying so, and a
-- lock nobody can release would strand the content for everyone. A row that has
-- not been renewed recently is ignored and taken over — see EditLeaseService.
CREATE TYPE "EditScope" AS ENUM ('MODULE', 'QUESTION');

CREATE TABLE "EditLease" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "scope" "EditScope" NOT NULL,
    "targetId" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "renewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EditLease_pkey" PRIMARY KEY ("id")
);

-- One row per target: what makes claiming a single upsert and "who holds this" a
-- single read.
CREATE UNIQUE INDEX "EditLease_scope_targetId_key" ON "EditLease"("scope", "targetId");
CREATE INDEX "EditLease_courseId_renewedAt_idx" ON "EditLease"("courseId", "renewedAt");
CREATE INDEX "EditLease_userId_idx" ON "EditLease"("userId");

ALTER TABLE "EditLease" ADD CONSTRAINT "EditLease_courseId_fkey"
  FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EditLease" ADD CONSTRAINT "EditLease_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
