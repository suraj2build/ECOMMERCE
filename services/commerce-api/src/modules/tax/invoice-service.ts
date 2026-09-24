import type { FastifyInstance } from 'fastify';
import type { Prisma, PrismaClient } from '@fcp/db';
import { NotFoundError, ValidationError, ConflictError, TaxConfigurationError } from '@fcp/shared';
import { recordAudit } from '../audit/service.js';
import { TaxConfigService } from './service.js';
import { getIndianFinancialYear, determinePlaceOfSupply, splitTax } from './tax-engine.js';
import { NoOpEInvoiceAdapter, isEInvoiceApplicable, type EInvoiceAdapter } from './einvoice-adapter.js';

export interface InvoiceLineInput {
  skuId: string;
  quantity: number;
  unitPrice: number; // selling price paid per unit, tax-exclusive
  discountAmount?: number;
  /** TAX-006: configurable discount-application flag, defaults to pre-tax. */
  discountAppliedPreTax?: boolean;
}

export interface IssueInvoiceInput {
  orderId: string;
  locationId: string;
  recipientName: string;
  recipientGstin?: string;
  billingAddress: Record<string, unknown>;
  deliveryAddress: Record<string, unknown>;
  shippingStateCode: string;
  reverseCharge?: boolean;
  lines: InvoiceLineInput[];
  atDate?: Date;
}

export interface CreditNoteLineInput {
  invoiceLineId: string;
  quantity: number; // quantity being credited, <= the original line's quantity
}

export interface IssueCreditNoteInput {
  originalInvoiceId: string;
  reason: string;
  referenceNote?: string;
  lines: CreditNoteLineInput[];
}

function formatDocumentNumber(prefix: string, financialYear: string, sequence: number): string {
  return `${prefix}/${financialYear}/${String(sequence).padStart(6, '0')}`;
}

/**
 * Invoice / credit-note issuance (M08, specs/32-india-tax-invoicing.md).
 * Every document produced here is an immutable snapshot - see the schema
 * comment in packages/db/prisma/schema.prisma. This is the M08-standalone
 * entry point; M15 (Order Management) will call issueInvoice() in-process
 * at order confirmation once the Order model exists, the same way GRN
 * calls InventoryService directly today.
 */
export class InvoiceService {
  private readonly taxConfig: TaxConfigService;
  private readonly einvoiceAdapter: EInvoiceAdapter;

  constructor(
    private readonly fastify: FastifyInstance,
    einvoiceAdapter: EInvoiceAdapter = new NoOpEInvoiceAdapter(),
  ) {
    this.taxConfig = new TaxConfigService(fastify);
    this.einvoiceAdapter = einvoiceAdapter;
  }

  private get prisma(): PrismaClient {
    return this.fastify.prisma;
  }

