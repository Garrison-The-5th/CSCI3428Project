-- Part 1: Module becomes Model. A rename throughout, so every id, link and
-- edit lease keeps pointing at the same row.
ALTER TABLE "Module" RENAME TO "Model";
ALTER TABLE "Model" RENAME CONSTRAINT "Module_pkey" TO "Model_pkey";
ALTER TABLE "Model" RENAME CONSTRAINT "Module_courseId_fkey" TO "Model_courseId_fkey";
ALTER TABLE "Model" RENAME CONSTRAINT "Module_lastEditedById_fkey" TO "Model_lastEditedById_fkey";
ALTER INDEX "Module_courseId_number_key" RENAME TO "Model_courseId_number_key";
ALTER INDEX "Module_courseId_number_idx" RENAME TO "Model_courseId_number_idx";
ALTER INDEX "Module_lastEditedById_idx" RENAME TO "Model_lastEditedById_idx";

ALTER TABLE "Section" RENAME COLUMN "moduleId" TO "modelId";
ALTER TABLE "Section" RENAME CONSTRAINT "Section_moduleId_fkey" TO "Section_modelId_fkey";
ALTER INDEX "Section_moduleId_position_idx" RENAME TO "Section_modelId_position_idx";

ALTER TABLE "DirectedLayerQuiz" RENAME COLUMN "moduleId" TO "modelId";
ALTER TABLE "DirectedLayerQuiz" RENAME CONSTRAINT "DirectedLayerQuiz_moduleId_fkey" TO "DirectedLayerQuiz_modelId_fkey";
ALTER INDEX "DirectedLayerQuiz_moduleId_key" RENAME TO "DirectedLayerQuiz_modelId_key";

ALTER TABLE "CoursePublication" RENAME COLUMN "newModuleIds" TO "newModelIds";

ALTER TYPE "EditScope" RENAME VALUE 'MODULE' TO 'MODEL';

-- ---------------------------------------------------------------------------
-- Part 2: Section becomes the content unit.
--
-- A course had three layers (module -> section -> element). It now has two
-- (model -> section), and a section is one piece of content: the fields that
-- lived on Element move up onto Section, and every element after the first in
-- a section becomes a section of its own.
--
-- The rules, which `legacy-snapshot.ts` repeats for published versions that
-- still hold the old shape — the two must agree, or a learner's progress would
-- point at ids their published version does not contain:
--
--   * A section's items are its elements and its quizzes in their shared
--     `order` (elements before quizzes on a tie, then by id, compared byte for
--     byte so that JavaScript sorts them the same way).
--   * The first ELEMENT keeps the section's id. A section with no elements
--     hands its id to its first live quiz instead, which is what a quiz set's
--     sections and a course map's generated quiz sections are.
--   * Every other item gets a new section whose id is derived from the item's
--     own id — md5('element:<id>') or md5('quiz:<id>'), read as a uuid — so it
--     can be worked out again from a snapshot without asking the database.
--   * A section with nothing in it becomes an empty TEXT section.
--   * A quiz in the recycle bin always gets its own section, deleted with it.
--
-- Element and ElementProgress are left in place here and dropped by the next
-- migration, after the checks at the end of this one have passed.
-- ---------------------------------------------------------------------------

CREATE TYPE "SectionType" AS ENUM ('YOUTUBE', 'IMAGE', 'TEXT', 'PDF', 'CANVAS', 'QUIZ');

ALTER TABLE "Section"
  ADD COLUMN "type" "SectionType",
  ADD COLUMN "videoUrl" TEXT,
  ADD COLUMN "imageUrl" TEXT,
  ADD COLUMN "imageData" TEXT,
  ADD COLUMN "imageType" TEXT,
  ADD COLUMN "fileName" TEXT,
  ADD COLUMN "textContent" TEXT,
  ADD COLUMN "canvasData" JSONB,
  ADD COLUMN "durationMinutes" INTEGER;

