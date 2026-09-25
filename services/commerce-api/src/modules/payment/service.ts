import type { FastifyInstance } from 'fastify';
import { Prisma, type PrismaClient, type PaymentStatus } from '@fcp/db';
import { loadEnv } from '@fcp/config';
import { NotFoundError } from '@fcp/shared';
import { InventoryService } from '../inventory/service.js';
import { resolvePaymentProvider, type WebhookEvent } from '../checkout/payment-provider.js';
import { recordAudit } from '../audit/service.js';
import { OrderService } from '../order/service.js';
import { ExchangeService } from '../exchanges/service.js';

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
  private readonly order: OrderService;
  private readonly exchange: ExchangeService;

  constructor(private readonly fastify: FastifyInstance) {
    this.inventory = new InventoryService(fastify);
    this.order = new OrderService(fastify);
    this.exchange = new ExchangeService(fastify);
  }

  private get prisma(): PrismaClient {
    return this.fastify.prisma;
  }

  /**
   * Verifies signature -> durably records (or resumes) the event via
   * `recordOrResumeEvent` -> applies the resulting outcome -> marks the
   * event PROCESSED only once that outcome has actually been applied.
   * An invalid signature is rejected and logged, with no state change
   * and nothing persisted (negative scenario #3) - the payload isn't
   * trustworthy enough to even record under its claimed event id.
   *
   * Final certification repair pass, Blocker 2: a duplicate delivery of
   * an ALREADY-PROCESSED event is a safe no-op (acceptance/m14-payment.md,
   * negative scenario #2) - but a duplicate delivery of an event that
   * was recorded and then never successfully processed (a transient
   * failure between the two) is NOT treated as a duplicate: it resumes
   * processing against the SAME row, never a second insert, and never
   * silently dropped. See recordOrResumeEvent's own docblock.
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

    // M21 (specs/20-exchanges.md): a price-difference payment for an
    // Exchange is never a checkout-session Payment row, so it only ever
    // reaches here once `payment` above is null. Dispatches to
    // ExchangeService's OWN transaction/state-machine - deliberately
    // never touches applyOutcome/applyCaptureOutcome below, which remain
    // exactly the M14-certified checkout-payment logic they always were.
    const exchangeMatch = !payment
      ? event.orderId
        ? await this.prisma.exchange.findFirst({ where: { paymentProviderOrderId: event.orderId } })
        : event.paymentEntityId
          ? await this.prisma.exchange.findFirst({ where: { paymentProviderPaymentId: event.paymentEntityId } })
          : null
      : null;

    const eventRecord = await this.recordOrResumeEvent(event, payment?.id, exchangeMatch?.id, payload);
    if (eventRecord.status === 'PROCESSED') {
      return { ok: true, duplicate: true };
    }

    if (exchangeMatch) {
      try {
        await this.exchange.handlePaymentWebhookEvent(exchangeMatch.id, event);
        await this.markEventProcessed(eventRecord.id);
        return { ok: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.fastify.log.error({ err, providerEventId: event.providerEventId, exchangeId: exchangeMatch.id }, 'Exchange payment event processing failed - will resume on redelivery');
        await this.prisma.paymentEvent
          .update({ where: { id: eventRecord.id }, data: { status: 'FAILED', processingError: message } })
          .catch(() => undefined);
        return { ok: false, reason: 'processing_failed' };
      }
    }

    if (!payment) {
      this.fastify.log.warn({ orderId: event.orderId, paymentEntityId: event.paymentEntityId }, 'Razorpay webhook for unknown payment reference');
      // Nothing to process against - there is no payment record this
      // event could ever apply to, so there is no future state in which
      // reprocessing this row would do anything different. Mark it
      // PROCESSED (a legitimate terminal outcome, not a failure) so a
      // redelivery of the same event id is a safe no-op rather than
      // re-logging the same warning forever.
      await this.markEventProcessed(eventRecord.id);
      return { ok: true };
    }

    try {
      // "successful payment capture" is the PREPAID order-creation trigger
      // (specs/13-payment.md). Order creation (and the checkout-time
      // reservation's conversion into a firm allocation) now happens
      // INSIDE applyOutcome's own capture transaction, not as a separate
      // call after it commits (independent-review finding #3) - see
      // applyCaptureOutcome for why: a late/lost-race reservation must
      // roll back the payment/session state atomically with it, never
      // leave a CAPTURED payment linked to no order.
      const outcome = await this.applyOutcome(payment.id, event);

      if (event.outcome === 'CAPTURED' && outcome.orderId) {
        // Invoice issuance is deliberately decoupled from the order-
        // creation transaction (independent-review finding #2) - a
        // transient invoice failure must never resurface as a webhook
        // failure to Razorpay, and must never block this event from
        // being marked PROCESSED (the payment outcome itself DID apply
        // successfully - invoice recovery has its own separate durable
        // mechanism, retryOrderInvoice/reconcilePendingInvoices).
        await this.order.retryOrderInvoice(outcome.orderId).catch(() => undefined);
      }

      await this.markEventProcessed(eventRecord.id);
      return { ok: true };
    } catch (err) {
      // The required business transition did NOT complete - this event
      // must remain retryable, never silently marked done. Durably
      // record the failure (never delete the row, never touch the
      // unique providerEventId guarantee) and signal failure so
      // Razorpay's own retry redelivers the same event id, which
      // recordOrResumeEvent will then resume against this same row.
      const message = err instanceof Error ? err.message : String(err);
      this.fastify.log.error({ err, providerEventId: event.providerEventId, paymentId: payment.id }, 'Payment event processing failed - will resume on redelivery');
      await this.prisma.paymentEvent
        .update({ where: { id: eventRecord.id }, data: { status: 'FAILED', processingError: message } })
        .catch((updateErr) => this.fastify.log.error({ updateErr, providerEventId: event.providerEventId }, 'Failed to durably record payment-event processing failure'));
      return { ok: false, reason: 'processing_failed' };
    }
  }

  /**
   * Independent-review-equivalent finding (Blocker 2, final
   * certification repair pass): the unique constraint on
   * (provider, providerEventId) used to mean "a row already exists ->
   * treat as a duplicate no-op" - but that row could have been
   * persisted BEFORE the required business transition (applyOutcome)
   * completed, so a transient failure between the two turned a
   * genuinely undelivered event into an unrecoverable "poison" record:
   * Razorpay's own retry of the identical event id would hit the
   * unique constraint and be silently swallowed, forever.
   *
   * Now: attempt the insert (status RECEIVED). If it succeeds, this is
   * a genuinely new event - return it as-is. If it fails on the unique
   * constraint, a row for this exact (provider, providerEventId)
   * already exists - fetch and return IT instead of a fresh insert
   * (never a second row, the unique guarantee is preserved exactly as
   * before). The caller then branches on that row's `status`: PROCESSED
   * is the only status that short-circuits as a duplicate no-op; every
   * other status (RECEIVED - recorded but never finished, or FAILED - a
   * previous attempt durably recorded its own failure) causes
   * processing to be attempted again against this SAME row, converging
   * once the underlying transient condition clears. Concurrent
   * redeliveries of the same event id are safe even if both resume
   * processing simultaneously: the actual business logic
   * (applyOutcome/applyCaptureOutcome) row-locks the Payment itself, so
   * two concurrent attempts genuinely serialize there regardless of
   * this table's own state (independent-review finding #3's own
   * guarantee, unchanged).
   */
  private async recordOrResumeEvent(
    event: WebhookEvent,
    paymentId: string | undefined,
    exchangeId: string | undefined,
    payload: unknown,
  ): Promise<{ id: string; status: 'RECEIVED' | 'PROCESSED' | 'FAILED' }> {
    try {
      return await this.prisma.paymentEvent.create({
        data: {
          provider: 'RAZORPAY',
          providerEventId: event.providerEventId,
          eventType: event.eventType,
          paymentId,
          exchangeId,
          payload: payload as Prisma.InputJsonValue,
          status: 'RECEIVED',
        },
        select: { id: true, status: true },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return await this.prisma.paymentEvent.findFirstOrThrow({
          where: { provider: 'RAZORPAY', providerEventId: event.providerEventId },
          select: { id: true, status: true },
        });
      }
      throw err;
    }
  }

  private async markEventProcessed(eventId: string): Promise<void> {
    await this.prisma.paymentEvent.update({
      where: { id: eventId },
      data: { status: 'PROCESSED', processedAt: new Date(), processingError: null },
    });
  }

  /**
   * Row-locks and returns one Payment by id. MUST run inside a
   * transaction. Same rationale as InventoryService.lockReservation
   * (independent-review finding #3): every transition that can race
   * against another (a capture webhook vs. the expiry sweep both acting
   * on the same Payment) reads it through this lock, so the two
   * genuinely serialize on the database instead of both reading a stale
   * status before either commits.
   */
  private async lockPayment(
    tx: Prisma.TransactionClient,
    paymentId: string,
  ): Promise<{ id: string; checkoutSessionId: string; status: PaymentStatus; providerReferenceId: string | null } | null> {
    const rows = await tx.$queryRaw<
      { id: string; checkoutSessionId: string; status: PaymentStatus; providerReferenceId: string | null }[]
    >`SELECT "id", "checkoutSessionId", "status", "providerReferenceId"
      FROM "payments"
      WHERE "id" = ${paymentId}
      FOR UPDATE`;
    return rows[0] ?? null;
  }

  /**
   * State transitions are guarded by the payment's CURRENT status, not
   * just recorded blindly - the same discipline that makes the dedup
   * above belt-and-braces rather than the only defence: even if two
   * distinct provider event ids somehow described the same outcome
   * twice, applying it twice would still be a no-op. Returns the order
   * id a CAPTURED outcome resulted in (if any), so the caller can issue
   * its invoice outside this transaction (finding #2).
   */
  private async applyOutcome(paymentId: string, event: WebhookEvent): Promise<{ orderId?: string }> {
    if (event.outcome === 'CAPTURED') {
      return this.applyCaptureOutcome(paymentId, event);
    }

    await this.prisma.$transaction(async (tx) => {
      const payment = await this.lockPayment(tx, paymentId);
      if (!payment) throw new NotFoundError('Payment', paymentId);

      if (event.outcome === 'FAILED') {
        // EXPIRED is included alongside FAILED/CAPTURED/CONFIRMED
        // (independent-review finding #3, invariant "exactly one
        // terminal outcome"): once the payment-expiry sweep has already
        // moved this attempt to EXPIRED, a late FAILED delivery must not
        // resurrect it back to FAILED and flap the checkout session's
        // status - EXPIRED already is this attempt's final word.
        if (['FAILED', 'CAPTURED', 'CONFIRMED', 'EXPIRED'].includes(payment.status)) return;
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
      } else if (event.outcome === 'REFUNDED') {
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

    return {};
  }

  /**
   * Independent-review finding #3 (BLOCKER): a Razorpay `payment.captured`
   * webhook can legitimately arrive at the same moment this payment's
   * reservation is being released by `expireStalePayments`/
   * `InventoryService.expireStaleReservations` (genuine abandonment/
   * timeout, not a client bug) - both are real, concurrently-running
   * processes reacting to real events. Capturing payment status,
   * confirming the checkout session, AND converting the reservation
   * into a firm order allocation all happen in ONE transaction here, so
   * either:
   *  - this transaction's `lockReservation`/`lockPayment` acquires its
   *    row locks first and the whole thing commits atomically (payment
   *    CAPTURED, session CONFIRMED, order created, reservation
   *    CONVERTED) - the losing expiry sweep then re-reads the
   *    now-CONVERTED reservation / now-CAPTURED payment under its own
   *    lock and correctly backs off (no release, no re-expiry); or
   *  - the expiry sweep committed first, so this transaction's own
   *    `convertReservation` throws (reservation no longer ACTIVE) and
   *    the WHOLE transaction rolls back, including the payment/session
   *    update - Payment ends up back at its pre-attempt status, never
   *    stuck "confirmed" with no allocation.
   * In the second case, the catch block below applies the capture as an
   * explicit, separate, honest fact (money was genuinely captured) and
   * routes to CAPTURE_RECONCILIATION_REQUIRED instead of ever
   * fabricating an allocation or silently losing the payment.
   */
  private async applyCaptureOutcome(paymentId: string, event: WebhookEvent): Promise<{ orderId?: string }> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const payment = await this.lockPayment(tx, paymentId);
        if (!payment) throw new NotFoundError('Payment', paymentId);

        if (payment.status === 'CAPTURED' || payment.status === 'CONFIRMED') {
          // Idempotent no-op (duplicate/replayed capture outcome) - the
          // order this payment already produced, if any, is unaffected.
          const existingOrder = await tx.order.findUnique({ where: { checkoutSessionId: payment.checkoutSessionId } });
          return { orderId: existingOrder?.id };
        }

        if (payment.status === 'FAILED' || payment.status === 'EXPIRED') {
          // A late capture arriving for an attempt our own system had
          // already given up on. Never attempt inventory re-derivation
          // here (would risk oversell/a fake allocation) - flag for
          // explicit reconciliation instead.
          return this.applyCaptureReconciliation(tx, payment, event);
        }

        const newReferenceId = event.paymentEntityId ?? payment.providerReferenceId;
        await tx.payment.update({
          where: { id: payment.id },
          data: { status: 'CAPTURED', providerReferenceId: newReferenceId },
        });
        await tx.checkoutSession.update({
          where: { id: payment.checkoutSessionId },
          data: { status: 'CONFIRMED', confirmedAt: new Date() },
        });
        await recordAudit(tx, {
          actorType: 'SYSTEM',
          action: 'payment.captured',
          entityType: 'Payment',
          entityId: payment.id,
          newValue: { providerReferenceId: newReferenceId },
        });

        const order = await this.order.createOrderFromCheckoutSession(payment.checkoutSessionId, tx);
        return { orderId: order.id };
      });
    } catch (err) {
      this.fastify.log.error(
        { err, paymentId },
        'Payment capture could not be atomically allocated to an order - flagging for reconciliation',
      );
      return this.prisma.$transaction((tx) => this.applyCaptureReconciliationById(tx, paymentId, event));
    }
  }

  private async applyCaptureReconciliationById(
    tx: Prisma.TransactionClient,
    paymentId: string,
    event: WebhookEvent,
  ): Promise<{ orderId?: string }> {
    const payment = await this.lockPayment(tx, paymentId);
    if (!payment) throw new NotFoundError('Payment', paymentId);
    return this.applyCaptureReconciliation(tx, payment, event);
  }

  /**
   * Records a genuine Razorpay capture as CAPTURED (the payment is real
   * and must never be silently dropped) while explicitly declining to
   * fabricate an order/allocation for it - the checkout session moves
   * to CAPTURE_RECONCILIATION_REQUIRED, a terminal state an operator
   * must resolve by hand (manually fulfil once stock is confirmed
   * available, or process a refund - refund execution itself is
   * specs/19-refunds.md, M20, deliberately out of this milestone).
   * Idempotent against a payment that reached CAPTURED/CONFIRMED by
   * some other path in the meantime (a genuinely concurrent duplicate
   * webhook that raced this one to the same reconciliation call).
   */
  private async applyCaptureReconciliation(
    tx: Prisma.TransactionClient,
    payment: { id: string; checkoutSessionId: string; status: PaymentStatus; providerReferenceId: string | null },
    event: WebhookEvent,
  ): Promise<{ orderId?: string }> {
    if (payment.status === 'CAPTURED' || payment.status === 'CONFIRMED') {
      const existingOrder = await tx.order.findUnique({ where: { checkoutSessionId: payment.checkoutSessionId } });
      return { orderId: existingOrder?.id };
    }

    const newReferenceId = event.paymentEntityId ?? payment.providerReferenceId;
    await tx.payment.update({
      where: { id: payment.id },
      data: { status: 'CAPTURED', providerReferenceId: newReferenceId },
    });
    await tx.checkoutSession.update({
      where: { id: payment.checkoutSessionId },
      data: {
        status: 'CAPTURE_RECONCILIATION_REQUIRED',
        reconciliationReason:
          `Razorpay reported this payment as captured, but it could not be automatically linked to a firm order ` +
          `allocation (this attempt had already reached status '${payment.status}', so its checkout session's ` +
          `inventory reservation may already have been released). The payment is genuinely captured - flagged for ` +
          `manual reconciliation (confirm stock and fulfil manually, or process a refund) rather than risking a ` +
          `false allocation or an oversell.`,
      },
    });
    await recordAudit(tx, {
      actorType: 'SYSTEM',
      action: 'payment.captured.reconciliation_required',
      entityType: 'Payment',
      entityId: payment.id,
      newValue: { providerReferenceId: newReferenceId, previousStatus: payment.status },
    });
    return {};
  }

  /**
   * Releases every Payment stuck in INITIATED past PAYMENT_TIMEOUT_SECONDS
   * (PAY-005/acceptance negative scenario #4) - handled explicitly as
   * EXPIRED, distinct from FAILED (different customer messaging/retry
   * eligibility, acceptance/m14-payment.md). Same "callable directly or
   * by a future scheduler" shape as InventoryService.expireStaleReservations.
   *
   * Independent-review finding #3: the guarded status check, the
   * session update, AND the reservation release now all happen inside
   * ONE transaction that row-locks the Payment first (lockPayment). This
   * closes the race the previous two-phase version had (commit the
   * expiry, THEN release reservations in separate, later transactions):
   * a capture webhook racing this sweep will block on the same Payment
   * row lock and, whichever commits first, the other reliably observes
   * the committed outcome under its own lock rather than blindly
   * overwriting it - see applyCaptureOutcome's docblock for the other
   * side of this same guarantee.
   */
  async expireStalePayments(): Promise<number> {
    const env = loadEnv();
    const cutoff = new Date(Date.now() - env.PAYMENT_TIMEOUT_SECONDS * 1000);

    const stale = await this.prisma.payment.findMany({
      where: { status: 'INITIATED', createdAt: { lt: cutoff } },
    });

    let expiredCount = 0;
    for (const payment of stale) {
      const didExpire = await this.prisma.$transaction(async (tx) => {
        const fresh = await this.lockPayment(tx, payment.id);
        if (!fresh || fresh.status !== 'INITIATED') return false;
        // Re-check the timeout under the lock too - a plain read taken
        // before the lock could otherwise expire a payment that was
        // genuinely re-created/retried in the meantime.
        const current = await tx.payment.findUniqueOrThrow({ where: { id: fresh.id }, select: { createdAt: true } });
        if (current.createdAt >= cutoff) return false;

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

        const lines = await tx.checkoutSessionLine.findMany({ where: { checkoutSessionId: fresh.checkoutSessionId } });
        for (const line of lines) {
          if (line.reservationId) {
            await this.inventory.releaseReservation(line.reservationId, 'payment expired', tx);
          }
        }

        return true;
      });

      if (didExpire) expiredCount += 1;
    }

    return expiredCount;
  }
}
