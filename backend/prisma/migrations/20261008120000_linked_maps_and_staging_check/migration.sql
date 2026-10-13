-- Mapping waits for staging: the modules and sections present at the last stage.
ALTER TABLE "Course" ADD COLUMN "stagedContentIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Courses already staged are treated as up to date with what they hold now, so
-- this migration does not lock every existing map until it is staged again.
UPDATE "Course" c
SET "stagedContentIds" = ARRAY(
  SELECT m."id" FROM "Module" m WHERE m."courseId" = c."id" AND m."deletedAt" IS NULL
  UNION ALL
  SELECT s."id" FROM "Section" s WHERE s."courseId" = c."id" AND s."deletedAt" IS NULL
)
WHERE c."stagedAt" IS NOT NULL;

-- Another course's whole map, linked in beneath one node and kept in step with it.
CREATE TABLE "CourseMapSubgraph" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "sourceCourseId" TEXT NOT NULL,
    "anchorNodeId" TEXT NOT NULL,

    CONSTRAINT "CourseMapSubgraph_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "CourseMapNode" ADD COLUMN "subgraphId" TEXT;
ALTER TABLE "CourseMapNode" ADD COLUMN "sourceNodeId" TEXT;
ALTER TABLE "CourseMapEdge" ADD COLUMN "subgraphId" TEXT;
ALTER TABLE "CourseMapItem" ADD COLUMN "subgraphId" TEXT;

CREATE UNIQUE INDEX "CourseMapSubgraph_courseId_sourceCourseId_key" ON "CourseMapSubgraph"("courseId", "sourceCourseId");
CREATE INDEX "CourseMapSubgraph_sourceCourseId_idx" ON "CourseMapSubgraph"("sourceCourseId");
CREATE INDEX "CourseMapSubgraph_anchorNodeId_idx" ON "CourseMapSubgraph"("anchorNodeId");
CREATE UNIQUE INDEX "CourseMapNode_subgraphId_sourceNodeId_key" ON "CourseMapNode"("subgraphId", "sourceNodeId");

ALTER TABLE "CourseMapSubgraph" ADD CONSTRAINT "CourseMapSubgraph_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CourseMapSubgraph" ADD CONSTRAINT "CourseMapSubgraph_sourceCourseId_fkey" FOREIGN KEY ("sourceCourseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CourseMapSubgraph" ADD CONSTRAINT "CourseMapSubgraph_anchorNodeId_fkey" FOREIGN KEY ("anchorNodeId") REFERENCES "CourseMapNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CourseMapNode" ADD CONSTRAINT "CourseMapNode_subgraphId_fkey" FOREIGN KEY ("subgraphId") REFERENCES "CourseMapSubgraph"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CourseMapEdge" ADD CONSTRAINT "CourseMapEdge_subgraphId_fkey" FOREIGN KEY ("subgraphId") REFERENCES "CourseMapSubgraph"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CourseMapItem" ADD CONSTRAINT "CourseMapItem_subgraphId_fkey" FOREIGN KEY ("subgraphId") REFERENCES "CourseMapSubgraph"("id") ON DELETE CASCADE ON UPDATE CASCADE;
