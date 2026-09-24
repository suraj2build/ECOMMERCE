-- CreateEnum
CREATE TYPE "OrderInvoiceStatus" AS ENUM ('PENDING', 'ISSUED', 'FAILED');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "invoiceAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "invoiceFailureReason" TEXT,
ADD COLUMN     "invoiceStatus" "OrderInvoiceStatus" NOT NULL DEFAULT 'PENDING';

-- CreateIndex
CREATE INDEX "orders_invoiceStatus_invoiceId_idx" ON "orders"("invoiceStatus", "invoiceId");

-- Defense-in-depth CHECK constraint (independent-review finding #2):
-- invoiceStatus and invoiceId must never disagree - ISSUED always
-- carries a real invoiceId, and PENDING/FAILED never do. This backstops
-- OrderService's own application-level discipline the same way every
-- other financial-state CHECK constraint in this schema does.
ALTER TABLE "orders" ADD CONSTRAINT "orders_invoice_status_consistency_check"
  CHECK (
    ("invoiceStatus" = 'ISSUED' AND "invoiceId" IS NOT NULL)
    OR ("invoiceStatus" != 'ISSUED' AND "invoiceId" IS NULL)
  );
