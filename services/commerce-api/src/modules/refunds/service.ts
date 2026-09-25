import type { FastifyInstance } from 'fastify';
import { Prisma, type PrismaClient, type Refund, type RefundMethod } from '@fcp/db';
import { NotFoundError, ValidationError, ConflictError } from '@fcp/shared';
import { recordAudit } from '../audit/service.js';
import { InvoiceService } from '../tax/invoice-service.js';
import { resolvePaymentProvider } from '../checkout/payment-provider.js';
import { StoreCreditService } from './store-credit-service.js';

/**
 * Refunds (M20, specs/19-refunds.md, REF-001-004). Settles the durable
 * handoffs M18 (Order.refundRequired, PREPAID cancellation) and M19
 * (ReturnLine.refundEligible, post-QC-pass return) leave behind - never
 * executes cancellation or return-lifecycle logic itself (that stays
 * M18's/M19's own domain, per this build's own domain-boundary rule:
 * Cancellation/Return/Refund/StoreCredit stay conceptually and
 * architecturally distinct).
 *
 * `method` (ORIGINAL_PAYMENT_METHOD vs STORE_CREDIT) is derived purely
 * from `Order.paymentMethod` (REF-001) - NEVER from `triggerType`. A COD
 * return and a PREPAID return settle through different rails even though
 * both are RETURN-triggered; a PREPAID cancellation and a PREPAID return
 * both settle to the original payment method even though their trigger
 * types differ.
 *
 * Trigger and settlement are deliberately explicit/staff-triggerable
 * (`processRefundForOrderLine`, `reconcilePendingRefunds`) rather than
 * silently wired into OrderService.performCancellation/
 * ReturnService.recordQcAndDisposition - this keeps M20's entire change
 * surface additive (no edits to M18/M19's already-certified files),
 * mirroring how ShippingService.createShipment is itself a separate
 * staff-triggered action from WarehouseService's own pack/ready-to-ship
 * steps, not an automatic side effect chained inside them.
 * `reconcilePendingRefunds` is the practical answer to "how does this
 * actually run without a human remembering to click a button for every
 * single line" - the same durable-DB-scan recovery pattern
 * OrderService.reconcilePendingInvoices already established for invoice
 * issuance, callable on a schedule or on demand.
 */
export class RefundService {
  private readonly invoice: InvoiceService;
  private readonly storeCredit: StoreCreditService;

  constructor(private readonly fastify: FastifyInstance) {
    this.invoice = new InvoiceService(fastify);
    this.storeCredit = new StoreCreditService(fastify);
  }

  private get prisma(): PrismaClient {
    return this.fastify.prisma;
  }

