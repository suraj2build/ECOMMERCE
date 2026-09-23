-- CreateEnum
CREATE TYPE "GstRegistrationStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TaxVerificationStatus" AS ENUM ('UNVERIFIED', 'PENDING_REVIEW', 'VERIFIED');

-- CreateEnum
CREATE TYPE "EInvoiceStatus" AS ENUM ('NOT_APPLICABLE', 'PENDING', 'SUBMITTED', 'ACKNOWLEDGED', 'FAILED');

-- AlterTable
ALTER TABLE "locations" ADD COLUMN     "gstRegistrationId" TEXT;

-- AlterTable
ALTER TABLE "skus" ADD COLUMN     "hsnCode" TEXT;

-- CreateTable
CREATE TABLE "legal_entities" (
    "id" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "pan" TEXT,
    "cin" TEXT,
    "registeredAddressLine1" TEXT,
    "registeredAddressLine2" TEXT,
    "registeredCity" TEXT,
    "registeredState" TEXT,
    "registeredPinCode" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "legal_entities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gst_registrations" (
    "id" TEXT NOT NULL,
    "legalEntityId" TEXT NOT NULL,
    "gstin" TEXT NOT NULL,
    "stateCode" TEXT NOT NULL,
    "stateName" TEXT NOT NULL,
    "status" "GstRegistrationStatus" NOT NULL DEFAULT 'PENDING',
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gst_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_profiles" (
    "id" TEXT NOT NULL,
    "legalEntityId" TEXT NOT NULL,
    "aatoThresholdCrores" DECIMAL(10,2),
    "einvoiceApplicable" BOOLEAN NOT NULL DEFAULT false,
    "einvoiceApplicableFrom" TIMESTAMP(3),
    "exemptionNotes" TEXT,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "compliance_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_rates" (
    "id" TEXT NOT NULL,
    "hsnCode" TEXT NOT NULL,
    "description" TEXT,
    "gstRatePercent" DECIMAL(5,2) NOT NULL,
    "cessPercent" DECIMAL(5,2),
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "sourceReference" TEXT,
    "verificationStatus" "TaxVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "financialYear" TEXT NOT NULL,
    "sequenceNumber" INTEGER NOT NULL,
    "gstRegistrationId" TEXT NOT NULL,
    "invoiceDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "orderId" TEXT NOT NULL,
    "supplierLegalName" TEXT NOT NULL,
    "supplierAddress" JSONB NOT NULL,
    "supplierGstin" TEXT NOT NULL,
    "recipientName" TEXT NOT NULL,
    "recipientGstin" TEXT,
    "billingAddress" JSONB NOT NULL,
    "deliveryAddress" JSONB NOT NULL,
    "placeOfSupplyState" TEXT NOT NULL,
    "placeOfSupplyCode" TEXT NOT NULL,
    "isIntraState" BOOLEAN NOT NULL,
    "reverseCharge" BOOLEAN NOT NULL DEFAULT false,
    "totalTaxableValue" DECIMAL(14,2) NOT NULL,
    "totalDiscount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalCgst" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalSgst" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalIgst" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalCess" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalInvoiceValue" DECIMAL(14,2) NOT NULL,
    "templateVersion" INTEGER NOT NULL DEFAULT 1,
    "irpStatus" "EInvoiceStatus" NOT NULL DEFAULT 'NOT_APPLICABLE',
    "irn" TEXT,
    "irnAckNumber" TEXT,
    "irnAckDate" TIMESTAMP(3),
    "irnQrPayload" TEXT,
    "irpSubmittedAt" TIMESTAMP(3),
    "irpErrorDetail" TEXT,
    "irpRetryCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_lines" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "skuCodeSnapshot" TEXT NOT NULL,
    "descriptionSnapshot" TEXT NOT NULL,
    "colourSnapshot" TEXT,
    "sizeSnapshot" TEXT,
    "hsnCodeSnapshot" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitOfMeasure" TEXT NOT NULL DEFAULT 'PCS',
    "grossValue" DECIMAL(12,2) NOT NULL,
    "discountAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "taxableValue" DECIMAL(12,2) NOT NULL,
    "gstRatePercent" DECIMAL(5,2) NOT NULL,
    "cgstAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "sgstAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "igstAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "cessAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_notes" (
    "id" TEXT NOT NULL,
    "creditNoteNumber" TEXT NOT NULL,
    "financialYear" TEXT NOT NULL,
    "sequenceNumber" INTEGER NOT NULL,
    "originalInvoiceId" TEXT NOT NULL,
    "issueDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT NOT NULL,
    "referenceNote" TEXT,
    "totalTaxableValueReduction" DECIMAL(14,2) NOT NULL,
    "totalCgstReduction" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalSgstReduction" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalIgstReduction" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalCessReduction" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalValueReduction" DECIMAL(14,2) NOT NULL,
    "templateVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_note_lines" (
    "id" TEXT NOT NULL,
    "creditNoteId" TEXT NOT NULL,
    "invoiceLineId" TEXT NOT NULL,
    "descriptionSnapshot" TEXT NOT NULL,
    "hsnCodeSnapshot" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "taxableValueReduction" DECIMAL(12,2) NOT NULL,
    "gstRatePercent" DECIMAL(5,2) NOT NULL,
    "cgstReduction" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "sgstReduction" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "igstReduction" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "cessReduction" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "lineTotalReduction" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "credit_note_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "gst_registrations_gstin_key" ON "gst_registrations"("gstin");

-- CreateIndex
CREATE INDEX "gst_registrations_stateCode_idx" ON "gst_registrations"("stateCode");

-- CreateIndex
CREATE INDEX "gst_registrations_legalEntityId_idx" ON "gst_registrations"("legalEntityId");

-- CreateIndex
CREATE INDEX "compliance_profiles_legalEntityId_effectiveFrom_idx" ON "compliance_profiles"("legalEntityId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "tax_rates_hsnCode_effectiveFrom_idx" ON "tax_rates"("hsnCode", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_invoiceNumber_key" ON "invoices"("invoiceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_orderId_key" ON "invoices"("orderId");

-- CreateIndex
CREATE INDEX "invoices_financialYear_sequenceNumber_idx" ON "invoices"("financialYear", "sequenceNumber");

-- CreateIndex
CREATE INDEX "invoices_gstRegistrationId_idx" ON "invoices"("gstRegistrationId");

-- CreateIndex
CREATE INDEX "invoice_lines_invoiceId_idx" ON "invoice_lines"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "credit_notes_creditNoteNumber_key" ON "credit_notes"("creditNoteNumber");

-- CreateIndex
CREATE INDEX "credit_notes_financialYear_sequenceNumber_idx" ON "credit_notes"("financialYear", "sequenceNumber");

-- CreateIndex
CREATE INDEX "credit_notes_originalInvoiceId_idx" ON "credit_notes"("originalInvoiceId");

-- CreateIndex
CREATE INDEX "credit_note_lines_creditNoteId_idx" ON "credit_note_lines"("creditNoteId");

-- CreateIndex
CREATE INDEX "credit_note_lines_invoiceLineId_idx" ON "credit_note_lines"("invoiceLineId");

-- CreateIndex
CREATE INDEX "locations_gstRegistrationId_idx" ON "locations"("gstRegistrationId");

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_gstRegistrationId_fkey" FOREIGN KEY ("gstRegistrationId") REFERENCES "gst_registrations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gst_registrations" ADD CONSTRAINT "gst_registrations_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "legal_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_profiles" ADD CONSTRAINT "compliance_profiles_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "legal_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_gstRegistrationId_fkey" FOREIGN KEY ("gstRegistrationId") REFERENCES "gst_registrations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_originalInvoiceId_fkey" FOREIGN KEY ("originalInvoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_creditNoteId_fkey" FOREIGN KEY ("creditNoteId") REFERENCES "credit_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_invoiceLineId_fkey" FOREIGN KEY ("invoiceLineId") REFERENCES "invoice_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written CHECK constraints (M08 certification discipline carried
-- over from migration 20260922171222_add_integrity_constraints): not
-- representable in schema.prisma's DSL, so defense-in-depth invariants
-- live here alongside the generated diff above.

-- GstRegistration: a closed effective window must not be inverted/empty.
ALTER TABLE "gst_registrations" ADD CONSTRAINT "gst_registrations_effective_window"
  CHECK ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom");

-- ComplianceProfile: same effective-window sanity.
ALTER TABLE "compliance_profiles" ADD CONSTRAINT "compliance_profiles_effective_window"
  CHECK ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom");

-- TaxRate: rates/cess are non-negative percentages; effective window sane.
ALTER TABLE "tax_rates" ADD CONSTRAINT "tax_rates_gstRatePercent_nonneg"
  CHECK ("gstRatePercent" >= 0);
ALTER TABLE "tax_rates" ADD CONSTRAINT "tax_rates_cessPercent_nonneg"
  CHECK ("cessPercent" IS NULL OR "cessPercent" >= 0);
ALTER TABLE "tax_rates" ADD CONSTRAINT "tax_rates_effective_window"
  CHECK ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom");

-- Invoice: numbering and money invariants, plus the fundamental
-- CGST+SGST vs IGST mutual exclusivity rule (never both nonzero on the
-- same document - a document is either intra-state or inter-state, not
-- both) enforced at the database level, not only in application code.
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_sequenceNumber_positive"
  CHECK ("sequenceNumber" > 0);
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_totals_nonneg"
  CHECK ("totalTaxableValue" >= 0 AND "totalDiscount" >= 0 AND "totalCgst" >= 0
    AND "totalSgst" >= 0 AND "totalIgst" >= 0 AND "totalCess" >= 0 AND "totalInvoiceValue" >= 0);
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_cgst_sgst_igst_exclusive"
  CHECK (("totalCgst" = 0 AND "totalSgst" = 0) OR "totalIgst" = 0);
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_irpRetryCount_nonneg"
  CHECK ("irpRetryCount" >= 0);

-- InvoiceLine: quantity/money invariants, same CGST/SGST vs IGST exclusivity.
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_quantity_positive"
  CHECK ("quantity" > 0);
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_amounts_nonneg"
  CHECK ("grossValue" >= 0 AND "discountAmount" >= 0 AND "taxableValue" >= 0
    AND "gstRatePercent" >= 0 AND "cgstAmount" >= 0 AND "sgstAmount" >= 0
    AND "igstAmount" >= 0 AND "cessAmount" >= 0 AND "lineTotal" >= 0);
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_cgst_sgst_igst_exclusive"
  CHECK (("cgstAmount" = 0 AND "sgstAmount" = 0) OR "igstAmount" = 0);

-- CreditNote: numbering and reduction-amount invariants.
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_sequenceNumber_positive"
  CHECK ("sequenceNumber" > 0);
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_totals_nonneg"
  CHECK ("totalTaxableValueReduction" >= 0 AND "totalCgstReduction" >= 0
    AND "totalSgstReduction" >= 0 AND "totalIgstReduction" >= 0
    AND "totalCessReduction" >= 0 AND "totalValueReduction" >= 0);
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_cgst_sgst_igst_exclusive"
  CHECK (("totalCgstReduction" = 0 AND "totalSgstReduction" = 0) OR "totalIgstReduction" = 0);

-- CreditNoteLine: quantity/reduction invariants.
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_quantity_positive"
  CHECK ("quantity" > 0);
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_amounts_nonneg"
  CHECK ("taxableValueReduction" >= 0 AND "gstRatePercent" >= 0 AND "cgstReduction" >= 0
    AND "sgstReduction" >= 0 AND "igstReduction" >= 0 AND "lineTotalReduction" >= 0);
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_cgst_sgst_igst_exclusive"
  CHECK (("cgstReduction" = 0 AND "sgstReduction" = 0) OR "igstReduction" = 0);

