-- Follows 20261113120000_two_layer_model, which copied every element onto a
-- section and checked the copy before finishing. Nothing reads these any more.
--
-- Kept as its own migration so a cautious deployment can apply the copy, look
-- at it, and only then let the old tables go.
DROP TABLE "ElementProgress";
DROP TABLE "Element";
DROP TYPE "ElementType";

ALTER TABLE "CoursePublication" DROP COLUMN "newElementIds";
