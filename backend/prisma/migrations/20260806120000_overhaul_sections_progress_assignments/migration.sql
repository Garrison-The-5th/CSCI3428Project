-- Section tint, picked by the author and shown behind that section's modules.
ALTER TABLE "Section" ADD COLUMN "color" TEXT;

-- When content was added, so a "what's new" notice can name it rather than only
-- report that something changed. Existing rows take the migration timestamp,
-- which is the earliest date we can honestly claim.
ALTER TABLE "Module" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Quiz" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Per-element view records, for sequential courses that unlock item by item.
CREATE TABLE "ElementProgress" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "elementId" TEXT NOT NULL,
    "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ElementProgress_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ElementProgress_userId_elementId_key" ON "ElementProgress"("userId", "elementId");
CREATE INDEX "ElementProgress_elementId_idx" ON "ElementProgress"("elementId");

ALTER TABLE "ElementProgress" ADD CONSTRAINT "ElementProgress_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ElementProgress" ADD CONSTRAINT "ElementProgress_elementId_fkey"
    FOREIGN KEY ("elementId") REFERENCES "Element"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Who set the work, so mail about it comes from them, plus the counters that
-- keep a resend switch from becoming a mail loop.
ALTER TABLE "Assignment" ADD COLUMN "assignedById" INTEGER;
ALTER TABLE "Assignment" ADD COLUMN "notifyCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Assignment" ADD COLUMN "notifyWindowStart" TIMESTAMP(3);

CREATE INDEX "Assignment_assignedById_idx" ON "Assignment"("assignedById");

ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_assignedById_fkey"
    FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Rows that were already emailed have had exactly one message about them.
UPDATE "Assignment"
SET "notifyCount" = 1, "notifyWindowStart" = "notifiedAt"
WHERE "notifiedAt" IS NOT NULL;

-- When a learner was last told this course had gained content.
ALTER TABLE "CourseCompletion" ADD COLUMN "notifiedAt" TIMESTAMP(3);
