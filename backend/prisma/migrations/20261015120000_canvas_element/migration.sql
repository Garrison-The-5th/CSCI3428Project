-- A canvas is a free-form slide: pictures, text boxes and shapes placed and
-- layered by hand. Its layout and its uploaded pictures live in one JSON column
-- so a published snapshot carries the whole thing, exactly as it does for the
-- other element types.
ALTER TYPE "ElementType" ADD VALUE 'CANVAS';
ALTER TABLE "Element" ADD COLUMN "canvasData" JSONB;
