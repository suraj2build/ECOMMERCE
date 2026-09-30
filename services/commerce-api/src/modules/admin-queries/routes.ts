import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { PermissionKey } from '@fcp/shared';
import { ForbiddenError, NotFoundError } from '@fcp/shared';
import { recordAudit } from '../audit/service.js';
import { AdminQueryService, STAFF_CAPABILITIES } from './service.js';

/**
 * Read-only query endpoints for the P1 Commerce Operations Console. Each
 * is gated by the permission that already guards the same data elsewhere
 * (e.g. SKU lookup = product:read, stock = inventory:read, refunds =
 * payment:refund, gift cards = giftcard:read). See
 * docs/admin/P1_QUERY_ENDPOINTS.md.
 */

const lookupQuery = z.object({ q: z.string().trim().min(1).max(100), take: z.coerce.number().int().positive().optional() });
const page = {
  take: z.coerce.number().int().positive().optional(),
  skip: z.coerce.number().int().nonnegative().optional(),
};
const idList = z
  .string()
  .optional()
  .transform((v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined))
  .pipe(z.array(z.string().uuid()).max(200).optional());

const adminQueryRoutes: FastifyPluginAsync = async (fastify) => {
  const service = new AdminQueryService(fastify.prisma);
  const auth = (permission: PermissionKey) => ({ preHandler: [fastify.requireStaffAuth, fastify.requirePermission(permission)] });
  const staffOnly = { preHandler: [fastify.requireStaffAuth] };

  /** Same denial contract as requirePermission (403 + authz.denied audit row), for per-request checks. */
  async function assertPermission(request: FastifyRequest, permission: PermissionKey) {
    if (request.staffUser!.permissions.has(permission)) return;
    await recordAudit(fastify.prisma, {
      actorType: 'STAFF',
      actorStaffId: request.staffUser!.id,
      action: 'authz.denied',
      entityType: 'Permission',
      entityId: permission,
      reference: request.url,
    }).catch(() => undefined);
    throw new ForbiddenError(`Missing required permission: ${permission}`);
  }

  fastify.get('/admin/lookup/skus', auth('product:read'), async (request) => {
    const { q, take } = lookupQuery.parse(request.query);
    return service.lookupSkus(q, take);
  });

  fastify.get('/admin/lookup/styles', auth('product:read'), async (request) => {
    const { q, take } = lookupQuery.parse(request.query);
    return service.lookupStyles(q, take);
  });

  fastify.get('/admin/lookup/suppliers', auth('supplier:read'), async (request) => {
    const { q, take } = lookupQuery.parse(request.query);
    return service.lookupSuppliers(q, take);
  });

  // Co-approver / sign-off pickers. The caller must hold the action the
  // picker serves; the list holds only active staff who carry the
  // approving permission, identity only (id, full name).
  fastify.get('/admin/lookup/staff', staffOnly, async (request) => {
    const { capability } = z.object({ capability: z.enum(Object.keys(STAFF_CAPABILITIES) as [keyof typeof STAFF_CAPABILITIES]) }).parse(request.query);
    const { requires, holds } = STAFF_CAPABILITIES[capability];
    await assertPermission(request, requires);
    return service.lookupStaffWithPermission(holds, request.staffUser!.id);
  });

  // Each id group is authorized by the permission that guards that entity.
  fastify.get('/admin/lookup/labels', staffOnly, async (request) => {
    const q = z
      .object({
        styleIds: idList,
        skuIds: idList,
        colourIds: idList,
        sizeIds: idList,
        supplierIds: idList,
        locationIds: idList,
        orderIds: idList,
        purchaseOrderIds: idList,
      })
      .parse(request.query);
    if (q.styleIds || q.skuIds || q.colourIds || q.sizeIds) await assertPermission(request, 'product:read');
    if (q.supplierIds) await assertPermission(request, 'supplier:read');
    if (q.orderIds) await assertPermission(request, 'order:read');
    if (q.purchaseOrderIds) await assertPermission(request, 'po:read');
    // locations: readable by any authenticated staff member (GET /organization/locations).
    return service.resolveLabels(q);
  });

  fastify.get('/admin/products/styles', auth('product:read'), async (request) => {
    const q = z.object({ q: z.string().trim().max(100).optional(), lifecycleState: z.string().optional(), ...page }).parse(request.query);
    return service.listStyles(q);
  });

  fastify.get('/admin/purchase-orders', auth('po:read'), async (request) => {
    const q = z
      .object({ q: z.string().trim().max(100).optional(), status: z.string().optional(), supplierId: z.string().uuid().optional(), ...page })
      .parse(request.query);
    return service.listPurchaseOrders(q);
  });

  fastify.get('/admin/inventory/stock', auth('inventory:read'), async (request) => {
    const q = z
      .object({ q: z.string().trim().max(100).optional(), locationId: z.string().uuid().optional(), skuId: z.string().uuid().optional(), ...page })
      .parse(request.query);
    return service.listStock(q);
  });

  fastify.get('/admin/inventory/transfers', auth('inventory:read'), async (request) => {
    const q = z.object({ status: z.enum(['IN_TRANSIT', 'COMPLETED', 'CANCELLED']).optional(), ...page }).parse(request.query);
    return service.listTransfers(q);
  });

  fastify.get('/admin/refunds', auth('payment:refund'), async (request) => {
    const q = z.object({ status: z.enum(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED']).optional(), ...page }).parse(request.query);
    return service.listRefunds(q);
  });

  fastify.get('/admin/gift-cards', auth('giftcard:read'), async (request) => {
    const q = z
      .object({
        status: z.enum(['ACTIVE', 'DISABLED', 'DEPLETED']).optional(),
        last4: z.string().trim().length(4).optional(),
        ...page,
      })
      .parse(request.query);
    return service.listGiftCards(q);
  });

  fastify.get('/admin/catalog/collections', auth('product:read'), async () => service.listCollections());

  fastify.get('/admin/catalog/collections/:id', auth('product:read'), async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const collection = await service.getCollection(id);
    if (!collection) throw new NotFoundError('Collection', id);
    return collection;
  });

  fastify.get('/admin/dashboard/workload', staffOnly, async (request) => service.workload(request.staffUser!.permissions));
};

export default adminQueryRoutes;
