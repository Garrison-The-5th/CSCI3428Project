-- A linked map now copies the source's root in as a node of its own, rather
-- than folding it into the node it was dropped on. The drop target is kept only
-- until the first sync joins it to that root, so it no longer owns the link.
ALTER TABLE "CourseMapSubgraph" ALTER COLUMN "anchorNodeId" DROP NOT NULL;
ALTER TABLE "CourseMapSubgraph" DROP CONSTRAINT "CourseMapSubgraph_anchorNodeId_fkey";
ALTER TABLE "CourseMapSubgraph" ADD CONSTRAINT "CourseMapSubgraph_anchorNodeId_fkey" FOREIGN KEY ("anchorNodeId") REFERENCES "CourseMapNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Linked maps are kept in step with their source again, never cut loose.
ALTER TABLE "CourseMapSubgraph" DROP COLUMN "sourceSignature";
ALTER TABLE "CourseMapSubgraph" DROP COLUMN "outdated";
