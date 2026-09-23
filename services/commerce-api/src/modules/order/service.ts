import type { FastifyInstance } from 'fastify';
import { Prisma, type PrismaClient, type OrderStatus, type OrderLineStatus } from '@fcp/db';
import { NotFoundError, ValidationError, ConflictError } from '@fcp/shared';
import { InventoryService } from '../inventory/service.js';
import { InvoiceService } from '../tax/invoice-service.js';
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

  constructor(private readonly fastify: FastifyInstance) {
    this.inventory = new InventoryService(fastify);
    this.invoice = new InvoiceService(fastify);
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
   */
  async createOrderFromCheckoutSession(checkoutSessionId: string) {
    const existing = await this.prisma.order.findUnique({ where: { checkoutSessionId } });
    if (existing) return existing;

    const session = await this.prisma.checkoutSession.findUniqueOrThrow({
      where: { id: checkoutSessionId },
      include: { lines: true },
    });
    if (session.status !== 'CONFIRMED') {
      throw new ValidationError(`Cannot create an order from a CheckoutSession in status '${session.status}'`);
    }

    let order;
    try {
      order = await this.prisma.$transaction(async (tx) => {
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
        for (const line of created.lines) {
          if (line.reservationId) {
            await this.inventory.convertReservation(line.reservationId, tx);
          }
        }

        await recordAudit(tx, {
          actorType: session.customerId ? 'CUSTOMER' : 'SYSTEM',
          action: 'order.create',
          entityType: 'Order',
          entityId: created.id,
          newValue: { orderNumber, status: created.status, grandTotal: Number(created.grandTotal) },
          reference: checkoutSessionId,
        });

        return created;
      });
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
        const winner = await this.prisma.order.findUnique({ where: { checkoutSessionId } });
        if (winner) return winner;
      }
      throw err;
    }

    // Every order MUST generate an invoice-equivalent document at
    // confirmation (spec, binding). Issued after the order's own
    // transaction commits (InvoiceService manages its own transaction)
    // - a transient invoice-issuance failure must never roll back an
    // already-accepted, already-paid order. Logged, not silently
    // swallowed, if it does fail; invoiceId simply stays null for
    // manual follow-up (no automated retry queue built in this
    // milestone).
    try {
      const invoiceId = await this.issueOrderInvoice(order.id);
      await this.prisma.order.update({ where: { id: order.id }, data: { invoiceId } });
    } catch (err) {
      this.fastify.log.error({ err, orderId: order.id }, 'Failed to issue invoice at order confirmation');
    }

    return this.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
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

  async listOrders(query: { status?: OrderStatus; take?: number; skip?: number }) {
    const [items, total] = await Promise.all([
      this.prisma.order.findMany({
        where: query.status ? { status: query.status } : undefined,
        orderBy: { createdAt: 'desc' },
        take: query.take ?? 50,
        skip: query.skip ?? 0,
      }),
      this.prisma.order.count({ where: query.status ? { status: query.status } : undefined }),
    ]);
    return { items, total };
  }

  private async toView(id: string) {
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id },
      include: {
        lines: { include: { sku: { include: { style: true, colour: true, size: true } } } },
        fulfilments: true,
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
      })),
      fulfilments: order.fulfilments.map((f) => ({
        id: f.id,
        status: f.status,
        carrierName: f.carrierName,
        trackingRef: f.trackingRef,
        packedAt: f.packedAt,
        shippedAt: f.shippedAt,
        deliveredAt: f.deliveredAt,
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
   * The engineering-level analogue of "generate a pick list" this
   * milestone provides (see the scope-boundary note at the top of this
   * file): groups a set of not-yet-fulfilled lines of the same order
   * into one shipment record, proving the split-shipment data model
   * (ORD-001) - a second call with the order's remaining lines produces
   * a second, independently-tracked Fulfilment.
   */
  async assignLinesToFulfilment(orderId: string, lineIds: string[], staffId: string) {
    if (lineIds.length === 0) throw new ValidationError('At least one order line is required');

    return this.prisma.$transaction(async (tx) => {
      const lines = await tx.orderLine.findMany({ where: { id: { in: lineIds }, orderId } });
      if (lines.length !== lineIds.length) {
        throw new NotFoundError('OrderLine', lineIds.join(','));
      }
      for (const line of lines) {
        if (line.fulfilmentId) {
          throw new ConflictError(`Order line '${line.id}' is already assigned to a fulfilment`);
        }
        if (line.status !== 'ALLOCATED') {
          throw new ValidationError(`Order line '${line.id}' is not eligible for fulfilment (status '${line.status}')`);
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
      const fulfilment = await tx.orderFulfilment.findUniqueOrThrow({ where: { id: fulfilmentId } });
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

  /** SHIPPED: posts the SALE ledger transaction per line (FLOW 8's "inventory posts the sale/fulfilment transaction at the defined trigger point"). */
  async markFulfilmentShipped(fulfilmentId: string, staffId: string, opts?: { carrierName?: string; trackingRef?: string }) {
    return this.prisma.$transaction(async (tx) => {
      const fulfilment = await tx.orderFulfilment.findUniqueOrThrow({ where: { id: fulfilmentId }, include: { lines: true } });
      if (fulfilment.status !== 'PACKED') {
        throw new ValidationError(`Cannot ship a fulfilment in status '${fulfilment.status}'`);
      }

      for (const line of fulfilment.lines) {
        await this.inventory.recordSale(
          { skuId: line.skuId, locationId: line.locationId, quantity: line.quantity, referenceType: 'ORDER_LINE', referenceId: line.id },
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
    });
  }

  async markFulfilmentDelivered(fulfilmentId: string, staffId: string) {
    return this.prisma.$transaction(async (tx) => {
      const fulfilment = await tx.orderFulfilment.findUniqueOrThrow({ where: { id: fulfilmentId } });
      if (fulfilment.status !== 'SHIPPED') {
        throw new ValidationError(`Cannot mark delivered a fulfilment in status '${fulfilment.status}'`);
      }
      await tx.orderFulfilment.update({ where: { id: fulfilmentId }, data: { status: 'DELIVERED', deliveredAt: new Date() } });
      await tx.orderLine.updateMany({ where: { fulfilmentId }, data: { status: 'DELIVERED' } });
      await recordAudit(tx, {
        actorType: 'STAFF',
        actorStaffId: staffId,
        action: 'order.fulfilment.deliver',
        entityType: 'OrderFulfilment',
        entityId: fulfilmentId,
        reference: fulfilment.orderId,
      });
      await this.recomputeOrderStatus(tx, fulfilment.orderId);
      return tx.orderFulfilment.findUniqueOrThrow({ where: { id: fulfilmentId } });
    });
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
        const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
        if (order.paymentMethod === 'PREPAID') {
          await tx.order.update({ where: { id: orderId }, data: { refundRequired: true } });
        }
      } else {
        await tx.orderLine.update({ where: { id: lineId }, data: { status: 'ALLOCATED', exceptionReason: null } });
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
  async markRTO(orderId: string, staffId: string, reason: string) {
    if (!reason.trim()) throw new ValidationError('An RTO reason is required');

    return this.prisma.$transaction(async (tx) => {
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
        actorType: 'STAFF',
        actorStaffId: staffId,
        action: 'order.rto',
        entityType: 'Order',
        entityId: orderId,
        newValue: { reason, refundRequired: updated.refundRequired },
      });

      return updated;
    });
  }
}