-- Every element and in-course quiz, with the section it ends up in. An
-- ordinary table rather than a temporary one so nothing here depends on how the
-- migration runner batches its statements; it is dropped at the end.
CREATE TABLE "_TwoLayerItem" AS
WITH items AS (
  SELECT e."sectionId" AS "oldSectionId", 'element'::text AS kind, e.id AS "itemId",
         e."order" AS ord, 0 AS "kindRank", NULL::timestamp(3) AS "itemDeletedAt"
  FROM "Element" e
  UNION ALL
  SELECT q."sectionId", 'quiz', q.id, q."order", 1, q."deletedAt"
  FROM "Quiz" q
  WHERE q."sectionId" IS NOT NULL
),
ranked AS (
  SELECT items.*,
         -- Reading order within the old section; recycled quizzes go last.
         row_number() OVER (
           PARTITION BY "oldSectionId"
           ORDER BY ("itemDeletedAt" IS NOT NULL), ord, "kindRank", "itemId" COLLATE "C"
         ) AS seq,
         -- Who inherits the section's id: the first element, else the first live quiz.
         row_number() OVER (
           PARTITION BY "oldSectionId"
           ORDER BY ("itemDeletedAt" IS NOT NULL), "kindRank", ord, "itemId" COLLATE "C"
         ) AS "keeperRank"
  FROM items
)
SELECT "oldSectionId", kind, "itemId", seq, "itemDeletedAt",
       ("keeperRank" = 1 AND "itemDeletedAt" IS NULL) AS "isKeeper",
       CASE
         WHEN "keeperRank" = 1 AND "itemDeletedAt" IS NULL THEN "oldSectionId"
         ELSE (md5(kind || ':' || "itemId"))::uuid::text
       END AS "newSectionId"
FROM ranked;

CREATE INDEX "_TwoLayerItem_new_idx" ON "_TwoLayerItem" ("newSectionId");
CREATE INDEX "_TwoLayerItem_old_idx" ON "_TwoLayerItem" ("oldSectionId");

-- The new sections. Each repeats its original's title (a quiz keeps its own
-- name, which is what an author would look for), model, colour and bin state.
-- The time estimate stays whole on the original so the course total is
-- unchanged. `createdAt` is copied rather than stamped now, or every learner
-- who had finished the course would be told all of this was new.
INSERT INTO "Section" (
  id, "courseId", "modelId", position, number, "sortKey", title, "estimatedMinutes",
  color, "createdAt", "deletedAt", type
)
SELECT
  i."newSectionId", s."courseId", s."modelId", s.position,
  CASE WHEN COALESCE(s."deletedAt", i."itemDeletedAt") IS NULL
       THEN 'migrating-' || i."newSectionId" ELSE 'deleted-' || i."newSectionId" END,
  CASE WHEN COALESCE(s."deletedAt", i."itemDeletedAt") IS NULL
       THEN 'migrating-' || i."newSectionId" ELSE 'deleted-' || i."newSectionId" END,
  CASE WHEN i.kind = 'quiz' THEN COALESCE(NULLIF(btrim(q.title), ''), s.title) ELSE s.title END,
  0, s.color,
  CASE WHEN i.kind = 'quiz' THEN q."createdAt" ELSE s."createdAt" END,
  COALESCE(s."deletedAt", i."itemDeletedAt"),
  CASE WHEN i.kind = 'quiz' THEN 'QUIZ'::"SectionType" ELSE 'TEXT'::"SectionType" END
FROM "_TwoLayerItem" i
JOIN "Section" s ON s.id = i."oldSectionId"
LEFT JOIN "Quiz" q ON i.kind = 'quiz' AND q.id = i."itemId"
WHERE NOT i."isKeeper";

