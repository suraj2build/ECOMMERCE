-- Independent-review repair pass (M16, 2026-09-24): defence-in-depth
-- database-enforced invariant - at most one legitimate SALE ledger
-- posting may ever exist for a given OrderLine. Not representable in
-- schema.prisma's declarative DSL (a partial/conditional unique index),
-- same category as the hand-written CHECK constraints already added in
-- 20260922171222_add_integrity_constraints - Prisma's schema.prisma is
-- not touched by this migration, and `prisma format`/`validate` will not
-- flag it as drift.
--
-- Scoped deliberately narrow (type = 'SALE' AND referenceType =
-- 'ORDER_LINE' only) - a blanket uniqueness constraint on
-- (type, referenceType, referenceId) across every ledger entry would
-- break legitimate existing patterns elsewhere in this ledger, e.g. a
-- single multi-line GRN posts multiple RECEIPT transactions that all
-- share the same referenceId (the GRN's own id) - see
-- GrnService/InventoryService.postReceipt.
--
-- InventoryService.recordSale() (services/commerce-api/src/modules/
-- inventory/service.ts) catches the resulting unique-constraint
-- violation and rethrows it as an explicit InventoryIntegrityError
-- (409 INVENTORY_INTEGRITY_VIOLATION), never a raw/opaque 500 - the
-- whole transaction rolls back, so a rejected duplicate SALE attempt
-- leaves no partial trace (no ledger row, no balance mutation).
CREATE UNIQUE INDEX "inventory_transactions_sale_orderline_once"
  ON "inventory_transactions" ("referenceId")
  WHERE "type" = 'SALE' AND "referenceType" = 'ORDER_LINE';
