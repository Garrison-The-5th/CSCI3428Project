-- Releases every erased user from the Keycloak account it was bound to.
--
-- Erasure used to keep the binding, so the same person signing in again was
-- matched to their erased row: with a verified email their real address was
-- copied back onto it, without one they were left signed in as the tombstone
-- with none of their work. Erasure now clears the binding itself; this does the
-- same for the rows erased before it did, so their owners get a fresh account
-- on their next sign-in. Data only — no schema change.
UPDATE "User"
SET "keycloakSubject" = NULL
WHERE "keycloakSubject" IS NOT NULL
  AND "email" LIKE '%@erased.invalid';