-- Each element's content moves onto the section that now holds it, along with
-- its "last edited" mark when that is the more recent of the two.
UPDATE "Section" s
SET type = e.type::text::"SectionType",
    "videoUrl" = e."videoUrl",
    "imageUrl" = e."imageUrl",
    "imageData" = e."imageData",
    "imageType" = e."imageType",
    "fileName" = e."fileName",
    "textContent" = e."textContent",
    "canvasData" = e."canvasData",
    "durationMinutes" = e."durationMinutes",
    "lastEditedById" = CASE
      WHEN e."lastEditedAt" IS NOT NULL
           AND (s."lastEditedAt" IS NULL OR e."lastEditedAt" > s."lastEditedAt")
      THEN e."lastEditedById" ELSE s."lastEditedById" END,
    "lastEditedAt" = CASE
      WHEN e."lastEditedAt" IS NOT NULL
           AND (s."lastEditedAt" IS NULL OR e."lastEditedAt" > s."lastEditedAt")
      THEN e."lastEditedAt" ELSE s."lastEditedAt" END
FROM "_TwoLayerItem" i
JOIN "Element" e ON e.id = i."itemId"
WHERE i.kind = 'element' AND s.id = i."newSectionId";

-- Each quiz moves to its own QUIZ section. Its questions, options, attempts
-- and sessions hang off the quiz and are untouched. Standalone quizzes (no
-- section) were never in the item list.
UPDATE "Section" s
SET type = 'QUIZ'
FROM "_TwoLayerItem" i
WHERE i.kind = 'quiz' AND i."isKeeper" AND s.id = i."newSectionId";

UPDATE "Quiz" q
SET "sectionId" = i."newSectionId", "order" = 0
FROM "_TwoLayerItem" i
WHERE i.kind = 'quiz' AND q.id = i."itemId";

-- Whatever is left held nothing at all. It becomes an empty TEXT section so no
-- row is dropped, and the count is reported for whoever reads the log.
DO $$
DECLARE empties INTEGER;
BEGIN
  SELECT count(*) INTO empties FROM "Section" WHERE type IS NULL;
  IF empties > 0 THEN
    RAISE NOTICE 'two_layer_model: % section(s) held no element and no live quiz and became empty TEXT sections', empties;
  END IF;
END $$;

UPDATE "Section" SET type = 'TEXT', "textContent" = '' WHERE type IS NULL;

-- ---- Progress ----

-- One SectionProgress row per ElementProgress row, on the section that element
-- now is. Where the row already exists (the first element kept the section's
-- id, and opening any element always marked the section) the earlier time wins.
INSERT INTO "SectionProgress" (id, "userId", "sectionId", "viewedAt")
SELECT (md5('progress:' || ep."userId" || ':' || i."newSectionId"))::uuid::text,
       ep."userId", i."newSectionId", min(ep."viewedAt")
FROM "ElementProgress" ep
JOIN "_TwoLayerItem" i ON i.kind = 'element' AND i."itemId" = ep."elementId"
GROUP BY ep."userId", i."newSectionId"
ON CONFLICT ("userId", "sectionId")
DO UPDATE SET "viewedAt" = LEAST("SectionProgress"."viewedAt", EXCLUDED."viewedAt");

-- Sections viewed before progress was tracked per element have no element rows
-- behind them, and the player has always read those as fully seen. Their new
-- sections inherit that, so nobody is re-locked out of a course they finished.
INSERT INTO "SectionProgress" (id, "userId", "sectionId", "viewedAt")
SELECT (md5('progress:' || sp."userId" || ':' || i."newSectionId"))::uuid::text,
       sp."userId", i."newSectionId", sp."viewedAt"
FROM "SectionProgress" sp
JOIN "_TwoLayerItem" i ON i."oldSectionId" = sp."sectionId" AND i.kind = 'element' AND NOT i."isKeeper"
WHERE NOT EXISTS (
  SELECT 1
  FROM "ElementProgress" ep
  JOIN "Element" e ON e.id = ep."elementId"
  WHERE ep."userId" = sp."userId" AND e."sectionId" = sp."sectionId"
)
ON CONFLICT ("userId", "sectionId") DO NOTHING;

-- Sitting a quiz means having opened it, so a quiz that moved to a section of
-- its own is marked opened for everyone who attempted it.
INSERT INTO "SectionProgress" (id, "userId", "sectionId", "viewedAt")
SELECT (md5('progress:' || qa."userId" || ':' || i."newSectionId"))::uuid::text,
       qa."userId", i."newSectionId", min(qa."completedAt")
