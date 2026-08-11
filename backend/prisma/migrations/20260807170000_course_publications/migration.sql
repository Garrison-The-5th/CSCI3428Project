-- Versioned publishing.
--
-- Learners stop reading the live course rows and start reading a snapshot taken
-- when someone pressed publish. Authors keep editing the live rows, so an edit
-- to existing content is held back exactly like a brand new module is.

ALTER TABLE "Course" ADD COLUMN "publishedVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Course" ADD COLUMN "draftUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE "CoursePublication" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedById" INTEGER,
    "supersededAt" TIMESTAMP(3),
    "newSectionIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "newModuleIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "newElementIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "newQuizIds" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "CoursePublication_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CoursePublication_courseId_version_key"
    ON "CoursePublication"("courseId", "version");
CREATE INDEX "CoursePublication_courseId_publishedAt_idx"
    ON "CoursePublication"("courseId", "publishedAt");
CREATE INDEX "CoursePublication_supersededAt_idx" ON "CoursePublication"("supersededAt");

ALTER TABLE "CoursePublication" ADD CONSTRAINT "CoursePublication_courseId_fkey"
    FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CoursePublication" ADD CONSTRAINT "CoursePublication_publishedById_fkey"
    FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Backfill: every course that is already published gets a version 1 snapshot of
-- exactly what it holds right now.
--
-- Without this, switching the learner read path over would black out every live
-- course until someone happened to press publish again. The snapshot is built
-- here in SQL so it matches the shape the application writes — sections and a
-- flat module list, each module carrying its elements and its published quizzes
-- with their questions and options.
--
-- Nothing is marked new: this is the baseline every later version diffs against.
-- ---------------------------------------------------------------------------

INSERT INTO "CoursePublication" ("id", "courseId", "version", "snapshot", "publishedAt")
SELECT
    gen_random_uuid()::text,
    c."id",
    1,
    jsonb_build_object(
        'id', c."id",
        'title', c."title",
        'shortDescription', c."shortDescription",
        'description', c."description",
        'tags', to_jsonb(c."tags"),
        'languages', to_jsonb(c."languages"),
        'whatYouWillLearn', to_jsonb(c."whatYouWillLearn"),
        'prerequisites', to_jsonb(c."prerequisites"),
        'required', c."required",
        'dueDate', c."dueDate",
        'published', c."published",
        'sequential', c."sequential",
        'publishedAt', c."publishedAt",
        'imageData', c."imageData",
        'imageType', c."imageType",
        'createdAt', c."createdAt",
        'updatedAt', c."updatedAt",
        'instructors', COALESCE((
            SELECT jsonb_agg(to_jsonb(i) ORDER BY i."name")
            FROM "Instructor" i
            JOIN "_CourseToInstructor" ci ON ci."B" = i."id"
            WHERE ci."A" = c."id"
        ), '[]'::jsonb),
        'sections', COALESCE((
            SELECT jsonb_agg(
                jsonb_build_object(
                    'id', s."id",
                    'courseId', s."courseId",
                    'number', s."number",
                    'title', s."title",
                    'color', s."color"
                ) ORDER BY s."number"
            )
            FROM "Section" s
            WHERE s."courseId" = c."id" AND s."deletedAt" IS NULL
        ), '[]'::jsonb),
        'modules', COALESCE((
            SELECT jsonb_agg(
                jsonb_build_object(
                    'id', m."id",
                    'courseId', m."courseId",
                    'sectionId', m."sectionId",
                    'position', m."position",
                    'number', m."number",
                    'title', m."title",
                    'estimatedMinutes', m."estimatedMinutes",
                    'elements', COALESCE((
                        SELECT jsonb_agg(to_jsonb(e) ORDER BY e."order")
                        FROM "Element" e
                        WHERE e."moduleId" = m."id"
                    ), '[]'::jsonb),
                    'quizzes', COALESCE((
                        SELECT jsonb_agg(
                            jsonb_build_object(
                                'id', q."id",
                                'title', q."title",
                                'description', q."description",
                                'moduleId', q."moduleId",
                                'order', q."order",
                                'published', q."published",
                                'showAnswers', q."showAnswers",
                                'dueDate', q."dueDate",
                                'timeLimitMinutes', q."timeLimitMinutes",
                                'questions', COALESCE((
                                    SELECT jsonb_agg(
                                        jsonb_build_object(
                                            'id', qu."id",
                                            'order', qu."order",
                                            'prompt', qu."prompt",
                                            'hint', qu."hint",
                                            'hintModuleNumber', qu."hintModuleNumber",
                                            'options', COALESCE((
                                                SELECT jsonb_agg(to_jsonb(o) ORDER BY o."order")
                                                FROM "Option" o
                                                WHERE o."questionId" = qu."id"
                                            ), '[]'::jsonb)
                                        ) ORDER BY qu."order"
                                    )
                                    FROM "Question" qu
                                    WHERE qu."quizId" = q."id"
                                ), '[]'::jsonb)
                            ) ORDER BY q."order"
                        )
                        FROM "Quiz" q
                        WHERE q."moduleId" = m."id"
                          AND q."deletedAt" IS NULL
                          AND q."published" = true
                    ), '[]'::jsonb)
                ) ORDER BY m."sortKey"
            )
            FROM "Module" m
            WHERE m."courseId" = c."id" AND m."deletedAt" IS NULL
        ), '[]'::jsonb)
    ),
    COALESCE(c."publishedAt", c."updatedAt")
FROM "Course" c
WHERE c."published" = true AND c."deletedAt" IS NULL;

-- Point every backfilled course at its version 1.
UPDATE "Course" c
SET "publishedVersion" = 1
FROM "CoursePublication" p
WHERE p."courseId" = c."id" AND p."version" = 1;

-- A course with no unpublished changes should not claim to have some. Anything
-- edited after this migration bumps draftUpdatedAt past the publication date.
UPDATE "Course" c
SET "draftUpdatedAt" = p."publishedAt"
FROM "CoursePublication" p
WHERE p."courseId" = c."id" AND p."version" = 1;
