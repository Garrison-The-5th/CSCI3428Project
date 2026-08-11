-- AlterTable
ALTER TABLE "Quiz" ADD COLUMN     "order" INTEGER NOT NULL DEFAULT 0;


-- Quizzes used to always render after a module's content. Give them positions
-- that keep that order rather than defaulting them all to 0 (which would put
-- them in front of everything).
UPDATE "Quiz" q
SET "order" = sub."newOrder"
FROM (
  SELECT
    z."id",
    COALESCE(
      (SELECT MAX(e."order") FROM "Element" e WHERE e."moduleId" = z."moduleId"),
      0
    ) + ROW_NUMBER() OVER (PARTITION BY z."moduleId" ORDER BY z."title") AS "newOrder"
  FROM "Quiz" z
  WHERE z."moduleId" IS NOT NULL
) AS sub
WHERE q."id" = sub."id";
