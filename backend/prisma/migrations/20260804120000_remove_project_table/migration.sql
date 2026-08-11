-- Removes the Project table.
--
-- Project was the boilerplate's example CRUD feature (ProjectsCRUD.tsx, "Full CRUD
-- Operations Example") and was never part of the learning platform. It had no
-- relations to any other model, so nothing cascades. The backend slice
-- (projectController/projectService/projectGateway) and the orphaned frontend
-- pages are removed in the same change.

-- DropTable
DROP TABLE IF EXISTS "Project";
