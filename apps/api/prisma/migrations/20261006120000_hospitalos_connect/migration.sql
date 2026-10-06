-- AlterTable
ALTER TABLE "hospitals" ADD COLUMN     "addressLine" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "isPublic" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "operatingHours" TEXT,
ADD COLUMN     "publicDescription" TEXT,
ADD COLUMN     "publicEmail" TEXT,
ADD COLUMN     "publicPhone" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "dateOfBirth" DATE,
ADD COLUMN     "gender" "Gender",
ADD COLUMN     "phone" TEXT;

-- AlterTable
ALTER TABLE "patients" ADD COLUMN     "userId" TEXT;

-- AlterTable
ALTER TABLE "doctor_profiles" ADD COLUMN     "isPubliclyVisible" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "appointments" ADD COLUMN     "idempotencyKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "patients_userId_key" ON "patients"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "appointments_hospitalId_idempotencyKey_key" ON "appointments"("hospitalId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "patients" ADD CONSTRAINT "patients_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