FROM "QuizAttempt" qa
JOIN "_TwoLayerItem" i ON i.kind = 'quiz' AND i."itemId" = qa."quizId" AND NOT i."isKeeper"
GROUP BY qa."userId", i."newSectionId"
ON CONFLICT ("userId", "sectionId") DO NOTHING;

-- ---- The numbering grid ----

-- Live sections of live models are renumbered in place: old order first, then
-- each old section's items in their reading order. Numbers are parked on
-- throwaway values first because the unique index on (courseId, number) is
-- checked row by row, exactly as CurriculumService.renumberCourse does.
CREATE TABLE "_TwoLayerPlace" AS
SELECT s.id,
       s."courseId",
       s.number AS "oldNumber",
       m.number AS "modelNumber",
       row_number() OVER (
         PARTITION BY s."modelId"
         ORDER BY s.position, COALESCE(i."oldSectionId", s.id), COALESCE(i.seq, 1), s.id
       ) AS pos
FROM "Section" s
JOIN "Model" m ON m.id = s."modelId" AND m."deletedAt" IS NULL
LEFT JOIN "_TwoLayerItem" i ON i."newSectionId" = s.id
WHERE s."deletedAt" IS NULL;

UPDATE "Section" s
SET number = 'migrating-' || s.id, "sortKey" = 'migrating-' || s.id
FROM "_TwoLayerPlace" p
WHERE s.id = p.id;

UPDATE "Section" s
SET position = p.pos,
    number = p."modelNumber" || '.' || p.pos,
    "sortKey" = lpad(p."modelNumber"::text, 6, '0') || '.' || lpad(p.pos::text, 6, '0')
FROM "_TwoLayerPlace" p
WHERE s.id = p.id;

-- A question's hint points back at a section by its number, and the numbers
-- have just moved. Each one follows the section it named.
UPDATE "Question" qn
SET "hintSectionNumber" = p."modelNumber" || '.' || p.pos
FROM "Quiz" q
JOIN "Section" qs ON qs.id = q."sectionId"
JOIN "_TwoLayerPlace" p ON p."courseId" = qs."courseId"
WHERE qn."quizId" = q.id
  AND qn."hintSectionNumber" = p."oldNumber"
  AND p."oldNumber" <> p."modelNumber" || '.' || p.pos;

-- ---- Directed learning ----

-- A section placed on a course map takes its new sections with it, straight
-- after it on the same node, so a mapped course is still fully mapped.
INSERT INTO "CourseMapItem" (id, "nodeId", "order", "sectionId", "sourceCourseId", "subgraphId")
SELECT (md5('mapitem:' || mi.id || ':' || i."newSectionId"))::uuid::text,
       mi."nodeId", mi."order", i."newSectionId", mi."sourceCourseId", mi."subgraphId"
FROM "CourseMapItem" mi
JOIN "_TwoLayerItem" i ON i."oldSectionId" = mi."sectionId" AND NOT i."isKeeper"
JOIN "Section" s ON s.id = i."newSectionId" AND s."deletedAt" IS NULL
ON CONFLICT ("nodeId", "sectionId") DO NOTHING;

-- Then each node's items are put back into a dense 0-based order.
WITH ordered AS (
  SELECT mi.id,
         row_number() OVER (
           PARTITION BY mi."nodeId"
           ORDER BY mi."order", COALESCE(i.seq, 1), mi.id
         ) - 1 AS rn
  FROM "CourseMapItem" mi
  LEFT JOIN "_TwoLayerItem" i ON i."newSectionId" = mi."sectionId"
)
UPDATE "CourseMapItem" mi
SET "order" = ordered.rn
FROM ordered
WHERE mi.id = ordered.id AND mi."order" <> ordered.rn;

