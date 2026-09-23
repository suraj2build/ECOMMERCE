import type { FastifyInstance } from 'fastify';
import { Prisma, type PrismaClient } from '@fcp/db';
import { loadEnv } from '@fcp/config';
import { InventoryService } from '../inventory/service.js';
import { resolvePaymentProvider, type WebhookEvent } from '../checkout/payment-provider.js';
import { recordAudit } from '../audit/service.js';

export interface WebhookResult {
  ok: boolean;
  duplicate?: boolean;
  reason?: string;
}

/**
 * Payment (M14, specs/13-payment.md). Owns webhook handling (signature
 * verification + dedup, PAY-002/003) and the stale-payment sweep
 * (PAY-005's "released on final failure/timeout" requirement) - both
 * depend only on the PaymentProvider interface, never Razorpay's SDK.
 * Retry (starting a new Payment attempt against an already-reserved
 * CheckoutSession) stays on CheckoutService, which already owns
 * reservation/session lifecycle and the same idempotency discipline.
 */
export class PaymentService {
  private readonly inventory: InventoryService;

  constructor(private readonly fastify: FastifyInstance) {
    this.inventory = new InventoryService(fastify);
  }

  private get prisma(): PrismaClient {
    return this.fastify.prisma;
  }

  /**
   * Verifies signature -> dedupes by (provider, providerEventId) via the
   * DB's own unique constraint, BEFORE any state change -> applies the
   * resulting outcome. A duplicate delivery of the same event is a safe
   * no-op (acceptance/m14-payment.md, negative scenario #2). An invalid
   * signature is rejected and logged, with no state change and nothing
   * persisted (negative scenario #3) - the payload isn't trustworthy
   * enough to even record under its claimed event id.
   */
  async handleRazorpayWebhook(rawBody: string, signatureHeader: string | undefined): Promise<WebhookResult> {
    const provider = resolvePaymentProvider('RAZORPAY');
    if (!signatureHeader || !provider.verifyWebhookSignature(rawBody, signatureHeader)) {
      this.fastify.log.warn('Rejected Razorpay webhook: invalid or missing signature');
      return { ok: false, reason: 'invalid_signature' };
    }

    let event: WebhookEvent;
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
      event = provider.parseWebhookEvent(rawBody);
    } catch (err) {
      this.fastify.log.warn({ err }, 'Rejected Razorpay webhook: unparseable payload');
      return { ok: false, reason: 'unparseable_payload' };
    }

    // Payment.providerReferenceId holds the Razorpay ORDER id while a
    // payment is in flight (that's all initiate() has), then gets
    // swapped to the actual PAYMENT id on capture (see applyOutcome) so
    // later refund.* events - which carry payment_id but never order_id
    // - still correlate. Try the order-id correlation first since it
    // covers the payment.captured/payment.failed path this milestone
    // must prove; fall back to the payment-entity id for refund events.
    const payment = event.orderId
      ? await this.prisma.payment.findFirst({ where: { provider: 'RAZORPAY', providerReferenceId: event.orderId } })
      : event.paymentEntityId
        ? await this.prisma.payment.findFirst({ where: { provider: 'RAZORPAY', providerReferenceId: event.paymentEntityId } })
        : null;

    try {
      await this.prisma.paymentEvent.create({
        data: {
          provider: 'RAZORPAY',
          providerEventId: event.providerEventId,
          eventType: event.eventType,
          paymentId: payment?.id,
          payload: payload as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return { ok: true, duplicate: true };
      }
      throw err;
    }

    if (!payment) {
      this.fastify.log.warn({ orderId: event.orderId, paymentEntityId: event.paymentEntityId }, 'Razorpay webhook for unknown payment reference');
      return { ok: true };
    }

    await this.applyOutcome(payment.id, event);
    return { ok: true };
  }

  /**
   * State transitions are guarded by the payment's CURRENT status, not
   * just recorded blindly - the same discipline that makes the dedup
   * above belt-and-braces rather than the only defence: even if two
   * distinct provider event ids somehow described the same outcome
   * twice, applying it twice would still be a no-op.
   */
  private async applyOutcome(paymentId: string, event: WebhookEvent): Promise<void> {
    const outcome = event.outcome;

    await this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });

