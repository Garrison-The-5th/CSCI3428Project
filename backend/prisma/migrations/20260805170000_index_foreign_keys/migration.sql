-- Index the foreign keys that every course read joins on.
--
-- Postgres indexes the referenced (primary key) side of a relation automatically
-- but never the referencing side, so these columns have been sequentially
-- scanned all along. Invisible on a handful of courses; a cliff once content
-- grows, and these are precisely the tables that grow with it.
--
-- CONCURRENTLY is deliberately not used: it cannot run inside the transaction
-- Prisma wraps a migration in, and at current table sizes the brief lock costs
-- nothing.

CREATE INDEX "Element_moduleId_idx" ON "Element"("moduleId");
CREATE INDEX "Quiz_moduleId_idx" ON "Quiz"("moduleId");
CREATE INDEX "Question_quizId_idx" ON "Question"("quizId");
CREATE INDEX "Option_questionId_idx" ON "Option"("questionId");
CREATE INDEX "ModuleProgress_moduleId_idx" ON "ModuleProgress"("moduleId");
CREATE INDEX "Note_moduleId_idx" ON "Note"("moduleId");
