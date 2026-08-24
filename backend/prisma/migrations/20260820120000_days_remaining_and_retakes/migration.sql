-- Deadlines become a length rather than a date, and an exam can be reopened.
--
-- `daysRemaining` is what an author now sets on a lesson or a quiz: how long
-- somebody gets once it is handed to them. The assignment's own `dueDate` is
-- stamped from it at the moment the assignment is made, so the same course
-- assigned today and next month gives each learner the same run at it. The
-- existing `dueDate` columns stay: they are still the single course-wide
-- deadline for anything that never went through an assignment, and dropping
-- them would throw away the deadlines already set.
ALTER TABLE "Course" ADD COLUMN "daysRemaining" INTEGER;
ALTER TABLE "Quiz" ADD COLUMN "daysRemaining" INTEGER;

-- Whether an exam may be sat more than once. Off is what an exam has always
-- meant here — one sitting, one mark — so every existing row keeps that.
ALTER TABLE "Quiz" ADD COLUMN "allowMultipleAttempts" BOOLEAN NOT NULL DEFAULT false;
