-- LR-003: checkout tracking consent and the server-side conversion event outbox.
-- CreateEnum
CREATE TYPE "ConversionProvider" AS ENUM ('GA4', 'META');

-- CreateEnum
CREATE TYPE "ConversionEventStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED', 'AMBIGUOUS_RECONCILIATION_REQUIRED');

-- AlterTable
ALTER TABLE "checkout_sessions" ADD COLUMN     "analyticsClientId" TEXT,
ADD COLUMN     "analyticsConsent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "marketingConsent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "metaBrowserId" TEXT,
ADD COLUMN     "metaClickId" TEXT;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "analyticsClientId" TEXT,
ADD COLUMN     "analyticsConsent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "marketingConsent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "metaBrowserId" TEXT,
ADD COLUMN     "metaClickId" TEXT;

-- CreateTable
CREATE TABLE "conversion_events" (
    "id" TEXT NOT NULL,
    "provider" "ConversionProvider" NOT NULL,
    "eventName" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "refundId" TEXT,
    "payload" JSONB NOT NULL,
    "retrySafe" BOOLEAN NOT NULL,
    "status" "ConversionEventStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversion_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "conversion_events_status_nextAttemptAt_idx" ON "conversion_events"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "conversion_events_orderId_idx" ON "conversion_events"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "conversion_events_provider_eventId_key" ON "conversion_events"("provider", "eventId");

-- AddForeignKey
ALTER TABLE "conversion_events" ADD CONSTRAINT "conversion_events_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

