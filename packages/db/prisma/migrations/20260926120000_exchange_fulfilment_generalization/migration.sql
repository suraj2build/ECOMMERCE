-- AlterEnum
ALTER TYPE "InventoryTxnType" ADD VALUE 'EXCHANGE_DISPATCH';

-- AlterTable
ALTER TABLE "order_fulfilments" ADD COLUMN     "exchangeId" TEXT;

-- AlterTable
ALTER TABLE "pick_tasks" ADD COLUMN     "exchangeId" TEXT,
ALTER COLUMN "orderLineId" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "order_fulfilments_exchangeId_key" ON "order_fulfilments"("exchangeId");

-- CreateIndex
CREATE UNIQUE INDEX "pick_tasks_exchangeId_key" ON "pick_tasks"("exchangeId");

-- AddForeignKey
ALTER TABLE "pick_tasks" ADD CONSTRAINT "pick_tasks_exchangeId_fkey" FOREIGN KEY ("exchangeId") REFERENCES "exchanges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_fulfilments" ADD CONSTRAINT "order_fulfilments_exchangeId_fkey" FOREIGN KEY ("exchangeId") REFERENCES "exchanges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- EXC-004 Option 2 repair (2026-09-26, Product Owner decision): PickTask
-- is generalized to a polymorphic fulfilment source - orderLineId
-- (normal OrderLine fulfilment) XOR exchangeId (an Exchange
-- replacement), never both, never neither. Both columns live on THIS
-- same row, so a plain CHECK constraint is sufficient here (unlike
-- OrderFulfilment's own exclusivity below, which is a genuine
-- cross-table invariant). Same XOR idiom as return_policies_scope_xor_check
-- / orders_identity_xor_check.
ALTER TABLE "pick_tasks" ADD CONSTRAINT "pick_tasks_source_xor_check"
  CHECK (("orderLineId" IS NOT NULL) != ("exchangeId" IS NOT NULL));

-- OrderFulfilment's own source exclusivity (a fulfilment is sourced
-- EITHER by its child order_lines OR by exchangeId, never both) is a
-- genuine CROSS-TABLE invariant - THIS row's exchangeId vs. OTHER rows'
-- order_lines.fulfilmentId - which a same-row CHECK constraint cannot
-- express. EXC-004 Option 2 explicitly permits "an equally strong
-- relational design" as an alternative; a trigger pair is the correct
-- SQL tool for a cross-table invariant Postgres CHECK constraints
-- cannot reach (this is a deliberate, documented deviation from this
-- codebase's usual pure-CHECK-constraint convention - not a shortcut).
--
-- Trigger 1: refuse attaching an order_line to an exchange-anchored
-- fulfilment. Trigger 2: refuse marking a fulfilment exchange-anchored
-- while it still has child order_lines. Together they make it
-- impossible - at the database level, regardless of which application
-- code path is used - for an OrderFulfilment to ever carry both a
-- non-null exchangeId and one or more child order_lines at once.
CREATE OR REPLACE FUNCTION check_fulfilment_line_exclusivity() RETURNS TRIGGER AS $$
DECLARE
  fulfilment_exchange_id TEXT;
BEGIN
  IF NEW."fulfilmentId" IS NOT NULL THEN
    SELECT "exchangeId" INTO fulfilment_exchange_id FROM "order_fulfilments" WHERE "id" = NEW."fulfilmentId";
    IF fulfilment_exchange_id IS NOT NULL THEN
      RAISE EXCEPTION 'order_lines.fulfilmentId (%) cannot reference an exchange-anchored OrderFulfilment (exchangeId %)', NEW."fulfilmentId", fulfilment_exchange_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER check_fulfilment_line_exclusivity_trigger
  BEFORE INSERT OR UPDATE OF "fulfilmentId" ON "order_lines"
  FOR EACH ROW EXECUTE FUNCTION check_fulfilment_line_exclusivity();

CREATE OR REPLACE FUNCTION check_exchange_fulfilment_exclusivity() RETURNS TRIGGER AS $$
DECLARE
  line_count INTEGER;
BEGIN
  IF NEW."exchangeId" IS NOT NULL THEN
    SELECT COUNT(*) INTO line_count FROM "order_lines" WHERE "fulfilmentId" = NEW."id";
    IF line_count > 0 THEN
      RAISE EXCEPTION 'order_fulfilments (%) cannot set exchangeId (%) while it still has % child order_line(s)', NEW."id", NEW."exchangeId", line_count;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER check_exchange_fulfilment_exclusivity_trigger
  BEFORE INSERT OR UPDATE OF "exchangeId" ON "order_fulfilments"
  FOR EACH ROW EXECUTE FUNCTION check_exchange_fulfilment_exclusivity();

