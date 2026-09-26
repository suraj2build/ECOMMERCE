-- Post-Purchase Phase independent-review repair (2026-09-26):
--   finding 2 - M19 config-driven return evidence upload
--   finding 3 - M21 REPLACEMENT_ALLOCATED intermediate exchange status
--   finding 4 - M20 in-flight PROCESSING refund status

-- AlterEnum
ALTER TYPE "ExchangeStatus" ADD VALUE 'REPLACEMENT_ALLOCATED';

-- AlterEnum
ALTER TYPE "RefundStatus" ADD VALUE 'PROCESSING';

-- AlterTable
ALTER TABLE "exchanges" ADD COLUMN     "replacementFulfilledAt" TIMESTAMP(3),
ADD COLUMN     "replacementFulfilledByStaffId" TEXT;

-- AlterTable
ALTER TABLE "return_policies" ADD COLUMN     "evidenceRequired" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "return_evidence" (
    "id" TEXT NOT NULL,
    "returnLineId" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "uploadedBy" "AuditActorType" NOT NULL,
    "uploadedByStaffId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "return_evidence_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "return_evidence_size_bytes_positive_check" CHECK ("sizeBytes" > 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "return_evidence_objectKey_key" ON "return_evidence"("objectKey");

-- CreateIndex
CREATE INDEX "return_evidence_returnLineId_idx" ON "return_evidence"("returnLineId");

-- AddForeignKey
ALTER TABLE "return_evidence" ADD CONSTRAINT "return_evidence_returnLineId_fkey" FOREIGN KEY ("returnLineId") REFERENCES "return_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_evidence" ADD CONSTRAINT "return_evidence_uploadedByStaffId_fkey" FOREIGN KEY ("uploadedByStaffId") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exchanges" ADD CONSTRAINT "exchanges_replacementFulfilledByStaffId_fkey" FOREIGN KEY ("replacementFulfilledByStaffId") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
