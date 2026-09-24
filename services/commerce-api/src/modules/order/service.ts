import type { FastifyInstance } from 'fastify';
import { Prisma, type PrismaClient, type OrderStatus, type OrderLineStatus, type FulfilmentStatus } from '@fcp/db';
import { NotFoundError, ValidationError, ConflictError } from '@fcp/shared';
import { InventoryService } from '../inventory/service.js';
import { InvoiceService } from '../tax/invoice-service.js';
import { WarehouseService } from '../warehouse/service.js';
import { recordAudit } from '../audit/service.js';
import type { CartOwnerIdentity } from '../cart/identity.js';

/**
 * Order Management (M15, specs/14-order-management.md, ORD-001-006).
 *
 * Scope boundary (see the schema comment above the Order/OrderLine/
 * OrderFulfilment models for the full rationale): this service owns the
 * Order entity, its state machine, order-to-inventory allocation,
 * partial cancellation, and the split-shipment data model. Real carrier
 * integration, a warehouse pick-list UI, actual refund execution, and
 * return/QC processing are explicitly later milestones (specs/15-18,
 * specs/19-refunds.md) - where this milestone's own acceptance flows
 * need one of those to be fully automatic (e.g. RTO), it provides the
 * correct state transition and business-rule branching via an explicit
 * staff-triggered action instead of a simulated external event.
 */
export class OrderService {
  private readonly inventory: InventoryService;
  private readonly invoice: InvoiceService;
  private readonly warehouse: WarehouseService;

  constructor(private readonly fastify: FastifyInstance) {
    this.inventory = new InventoryService(fastify);
    this.invoice = new InvoiceService(fastify);
    this.warehouse = new WarehouseService(fastify);
  }

  private get prisma(): PrismaClient {
    return this.fastify.prisma;
  }

