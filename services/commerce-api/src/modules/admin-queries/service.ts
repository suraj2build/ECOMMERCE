import type { Prisma, PrismaClient } from '@fcp/db';
import type { PermissionKey } from '@fcp/shared';
import { availableAtLocation } from '../inventory/service.js';
import { THUMBNAIL_MEDIA } from '../catalog/service.js';

/**
 * Read models for the P1 Commerce Operations Console (apps/admin).
 *
 * Every method here is a bounded, read-only projection of data that an
 * existing domain already owns: no writes, no state transitions, no
 * business rules. They exist because operators should find records by
 * business identifiers (SKU code, PO number, supplier name) instead of
 * typing internal UUIDs, and because some queues had no list endpoint.
 * Each is documented in docs/admin/P1_QUERY_ENDPOINTS.md.
 */

const MAX_LOOKUP = 25;
const MAX_PAGE = 100;

export function boundedTake(take: number | undefined, max: number, fallback: number): number {
  return Math.min(Math.max(take ?? fallback, 1), max);
}

const money = (v: Prisma.Decimal | number | string | null | undefined) => (v === null || v === undefined ? null : Number(v));

/** Staff capabilities the co-approver/sign-off pickers can list, and who may list them. */
export const STAFF_CAPABILITIES = {
  'inventory-coapprover': { requires: 'inventory:adjust', holds: 'inventory:adjust:coapprove' },
  'grn-qc-signoff': { requires: 'grn:create', holds: 'grn:qc:manager_signoff' },
  // A pick shortfall posts an inventory adjustment (WarehouseService.recordPickOutcome),
  // so at/above the threshold it needs the same finance co-approver.
  'pick-shortfall-coapprover': { requires: 'warehouse:pick', holds: 'inventory:adjust:coapprove' },
} as const satisfies Record<string, { requires: PermissionKey; holds: PermissionKey }>;
export type StaffCapability = keyof typeof STAFF_CAPABILITIES;

export class AdminQueryService {
  constructor(private readonly prisma: PrismaClient) {}

  async lookupSkus(q: string, take?: number) {
    const term = q.trim();
    const skus = await this.prisma.sku.findMany({
      where: {
        OR: [
          { skuCode: { contains: term, mode: 'insensitive' } },
          { barcode: { equals: term } },
          { style: { styleCode: { contains: term, mode: 'insensitive' } } },
          { style: { name: { contains: term, mode: 'insensitive' } } },
        ],
      },
      select: {
        id: true,
        skuCode: true,
        isActive: true,
        style: { select: { id: true, styleCode: true, name: true, lifecycleState: true } },
        colour: { select: { name: true, colourCode: true } },
        size: { select: { label: true } },
      },
      orderBy: { skuCode: 'asc' },
      take: boundedTake(take, MAX_LOOKUP, 10),
    });
    return skus;
  }

  async lookupStyles(q: string, take?: number) {
    const term = q.trim();
    return this.prisma.style.findMany({
      where: {
        OR: [{ styleCode: { contains: term, mode: 'insensitive' } }, { name: { contains: term, mode: 'insensitive' } }],
      },
      select: { id: true, styleCode: true, name: true, lifecycleState: true },
      orderBy: { styleCode: 'asc' },
      take: boundedTake(take, MAX_LOOKUP, 10),
    });
  }

  /** Paginated style list with the brand/category names and counts a list screen needs. */
  async listStyles(params: { q?: string; lifecycleState?: string; categoryId?: string; gender?: string; take?: number; skip?: number }) {
    const term = params.q?.trim();
    const where: Prisma.StyleWhereInput = {
      ...(params.lifecycleState ? { lifecycleState: params.lifecycleState as never } : {}),
      // Admin Ops Phase 1: owner filters.
      ...(params.categoryId ? { categoryId: params.categoryId } : {}),
      ...(params.gender ? { gender: params.gender } : {}),
      ...(term
        ? { OR: [{ styleCode: { contains: term, mode: 'insensitive' } }, { name: { contains: term, mode: 'insensitive' } }] }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.style.findMany({
        where,
        select: {
          id: true,
          styleCode: true,
          name: true,
          season: true,
          lifecycleState: true,
          publishedAt: true,
          updatedAt: true,
          brand: { select: { name: true } },
          gender: true,
          category: { select: { name: true } },
          // The listing photo, chosen exactly as the storefront chooses it.
          media: { ...THUMBNAIL_MEDIA, select: { url: true } },
          _count: { select: { colours: true, skus: true, media: true } },
        },
        orderBy: { updatedAt: 'desc' },
        take: boundedTake(params.take, MAX_PAGE, 25),
        skip: params.skip ?? 0,
      }),
      this.prisma.style.count({ where }),
    ]);
    return { items, total };
  }

