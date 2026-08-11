-- When someone last signed in, which is the only reliable mark of a real
-- account: a User row is also created by assigning work, and `name` is only set
-- when the Keycloak realm sends a name claim — which not all of them do.
ALTER TABLE "User" ADD COLUMN "lastSignInAt" TIMESTAMP(3);

-- Anyone who already has a name got it from a token, so they have signed in.
-- The exact moment is unknown; their row's existence is the best we can say.
UPDATE "User" SET "lastSignInAt" = NOW() WHERE "name" IS NOT NULL;