  private async nextDocumentNumber(
    tx: Prisma.TransactionClient,
    kind: 'INV' | 'CN',
    financialYear: string,
  ): Promise<{ number: string; sequence: number }> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`doc_seq:${kind}:${financialYear}`}))`;
    const count =
      kind === 'INV'
        ? await tx.invoice.count({ where: { financialYear } })
        : await tx.creditNote.count({ where: { financialYear } });
    const sequence = count + 1;
    return { number: formatDocumentNumber(kind, financialYear, sequence), sequence };
  }

  /**
   * actorStaffId is optional: the M08 HTTP entry point always has a
   * real staff actor, but M15's in-process call at order confirmation
   * (OrderService.createOrderFromCheckoutSession) is a SYSTEM-triggered
   * event with no staff member involved - recorded honestly as such
   * rather than attributed to a fabricated/borrowed staff identity.
   */
  async issueInvoice(input: IssueInvoiceInput, actorStaffId?: string) {
    if (input.lines.length === 0) throw new ValidationError('An invoice must have at least one line');
    const atDate = input.atDate ?? new Date();
    const financialYear = getIndianFinancialYear(atDate);

    const existingForOrder = await this.prisma.invoice.findUnique({ where: { orderId: input.orderId } });
    if (existingForOrder) {
      throw new ConflictError(`An invoice already exists for order '${input.orderId}'`);
    }

    // Resolve supplier compliance configuration - fails safe (TaxConfigurationError)
    // if the location has no ACTIVE, currently-effective GST registration.
    const registration = await this.taxConfig.resolveSupplierRegistration(input.locationId, atDate);
    const legalEntity = await this.prisma.legalEntity.findUniqueOrThrow({
      where: { id: registration.legalEntityId },
    });
    const { isIntraState } = determinePlaceOfSupply({
      supplierStateCode: registration.stateCode,
      shippingStateCode: input.shippingStateCode,
    });

    const preparedLines: Array<{
      skuId: string;
      skuCodeSnapshot: string;
      descriptionSnapshot: string;
      colourSnapshot: string | null;
      sizeSnapshot: string | null;
      hsnCodeSnapshot: string;
      quantity: number;
      grossValue: number;
      discountAmount: number;
      taxableValue: number;
      gstRatePercent: number;
      cgstAmount: number;
      sgstAmount: number;
      igstAmount: number;
      cessAmount: number;
      lineTotal: number;
    }> = [];

    for (const line of input.lines) {
      if (line.quantity <= 0) throw new ValidationError('Invoice line quantity must be positive');
      if (line.unitPrice < 0) throw new ValidationError('Invoice line unitPrice cannot be negative');

      const sku = await this.prisma.sku.findUnique({
        where: { id: line.skuId },
        include: { style: true, colour: true, size: true },
      });
      if (!sku) throw new NotFoundError('Sku', line.skuId);

      const hsnCode = sku.hsnCode ?? sku.style.hsnCode;
      if (!hsnCode) {
        throw new TaxConfigurationError(
          `SKU '${line.skuId}' (style '${sku.style.styleCode}') has no HSN code configured (neither a SKU override nor a style default). Cannot compute tax.`,
        );
      }
      const rate = await this.taxConfig.resolveTaxRate(hsnCode, atDate);

      const gross = line.unitPrice * line.quantity;
      const discount = line.discountAmount ?? 0;
      if (discount < 0) throw new ValidationError('discountAmount cannot be negative');
      if (discount > gross) throw new ValidationError('discountAmount cannot exceed the line gross value');

      const preTax = line.discountAppliedPreTax ?? true;
      const taxableValue = preTax ? gross - discount : gross;
      const split = splitTax({
        taxableValue,
        gstRatePercent: Number(rate.gstRatePercent),
        cessPercent: rate.cessPercent ? Number(rate.cessPercent) : null,
        isIntraState,
      });
      const lineTotal = preTax ? split.lineTotal : split.lineTotal - discount;

      preparedLines.push({
        skuId: sku.id,
        skuCodeSnapshot: sku.skuCode,
        descriptionSnapshot: `${sku.style.name} - ${sku.colour.name} - ${sku.size.label}`,
        colourSnapshot: sku.colour.name,
        sizeSnapshot: sku.size.label,
        hsnCodeSnapshot: hsnCode,
        quantity: line.quantity,
        grossValue: gross,
        discountAmount: discount,
        taxableValue,
        gstRatePercent: Number(rate.gstRatePercent),
        cgstAmount: split.cgst,
        sgstAmount: split.sgst,
        igstAmount: split.igst,
        cessAmount: split.cess,
        lineTotal,
      });
    }

    const totals = preparedLines.reduce(
      (acc, l) => ({
        totalTaxableValue: acc.totalTaxableValue + l.taxableValue,
        totalDiscount: acc.totalDiscount + l.discountAmount,
        totalCgst: acc.totalCgst + l.cgstAmount,
        totalSgst: acc.totalSgst + l.sgstAmount,
        totalIgst: acc.totalIgst + l.igstAmount,
        totalCess: acc.totalCess + l.cessAmount,
        totalInvoiceValue: acc.totalInvoiceValue + l.lineTotal,
      }),
      {
        totalTaxableValue: 0,
        totalDiscount: 0,
        totalCgst: 0,
        totalSgst: 0,
        totalIgst: 0,
        totalCess: 0,
        totalInvoiceValue: 0,
      },
    );

    const supplierAddress = {
      line1: legalEntity.registeredAddressLine1,
      line2: legalEntity.registeredAddressLine2,
      city: legalEntity.registeredCity,
      state: legalEntity.registeredState,
      pinCode: legalEntity.registeredPinCode,
    };

    const invoice = await this.prisma.$transaction(async (tx) => {
      const { number, sequence } = await this.nextDocumentNumber(tx, 'INV', financialYear);

      const created = await tx.invoice.create({
        data: {
          invoiceNumber: number,
          financialYear,
          sequenceNumber: sequence,
          gstRegistrationId: registration.id,
          invoiceDate: atDate,
          orderId: input.orderId,
          supplierLegalName: legalEntity.legalName,
          supplierAddress,
          supplierGstin: registration.gstin,
          recipientName: input.recipientName,
          recipientGstin: input.recipientGstin,
          billingAddress: input.billingAddress as Prisma.InputJsonValue,
          deliveryAddress: input.deliveryAddress as Prisma.InputJsonValue,
          placeOfSupplyState: registration.stateName,
          placeOfSupplyCode: input.shippingStateCode,
          isIntraState,
          reverseCharge: input.reverseCharge ?? false,
          totalTaxableValue: totals.totalTaxableValue,
          totalDiscount: totals.totalDiscount,
          totalCgst: totals.totalCgst,
          totalSgst: totals.totalSgst,
          totalIgst: totals.totalIgst,
          totalCess: totals.totalCess,
          totalInvoiceValue: totals.totalInvoiceValue,
          lines: { create: preparedLines },
        },
        include: { lines: true },
      });

      await recordAudit(tx, {
        actorType: actorStaffId ? 'STAFF' : 'SYSTEM',
        actorStaffId,
        action: 'invoice.issue',
        entityType: 'Invoice',
        entityId: created.id,
        newValue: { invoiceNumber: number, orderId: input.orderId, totalInvoiceValue: totals.totalInvoiceValue },
        reference: input.orderId,
      });

      return created;
    });

    await this.maybeSubmitEInvoice(invoice.id, registration.legalEntityId, atDate);
    return this.getInvoice(invoice.id);
  }

  /** Applicability (ComplianceProfile) is decided here; the adapter never guesses. */
  private async maybeSubmitEInvoice(invoiceId: string, legalEntityId: string, atDate: Date): Promise<void> {
    const profile = await this.taxConfig.getActiveComplianceProfile(legalEntityId, atDate);
    if (!isEInvoiceApplicable(profile, atDate)) return;

    const invoice = await this.prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    const result = await this.einvoiceAdapter.submitInvoice(invoice);
    await this.prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        irpStatus: result.status,
        irn: result.irn,
        irnAckNumber: result.irnAckNumber,
        irnAckDate: result.irnAckDate,
        irnQrPayload: result.irnQrPayload,
        irpSubmittedAt: new Date(),
        irpErrorDetail: result.errorDetail,
        irpRetryCount: { increment: 1 },
      },
    });
  }

  async getInvoice(id: string) {
    const invoice = await this.prisma.invoice.findUnique({ where: { id }, include: { lines: true } });
    if (!invoice) throw new NotFoundError('Invoice', id);
    return invoice;
  }

  async getInvoiceByOrder(orderId: string) {
    const invoice = await this.prisma.invoice.findUnique({ where: { orderId }, include: { lines: true } });
    if (!invoice) throw new NotFoundError('Invoice', orderId);
    return invoice;
  }

  /**
   * Cumulative-over-credit prevention (independent-review finding #1,
   * binding): SUM(all committed CreditNoteLine.quantity referencing an
   * InvoiceLine) + requested quantity MUST NEVER exceed
   * InvoiceLine.quantity. Every CreditNoteLine row that exists represents
   * a committed credit - this system has no draft/pending credit-note
   * state - so a plain SUM is exactly "already credited."
   *
   * The check-then-insert is safe under CONCURRENT credit-note creation
   * because it runs entirely inside one transaction, and the InvoiceLine
   * rows being credited are locked (`SELECT ... FOR UPDATE`) BEFORE the
   * SUM is read - the same row-lock-before-aggregate-check discipline
   * `InventoryService.lockBalance` already uses for the oversell
   * invariant (M06). A second concurrent transaction attempting to lock
   * the same InvoiceLine rows blocks until the first commits or rolls
   * back, then re-reads the SUM fresh (including whatever the first
   * transaction just committed) before making its own decision - true
   * DB-level serialization, not an application-level pre-read with a
   * race window. Lines are locked in a stable sorted order to avoid
   * deadlocking against another concurrent multi-line request touching
   * an overlapping but differently-ordered set of lines.
   */
  async issueCreditNote(input: IssueCreditNoteInput, actorStaffId: string) {
    if (input.lines.length === 0) throw new ValidationError('A credit note must have at least one line');
    const atDate = new Date();
    const financialYear = getIndianFinancialYear(atDate);

    const originalInvoice = await this.prisma.invoice.findUnique({
      where: { id: input.originalInvoiceId },
      include: { lines: true },
    });
    if (!originalInvoice) throw new NotFoundError('Invoice', input.originalInvoiceId);

    const invoiceLineById = new Map(originalInvoice.lines.map((l) => [l.id, l]));

    // Shape validation (line belongs to this invoice, positive quantity,
    // no duplicate invoiceLineId within THIS request) can happen before
    // opening the transaction - only the cumulative over-credit check
    // needs the lock.
    //
    // Same-request over-credit (independent-review follow-up finding):
    // the cumulative check below compares each requested line's quantity
    // against already-COMMITTED (i.e. previously persisted)
    // CreditNoteLine rows - it has no visibility into OTHER lines of
    // this same in-flight request, since none of them exist in the DB
    // yet. Two entries in one request both referencing the same
    // invoiceLineId (e.g. 7 + 7 against an original quantity of 10)
    // would therefore each independently read the same pre-request
    // "already credited" sum and both pass, even though the request as
    // a whole credits 14 against 10. Rejecting a duplicate
    // invoiceLineId within a single request closes this deterministically
    // (no ambiguity about how to merge/prorate two partial entries
    // against the same line) - a caller that genuinely wants to credit
    // more of one line submits a single entry with the combined
    // quantity, not two entries.
    const seenLineIds = new Set<string>();
    for (const line of input.lines) {
      if (!invoiceLineById.has(line.invoiceLineId)) {
        throw new ValidationError(
          `Invoice line '${line.invoiceLineId}' does not belong to invoice '${input.originalInvoiceId}'`,
        );
      }
      if (line.quantity <= 0) throw new ValidationError('Credit note line quantity must be positive');
      if (seenLineIds.has(line.invoiceLineId)) {
        throw new ValidationError(
          `Invoice line '${line.invoiceLineId}' appears more than once in this credit-note request - combine into a single entry with the total quantity instead`,
        );
      }
      seenLineIds.add(line.invoiceLineId);
    }

    return this.prisma.$transaction(async (tx) => {
      const lineIds = [...new Set(input.lines.map((l) => l.invoiceLineId))].sort();
      const lockedLines = await tx.$queryRaw<{ id: string; quantity: number }[]>`
        SELECT "id", "quantity" FROM "invoice_lines" WHERE "id" = ANY(${lineIds}) FOR UPDATE`;
      const lockedById = new Map(lockedLines.map((l) => [l.id, l]));

      const preparedLines: Array<{
        invoiceLineId: string;
        descriptionSnapshot: string;
        hsnCodeSnapshot: string;
        quantity: number;
        taxableValueReduction: number;
        gstRatePercent: number;
        cgstReduction: number;
        sgstReduction: number;
        igstReduction: number;
        cessReduction: number;
        lineTotalReduction: number;
      }> = [];

      for (const line of input.lines) {
        const original = invoiceLineById.get(line.invoiceLineId)!; // presence already validated above
        const locked = lockedById.get(line.invoiceLineId);
        if (!locked) throw new NotFoundError('InvoiceLine', line.invoiceLineId);

        const alreadyCredited = await tx.creditNoteLine.aggregate({
          where: { invoiceLineId: line.invoiceLineId },
          _sum: { quantity: true },
        });
        const committedSoFar = alreadyCredited._sum.quantity ?? 0;
        const remaining = original.quantity - committedSoFar;
        if (line.quantity > remaining) {
          throw new ValidationError(
            `Cannot credit ${line.quantity} units against invoice line '${line.invoiceLineId}' - ${committedSoFar} of ${original.quantity} already credited, only ${Math.max(0, remaining)} remain`,
          );
        }

        // Credits use the ORIGINAL invoice line's frozen amounts, prorated
        // by quantity - never re-resolved against current tax reference
        // data (spec 32: "later reference-data changes must not rewrite
        // historical orders"). Proration, not re-computation, is what keeps
        // this consistent with whatever rounding the original invoice used.
        const proportion = line.quantity / original.quantity;
        const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
        const taxableValueReduction = round2(Number(original.taxableValue) * proportion);
        const cgstReduction = round2(Number(original.cgstAmount) * proportion);
        const sgstReduction = round2(Number(original.sgstAmount) * proportion);
        const igstReduction = round2(Number(original.igstAmount) * proportion);
        const cessReduction = round2(Number(original.cessAmount) * proportion);

        preparedLines.push({
          invoiceLineId: original.id,
          descriptionSnapshot: original.descriptionSnapshot,
          hsnCodeSnapshot: original.hsnCodeSnapshot,
          quantity: line.quantity,
          taxableValueReduction,
          gstRatePercent: Number(original.gstRatePercent),
          cgstReduction,
          sgstReduction,
          igstReduction,
          cessReduction,
          lineTotalReduction: round2(
            taxableValueReduction + cgstReduction + sgstReduction + igstReduction + cessReduction,
          ),
        });
      }

      const totals = preparedLines.reduce(
        (acc, l) => ({
          totalTaxableValueReduction: acc.totalTaxableValueReduction + l.taxableValueReduction,
          totalCgstReduction: acc.totalCgstReduction + l.cgstReduction,
          totalSgstReduction: acc.totalSgstReduction + l.sgstReduction,
          totalIgstReduction: acc.totalIgstReduction + l.igstReduction,
          totalCessReduction: acc.totalCessReduction + l.cessReduction,
          totalValueReduction: acc.totalValueReduction + l.lineTotalReduction,
        }),
        {
          totalTaxableValueReduction: 0,
          totalCgstReduction: 0,
          totalSgstReduction: 0,
          totalIgstReduction: 0,
          totalCessReduction: 0,
          totalValueReduction: 0,
        },
      );

      const { number, sequence } = await this.nextDocumentNumber(tx, 'CN', financialYear);

      const created = await tx.creditNote.create({
        data: {
          creditNoteNumber: number,
          financialYear,
          sequenceNumber: sequence,
          originalInvoiceId: input.originalInvoiceId,
          issueDate: atDate,
          reason: input.reason,
          referenceNote: input.referenceNote,
          totalTaxableValueReduction: totals.totalTaxableValueReduction,
          totalCgstReduction: totals.totalCgstReduction,
          totalSgstReduction: totals.totalSgstReduction,
          totalIgstReduction: totals.totalIgstReduction,
          totalCessReduction: totals.totalCessReduction,
          totalValueReduction: totals.totalValueReduction,
          lines: { create: preparedLines },
        },
        include: { lines: true },
      });

      await recordAudit(tx, {
        actorType: 'STAFF',
        actorStaffId,
        action: 'credit_note.issue',
        entityType: 'CreditNote',
        entityId: created.id,
        newValue: { creditNoteNumber: number, originalInvoiceId: input.originalInvoiceId },
        reference: input.originalInvoiceId,
      });

      return created;
    });
  }

  async getCreditNote(id: string) {
    const creditNote = await this.prisma.creditNote.findUnique({ where: { id }, include: { lines: true } });
    if (!creditNote) throw new NotFoundError('CreditNote', id);
    return creditNote;
  }

  async listCreditNotesForInvoice(invoiceId: string) {
    return this.prisma.creditNote.findMany({
      where: { originalInvoiceId: invoiceId },
      orderBy: { issueDate: 'desc' },
    });
  }
}