  async lookupSuppliers(q: string, take?: number) {
    const term = q.trim();
    return this.prisma.supplier.findMany({
      where: { OR: [{ code: { contains: term, mode: 'insensitive' } }, { name: { contains: term, mode: 'insensitive' } }] },
      select: { id: true, code: true, name: true, type: true, isActive: true },
      orderBy: { name: 'asc' },
      take: boundedTake(take, MAX_LOOKUP, 10),
    });
  }

  /** Bounded supplier directory (GET /suppliers returns every row). */
  async listSuppliers(params: { q?: string; type?: string; isActive?: boolean; take?: number; skip?: number }) {
    const term = params.q?.trim();
    const where: Prisma.SupplierWhereInput = {
      ...(params.type ? { type: params.type as never } : {}),
      ...(params.isActive !== undefined ? { isActive: params.isActive } : {}),
      ...(term ? { OR: [{ code: { contains: term, mode: 'insensitive' } }, { name: { contains: term, mode: 'insensitive' } }] } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.supplier.findMany({
        where,
        select: {
          id: true,
          code: true,
          name: true,
          type: true,
          contactName: true,
          leadTimeDays: true,
          paymentTerms: true,
          isActive: true,
          createdAt: true,
          _count: { select: { supplierSkus: true, purchaseOrders: true } },
        },
        orderBy: { name: 'asc' },
        take: boundedTake(params.take, MAX_PAGE, 25),
        skip: params.skip ?? 0,
      }),
      this.prisma.supplier.count({ where }),
    ]);
    return { items, total };
  }

  /** SKU cost links for one supplier (written by POST /suppliers/sku-links; no read route existed). */
  async listSupplierSkuLinks(supplierId: string, params: { take?: number; skip?: number }) {
    const where: Prisma.SupplierSkuWhereInput = { supplierId };
    const [rows, total] = await Promise.all([
      this.prisma.supplierSku.findMany({
        where,
        select: {
          id: true,
          cost: true,
          currency: true,
          isPreferred: true,
          createdAt: true,
          sku: { select: { id: true, skuCode: true, colour: { select: { name: true } }, size: { select: { label: true } } } },
          style: { select: { id: true, styleCode: true, name: true } },
        },
        orderBy: { sku: { skuCode: 'asc' } },
        take: boundedTake(params.take, MAX_PAGE, 50),
        skip: params.skip ?? 0,
      }),
      this.prisma.supplierSku.count({ where }),
    ]);
    return { items: rows.map((r) => ({ ...r, cost: money(r.cost) })), total };
  }

