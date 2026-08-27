-- A course belongs to whoever made it.
--
-- Authoring rights followed from the Keycloak role alone, so every admin was an
-- author of everything: one person's draft sat on every other admin's Create a
-- Lesson page, ready to be opened, edited or deleted. Ownership now lives on the
-- row, and the existing `_CourseContributors` join table is how it is shared.
ALTER TABLE "Course" ADD COLUMN "createdById" INTEGER;

-- CreateIndex
CREATE INDEX "Course_createdById_idx" ON "Course"("createdById");

-- AddForeignKey. SET NULL rather than CASCADE: deleting the person who wrote a
-- course must not take the course and every learner's progress with it.
ALTER TABLE "Course" ADD CONSTRAINT "Course_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill what can be attributed.
--
-- Nothing recorded who created a course, so the nearest honest evidence is who
-- first put it live — a course is published by the person who wrote it far more
-- often than not. Drafts, and anything published before `publishedById` was
-- recorded, are left null; those stay visible to global authors rather than
-- becoming unreachable, and are claimed by whoever republishes or is named on
-- them.
UPDATE "Course" c
SET "createdById" = first_publish."publishedById"
FROM (
  SELECT DISTINCT ON ("courseId") "courseId", "publishedById"
  FROM "CoursePublication"
  WHERE "publishedById" IS NOT NULL
  ORDER BY "courseId", "version" ASC
) AS first_publish
WHERE first_publish."courseId" = c."id"
  AND c."createdById" IS NULL;
