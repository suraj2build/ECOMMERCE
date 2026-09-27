-- CreateEnum
CREATE TYPE "PromotionDiscountType" AS ENUM ('PERCENTAGE', 'FLAT_AMOUNT');

-- CreateEnum
CREATE TYPE "PromotionRedemptionStatus" AS ENUM ('HOLD', 'CONVERTED', 'RELEASED');

-- CreateEnum
CREATE TYPE "StoreCreditHoldStatus" AS ENUM ('ACTIVE', 'CONVERTED', 'RELEASED');

-- AlterEnum
ALTER TYPE "StoreCreditEntryType" ADD VALUE 'REDEEM';

-- AlterTable
ALTER TABLE "checkout_session_lines" ADD COLUMN     "discountAmountSnapshot" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "checkout_sessions" ADD COLUMN     "promotionDiscountTotal" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "order_lines" ADD COLUMN     "discountAmountSnapshot" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "promotionDiscountTotal" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "promotion_types" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "promotion_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotions" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "promotionTypeId" TEXT NOT NULL,
    "isCoupon" BOOLEAN NOT NULL DEFAULT false,
    "couponCode" TEXT,
    "discountType" "PromotionDiscountType" NOT NULL,
    "discountValue" DECIMAL(10,2) NOT NULL,
    "maxDiscountAmount" DECIMAL(10,2),
    "minCartValue" DECIMAL(10,2),
    "stackGroup" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "usageLimitTotal" INTEGER,
    "usageCountTotal" INTEGER NOT NULL DEFAULT 0,
    "usageLimitPerCustomer" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promotions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotion_redemptions" (
    "id" TEXT NOT NULL,
    "promotionId" TEXT NOT NULL,
    "checkoutSessionId" TEXT NOT NULL,
    "customerId" TEXT,
    "guestSessionId" TEXT,
    "discountAmount" DECIMAL(10,2) NOT NULL,
    "status" "PromotionRedemptionStatus" NOT NULL DEFAULT 'HOLD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promotion_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_credit_redemption_holds" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "checkoutSessionId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "status" "StoreCreditHoldStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_credit_redemption_holds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "promotion_types_key_key" ON "promotion_types"("key");

-- CreateIndex
CREATE UNIQUE INDEX "promotions_couponCode_key" ON "promotions"("couponCode");

-- CreateIndex
CREATE INDEX "promotions_isActive_startsAt_endsAt_idx" ON "promotions"("isActive", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "promotion_redemptions_promotionId_customerId_idx" ON "promotion_redemptions"("promotionId", "customerId");

-- CreateIndex
CREATE INDEX "promotion_redemptions_status_idx" ON "promotion_redemptions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "promotion_redemptions_checkoutSessionId_promotionId_key" ON "promotion_redemptions"("checkoutSessionId", "promotionId");

-- CreateIndex
CREATE UNIQUE INDEX "store_credit_redemption_holds_checkoutSessionId_key" ON "store_credit_redemption_holds"("checkoutSessionId");

-- CreateIndex
CREATE INDEX "store_credit_redemption_holds_accountId_status_idx" ON "store_credit_redemption_holds"("accountId", "status");

-- CreateIndex
CREATE INDEX "store_credit_redemption_holds_status_expiresAt_idx" ON "store_credit_redemption_holds"("status", "expiresAt");

-- AddForeignKey
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_promotionTypeId_fkey" FOREIGN KEY ("promotionTypeId") REFERENCES "promotion_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_redemptions" ADD CONSTRAINT "promotion_redemptions_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "promotions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_redemptions" ADD CONSTRAINT "promotion_redemptions_checkoutSessionId_fkey" FOREIGN KEY ("checkoutSessionId") REFERENCES "checkout_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_redemptions" ADD CONSTRAINT "promotion_redemptions_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_credit_redemption_holds" ADD CONSTRAINT "store_credit_redemption_holds_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "store_credit_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_credit_redemption_holds" ADD CONSTRAINT "store_credit_redemption_holds_checkoutSessionId_fkey" FOREIGN KEY ("checkoutSessionId") REFERENCES "checkout_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
