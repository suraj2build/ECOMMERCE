-- CreateEnum
CREATE TYPE "PaymentEventStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'FAILED');

-- AlterTable
ALTER TABLE "payment_events" ADD COLUMN     "processedAt" TIMESTAMP(3),
ADD COLUMN     "processingError" TEXT,
ADD COLUMN     "status" "PaymentEventStatus" NOT NULL DEFAULT 'RECEIVED';

-- CreateIndex
CREATE INDEX "payment_events_status_idx" ON "payment_events"("status");
