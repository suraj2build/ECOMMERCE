import type { FastifyInstance } from 'fastify';
import { Prisma, type PrismaClient, type Exchange, type ExchangeStatus } from '@fcp/db';
import { loadEnv } from '@fcp/config';
import { NotFoundError, ValidationError, ConflictError } from '@fcp/shared';
import { recordAudit } from '../audit/service.js';
import { OrderService } from '../order/service.js';
import { InventoryService } from '../inventory/service.js';
import { CatalogService } from '../catalog/service.js';
import { resolveShippingProvider, type ShippingProvider } from '../shipping/provider.js';
import { resolvePaymentProvider, type WebhookEvent } from '../checkout/payment-provider.js';
import { StoreCreditService } from '../refunds/store-credit-service.js';
import { resolveReturnPolicy, isWithinWindow } from '../returns/policy.js';
import type { CartOwnerIdentity } from '../cart/identity.js';

export interface InitiateExchangeInput {
  orderId: string;
  orderLineId: string;
  replacementSkuId: string;
  reason: string;
  method: 'PICKUP' | 'DROP_OFF';
}

/**
 * Exchanges (M21, specs/20-exchanges.md, EXC-001-003; `EXC-004` in
 * blueprint/DECISION_REGISTER.md). A first-class entity (EXC-001): the
 * original order/line, the replacement SKU, and any payment/credit
 * settlement all live on ONE Exchange record - genuinely reuses M19's
 * eligibility/reverse-logistics/QC-disposition machinery (the SAME
 * ReturnPolicy table via resolveReturnPolicy, the SAME
 * ShippingProvider.initiateReversePickup, the SAME
 * InventoryService.postReturnReceipt/postReturnDisposition) rather than
 * literally creating a Return record underneath (which the spec
 * explicitly rejects: "not a linked return+new-order pair").
 *
 * Settlement rail (EXC-002) is derived purely from priceDifference, not
 * from any other signal: >0 -> CUSTOMER_PAYS (collected up front, via
 * the same RazorpayPaymentProvider/webhook-idempotency discipline as
 * checkout, but through a SEPARATE webhook-dispatch path - see
 * handlePaymentWebhookEvent's own docblock for why PaymentService's own
 * M14-certified transactions are never touched); <0 -> STORE_CREDIT
 * (issued only after the original item's QC passes, mirroring M20's own
 * "never fire a financial consequence before the QC gate" discipline);
 * =0 -> EVEN (nothing to settle).
 *
 * Scope boundary (EXC-004): physical FORWARD fulfilment of the
 * replacement (pick/pack/ship/tracking) is out of this milestone -
 * `replacementAllocatedAt` marks it inventory-committed once QC passes
 * and payment/credit settles; a human/future-milestone process actually
 * ships it. See the Exchange model's own schema comment.
 */
export class ExchangeService {
  private readonly order: OrderService;
  private readonly inventory: InventoryService;
  private readonly catalog: CatalogService;
  private readonly storeCredit: StoreCreditService;
  private readonly provider: ShippingProvider;

  constructor(
    private readonly fastify: FastifyInstance,
    provider?: ShippingProvider,
  ) {
    this.order = new OrderService(fastify);
    this.inventory = new InventoryService(fastify);
    this.catalog = new CatalogService(fastify);
    this.storeCredit = new StoreCreditService(fastify);
    this.provider = provider ?? resolveShippingProvider(loadEnv().SHIPPING_PROVIDER);
  }

  private get prisma(): PrismaClient {
    return this.fastify.prisma;
  }

