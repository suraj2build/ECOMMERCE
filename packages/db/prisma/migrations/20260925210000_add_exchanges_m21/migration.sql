-- CreateEnum
CREATE TYPE "ExchangeStatus" AS ENUM ('REQUESTED', 'PICKUP_SCHEDULED', 'PICKED_UP', 'RECEIVED', 'COMPLETED', 'QC_FAILED', 'REPLACEMENT_UNAVAILABLE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ExchangePaymentDirection" AS ENUM ('CUSTOMER_PAYS', 'STORE_CREDIT', 'EVEN');

-- CreateEnum
CREATE TYPE "ExchangePaymentStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'CAPTURED', 'FAILED');

-- AlterTable
ALTER TABLE "payment_events" ADD COLUMN     "exchangeId" TEXT;

-- CreateTable
CREATE TABLE "exchanges" (
    "id" TEXT NOT NULL,
    "exchangeNumber" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "originalSkuId" TEXT NOT NULL,
    "originalLocationId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "replacementSkuId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "ExchangeStatus" NOT NULL DEFAULT 'REQUESTED',
    "method" "ReturnMethod" NOT NULL,
    "initiatedBy" "AuditActorType" NOT NULL,
    "initiatedByStaffId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "replacementReservationId" TEXT,
    "replacementAllocatedAt" TIMESTAMP(3),
    "originalLineValue" DECIMAL(10,2) NOT NULL,
    "replacementValue" DECIMAL(10,2) NOT NULL,
    "priceDifference" DECIMAL(10,2) NOT NULL,
    "paymentDirection" "ExchangePaymentDirection" NOT NULL,
    "paymentStatus" "ExchangePaymentStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
    "paymentProviderOrderId" TEXT,
    "paymentProviderPaymentId" TEXT,
    "storeCreditEntryId" TEXT,
    "pickupStatus" "ReturnPickupStatus",
    "pickupProvider" TEXT,
    "pickupProviderRef" TEXT,
    "pickupTrackingRef" TEXT,
    "pickupIdempotencyKey" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "pickedUpAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "qcResult" "QcResult",
    "disposition" "ReturnDisposition",
    "qcNotes" TEXT,
    "qcActorStaffId" TEXT,
    "qcAt" TIMESTAMP(3),
    "dispositionedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelledReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exchanges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "exchanges_exchangeNumber_key" ON "exchanges"("exchangeNumber");

-- CreateIndex
CREATE UNIQUE INDEX "exchanges_orderLineId_key" ON "exchanges"("orderLineId");

-- CreateIndex
CREATE UNIQUE INDEX "exchanges_idempotencyKey_key" ON "exchanges"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "exchanges_storeCreditEntryId_key" ON "exchanges"("storeCreditEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "exchanges_pickupIdempotencyKey_key" ON "exchanges"("pickupIdempotencyKey");

-- CreateIndex
CREATE INDEX "exchanges_orderId_idx" ON "exchanges"("orderId");

-- AddForeignKey
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_exchangeId_fkey" FOREIGN KEY ("exchangeId") REFERENCES "exchanges"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exchanges" ADD CONSTRAINT "exchanges_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exchanges" ADD CONSTRAINT "exchanges_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exchanges" ADD CONSTRAINT "exchanges_originalSkuId_fkey" FOREIGN KEY ("originalSkuId") REFERENCES "skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exchanges" ADD CONSTRAINT "exchanges_originalLocationId_fkey" FOREIGN KEY ("originalLocationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exchanges" ADD CONSTRAINT "exchanges_replacementSkuId_fkey" FOREIGN KEY ("replacementSkuId") REFERENCES "skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exchanges" ADD CONSTRAINT "exchanges_initiatedByStaffId_fkey" FOREIGN KEY ("initiatedByStaffId") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exchanges" ADD CONSTRAINT "exchanges_qcActorStaffId_fkey" FOREIGN KEY ("qcActorStaffId") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exchanges" ADD CONSTRAINT "exchanges_storeCreditEntryId_fkey" FOREIGN KEY ("storeCreditEntryId") REFERENCES "store_credit_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Financial/business sanity: a replacement must genuinely be a
-- different SKU (an exchange for the identical SKU is not an exchange);
-- quantity is always positive; the settlement amounts are non-negative
-- (priceDifference itself may be negative - that IS the STORE_CREDIT
-- direction - so it is deliberately NOT constrained here).
ALTER TABLE "exchanges" ADD CONSTRAINT "exchanges_replacement_differs_check"
  CHECK ("originalSkuId" != "replacementSkuId");
ALTER TABLE "exchanges" ADD CONSTRAINT "exchanges_quantity_positive_check"
  CHECK ("quantity" > 0);
ALTER TABLE "exchanges" ADD CONSTRAINT "exchanges_values_non_negative_check"
  CHECK ("originalLineValue" >= 0 AND "replacementValue" >= 0);
