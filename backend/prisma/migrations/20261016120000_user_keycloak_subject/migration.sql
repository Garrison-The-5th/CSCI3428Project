-- Binds each user to Keycloak's fixed id for them, so identity no longer rests
-- on an email address the user can edit. Filled in on each person's next
-- sign-in; existing rows start empty.
ALTER TABLE "User" ADD COLUMN "keycloakSubject" TEXT;
CREATE UNIQUE INDEX "User_keycloakSubject_key" ON "User"("keycloakSubject");
