-- Product Owner review (2026-10-05): independent approval must be confirmed by
-- the named approver from their own login. Actions needing someone else's
-- approval wait as approval requests; owner self-approval stays immediate.

-- CreateEnum
CREATE TYPE "ApprovalRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'FAILED');

-- CreateTable
CREATE TABLE "approval_requests" (
    "id" TEXT NOT NULL,
    "kind" "ApprovalKind" NOT NULL,
    "status" "ApprovalRequestStatus" NOT NULL DEFAULT 'PENDING',
    "requestedByStaffId" TEXT NOT NULL,
    "approverStaffId" TEXT NOT NULL,
    "subjectKey" TEXT,
    "payload" JSONB NOT NULL,
    "summary" JSONB NOT NULL,
    "decidedAt" TIMESTAMP(3),
    "decidedByStaffId" TEXT,
    "decisionNote" TEXT,
    "failureReason" TEXT,
    "claimedAt" TIMESTAMP(3),
    "resultEntityType" TEXT,
    "resultEntityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "approval_records" ADD COLUMN "approvalRequestId" TEXT;

-- CreateIndex
CREATE INDEX "approval_requests_approverStaffId_status_createdAt_idx" ON "approval_requests"("approverStaffId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "approval_requests_requestedByStaffId_status_createdAt_idx" ON "approval_requests"("requestedByStaffId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "approval_requests_status_createdAt_idx" ON "approval_requests"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "approval_records_approvalRequestId_key" ON "approval_records"("approvalRequestId");

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_requestedByStaffId_fkey" FOREIGN KEY ("requestedByStaffId") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_approverStaffId_fkey" FOREIGN KEY ("approverStaffId") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_decidedByStaffId_fkey" FOREIGN KEY ("decidedByStaffId") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_records" ADD CONSTRAINT "approval_records_approvalRequestId_fkey" FOREIGN KEY ("approvalRequestId") REFERENCES "approval_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A request always names someone other than the requester (owner
-- self-approval never queues).
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_other_person_check" CHECK ("requestedByStaffId" <> "approverStaffId");

-- Only the named approver approves, rejects or fails a request; only the
-- requester cancels it. An open request has no decision.
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_decision_check" CHECK (
  ("status" = 'PENDING' AND "decidedAt" IS NULL AND "decidedByStaffId" IS NULL)
  OR ("status" IN ('APPROVED', 'REJECTED', 'FAILED') AND "decidedAt" IS NOT NULL AND "decidedByStaffId" = "approverStaffId")
  OR ("status" = 'CANCELLED' AND "decidedAt" IS NOT NULL AND "decidedByStaffId" = "requestedByStaffId")
);

-- A rejection carries the approver's note; a failure carries its reason.
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_notes_check" CHECK (
  ("status" <> 'REJECTED' OR ("decisionNote" IS NOT NULL AND length(btrim("decisionNote")) > 0))
  AND ("status" <> 'FAILED' OR "failureReason" IS NOT NULL)
);

-- One open request per subject.
CREATE UNIQUE INDEX "approval_requests_open_subject_once" ON "approval_requests"("kind", "subjectKey") WHERE "status" = 'PENDING' AND "subjectKey" IS NOT NULL;

-- An approval given through a request is that request's approver, never a self-approval.
ALTER TABLE "approval_records" ADD CONSTRAINT "approval_records_request_independent_check" CHECK ("approvalRequestId" IS NULL OR NOT "selfApproved");
