-- CreateEnum
CREATE TYPE "RefundTriggerType" AS ENUM ('CANCELLATION', 'RETURN');

-- CreateEnum
CREATE TYPE "RefundMethod" AS ENUM ('ORIGINAL_PAYMENT_METHOD', 'STORE_CREDIT');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "StoreCreditEntryType" AS ENUM ('ISSUE');

-- CreateTable
CREATE TABLE "refunds" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "returnLineId" TEXT,
    "paymentId" TEXT,
    "triggerType" "RefundTriggerType" NOT NULL,
    "method" "RefundMethod" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
    "providerRefundId" TEXT,
    "creditNoteId" TEXT,
    "storeCreditEntryId" TEXT,
    "failureReason" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "initiatedByStaffId" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_credit_accounts" (
    "id" TEXT NOT NULL,
    "customerId" TEXT,
    "guestSessionId" TEXT,
    "balance" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_credit_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_credit_entries" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "type" "StoreCreditEntryType" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "actorStaffId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "store_credit_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "refunds_orderLineId_key" ON "refunds"("orderLineId");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_returnLineId_key" ON "refunds"("returnLineId");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_creditNoteId_key" ON "refunds"("creditNoteId");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_storeCreditEntryId_key" ON "refunds"("storeCreditEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_idempotencyKey_key" ON "refunds"("idempotencyKey");

-- CreateIndex
CREATE INDEX "refunds_orderId_idx" ON "refunds"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "store_credit_accounts_customerId_key" ON "store_credit_accounts"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "store_credit_accounts_guestSessionId_key" ON "store_credit_accounts"("guestSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "store_credit_entries_idempotencyKey_key" ON "store_credit_entries"("idempotencyKey");

-- CreateIndex
CREATE INDEX "store_credit_entries_accountId_idx" ON "store_credit_entries"("accountId");

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_returnLineId_fkey" FOREIGN KEY ("returnLineId") REFERENCES "return_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_creditNoteId_fkey" FOREIGN KEY ("creditNoteId") REFERENCES "credit_notes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_storeCreditEntryId_fkey" FOREIGN KEY ("storeCreditEntryId") REFERENCES "store_credit_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_initiatedByStaffId_fkey" FOREIGN KEY ("initiatedByStaffId") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_credit_accounts" ADD CONSTRAINT "store_credit_accounts_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_credit_entries" ADD CONSTRAINT "store_credit_entries_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "store_credit_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_credit_entries" ADD CONSTRAINT "store_credit_entries_actorStaffId_fkey" FOREIGN KEY ("actorStaffId") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Guest-or-customer ownership XOR (REF-002/specs/33): same idiom as
-- orders_identity_xor_check - a store-credit account belongs to exactly
-- one identity, never both and never neither.
ALTER TABLE "store_credit_accounts" ADD CONSTRAINT "store_credit_accounts_identity_xor_check"
  CHECK (("customerId" IS NOT NULL) != ("guestSessionId" IS NOT NULL));

-- Financial sanity: a refund/store-credit amount is always a positive sum.
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_amount_positive_check"
  CHECK ("amount" > 0);
ALTER TABLE "store_credit_entries" ADD CONSTRAINT "store_credit_entries_amount_positive_check"
  CHECK ("amount" > 0);
ALTER TABLE "store_credit_accounts" ADD CONSTRAINT "store_credit_accounts_balance_non_negative_check"
  CHECK ("balance" >= 0);
