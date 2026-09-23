-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('CONFIRMED', 'PROCESSING', 'DELIVERED', 'CANCELLED', 'RTO', 'EXCEPTION');

-- CreateEnum
CREATE TYPE "OrderLineStatus" AS ENUM ('ALLOCATED', 'PACKED', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'EXCEPTION');

-- CreateEnum
CREATE TYPE "FulfilmentStatus" AS ENUM ('PENDING', 'PACKED', 'SHIPPED', 'DELIVERED');

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "checkoutSessionId" TEXT NOT NULL,
    "customerId" TEXT,
    "guestSessionId" TEXT,
    "contactName" TEXT NOT NULL,
    "contactMobile" TEXT NOT NULL,
    "contactEmail" TEXT,
    "billingAddress" JSONB NOT NULL,
    "shippingAddress" JSONB NOT NULL,
    "shippingCost" DECIMAL(10,2) NOT NULL,
    "subtotal" DECIMAL(10,2) NOT NULL,
    "taxAmount" DECIMAL(10,2) NOT NULL,
    "grandTotal" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "paymentMethod" "CheckoutPaymentMethod" NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'CONFIRMED',
    "refundRequired" BOOLEAN NOT NULL DEFAULT false,
    "invoiceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_lines" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPriceInclusive" DECIMAL(10,2) NOT NULL,
    "taxableValueSnapshot" DECIMAL(10,2) NOT NULL,
    "gstRatePercent" DECIMAL(5,2) NOT NULL,
    "taxAmountSnapshot" DECIMAL(10,2) NOT NULL,
    "lineTotalInclusive" DECIMAL(10,2) NOT NULL,
    "reservationId" TEXT,
    "fulfilmentId" TEXT,
    "status" "OrderLineStatus" NOT NULL DEFAULT 'ALLOCATED',
    "cancelledAt" TIMESTAMP(3),
    "cancelledReason" TEXT,
    "exceptionReason" TEXT,

    CONSTRAINT "order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_fulfilments" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "status" "FulfilmentStatus" NOT NULL DEFAULT 'PENDING',
    "carrierName" TEXT,
    "trackingRef" TEXT,
    "packedAt" TIMESTAMP(3),
    "shippedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_fulfilments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "orders_orderNumber_key" ON "orders"("orderNumber");

-- CreateIndex
CREATE UNIQUE INDEX "orders_checkoutSessionId_key" ON "orders"("checkoutSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "orders_invoiceId_key" ON "orders"("invoiceId");

-- CreateIndex
CREATE INDEX "orders_customerId_idx" ON "orders"("customerId");

-- CreateIndex
CREATE INDEX "orders_guestSessionId_idx" ON "orders"("guestSessionId");

-- CreateIndex
CREATE INDEX "order_lines_orderId_idx" ON "order_lines"("orderId");

-- CreateIndex
CREATE INDEX "order_fulfilments_orderId_idx" ON "order_fulfilments"("orderId");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_checkoutSessionId_fkey" FOREIGN KEY ("checkoutSessionId") REFERENCES "checkout_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_fulfilmentId_fkey" FOREIGN KEY ("fulfilmentId") REFERENCES "order_fulfilments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_fulfilments" ADD CONSTRAINT "order_fulfilments_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Defense-in-depth CHECK constraints (M15, mirrors the M08/M11/M12/M13
-- pattern): an order belongs to exactly one identity (a logged-in
-- customer XOR a guest session, never both and never neither, same as
-- CheckoutSession/Cart/Wishlist), line quantities/amounts stay
-- positive/nonnegative, and a cancelled line always carries the
-- timestamp/reason its own state actually needs.
ALTER TABLE "orders" ADD CONSTRAINT "orders_identity_xor_check"
  CHECK (("customerId" IS NOT NULL) != ("guestSessionId" IS NOT NULL));

ALTER TABLE "orders" ADD CONSTRAINT "orders_amounts_nonnegative_check"
  CHECK ("shippingCost" >= 0 AND "subtotal" >= 0 AND "taxAmount" >= 0 AND "grandTotal" >= 0);

ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_quantity_positive_check"
  CHECK ("quantity" > 0);

ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_amounts_nonnegative_check"
  CHECK ("unitPriceInclusive" >= 0 AND "taxableValueSnapshot" >= 0 AND "taxAmountSnapshot" >= 0 AND "lineTotalInclusive" >= 0);

ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_cancelled_fields_check"
  CHECK (
    ("status" = 'CANCELLED' AND "cancelledAt" IS NOT NULL AND "cancelledReason" IS NOT NULL)
    OR ("status" != 'CANCELLED' AND "cancelledAt" IS NULL)
  );
