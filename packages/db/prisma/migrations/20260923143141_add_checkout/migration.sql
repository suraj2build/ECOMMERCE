-- CreateEnum
CREATE TYPE "ShippingRuleType" AS ENUM ('FLAT', 'FREE_ABOVE_THRESHOLD');

-- CreateEnum
CREATE TYPE "CheckoutSessionStatus" AS ENUM ('STARTED', 'RESERVED', 'CONFIRMED', 'PAYMENT_FAILED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "CheckoutPaymentMethod" AS ENUM ('PREPAID', 'COD');

-- CreateEnum
CREATE TYPE "PaymentProviderType" AS ENUM ('RAZORPAY', 'COD');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('INITIATED', 'AUTHORIZED', 'CAPTURED', 'CONFIRMED', 'FAILED', 'EXPIRED', 'REFUNDED', 'PARTIALLY_REFUNDED');

-- CreateTable
CREATE TABLE "shipping_rules" (
    "id" TEXT NOT NULL,
    "type" "ShippingRuleType" NOT NULL,
    "flatAmount" DECIMAL(10,2),
    "freeAboveThreshold" DECIMAL(10,2),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipping_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checkout_sessions" (
    "id" TEXT NOT NULL,
    "customerId" TEXT,
    "guestSessionId" TEXT,
    "contactName" TEXT NOT NULL,
    "contactMobile" TEXT NOT NULL,
    "contactEmail" TEXT,
    "billingAddress" JSONB NOT NULL,
    "shippingAddress" JSONB NOT NULL,
    "shippingStateCode" TEXT NOT NULL,
    "shippingMethodCode" TEXT NOT NULL DEFAULT 'STANDARD',
    "shippingCost" DECIMAL(10,2) NOT NULL,
    "subtotal" DECIMAL(10,2) NOT NULL,
    "taxAmount" DECIMAL(10,2) NOT NULL,
    "grandTotal" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "paymentMethod" "CheckoutPaymentMethod" NOT NULL,
    "status" "CheckoutSessionStatus" NOT NULL DEFAULT 'STARTED',
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "checkout_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checkout_session_lines" (
    "id" TEXT NOT NULL,
    "checkoutSessionId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPriceInclusive" DECIMAL(10,2) NOT NULL,
    "taxableValueSnapshot" DECIMAL(10,2) NOT NULL,
    "gstRatePercent" DECIMAL(5,2) NOT NULL,
    "taxAmountSnapshot" DECIMAL(10,2) NOT NULL,
    "lineTotalInclusive" DECIMAL(10,2) NOT NULL,
    "reservationId" TEXT,

    CONSTRAINT "checkout_session_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "checkoutSessionId" TEXT NOT NULL,
    "provider" "PaymentProviderType" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'INITIATED',
    "amount" DECIMAL(10,2) NOT NULL,
    "providerReferenceId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "checkout_sessions_idempotencyKey_key" ON "checkout_sessions"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "payments_checkoutSessionId_key" ON "payments"("checkoutSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_idempotencyKey_key" ON "payments"("idempotencyKey");

-- AddForeignKey
ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkout_session_lines" ADD CONSTRAINT "checkout_session_lines_checkoutSessionId_fkey" FOREIGN KEY ("checkoutSessionId") REFERENCES "checkout_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkout_session_lines" ADD CONSTRAINT "checkout_session_lines_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkout_session_lines" ADD CONSTRAINT "checkout_session_lines_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_checkoutSessionId_fkey" FOREIGN KEY ("checkoutSessionId") REFERENCES "checkout_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Defense-in-depth CHECK constraints (M13, mirrors the M08/M11/M12
-- pattern): a checkout session belongs to exactly one identity (a
-- logged-in customer XOR a guest session, never both and never
-- neither, same as Cart/Wishlist), line quantities/amounts stay
-- positive, and a shipping rule always carries the field its own type
-- actually needs (never a FLAT rule with no flatAmount, or a
-- FREE_ABOVE_THRESHOLD rule with no threshold).
ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_owner_xor_check"
  CHECK (("customerId" IS NOT NULL) != ("guestSessionId" IS NOT NULL));

ALTER TABLE "checkout_session_lines" ADD CONSTRAINT "checkout_session_lines_quantity_positive_check"
  CHECK ("quantity" > 0);

ALTER TABLE "checkout_session_lines" ADD CONSTRAINT "checkout_session_lines_amounts_nonnegative_check"
  CHECK ("unitPriceInclusive" >= 0 AND "taxableValueSnapshot" >= 0 AND "taxAmountSnapshot" >= 0 AND "lineTotalInclusive" >= 0);

ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_nonnegative_check"
  CHECK ("amount" >= 0);

ALTER TABLE "shipping_rules" ADD CONSTRAINT "shipping_rules_type_fields_check"
  CHECK (
    ("type" = 'FLAT' AND "flatAmount" IS NOT NULL)
    OR ("type" = 'FREE_ABOVE_THRESHOLD' AND "freeAboveThreshold" IS NOT NULL)
  );
