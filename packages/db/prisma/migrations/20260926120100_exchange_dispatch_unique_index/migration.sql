-- Deliberately a SEPARATE migration from 20260926120000's own
-- `ALTER TYPE "InventoryTxnType" ADD VALUE 'EXCHANGE_DISPATCH'` -
-- Postgres forbids using a newly-added enum value in the same
-- transaction that added it, and `prisma migrate deploy` runs each
-- migration.sql file as one transaction. Splitting into two migrations
-- (rather than a non-transactional single file) keeps every migration
-- in this project uniformly transactional/re-run-safe.
--
-- Same defence-in-depth idiom as inventory_transactions_sale_orderline_once
-- (migration 20260924145356) - at most one legitimate EXCHANGE_DISPATCH
-- ledger posting may ever exist for a given Exchange.
-- InventoryService.recordExchangeDispatch() catches the resulting
-- unique-constraint violation and rethrows it as an explicit
-- InventoryIntegrityError, exactly as recordSale() already does for SALE.
CREATE UNIQUE INDEX "inventory_transactions_exchange_dispatch_once"
  ON "inventory_transactions" ("referenceId")
  WHERE "type" = 'EXCHANGE_DISPATCH' AND "referenceType" = 'EXCHANGE';