  /**
   * Two-phase durable-intent pattern (M17/M19 idiom): this method only
   * ever performs DB reads/writes (no external network call) and commits
   * a PENDING Refund row before returning - `processRefundForOrderLine`
   * is the one that performs the actual settlement, outside any
   * transaction, per "never hold DB locks across [an external] network
   * call".
   *
   * `orderLineId` is the sole idempotency anchor structurally (see the
   * schema comment on Refund) - a given OrderLine's lifecycle is
   * CANCELLATION-refund XOR RETURN-refund, never both, so checking for an
   * existing Refund by orderLineId ALONE (before ever touching
   * `idempotencyKey`) is what makes two callers using two DIFFERENT
   * idempotency keys for the same underlying line still converge safely.
   */
  private async resolveOrCreateIntent(orderId: string, orderLineId: string, actorStaffId: string | null, idempotencyKey: string): Promise<Refund> {
    const byKey = await this.prisma.refund.findUnique({ where: { idempotencyKey } });
    if (byKey) {
      if (byKey.orderLineId !== orderLineId) {
        throw new ConflictError(`Idempotency key '${idempotencyKey}' was already used for a different order line's refund`);
      }
      return byKey;
    }
    const byLine = await this.prisma.refund.findUnique({ where: { orderLineId } });
    if (byLine) return byLine;

    try {
      return await this.prisma.$transaction(async (tx) => {
        // Lock the OrderLine FIRST, before any other work - closes a real
        // race this method's own adversarial test caught: without this,
        // several concurrent calls (different idempotency keys, same
        // orderLineId) can all pass the pre-checks above before any of
        // them commits, then each independently attempts credit-note
        // issuance for the SAME InvoiceLine - the loser(s) hit
        // InvoiceService's over-credit guard (a genuine ValidationError,
        // not a safe idempotent resolution) instead of ever reaching the
        // Refund unique-constraint safety net below. Locking here means
        // only the first transaction proceeds to issue a credit note and
        // insert the Refund row; every other concurrent caller blocks
        // until it commits, then re-checks (see immediately below) and
        // finds the just-created row instead of redoing any of that work.
        await tx.$queryRaw`SELECT "id" FROM "order_lines" WHERE "id" = ${orderLineId} FOR UPDATE`;
        const alreadyCreated = await tx.refund.findUnique({ where: { orderLineId } });
        if (alreadyCreated) return alreadyCreated;

        const order = await tx.order.findUnique({ where: { id: orderId } });
        if (!order) throw new NotFoundError('Order', orderId);
        const line = await tx.orderLine.findUnique({ where: { id: orderLineId }, include: { returnLine: true } });
        if (!line || line.orderId !== orderId) throw new NotFoundError('OrderLine', orderLineId);

        let triggerType: 'CANCELLATION' | 'RETURN';
        let returnLineId: string | null = null;
        let reason: string;

        if (line.status === 'CANCELLED') {
          if (order.paymentMethod !== 'PREPAID') {
            throw new ValidationError('A COD cancellation never collected payment - there is nothing to refund (CAN-011)');
          }
          if (!order.refundRequired) {
            throw new ValidationError(`Order line '${orderLineId}' is not flagged as requiring a refund`);
          }
          triggerType = 'CANCELLATION';
          // REF-004: inherited from the return reason by default, or the
          // cancellation's own captured reason for a non-return-triggered
          // refund - never fabricated.
          reason = line.cancelledReason?.trim() || 'Order line cancelled';
        } else if (line.returnLine?.refundEligible) {
          triggerType = 'RETURN';
          returnLineId = line.returnLine.id;
          reason = line.returnLine.reason;
        } else {
          throw new ValidationError(`Order line '${orderLineId}' has no refund-eligible cancellation or return - nothing to process`);
        }

        const method: RefundMethod = order.paymentMethod === 'PREPAID' ? 'ORIGINAL_PAYMENT_METHOD' : 'STORE_CREDIT';

        // REF-003: the ORIGINAL transaction value, never the current
        // catalog price. When a CreditNote for this line's InvoiceLine
        // already exists (M18's own cancellation flow issues one
        // in-line, in the same transaction as the cancellation itself),
        // reuse ITS already-correctly-prorated reduction amount rather
        // than recomputing. A RETURN-triggered refund has no credit note
        // yet - issue one now, through the same M08 engine, so "every
        // qualifying refund generates a linked credit-note document"
        // holds for returns too, not just cancellations.
        let amount: number;
        let creditNoteId: string | null = null;
        const invoiceLine = await tx.invoiceLine.findUnique({ where: { orderLineId } });
        if (invoiceLine) {
          const existingCnLines = await tx.creditNoteLine.findMany({ where: { invoiceLineId: invoiceLine.id } });
          if (existingCnLines.length > 0) {
            amount = existingCnLines.reduce((sum, l) => sum + Number(l.lineTotalReduction), 0);
            creditNoteId = existingCnLines[0]!.creditNoteId;
          } else if (order.invoiceId) {
            const creditNote = await this.invoice.issueCreditNote(
              {
                originalInvoiceId: order.invoiceId,
                reason,
                referenceNote: `${triggerType === 'RETURN' ? 'Return' : 'Cancellation'} refund for order line '${orderLineId}' (order '${orderId}')`,
                lines: [{ invoiceLineId: invoiceLine.id, quantity: invoiceLine.quantity }],
              },
              actorStaffId,
              tx,
            );
            amount = Number(creditNote.totalValueReduction);
            creditNoteId = creditNote.id;
          } else {
            amount = Number(line.lineTotalInclusive);
          }
        } else {
          // Honest skip (mirrors M18's own precedent): no invoice/
          // InvoiceLine correlation exists yet - refund the line's own
          // original transaction value directly, without a credit-note
          // document.
          amount = Number(line.lineTotalInclusive);
        }

        let paymentId: string | null = null;
        if (method === 'ORIGINAL_PAYMENT_METHOD') {
          const payment = await tx.payment.findFirst({ where: { checkoutSessionId: order.checkoutSessionId, status: 'CAPTURED' } });
          if (!payment) throw new ValidationError('No captured payment was found for this order - cannot refund to the original payment method');
          paymentId = payment.id;
        }

        const created = await tx.refund.create({
          data: {
            orderId,
            orderLineId,
            returnLineId,
            paymentId,
            triggerType,
            method,
            amount,
            reason,
            status: 'PENDING',
            creditNoteId,
            idempotencyKey,
            initiatedByStaffId: actorStaffId ?? undefined,
          },
        });

        await recordAudit(tx, {
          actorType: actorStaffId ? 'STAFF' : 'SYSTEM',
          actorStaffId: actorStaffId ?? undefined,
          action: 'refund.initiate',
          entityType: 'Refund',
          entityId: created.id,
          newValue: { orderLineId, triggerType, method, amount },
          reference: orderId,
        });

        return created;
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const winner = await this.prisma.refund.findUnique({ where: { idempotencyKey } });
        if (winner && winner.orderLineId === orderLineId) return winner;
        const byLineRetry = await this.prisma.refund.findUnique({ where: { orderLineId } });
        if (byLineRetry) return byLineRetry;
        throw new ConflictError('A refund for this order line was already created by a concurrent request');
      }
      throw err;
    }
  }

  /**
   * Conditional claim (M17/M19 idiom): only a row still PENDING or FAILED
   * can be claimed COMPLETED/FAILED - a genuinely concurrent duplicate
   * settlement attempt that loses this race affects zero rows and simply
   * re-reads the winner's outcome, never double-applying a provider
   * refund or store-credit entry (each of THOSE is independently
   * idempotent too - see StoreCreditService.issue and the Razorpay
   * idempotency-key header on PaymentProvider.refund - so even a genuine
   * concurrent double-call converges to one real-world consequence).
   */
  private async claim(refundId: string, status: 'COMPLETED' | 'FAILED', extra: Partial<Pick<Refund, 'providerRefundId' | 'storeCreditEntryId' | 'failureReason'>>): Promise<Refund> {
    await this.prisma.refund.updateMany({
      where: { id: refundId, status: { in: ['PENDING', 'FAILED'] } },
      data: {
        status,
        processedAt: status === 'COMPLETED' ? new Date() : undefined,
        failureReason: status === 'COMPLETED' ? null : (extra.failureReason ?? null),
        providerRefundId: extra.providerRefundId,
        storeCreditEntryId: extra.storeCreditEntryId,
      },
    });
    return this.prisma.refund.findUniqueOrThrow({ where: { id: refundId } });
  }

  private async settle(intent: Refund): Promise<Refund> {
    if (intent.status === 'COMPLETED') return intent;

    if (intent.method === 'STORE_CREDIT') {
      const order = await this.prisma.order.findUniqueOrThrow({ where: { id: intent.orderId } });
      try {
        const entry = await this.storeCredit.issue({
          identity: { customerId: order.customerId ?? undefined, guestSessionId: order.guestSessionId ?? undefined },
          amount: Number(intent.amount),
          reason: intent.reason,
          referenceType: 'REFUND',
          referenceId: intent.id,
          idempotencyKey: `refund-store-credit:${intent.id}`,
          actorStaffId: intent.initiatedByStaffId ?? undefined,
        });
        return this.claim(intent.id, 'COMPLETED', { storeCreditEntryId: entry.id });
      } catch (err) {
        return this.claim(intent.id, 'FAILED', { failureReason: err instanceof Error ? err.message : 'Store credit issuance failed' });
      }
    }

    if (!intent.paymentId) {
      return this.claim(intent.id, 'FAILED', { failureReason: 'No captured payment recorded for this refund' });
    }
    const payment = await this.prisma.payment.findUniqueOrThrow({ where: { id: intent.paymentId } });
    if (!payment.providerReferenceId) {
      return this.claim(intent.id, 'FAILED', { failureReason: 'Captured payment has no provider reference id to refund against' });
    }
    try {
      const provider = resolvePaymentProvider('RAZORPAY');
      const result = await provider.refund(payment.providerReferenceId, Number(intent.amount), intent.id);
      const completed = await this.claim(intent.id, 'COMPLETED', { providerRefundId: result.providerRefundId });
      await this.updatePaymentRefundStatus(payment.id);
      await this.recomputeOrderRefundRequired(intent.orderId);
      return completed;
    } catch (err) {
      return this.claim(intent.id, 'FAILED', { failureReason: err instanceof Error ? err.message : 'Provider refund failed' });
    }
  }

  private async updatePaymentRefundStatus(paymentId: string): Promise<void> {
    const payment = await this.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    const agg = await this.prisma.refund.aggregate({ where: { paymentId, status: 'COMPLETED' }, _sum: { amount: true } });
    const refunded = Number(agg._sum.amount ?? 0);
    if (refunded <= 0) return;
    await this.prisma.payment.update({
      where: { id: paymentId },
      data: { status: refunded >= Number(payment.amount) ? 'REFUNDED' : 'PARTIALLY_REFUNDED' },
    });
  }

  /**
   * `Order.refundRequired` (M18) is a single order-level flag standing
   * in for potentially several independently-cancelled PREPAID lines -
   * this recomputes it honestly as "true iff at least one CANCELLED line
   * on this order still lacks a COMPLETED refund", so completing one
   * line's refund never falsely clears the flag while a different
   * line's refund is still outstanding.
   */
  private async recomputeOrderRefundRequired(orderId: string): Promise<void> {
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    if (order.paymentMethod !== 'PREPAID') return;
    const cancelledLines = await this.prisma.orderLine.findMany({ where: { orderId, status: 'CANCELLED' }, select: { id: true } });
    if (cancelledLines.length === 0) return;
    const completedCount = await this.prisma.refund.count({ where: { orderLineId: { in: cancelledLines.map((l) => l.id) }, status: 'COMPLETED' } });
    await this.prisma.order.update({ where: { id: orderId }, data: { refundRequired: completedCount < cancelledLines.length } });
  }

  /** Explicit trigger (staff/CS, `payment:refund`) - see this class's own docblock for why this is a deliberate explicit action, not an automatic side effect of cancellation/QC. */
  async processRefundForOrderLine(orderId: string, orderLineId: string, actorStaffId: string | null, idempotencyKey: string): Promise<Refund> {
    if (!idempotencyKey?.trim()) throw new ValidationError('An idempotency key is required');
    const intent = await this.resolveOrCreateIntent(orderId, orderLineId, actorStaffId, idempotencyKey);
    return this.settle(intent);
  }

  /** Re-attempts settlement for one currently FAILED (or stuck PENDING) refund, without creating a new row. */
  async retryRefund(refundId: string): Promise<Refund> {
    const intent = await this.prisma.refund.findUnique({ where: { id: refundId } });
    if (!intent) throw new NotFoundError('Refund', refundId);
    return this.settle(intent);
  }

  /**
   * Recovery sweep (mirrors OrderService.reconcilePendingInvoices): finds
   * every order line that currently qualifies for a refund
   * (Order.refundRequired PREPAID cancellations; ReturnLine.refundEligible
   * returns) but has no COMPLETED Refund row yet, and processes each one.
   * Safe to run repeatedly/concurrently - every line it touches goes
   * through the same idempotent `processRefundForOrderLine` path, keyed
   * deterministically so a re-run of the sweep never double-processes a
   * line a previous sweep already completed.
   */
  async reconcilePendingRefunds(): Promise<Refund[]> {
    const results: Refund[] = [];

    const flaggedOrders = await this.prisma.order.findMany({
      where: { refundRequired: true, paymentMethod: 'PREPAID' },
      include: { lines: { where: { status: 'CANCELLED' } } },
    });
    for (const order of flaggedOrders) {
      for (const line of order.lines) {
        const existing = await this.prisma.refund.findUnique({ where: { orderLineId: line.id } });
        if (existing?.status === 'COMPLETED') continue;
        results.push(await this.processRefundForOrderLine(order.id, line.id, null, `refund-sweep:${line.id}`));
      }
    }

    const eligibleReturnLines = await this.prisma.returnLine.findMany({
      where: { refundEligible: true, refund: null },
      select: { orderLineId: true, return: { select: { orderId: true } } },
    });
    for (const rl of eligibleReturnLines) {
      results.push(await this.processRefundForOrderLine(rl.return.orderId, rl.orderLineId, null, `refund-sweep:${rl.orderLineId}`));
    }

    return results;
  }

  // --- Reads ---

  async getRefund(id: string): Promise<Refund> {
    const refund = await this.prisma.refund.findUnique({ where: { id } });
    if (!refund) throw new NotFoundError('Refund', id);
    return refund;
  }

  async getRefundForOrderLine(orderLineId: string): Promise<Refund | null> {
    return this.prisma.refund.findUnique({ where: { orderLineId } });
  }

  async listRefundsForOrder(orderId: string): Promise<Refund[]> {
    return this.prisma.refund.findMany({ where: { orderId }, orderBy: { createdAt: 'desc' } });
  }
}
