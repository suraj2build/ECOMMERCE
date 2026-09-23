-- DropIndex
DROP INDEX "payments_checkoutSessionId_key";

-- CreateTable
CREATE TABLE "payment_events" (
    "id" TEXT NOT NULL,
    "provider" "PaymentProviderType" NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "paymentId" TEXT,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_events_provider_providerEventId_key" ON "payment_events"("provider", "providerEventId");

-- CreateIndex
CREATE INDEX "payments_checkoutSessionId_createdAt_idx" ON "payments"("checkoutSessionId", "createdAt");

-- AddForeignKey
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
