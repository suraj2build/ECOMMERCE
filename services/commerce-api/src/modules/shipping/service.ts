import type { FastifyInstance } from 'fastify';
import { Prisma, type PrismaClient, type Shipment, type ShipmentTrackingStatus, type ShipmentEventSource } from '@fcp/db';
import { loadEnv } from '@fcp/config';
import { NotFoundError, ValidationError, ConflictError } from '@fcp/shared';
import { recordAudit } from '../audit/service.js';
import { OrderService } from '../order/service.js';
import {
  resolveShippingProvider,
  type ShippingProvider,
  type CarrierTrackingEvent,
  type NormalizedTrackingStatus,
} from './provider.js';

export interface ShippingWebhookResult {
  ok: boolean;
  duplicate?: boolean;
  reason?: string;
}

/**
 * Platform-owned tracking state machine (specs/16-shipping-tracking.md
 * §9). Maps a shipment's CURRENT status to the set of normalized
 * carrier statuses that may legally follow it. A status equal to the
 * current one is always accepted separately as an idempotent no-op
 * (duplicate/replayed carrier report), never listed here. `CREATED`
 * never appears as a target - the CREATED->BOOKED transition happens
 * only inside `createShipment`'s own carrier-booking flow, never via a
 * carrier tracking event (no carrier event can manufacture a booking
 * that never happened).
 */
const ALLOWED_TRANSITIONS: Record<ShipmentTrackingStatus, NormalizedTrackingStatus[]> = {
  CREATED: ['BOOKED'],
  BOOKED: ['IN_TRANSIT', 'OUT_FOR_DELIVERY'],
  IN_TRANSIT: ['OUT_FOR_DELIVERY', 'DELIVERED'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'DELIVERY_FAILED'],
  DELIVERY_FAILED: ['OUT_FOR_DELIVERY', 'RTO_INITIATED'],
  RTO_INITIATED: ['RTO_DELIVERED'],
  DELIVERED: [],
  RTO_DELIVERED: [],
};

/**
 * Shipping / Tracking (M17, specs/16-shipping-tracking.md, SHIP-001-004,
 * ADR-0020). Owns the shipment lifecycle FROM the M16 READY_TO_SHIP
 * hand-off onward: carrier booking (`createShipment`), webhook-driven
 * tracking (`handleCarrierWebhook`), the configurable polling fallback
 * (`pollPendingShipments`), and the state machine that drives
 * OrderFulfilment/Order transitions via `OrderService` - never a second,
 * competing posting path for SALE or RTO (M16 certification invariant).
 */
export class ShippingService {
  private readonly order: OrderService;
  private readonly provider: ShippingProvider;

  constructor(
    private readonly fastify: FastifyInstance,
    provider?: ShippingProvider,
  ) {
    this.order = new OrderService(fastify);
    this.provider = provider ?? resolveShippingProvider(loadEnv().SHIPPING_PROVIDER);
  }

  private get prisma(): PrismaClient {
    return this.fastify.prisma;
  }

  /**
   * Row-locks and returns one Shipment by id (same SELECT ... FOR UPDATE
   * idiom as OrderService.lockFulfilment/InventoryService.lockReservation)
   * - MUST run inside a transaction, and MUST be the first thing any
   * tracking-status transition does, so two genuinely concurrent updates
   * for the same shipment (a webhook racing a poll, or two redelivered
   * webhooks) serialize on this row rather than both reading the same
   * pre-transition status.
   */
  private async lockShipment(tx: Prisma.TransactionClient, shipmentId: string): Promise<Shipment | null> {
    const rows = await tx.$queryRaw<Shipment[]>`SELECT * FROM "shipments" WHERE "id" = ${shipmentId} FOR UPDATE`;
    return rows[0] ?? null;
  }

