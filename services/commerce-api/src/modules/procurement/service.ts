import type { FastifyInstance } from 'fastify';
import type { Prisma, PrismaClient } from '@fcp/db';
import { loadEnv } from '@fcp/config';
import { formatSequenceNumber } from '@fcp/shared';
import { ConflictError, NotFoundError, ValidationError } from '@fcp/shared';
import { recordAudit } from '../audit/service.js';

export interface CreatePurchaseOrderInput {
  supplierId: string;
  locationId: string;
  expectedDate?: Date;
  lines: { skuId: string; orderedQty: number; unitCost: number }[];
}

/**
 * Purchase Orders (M04, specs/04-purchase-orders.md).
 *
 * Lifecycle: DRAFT -> SUBMITTED -> APPROVED -> PARTIALLY_RECEIVED ->
 * FULLY_RECEIVED -> CLOSED, with REJECTED/CANCELLED off-ramps (PO-001).
 * Unit cost is captured per line and never overwritten after receipt, so
 * it remains available for margin/profitability analytics (PO-002).
 * Value-based approval is a configurable threshold (PO_APPROVAL_THRESHOLD_INR)
 * recorded on the PO at approval time for audit/historical purposes -
 * the threshold itself does not gate a *different* permission tier here,
 * since the permission matrix (specs/01-auth-rbac.md) already scopes
 * `po:approve` to Buying/Finance/Business Admin roles.
 */
export class ProcurementService {
  constructor(private readonly fastify: FastifyInstance) {}

  private get prisma(): PrismaClient {
    return this.fastify.prisma;
  }

