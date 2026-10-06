-- Fixes a Phase 5 design bug caught during the database-integrity audit:
-- a bare UNIQUE on patients.userId made it impossible for a Connect
-- account to have a linked Patient record at more than one hospital —
-- the second hospital's auto-create would fail with a unique-violation
-- the moment the account already had a linked record anywhere else. The
-- constraint must be scoped per hospital, not global. See /DECISIONS.md.

-- DropIndex
DROP INDEX "patients_userId_key";

-- CreateIndex
CREATE UNIQUE INDEX "patients_hospitalId_userId_key" ON "patients"("hospitalId", "userId");
