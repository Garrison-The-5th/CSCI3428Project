-- The items an author marked as defaults for every new canvas in a course.
CREATE TABLE "CourseCanvasTemplate" (
    "courseId" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseCanvasTemplate_pkey" PRIMARY KEY ("courseId")
);

ALTER TABLE "CourseCanvasTemplate" ADD CONSTRAINT "CourseCanvasTemplate_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
