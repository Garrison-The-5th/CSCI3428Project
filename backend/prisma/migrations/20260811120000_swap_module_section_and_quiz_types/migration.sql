-- Swaps the two names in the course grid, and adds the three kinds of quiz.
--
-- The outer container used to be called a Section and the inner one a Module.
-- That is now the other way round: a course holds Modules, a Module holds
-- Sections, and a Section holds the elements and quizzes. Nothing about the
-- shape of the data changes — only what each level is called — so this is a pure
-- rename and no row moves.
--
-- Because the two names trade places, every rename here has to go via a parked
-- name: renaming Module to Section while a Section still exists collides, and so
-- does every index and constraint hanging off them.

-- Renames an index or a constraint if it is still under its old name, so this can
-- be replayed against a database that has already had part of it applied.
CREATE OR REPLACE FUNCTION pg_temp.swap_rename(tbl text, oldname text, newname text)
RETURNS void AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = oldname) THEN
    EXECUTE format('ALTER TABLE %I RENAME CONSTRAINT %I TO %I', tbl, oldname, newname);
  ELSIF EXISTS (SELECT 1 FROM pg_class WHERE relname = oldname AND relkind IN ('i', 'I')) THEN
    EXECUTE format('ALTER INDEX %I RENAME TO %I', oldname, newname);
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ---- 1. The tables themselves ----

ALTER TABLE "Module" RENAME TO "_swap_inner";
ALTER TABLE "Section" RENAME TO "Module";
ALTER TABLE "_swap_inner" RENAME TO "Section";
ALTER TABLE "ModuleProgress" RENAME TO "SectionProgress";

-- ---- 2. Indexes and constraints on the two swapped tables ----
-- "Section" is the old Module and still carries Module_* names; "Module" is the
-- old Section and still carries Section_* names. Park the first set, move the
-- second into place, then bring the parked set back under its new name.

SELECT pg_temp.swap_rename('Section', 'Module_pkey', '_swap_pkey');
SELECT pg_temp.swap_rename('Section', 'Module_courseId_fkey', '_swap_courseId_fkey');
SELECT pg_temp.swap_rename('Section', 'Module_sectionId_fkey', '_swap_parentId_fkey');
SELECT pg_temp.swap_rename('Section', 'Module_courseId_number_key', '_swap_courseId_number_key');
SELECT pg_temp.swap_rename('Section', 'Module_courseId_sortKey_idx', '_swap_courseId_sortKey_idx');
SELECT pg_temp.swap_rename('Section', 'Module_sectionId_position_idx', '_swap_parentId_position_idx');

SELECT pg_temp.swap_rename('Module', 'Section_pkey', 'Module_pkey');
SELECT pg_temp.swap_rename('Module', 'Section_courseId_fkey', 'Module_courseId_fkey');
SELECT pg_temp.swap_rename('Module', 'Section_courseId_number_key', 'Module_courseId_number_key');
SELECT pg_temp.swap_rename('Module', 'Section_courseId_number_idx', 'Module_courseId_number_idx');

SELECT pg_temp.swap_rename('Section', '_swap_pkey', 'Section_pkey');
SELECT pg_temp.swap_rename('Section', '_swap_courseId_fkey', 'Section_courseId_fkey');
SELECT pg_temp.swap_rename('Section', '_swap_parentId_fkey', 'Section_moduleId_fkey');
SELECT pg_temp.swap_rename('Section', '_swap_courseId_number_key', 'Section_courseId_number_key');
SELECT pg_temp.swap_rename('Section', '_swap_courseId_sortKey_idx', 'Section_courseId_sortKey_idx');
SELECT pg_temp.swap_rename('Section', '_swap_parentId_position_idx', 'Section_moduleId_position_idx');

-- ---- 3. Progress, and the foreign keys that point at the inner container ----

