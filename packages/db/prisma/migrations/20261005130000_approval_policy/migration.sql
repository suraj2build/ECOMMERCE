-- AO-D4 (Product Owner, 2026-10-05): one approval policy with an optional, audited owner approval.
-- CreateEnum
CREATE TYPE "ApprovalKind" AS ENUM ('PURCHASE_ORDER', 'STOCK_ADJUSTMENT', 'RECEIVING_QC', 'PICK_SHORTFALL');

-- CreateTable
CREATE TABLE "approval_policies" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "ownerApprovalEnabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByStaffId" TEXT,

    CONSTRAINT "approval_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_owners" (
    "staffUserId" TEXT NOT NULL,
    "addedByStaffId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_owners_pkey" PRIMARY KEY ("staffUserId")
);

-- CreateTable
CREATE TABLE "approval_records" (
    "id" TEXT NOT NULL,
    "kind" "ApprovalKind" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "requestedByStaffId" TEXT NOT NULL,
    "approvedByStaffId" TEXT NOT NULL,
    "selfApproved" BOOLEAN NOT NULL,
    "reason" TEXT,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "approval_records_createdAt_idx" ON "approval_records"("createdAt");

-- CreateIndex
CREATE INDEX "approval_records_selfApproved_createdAt_idx" ON "approval_records"("selfApproved", "createdAt");

-- CreateIndex
CREATE INDEX "approval_records_entityType_entityId_idx" ON "approval_records"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "approval_policies" ADD CONSTRAINT "approval_policies_updatedByStaffId_fkey" FOREIGN KEY ("updatedByStaffId") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_owners" ADD CONSTRAINT "approval_owners_staffUserId_fkey" FOREIGN KEY ("staffUserId") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_owners" ADD CONSTRAINT "approval_owners_addedByStaffId_fkey" FOREIGN KEY ("addedByStaffId") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_records" ADD CONSTRAINT "approval_records_requestedByStaffId_fkey" FOREIGN KEY ("requestedByStaffId") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_records" ADD CONSTRAINT "approval_records_approvedByStaffId_fkey" FOREIGN KEY ("approvedByStaffId") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A self-approval is the requester approving their own action and always
-- carries a reason; an independent approval is always someone else.
ALTER TABLE "approval_records" ADD CONSTRAINT "approval_records_self_check" CHECK (
  ("selfApproved" AND "requestedByStaffId" = "approvedByStaffId" AND "reason" IS NOT NULL AND length(btrim("reason")) > 0)
  OR (NOT "selfApproved" AND "requestedByStaffId" <> "approvedByStaffId")
);

-- The policy table holds one row.
ALTER TABLE "approval_policies" ADD CONSTRAINT "approval_policies_single_row_check" CHECK ("id" = 'default');