  /**
   * Creates (or idempotently resumes) a shipment for a fulfilment that
   * has legitimately reached READY_TO_SHIP (M16 hand-off boundary - a
   * carrier callback or any other path can never manufacture fulfilment
   * eligibility, per the M17 build instruction). Idempotent on
   * `idempotencyKey`: a network-level retry of the exact same request
   * resolves to the SAME Shipment row, never a second one, a second
   * carrier booking, or a second audit entry for the same business
   * action.
   *
   * Distributed-system failure window (SHIP §7): the Shipment row is
   * created in status CREATED (durable local intent) BEFORE the carrier
   * is ever called - a crash after that commit but before the carrier
   * call returns is recoverable by simply retrying this same call
   * (`resolveOrCreateShipmentIntent` finds the existing CREATED row and
   * resumes from the carrier call, never re-creates it). The carrier
   * call itself happens OUTSIDE any open Postgres transaction (a
   * transaction must never hold open across an external HTTP call) and
   * relies on `ShippingProvider.initiateShipment` being idempotent-by-
   * shipmentId, so a retry after a crash between "carrier call
   * succeeded" and "local commit" calls the carrier again safely and
   * gets back the identical booking rather than a duplicate one. Only
   * once the carrier has genuinely responded does the final transaction
   * claim the CREATED->BOOKED transition (guarded by a conditional
   * `updateMany` so a genuinely concurrent duplicate request loses the
   * race harmlessly) and reuse `OrderService.markFulfilmentShipped`
   * (via `externalTx`) so the SALE-posting/status transition commits
   * atomically alongside the booking - still the one authoritative SALE
   * posting point (M16 certification invariant), never duplicated here.
   */
  async createShipment(fulfilmentId: string, staffId: string, idempotencyKey: string): Promise<Shipment> {
    const fulfilment = await this.prisma.orderFulfilment.findUnique({ where: { id: fulfilmentId } });
    if (!fulfilment) throw new NotFoundError('OrderFulfilment', fulfilmentId);

    const shipment = await this.resolveOrCreateShipmentIntent(fulfilment, idempotencyKey, staffId);

    if (shipment.status !== 'CREATED') {
      // Already booked (or beyond) by this call or a prior/concurrent one - idempotent no-op, no repeat carrier call.
      return shipment;
    }

    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: fulfilment.orderId } });
    const address = order.shippingAddress as { pincode?: string } | null;

    const booking = await this.provider.initiateShipment({
      shipmentId: shipment.id,
      orderNumber: order.orderNumber,
      fulfilmentId,
      destinationPincode: address?.pincode ?? '',
    });

    if (booking.status === 'UNAVAILABLE') {
      // Shipment row stays at CREATED - the durable intent is preserved, a later retry (same idempotencyKey) can attempt again.
      throw new ValidationError(booking.message ?? `Carrier '${this.provider.name}' is currently unavailable - please retry`);
    }

    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.shipment.updateMany({
        where: { id: shipment.id, status: 'CREATED' },
        data: {
          status: 'BOOKED',
          providerShipmentRef: booking.providerShipmentRef,
          trackingRef: booking.trackingRef,
          bookedAt: new Date(),
        },
      });

      if (claimed.count > 0) {
        await this.order.markFulfilmentShipped(
          fulfilmentId,
          staffId,
          { carrierName: this.provider.name, trackingRef: booking.trackingRef },
          tx,
        );
      }
      // claimed.count === 0: a concurrent request already won this exact
      // transition (both had already called the idempotent carrier booking
      // safely) - nothing further to do, just return the winner's result.

      return tx.shipment.findUniqueOrThrow({ where: { id: shipment.id } });
    });
  }

  private async resolveOrCreateShipmentIntent(
    fulfilment: { id: string; orderId: string; status: string },
    idempotencyKey: string,
    staffId: string,
  ): Promise<Shipment> {
    const byKey = await this.prisma.shipment.findUnique({ where: { idempotencyKey } });
    if (byKey) {
      if (byKey.fulfilmentId !== fulfilment.id) {
        throw new ConflictError(`Idempotency key '${idempotencyKey}' was already used for a different fulfilment`);
      }
      return byKey;
    }

    if (fulfilment.status !== 'READY_TO_SHIP') {
      throw new ValidationError(
        `Cannot create a shipment for a fulfilment in status '${fulfilment.status}' - it must be READY_TO_SHIP first`,
      );
    }

    const env = loadEnv();
    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await tx.shipment.create({
          data: {
            fulfilmentId: fulfilment.id,
            orderId: fulfilment.orderId,
            provider: this.provider.name,
            status: 'CREATED',
            maxDeliveryAttempts: env.SHIPPING_MAX_REDELIVERY_ATTEMPTS,
            idempotencyKey,
            createdByStaffId: staffId,
          },
        });
        await recordAudit(tx, {
          actorType: 'STAFF',
          actorStaffId: staffId,
          action: 'shipping.shipment.create',
          entityType: 'Shipment',
          entityId: created.id,
          newValue: { fulfilmentId: fulfilment.id, provider: this.provider.name },
          reference: fulfilment.orderId,
        });
        return created;
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        // Lost a genuine concurrent race - either the same idempotency key
        // replayed, or a different key against the same fulfilment (the
        // unique constraint on Shipment.fulfilmentId means a fulfilment can
        // never get two Shipment rows). Resolve to whichever row won rather
        // than crashing or creating a duplicate - same discipline
        // PaymentService.recordOrResumeEvent uses for its own unique-
        // constraint race.
        const existing = await this.prisma.shipment.findUnique({ where: { fulfilmentId: fulfilment.id } });
        if (existing) return existing;
      }
      throw err;
    }
  }

  /**
   * Verifies signature -> durably records (or resumes) the event ->
   * applies the resulting tracking transition -> marks the event
   * PROCESSED only once that transition has actually committed. This is
   * the exact RECEIVED/PROCESSED/FAILED durable-webhook-processing
   * pattern `PaymentService.handleRazorpayWebhook`/`recordOrResumeEvent`
   * established in M14 (and twice independently reviewed/repaired) -
   * reused here rather than reinvented: an invalid signature is
   * rejected with nothing persisted; a duplicate delivery of an
   * ALREADY-PROCESSED event is a safe no-op; a duplicate delivery of an
   * event that was recorded but never successfully applied (a transient
   * failure between the two) resumes processing against the SAME row,
   * never a second insert and never silently dropped.
   */
  async handleCarrierWebhook(rawBody: string, signatureHeader: string | undefined): Promise<ShippingWebhookResult> {
    if (!signatureHeader || !this.provider.verifyWebhookSignature(rawBody, signatureHeader)) {
      this.fastify.log.warn('Rejected shipping webhook: invalid or missing signature');
      return { ok: false, reason: 'invalid_signature' };
    }

    let event: CarrierTrackingEvent;
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
      event = this.provider.parseWebhookEvent(rawBody);
    } catch (err) {
      this.fastify.log.warn({ err }, 'Rejected shipping webhook: unparseable payload');
      return { ok: false, reason: 'unparseable_payload' };
    }

    const shipment = await this.prisma.shipment.findFirst({
      where: { provider: this.provider.name, providerShipmentRef: event.providerShipmentRef },
    });

    const eventRecord = await this.recordOrResumeEvent(event, shipment?.id, payload, 'WEBHOOK');
    if (eventRecord.status === 'PROCESSED') {
      return { ok: true, duplicate: true };
    }

    if (!shipment) {
      this.fastify.log.warn({ providerShipmentRef: event.providerShipmentRef }, 'Shipping webhook for unknown shipment reference');
      // No Shipment this event could ever apply to - no future state in
      // which reprocessing would do anything different. PROCESSED here is
      // a legitimate terminal outcome (same discipline as PaymentService's
      // equivalent branch), not a failure.
      await this.markEventProcessed(eventRecord.id);
      return { ok: true };
    }

    try {
      await this.applyTrackingUpdate(shipment.id, event.normalizedStatus, event.occurredAt);
      await this.markEventProcessed(eventRecord.id);
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.fastify.log.error(
        { err, providerShipmentRef: event.providerShipmentRef, shipmentId: shipment.id },
        'Shipment tracking event processing failed - will resume on redelivery',
      );
      await this.prisma.shipmentTrackingEvent
        .update({ where: { id: eventRecord.id }, data: { status: 'FAILED', processingError: message } })
        .catch((updateErr) =>
          this.fastify.log.error({ updateErr, providerShipmentRef: event.providerShipmentRef }, 'Failed to durably record shipment-event processing failure'),
        );
      return { ok: false, reason: 'processing_failed' };
    }
  }

  /** Same insert-or-fetch-on-conflict shape as PaymentService.recordOrResumeEvent - see its docblock for the full rationale. */
  private async recordOrResumeEvent(
    event: CarrierTrackingEvent,
    shipmentId: string | undefined,
    payload: unknown,
    source: ShipmentEventSource,
  ): Promise<{ id: string; status: 'RECEIVED' | 'PROCESSED' | 'FAILED' }> {
    try {
      return await this.prisma.shipmentTrackingEvent.create({
        data: {
          shipmentId,
          provider: this.provider.name,
          providerEventId: event.providerEventId,
          source,
          rawStatus: event.rawStatus,
          normalizedStatus: event.normalizedStatus,
          payload: payload as Prisma.InputJsonValue,
          occurredAt: event.occurredAt,
          status: 'RECEIVED',
        },
        select: { id: true, status: true },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return await this.prisma.shipmentTrackingEvent.findFirstOrThrow({
          where: { provider: this.provider.name, providerEventId: event.providerEventId },
          select: { id: true, status: true },
        });
      }
      throw err;
    }
  }

  private async markEventProcessed(eventId: string): Promise<void> {
    await this.prisma.shipmentTrackingEvent.update({
      where: { id: eventId },
      data: { status: 'PROCESSED', processedAt: new Date(), processingError: null },
    });
  }

  /**
   * Applies one platform-normalized tracking status to a Shipment,
   * enforcing `ALLOWED_TRANSITIONS` (rejects illegal backward/
   * contradictory transitions), incrementing `deliveryAttempts` on
   * DELIVERY_FAILED, and auto-computing RTO once the configured attempt
   * budget (`maxDeliveryAttempts`, snapshotted at shipment creation) is
   * exhausted. Reuses `OrderService.markFulfilmentDelivered`/`markRTO`
   * (with `staffId: null` for SYSTEM attribution) IN THE SAME
   * transaction as the Shipment row update (via their own `externalTx`
   * parameter) - never a second, competing posting path for the
   * DELIVERED/RTO business transition, and never split across two
   * transactions (which would let a crash between them leave the
   * Shipment and the Order/Fulfilment permanently disagreeing about
   * whether delivery/RTO happened - the exact durability gap this
   * method's docblock in `handleCarrierWebhook` depends on NOT
   * existing, since the idempotent-same-status-is-a-no-op check below
   * would otherwise mask an incomplete retry).
   *
   * Split-shipment / multi-fulfilment RTO (documented limitation, not
   * guessed): `OrderService.markRTO`'s existing M15/M16 guard only
   * allows the Order-level RTO transition once EVERY active line across
   * the WHOLE order is still sitting at SHIPPED (none delivered yet) -
   * the same "exactly one authoritative RTO-posting point" discipline
   * SALE already has. For a single-shipment order (this milestone's own
   * acceptance/E2E coverage, FLOW 15) that is always satisfiable the
   * moment this shipment's own attempts exhaust. For a genuine multi-
   * shipment order where a SIBLING fulfilment has already delivered,
   * that guard correctly refuses the order-level RTO (this order was
   * never entirely returned) - `markRTO` throws, and this method leaves
   * the Shipment itself at RTO_INITIATED (an honest, correct per-
   * shipment fact) while recording an explicit audit note that
   * Order-level reconciliation needs a human decision, rather than
   * silently forcing the whole order to RTO or crashing the webhook.
   * Resolving what "order-level RTO" should mean for a genuinely mixed-
   * state multi-shipment order is a real open business question
   * (`blueprint/DECISION_REGISTER.md`, deferred - not invented here).
   */
  private async applyTrackingUpdate(shipmentId: string, normalizedStatus: NormalizedTrackingStatus, occurredAt: Date): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const shipment = await this.lockShipment(tx, shipmentId);
      if (!shipment) throw new NotFoundError('Shipment', shipmentId);

      if (shipment.status === normalizedStatus) {
        return; // idempotent no-op - duplicate/replayed carrier report
      }

      const allowed = ALLOWED_TRANSITIONS[shipment.status] ?? [];
      if (!allowed.includes(normalizedStatus)) {
        throw new ValidationError(
          `Illegal shipment tracking transition '${shipment.status}' -> '${normalizedStatus}' (shipment '${shipmentId}')`,
        );
      }

      const data: Prisma.ShipmentUpdateInput = {};
      let deliveryAttempts = shipment.deliveryAttempts;
      // The status actually written can differ from the carrier-reported
      // one: a DELIVERY_FAILED report that exhausts the configured attempt
      // budget (SHIP-004, snapshotted on this shipment at creation time -
      // never re-read from live config) auto-escalates straight to
      // RTO_INITIATED in the same write, never left sitting at
      // DELIVERY_FAILED waiting for a separate trigger.
      let finalStatus: ShipmentTrackingStatus = normalizedStatus;

      if (normalizedStatus === 'DELIVERY_FAILED') {
        deliveryAttempts = shipment.deliveryAttempts + 1;
        data.deliveryAttempts = deliveryAttempts;
        if (deliveryAttempts >= shipment.maxDeliveryAttempts) {
          finalStatus = 'RTO_INITIATED';
        }
      }
      if (normalizedStatus === 'DELIVERED') data.deliveredAt = occurredAt;
      if (finalStatus === 'RTO_INITIATED') data.rtoInitiatedAt = occurredAt;
      if (normalizedStatus === 'RTO_DELIVERED') data.rtoDeliveredAt = occurredAt;
      data.status = finalStatus;

      await tx.shipment.update({ where: { id: shipmentId }, data });

      if (normalizedStatus === 'DELIVERED') {
        await this.order.markFulfilmentDelivered(shipment.fulfilmentId, null, tx);
      }

      if (normalizedStatus === 'RTO_DELIVERED') {
        // Physical parcel reconciliation once genuinely back at the
        // warehouse is a GRN-style receiving event - specs/18-returns.md's
        // own scope (M19), not posted here (same documented boundary
        // OrderService.markRTO's own docblock already states).
      }

      if (finalStatus === 'RTO_INITIATED') {
        try {
          await this.order.markRTO(
            shipment.orderId,
            null,
            `Shipment '${shipmentId}' reached RTO (redelivery attempts ${deliveryAttempts}/${shipment.maxDeliveryAttempts})`,
            tx,
          );
        } catch (err) {
          if (err instanceof ValidationError) {
            // Documented multi-shipment limitation (see this method's
            // docblock) - the Shipment's own RTO_INITIATED fact still
            // stands and commits; only the Order-level rollup needs a
            // human to reconcile.
            await recordAudit(tx, {
              actorType: 'SYSTEM',
              action: 'shipping.rto.order_reconciliation_required',
              entityType: 'Shipment',
              entityId: shipmentId,
              newValue: { reason: err.message },
              reference: shipment.orderId,
            });
          } else {
            throw err;
          }
        }
      }
    });
  }

  /**
   * Polling fallback (SHIP-003) - callable directly or by a future
   * scheduler, same "callable directly or by a future scheduler" shape
   * as `InventoryService.expireStaleReservations`/
   * `PaymentService.expireStalePayments` (no cron scheduler exists in
   * this codebase yet). Only polls shipments genuinely in flight
   * (BOOKED/IN_TRANSIT/OUT_FOR_DELIVERY/DELIVERY_FAILED) - terminal
   * shipments (DELIVERED/RTO_DELIVERED) are never re-polled.
   * `ShippingProvider.trackShipment` returning null (the mock's honest
   * "nothing new") is a no-op, never an error - the negative scenario
   * "carrier tracking temporarily unavailable -> storefront shows
   * last-known platform status, not an error" (acceptance/m17
   * negative scenario #1) falls directly out of that: nothing changes,
   * the last committed status is exactly what the storefront already
   * shows.
   */
  async pollPendingShipments(): Promise<{ polled: number; updated: number }> {
    const pending = await this.prisma.shipment.findMany({
      where: { provider: this.provider.name, status: { in: ['BOOKED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERY_FAILED'] } },
    });

    let updated = 0;
    for (const shipment of pending) {
      if (!shipment.providerShipmentRef) continue;
      const snapshot = await this.provider.trackShipment(shipment.providerShipmentRef);
      if (!snapshot) continue; // graceful degradation - leave last-known status untouched

      const eventRecord = await this.recordOrResumeEvent(
        snapshot,
        shipment.id,
        { source: 'poll', shipmentId: shipment.id, snapshot: { ...snapshot, occurredAt: snapshot.occurredAt.toISOString() } },
        'POLL',
      );
      if (eventRecord.status === 'PROCESSED') continue;

      try {
        await this.applyTrackingUpdate(shipment.id, snapshot.normalizedStatus, snapshot.occurredAt);
        await this.markEventProcessed(eventRecord.id);
        updated += 1;
      } catch (err) {
        // A poll snapshot describing an illegal/stale transition (e.g. the
        // carrier's polling API momentarily out of sync with its own
        // webhook) is logged and skipped, never crashes the sweep for
        // every other pending shipment.
        this.fastify.log.warn({ err, shipmentId: shipment.id }, 'Shipment poll snapshot could not be applied - skipping');
      }
    }

    return { polled: pending.length, updated };
  }

  /** Staff-facing read: one shipment, including its tracking history (customer/audit visibility). */
  async getShipment(shipmentId: string) {
    const shipment = await this.prisma.shipment.findUnique({
      where: { id: shipmentId },
      include: { events: { orderBy: { occurredAt: 'asc' } } },
    });
    if (!shipment) throw new NotFoundError('Shipment', shipmentId);
    return shipment;
  }

  async listShipmentsForOrder(orderId: string) {
    return this.prisma.shipment.findMany({ where: { orderId }, orderBy: { createdAt: 'asc' } });
  }
}