  /** Serializes PO number generation via a transaction-scoped advisory lock, avoiding a schema change for a dedicated sequence. */
  private async nextPoNumber(tx: Prisma.TransactionClient): Promise<string> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('po_number_seq'))`;
    const year = new Date().getFullYear();
    const count = await tx.purchaseOrder.count();
    return formatSequenceNumber('PO', year, count + 1);
  }

  async createPurchaseOrder(input: CreatePurchaseOrderInput, actorStaffId: string) {
    if (input.lines.length === 0) throw new ValidationError('Purchase order must have at least one line');
    for (const line of input.lines) {
      if (line.orderedQty <= 0) throw new ValidationError('orderedQty must be positive');
      if (line.unitCost <= 0) throw new ValidationError('unitCost must be positive');
    }

    const supplier = await this.prisma.supplier.findUnique({ where: { id: input.supplierId } });
    if (!supplier) throw new NotFoundError('Supplier', input.supplierId);
    if (!supplier.isActive) {
      throw new ValidationError('Cannot create a purchase order against an inactive supplier');
    }

    const totalCost = input.lines.reduce((sum, l) => sum + l.orderedQty * l.unitCost, 0);

    const po = await this.prisma.$transaction(async (tx) => {
      const poNumber = await this.nextPoNumber(tx);
      return tx.purchaseOrder.create({
        data: {
          poNumber,
          supplierId: input.supplierId,
          locationId: input.locationId,
          expectedDate: input.expectedDate,
          totalCost,
          lines: {
            create: input.lines.map((l) => ({
              skuId: l.skuId,
              orderedQty: l.orderedQty,
              unitCost: l.unitCost,
            })),
          },
        },
        include: { lines: true },
      });
    });

    await recordAudit(this.prisma, {
      actorType: 'STAFF',
      actorStaffId,
      action: 'purchase_order.create',
      entityType: 'PurchaseOrder',
      entityId: po.id,
      newValue: { supplierId: input.supplierId, locationId: input.locationId, totalCost },
    });
    return po;
  }

  async getPurchaseOrder(id: string) {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      include: { lines: true, approvals: true, supplier: true, location: true },
    });
    if (!po) throw new NotFoundError('PurchaseOrder', id);
    return po;
  }

  async listPurchaseOrders(params: { status?: string; supplierId?: string; take?: number; skip?: number }) {
    return this.prisma.purchaseOrder.findMany({
      where: { status: params.status as never, supplierId: params.supplierId },
      include: { lines: true },
      take: params.take ?? 50,
      skip: params.skip ?? 0,
      orderBy: { createdAt: 'desc' },
    });
  }

  async submitPurchaseOrder(poId: string, actorStaffId: string) {
    const po = await this.getPurchaseOrder(poId);
    if (po.status !== 'DRAFT') {
      throw new ValidationError(`Cannot submit a purchase order from status '${po.status}'`);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.purchaseOrder.update({
        where: { id: poId },
        data: { status: 'SUBMITTED', submittedByStaffId: actorStaffId },
      });
      await tx.purchaseOrderApproval.create({
        data: { poId, staffId: actorStaffId, action: 'SUBMITTED' },
      });
      return result;
    });

    await recordAudit(this.prisma, {
      actorType: 'STAFF',
      actorStaffId,
      action: 'purchase_order.submit',
      entityType: 'PurchaseOrder',
      entityId: poId,
      oldValue: { status: po.status },
      newValue: { status: 'SUBMITTED' },
    });
    return updated;
  }

  /**
   * Segregation of duties (PO-001): the staff member who submitted a PO
   * may not also approve it, regardless of permission grants.
   */
  async approvePurchaseOrder(poId: string, actorStaffId: string, comment?: string) {
    const po = await this.getPurchaseOrder(poId);
    if (po.status !== 'SUBMITTED') {
      throw new ValidationError(`Cannot approve a purchase order from status '${po.status}'`);
    }
    if (po.submittedByStaffId === actorStaffId) {
      throw new ValidationError('A purchase order may not be approved by the same staff member who submitted it');
    }

    const env = loadEnv();
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.purchaseOrder.update({
        where: { id: poId },
        data: {
          status: 'APPROVED',
          approvedByStaffId: actorStaffId,
          approvalThresholdApplied: env.PO_APPROVAL_THRESHOLD_INR,
        },
      });
      await tx.purchaseOrderApproval.create({
        data: { poId, staffId: actorStaffId, action: 'APPROVED', comment },
      });
      return result;
    });

    await recordAudit(this.prisma, {
      actorType: 'STAFF',
      actorStaffId,
      action: 'purchase_order.approve',
      entityType: 'PurchaseOrder',
      entityId: poId,
      oldValue: { status: po.status },
      newValue: { status: 'APPROVED', totalCost: po.totalCost, thresholdApplied: env.PO_APPROVAL_THRESHOLD_INR },
    });
    return updated;
  }

  async rejectPurchaseOrder(poId: string, actorStaffId: string, comment?: string) {
    const po = await this.getPurchaseOrder(poId);
    if (po.status !== 'SUBMITTED') {
      throw new ValidationError(`Cannot reject a purchase order from status '${po.status}'`);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.purchaseOrder.update({ where: { id: poId }, data: { status: 'REJECTED' } });
      await tx.purchaseOrderApproval.create({
        data: { poId, staffId: actorStaffId, action: 'REJECTED', comment },
      });
      return result;
    });

    await recordAudit(this.prisma, {
      actorType: 'STAFF',
      actorStaffId,
      action: 'purchase_order.reject',
      entityType: 'PurchaseOrder',
      entityId: poId,
      oldValue: { status: po.status },
      newValue: { status: 'REJECTED', comment },
    });
    return updated;
  }

  async cancelPurchaseOrder(poId: string, actorStaffId: string) {
    const po = await this.getPurchaseOrder(poId);
    if (!['DRAFT', 'SUBMITTED', 'APPROVED'].includes(po.status)) {
      throw new ValidationError(`Cannot cancel a purchase order from status '${po.status}'`);
    }
    const anyReceived = po.lines.some((l) => l.receivedQty > 0);
    if (anyReceived) {
      throw new ConflictError('Cannot cancel a purchase order that has already received stock against it');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.purchaseOrder.update({ where: { id: poId }, data: { status: 'CANCELLED' } });
      await tx.purchaseOrderApproval.create({
        data: { poId, staffId: actorStaffId, action: 'CANCELLED' },
      });
      return result;
    });

    await recordAudit(this.prisma, {
      actorType: 'STAFF',
      actorStaffId,
      action: 'purchase_order.cancel',
      entityType: 'PurchaseOrder',
      entityId: poId,
      oldValue: { status: po.status },
      newValue: { status: 'CANCELLED' },
    });
    return updated;
  }

  /**
   * Applies physical receipt quantities from a GRN (M05) to the PO's
   * lines, and rolls the PO status to PARTIALLY_RECEIVED or
   * FULLY_RECEIVED. Called from within the GRN module's own transaction
   * so PO-line and inventory-ledger effects of one GRN event commit
   * atomically together (GRN-003). `receivedQty` here is the physically
   * received quantity, not the QC-accepted quantity - a PO's delivery
   * obligation is fulfilled by physical arrival; QC outcome affects
   * sellable inventory (M06), not PO fulfillment accounting.
   *
   * Row-locks every affected PO line (SELECT ... FOR UPDATE, in a
   * consistent id order to avoid deadlocks) before reading its current
   * receivedQty, so two GRNs submitted concurrently against the same PO
   * line serialize correctly instead of losing one's update (acceptance/
   * m05-grn.md "Concurrency"). Returns each line's pre-this-GRN snapshot
   * so the caller can compute short/excess against the same locked
   * value it read, race-free.
   */
  async applyGrnReceipt(
    tx: Prisma.TransactionClient,
    poId: string,
    lineReceipts: { poLineId: string; receivedQty: number }[],
  ): Promise<Map<string, { orderedQty: number; receivedQtyBeforeThisGrn: number }>> {
    const poLineIds = [...new Set(lineReceipts.map((r) => r.poLineId))];
    const locked = await tx.$queryRaw<
      { id: string; poId: string; orderedQty: number; receivedQty: number }[]
    >`SELECT id, "poId", "orderedQty", "receivedQty"
      FROM "purchase_order_lines"
      WHERE id = ANY(${poLineIds})
      ORDER BY id
      FOR UPDATE`;

    const lockedById = new Map(locked.map((l) => [l.id, l]));
    const before = new Map<string, { orderedQty: number; receivedQtyBeforeThisGrn: number }>();

    for (const receipt of lineReceipts) {
      const line = lockedById.get(receipt.poLineId);
      if (!line) throw new NotFoundError('PurchaseOrderLine', receipt.poLineId);
      if (line.poId !== poId) {
        throw new ValidationError(`Purchase order line '${receipt.poLineId}' does not belong to PO '${poId}'`);
      }
      before.set(receipt.poLineId, { orderedQty: line.orderedQty, receivedQtyBeforeThisGrn: line.receivedQty });

      if (receipt.receivedQty > 0) {
        await tx.purchaseOrderLine.update({
          where: { id: receipt.poLineId },
          data: { receivedQty: line.receivedQty + receipt.receivedQty },
        });
      }
    }

    const lines = await tx.purchaseOrderLine.findMany({ where: { poId } });
    const fullyReceived = lines.every((l) => l.receivedQty >= l.orderedQty);
    const anyReceived = lines.some((l) => l.receivedQty > 0);
    const nextStatus = fullyReceived ? 'FULLY_RECEIVED' : anyReceived ? 'PARTIALLY_RECEIVED' : undefined;

    if (nextStatus) {
      await tx.purchaseOrder.update({ where: { id: poId }, data: { status: nextStatus } });
    }

    return before;
  }
}
