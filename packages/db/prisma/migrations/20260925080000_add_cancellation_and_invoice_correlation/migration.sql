-- M18 (specs/17-cancellation.md): two additive, nullable columns.
-- Both are safe against existing data - NULL is allowed under a unique
-- index/constraint any number of times in Postgres, so no backfill is
-- required and no existing row can violate either constraint.

-- AlterTable
ALTER TABLE "invoice_lines" ADD COLUMN "orderLineId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "invoice_lines_orderLineId_key" ON "invoice_lines"("orderLineId");

-- AlterTable
ALTER TABLE "order_lines" ADD COLUMN "cancellationIdempotencyKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "order_lines_cancellationIdempotencyKey_key" ON "order_lines"("cancellationIdempotencyKey");
