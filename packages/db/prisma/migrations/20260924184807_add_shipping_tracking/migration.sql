-- CreateEnum
CREATE TYPE "ShipmentTrackingStatus" AS ENUM ('CREATED', 'BOOKED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERY_FAILED', 'DELIVERED', 'RTO_INITIATED', 'RTO_DELIVERED');

-- CreateEnum
CREATE TYPE "ShipmentEventSource" AS ENUM ('WEBHOOK', 'POLL', 'MANUAL');

-- CreateEnum
CREATE TYPE "ShipmentEventStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'FAILED');

-- CreateTable
CREATE TABLE "shipments" (
    "id" TEXT NOT NULL,
    "fulfilmentId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerShipmentRef" TEXT,
    "trackingRef" TEXT,
    "status" "ShipmentTrackingStatus" NOT NULL DEFAULT 'CREATED',
    "deliveryAttempts" INTEGER NOT NULL DEFAULT 0,
    "maxDeliveryAttempts" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdByStaffId" TEXT,
    "bookedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "rtoInitiatedAt" TIMESTAMP(3),
    "rtoDeliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipment_tracking_events" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT,
    "provider" TEXT NOT NULL,
    "providerEventId" TEXT,
    "source" "ShipmentEventSource" NOT NULL,
    "rawStatus" TEXT,
    "normalizedStatus" "ShipmentTrackingStatus",
    "payload" JSONB NOT NULL,
    "status" "ShipmentEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "processingError" TEXT,

    CONSTRAINT "shipment_tracking_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shipments_fulfilmentId_key" ON "shipments"("fulfilmentId");

-- CreateIndex
CREATE UNIQUE INDEX "shipments_idempotencyKey_key" ON "shipments"("idempotencyKey");

-- CreateIndex
CREATE INDEX "shipments_orderId_idx" ON "shipments"("orderId");

-- CreateIndex
CREATE INDEX "shipments_status_idx" ON "shipments"("status");

-- CreateIndex
CREATE INDEX "shipment_tracking_events_shipmentId_idx" ON "shipment_tracking_events"("shipmentId");

-- CreateIndex
CREATE INDEX "shipment_tracking_events_status_idx" ON "shipment_tracking_events"("status");

-- CreateIndex
CREATE UNIQUE INDEX "shipment_tracking_events_provider_providerEventId_key" ON "shipment_tracking_events"("provider", "providerEventId");

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_fulfilmentId_fkey" FOREIGN KEY ("fulfilmentId") REFERENCES "order_fulfilments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_createdByStaffId_fkey" FOREIGN KEY ("createdByStaffId") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_tracking_events" ADD CONSTRAINT "shipment_tracking_events_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "shipments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