  /** The PromotionType reference table (seeded; POST /promotions takes its key). */
  async listPromotionTypes() {
    return this.prisma.promotionType.findMany({ select: { id: true, key: true, name: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }] });
  }

  /** Order search by order number. Contact details stay on the detail route (GET /orders/:id). */
  async listOrders(params: { q?: string; status?: string; invoiceStatus?: string; take?: number; skip?: number }) {
    const term = params.q?.trim();
    const where: Prisma.OrderWhereInput = {
      ...(params.status ? { status: params.status as never } : {}),
      ...(params.invoiceStatus ? { invoiceStatus: params.invoiceStatus as never } : {}),
      ...(term ? { orderNumber: { contains: term, mode: 'insensitive' } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        select: {
          id: true,
          orderNumber: true,
          status: true,
          paymentMethod: true,
          grandTotal: true,
          currency: true,
          invoiceStatus: true,
          refundRequired: true,
          createdAt: true,
          _count: { select: { lines: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: boundedTake(params.take, MAX_PAGE, 25),
        skip: params.skip ?? 0,
      }),
      this.prisma.order.count({ where }),
    ]);
    return { items: rows.map((r) => ({ ...r, grandTotal: money(r.grandTotal) })), total };
  }

  /** Fulfilment queue (pack / ready-to-ship / ship / deliver work), order- and exchange-sourced alike. */
  async listFulfilments(params: { status?: string; take?: number; skip?: number }) {
    const where: Prisma.OrderFulfilmentWhereInput = params.status ? { status: params.status as never } : {};
    const [items, total] = await Promise.all([
      this.prisma.orderFulfilment.findMany({
        where,
        select: {
          id: true,
          orderId: true,
          exchangeId: true,
          status: true,
          carrierName: true,
          trackingRef: true,
          packedAt: true,
          shippedAt: true,
          deliveredAt: true,
          createdAt: true,
          order: { select: { orderNumber: true } },
          exchange: { select: { exchangeNumber: true } },
          shipment: { select: { id: true, provider: true, status: true, trackingRef: true, deliveryAttempts: true, maxDeliveryAttempts: true } },
          _count: { select: { lines: true } },
        },
        orderBy: { createdAt: 'asc' },
        take: boundedTake(params.take, MAX_PAGE, 50),
        skip: params.skip ?? 0,
      }),
      this.prisma.orderFulfilment.count({ where }),
    ]);
    return { items, total };
  }

  /** Staff who hold `holds`, for the co-approver / sign-off pickers. Identity only - never credentials. */
  async lookupStaffWithPermission(holds: PermissionKey, excludeStaffId: string) {
    return this.prisma.staffUser.findMany({
      where: {
        isActive: true,
        id: { not: excludeStaffId },
        roles: { some: { role: { permissions: { some: { permission: { key: holds } } } } } },
      },
      select: { id: true, fullName: true },
      orderBy: { fullName: 'asc' },
      take: MAX_LOOKUP,
    });
  }

  async listPurchaseOrders(params: { q?: string; status?: string; supplierId?: string; take?: number; skip?: number }) {
    const term = params.q?.trim();
    const where: Prisma.PurchaseOrderWhereInput = {
      ...(params.status ? { status: params.status as never } : {}),
      ...(params.supplierId ? { supplierId: params.supplierId } : {}),
      ...(term
        ? {
            OR: [
              { poNumber: { contains: term, mode: 'insensitive' } },
              { supplier: { name: { contains: term, mode: 'insensitive' } } },
              { supplier: { code: { contains: term, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.purchaseOrder.findMany({
        where,
        select: {
          id: true,
          poNumber: true,
          status: true,
          totalCost: true,
          currency: true,
          expectedDate: true,
          createdAt: true,
          supplier: { select: { id: true, code: true, name: true } },
          location: { select: { id: true, code: true, name: true } },
          _count: { select: { lines: true, goodsReceipts: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: boundedTake(params.take, MAX_PAGE, 25),
        skip: params.skip ?? 0,
      }),
      this.prisma.purchaseOrder.count({ where }),
    ]);
    return { items: rows.map((r) => ({ ...r, totalCost: money(r.totalCost) })), total };
  }

  /**
   * A PO's lines with SKU descriptions, plus approval history with approver
   * names. GET /procurement/purchase-orders/:id returns bare SKU and staff
   * ids, and an approver (po:read) may not hold product:read.
   */
  async getPurchaseOrderLines(poId: string) {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id: poId },
      select: {
        id: true,
        submittedBy: { select: { id: true, fullName: true } },
        approvedBy: { select: { id: true, fullName: true } },
        lines: {
          select: {
            id: true,
            skuId: true,
            orderedQty: true,
            receivedQty: true,
            unitCost: true,
            sku: { select: { skuCode: true, style: { select: { name: true } }, colour: { select: { name: true } }, size: { select: { label: true } } } },
          },
          orderBy: { sku: { skuCode: 'asc' } },
        },
        approvals: {
          select: { id: true, action: true, comment: true, createdAt: true, staff: { select: { id: true, fullName: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!po) return null;
    return { ...po, lines: po.lines.map((l) => ({ ...l, unitCost: money(l.unitCost) })) };
  }

  /** Stock positions across SKUs/locations. `available` uses the inventory domain's own definition. */
  async listStock(params: { q?: string; locationId?: string; skuId?: string; take?: number; skip?: number }) {
    const term = params.q?.trim();
    const where: Prisma.InventoryBalanceWhereInput = {
      ...(params.locationId ? { locationId: params.locationId } : {}),
      ...(params.skuId ? { skuId: params.skuId } : {}),
      ...(term
        ? {
            sku: {
              OR: [
                { skuCode: { contains: term, mode: 'insensitive' } },
                { style: { styleCode: { contains: term, mode: 'insensitive' } } },
                { style: { name: { contains: term, mode: 'insensitive' } } },
              ],
            },
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.inventoryBalance.findMany({
        where,
        include: {
          sku: {
            select: {
              id: true,
              skuCode: true,
              style: { select: { id: true, styleCode: true, name: true } },
              colour: { select: { name: true } },
              size: { select: { label: true } },
            },
          },
          location: { select: { id: true, code: true, name: true } },
        },
        orderBy: [{ sku: { skuCode: 'asc' } }, { locationId: 'asc' }],
        take: boundedTake(params.take, MAX_PAGE, 50),
        skip: params.skip ?? 0,
      }),
      this.prisma.inventoryBalance.count({ where }),
    ]);
    return {
      items: rows.map((r) => ({
        skuId: r.skuId,
        locationId: r.locationId,
        sku: r.sku,
        location: r.location,
        onHand: r.onHand,
        reserved: r.reserved,
        damaged: r.damaged,
        returnPending: r.returnPending,
        inTransit: r.inTransit,
        available: availableAtLocation(r),
        updatedAt: r.updatedAt,
      })),
      total,
    };
  }

  async listTransfers(params: { status?: string; take?: number; skip?: number }) {
    const where: Prisma.InventoryTransferWhereInput = params.status ? { status: params.status as never } : {};
    const [items, total] = await Promise.all([
      this.prisma.inventoryTransfer.findMany({
        where,
        include: {
          sku: { select: { id: true, skuCode: true, style: { select: { name: true } } } },
          fromLocation: { select: { id: true, code: true, name: true } },
          toLocation: { select: { id: true, code: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: boundedTake(params.take, MAX_PAGE, 50),
        skip: params.skip ?? 0,
      }),
      this.prisma.inventoryTransfer.count({ where }),
    ]);
    return { items, total };
  }

  async listRefunds(params: { status?: string; take?: number; skip?: number }) {
    const where: Prisma.RefundWhereInput = params.status ? { status: params.status as never } : {};
    const [rows, total] = await Promise.all([
      this.prisma.refund.findMany({
        where,
        select: {
          id: true,
          orderId: true,
          orderLineId: true,
          returnLineId: true,
          triggerType: true,
          method: true,
          amount: true,
          status: true,
          failureReason: true,
          processedAt: true,
          createdAt: true,
          updatedAt: true,
          order: { select: { orderNumber: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: boundedTake(params.take, MAX_PAGE, 50),
        skip: params.skip ?? 0,
      }),
      this.prisma.refund.count({ where }),
    ]);
    return { items: rows.map((r) => ({ ...r, amount: money(r.amount) })), total };
  }

  /** Gift cards by status or the last four characters of the code. Never the code or its hash. */
  async listGiftCards(params: { status?: string; last4?: string; take?: number; skip?: number }) {
    const where: Prisma.GiftCardWhereInput = {
      ...(params.status ? { status: params.status as never } : {}),
      ...(params.last4 ? { codeLast4: params.last4.trim().toUpperCase() } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.giftCard.findMany({
        where,
        select: {
          id: true,
          codeLast4: true,
          status: true,
          initialValue: true,
          balance: true,
          currency: true,
          issuedAt: true,
          expiresAt: true,
          disabledAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: boundedTake(params.take, MAX_PAGE, 50),
        skip: params.skip ?? 0,
      }),
      this.prisma.giftCard.count({ where }),
    ]);
    return { items: rows.map((r) => ({ ...r, initialValue: money(r.initialValue), balance: money(r.balance) })), total };
  }

  async listCollections(params: { take?: number; skip?: number } = {}) {
    const rows = await this.prisma.collection.findMany({
      select: { id: true, name: true, slug: true, description: true, isActive: true, createdAt: true, _count: { select: { styles: true } } },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: boundedTake(params.take, MAX_PAGE, 50),
      skip: params.skip ?? 0,
    });
    return { items: rows, total: await this.prisma.collection.count() };
  }

  async getCollection(id: string, params: { take?: number; skip?: number } = {}) {
    return this.prisma.collection.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        isActive: true,
        createdAt: true,
        _count: { select: { styles: true } },
        styles: { select: { style: { select: { id: true, styleCode: true, name: true, lifecycleState: true } } }, orderBy: { styleId: 'asc' }, take: boundedTake(params.take, MAX_PAGE, 50), skip: params.skip ?? 0 },
      },
    });
  }

  /** id -> label resolution for screens that receive bare ids (analytics, queues). */
  async resolveLabels(ids: {
    styleIds?: string[];
    skuIds?: string[];
    colourIds?: string[];
    sizeIds?: string[];
    supplierIds?: string[];
    locationIds?: string[];
    orderIds?: string[];
    purchaseOrderIds?: string[];
  }) {
    const has = (a?: string[]) => (a && a.length > 0 ? a : null);
    const [styles, skus, colours, sizes, suppliers, locations, orders, pos] = await Promise.all([
      has(ids.styleIds) ? this.prisma.style.findMany({ where: { id: { in: ids.styleIds } }, select: { id: true, styleCode: true, name: true } }) : [],
      has(ids.skuIds) ? this.prisma.sku.findMany({ where: { id: { in: ids.skuIds } }, select: { id: true, skuCode: true } }) : [],
      has(ids.colourIds) ? this.prisma.colour.findMany({ where: { id: { in: ids.colourIds } }, select: { id: true, name: true } }) : [],
      has(ids.sizeIds) ? this.prisma.size.findMany({ where: { id: { in: ids.sizeIds } }, select: { id: true, label: true } }) : [],
      has(ids.supplierIds) ? this.prisma.supplier.findMany({ where: { id: { in: ids.supplierIds } }, select: { id: true, code: true, name: true } }) : [],
      has(ids.locationIds) ? this.prisma.location.findMany({ where: { id: { in: ids.locationIds } }, select: { id: true, code: true, name: true } }) : [],
      has(ids.orderIds) ? this.prisma.order.findMany({ where: { id: { in: ids.orderIds } }, select: { id: true, orderNumber: true } }) : [],
      has(ids.purchaseOrderIds) ? this.prisma.purchaseOrder.findMany({ where: { id: { in: ids.purchaseOrderIds } }, select: { id: true, poNumber: true } }) : [],
    ]);
    const map = <T extends { id: string }>(rows: T[], label: (r: T) => string) => Object.fromEntries(rows.map((r) => [r.id, label(r)]));
    return {
      styles: map(styles, (r) => `${r.styleCode} · ${r.name}`),
      skus: map(skus, (r) => r.skuCode),
      colours: map(colours, (r) => r.name),
      sizes: map(sizes, (r) => r.label),
      suppliers: map(suppliers, (r) => `${r.name} (${r.code})`),
      locations: map(locations, (r) => `${r.name} (${r.code})`),
      orders: map(orders, (r) => r.orderNumber),
      purchaseOrders: map(pos, (r) => r.poNumber),
    };
  }

  /**
   * Workload counts for the dashboard. Only sections the caller may read
   * are computed; each count is a plain COUNT over existing statuses.
   */
  async workload(permissions: Set<PermissionKey>) {
    const out: Record<string, Record<string, number>> = {};
    const p = this.prisma;
    const tasks: Promise<void>[] = [];
    const section = (key: string, perm: PermissionKey, counts: Record<string, Promise<number>>) => {
      if (!permissions.has(perm)) return;
      tasks.push(
        (async () => {
          const entries = await Promise.all(Object.entries(counts).map(async ([k, v]) => [k, await v] as const));
          out[key] = Object.fromEntries(entries);
        })(),
      );
    };
    section('orders', 'order:read', {
      confirmed: p.order.count({ where: { status: 'CONFIRMED' } }),
      processing: p.order.count({ where: { status: 'PROCESSING' } }),
      exception: p.order.count({ where: { status: 'EXCEPTION' } }),
      invoiceFailed: p.order.count({ where: { invoiceStatus: 'FAILED' } }),
    });
    section('warehouse', 'warehouse:read', {
      pendingPicks: p.pickTask.count({ where: { status: 'PENDING' } }),
      pickExceptions: p.pickTask.count({ where: { status: { in: ['EXCEPTION', 'SHORT_PICKED'] } } }),
    });
    section('returns', 'return:read', {
      requested: p.return.count({ where: { status: 'REQUESTED' } }),
      inTransit: p.return.count({ where: { status: { in: ['PICKUP_SCHEDULED', 'PICKED_UP'] } } }),
      awaitingQc: p.return.count({ where: { status: 'RECEIVED' } }),
    });
    section('exchanges', 'exchange:read', {
      open: p.exchange.count({ where: { status: { in: ['REQUESTED', 'PICKUP_SCHEDULED', 'PICKED_UP', 'RECEIVED'] } } }),
      replacementAllocated: p.exchange.count({ where: { status: 'REPLACEMENT_ALLOCATED' } }),
    });
    section('refunds', 'payment:refund', {
      pending: p.refund.count({ where: { status: { in: ['PENDING', 'PROCESSING'] } } }),
      failed: p.refund.count({ where: { status: 'FAILED' } }),
    });
    section('procurement', 'po:read', {
      awaitingApproval: p.purchaseOrder.count({ where: { status: 'SUBMITTED' } }),
      awaitingReceipt: p.purchaseOrder.count({ where: { status: { in: ['APPROVED', 'PARTIALLY_RECEIVED'] } } }),
    });
    section('inventory', 'inventory:read', {
      transfersInTransit: p.inventoryTransfer.count({ where: { status: 'IN_TRANSIT' } }),
    });
    await Promise.all(tasks);
    return out;
  }
}
