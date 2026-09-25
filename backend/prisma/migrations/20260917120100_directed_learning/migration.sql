-- Directed learning: a course whose path is built from a map rather than read
-- straight through.
--
-- Everything here is additive and off by default. `directedLearning` is false on
-- every course that already exists, which is what keeps the new publish gate —
-- no publishing until every section is on the map — away from courses that were
-- never mapped and were never meant to be.

ALTER TABLE "Course" ADD COLUMN "directedLearning" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Course" ADD COLUMN "stagedAt" TIMESTAMP(3);

-- One box on the map: a container the author names, holding an ordered list of
-- sections. `x` is the reading order among everything at the same depth, so
-- moving a box is an edit to the course rather than to the picture of it.
CREATE TABLE "CourseMapNode" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "x" INTEGER NOT NULL,
    "y" INTEGER NOT NULL,
    -- One more than the *shallowest* parent, so a node reachable by a short path
    -- is offered as soon as that path allows.
    "depth" INTEGER NOT NULL DEFAULT 0,
    "isRoot" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "CourseMapNode_pkey" PRIMARY KEY ("id")
);

-- One parent-to-child connection. A row rather than a parentId column because a
-- node may hang off several parents: site safety belongs under every project
-- that happens on site, and duplicating it would split one person's progress
-- across two copies.
CREATE TABLE "CourseMapEdge" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "parentId" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    -- The option in the child's layer quiz that selects it through this route.
    "optionId" TEXT,

    CONSTRAINT "CourseMapEdge_pkey" PRIMARY KEY ("id")
);

-- One section pinned to a node. `sourceCourseId` tells an imported section from
-- one of the course's own, which is the whole of what the publish gate needs.
CREATE TABLE "CourseMapItem" (
    "id" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "sectionId" TEXT NOT NULL,
    "sourceCourseId" TEXT NOT NULL,

    CONSTRAINT "CourseMapItem_pkey" PRIMARY KEY ("id")
);

-- Another course whose sections this map may place. The sections stay owned and
-- edited by their own course; this only offers them.
CREATE TABLE "CourseMapImport" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "sourceCourseId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CourseMapImport_pkey" PRIMARY KEY ("id")
);

-- One generated quiz per layer, and the module it lives in. One per depth rather
-- than one per parent: everything the same number of jumps from the root is
-- asked about together, in a single question.
CREATE TABLE "DirectedLayerQuiz" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "depth" INTEGER NOT NULL,
    "quizId" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,

    CONSTRAINT "DirectedLayerQuiz_pkey" PRIMARY KEY ("id")
);

-- Which branches one learner picked at one layer quiz. Not a record of a sitting
-- — that is QuizAnswer, and is never rewritten — but their current path,
-- overwritten every time they retake.
CREATE TABLE "DirectedChoice" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "courseId" TEXT NOT NULL,
    "depth" INTEGER NOT NULL,
    -- Node ids rather than option ids: a node offered by two parents has two
    -- options and either means the same thing, and an edge the author redraws
    -- must not silently lose an answer.
    "chosenNodeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "answeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DirectedChoice_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CourseMapNode_courseId_depth_idx" ON "CourseMapNode"("courseId", "depth");

CREATE UNIQUE INDEX "CourseMapEdge_optionId_key" ON "CourseMapEdge"("optionId");
CREATE UNIQUE INDEX "CourseMapEdge_parentId_childId_key" ON "CourseMapEdge"("parentId", "childId");
CREATE INDEX "CourseMapEdge_courseId_idx" ON "CourseMapEdge"("courseId");
CREATE INDEX "CourseMapEdge_childId_idx" ON "CourseMapEdge"("childId");

CREATE UNIQUE INDEX "CourseMapItem_nodeId_sectionId_key" ON "CourseMapItem"("nodeId", "sectionId");
CREATE INDEX "CourseMapItem_sectionId_idx" ON "CourseMapItem"("sectionId");
CREATE INDEX "CourseMapItem_sourceCourseId_idx" ON "CourseMapItem"("sourceCourseId");

CREATE UNIQUE INDEX "CourseMapImport_courseId_sourceCourseId_key" ON "CourseMapImport"("courseId", "sourceCourseId");
CREATE INDEX "CourseMapImport_sourceCourseId_idx" ON "CourseMapImport"("sourceCourseId");

CREATE UNIQUE INDEX "DirectedLayerQuiz_quizId_key" ON "DirectedLayerQuiz"("quizId");
CREATE UNIQUE INDEX "DirectedLayerQuiz_moduleId_key" ON "DirectedLayerQuiz"("moduleId");
CREATE UNIQUE INDEX "DirectedLayerQuiz_courseId_depth_key" ON "DirectedLayerQuiz"("courseId", "depth");

CREATE UNIQUE INDEX "DirectedChoice_userId_courseId_depth_key" ON "DirectedChoice"("userId", "courseId", "depth");
CREATE INDEX "DirectedChoice_courseId_idx" ON "DirectedChoice"("courseId");

ALTER TABLE "CourseMapNode" ADD CONSTRAINT "CourseMapNode_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CourseMapEdge" ADD CONSTRAINT "CourseMapEdge_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CourseMapEdge" ADD CONSTRAINT "CourseMapEdge_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "CourseMapNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CourseMapEdge" ADD CONSTRAINT "CourseMapEdge_childId_fkey" FOREIGN KEY ("childId") REFERENCES "CourseMapNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- SetNull rather than Cascade: regenerating the quizzes replaces every option,
-- and an edge must survive its option being rewritten.
ALTER TABLE "CourseMapEdge" ADD CONSTRAINT "CourseMapEdge_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "Option"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CourseMapItem" ADD CONSTRAINT "CourseMapItem_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "CourseMapNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CourseMapItem" ADD CONSTRAINT "CourseMapItem_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CourseMapImport" ADD CONSTRAINT "CourseMapImport_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CourseMapImport" ADD CONSTRAINT "CourseMapImport_sourceCourseId_fkey" FOREIGN KEY ("sourceCourseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DirectedLayerQuiz" ADD CONSTRAINT "DirectedLayerQuiz_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DirectedLayerQuiz" ADD CONSTRAINT "DirectedLayerQuiz_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "Quiz"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DirectedLayerQuiz" ADD CONSTRAINT "DirectedLayerQuiz_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DirectedChoice" ADD CONSTRAINT "DirectedChoice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DirectedChoice" ADD CONSTRAINT "DirectedChoice_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
