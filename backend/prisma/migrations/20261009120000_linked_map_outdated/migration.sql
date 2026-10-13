-- A linked map is no longer rewritten when its source changes: it is cut loose
-- and kept as it was until the author re-links it.
ALTER TABLE "CourseMapSubgraph" ADD COLUMN "sourceSignature" TEXT;
ALTER TABLE "CourseMapSubgraph" ADD COLUMN "outdated" BOOLEAN NOT NULL DEFAULT false;
