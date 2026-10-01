-- P1 decision D-4 (Product Owner, 2026-10-01): make inventory adjustments
-- replayable from the ledger.
--
-- Before this migration, InventoryService.postAdjustment wrote every manual
-- and pick-shortfall adjustment as type ADJUSTMENT with quantity
-- |quantityDelta|, so the ledger could not say whether stock went up or
-- down, and reconcileBalance reported a match for any balance that had ever
-- been adjusted.
--
-- 1. New adjustments carry their direction in their type (ADJUSTMENT_IN /
--    ADJUSTMENT_OUT), keeping quantity positive as every other ledger type
--    does (inventory_transactions_quantity_positive is unchanged).
-- 2. Legacy ADJUSTMENT rows are NOT modified: the ledger is append-only.
--    Where the original `inventory.adjust` audit rows settle the direction
--    without guessing, it is recorded beside the row in
--    inventory_adjustment_resolutions. Every other legacy row stays
--    unresolved, and reconciliation reports that balance as UNVERIFIABLE.
--
-- Postgres 12+ allows ALTER TYPE ... ADD VALUE inside the migration's
-- transaction; the new values are not used in this migration.

-- CreateEnum
CREATE TYPE "InventoryAdjustmentDirection" AS ENUM ('INCREASE', 'DECREASE');

-- AlterEnum
ALTER TYPE "InventoryTxnType" ADD VALUE 'ADJUSTMENT_IN';
ALTER TYPE "InventoryTxnType" ADD VALUE 'ADJUSTMENT_OUT';

-- CreateTable
CREATE TABLE "inventory_adjustment_resolutions" (
    "transactionId" TEXT NOT NULL,
    "direction" "InventoryAdjustmentDirection" NOT NULL,
    "evidence" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_adjustment_resolutions_pkey" PRIMARY KEY ("transactionId")
);

-- AddForeignKey
ALTER TABLE "inventory_adjustment_resolutions" ADD CONSTRAINT "inventory_adjustment_resolutions_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "inventory_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- BEGIN D-4 LEGACY ADJUSTMENT RESOLUTION
-- Every legacy adjustment was written in the same database transaction as
-- exactly one `inventory.adjust` audit row (entityId '<skuId>/<locationId>',
-- same actor, newValue.quantityDelta = the signed delta, newValue.reason =
-- the ledger row's reason). Timestamps cannot pair them (each row is stamped
-- separately), so rows are grouped by (SKU/location, actor, quantity,
-- reason) instead. A group is resolved only when it has exactly as many
-- audit rows as ledger rows AND every one of those audit rows has the same
-- sign: then every ledger row in the group has that direction, whichever
-- audit row it was written with. A group with no audit rows, a different
-- count, or mixed signs is left unresolved. Nothing is inferred from reason
-- text or from balances. Safe to re-run (ON CONFLICT DO NOTHING).
WITH legacy AS (
  SELECT "id", "skuId" || '/' || "locationId" AS entity, "actorStaffId" AS actor, "quantity", "reason"
  FROM "inventory_transactions"
  WHERE "type" = 'ADJUSTMENT'
),
evidence AS (
  SELECT "entityId" AS entity, "actorStaffId" AS actor,
         abs(("newValue"->>'quantityDelta')::int) AS quantity,
         "newValue"->>'reason' AS reason,
         sign(("newValue"->>'quantityDelta')::int) AS sgn
  FROM "audit_logs"
  WHERE "action" = 'inventory.adjust'
    AND "entityType" = 'InventoryBalance'
    AND jsonb_typeof("newValue"->'quantityDelta') = 'number'
    AND ("newValue"->>'quantityDelta') ~ '^-?[0-9]+$'
),
legacy_groups AS (
  SELECT entity, actor, quantity, reason, count(*) AS n
  FROM legacy GROUP BY entity, actor, quantity, reason
),
evidence_groups AS (
  SELECT entity, actor, quantity, reason, count(*) AS n,
         count(*) FILTER (WHERE sgn > 0) AS increases,
         count(*) FILTER (WHERE sgn < 0) AS decreases
  FROM evidence GROUP BY entity, actor, quantity, reason
)
INSERT INTO "inventory_adjustment_resolutions" ("transactionId", "direction", "evidence")
SELECT l."id",
       CASE WHEN eg.decreases = 0 THEN 'INCREASE'::"InventoryAdjustmentDirection" ELSE 'DECREASE'::"InventoryAdjustmentDirection" END,
       format('inventory.adjust audit: all %s matching rows (same SKU/location, actor, quantity and reason) are %s', eg.n,
              CASE WHEN eg.decreases = 0 THEN 'increases' ELSE 'decreases' END)
FROM legacy l
JOIN legacy_groups lg
  ON lg.entity = l.entity AND lg.actor IS NOT DISTINCT FROM l.actor AND lg.quantity = l.quantity AND lg.reason IS NOT DISTINCT FROM l.reason
JOIN evidence_groups eg
  ON eg.entity = l.entity AND eg.actor IS NOT DISTINCT FROM l.actor AND eg.quantity = l.quantity AND eg.reason IS NOT DISTINCT FROM l.reason
WHERE eg.n = lg.n
  AND (eg.increases = 0 OR eg.decreases = 0)
  AND eg.increases + eg.decreases = eg.n
ON CONFLICT ("transactionId") DO NOTHING;
-- END D-4 LEGACY ADJUSTMENT RESOLUTION