SELECT pg_temp.swap_rename('SectionProgress', 'ModuleProgress_pkey', 'SectionProgress_pkey');
SELECT pg_temp.swap_rename('SectionProgress', 'ModuleProgress_userId_fkey', 'SectionProgress_userId_fkey');
SELECT pg_temp.swap_rename('SectionProgress', 'ModuleProgress_moduleId_fkey', 'SectionProgress_sectionId_fkey');
SELECT pg_temp.swap_rename('SectionProgress', 'ModuleProgress_userId_moduleId_key', 'SectionProgress_userId_sectionId_key');
SELECT pg_temp.swap_rename('SectionProgress', 'ModuleProgress_moduleId_idx', 'SectionProgress_sectionId_idx');

SELECT pg_temp.swap_rename('Element', 'Element_moduleId_fkey', 'Element_sectionId_fkey');
SELECT pg_temp.swap_rename('Element', 'Element_moduleId_idx', 'Element_sectionId_idx');
SELECT pg_temp.swap_rename('Quiz', 'Quiz_moduleId_fkey', 'Quiz_sectionId_fkey');
SELECT pg_temp.swap_rename('Quiz', 'Quiz_moduleId_idx', 'Quiz_sectionId_idx');
SELECT pg_temp.swap_rename('Note', 'Note_moduleId_idx', 'Note_sectionId_idx');

-- ---- 4. Columns ----

ALTER TABLE "Section" RENAME COLUMN "sectionId" TO "moduleId";
ALTER TABLE "Element" RENAME COLUMN "moduleId" TO "sectionId";
ALTER TABLE "Quiz" RENAME COLUMN "moduleId" TO "sectionId";
ALTER TABLE "Note" RENAME COLUMN "moduleId" TO "sectionId";
ALTER TABLE "SectionProgress" RENAME COLUMN "moduleId" TO "sectionId";
ALTER TABLE "CourseCompletion" RENAME COLUMN "moduleCount" TO "sectionCount";
ALTER TABLE "Question" RENAME COLUMN "hintModuleNumber" TO "hintSectionNumber";

-- The two "what did this version add" lists trade places for the same reason the
-- tables do: the ids that used to be sections are now modules.
ALTER TABLE "CoursePublication" RENAME COLUMN "newSectionIds" TO "_swap_new_ids";
ALTER TABLE "CoursePublication" RENAME COLUMN "newModuleIds" TO "newSectionIds";
ALTER TABLE "CoursePublication" RENAME COLUMN "_swap_new_ids" TO "newModuleIds";

-- Published snapshots are JSON and keep the old key names. They are left alone
-- and remapped when read (see PublicationService.normaliseSnapshot), so nobody
-- loses the version they are part way through; the next publish writes the new
-- shape and the remap stops applying.

-- ---- 5. The three kinds of quiz ----

CREATE TYPE "QuizType" AS ENUM ('LEARNING_CHECK', 'EXAM', 'ONE_TIME');

-- Everything that already exists is an exam: it was scored, it could be timed and
-- it was listed on the Quizzes tab, which is exactly what EXAM means.
ALTER TABLE "Quiz" ADD COLUMN "type" "QuizType" NOT NULL DEFAULT 'EXAM';

-- Results were always shown before this, so existing quizzes keep doing that.
ALTER TABLE "Quiz" ADD COLUMN "showResults" BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX "Quiz_type_idx" ON "Quiz"("type");

-- Closes a one-time link once its quiz has been handed in.
ALTER TABLE "Assignment" ADD COLUMN "completedAt" TIMESTAMP(3);

-- The paper itself, kept for one-time quizzes so the dashboard can show what
-- somebody actually chose. Attempts were previously only ever read per user.
CREATE INDEX "QuizAttempt_quizId_idx" ON "QuizAttempt"("quizId");

CREATE TABLE "QuizAnswer" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "prompt" TEXT NOT NULL,
    "chosen" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "correct" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "wasCorrect" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "QuizAnswer_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "QuizAnswer_attemptId_idx" ON "QuizAnswer"("attemptId");

ALTER TABLE "QuizAnswer" ADD CONSTRAINT "QuizAnswer_attemptId_fkey"
    FOREIGN KEY ("attemptId") REFERENCES "QuizAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
