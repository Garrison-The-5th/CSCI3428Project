-- Assignment links are no longer stored: only a SHA-256 of each token is, so a
-- copy of this table is not a working key to every guest's training. Existing
-- tokens are hashed in place, so every link already sent keeps working.
ALTER TABLE "Assignment" ADD COLUMN "tokenHash" TEXT;
UPDATE "Assignment" SET "tokenHash" = encode(sha256(convert_to("token", 'UTF8')), 'hex');
ALTER TABLE "Assignment" ALTER COLUMN "tokenHash" SET NOT NULL;
CREATE UNIQUE INDEX "Assignment_tokenHash_key" ON "Assignment"("tokenHash");
DROP INDEX IF EXISTS "Assignment_token_key";
ALTER TABLE "Assignment" DROP COLUMN "token";
