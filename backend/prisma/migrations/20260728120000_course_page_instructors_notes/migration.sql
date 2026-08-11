-- DropForeignKey
ALTER TABLE "Quiz" DROP CONSTRAINT "Quiz_courseId_fkey";

-- DropForeignKey
ALTER TABLE "Quiz" DROP CONSTRAINT "Quiz_moduleId_fkey";

-- AlterTable
ALTER TABLE "Course" ADD COLUMN     "languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "prerequisites" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "publishedAt" TIMESTAMP(3),
ADD COLUMN     "shortDescription" TEXT,
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "whatYouWillLearn" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "Element" ADD COLUMN     "durationMinutes" INTEGER;

-- AlterTable
ALTER TABLE "Quiz" DROP COLUMN "courseId";

-- CreateTable
CREATE TABLE "Instructor" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT,
    "bio" TEXT,
    "photoData" TEXT,
    "photoType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Instructor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Note" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "courseId" TEXT NOT NULL,
    "moduleId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_CourseToInstructor" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_CourseToInstructor_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "Note_userId_courseId_idx" ON "Note"("userId", "courseId");

-- CreateIndex
CREATE INDEX "_CourseToInstructor_B_index" ON "_CourseToInstructor"("B");

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quiz" ADD CONSTRAINT "Quiz_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_CourseToInstructor" ADD CONSTRAINT "_CourseToInstructor_A_fkey" FOREIGN KEY ("A") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_CourseToInstructor" ADD CONSTRAINT "_CourseToInstructor_B_fkey" FOREIGN KEY ("B") REFERENCES "Instructor"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Courses published before publishedAt existed get their creation date, so the
-- course page has a sensible date to show instead of nothing.
UPDATE "Course" SET "publishedAt" = "createdAt" WHERE "published" = true AND "publishedAt" IS NULL;
