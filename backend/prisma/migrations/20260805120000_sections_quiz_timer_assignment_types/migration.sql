-- Sections, timed quizzes, and the two kinds of assignment.

-- ---------------------------------------------------------------------------
-- Sections: the outer index of the course grid.
-- ---------------------------------------------------------------------------

CREATE TABLE "Section" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Section_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Section_courseId_number_key" ON "Section"("courseId", "number");
CREATE INDEX "Section_courseId_number_idx" ON "Section"("courseId", "number");

ALTER TABLE "Section" ADD CONSTRAINT "Section_courseId_fkey"
    FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Module" ADD COLUMN "sectionId" TEXT;
ALTER TABLE "Module" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 1;

CREATE INDEX "Module_sectionId_position_idx" ON "Module"("sectionId", "position");

ALTER TABLE "Module" ADD CONSTRAINT "Module_sectionId_fkey"
    FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Backfill: every existing module joins the section named by the first digit of
-- its current number, so "2" and "2.3" both land in section 2.
--
-- The unique index on (courseId, number) comes off for the rewrite. It is
-- checked per row, and renumbering permutes numbers among existing rows — a
-- course holding "1", "1.1", "1.2" becomes "1.1", "1.2", "1.3", which collides
-- part-way through even though the final state is sound.
-- ---------------------------------------------------------------------------

DROP INDEX "Module_courseId_number_key";

-- One row per section that needs to exist, numbered densely so a course whose
-- modules jump from 1 to 3 comes out with sections 1 and 2 rather than a hole.
CREATE TEMP TABLE "_section_backfill" AS
SELECT
    "courseId",
    split_part("number", '.', 1) AS "lead",
    DENSE_RANK() OVER (
        PARTITION BY "courseId"
        ORDER BY COALESCE(
            NULLIF(regexp_replace(split_part("number", '.', 1), '\D', '', 'g'), ''),
            '0'
        )::int
    )::int AS "sectionNumber"
FROM "Module"
GROUP BY "courseId", split_part("number", '.', 1);

INSERT INTO "Section" ("id", "courseId", "number", "title")
SELECT
    gen_random_uuid()::text,
    "courseId",
    "sectionNumber",
    'Section ' || "sectionNumber"
FROM "_section_backfill";

UPDATE "Module" m
SET "sectionId" = sec."id"
FROM "_section_backfill" map
JOIN "Section" sec
    ON sec."courseId" = map."courseId" AND sec."number" = map."sectionNumber"
WHERE map."courseId" = m."courseId"
  AND map."lead" = split_part(m."number", '.', 1);

-- Position within the section follows the order they already sorted in.
UPDATE "Module" m
SET "position" = ranked."pos"
FROM (
    SELECT "id", ROW_NUMBER() OVER (
        PARTITION BY "sectionId" ORDER BY "sortKey", "number"
    ) AS "pos"
    FROM "Module"
    WHERE "sectionId" IS NOT NULL
) ranked
WHERE ranked."id" = m."id";

UPDATE "Module" m
SET "number" = sec."number" || '.' || m."position",
    "sortKey" = lpad(sec."number"::text, 6, '0') || '.' || lpad(m."position"::text, 6, '0')
FROM "Section" sec
WHERE sec."id" = m."sectionId";

DROP TABLE "_section_backfill";

CREATE UNIQUE INDEX "Module_courseId_number_key" ON "Module"("courseId", "number");

-- ---------------------------------------------------------------------------
-- Timed quizzes.
-- ---------------------------------------------------------------------------

ALTER TABLE "Quiz" ADD COLUMN "timeLimitMinutes" INTEGER;

CREATE TABLE "QuizSession" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "quizId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),

    CONSTRAINT "QuizSession_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "QuizSession_userId_quizId_idx" ON "QuizSession"("userId", "quizId");

ALTER TABLE "QuizSession" ADD CONSTRAINT "QuizSession_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "QuizSession" ADD CONSTRAINT "QuizSession_quizId_fkey"
    FOREIGN KEY ("quizId") REFERENCES "Quiz"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Assignment types. Everything issued so far was a link, which is the default.
-- ---------------------------------------------------------------------------

CREATE TYPE "AssignmentType" AS ENUM ('PLATFORM', 'LINK');

ALTER TABLE "Assignment" ADD COLUMN "type" "AssignmentType" NOT NULL DEFAULT 'LINK';
ALTER TABLE "Assignment" ADD COLUMN "notifiedAt" TIMESTAMP(3);
