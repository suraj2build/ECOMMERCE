-- LR-006 scheduler leases/alert state shared by API instances; LR-003 consent withdrawal (consent subject on checkout/order, WITHDRAWN conversion events).
-- AlterEnum
ALTER TYPE "ConversionEventStatus" ADD VALUE 'WITHDRAWN';

-- AlterTable
ALTER TABLE "checkout_sessions" ADD COLUMN     "consentSubjectId" TEXT;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "consentSubjectId" TEXT;

-- CreateTable
CREATE TABLE "maintenance_job_states" (
    "job" TEXT NOT NULL,
    "holder" TEXT,
    "leaseUntil" TIMESTAMPTZ(3),
    "lastStartedAt" TIMESTAMPTZ(3),
    "alertedAt" TIMESTAMPTZ(3),
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "maintenance_job_states_pkey" PRIMARY KEY ("job")
);

-- CreateIndex
CREATE INDEX "checkout_sessions_consentSubjectId_idx" ON "checkout_sessions"("consentSubjectId");

-- CreateIndex
CREATE INDEX "orders_consentSubjectId_idx" ON "orders"("consentSubjectId");
