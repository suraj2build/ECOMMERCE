-- 2026-09-27 LOY-006 resolution (Product Owner decision): loyalty points
-- earned on a purchase are PENDING/non-redeemable until the qualifying
-- OrderLine has been DELIVERED *and* its own return/exchange eligibility
-- window has closed. Entitlement moves from being calculated per ORDER
-- (one EARN entry, `qualifyingOrderId` unique) to being calculated per
-- ORDER LINE (one EARN entry, `qualifyingOrderLineId` unique), since
-- vesting must be line-aware (different lines can deliver, and close
-- their own return window, on different dates).
--
-- Dev-database-only data reset: this system is NOT yet production-
-- certified/live (see CLAUDE.md Sec.0) - no real customer loyalty ledger
-- exists anywhere. The pre-existing EARN rows in this development/test
-- database were all created under the OLD immediately-available,
-- order-level model and have no line-level attribution to migrate them
-- into (the old model never recorded which line "owns" which portion of
-- an order-level batch beyond an already-applied proportional-share
-- calculation at reversal time - there is nothing safe to reconstruct
-- from). Rather than fabricate a line attribution or silently leave
-- orphaned rows that would violate the new NOT-NULL-in-practice
-- `qualifyingOrderLineId` anchor, this migration clears the loyalty
-- ledger tables and their derived account balances/tiers, so every
-- account starts clean under the new lifecycle. This is explicitly safe
-- ONLY because this is a development/test database with no production
-- data; a real production migration would require a different, explicit
-- data-migration plan (out of scope here, since no production system
-- exists yet to migrate).
TRUNCATE TABLE "loyalty_point_allocations", "loyalty_ledger_entries";
TRUNCATE TABLE "loyalty_redemption_holds";
UPDATE "loyalty_accounts" SET "balance" = 0, "lifetimeEarnedPoints" = 0, "currentTierId" = NULL;
UPDATE "orders" SET "loyaltyPointsEarned" = 0, "loyaltyPointsRedeemed" = 0, "loyaltyRedemptionValue" = 0;

-- CreateEnum
CREATE TYPE "LoyaltyEntitlementStatus" AS ENUM ('PENDING', 'VESTED', 'CANCELLED');

-- DropForeignKey
ALTER TABLE "loyalty_ledger_entries" DROP CONSTRAINT "loyalty_ledger_entries_qualifyingOrderId_fkey";

-- DropIndex
DROP INDEX "loyalty_ledger_entries_qualifyingOrderId_key";

-- AlterTable
ALTER TABLE "loyalty_ledger_entries" DROP COLUMN "qualifyingOrderId",
ADD COLUMN     "qualifyingOrderLineId" TEXT,
ADD COLUMN     "reversalExchangeId" TEXT,
ADD COLUMN     "vestedAt" TIMESTAMP(3),
ADD COLUMN     "vestingStatus" "LoyaltyEntitlementStatus";

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_ledger_entries_qualifyingOrderLineId_key" ON "loyalty_ledger_entries"("qualifyingOrderLineId");

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_ledger_entries_reversalExchangeId_key" ON "loyalty_ledger_entries"("reversalExchangeId");

-- CreateIndex
CREATE INDEX "loyalty_ledger_entries_type_vestingStatus_idx" ON "loyalty_ledger_entries"("type", "vestingStatus");

-- AddForeignKey
ALTER TABLE "loyalty_ledger_entries" ADD CONSTRAINT "loyalty_ledger_entries_qualifyingOrderLineId_fkey" FOREIGN KEY ("qualifyingOrderLineId") REFERENCES "order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_ledger_entries" ADD CONSTRAINT "loyalty_ledger_entries_reversalExchangeId_fkey" FOREIGN KEY ("reversalExchangeId") REFERENCES "exchanges"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
