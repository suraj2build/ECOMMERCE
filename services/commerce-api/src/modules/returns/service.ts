import type { FastifyInstance } from 'fastify';
import { Prisma, type PrismaClient, type Return, type ReturnLine, type ReturnStatus, type ReturnDisposition, type QcResult } from '@fcp/db';
import { loadEnv } from '@fcp/config';
import { NotFoundError, ValidationError, ConflictError } from '@fcp/shared';
import { recordAudit } from '../audit/service.js';
import { OrderService } from '../order/service.js';
import { InventoryService } from '../inventory/service.js';
import { resolveShippingProvider, type ShippingProvider } from '../shipping/provider.js';
import type { CartOwnerIdentity } from '../cart/identity.js';

export interface InitiateReturnLineInput {
  orderLineId: string;
  reason: string;
}

/**
 * Returns (M19, specs/18-returns.md, RET-001-004, `RET-005` in
 * blueprint/DECISION_REGISTER.md). Owns the post-delivery return
 * lifecycle FROM a DELIVERED OrderLine onward: eligibility (RET-001),
 * initiation (self-service and CS-assisted, RET-003), reverse logistics
 * (RET-004), warehouse receipt, QC + disposition (RET-002, INV-006), and
 * the durable M19->M20 refund-eligibility handoff - never financial
 * refund/store-credit logic itself (M20's own scope).
 *
 * Deliberately does NOT touch OrderLine.status or any M15/M16/M17/M18
 * lock (fulfilment/pick-task) - a delivered line's status stays DELIVERED
 * forever as history; the Return/ReturnLine state machine below is a
 * fully separate, self-contained lock domain (its own row locks only),
 * so there is no lock-ordering conflict with any earlier-certified
 * transition to worry about, unlike M18 cancellation's fulfilment-lock
 * dance against still-in-flight pick/pack/ship work.
 */
export class ReturnService {
  private readonly order: OrderService;
  private readonly inventory: InventoryService;
  private readonly provider: ShippingProvider;

  constructor(
    private readonly fastify: FastifyInstance,
    provider?: ShippingProvider,
  ) {
    this.order = new OrderService(fastify);
    this.inventory = new InventoryService(fastify);
    this.provider = provider ?? resolveShippingProvider(loadEnv().SHIPPING_PROVIDER);
  }

  private get prisma(): PrismaClient {
    return this.fastify.prisma;
  }