  private async nextOrderNumber(tx: Prisma.TransactionClient): Promise<string> {
    const year = new Date().getFullYear();
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`order_seq:${year}`}))`;
    const count = await tx.order.count({ where: { orderNumber: { startsWith: `ORD-${year}-` } } });
    return `ORD-${year}-${String(count + 1).padStart(6, '0')}`;
  }

  /**
   * The Order creation trigger (called in-process, never via a public
   * "create order" endpoint): CheckoutService calls this the moment a
   * COD session is accepted; PaymentService calls this from a Razorpay
   * `payment.captured` webhook. Idempotent on checkoutSessionId - a
   * duplicate call (defense in depth on top of PaymentEvent's own
   * webhook dedup) returns the existing order rather than erroring.
   *
   * Accepts an optional `externalTx` (independent-review finding #3):
   * PaymentService's capture path runs this INSIDE the same transaction
   * that flips Payment to CAPTURED and CheckoutSession to CONFIRMED, so
   * that if reservation conversion below fails (the reservation was
   * already lost to a genuinely concurrent expiry/release sweep), the
   * WHOLE transaction - payment/session state included - rolls back
   * atomically instead of leaving a captured payment permanently
   * confirmed with no order. CheckoutService's COD path still calls
   * this at the top level (no race to guard against: COD has no
   * separate async capture step).
   */
  async createOrderFromCheckoutSession(checkoutSessionId: string, externalTx?: Prisma.TransactionClient) {
    const db = externalTx ?? this.prisma;

    const existing = await db.order.findUnique({ where: { checkoutSessionId } });
    if (existing) return existing;

    const session = await db.checkoutSession.findUniqueOrThrow({
      where: { id: checkoutSessionId },
      include: { lines: true },
    });
    if (session.status !== 'CONFIRMED') {
      throw new ValidationError(`Cannot create an order from a CheckoutSession in status '${session.status}'`);
    }

    const run = async (tx: Prisma.TransactionClient) => {
      const orderNumber = await this.nextOrderNumber(tx);

      const created = await tx.order.create({
        data: {
          orderNumber,
          checkoutSessionId: session.id,
          customerId: session.customerId,
          guestSessionId: session.guestSessionId,
          contactName: session.contactName,
          contactMobile: session.contactMobile,
          contactEmail: session.contactEmail,
          billingAddress: session.billingAddress as object,
          shippingAddress: session.shippingAddress as object,
          shippingCost: session.shippingCost,
          subtotal: session.subtotal,
          taxAmount: session.taxAmount,
          grandTotal: session.grandTotal,
          currency: session.currency,
          paymentMethod: session.paymentMethod,
          status: 'CONFIRMED',
          lines: {
            create: session.lines.map((l) => ({
              skuId: l.skuId,
              locationId: l.locationId,
              quantity: l.quantity,
              unitPriceInclusive: l.unitPriceInclusive,
              taxableValueSnapshot: l.taxableValueSnapshot,
              gstRatePercent: l.gstRatePercent,
              taxAmountSnapshot: l.taxAmountSnapshot,
              lineTotalInclusive: l.lineTotalInclusive,
              reservationId: l.reservationId,
              status: 'ALLOCATED',
            })),
          },
        },
        include: { lines: true },
      });

      // Reservation -> committed allocation (specs/13-payment.md: "on
      // successful payment capture / successful COD order acceptance").
      // Throws if a reservation is no longer ACTIVE (already released
      // by a concurrent expiry sweep) - deliberately left uncaught here
      // so the whole transaction rolls back (see docblock above).
      for (const line of created.lines) {
        if (line.reservationId) {
          await this.inventory.convertReservation(line.reservationId, tx);
        }
      }

      // M16 (specs/15-warehouse-fulfilment.md): "warehouse work creation"
      // happens the instant a line becomes ALLOCATED, inside this SAME
      // transaction - never a separate, forgettable manual step, and
      // never at risk of existing without the order line it belongs to.
      await this.warehouse.createPickTasksForOrder(tx, created.id, created.lines);

      await recordAudit(tx, {
        actorType: session.customerId ? 'CUSTOMER' : 'SYSTEM',
        action: 'order.create',
        entityType: 'Order',
        entityId: created.id,
        newValue: { orderNumber, status: created.status, grandTotal: Number(created.grandTotal) },
        reference: checkoutSessionId,
      });

      return created;
    };

    let order;
    try {
      order = externalTx ? await run(externalTx) : await this.prisma.$transaction(run);
    } catch (err) {
      // Two concurrent callers (e.g. the checkout idempotency-race
      // "winner" path and this same method invoked defensively a
      // second time) can both pass the `existing` check above before
      // either has committed - the DB's own unique constraint on
      // Order.checkoutSessionId is the real guarantee, same pattern as
      // InventoryService.reserve()'s and CheckoutService.startCheckout's
      // own idempotency races. The loser returns the winner's order
      // rather than surfacing a raw P2002 as an opaque 500.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        try {
          const winner = await db.order.findUnique({ where: { checkoutSessionId } });
          if (winner) return winner;
        } catch {
          // externalTx may already be aborted by the constraint
          // violation above - fall through to rethrow the original
          // error, which the caller (PaymentService.applyCaptureOutcome)
          // routes to explicit reconciliation rather than losing it.
        }
      }
      throw err;
    }

    if (externalTx) {
      // The caller owns its own outer transaction (and, per finding #2,
      // owns issuing this order's invoice AFTER that transaction
      // commits) - issueInvoice must never run nested inside another
      // transaction, so don't attempt it here.
      return order;
    }

    // Every order MUST generate an invoice-equivalent document at
    // confirmation (spec, binding). Issued after the order's own
    // transaction commits (InvoiceService manages its own transaction)
    // - a transient invoice-issuance failure must never roll back an
    // already-accepted, already-paid order, and must never surface as a
    // failure of THIS call (the checkout submission / webhook delivery
    // that triggered it) - the order and payment are genuinely valid
    // regardless of invoicing's outcome. Failure is recorded DURABLY on
    // the order row itself (invoiceStatus/invoiceFailureReason/
    // invoiceAttempts) by retryOrderInvoice() itself, not just logged -
    // see reconcilePendingInvoices() for the recovery path
    // (independent-review finding #2). Deliberately swallowed here: a
    // caller that needs the error (the manual retry route,
    // reconcilePendingInvoices) calls retryOrderInvoice() directly.
    await this.retryOrderInvoice(order.id).catch(() => undefined);

    return this.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
  }

  /**
   * Attempts (or re-attempts) invoice issuance for one order and durably
   * records the outcome on the order row. Fully idempotent: if an
   * invoice already exists for this order - whether from a prior
   * successful attempt whose `invoiceId` link failed to save, or from a
   * concurrent attempt that just won - it is reused rather than
   * duplicated, and `Order.invoiceId` ends up pointing at it either way.
   * Never throws to a caller that doesn't ask for the error (see
   * `createOrderFromCheckoutSession`'s call site, which must not fail
   * order creation over this); `reconcilePendingInvoices()` and the
   * staff retry route do want the error, so it's rethrown after the
   * failure is durably recorded.
   */
  async retryOrderInvoice(orderId: string): Promise<void> {
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    if (order.invoiceId) return; // already linked - nothing to do, safe no-op

    try {
      const invoiceId = await this.issueOrderInvoiceIdempotent(orderId);
      await this.prisma.order.update({
        where: { id: orderId },
        data: { invoiceId, invoiceStatus: 'ISSUED', invoiceFailureReason: null },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.fastify.log.error({ err, orderId }, 'Failed to issue invoice for order');
      // Best-effort durability write: if even this update fails (e.g. a
      // transient DB blip), the order simply stays at its previous
      // invoiceStatus/invoiceAttempts and reconcilePendingInvoices()
      // will pick it up again on its next sweep - never silently lost.
      await this.prisma.order
        .update({
          where: { id: orderId },
          data: { invoiceStatus: 'FAILED', invoiceFailureReason: message, invoiceAttempts: { increment: 1 } },
        })
        .catch((updateErr) => this.fastify.log.error({ updateErr, orderId }, 'Failed to durably record invoice failure'));
      throw err;
    }
  }

  /**
   * Callable directly or by a future scheduler (same shape as
   * InventoryService.expireStaleReservations()) - driven entirely by
   * durable database state (`invoiceId IS NULL AND invoiceStatus IN
   * (PENDING, FAILED)`), so recovery survives a process restart with no
   * in-memory queue/timer dependency. Each order is retried independently;
   * one order's failure never blocks another's recovery.
   */
  async reconcilePendingInvoices(): Promise<{ attempted: number; succeeded: number; failed: number }> {
    const pending = await this.prisma.order.findMany({
      where: { invoiceId: null, invoiceStatus: { in: ['PENDING', 'FAILED'] } },
    });

    let succeeded = 0;
    let failed = 0;
    for (const order of pending) {
      try {
        await this.retryOrderInvoice(order.id);
        succeeded += 1;
      } catch {
        failed += 1;
      }
    }
    return { attempted: pending.length, succeeded, failed };
  }

  /**
   * Idempotent against a prior attempt that created the Invoice but
   * crashed/failed before `retryOrderInvoice` could link
   * `Order.invoiceId` to it - reuses the existing invoice rather than
   * attempting (and failing against `Invoice.orderId`'s own unique
   * constraint) to create a second one. Also handles the genuinely
   * concurrent case: two callers can race past this existence check at
   * the same time and both call `InvoiceService.issueInvoice()` - the
   * loser observes the DB's own unique constraint on `Invoice.orderId`
   * one of two ways depending on exact timing, and both are treated the
   * same "return the winner's row" way every other idempotency race in
   * this codebase is (InventoryService.reserve, CheckoutService.
   * startCheckout, OrderService.createOrderFromCheckoutSession):
   *  - a raw P2002 if the loser's own INSERT loses the race, or
   *  - `issueInvoice()`'s own ConflictError if the loser's pre-insert
   *    existence check happens to run just after the winner committed
   *    (a real race exposed under load, not merely theoretical - seen
   *    directly in test E's genuinely concurrent retry scenario).
   */
  private async issueOrderInvoiceIdempotent(orderId: string): Promise<string> {
    const existingInvoice = await this.prisma.invoice.findUnique({ where: { orderId } });
    if (existingInvoice) return existingInvoice.id;

    try {
      return await this.issueOrderInvoice(orderId);
    } catch (err) {
      const isRaceLoss =
        (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') || err instanceof ConflictError;
      if (isRaceLoss) {
        const winner = await this.prisma.invoice.findUnique({ where: { orderId } });
        if (winner) return winner.id;
      }
      throw err;
    }
  }

  private async issueOrderInvoice(orderId: string): Promise<string> {
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });

    // Single/few-location operation at launch (ORG-002, same
    // simplification CheckoutService.resolveSupplierRegistration
    // already makes) - one invoice per order against one supplier
    // registration, not split per line-location. Multi-GSTIN order
    // splitting is out of this milestone's scope.
    const location = await this.prisma.location.findFirst({
      where: { isActive: true, gstRegistrationId: { not: null } },
    });
    if (!location) throw new ValidationError('No active, GST-configured location is available to invoice this order');

    const shippingAddress = order.shippingAddress as { stateCode: string };

    const invoice = await this.invoice.issueInvoice({
      orderId: order.id,
      locationId: location.id,
      recipientName: order.contactName,
      billingAddress: order.billingAddress as Record<string, unknown>,
      deliveryAddress: order.shippingAddress as Record<string, unknown>,
      shippingStateCode: shippingAddress.stateCode,
      lines: order.lines.map((l) => ({
        skuId: l.skuId,
        quantity: l.quantity,
        unitPrice: Number(l.taxableValueSnapshot) / l.quantity,
      })),
    });

    return invoice.id;
  }

  private async loadOwnedOrder(id: string, identity: CartOwnerIdentity) {
    const order = await this.prisma.order.findUnique({ where: { id } });
    if (!order) throw new NotFoundError('Order', id);
    const owns =
      (identity.customerId && order.customerId === identity.customerId) ||
      (identity.guestSessionId && order.guestSessionId === identity.guestSessionId);
    if (!owns) throw new NotFoundError('Order', id);
    return order;
  }

  async getOrderForCustomer(id: string, identity: CartOwnerIdentity) {
    await this.loadOwnedOrder(id, identity);
    return this.toView(id);
  }

  async listOrdersForCustomer(identity: CartOwnerIdentity) {
    const where = identity.customerId ? { customerId: identity.customerId } : { guestSessionId: identity.guestSessionId };
    const orders = await this.prisma.order.findMany({ where, orderBy: { createdAt: 'desc' } });
    return Promise.all(orders.map((o) => this.toView(o.id)));
  }

  async getOrder(id: string) {
    return this.toView(id);
  }

  async listOrders(query: { status?: OrderStatus; invoiceStatus?: 'PENDING' | 'ISSUED' | 'FAILED'; take?: number; skip?: number }) {
    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.invoiceStatus ? { invoiceStatus: query.invoiceStatus } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: query.take ?? 50,
        skip: query.skip ?? 0,
      }),
      this.prisma.order.count({ where }),
    ]);
    return { items, total };
  }

  private async toView(id: string) {
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id },
      include: {
        lines: { include: { sku: { include: { style: true, colour: true, size: true } }, pickTask: true } },
        // M17: shipment tracking, joined for storefront/staff visibility
        // (specs/16-shipping-tracking.md: "customer shipment tracking
        // required, degrading gracefully to last-known platform status").
        fulfilments: { include: { shipment: true } },
      },
    });
    return {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      paymentMethod: order.paymentMethod,
      refundRequired: order.refundRequired,
      contactName: order.contactName,
      contactMobile: order.contactMobile,
      shippingAddress: order.shippingAddress,
      billingAddress: order.billingAddress,
      shippingCost: Number(order.shippingCost),
      subtotal: Number(order.subtotal),
      taxAmount: Number(order.taxAmount),
      grandTotal: Number(order.grandTotal),
      currency: order.currency,
      invoiceId: order.invoiceId,
      // Durable invoice-recovery state (independent-review finding #2) -
      // "operators can identify invoice-generation failures" without
      // reading server logs.
      invoiceStatus: order.invoiceStatus,
      invoiceFailureReason: order.invoiceFailureReason,
      invoiceAttempts: order.invoiceAttempts,
      lines: order.lines.map((l) => ({
        id: l.id,
        skuId: l.skuId,
        styleName: l.sku.style.name,
        colourName: l.sku.colour.name,
        sizeLabel: l.sku.size.label,
        quantity: l.quantity,
        unitPriceInclusive: Number(l.unitPriceInclusive),
        lineTotalInclusive: Number(l.lineTotalInclusive),
        status: l.status,
        fulfilmentId: l.fulfilmentId,
        cancelledAt: l.cancelledAt,
        cancelledReason: l.cancelledReason,
        exceptionReason: l.exceptionReason,
        // M16 visibility: lets a warehouse dashboard/CS agent see pick
        // progress without a second round-trip to /warehouse/pick-tasks.
        pickTask: l.pickTask
          ? {
              id: l.pickTask.id,
              status: l.pickTask.status,
              pickedQuantity: l.pickTask.pickedQuantity,
              exceptionType: l.pickTask.exceptionType,
            }
          : null,
      })),
      fulfilments: order.fulfilments.map((f) => ({
        id: f.id,
        status: f.status,
        carrierName: f.carrierName,
        trackingRef: f.trackingRef,
        packedAt: f.packedAt,
        shippedAt: f.shippedAt,
        deliveredAt: f.deliveredAt,
        // M17: last-known platform tracking status - never the carrier's
        // raw vocabulary (see ShippingProvider's adapter-boundary
        // normalization). null (no Shipment yet) is a legitimate,
        // expected state, not an error - the storefront shows it as
        // "not yet shipped", never a broken/error tile.
        shipment: f.shipment
          ? {
              id: f.shipment.id,
              provider: f.shipment.provider,
              trackingRef: f.shipment.trackingRef,
              status: f.shipment.status,
              deliveryAttempts: f.shipment.deliveryAttempts,
              maxDeliveryAttempts: f.shipment.maxDeliveryAttempts,
              bookedAt: f.shipment.bookedAt,
              deliveredAt: f.shipment.deliveredAt,
              rtoInitiatedAt: f.shipment.rtoInitiatedAt,
              rtoDeliveredAt: f.shipment.rtoDeliveredAt,
              updatedAt: f.shipment.updatedAt,
            }
          : null,
      })),
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    };
  }

  /** Derives the coarse order-level status from its lines. RTO is never derived - see markRTO. */
  private computeOrderStatus(lines: { status: OrderLineStatus }[]): OrderStatus {
    if (lines.some((l) => l.status === 'EXCEPTION')) return 'EXCEPTION';
    const active = lines.filter((l) => l.status !== 'CANCELLED');
    if (active.length === 0) return 'CANCELLED';
    if (active.every((l) => l.status === 'DELIVERED')) return 'DELIVERED';
    return 'PROCESSING';
  }

  private async recomputeOrderStatus(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
    if (order.status === 'RTO') return; // RTO is a terminal, explicitly-triggered state - never overwritten by line-status recompute
    const lines = await tx.orderLine.findMany({ where: { orderId }, select: { status: true } });
    const status = this.computeOrderStatus(lines);
    if (status !== order.status) {
      await tx.order.update({ where: { id: orderId }, data: { status } });
    }
  }

  /**
   * Row-locks and returns one OrderFulfilment by id (SELECT ... FOR
   * UPDATE, the same idiom InventoryService.lockReservation/lockBalance
   * and WarehouseService.lockPickTask already use). MUST run inside a
   * transaction, and MUST be the first thing every fulfilment state-
   * transition method below does, before reading `status` for its
   * eligibility check.
   *
   * Independent-review finding (M16 repair pass, 2026-09-24): every
   * fulfilment transition (pack/ready-to-ship/ship/deliver) previously
   * read the fulfilment via a plain `findUniqueOrThrow` - two genuinely
   * concurrent callers on the SAME fulfilment could both observe the
   * same pre-transition status before either committed. For
   * markFulfilmentShipped specifically this risked posting the SALE
   * ledger transaction (and decrementing onHand/reserved) more than once
   * for the same fulfilment's lines - InventoryService.recordSale()'s
   * own reservation/balance locking does not by itself prevent this,
   * since a CONVERTED reservation continues to satisfy recordSale's
   * quantity check on a second call. This lock closes the race at its
   * true source: the fulfilment's own status field. Whichever
   * transaction's SELECT ... FOR UPDATE acquires the row first proceeds;
   * the other blocks until the first commits, then re-reads the now-
   * advanced status through this same lock and takes its own pre-
   * existing "not eligible from this status" rejection branch - never a
   * blind concurrent double-transition.
   */
  private async lockFulfilment(
    tx: Prisma.TransactionClient,
    fulfilmentId: string,
  ): Promise<{ id: string; orderId: string; status: FulfilmentStatus } | null> {
    const rows = await tx.$queryRaw<
      { id: string; orderId: string; status: FulfilmentStatus }[]
    >`SELECT "id", "orderId", "status"
      FROM "order_fulfilments"
      WHERE "id" = ${fulfilmentId}
      FOR UPDATE`;
    return rows[0] ?? null;
  }

  /**
   * Groups a set of already-PICKED lines of the same order into one
   * shipment/package record, proving the split-shipment data model
   * (ORD-001) - a second call with the order's remaining lines produces a
   * second, independently-tracked Fulfilment/package (M16 §5: "do not
   * force one order = one package").
   *
   * M16 gate (specs/15-warehouse-fulfilment.md: "only legitimately picked
   * quantities may be packed"): requires OrderLineStatus.PICKED, not the
   * M15-original ALLOCATED - a line whose PickTask is still PENDING (or
   * SHORT_PICKED/EXCEPTION, which has already moved the line to
   * EXCEPTION) is rejected here with a clean 400, never silently packed.
   */
  async assignLinesToFulfilment(orderId: string, lineIds: string[], staffId: string) {
    if (lineIds.length === 0) throw new ValidationError('At least one order line is required');

    return this.prisma.$transaction(async (tx) => {
      // M16 concurrency hardening: row-locks every candidate line (SELECT
      // ... FOR UPDATE, the same idiom InventoryService.lockReservation/
      // lockBalance and WarehouseService.lockPickTask already use) before
      // reading eligibility - a plain findMany here let two genuinely
      // concurrent "pack this line" requests both read PICKED/unassigned
      // before either committed, so both could proceed and race on the
      // final fulfilmentId write (an "concurrent packing" adversarial
      // scenario the M16 build instruction requires be made safe, not
      // merely observed). Ordering by id avoids a deadlock if a future
      // caller ever locks the same two lines in a different order.
      const sortedIds = [...lineIds].sort();
      const lockedRows = await tx.$queryRaw<
        { id: string; orderId: string; fulfilmentId: string | null; status: string }[]
      >`SELECT "id", "orderId", "fulfilmentId", "status"
        FROM "order_lines"
        WHERE "id" = ANY(${sortedIds})
        ORDER BY "id"
        FOR UPDATE`;

      const lines = lockedRows.filter((l) => l.orderId === orderId);
      if (lines.length !== lineIds.length) {
        throw new NotFoundError('OrderLine', lineIds.join(','));
      }
      for (const line of lines) {
        if (line.fulfilmentId) {
          throw new ConflictError(`Order line '${line.id}' is already assigned to a fulfilment`);
        }
        if (line.status !== 'PICKED') {
          throw new ValidationError(
            `Order line '${line.id}' is not eligible for fulfilment (status '${line.status}') - it must be fully picked first`,
          );
        }
      }

      const fulfilment = await tx.orderFulfilment.create({ data: { orderId } });
      await tx.orderLine.updateMany({ where: { id: { in: lineIds } }, data: { fulfilmentId: fulfilment.id } });

      await recordAudit(tx, {
        actorType: 'STAFF',
        actorStaffId: staffId,
        action: 'order.fulfilment.create',
        entityType: 'OrderFulfilment',
        entityId: fulfilment.id,
        newValue: { orderId, lineIds },
        reference: orderId,
      });

      return fulfilment;
    });
  }

  async markFulfilmentPacked(fulfilmentId: string, staffId: string) {
    return this.prisma.$transaction(async (tx) => {
      const fulfilment = await this.lockFulfilment(tx, fulfilmentId);
      if (!fulfilment) throw new NotFoundError('OrderFulfilment', fulfilmentId);
      if (fulfilment.status !== 'PENDING') {
        throw new ValidationError(`Cannot pack a fulfilment in status '${fulfilment.status}'`);
      }
      await tx.orderFulfilment.update({ where: { id: fulfilmentId }, data: { status: 'PACKED', packedAt: new Date() } });
      await tx.orderLine.updateMany({ where: { fulfilmentId }, data: { status: 'PACKED' } });
      await recordAudit(tx, {
        actorType: 'STAFF',
        actorStaffId: staffId,
        action: 'order.fulfilment.pack',
        entityType: 'OrderFulfilment',
        entityId: fulfilmentId,
        reference: fulfilment.orderId,
      });
      await this.recomputeOrderStatus(tx, fulfilment.orderId);
      return tx.orderFulfilment.findUniqueOrThrow({ where: { id: fulfilmentId } });
    });
  }

  /**
   * M16 (specs/15-warehouse-fulfilment.md): the explicit "shipment
   * hand-off boundary" required by the M16 build instruction - a distinct
   * staff confirmation between "packing is physically complete" (PACKED)
   * and "this package is staged and ready for carrier pickup"
   * (READY_TO_SHIP). markFulfilmentShipped below now requires this state
   * rather than PACKED directly, so a fulfilment can never be shipped
   * without it. Real carrier integration (dispatch scheduling, tracking
   * updates) is M17's own, separately-authorized scope - this method
   * creates only the adapter boundary M16 itself needs.
   */
  async markFulfilmentReadyToShip(fulfilmentId: string, staffId: string) {
    return this.prisma.$transaction(async (tx) => {
      const fulfilment = await this.lockFulfilment(tx, fulfilmentId);
      if (!fulfilment) throw new NotFoundError('OrderFulfilment', fulfilmentId);
      if (fulfilment.status !== 'PACKED') {
        throw new ValidationError(`Cannot mark a fulfilment ready to ship from status '${fulfilment.status}' - it must be PACKED first`);
      }
      await tx.orderFulfilment.update({ where: { id: fulfilmentId }, data: { status: 'READY_TO_SHIP' } });
      await recordAudit(tx, {
        actorType: 'STAFF',
        actorStaffId: staffId,
        action: 'order.fulfilment.ready_to_ship',
        entityType: 'OrderFulfilment',
        entityId: fulfilmentId,
        reference: fulfilment.orderId,
      });
      return tx.orderFulfilment.findUniqueOrThrow({ where: { id: fulfilmentId } });
    });
  }

  /**
   * SHIPPED: posts the SALE ledger transaction per line (FLOW 8's
   * "inventory posts the sale/fulfilment transaction at the defined
   * trigger point"). This remains the ONE authoritative point SALE is
   * ever posted from (M16 certification invariant) - M17's
   * `ShippingService.createShipment` reuses this method (via
   * `externalTx`) rather than duplicating any of its logic, so a
   * shipment's booking and its fulfilment's READY_TO_SHIP->SHIPPED
   * transition commit atomically together, and there is still exactly
   * one code path that can ever call `InventoryService.recordSale` for
   * an order line.
   *
   * `externalTx` (M17): when provided, this method runs entirely inside
   * the CALLER's already-open transaction instead of opening its own -
   * lets `ShippingService.createShipment` include this transition in
   * the same atomic unit as its own `Shipment` row update, without this
   * method ever being duplicated or reimplemented. Omitted, it behaves
   * exactly as before (M15/M16 callers - the staff `/ship` route -
   * unchanged).
   */
  async markFulfilmentShipped(
    fulfilmentId: string,
    staffId: string,
    opts?: { carrierName?: string; trackingRef?: string },
    externalTx?: Prisma.TransactionClient,
  ) {
    const run = async (tx: Prisma.TransactionClient) => {
      const locked = await this.lockFulfilment(tx, fulfilmentId);
      if (!locked) throw new NotFoundError('OrderFulfilment', fulfilmentId);
      if (locked.status !== 'READY_TO_SHIP') {
        throw new ValidationError(`Cannot ship a fulfilment in status '${locked.status}' - it must be READY_TO_SHIP first`);
      }

      // Safe to read the lines only now that the fulfilment row lock is
      // held: no concurrent transition on this fulfilmentId can be
      // mid-flight (every transition method acquires this same lock
      // first), so this read is guaranteed consistent with `locked`.
      const fulfilment = await tx.orderFulfilment.findUniqueOrThrow({ where: { id: fulfilmentId }, include: { lines: true } });

      for (const line of fulfilment.lines) {
        // reservationId lets InventoryService itself verify this line's
        // allocation is genuine (CONVERTED, sufficient quantity) rather
        // than trusting this call blindly (independent-review finding #5).
        await this.inventory.recordSale(
          {
            skuId: line.skuId,
            locationId: line.locationId,
            quantity: line.quantity,
            referenceType: 'ORDER_LINE',
            referenceId: line.id,
            reservationId: line.reservationId ?? undefined,
          },
          tx,
        );
      }

      await tx.orderFulfilment.update({
        where: { id: fulfilmentId },
        data: { status: 'SHIPPED', shippedAt: new Date(), carrierName: opts?.carrierName, trackingRef: opts?.trackingRef },
      });
      await tx.orderLine.updateMany({ where: { fulfilmentId }, data: { status: 'SHIPPED' } });
      await recordAudit(tx, {
        actorType: 'STAFF',
        actorStaffId: staffId,
        action: 'order.fulfilment.ship',
        entityType: 'OrderFulfilment',
        entityId: fulfilmentId,
        newValue: { carrierName: opts?.carrierName, trackingRef: opts?.trackingRef },
        reference: fulfilment.orderId,
      });
      await this.recomputeOrderStatus(tx, fulfilment.orderId);
      return tx.orderFulfilment.findUniqueOrThrow({ where: { id: fulfilmentId } });
    };

    return externalTx ? run(externalTx) : this.prisma.$transaction(run);
  }

  /**
   * `staffId: null` (M17): a SYSTEM-attributed transition - a carrier
   * webhook/poll reporting genuine delivery, not a staff action. Uses
   * the same `actorType: session.customerId ? 'CUSTOMER' : 'SYSTEM'`-
   * style convention `createOrderFromCheckoutSession` already
   * established for non-staff-triggered audit entries. Existing
   * staff-triggered callers (the `/deliver` route) are unaffected -
   * passing a real staffId behaves exactly as before.
   */
  async markFulfilmentDelivered(fulfilmentId: string, staffId: string | null, externalTx?: Prisma.TransactionClient) {
    const run = async (tx: Prisma.TransactionClient) => {
      const fulfilment = await this.lockFulfilment(tx, fulfilmentId);
      if (!fulfilment) throw new NotFoundError('OrderFulfilment', fulfilmentId);
      if (fulfilment.status !== 'SHIPPED') {
        throw new ValidationError(`Cannot mark delivered a fulfilment in status '${fulfilment.status}'`);
      }
      await tx.orderFulfilment.update({ where: { id: fulfilmentId }, data: { status: 'DELIVERED', deliveredAt: new Date() } });
      await tx.orderLine.updateMany({ where: { fulfilmentId }, data: { status: 'DELIVERED' } });
      await recordAudit(tx, {
        actorType: staffId ? 'STAFF' : 'SYSTEM',
        actorStaffId: staffId ?? undefined,
        action: 'order.fulfilment.deliver',
        entityType: 'OrderFulfilment',
        entityId: fulfilmentId,
        reference: fulfilment.orderId,
      });
      await this.recomputeOrderStatus(tx, fulfilment.orderId);
      return tx.orderFulfilment.findUniqueOrThrow({ where: { id: fulfilmentId } });
    };

    return externalTx ? run(externalTx) : this.prisma.$transaction(run);
  }

  /**
   * Partial cancellation (ORD-001, FLOW 7). Blocked once the line has
   * shipped - negative scenario #1 ("routes to return instead", which
   * is specs/18-returns.md's own milestone). Refund consequence is
   * flagged honestly, not executed - see the Order.refundRequired
   * schema comment.
   */
  async cancelOrderLine(orderId: string, lineId: string, staffId: string, reason: string) {
    if (!reason.trim()) throw new ValidationError('A cancellation reason is required');

    return this.prisma.$transaction(async (tx) => {
      const line = await tx.orderLine.findUnique({ where: { id: lineId } });
      if (!line || line.orderId !== orderId) throw new NotFoundError('OrderLine', lineId);
      if (line.status === 'CANCELLED') return line;
      if (line.status === 'SHIPPED' || line.status === 'DELIVERED') {
        throw new ValidationError(`Cannot cancel a line that has already ${line.status.toLowerCase()} - use a return instead`);
      }

      if (line.reservationId) {
        await this.inventory.cancelAllocation(line.reservationId, reason, tx);
      }

      await tx.orderLine.update({
        where: { id: lineId },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledReason: reason },
      });

      // M16: a PickTask that hasn't started yet (still PENDING) is
      // cancelled alongside its line, so a warehouse queue never shows
      // phantom work for a cancelled line. A task that already completed
      // (PICKED/SHORT_PICKED/EXCEPTION) is left as the historical record
      // of the work that genuinely happened - recordPickOutcome's own
      // "pick cancelled line" guard is what protects a NEW pick attempt,
      // not a retroactive rewrite of one that already occurred.
      await tx.pickTask.updateMany({ where: { orderLineId: lineId, status: 'PENDING' }, data: { status: 'CANCELLED' } });

      const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
      if (order.paymentMethod === 'PREPAID') {
        await tx.order.update({ where: { id: orderId }, data: { refundRequired: true } });
      }

      await recordAudit(tx, {
        actorType: 'STAFF',
        actorStaffId: staffId,
        action: 'order.line.cancel',
        entityType: 'OrderLine',
        entityId: lineId,
        newValue: { reason },
        reference: orderId,
      });

      await this.recomputeOrderStatus(tx, orderId);
      return tx.orderLine.findUniqueOrThrow({ where: { id: lineId } });
    });
  }

  /** Order exception (ORD-001, negative scenario #2) - e.g. a pick shortfall discovered post-confirmation. */
  async flagException(orderId: string, lineId: string, staffId: string, reason: string) {
    if (!reason.trim()) throw new ValidationError('An exception reason is required');

    return this.prisma.$transaction(async (tx) => {
      const line = await tx.orderLine.findUnique({ where: { id: lineId } });
      if (!line || line.orderId !== orderId) throw new NotFoundError('OrderLine', lineId);
      if (line.status === 'SHIPPED' || line.status === 'DELIVERED' || line.status === 'CANCELLED') {
        throw new ValidationError(`Cannot flag an exception on a line in status '${line.status}'`);
      }

      await tx.orderLine.update({ where: { id: lineId }, data: { status: 'EXCEPTION', exceptionReason: reason } });
      await recordAudit(tx, {
        actorType: 'STAFF',
        actorStaffId: staffId,
        action: 'order.line.exception.flag',
        entityType: 'OrderLine',
        entityId: lineId,
        newValue: { reason },
        reference: orderId,
      });
      await this.recomputeOrderStatus(tx, orderId);
      return tx.orderLine.findUniqueOrThrow({ where: { id: lineId } });
    });
  }

  /** Resolves an exception by either reinstating the line (stock issue fixed) or cancelling it. */
  async resolveException(orderId: string, lineId: string, staffId: string, resolution: 'REINSTATE' | 'CANCEL', reason: string) {
    if (!reason.trim()) throw new ValidationError('A resolution reason is required');

    return this.prisma.$transaction(async (tx) => {
      const line = await tx.orderLine.findUnique({ where: { id: lineId } });
      if (!line || line.orderId !== orderId) throw new NotFoundError('OrderLine', lineId);
      if (line.status !== 'EXCEPTION') {
        throw new ValidationError(`Order line '${lineId}' has no open exception to resolve`);
      }

      if (resolution === 'CANCEL') {
        if (line.reservationId) {
          await this.inventory.cancelAllocation(line.reservationId, reason, tx);
        }
        await tx.orderLine.update({
          where: { id: lineId },
          data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledReason: reason, exceptionReason: null },
        });
        await tx.pickTask.updateMany({ where: { orderLineId: lineId, status: 'PENDING' }, data: { status: 'CANCELLED' } });
        const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
        if (order.paymentMethod === 'PREPAID') {
          await tx.order.update({ where: { id: orderId }, data: { refundRequired: true } });
        }
      } else {
        await tx.orderLine.update({ where: { id: lineId }, data: { status: 'ALLOCATED', exceptionReason: null } });
        // M16: reinstating (e.g. stock replenished, or a manually-flagged
        // exception unrelated to picking) resets this line's PickTask
        // back to PENDING for a fresh pick attempt - the SAME task row,
        // never a second one (orderLineId stays unique).
        await tx.pickTask.updateMany({
          where: { orderLineId: lineId },
          data: {
            status: 'PENDING',
            pickedQuantity: 0,
            exceptionType: null,
            exceptionReason: null,
            idempotencyKey: null,
            pickedByStaffId: null,
            pickedAt: null,
          },
        });
      }

      await recordAudit(tx, {
        actorType: 'STAFF',
        actorStaffId: staffId,
        action: 'order.line.exception.resolve',
        entityType: 'OrderLine',
        entityId: lineId,
        newValue: { resolution, reason },
        reference: orderId,
      });
      await this.recomputeOrderStatus(tx, orderId);
      return tx.orderLine.findUniqueOrThrow({ where: { id: lineId } });
    });
  }

  /**
   * RTO (ORD-001, FLOW 15): a staff-triggered terminal state for a
   * SHIPPED order (all its active lines currently in transit) that
   * failed delivery - the "repeated failed delivery attempts" / carrier
   * detection that would trigger this automatically belongs to
   * specs/16-shipping-tracking.md (M17), not built here. What this
   * milestone provides is the correct consequence once RTO is known:
   * COD closes with no refund (nothing was ever collected); PREPAID is
   * flagged for refund (Order.refundRequired), not executed (M19).
   * Physical stock reconciliation once the parcel is actually confirmed
   * back at the warehouse (subject to QC disposition) is a GRN-style
   * receiving event - specs/18-returns.md's own scope, not posted here.
   */
  /**
   * `staffId: null` (M17): a SYSTEM-attributed RTO - the platform's own
   * automatic "redelivery attempts exhausted" determination
   * (`ShippingService.applyTrackingUpdate`), not a staff action. Same
   * convention as `markFulfilmentDelivered`.
   *
   * Guard unchanged from M15/M16 ("every active line SHIPPED") - this
   * is deliberately still the only trigger for `Order.status = RTO`
   * (single authoritative posting point, same discipline as SALE). For
   * a split-shipment order, that guard is only satisfiable once EVERY
   * fulfilment's lines are still sitting at SHIPPED (none delivered
   * yet) - `ShippingService` only calls this when the order's shipments
   * are consistent with that (see its own docblock for the documented
   * limitation on mixed-state multi-shipment orders, a genuine open
   * business question for M18+, not guessed here).
   */
  async markRTO(orderId: string, staffId: string | null, reason: string, externalTx?: Prisma.TransactionClient) {
    if (!reason.trim()) throw new ValidationError('An RTO reason is required');

    const run = async (tx: Prisma.TransactionClient) => {
      const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
      if (order.status === 'RTO') return order;

      const lines = await tx.orderLine.findMany({ where: { orderId } });
      const active = lines.filter((l) => l.status !== 'CANCELLED');
      if (active.length === 0 || !active.every((l) => l.status === 'SHIPPED')) {
        throw new ValidationError('An order can only be marked RTO once all its active lines have shipped');
      }

      const updated = await tx.order.update({
        where: { id: orderId },
        data: { status: 'RTO', refundRequired: order.paymentMethod === 'PREPAID' },
      });

      await recordAudit(tx, {
        actorType: staffId ? 'STAFF' : 'SYSTEM',
        actorStaffId: staffId ?? undefined,
        action: 'order.rto',
        entityType: 'Order',
        entityId: orderId,
        newValue: { reason, refundRequired: updated.refundRequired },
      });

      return updated;
    };

    return externalTx ? run(externalTx) : this.prisma.$transaction(run);
  }
}