      if (outcome === 'CAPTURED') {
        if (payment.status === 'CAPTURED' || payment.status === 'CONFIRMED') return;
        await tx.payment.update({
          where: { id: paymentId },
          data: {
            status: 'CAPTURED',
            // Swap the correlation id from the order id to the actual
            // payment id now that one exists - see the comment above
            // handleRazorpayWebhook's lookup.
            providerReferenceId: event.paymentEntityId ?? payment.providerReferenceId,
          },
        });
        await tx.checkoutSession.update({
          where: { id: payment.checkoutSessionId },
          data: { status: 'CONFIRMED', confirmedAt: new Date() },
        });
        await recordAudit(tx, {
          actorType: 'SYSTEM',
          action: 'payment.captured',
          entityType: 'Payment',
          entityId: paymentId,
          newValue: { providerReferenceId: payment.providerReferenceId },
        });
      } else if (outcome === 'FAILED') {
        if (payment.status === 'FAILED' || payment.status === 'CAPTURED' || payment.status === 'CONFIRMED') return;
        await tx.payment.update({ where: { id: paymentId }, data: { status: 'FAILED' } });
        // Deliberately does NOT release the reservation here - a failed
        // attempt (e.g. card declined) is not yet "final failure"
        // (PAY-005): the customer can retry from the same reservation
        // within its own TTL window (acceptance/m14-payment.md negative
        // scenario #1). The reservation is released only by genuine
        // abandonment (its own TTL sweep, M06) or a payment TIMEOUT
        // (expireStalePayments below) - both distinct from a card being
        // declined.
        await tx.checkoutSession.update({
          where: { id: payment.checkoutSessionId },
          data: { status: 'PAYMENT_FAILED' },
        });
        await recordAudit(tx, {
          actorType: 'SYSTEM',
          action: 'payment.failed',
          entityType: 'Payment',
          entityId: paymentId,
          newValue: { providerReferenceId: payment.providerReferenceId },
        });
      } else if (outcome === 'REFUNDED') {
        if (payment.status === 'REFUNDED') return;
        await tx.payment.update({ where: { id: paymentId }, data: { status: 'REFUNDED' } });
        await recordAudit(tx, {
          actorType: 'SYSTEM',
          action: 'payment.refunded',
          entityType: 'Payment',
          entityId: paymentId,
          newValue: { providerReferenceId: payment.providerReferenceId },
        });
      }
      // OTHER: recognised-but-unhandled Razorpay event types (e.g.
      // order.paid) - already recorded in PaymentEvent above for
      // reconciliation, deliberately no state transition here.
    });
  }

  private async releaseSessionReservations(paymentId: string, reason: string): Promise<void> {
    const payment = await this.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    const lines = await this.prisma.checkoutSessionLine.findMany({
      where: { checkoutSessionId: payment.checkoutSessionId },
    });
    for (const line of lines) {
      if (line.reservationId) {
        await this.inventory.releaseReservation(line.reservationId, reason);
      }
    }
  }

  /**
   * Releases every Payment stuck in INITIATED past PAYMENT_TIMEOUT_SECONDS
   * (PAY-005/acceptance negative scenario #4) - handled explicitly as
   * EXPIRED, distinct from FAILED (different customer messaging/retry
   * eligibility, acceptance/m14-payment.md). Same "callable directly or
   * by a future scheduler" shape as InventoryService.expireStaleReservations.
   */
  async expireStalePayments(): Promise<number> {
    const env = loadEnv();
    const cutoff = new Date(Date.now() - env.PAYMENT_TIMEOUT_SECONDS * 1000);

    const stale = await this.prisma.payment.findMany({
      where: { status: 'INITIATED', createdAt: { lt: cutoff } },
    });

    for (const payment of stale) {
      await this.prisma.$transaction(async (tx) => {
        const fresh = await tx.payment.findUnique({ where: { id: payment.id } });
        if (!fresh || fresh.status !== 'INITIATED') return;

        await tx.payment.update({ where: { id: fresh.id }, data: { status: 'EXPIRED' } });

        const session = await tx.checkoutSession.findUnique({ where: { id: fresh.checkoutSessionId } });
        // Only expire the session if this was genuinely its current
        // attempt and it hadn't already moved on (e.g. a retry already
        // superseded it, or it somehow confirmed in the same instant).
        if (session && session.status === 'RESERVED') {
          await tx.checkoutSession.update({ where: { id: session.id }, data: { status: 'EXPIRED' } });
        }

        await recordAudit(tx, {
          actorType: 'SYSTEM',
          action: 'payment.expired',
          entityType: 'Payment',
          entityId: fresh.id,
          newValue: { providerReferenceId: fresh.providerReferenceId },
        });
      });

      await this.releaseSessionReservations(payment.id, 'payment expired');
    }

    return stale.length;
  }
}
