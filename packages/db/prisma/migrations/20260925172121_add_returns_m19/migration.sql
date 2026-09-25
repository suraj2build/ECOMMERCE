-- AlterEnum
ALTER TYPE "InventoryTxnType" ADD VALUE 'RETURN_DISPOSED';

-- CreateEnum
CREATE TYPE "ReturnMethod" AS ENUM ('PICKUP', 'DROP_OFF');

-- CreateEnum
CREATE TYPE "ReturnStatus" AS ENUM ('REQUESTED', 'PICKUP_SCHEDULED', 'PICKED_UP', 'RECEIVED', 'QC_PASSED', 'QC_FAILED', 'DISPOSITIONED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReturnDisposition" AS ENUM ('RESTOCK_SELLABLE', 'RESTOCK_DAMAGED', 'WRITE_OFF', 'RETURN_TO_SUPPLIER');

-- CreateEnum
CREATE TYPE "ReturnPickupStatus" AS ENUM ('SCHEDULED', 'PICKED_UP', 'FAILED');

-- CreateTable
CREATE TABLE "return_policies" (
    "id" TEXT NOT NULL,
    "styleId" TEXT,
    "categoryId" TEXT,
    "windowDays" INTEGER NOT NULL,
    "returnable" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "return_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "returns" (
    "id" TEXT NOT NULL,
    "returnNumber" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "status" "ReturnStatus" NOT NULL DEFAULT 'REQUESTED',
    "method" "ReturnMethod" NOT NULL,
    "initiatedBy" "AuditActorType" NOT NULL,
    "initiatedByStaffId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "cancelledReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "return_lines" (
    "id" TEXT NOT NULL,
    "returnId" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "disposition" "ReturnDisposition",
    "qcResult" "QcResult",
    "qcNotes" TEXT,
    "qcActorStaffId" TEXT,
    "qcAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "dispositionedAt" TIMESTAMP(3),
    "refundEligible" BOOLEAN NOT NULL DEFAULT false,
    "refundEligibleAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "return_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "return_pickups" (
    "id" TEXT NOT NULL,
    "returnId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" "ReturnPickupStatus" NOT NULL DEFAULT 'SCHEDULED',
    "providerPickupRef" TEXT,
    "trackingRef" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pickedUpAt" TIMESTAMP(3),
    "createdByStaffId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "return_pickups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "return_policies_styleId_key" ON "return_policies"("styleId");

-- CreateIndex
CREATE UNIQUE INDEX "return_policies_categoryId_key" ON "return_policies"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "returns_returnNumber_key" ON "returns"("returnNumber");

-- CreateIndex
CREATE UNIQUE INDEX "returns_idempotencyKey_key" ON "returns"("idempotencyKey");

-- CreateIndex
CREATE INDEX "returns_orderId_idx" ON "returns"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "return_lines_orderLineId_key" ON "return_lines"("orderLineId");

-- CreateIndex
CREATE INDEX "return_lines_returnId_idx" ON "return_lines"("returnId");

-- CreateIndex
CREATE UNIQUE INDEX "return_pickups_returnId_key" ON "return_pickups"("returnId");

-- CreateIndex
CREATE UNIQUE INDEX "return_pickups_idempotencyKey_key" ON "return_pickups"("idempotencyKey");

-- AddForeignKey
ALTER TABLE "return_policies" ADD CONSTRAINT "return_policies_styleId_fkey" FOREIGN KEY ("styleId") REFERENCES "styles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_policies" ADD CONSTRAINT "return_policies_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "returns" ADD CONSTRAINT "returns_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "returns" ADD CONSTRAINT "returns_initiatedByStaffId_fkey" FOREIGN KEY ("initiatedByStaffId") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_lines" ADD CONSTRAINT "return_lines_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_lines" ADD CONSTRAINT "return_lines_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_lines" ADD CONSTRAINT "return_lines_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_lines" ADD CONSTRAINT "return_lines_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_lines" ADD CONSTRAINT "return_lines_qcActorStaffId_fkey" FOREIGN KEY ("qcActorStaffId") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_pickups" ADD CONSTRAINT "return_pickups_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_pickups" ADD CONSTRAINT "return_pickups_createdByStaffId_fkey" FOREIGN KEY ("createdByStaffId") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RET-001 (specs/18-returns.md): a ReturnPolicy row overrides at exactly
-- one specificity level - style-specific or category-specific, never both
-- at once (a row with both set would be ambiguous about which it overrides)
-- and never neither (that would just be an inert row - the platform
-- default applies via RETURN_WINDOW_DEFAULT_DAYS when no row exists at
-- all). Same XOR idiom as orders_identity_xor_check.
ALTER TABLE "return_policies" ADD CONSTRAINT "return_policies_scope_xor_check"
  CHECK (("styleId" IS NOT NULL) != ("categoryId" IS NOT NULL));

-- Return/ReturnLine/ReturnPickup quantities and windows are always
-- positive - same discipline as order_lines_quantity_positive_check.
ALTER TABLE "return_lines" ADD CONSTRAINT "return_lines_quantity_positive_check"
  CHECK ("quantity" > 0);

ALTER TABLE "return_policies" ADD CONSTRAINT "return_policies_window_days_positive_check"
  CHECK ("windowDays" > 0);
