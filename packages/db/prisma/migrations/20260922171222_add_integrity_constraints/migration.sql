-- DropForeignKey
ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_actorStaffId_fkey";

-- DropForeignKey
ALTER TABLE "inventory_transactions" DROP CONSTRAINT "inventory_transactions_actorStaffId_fkey";

-- DropForeignKey
ALTER TABLE "inventory_transactions" DROP CONSTRAINT "inventory_transactions_coApproverStaffId_fkey";

-- DropForeignKey
ALTER TABLE "prices" DROP CONSTRAINT "prices_colourId_fkey";

-- DropForeignKey
ALTER TABLE "prices" DROP CONSTRAINT "prices_styleId_fkey";

-- DropForeignKey
ALTER TABLE "purchase_orders" DROP CONSTRAINT "purchase_orders_approvedByStaffId_fkey";

-- DropForeignKey
ALTER TABLE "purchase_orders" DROP CONSTRAINT "purchase_orders_submittedByStaffId_fkey";

-- DropForeignKey
ALTER TABLE "styles" DROP CONSTRAINT "styles_publishedByStaffId_fkey";

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipt_lines_grnId_poLineId_key" ON "goods_receipt_lines"("grnId", "poLineId");

-- CreateIndex
CREATE UNIQUE INDEX "size_chart_entries_sizeChartId_sizeLabel_key" ON "size_chart_entries"("sizeChartId", "sizeLabel");

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorStaffId_fkey" FOREIGN KEY ("actorStaffId") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "styles" ADD CONSTRAINT "styles_publishedByStaffId_fkey" FOREIGN KEY ("publishedByStaffId") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_submittedByStaffId_fkey" FOREIGN KEY ("submittedByStaffId") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_approvedByStaffId_fkey" FOREIGN KEY ("approvedByStaffId") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_actorStaffId_fkey" FOREIGN KEY ("actorStaffId") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_coApproverStaffId_fkey" FOREIGN KEY ("coApproverStaffId") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prices" ADD CONSTRAINT "prices_styleId_fkey" FOREIGN KEY ("styleId") REFERENCES "styles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prices" ADD CONSTRAINT "prices_colourId_fkey" FOREIGN KEY ("colourId") REFERENCES "colours"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written below this point (certification pass, 2026-09-22): CHECK
-- constraints are not expressible in Prisma's schema.prisma DSL, so they
-- exist only here, not as a `@@` attribute. Per the review instruction to
-- prefer database-level protection for important invariants over relying
-- exclusively on application code. If a future `prisma migrate dev` diff
-- looks unexpected, it is because these constraints have no schema.prisma
-- representation to diff against - that is expected, not drift to "fix" by
-- dropping them. Every constraint below already holds for all data
-- currently reachable through the application's own validation; this adds
-- a database-level backstop, not a behavior change.
-- ---------------------------------------------------------------------------

-- InventoryBalance: no bucket may go negative, and - the single most
-- safety-critical invariant in the whole platform (INV-003, ADR-0012) -
-- reserved can never exceed onHand. The application-level row lock in
-- InventoryService.reserve() already enforces this under concurrency
-- (see test/integration/inventory-concurrency.test.ts); this is the
-- database-level backstop for every other write path, present and future.
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_onHand_nonneg" CHECK ("onHand" >= 0);
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_reserved_nonneg" CHECK ("reserved" >= 0);
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_damaged_nonneg" CHECK ("damaged" >= 0);
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_returnPending_nonneg" CHECK ("returnPending" >= 0);
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_inTransit_nonneg" CHECK ("inTransit" >= 0);
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_reserved_le_onHand" CHECK ("reserved" <= "onHand");

-- Ledger and reservation/transfer rows: quantity is always positive - the
-- transaction `type` (or reservation/transfer's own semantics) determines
-- directional effect, never the sign of quantity itself.
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_quantity_positive" CHECK ("quantity" > 0);

-- Purchase orders: ordered/unit cost must be positive; received/total
-- amounts can be zero (not yet received / not yet costed) but never negative.
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_orderedQty_positive" CHECK ("orderedQty" > 0);
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_unitCost_positive" CHECK ("unitCost" > 0);
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_receivedQty_nonneg" CHECK ("receivedQty" >= 0);
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_totalCost_nonneg" CHECK ("totalCost" >= 0);
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_approvalThreshold_nonneg" CHECK ("approvalThresholdApplied" IS NULL OR "approvalThresholdApplied" >= 0);

-- GRN lines: every quantity bucket is non-negative (short/excess/accepted/
-- damaged/rejected can legitimately be zero, never negative).
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_expectedQty_nonneg" CHECK ("expectedQty" >= 0);
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_receivedQty_nonneg" CHECK ("receivedQty" >= 0);
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_acceptedQty_nonneg" CHECK ("acceptedQty" >= 0);
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_shortQty_nonneg" CHECK ("shortQty" >= 0);
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_excessQty_nonneg" CHECK ("excessQty" >= 0);
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_damagedQty_nonneg" CHECK ("damagedQty" >= 0);
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_rejectedQty_nonneg" CHECK ("rejectedQty" >= 0);
-- accepted + damaged + rejected must equal the physically received quantity
-- (GrnService already validates this pre-transaction; this is the backstop).
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_qty_balance" CHECK ("acceptedQty" + "damagedQty" + "rejectedQty" = "receivedQty");

-- Pricing (CAT-001): MRP and selling price must be positive, and selling
-- price can never exceed MRP - the database-level backstop for the same
-- rule CatalogService.validatePriceInput already enforces in application code.
ALTER TABLE "prices" ADD CONSTRAINT "prices_mrp_positive" CHECK ("mrp" > 0);
ALTER TABLE "prices" ADD CONSTRAINT "prices_sellingPrice_positive" CHECK ("sellingPrice" > 0);
ALTER TABLE "prices" ADD CONSTRAINT "prices_sellingPrice_le_mrp" CHECK ("sellingPrice" <= "mrp");

-- Supplier-quoted cost must be positive.
ALTER TABLE "supplier_skus" ADD CONSTRAINT "supplier_skus_cost_positive" CHECK ("cost" > 0);

