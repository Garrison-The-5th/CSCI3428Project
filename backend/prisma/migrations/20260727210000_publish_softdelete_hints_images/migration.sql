-- AlterTable
ALTER TABLE "Course" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "imageData" TEXT,
ADD COLUMN     "imageType" TEXT,
ADD COLUMN     "published" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Element" ADD COLUMN     "imageData" TEXT,
ADD COLUMN     "imageType" TEXT;

-- AlterTable
ALTER TABLE "Module" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Question" ADD COLUMN     "hint" TEXT,
ADD COLUMN     "hintModuleNumber" TEXT;

-- AlterTable
ALTER TABLE "Quiz" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "dueDate" TIMESTAMP(3),
ADD COLUMN     "published" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "showAnswers" BOOLEAN NOT NULL DEFAULT false;


-- Content that existed before publishing was introduced was already visible to
-- learners, so keep it visible rather than silently hiding it.
UPDATE "Course" SET "published" = true;
UPDATE "Quiz" SET "published" = true;
