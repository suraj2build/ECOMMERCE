-- CreateEnum
CREATE TYPE "LoyaltyLedgerEntryType" AS ENUM ('EARN', 'REDEEM', 'REVERSE', 'EXPIRE', 'ADJUST');

-- CreateEnum
CREATE TYPE "LoyaltyHoldStatus" AS ENUM ('ACTIVE', 'CONVERTED', 'RELEASED');

-- AlterTable
ALTER TABLE "checkout_sessions" ADD COLUMN     "loyaltyPointsRedeemed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "loyaltyRedemptionValue" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "storeCreditApplied" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "loyaltyPointsEarned" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "loyaltyPointsRedeemed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "loyaltyRedemptionValue" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "storeCreditApplied" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "loyalty_accounts" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "lifetimeEarnedPoints" INTEGER NOT NULL DEFAULT 0,
    "currentTierId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loyalty_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_tiers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "minLifetimePoints" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loyalty_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_ledger_entries" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "type" "LoyaltyLedgerEntryType" NOT NULL,
    "pointsDelta" INTEGER NOT NULL,
    "remainingPoints" INTEGER,
    "expiresAt" TIMESTAMP(3),
    "qualifyingOrderId" TEXT,
    "reversalOrderLineId" TEXT,
    "reversalReturnLineId" TEXT,
    "reason" TEXT NOT NULL,
    "actorStaffId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loyalty_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_point_allocations" (
    "id" TEXT NOT NULL,
    "spendingEntryId" TEXT NOT NULL,
    "earnEntryId" TEXT NOT NULL,
    "pointsConsumed" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loyalty_point_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_redemption_holds" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "checkoutSessionId" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "value" DECIMAL(10,2) NOT NULL,
    "status" "LoyaltyHoldStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loyalty_redemption_holds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_accounts_customerId_key" ON "loyalty_accounts"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_tiers_name_key" ON "loyalty_tiers"("name");

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_tiers_sortOrder_key" ON "loyalty_tiers"("sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_ledger_entries_qualifyingOrderId_key" ON "loyalty_ledger_entries"("qualifyingOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_ledger_entries_reversalOrderLineId_key" ON "loyalty_ledger_entries"("reversalOrderLineId");

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_ledger_entries_reversalReturnLineId_key" ON "loyalty_ledger_entries"("reversalReturnLineId");

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_ledger_entries_idempotencyKey_key" ON "loyalty_ledger_entries"("idempotencyKey");

-- CreateIndex
CREATE INDEX "loyalty_ledger_entries_accountId_idx" ON "loyalty_ledger_entries"("accountId");

-- CreateIndex
CREATE INDEX "loyalty_ledger_entries_accountId_type_idx" ON "loyalty_ledger_entries"("accountId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_point_allocations_spendingEntryId_earnEntryId_key" ON "loyalty_point_allocations"("spendingEntryId", "earnEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_redemption_holds_checkoutSessionId_key" ON "loyalty_redemption_holds"("checkoutSessionId");

-- CreateIndex
CREATE INDEX "loyalty_redemption_holds_accountId_status_idx" ON "loyalty_redemption_holds"("accountId", "status");

-- CreateIndex
CREATE INDEX "loyalty_redemption_holds_status_expiresAt_idx" ON "loyalty_redemption_holds"("status", "expiresAt");

-- AddForeignKey
ALTER TABLE "loyalty_accounts" ADD CONSTRAINT "loyalty_accounts_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_accounts" ADD CONSTRAINT "loyalty_accounts_currentTierId_fkey" FOREIGN KEY ("currentTierId") REFERENCES "loyalty_tiers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_ledger_entries" ADD CONSTRAINT "loyalty_ledger_entries_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "loyalty_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_ledger_entries" ADD CONSTRAINT "loyalty_ledger_entries_actorStaffId_fkey" FOREIGN KEY ("actorStaffId") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_ledger_entries" ADD CONSTRAINT "loyalty_ledger_entries_qualifyingOrderId_fkey" FOREIGN KEY ("qualifyingOrderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_ledger_entries" ADD CONSTRAINT "loyalty_ledger_entries_reversalOrderLineId_fkey" FOREIGN KEY ("reversalOrderLineId") REFERENCES "order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_ledger_entries" ADD CONSTRAINT "loyalty_ledger_entries_reversalReturnLineId_fkey" FOREIGN KEY ("reversalReturnLineId") REFERENCES "return_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_point_allocations" ADD CONSTRAINT "loyalty_point_allocations_spendingEntryId_fkey" FOREIGN KEY ("spendingEntryId") REFERENCES "loyalty_ledger_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_point_allocations" ADD CONSTRAINT "loyalty_point_allocations_earnEntryId_fkey" FOREIGN KEY ("earnEntryId") REFERENCES "loyalty_ledger_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_redemption_holds" ADD CONSTRAINT "loyalty_redemption_holds_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "loyalty_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_redemption_holds" ADD CONSTRAINT "loyalty_redemption_holds_checkoutSessionId_fkey" FOREIGN KEY ("checkoutSessionId") REFERENCES "checkout_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