-- And a course that had been staged stays staged: the new sections are the
-- same content it already staged, not something added since.
UPDATE "Course" c
SET "stagedContentIds" = c."stagedContentIds" || ARRAY(
  SELECT i."newSectionId"
  FROM "_TwoLayerItem" i
  JOIN "Section" s ON s.id = i."newSectionId" AND s."deletedAt" IS NULL
  WHERE NOT i."isKeeper" AND i."oldSectionId" = ANY (c."stagedContentIds")
)
WHERE EXISTS (
  SELECT 1 FROM "_TwoLayerItem" i
  WHERE NOT i."isKeeper" AND i."oldSectionId" = ANY (c."stagedContentIds")
);

-- ---- Published versions ----

-- Snapshots themselves are not rewritten; they are converted when read. The
-- one thing kept beside them is what each version added, and "new elements"
-- become "new sections" under the ids those elements now have.
UPDATE "CoursePublication" p
SET "newSectionIds" = ARRAY(
  SELECT DISTINCT ids.id FROM (
    SELECT unnest(p."newSectionIds") AS id
    UNION ALL
    SELECT i."newSectionId"
    FROM "_TwoLayerItem" i
    WHERE i.kind = 'element' AND i."itemId" = ANY (p."newElementIds")
  ) ids
)
WHERE cardinality(p."newElementIds") > 0;

ALTER TABLE "Section" ALTER COLUMN "type" SET NOT NULL;

-- ---- Checks ----
--
-- Run against the old tables while they still exist. Any failure aborts the
-- migration, which rolls all of the above back and leaves Element and
-- ElementProgress exactly as they were.
DO $$
DECLARE
  elements INTEGER;
  homed INTEGER;
  shared INTEGER;
  stray INTEGER;
  unparked INTEGER;
  lost_views INTEGER;
BEGIN
  SELECT count(*) INTO elements FROM "Element";
  SELECT count(*) INTO homed
  FROM "_TwoLayerItem" i
  JOIN "Section" s ON s.id = i."newSectionId"
  JOIN "Element" e ON e.id = i."itemId"
  WHERE i.kind = 'element' AND s.type::text = e.type::text;
  IF elements <> homed THEN
    RAISE EXCEPTION 'two_layer_model: % elements but % found a section', elements, homed;
  END IF;

  SELECT count(*) INTO shared FROM (
    SELECT "newSectionId" FROM "_TwoLayerItem" GROUP BY "newSectionId" HAVING count(*) > 1
  ) doubled;
  IF shared > 0 THEN
    RAISE EXCEPTION 'two_layer_model: % section(s) ended up holding more than one item', shared;
  END IF;

  SELECT count(*) INTO stray
  FROM "Quiz" q
  JOIN "Section" s ON s.id = q."sectionId"
  WHERE s.type <> 'QUIZ';
  IF stray > 0 THEN
    RAISE EXCEPTION 'two_layer_model: % quiz(zes) sit in a section that is not a QUIZ section', stray;
  END IF;

  SELECT count(*) INTO unparked FROM "Section" WHERE number LIKE 'migrating-%';
  IF unparked > 0 THEN
    RAISE NOTICE 'two_layer_model: % live section(s) had no live model and were left unnumbered', unparked;
  END IF;

  SELECT count(*) INTO lost_views
  FROM "ElementProgress" ep
  JOIN "_TwoLayerItem" i ON i.kind = 'element' AND i."itemId" = ep."elementId"
  LEFT JOIN "SectionProgress" sp ON sp."userId" = ep."userId" AND sp."sectionId" = i."newSectionId"
  WHERE sp.id IS NULL;
  IF lost_views > 0 THEN
    RAISE EXCEPTION 'two_layer_model: % element view(s) have no section view', lost_views;
  END IF;

  RAISE NOTICE 'two_layer_model: % element(s) moved onto sections; % new section(s) created',
    elements, (SELECT count(*) FROM "_TwoLayerItem" WHERE NOT "isKeeper");
END $$;

DROP TABLE "_TwoLayerPlace";
DROP TABLE "_TwoLayerItem";
