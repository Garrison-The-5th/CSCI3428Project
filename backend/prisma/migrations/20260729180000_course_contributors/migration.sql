-- CreateTable
CREATE TABLE "_CourseContributors" (
    "A" TEXT NOT NULL,
    "B" INTEGER NOT NULL,

    CONSTRAINT "_CourseContributors_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_CourseContributors_B_index" ON "_CourseContributors"("B");

-- AddForeignKey
ALTER TABLE "_CourseContributors" ADD CONSTRAINT "_CourseContributors_A_fkey" FOREIGN KEY ("A") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_CourseContributors" ADD CONSTRAINT "_CourseContributors_B_fkey" FOREIGN KEY ("B") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

