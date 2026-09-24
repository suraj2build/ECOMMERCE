-- CreateEnum
CREATE TYPE "PickTaskStatus" AS ENUM ('PENDING', 'PICKED', 'SHORT_PICKED', 'EXCEPTION', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PickExceptionType" AS ENUM ('STOCK_NOT_FOUND', 'INSUFFICIENT_STOCK', 'DAMAGED', 'WRONG_SKU_FOUND', 'OTHER');

-- AlterEnum
ALTER TYPE "FulfilmentStatus" ADD VALUE 'READY_TO_SHIP';

-- AlterEnum
ALTER TYPE "OrderLineStatus" ADD VALUE 'PICKED';

-- CreateTable
CREATE TABLE "pick_tasks" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "allocatedQuantity" INTEGER NOT NULL,
    "pickedQuantity" INTEGER NOT NULL DEFAULT 0,
    "status" "PickTaskStatus" NOT NULL DEFAULT 'PENDING',
    "exceptionType" "PickExceptionType",
    "exceptionReason" TEXT,
    "idempotencyKey" TEXT,
    "pickedByStaffId" TEXT,
    "pickedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pick_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pick_tasks_orderLineId_key" ON "pick_tasks"("orderLineId");

-- CreateIndex
CREATE INDEX "pick_tasks_orderId_idx" ON "pick_tasks"("orderId");

-- CreateIndex
CREATE INDEX "pick_tasks_status_idx" ON "pick_tasks"("status");

-- CreateIndex
CREATE INDEX "pick_tasks_locationId_status_idx" ON "pick_tasks"("locationId", "status");

-- AddForeignKey
ALTER TABLE "pick_tasks" ADD CONSTRAINT "pick_tasks_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pick_tasks" ADD CONSTRAINT "pick_tasks_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "order_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pick_tasks" ADD CONSTRAINT "pick_tasks_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pick_tasks" ADD CONSTRAINT "pick_tasks_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pick_tasks" ADD CONSTRAINT "pick_tasks_pickedByStaffId_fkey" FOREIGN KEY ("pickedByStaffId") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
