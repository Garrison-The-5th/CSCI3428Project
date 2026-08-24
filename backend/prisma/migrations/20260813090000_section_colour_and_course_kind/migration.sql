-- Quiz sets, and the tint a section needs in order to be one.

-- A course is now either a lesson or a quiz set. Both are the same shape and
-- share publishing, versioning and access; the kind only decides which tab lists
-- it and what the editor offers. Everything that exists today is a lesson.
CREATE TYPE "CourseKind" AS ENUM ('LESSON', 'QUIZ_SET');
ALTER TABLE "Course" ADD COLUMN "kind" "CourseKind" NOT NULL DEFAULT 'LESSON';
CREATE INDEX "Course_kind_idx" ON "Course"("kind");

-- Modules already carried a tint, which was enough while a section was only ever
-- read inside its module's group. A quiz set has a single module and a long flat
-- list of sections, so the colour has to live at this level to be any use.
ALTER TABLE "Section" ADD COLUMN "color" TEXT;
