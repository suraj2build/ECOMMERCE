import type { FastifyInstance } from 'fastify';
import { NotFoundError } from '@fcp/shared';
import { recordAudit } from '../audit/service.js';

export interface CreateSupplierInput {
  code: string;
  name: string;
  type: 'FINISHED_GOODS' | 'MANUFACTURING';
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  paymentTerms?: string;
  leadTimeDays?: number;
}

/**
 * Suppliers (M03, specs/03-suppliers-procurement.md). Both
 * finished-merchandise suppliers and manufacturing/job-work suppliers
 * flow through the same entity, distinguished by `type` - no separate
 * BOM/production-planning system (explicitly out of V1 scope).
 */
export class SupplierService {
  constructor(private readonly fastify: FastifyInstance) {}

  private get prisma() {
    return this.fastify.prisma;
  }

  async createSupplier(input: CreateSupplierInput, actorStaffId: string) {
    const supplier = await this.prisma.supplier.create({ data: input });
    await recordAudit(this.prisma, {
      actorType: 'STAFF',
      actorStaffId,
      action: 'supplier.create',
      entityType: 'Supplier',
      entityId: supplier.id,
      newValue: input,
    });
    return supplier;
  }

  async getSupplier(id: string) {
    const supplier = await this.prisma.supplier.findUnique({ where: { id } });
    if (!supplier) throw new NotFoundError('Supplier', id);
    return supplier;
  }

  async listSuppliers(params: { type?: string; isActive?: boolean }) {
    return this.prisma.supplier.findMany({
      where: { type: params.type as never, isActive: params.isActive },
      orderBy: { name: 'asc' },
    });
  }

  async linkSupplierSku(
    input: { supplierId: string; skuId: string; styleId: string; cost: number; currency?: string; isPreferred?: boolean },
    actorStaffId: string,
  ) {
    await this.getSupplier(input.supplierId);
    const link = await this.prisma.supplierSku.upsert({
      where: { supplierId_skuId: { supplierId: input.supplierId, skuId: input.skuId } },
      update: { cost: input.cost, currency: input.currency ?? 'INR', isPreferred: input.isPreferred ?? false },
      create: {
        supplierId: input.supplierId,
        skuId: input.skuId,
        styleId: input.styleId,
        cost: input.cost,
        currency: input.currency ?? 'INR',
        isPreferred: input.isPreferred ?? false,
      },
    });
    await recordAudit(this.prisma, {
      actorType: 'STAFF',
      actorStaffId,
      action: 'supplier_sku.link',
      entityType: 'SupplierSku',
      entityId: link.id,
      newValue: input,
    });
    return link;
  }

  async deactivateSupplier(id: string, actorStaffId: string) {
    const supplier = await this.getSupplier(id);
    const openPoCount = await this.prisma.purchaseOrder.count({
      where: { supplierId: id, status: { in: ['DRAFT', 'SUBMITTED', 'APPROVED', 'PARTIALLY_RECEIVED'] } },
    });
    if (openPoCount > 0) {
      // Warned/blocked as documented in acceptance/m03-suppliers.md - we
      // block rather than silently allow a dangling active PO reference.
      throw new Error(`Cannot deactivate supplier with ${openPoCount} open purchase order(s)`);
    }
    const updated = await this.prisma.supplier.update({ where: { id }, data: { isActive: false } });
    await recordAudit(this.prisma, {
      actorType: 'STAFF',
      actorStaffId,
      action: 'supplier.deactivate',
      entityType: 'Supplier',
      entityId: id,
      oldValue: { isActive: supplier.isActive },
      newValue: { isActive: false },
    });
    return updated;
  }
}