  private async nextReturnNumber(tx: Prisma.TransactionClient): Promise<string> {
    const year = new Date().getFullYear();
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`return_seq:${year}`}))`;
    const count = await tx.return.count({ where: { returnNumber: { startsWith: `RET-${year}-` } } });
    return `RET-${year}-${String(count + 1).padStart(6, '0')}`;
  }

  /**
   * RET-001 resolution order (most to least specific, mirroring
   * Style.hsnCode's own style-then-fallback pattern): a styleId-scoped
   * ReturnPolicy row, else a categoryId-scoped row, else the platform
   * default (RETURN_WINDOW_DEFAULT_DAYS, always returnable=true when no
   * row exists - "MUST be configurable... not one global hard-coded
   * policy" is satisfied by the override rows below, not by inventing a
   * restrictive default).
   */
  private async resolveReturnPolicy(skuId: string): Promise<{ windowDays: number; returnable: boolean }> {
    const sku = await this.prisma.sku.findUnique({
      where: { id: skuId },
      select: { styleId: true, style: { select: { categoryId: true } } },
    });
    if (!sku) throw new NotFoundError('Sku', skuId);

    const styleRow = await this.prisma.returnPolicy.findUnique({ where: { styleId: sku.styleId } });
    if (styleRow) return { windowDays: styleRow.windowDays, returnable: styleRow.returnable };

    const categoryRow = await this.prisma.returnPolicy.findUnique({ where: { categoryId: sku.style.categoryId } });
    if (categoryRow) return { windowDays: categoryRow.windowDays, returnable: categoryRow.returnable };

    return { windowDays: loadEnv().RETURN_WINDOW_DEFAULT_DAYS, returnable: true };
  }

  /** Row-locks and returns one Return by id. MUST run inside a transaction - same idiom as OrderService.lockFulfilment/InventoryService.lockReservation. */
  private async lockReturn(
    tx: Prisma.TransactionClient,
    returnId: string,
  ): Promise<{ id: string; orderId: string; status: ReturnStatus; method: string; idempotencyKey: string } | null> {
    const rows = await tx.$queryRaw<
      { id: string; orderId: string; status: ReturnStatus; method: string; idempotencyKey: string }[]
    >`SELECT "id", "orderId", "status", "method", "idempotencyKey" FROM "returns" WHERE "id" = ${returnId} FOR UPDATE`;
    return rows[0] ?? null;
  }

  /** Row-locks and returns one ReturnLine by id. MUST run inside a transaction. */
  private async lockReturnLine(
    tx: Prisma.TransactionClient,
    lineId: string,
  ): Promise<{
    id: string;
    returnId: string;
    orderLineId: string;
    skuId: string;
    locationId: string;
    quantity: number;
    disposition: ReturnDisposition | null;
    qcResult: QcResult | null;
  } | null> {
    const rows = await tx.$queryRaw<
      {
        id: string;
        returnId: string;
        orderLineId: string;
        skuId: string;
        locationId: string;
        quantity: number;
        disposition: ReturnDisposition | null;
        qcResult: QcResult | null;
      }[]
    >`SELECT "id", "returnId", "orderLineId", "skuId", "locationId", "quantity", "disposition", "qcResult"
      FROM "return_lines" WHERE "id" = ${lineId} FOR UPDATE`;
    return rows[0] ?? null;
  }

  // --- Initiation ---

  /** CS-assisted initiation (RET-003), gated by return:initiate. */
  async initiateReturnForStaff(
    orderId: string,
    lines: InitiateReturnLineInput[],
    method: 'PICKUP' | 'DROP_OFF',
    staffId: string,
    idempotencyKey: string,
  ): Promise<Return & { lines: ReturnLine[] }> {
    return this.performInitiate(orderId, lines, method, staffId, idempotencyKey);
  }

  /**
   * Customer self-service initiation (RET-003). Ownership-checked via
   * `OrderService.loadOwnedOrder` - the SAME IDOR-safe "clean 404, never
   * a distinguishable 403" mechanism every other storefront order route
   * already uses (CART-004 remains open regardless).
   */
  async initiateReturnForCustomer(
    orderId: string,
    lines: InitiateReturnLineInput[],
    method: 'PICKUP' | 'DROP_OFF',
    identity: CartOwnerIdentity,
    idempotencyKey: string,
  ): Promise<Return & { lines: ReturnLine[] }> {
    await this.order.loadOwnedOrder(orderId, identity);
    return this.performInitiate(orderId, lines, method, null, idempotencyKey);
  }

  private async performInitiate(
    orderId: string,
    lines: InitiateReturnLineInput[],
    method: 'PICKUP' | 'DROP_OFF',
    staffId: string | null,
    idempotencyKey: string,
  ): Promise<Return & { lines: ReturnLine[] }> {
    if (!idempotencyKey?.trim()) throw new ValidationError('An idempotency key is required');
    if (lines.length === 0) throw new ValidationError('At least one order line is required to initiate a return');
    for (const line of lines) {
      if (!line.reason?.trim()) throw new ValidationError('A return reason is required for every returned line (RET-002)');
    }
    const orderLineIds = new Set(lines.map((l) => l.orderLineId));
    if (orderLineIds.size !== lines.length) throw new ValidationError('Duplicate order lines in the same return request');

    // Cheap, non-locking pre-check (same discipline as M18 cancellation):
    // a key already bound to a DIFFERENT return is a genuine misuse, not
    // a legitimate retry - the DB unique constraint below is still the
    // authoritative race guard.
    const priorByKey = await this.prisma.return.findUnique({ where: { idempotencyKey }, include: { lines: true } });
    if (priorByKey) {
      if (priorByKey.orderId !== orderId) {
        throw new ConflictError(`Idempotency key '${idempotencyKey}' was already used for a different order`);
      }
      return priorByKey;
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const preparedLines: { orderLineId: string; skuId: string; locationId: string; quantity: number; reason: string }[] = [];

        for (const input of lines) {
          const line = await tx.orderLine.findUnique({
            where: { id: input.orderLineId },
            include: { fulfilment: true, returnLine: true },
          });
          if (!line || line.orderId !== orderId) throw new NotFoundError('OrderLine', input.orderLineId);
          if (line.returnLine) {
            throw new ConflictError(`Order line '${input.orderLineId}' already has an existing return`);
          }
          if (line.status !== 'DELIVERED') {
            throw new ValidationError(
              `Order line '${input.orderLineId}' is not eligible for return (status '${line.status}') - only a delivered line can be returned`,
            );
          }
          const deliveredAt = line.fulfilment?.deliveredAt;
          if (!deliveredAt) {
            throw new ValidationError(`Order line '${input.orderLineId}' has no recorded delivery date - cannot compute return eligibility`);
          }

          const policy = await this.resolveReturnPolicy(line.skuId);
          if (!policy.returnable) {
            throw new ValidationError(`Order line '${input.orderLineId}' belongs to a non-returnable category/product`);
          }
          // Day-granularity, not millisecond-precise: a delivery from
          // "exactly windowDays ago plus a few seconds of request
          // latency" must still count as within the window (a 7-day
          // window is understood as 7 full days, not 7*86400000ms to the
          // millisecond) - Math.floor keeps day N inclusive all the way
          // through, only day N+1 onward is rejected.
          const daysSinceDelivery = Math.floor((Date.now() - deliveredAt.getTime()) / 86_400_000);
          if (daysSinceDelivery > policy.windowDays) {
            throw new ValidationError(
              `The return window (${policy.windowDays} day(s) from delivery) has expired for order line '${input.orderLineId}'`,
            );
          }

          preparedLines.push({ orderLineId: line.id, skuId: line.skuId, locationId: line.locationId, quantity: line.quantity, reason: input.reason.trim() });
        }

        const returnNumber = await this.nextReturnNumber(tx);
        const created = await tx.return.create({
          data: {
            returnNumber,
            orderId,
            method,
            initiatedBy: staffId ? 'STAFF' : 'CUSTOMER',
            initiatedByStaffId: staffId ?? undefined,
            idempotencyKey,
            lines: {
              create: preparedLines.map((l) => ({
                orderLineId: l.orderLineId,
                skuId: l.skuId,
                locationId: l.locationId,
                quantity: l.quantity,
                reason: l.reason,
              })),
            },
          },
          include: { lines: true },
        });

        await recordAudit(tx, {
          actorType: staffId ? 'STAFF' : 'CUSTOMER',
          actorStaffId: staffId ?? undefined,
          action: 'return.initiate',
          entityType: 'Return',
          entityId: created.id,
          newValue: { orderId, method, lineCount: preparedLines.length },
          reference: orderId,
        });

        return created;
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const winner = await this.prisma.return.findUnique({ where: { idempotencyKey }, include: { lines: true } });
        if (winner && winner.orderId === orderId) return winner;
        throw new ConflictError('This order line already has an existing return, or this idempotency key was already used');
      }
      throw err;
    }
  }

  // --- Cancellation (before receipt) ---

  async cancelReturn(returnId: string, staffId: string | null, identity: CartOwnerIdentity | null, reason: string | undefined) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await this.lockReturn(tx, returnId);
      if (!existing) throw new NotFoundError('Return', returnId);

      if (identity) {
        const order = await tx.order.findUniqueOrThrow({ where: { id: existing.orderId } });
        const owns =
          (identity.customerId && order.customerId === identity.customerId) ||
          (identity.guestSessionId && order.guestSessionId === identity.guestSessionId);
        if (!owns) throw new NotFoundError('Return', returnId);
      }

      if (existing.status === 'CANCELLED') return tx.return.findUniqueOrThrow({ where: { id: returnId }, include: { lines: true } });
      if (existing.status !== 'REQUESTED' && existing.status !== 'PICKUP_SCHEDULED') {
        throw new ValidationError(
          `Cannot cancel a return in status '${existing.status}' - once the parcel has been received, use the warehouse QC/disposition flow instead`,
        );
      }

      await tx.return.update({ where: { id: returnId }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledReason: reason?.trim() || null } });
      await recordAudit(tx, {
        actorType: staffId ? 'STAFF' : 'CUSTOMER',
        actorStaffId: staffId ?? undefined,
        action: 'return.cancel',
        entityType: 'Return',
        entityId: returnId,
        newValue: { reason: reason?.trim() || null },
        reference: existing.orderId,
      });

      return tx.return.findUniqueOrThrow({ where: { id: returnId }, include: { lines: true } });
    });
  }

  // --- Reverse logistics (RET-004) ---

  /**
   * Books a reverse pickup for a PICKUP-method return via the same
   * two-phase durable-intent pattern `ShippingService.createShipment`
   * established: the ReturnPickup row commits in SCHEDULED status BEFORE
   * the carrier is ever called, and the mock adapter is idempotent-by-
   * pickupId, so a crash-and-retry between a successful carrier call and
   * the local commit never double-books (M19 build instruction §13).
   */
  async schedulePickup(returnId: string, staffId: string, idempotencyKey: string) {
    if (!idempotencyKey?.trim()) throw new ValidationError('An idempotency key is required');

    const intent = await this.resolveOrCreatePickupIntent(returnId, staffId, idempotencyKey);
    if (intent.status !== 'SCHEDULED') return intent; // idempotent no-op - already booked

    const ret = await this.prisma.return.findUniqueOrThrow({ where: { id: returnId }, include: { order: true } });
    if (ret.method !== 'PICKUP') throw new ValidationError('This return uses customer drop-off, not carrier pickup');
    const address = ret.order.shippingAddress as { pincode?: string } | null;

    const booking = await this.provider.initiateReversePickup({
      pickupId: intent.id,
      returnNumber: ret.returnNumber,
      originPincode: address?.pincode ?? '',
    });

    if (booking.status === 'UNAVAILABLE') {
      throw new ValidationError(booking.message ?? `Carrier '${this.provider.name}' is currently unavailable for reverse pickup - please retry`);
    }

    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.returnPickup.updateMany({
        where: { id: intent.id, status: 'SCHEDULED' },
        data: { providerPickupRef: booking.providerPickupRef, trackingRef: booking.trackingRef },
      });
      if (claimed.count > 0) {
        const lockedReturn = await this.lockReturn(tx, returnId);
        if (lockedReturn && lockedReturn.status === 'REQUESTED') {
          await tx.return.update({ where: { id: returnId }, data: { status: 'PICKUP_SCHEDULED' } });
        }
        await recordAudit(tx, {
          actorType: 'STAFF',
          actorStaffId: staffId,
          action: 'return.pickup.schedule',
          entityType: 'ReturnPickup',
          entityId: intent.id,
          newValue: { provider: this.provider.name },
          reference: returnId,
        });
      }
      return tx.returnPickup.findUniqueOrThrow({ where: { id: intent.id } });
    });
  }

  private async resolveOrCreatePickupIntent(returnId: string, staffId: string, idempotencyKey: string) {
    const byKey = await this.prisma.returnPickup.findUnique({ where: { idempotencyKey } });
    if (byKey) {
      if (byKey.returnId !== returnId) throw new ConflictError(`Idempotency key '${idempotencyKey}' was already used for a different return`);
      return byKey;
    }
    const existingForReturn = await this.prisma.returnPickup.findUnique({ where: { returnId } });
    if (existingForReturn) return existingForReturn;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const locked = await this.lockReturn(tx, returnId);
        if (!locked) throw new NotFoundError('Return', returnId);
        if (locked.method !== 'PICKUP') throw new ValidationError('This return uses customer drop-off, not carrier pickup');
        if (locked.status !== 'REQUESTED') {
          throw new ValidationError(`Cannot schedule a pickup for a return in status '${locked.status}'`);
        }
        return tx.returnPickup.create({
          data: { returnId, provider: this.provider.name, idempotencyKey, createdByStaffId: staffId },
        });
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const winner = await this.prisma.returnPickup.findUnique({ where: { idempotencyKey } });
        if (winner && winner.returnId === returnId) return winner;
        const existingForReturn = await this.prisma.returnPickup.findUnique({ where: { returnId } });
        if (existingForReturn) return existingForReturn;
        throw new ConflictError('A pickup for this return was already scheduled by a concurrent request');
      }
      throw err;
    }
  }

  async markPickedUp(returnId: string, staffId: string) {
    return this.prisma.$transaction(async (tx) => {
      const locked = await this.lockReturn(tx, returnId);
      if (!locked) throw new NotFoundError('Return', returnId);
      if (locked.status === 'PICKED_UP' || locked.status === 'RECEIVED' || locked.status === 'DISPOSITIONED') {
        return tx.return.findUniqueOrThrow({ where: { id: returnId }, include: { lines: true } }); // idempotent no-op
      }
      if (locked.status !== 'PICKUP_SCHEDULED') {
        throw new ValidationError(`Cannot mark picked-up a return in status '${locked.status}'`);
      }
      await tx.return.update({ where: { id: returnId }, data: { status: 'PICKED_UP' } });
      await tx.returnPickup.update({ where: { returnId }, data: { status: 'PICKED_UP', pickedUpAt: new Date() } });
      await recordAudit(tx, {
        actorType: 'STAFF',
        actorStaffId: staffId,
        action: 'return.pickup.complete',
        entityType: 'Return',
        entityId: returnId,
        reference: locked.orderId,
      });
      return tx.return.findUniqueOrThrow({ where: { id: returnId }, include: { lines: true } });
    });
  }

  // --- Warehouse receipt ---

  /**
   * Marks the whole Return (all its lines - one parcel) received at the
   * warehouse and posts a RETURN_RECEIVED ledger row per line
   * (InventoryService.postReturnReceipt - returnPending += quantity,
   * never onHand: INV-006 "MUST NOT automatically become sellable ON_HAND
   * inventory"). Idempotent per-line via a deterministic idempotency key
   * derived from the ReturnLine id, so a retried/duplicate markReceived
   * call can never double-post even if the outer Return-status guard is
   * raced (defense in depth, same philosophy as recordSale's own
   * belt-and-braces integrity checks).
   */
  async markReceived(returnId: string, staffId: string) {
    return this.prisma.$transaction(async (tx) => {
      const locked = await this.lockReturn(tx, returnId);
      if (!locked) throw new NotFoundError('Return', returnId);
      if (locked.status === 'RECEIVED' || locked.status === 'DISPOSITIONED') {
        return tx.return.findUniqueOrThrow({ where: { id: returnId }, include: { lines: true } }); // idempotent no-op
      }
      const eligibleFromStatus = locked.method === 'DROP_OFF' ? 'REQUESTED' : 'PICKED_UP';
      if (locked.status !== eligibleFromStatus) {
        throw new ValidationError(
          `Cannot mark received a ${locked.method} return in status '${locked.status}' - expected '${eligibleFromStatus}'`,
        );
      }

      const lines = await tx.returnLine.findMany({ where: { returnId } });
      for (const line of lines) {
        await this.inventory.postReturnReceipt(
          {
            skuId: line.skuId,
            locationId: line.locationId,
            quantity: line.quantity,
            referenceType: 'RETURN_LINE',
            referenceId: line.id,
            idempotencyKey: `return-receipt:${line.id}`,
          },
          tx,
        );
        await tx.returnLine.update({ where: { id: line.id }, data: { receivedAt: new Date() } });
      }

      await tx.return.update({ where: { id: returnId }, data: { status: 'RECEIVED' } });
      await recordAudit(tx, {
        actorType: 'STAFF',
        actorStaffId: staffId,
        action: 'return.receive',
        entityType: 'Return',
        entityId: returnId,
        newValue: { lineCount: lines.length },
        reference: locked.orderId,
      });

      return tx.return.findUniqueOrThrow({ where: { id: returnId }, include: { lines: true } });
    });
  }

  // --- QC + disposition ---

  /**
   * The QC gate (RET-002, INV-006). `qcResult` PASS always pairs with
   * disposition RESTOCK_SELLABLE (genuinely resellable at normal price -
   * the only disposition that returns stock to a fresh sale). `qcResult`
   * FAIL pairs with RESTOCK_DAMAGED/WRITE_OFF/RETURN_TO_SUPPLIER, chosen
   * by the inspecting staff member based on physical condition.
   *
   * DECISION_REQUIRED (see `RET-005` in blueprint/DECISION_REGISTER.md):
   * the approved spec defines the inventory-disposition rule for a
   * failed-QC return (INV-006) but does NOT define its financial
   * consequence - "refund eligibility... per configured policy for a
   * failed-QC return" presupposes a policy that was never actually
   * decided. The safe engineering default here is the ONLY one that
   * neither silently refunds nor silently denies money the customer
   * might be owed (M19 build instruction §16): `refundEligible` is set
   * true ONLY for a PASS outcome; a FAIL outcome still resolves the
   * physical stock (a real business requirement, INV-006) but leaves
   * `refundEligible` false, requiring an explicit human (Finance/CS)
   * decision before any money moves - M20's RefundService never
   * auto-processes a line this method left ineligible.
   */
  async recordQcAndDisposition(
    returnId: string,
    lineId: string,
    staffId: string,
    input: { qcResult: 'PASS' | 'FAIL'; disposition: 'RESTOCK_SELLABLE' | 'RESTOCK_DAMAGED' | 'WRITE_OFF' | 'RETURN_TO_SUPPLIER'; notes?: string },
  ) {
    if (input.qcResult === 'PASS' && input.disposition !== 'RESTOCK_SELLABLE') {
      throw new ValidationError('A PASS QC result must use the RESTOCK_SELLABLE disposition');
    }
    if (input.qcResult === 'FAIL' && input.disposition === 'RESTOCK_SELLABLE') {
      throw new ValidationError('A FAIL QC result cannot use the RESTOCK_SELLABLE disposition');
    }

    return this.prisma.$transaction(async (tx) => {
      // Lock the parent Return first (same fulfilment-first-style
      // discipline established since M16: the coarser-grained lock
      // acquired first, matching this Return's own lockReturn-before-
      // touching-return_lines order in markReceived above, so a
      // concurrent QC call on a DIFFERENT line of the same Return never
      // deadlocks against markReceived/cancelReturn).
      const lockedReturn = await this.lockReturn(tx, returnId);
      if (!lockedReturn) throw new NotFoundError('Return', returnId);
      if (lockedReturn.status !== 'RECEIVED' && lockedReturn.status !== 'DISPOSITIONED') {
        throw new ValidationError(`Cannot record QC for a return in status '${lockedReturn.status}' - it must be RECEIVED first`);
      }

      const line = await this.lockReturnLine(tx, lineId);
      if (!line || line.returnId !== returnId) throw new NotFoundError('ReturnLine', lineId);
      if (line.disposition) {
        // Idempotent no-op - a retried QC submission for an already-resolved line never double-posts.
        return tx.returnLine.findUniqueOrThrow({ where: { id: lineId } });
      }

      await this.inventory.postReturnDisposition(
        {
          skuId: line.skuId,
          locationId: line.locationId,
          quantity: line.quantity,
          disposition: input.disposition,
          referenceType: 'RETURN_LINE',
          referenceId: line.id,
          reason: input.notes?.trim() || input.disposition,
          idempotencyKey: `return-disposition:${line.id}`,
        },
        tx,
      );

      const now = new Date();
      const refundEligible = input.qcResult === 'PASS';
      await tx.returnLine.update({
        where: { id: lineId },
        data: {
          qcResult: input.qcResult,
          disposition: input.disposition,
          qcNotes: input.notes?.trim() || null,
          qcActorStaffId: staffId,
          qcAt: now,
          dispositionedAt: now,
          refundEligible,
          refundEligibleAt: refundEligible ? now : null,
        },
      });

      await recordAudit(tx, {
        actorType: 'STAFF',
        actorStaffId: staffId,
        action: 'return.qc.record',
        entityType: 'ReturnLine',
        entityId: lineId,
        newValue: { qcResult: input.qcResult, disposition: input.disposition, refundEligible },
        reference: returnId,
      });

      const remaining = await tx.returnLine.count({ where: { returnId, disposition: null } });
      if (remaining === 0) {
        await tx.return.update({ where: { id: returnId }, data: { status: 'DISPOSITIONED' } });
      }

      return tx.returnLine.findUniqueOrThrow({ where: { id: lineId } });
    });
  }

  // --- Reads ---

  async getReturn(id: string) {
    const ret = await this.prisma.return.findUnique({ where: { id }, include: { lines: true, pickup: true } });
    if (!ret) throw new NotFoundError('Return', id);
    return ret;
  }

  async getReturnForCustomer(id: string, identity: CartOwnerIdentity) {
    const ret = await this.getReturn(id);
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: ret.orderId } });
    const owns =
      (identity.customerId && order.customerId === identity.customerId) ||
      (identity.guestSessionId && order.guestSessionId === identity.guestSessionId);
    if (!owns) throw new NotFoundError('Return', id);
    return ret;
  }

  async listReturnsForOrder(orderId: string) {
    return this.prisma.return.findMany({ where: { orderId }, include: { lines: true, pickup: true }, orderBy: { createdAt: 'desc' } });
  }

  async listReturnsForCustomer(identity: CartOwnerIdentity) {
    const where = identity.customerId ? { customerId: identity.customerId } : { guestSessionId: identity.guestSessionId };
    const orders = await this.prisma.order.findMany({ where, select: { id: true } });
    const orderIds = orders.map((o) => o.id);
    if (orderIds.length === 0) return [];
    return this.prisma.return.findMany({ where: { orderId: { in: orderIds } }, include: { lines: true, pickup: true }, orderBy: { createdAt: 'desc' } });
  }

  async listPendingWarehouseWork(status?: ReturnStatus) {
    return this.prisma.return.findMany({
      where: status ? { status } : { status: { in: ['REQUESTED', 'PICKUP_SCHEDULED', 'PICKED_UP', 'RECEIVED'] } },
      include: { lines: true, pickup: true },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
  }
}
