-- AlterEnum
ALTER TYPE "CheckoutSessionStatus" ADD VALUE 'CAPTURE_RECONCILIATION_REQUIRED';

-- AlterTable
ALTER TABLE "checkout_sessions" ADD COLUMN     "reconciliationReason" TEXT;

-- CreateIndex
CREATE INDEX "checkout_sessions_status_idx" ON "checkout_sessions"("status");