  private async nextExchangeNumber(tx: Prisma.TransactionClient): Promise<string> {
    const year = new Date().getFullYear();
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`exchange_seq:${year}`}))`;
    const count = await tx.exchange.count({ where: { exchangeNumber: { startsWith: `EXC-${year}-` } } });
    return `EXC-${year}-${String(count + 1).padStart(6, '0')}`;
  }

  /** Row-locks and returns one Exchange by id. MUST run inside a transaction - same idiom as ReturnService.lockReturn. */
  private async lockExchange(
    tx: Prisma.TransactionClient,
    exchangeId: string,
  ): Promise<{
    id: string;
    orderId: string;
    status: ExchangeStatus;
    method: string;
    qcResult: string | null;
    paymentStatus: string;
    replacementReservationId: string | null;
  } | null> {
    const rows = await tx.$queryRaw<
      {
        id: string;
        orderId: string;
        status: ExchangeStatus;
        method: string;
        qcResult: string | null;
        paymentStatus: string;
        replacementReservationId: string | null;
      }[]
    >`SELECT "id", "orderId", "status", "method", "qcResult"::text, "paymentStatus"::text, "replacementReservationId"
      FROM "exchanges" WHERE "id" = ${exchangeId} FOR UPDATE`;
    return rows[0] ?? null;
  }

  // --- Initiation ---

  async initiateExchangeForStaff(input: InitiateExchangeInput, staffId: string, idempotencyKey: string): Promise<Exchange> {
    return this.performInitiate(input, staffId, idempotencyKey);
  }

  async initiateExchangeForCustomer(input: InitiateExchangeInput, identity: CartOwnerIdentity, idempotencyKey: string): Promise<Exchange> {
    await this.order.loadOwnedOrder(input.orderId, identity);
    return this.performInitiate(input, null, idempotencyKey);
  }

  private async performInitiate(input: InitiateExchangeInput, staffId: string | null, idempotencyKey: string): Promise<Exchange> {
    if (!idempotencyKey?.trim()) throw new ValidationError('An idempotency key is required');
    if (!input.reason?.trim()) throw new ValidationError('An exchange reason is required');

    const priorByKey = await this.prisma.exchange.findUnique({ where: { idempotencyKey } });
    if (priorByKey) {
      if (priorByKey.orderId !== input.orderId) {
        throw new ConflictError(`Idempotency key '${idempotencyKey}' was already used for a different order`);
      }
      return priorByKey;
    }

    const line = await this.prisma.orderLine.findUnique({
      where: { id: input.orderLineId },
      include: { fulfilment: true, exchange: true, returnLine: { include: { return: true } }, sku: true },
    });
    if (!line || line.orderId !== input.orderId) throw new NotFoundError('OrderLine', input.orderLineId);
    if (line.exchange) throw new ConflictError(`Order line '${input.orderLineId}' already has an existing exchange`);
    // A line already committed to a Return (RET-002, a distinct
    // operation) can't also be independently exchanged - a CANCELLED
    // return represents "nothing happened", so it does NOT permanently
    // block a later exchange (same reasoning ReturnService's own mirror
    // check applies to a CANCELLED exchange).
    if (line.returnLine && line.returnLine.return.status !== 'CANCELLED') {
      throw new ConflictError(`Order line '${input.orderLineId}' already has an existing return`);
    }
    if (line.status !== 'DELIVERED') {
      throw new ValidationError(`Order line '${input.orderLineId}' is not eligible for exchange (status '${line.status}') - only a delivered line can be exchanged`);
    }
    const deliveredAt = line.fulfilment?.deliveredAt;
    if (!deliveredAt) throw new ValidationError(`Order line '${input.orderLineId}' has no recorded delivery date - cannot compute exchange eligibility`);

    // EXC-003: the SAME window/policy table as returns, configured together.
    const policy = await resolveReturnPolicy(this.prisma, line.skuId);
    if (!policy.returnable) throw new ValidationError(`Order line '${input.orderLineId}' belongs to a non-exchangeable category/product`);
    if (!isWithinWindow(deliveredAt, policy.windowDays)) {
      throw new ValidationError(`The exchange window (${policy.windowDays} day(s) from delivery) has expired for order line '${input.orderLineId}'`);
    }

    if (input.replacementSkuId === line.skuId) {
      throw new ValidationError('The replacement SKU must be different from the original SKU');
    }
    const replacementSku = await this.prisma.sku.findUnique({ where: { id: input.replacementSkuId }, include: { style: true, colour: true, size: true } });
    if (!replacementSku) throw new NotFoundError('Sku', input.replacementSkuId);

    const price = await this.catalog.getActivePrice(replacementSku.styleId, replacementSku.colourId);
    if (!price) throw new ValidationError(`Replacement SKU '${input.replacementSkuId}' has no active price - cannot compute the exchange price difference`);

    const originalLineValue = Number(line.lineTotalInclusive);
    const replacementValue = Number(price.sellingPrice) * line.quantity;
    const priceDifference = Math.round((replacementValue - originalLineValue + Number.EPSILON) * 100) / 100;
    const paymentDirection = priceDifference > 0 ? 'CUSTOMER_PAYS' : priceDifference < 0 ? 'STORE_CREDIT' : 'EVEN';

    // Replacement-SKU availability check + reservation, in the SAME
    // request (negative scenario #1: "clearly communicated, not silently
    // accepted then failed later") - a genuine InsufficientStockError
    // here fails the whole initiate() call, never a partially-created
    // Exchange. Held for EXCHANGE_REPLACEMENT_HOLD_DAYS (negative
    // scenario #2), far longer than checkout's own short-lived default.
    const holdSeconds = loadEnv().EXCHANGE_REPLACEMENT_HOLD_DAYS * 86_400;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const reservation = await this.inventory.reserve(
          {
            skuId: replacementSku.id,
            locationId: line.locationId,
            quantity: line.quantity,
            referenceType: 'EXCHANGE',
            referenceId: input.orderLineId,
            idempotencyKey: `exchange-reserve:${input.orderLineId}`,
            ttlSeconds: holdSeconds,
          },
        );

        const exchangeNumber = await this.nextExchangeNumber(tx);
        const created = await tx.exchange.create({
          data: {
            exchangeNumber,
            orderId: input.orderId,
            orderLineId: input.orderLineId,
            originalSkuId: line.skuId,
            originalLocationId: line.locationId,
            quantity: line.quantity,
            replacementSkuId: replacementSku.id,
            reason: input.reason.trim(),
            method: input.method,
            initiatedBy: staffId ? 'STAFF' : 'CUSTOMER',
            initiatedByStaffId: staffId ?? undefined,
            idempotencyKey,
            replacementReservationId: reservation.id,
            originalLineValue,
            replacementValue,
            priceDifference,
            paymentDirection,
            paymentStatus: paymentDirection === 'CUSTOMER_PAYS' ? 'PENDING' : 'NOT_REQUIRED',
          },
        });

        await recordAudit(tx, {
          actorType: staffId ? 'STAFF' : 'CUSTOMER',
          actorStaffId: staffId ?? undefined,
          action: 'exchange.initiate',
          entityType: 'Exchange',
          entityId: created.id,
          newValue: { orderLineId: input.orderLineId, replacementSkuId: replacementSku.id, priceDifference, paymentDirection },
          reference: input.orderId,
        });

        return created;
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const winner = await this.prisma.exchange.findUnique({ where: { idempotencyKey } });
        if (winner && winner.orderId === input.orderId) return winner;
        throw new ConflictError('This order line already has an existing exchange, or this idempotency key was already used');
      }
      throw err;
    }
  }

  /**
   * Initiates the price-difference payment (CUSTOMER_PAYS only) - the
   * storefront opens Razorpay's Checkout.js with the returned
   * orderId/publicKeyId, the SAME widget lib/razorpay.ts already
   * launches for checkout. Idempotent: a repeat call while PENDING
   * simply re-returns the SAME Razorpay order rather than creating a
   * second one.
   */
  async initiatePriceDifferencePayment(exchangeId: string): Promise<{ providerOrderId: string; publicKeyId?: string; amount: number }> {
    const exchange = await this.getExchange(exchangeId);
    if (exchange.paymentDirection !== 'CUSTOMER_PAYS') {
      throw new ValidationError('This exchange does not require a price-difference payment');
    }
    if (exchange.paymentStatus === 'CAPTURED') throw new ValidationError('The price-difference payment has already been captured');

    if (exchange.paymentProviderOrderId) {
      const provider = resolvePaymentProvider('RAZORPAY');
      const creds = provider.name; // presence check only - key is read inside initiate()
      void creds;
      return { providerOrderId: exchange.paymentProviderOrderId, amount: exchange.priceDifference as unknown as number };
    }

    const provider = resolvePaymentProvider('RAZORPAY');
    const result = await provider.initiate({
      checkoutSessionId: exchange.id,
      amount: Number(exchange.priceDifference),
      idempotencyKey: `exchange-payment:${exchange.id}`,
    });
    if (result.status === 'UNAVAILABLE' || !result.providerReferenceId) {
      throw new ValidationError(result.message ?? 'Online payment is currently unavailable - please try again shortly');
    }

    await this.prisma.exchange.update({ where: { id: exchange.id }, data: { paymentProviderOrderId: result.providerReferenceId } });
    return { providerOrderId: result.providerReferenceId, publicKeyId: result.publicKeyId, amount: Number(exchange.priceDifference) };
  }

  /**
   * Called by PaymentService.handleRazorpayWebhook when a webhook event
   * correlates to an Exchange's own paymentProviderOrderId/
   * paymentProviderPaymentId rather than any checkout-session Payment
   * row. Deliberately a fully separate transaction/state-machine from
   * PaymentService's own applyOutcome/applyCaptureOutcome (M14-certified,
   * left untouched) - this method owns its OWN row-locking and its OWN
   * conditional-claim discipline, so a race here can never interact with
   * a real checkout payment's guarantees.
   */
  async handlePaymentWebhookEvent(exchangeId: string, event: WebhookEvent): Promise<void> {
    if (event.outcome === 'CAPTURED') {
      await this.prisma.exchange.updateMany({
        where: { id: exchangeId, paymentStatus: { in: ['PENDING', 'FAILED'] } },
        data: { paymentStatus: 'CAPTURED', paymentProviderPaymentId: event.paymentEntityId ?? undefined },
      });
      await recordAudit(this.prisma, {
        actorType: 'SYSTEM',
        action: 'exchange.payment.captured',
        entityType: 'Exchange',
        entityId: exchangeId,
      });
      await this.tryComplete(exchangeId);
    } else if (event.outcome === 'FAILED') {
      await this.prisma.exchange.updateMany({
        where: { id: exchangeId, paymentStatus: 'PENDING' },
        data: { paymentStatus: 'FAILED' },
      });
      await recordAudit(this.prisma, {
        actorType: 'SYSTEM',
        action: 'exchange.payment.failed',
        entityType: 'Exchange',
        entityId: exchangeId,
      });
      // Negative scenario #3: the exchange does NOT complete silently,
      // and stays fully retryable (initiatePriceDifferencePayment) - no
      // re-initiation of the exchange itself required.
    }
  }

  // --- Cancellation (before receipt) ---

  async cancelExchange(exchangeId: string, staffId: string | null, identity: CartOwnerIdentity | null, reason: string | undefined): Promise<Exchange> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await this.lockExchange(tx, exchangeId);
      if (!existing) throw new NotFoundError('Exchange', exchangeId);

      if (identity) {
        const order = await tx.order.findUniqueOrThrow({ where: { id: existing.orderId } });
        const owns =
          (identity.customerId && order.customerId === identity.customerId) || (identity.guestSessionId && order.guestSessionId === identity.guestSessionId);
        if (!owns) throw new NotFoundError('Exchange', exchangeId);
      }

      if (existing.status === 'CANCELLED') return tx.exchange.findUniqueOrThrow({ where: { id: exchangeId } });
      if (existing.status !== 'REQUESTED' && existing.status !== 'PICKUP_SCHEDULED') {
        throw new ValidationError(`Cannot cancel an exchange in status '${existing.status}'`);
      }

      if (existing.replacementReservationId) {
        await this.inventory.releaseReservation(existing.replacementReservationId, reason?.trim() || 'Exchange cancelled', tx);
      }

      await tx.exchange.update({ where: { id: exchangeId }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledReason: reason?.trim() || null } });
      await recordAudit(tx, {
        actorType: staffId ? 'STAFF' : 'CUSTOMER',
        actorStaffId: staffId ?? undefined,
        action: 'exchange.cancel',
        entityType: 'Exchange',
        entityId: exchangeId,
        newValue: { reason: reason?.trim() || null },
        reference: existing.orderId,
      });

      return tx.exchange.findUniqueOrThrow({ where: { id: exchangeId } });
    });
  }

  // --- Reverse logistics for the ORIGINAL item (mirrors ReturnService.schedulePickup/markPickedUp) ---

  async schedulePickup(exchangeId: string, staffId: string, idempotencyKey: string): Promise<Exchange> {
    if (!idempotencyKey?.trim()) throw new ValidationError('An idempotency key is required');

    const byKey = await this.prisma.exchange.findUnique({ where: { pickupIdempotencyKey: idempotencyKey } });
    if (byKey && byKey.id !== exchangeId) throw new ConflictError(`Idempotency key '${idempotencyKey}' was already used for a different exchange`);

    const exchange = await this.getExchange(exchangeId);
    if (exchange.method !== 'PICKUP') throw new ValidationError('This exchange uses customer drop-off, not carrier pickup');
    if (exchange.status === 'PICKUP_SCHEDULED' || exchange.status === 'PICKED_UP' || exchange.status === 'RECEIVED') {
      return exchange; // idempotent no-op
    }
    if (exchange.status !== 'REQUESTED') throw new ValidationError(`Cannot schedule a pickup for an exchange in status '${exchange.status}'`);

    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: exchange.orderId } });
    const address = order.shippingAddress as { pincode?: string } | null;

    const booking = await this.provider.initiateReversePickup({
      pickupId: exchange.id,
      returnNumber: exchange.exchangeNumber,
      originPincode: address?.pincode ?? '',
    });
    if (booking.status === 'UNAVAILABLE') {
      throw new ValidationError(booking.message ?? `Carrier '${this.provider.name}' is currently unavailable for reverse pickup - please retry`);
    }

    return this.prisma.$transaction(async (tx) => {
      const locked = await this.lockExchange(tx, exchangeId);
      if (!locked) throw new NotFoundError('Exchange', exchangeId);
      if (locked.status !== 'REQUESTED') return tx.exchange.findUniqueOrThrow({ where: { id: exchangeId } });

      await tx.exchange.update({
        where: { id: exchangeId },
        data: {
          status: 'PICKUP_SCHEDULED',
          pickupStatus: 'SCHEDULED',
          pickupProvider: this.provider.name,
          pickupProviderRef: booking.providerPickupRef,
          pickupTrackingRef: booking.trackingRef,
          pickupIdempotencyKey: idempotencyKey,
          scheduledAt: new Date(),
        },
      });
      await recordAudit(tx, {
        actorType: 'STAFF',
        actorStaffId: staffId,
        action: 'exchange.pickup.schedule',
        entityType: 'Exchange',
        entityId: exchangeId,
        newValue: { provider: this.provider.name },
        reference: exchange.orderId,
      });
      return tx.exchange.findUniqueOrThrow({ where: { id: exchangeId } });
    });
  }

  async markPickedUp(exchangeId: string, staffId: string): Promise<Exchange> {
    return this.prisma.$transaction(async (tx) => {
      const locked = await this.lockExchange(tx, exchangeId);
      if (!locked) throw new NotFoundError('Exchange', exchangeId);
      if (locked.status === 'PICKED_UP' || locked.status === 'RECEIVED') return tx.exchange.findUniqueOrThrow({ where: { id: exchangeId } });
      if (locked.status !== 'PICKUP_SCHEDULED') throw new ValidationError(`Cannot mark picked-up an exchange in status '${locked.status}'`);

      await tx.exchange.update({ where: { id: exchangeId }, data: { status: 'PICKED_UP', pickupStatus: 'PICKED_UP', pickedUpAt: new Date() } });
      await recordAudit(tx, { actorType: 'STAFF', actorStaffId: staffId, action: 'exchange.pickup.complete', entityType: 'Exchange', entityId: exchangeId, reference: locked.orderId });
      return tx.exchange.findUniqueOrThrow({ where: { id: exchangeId } });
    });
  }

  /** Mirrors ReturnService.markReceived exactly, for the ORIGINAL sku. */
  async markReceived(exchangeId: string, staffId: string): Promise<Exchange> {
    return this.prisma.$transaction(async (tx) => {
      const locked = await this.lockExchange(tx, exchangeId);
      if (!locked) throw new NotFoundError('Exchange', exchangeId);
      if (locked.status === 'RECEIVED') return tx.exchange.findUniqueOrThrow({ where: { id: exchangeId } });

      const eligibleFromStatus = locked.method === 'DROP_OFF' ? 'REQUESTED' : 'PICKED_UP';
      if (locked.status !== eligibleFromStatus) {
        throw new ValidationError(`Cannot mark received a ${locked.method} exchange in status '${locked.status}' - expected '${eligibleFromStatus}'`);
      }

      const full = await tx.exchange.findUniqueOrThrow({ where: { id: exchangeId } });
      await this.inventory.postReturnReceipt(
        {
          skuId: full.originalSkuId,
          locationId: full.originalLocationId,
          quantity: full.quantity,
          referenceType: 'EXCHANGE',
          referenceId: exchangeId,
          idempotencyKey: `exchange-receipt:${exchangeId}`,
        },
        tx,
      );

      await tx.exchange.update({ where: { id: exchangeId }, data: { status: 'RECEIVED', receivedAt: new Date() } });
      await recordAudit(tx, { actorType: 'STAFF', actorStaffId: staffId, action: 'exchange.receive', entityType: 'Exchange', entityId: exchangeId, reference: locked.orderId });
      return tx.exchange.findUniqueOrThrow({ where: { id: exchangeId } });
    });
  }

  // --- QC + disposition of the ORIGINAL item, then completion ---

  async recordQcAndDisposition(
    exchangeId: string,
    staffId: string,
    input: { qcResult: 'PASS' | 'FAIL'; disposition: 'RESTOCK_SELLABLE' | 'RESTOCK_DAMAGED' | 'WRITE_OFF' | 'RETURN_TO_SUPPLIER'; notes?: string },
  ): Promise<Exchange> {
    if (input.qcResult === 'PASS' && input.disposition !== 'RESTOCK_SELLABLE') {
      throw new ValidationError('A PASS QC result must use the RESTOCK_SELLABLE disposition');
    }
    if (input.qcResult === 'FAIL' && input.disposition === 'RESTOCK_SELLABLE') {
      throw new ValidationError('A FAIL QC result cannot use the RESTOCK_SELLABLE disposition');
    }

    await this.prisma.$transaction(async (tx) => {
      const locked = await this.lockExchange(tx, exchangeId);
      if (!locked) throw new NotFoundError('Exchange', exchangeId);
      if (locked.status !== 'RECEIVED') {
        if (locked.qcResult) return; // idempotent no-op - already resolved
        throw new ValidationError(`Cannot record QC for an exchange in status '${locked.status}' - it must be RECEIVED first`);
      }

      const full = await tx.exchange.findUniqueOrThrow({ where: { id: exchangeId } });
      if (full.qcResult) return; // idempotent no-op

      await this.inventory.postReturnDisposition(
        {
          skuId: full.originalSkuId,
          locationId: full.originalLocationId,
          quantity: full.quantity,
          disposition: input.disposition,
          referenceType: 'EXCHANGE',
          referenceId: exchangeId,
          reason: input.notes?.trim() || input.disposition,
          idempotencyKey: `exchange-disposition:${exchangeId}`,
        },
        tx,
      );

      const now = new Date();
      await tx.exchange.update({
        where: { id: exchangeId },
        data: {
          qcResult: input.qcResult,
          disposition: input.disposition,
          qcNotes: input.notes?.trim() || null,
          qcActorStaffId: staffId,
          qcAt: now,
          dispositionedAt: now,
          status: input.qcResult === 'FAIL' ? 'QC_FAILED' : locked.status,
        },
      });
      await recordAudit(tx, {
        actorType: 'STAFF',
        actorStaffId: staffId,
        action: 'exchange.qc.record',
        entityType: 'Exchange',
        entityId: exchangeId,
        newValue: { qcResult: input.qcResult, disposition: input.disposition },
        reference: exchangeId,
      });
    });

    if (input.qcResult === 'PASS') await this.tryComplete(exchangeId);
    return this.getExchange(exchangeId);
  }

  /**
   * Attempts to move a QC-passed exchange to COMPLETED: settles the
   * price difference (issues store credit if STORE_CREDIT and not yet
   * issued; no-ops if CUSTOMER_PAYS and not yet CAPTURED - completion
   * simply waits) and converts the replacement reservation into a firm
   * allocation. Called from both the QC-pass path and the payment-
   * capture webhook path, since completion depends on BOTH conditions
   * and either can be the one that arrives last.
   */
  private async tryComplete(exchangeId: string): Promise<void> {
    const exchange = await this.prisma.exchange.findUnique({ where: { id: exchangeId } });
    if (!exchange) return;
    if (exchange.status === 'COMPLETED' || exchange.status === 'CANCELLED' || exchange.status === 'QC_FAILED' || exchange.status === 'REPLACEMENT_UNAVAILABLE') return;
    if (exchange.qcResult !== 'PASS') return;
    const paymentSettled = exchange.paymentStatus === 'NOT_REQUIRED' || exchange.paymentStatus === 'CAPTURED';
    if (!paymentSettled) return;

    if (exchange.paymentDirection === 'STORE_CREDIT' && !exchange.storeCreditEntryId) {
      const order = await this.prisma.order.findUniqueOrThrow({ where: { id: exchange.orderId } });
      const entry = await this.storeCredit.issue({
        identity: { customerId: order.customerId ?? undefined, guestSessionId: order.guestSessionId ?? undefined },
        amount: Math.abs(Number(exchange.priceDifference)),
        reason: `Exchange ${exchange.exchangeNumber} price difference`,
        referenceType: 'EXCHANGE',
        referenceId: exchange.id,
        idempotencyKey: `exchange-store-credit:${exchange.id}`,
      });
      await this.prisma.exchange.update({ where: { id: exchange.id }, data: { storeCreditEntryId: entry.id } });
    }

    if (!exchange.replacementReservationId) return;
    try {
      await this.inventory.convertReservation(exchange.replacementReservationId);
    } catch {
      // The reservation is no longer ACTIVE (expired past
      // EXCHANGE_REPLACEMENT_HOLD_DAYS, or otherwise lost) - a real,
      // customer-visible outcome (acceptance negative scenario #2), never
      // silently swallowed: the Exchange durably records it for
      // human follow-up (offer an alternative SKU, or fall back to a
      // standard refund) rather than pretending the replacement is ready.
      await this.prisma.exchange.updateMany({
        where: { id: exchange.id, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
        data: { status: 'REPLACEMENT_UNAVAILABLE' },
      });
      await recordAudit(this.prisma, {
        actorType: 'SYSTEM',
        action: 'exchange.replacement.unavailable',
        entityType: 'Exchange',
        entityId: exchange.id,
        reference: exchange.orderId,
      });
      return;
    }

    await this.prisma.exchange.updateMany({
      where: { id: exchange.id, status: { notIn: ['COMPLETED', 'CANCELLED', 'REPLACEMENT_UNAVAILABLE'] } },
      data: { status: 'COMPLETED', replacementAllocatedAt: new Date() },
    });
    await recordAudit(this.prisma, { actorType: 'SYSTEM', action: 'exchange.complete', entityType: 'Exchange', entityId: exchange.id, reference: exchange.orderId });
  }

  // --- Reads ---

  async getExchange(id: string): Promise<Exchange> {
    const exchange = await this.prisma.exchange.findUnique({ where: { id } });
    if (!exchange) throw new NotFoundError('Exchange', id);
    return exchange;
  }

  async getExchangeForCustomer(id: string, identity: CartOwnerIdentity): Promise<Exchange> {
    const exchange = await this.getExchange(id);
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: exchange.orderId } });
    const owns = (identity.customerId && order.customerId === identity.customerId) || (identity.guestSessionId && order.guestSessionId === identity.guestSessionId);
    if (!owns) throw new NotFoundError('Exchange', id);
    return exchange;
  }

  async listExchangesForOrder(orderId: string): Promise<Exchange[]> {
    return this.prisma.exchange.findMany({ where: { orderId }, orderBy: { createdAt: 'desc' } });
  }

  async listExchangesForCustomer(identity: CartOwnerIdentity): Promise<Exchange[]> {
    const where = identity.customerId ? { customerId: identity.customerId } : { guestSessionId: identity.guestSessionId };
    const orders = await this.prisma.order.findMany({ where, select: { id: true } });
    const orderIds = orders.map((o) => o.id);
    if (orderIds.length === 0) return [];
    return this.prisma.exchange.findMany({ where: { orderId: { in: orderIds } }, orderBy: { createdAt: 'desc' } });
  }

  async listPendingWarehouseWork(status?: ExchangeStatus): Promise<Exchange[]> {
    return this.prisma.exchange.findMany({
      where: status ? { status } : { status: { in: ['REQUESTED', 'PICKUP_SCHEDULED', 'PICKED_UP', 'RECEIVED'] } },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
  }
}
