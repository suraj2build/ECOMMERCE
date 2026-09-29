-- CreateEnum
CREATE TYPE "GiftCardStatus" AS ENUM ('ACTIVE', 'DISABLED', 'DEPLETED');

-- CreateEnum
CREATE TYPE "GiftCardLedgerEntryType" AS ENUM ('ISSUE', 'REDEEM', 'REFUND_TO_GIFT_CARD', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "GiftCardHoldStatus" AS ENUM ('ACTIVE', 'CONVERTED', 'RELEASED');

-- CreateEnum
CREATE TYPE "GiftCardPurchaseStatus" AS ENUM ('INITIATED', 'CAPTURED', 'FAILED', 'EXPIRED');

-- AlterTable
ALTER TABLE "checkout_sessions" ADD COLUMN     "giftCardApplied" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "giftCardApplied" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "payment_events" ADD COLUMN     "giftCardPurchaseId" TEXT;

-- AlterTable
ALTER TABLE "promotions" ADD COLUMN     "giftCardCompatible" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "gift_cards" (
    "id" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "codeLast4" TEXT NOT NULL,
    "status" "GiftCardStatus" NOT NULL DEFAULT 'ACTIVE',
    "initialValue" DECIMAL(10,2) NOT NULL,
    "balance" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "purchasedByCustomerId" TEXT,
    "purchasedByGuestSessionId" TEXT,
    "recipientEmail" TEXT,
    "issuedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "disabledAt" TIMESTAMP(3),
    "disabledReason" TEXT,
    "disabledByStaffId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gift_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gift_card_ledger_entries" (
    "id" TEXT NOT NULL,
    "giftCardId" TEXT NOT NULL,
    "type" "GiftCardLedgerEntryType" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "balanceAfter" DECIMAL(10,2) NOT NULL,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "reason" TEXT,
    "actorStaffId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gift_card_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gift_card_redemption_holds" (
    "id" TEXT NOT NULL,
    "giftCardId" TEXT NOT NULL,
    "checkoutSessionId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "status" "GiftCardHoldStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gift_card_redemption_holds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gift_card_purchases" (
    "id" TEXT NOT NULL,
    "customerId" TEXT,
    "guestSessionId" TEXT,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "recipientEmail" TEXT,
    "status" "GiftCardPurchaseStatus" NOT NULL DEFAULT 'INITIATED',
    "provider" "PaymentProviderType" NOT NULL DEFAULT 'RAZORPAY',
    "providerReferenceId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "giftCardId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gift_card_purchases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "gift_cards_codeHash_key" ON "gift_cards"("codeHash");

-- CreateIndex
CREATE INDEX "gift_cards_status_idx" ON "gift_cards"("status");

-- CreateIndex
CREATE INDEX "gift_cards_purchasedByCustomerId_idx" ON "gift_cards"("purchasedByCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "gift_card_ledger_entries_idempotencyKey_key" ON "gift_card_ledger_entries"("idempotencyKey");

-- CreateIndex
CREATE INDEX "gift_card_ledger_entries_giftCardId_idx" ON "gift_card_ledger_entries"("giftCardId");

-- CreateIndex
CREATE INDEX "gift_card_ledger_entries_giftCardId_type_idx" ON "gift_card_ledger_entries"("giftCardId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "gift_card_redemption_holds_checkoutSessionId_key" ON "gift_card_redemption_holds"("checkoutSessionId");

-- CreateIndex
CREATE INDEX "gift_card_redemption_holds_giftCardId_status_idx" ON "gift_card_redemption_holds"("giftCardId", "status");

-- CreateIndex
CREATE INDEX "gift_card_redemption_holds_status_expiresAt_idx" ON "gift_card_redemption_holds"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "gift_card_purchases_idempotencyKey_key" ON "gift_card_purchases"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "gift_card_purchases_giftCardId_key" ON "gift_card_purchases"("giftCardId");

-- CreateIndex
CREATE INDEX "gift_card_purchases_status_idx" ON "gift_card_purchases"("status");

-- AddForeignKey
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_giftCardPurchaseId_fkey" FOREIGN KEY ("giftCardPurchaseId") REFERENCES "gift_card_purchases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gift_cards" ADD CONSTRAINT "gift_cards_purchasedByCustomerId_fkey" FOREIGN KEY ("purchasedByCustomerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gift_cards" ADD CONSTRAINT "gift_cards_disabledByStaffId_fkey" FOREIGN KEY ("disabledByStaffId") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gift_card_ledger_entries" ADD CONSTRAINT "gift_card_ledger_entries_giftCardId_fkey" FOREIGN KEY ("giftCardId") REFERENCES "gift_cards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gift_card_ledger_entries" ADD CONSTRAINT "gift_card_ledger_entries_actorStaffId_fkey" FOREIGN KEY ("actorStaffId") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gift_card_redemption_holds" ADD CONSTRAINT "gift_card_redemption_holds_giftCardId_fkey" FOREIGN KEY ("giftCardId") REFERENCES "gift_cards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gift_card_redemption_holds" ADD CONSTRAINT "gift_card_redemption_holds_checkoutSessionId_fkey" FOREIGN KEY ("checkoutSessionId") REFERENCES "checkout_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gift_card_purchases" ADD CONSTRAINT "gift_card_purchases_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gift_card_purchases" ADD CONSTRAINT "gift_card_purchases_giftCardId_fkey" FOREIGN KEY ("giftCardId") REFERENCES "gift_cards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Financial sanity, the same discipline as store_credit_entries/store_credit_accounts,
-- with one deliberate difference: ADJUSTMENT is the one entry type whose amount is a
-- SIGNED delta (mirroring LoyaltyLedgerEntry.pointsDelta's own signed-Int precedent for
-- manual corrections) - every other type stays a positive magnitude with direction
-- implied by `type`, and the denormalized balance cache can never go negative.
ALTER TABLE "gift_card_ledger_entries" ADD CONSTRAINT "gift_card_ledger_entries_amount_nonzero_check"
  CHECK ("type" = 'ADJUSTMENT' OR "amount" > 0);
ALTER TABLE "gift_card_ledger_entries" ADD CONSTRAINT "gift_card_ledger_entries_adjustment_amount_nonzero_check"
  CHECK ("type" != 'ADJUSTMENT' OR "amount" != 0);
ALTER TABLE "gift_cards" ADD CONSTRAINT "gift_cards_balance_non_negative_check"
  CHECK ("balance" >= 0);
ALTER TABLE "gift_cards" ADD CONSTRAINT "gift_cards_initial_value_positive_check"
  CHECK ("initialValue" > 0);
ALTER TABLE "gift_card_redemption_holds" ADD CONSTRAINT "gift_card_redemption_holds_amount_positive_check"
  CHECK ("amount" > 0);
ALTER TABLE "gift_card_purchases" ADD CONSTRAINT "gift_card_purchases_amount_positive_check"
  CHECK ("amount" > 0);
