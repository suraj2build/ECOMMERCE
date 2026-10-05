import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { InventoryService } from './service.js';
import { ConflictError, NotFoundError } from '@fcp/shared';
import { ApprovalPolicyService, selfApprovalSchema } from '../approvals/service.js';
import { ApprovalQueueService } from '../approvals/queue.js';

const reserveSchema = z.object({
  skuId: z.string().uuid(),
  locationId: z.string().uuid(),
  quantity: z.number().int().positive(),
  referenceType: z.string().optional(),
  referenceId: z.string().optional(),
  idempotencyKey: z.string().min(1),
  ttlSeconds: z.number().int().positive().optional(),
});

const adjustSchema = z.object({
  skuId: z.string().uuid(),
  locationId: z.string().uuid(),
  quantityDelta: z.number().int().refine((n) => n !== 0, 'quantityDelta cannot be zero'),
  reason: z.string().min(1),
  coApproverStaffId: z.string().uuid().optional(),
  idempotencyKey: z.string().trim().min(1),
});

const transferOutSchema = z.object({
  skuId: z.string().uuid(),
  fromLocationId: z.string().uuid(),
  toLocationId: z.string().uuid(),
  quantity: z.number().int().positive(),
});

const inventoryRoutes: FastifyPluginAsync = async (fastify) => {
  const service = new InventoryService(fastify);
  const approvals = new ApprovalPolicyService(fastify.prisma);
  const readAuth = [fastify.requireStaffAuth, fastify.requirePermission('inventory:read')];
  const reserveAuth = [fastify.requireStaffAuth, fastify.requirePermission('inventory:reserve')];
  const adjustAuth = [fastify.requireStaffAuth, fastify.requirePermission('inventory:adjust')];
  const transferAuth = [fastify.requireStaffAuth, fastify.requirePermission('inventory:transfer')];

  fastify.get(
    '/inventory/balance',
    { preHandler: readAuth },
    async (request, reply) => {
      const { skuId, locationId } = z
        .object({ skuId: z.string().uuid(), locationId: z.string().uuid() })
        .parse(request.query);
      reply.status(200).send(await service.getBalance(skuId, locationId));
    },
  );

  fastify.post('/inventory/reserve', { preHandler: reserveAuth }, async (request, reply) => {
    const body = reserveSchema.parse(request.body);
    const result = await service.reserve(body);
    await fastify.searchIndex.indexStyleForSku(body.skuId); // M10: reservation reduces available-for-sale
    reply.status(201).send(result);
  });

  fastify.post(
    '/inventory/reservations/:id/release',
    { preHandler: reserveAuth },
    async (request, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const { reason } = z.object({ reason: z.string().optional() }).parse(request.body ?? {});
      const result = await service.releaseReservation(id, reason);
      await fastify.searchIndex.indexStyleForSku(result.skuId); // M10: release increases available-for-sale
      reply.status(200).send(result);
    },
  );

  fastify.post(
    '/inventory/reservations/expire-stale',
    { preHandler: reserveAuth },
    async (_request, reply) => {
      const count = await service.expireStaleReservations();
      reply.status(200).send({ expired: count });
    },
  );

  /**
   * Co-approval threshold enforcement (ADM-003): the service requires a
   * co-approver at/above the threshold. Naming someone else does not
   * approve anything: the adjustment waits, unposted, until that person
   * approves it from their own login (approvals/queue.ts; 202 with the
   * request). Naming yourself is owner approval (AO-D4): only when it is
   * switched on, with a reason and your password, posted immediately.
   */
  fastify.post('/inventory/adjustments', { preHandler: adjustAuth }, async (request, reply) => {
    const { selfApproval, ...body } = adjustSchema.extend({ selfApproval: selfApprovalSchema.optional() }).parse(request.body);
    const me = request.staffUser!.id;

    if (body.coApproverStaffId && body.coApproverStaffId !== me) {
      const [sku, location, balance, used] = await Promise.all([
        fastify.prisma.sku.findUnique({ where: { id: body.skuId }, select: { skuCode: true, style: { select: { name: true } }, colour: { select: { name: true } }, size: { select: { label: true } } } }),
        fastify.prisma.location.findUnique({ where: { id: body.locationId }, select: { name: true } }),
        fastify.prisma.inventoryBalance.findUnique({ where: { skuId_locationId: { skuId: body.skuId, locationId: body.locationId } }, select: { onHand: true } }),
        fastify.prisma.inventoryTransaction.findUnique({ where: { idempotencyKey: body.idempotencyKey }, select: { id: true } }),
      ]);
      if (!sku) throw new NotFoundError('Sku', body.skuId);
      if (!location) throw new NotFoundError('Location', body.locationId);
      if (used) throw new ConflictError('This adjustment has already been posted');
      const { coApproverStaffId, ...payload } = body;
      const pendingApproval = await new ApprovalQueueService(fastify).request({
        kind: 'STOCK_ADJUSTMENT',
        requestedByStaffId: me,
        approverStaffId: coApproverStaffId,
        payload,
        summary: {
          skuCode: sku.skuCode,
          item: `${sku.style.name} · ${sku.colour.name} · ${sku.size.label}`,
          location: location.name,
          quantityDelta: body.quantityDelta,
          onHandWhenRequested: balance?.onHand ?? 0,
          reason: body.reason,
        },
        subjectKey: `adjustment:${body.idempotencyKey}`,
      });
      reply.status(202).send({ pendingApproval });
      return;
    }

    const approval = body.coApproverStaffId
      ? await approvals.decide({
          kind: 'STOCK_ADJUSTMENT',
          requestedByStaffId: me,
          approverStaffId: body.coApproverStaffId,
          actingStaffId: me,
          permission: 'inventory:adjust:coapprove',
          selfApproval,
        })
      : undefined;

    const result = await service.postAdjustment({ ...body, actorStaffId: me, approval });
    await fastify.searchIndex.indexStyleForSku(body.skuId); // M10
    reply.status(201).send(result);
  });

  fastify.post('/inventory/transfers/out', { preHandler: transferAuth }, async (request, reply) => {
    const body = transferOutSchema.parse(request.body);
    const result = await service.transferOut({ ...body, actorStaffId: request.staffUser!.id });
    await fastify.searchIndex.indexStyleForSku(body.skuId); // M10: source location's availability drops
    reply.status(201).send(result);
  });

  fastify.post(
    '/inventory/transfers/:id/in',
    { preHandler: transferAuth },
    async (request, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const result = await service.transferIn(id, request.staffUser!.id);
      await fastify.searchIndex.indexStyleForSku(result.skuId); // M10: destination location's availability rises
      reply.status(200).send(result);
    },
  );

  fastify.get(
    '/inventory/reconcile',
    { preHandler: readAuth },
    async (request, reply) => {
      const { skuId, locationId } = z
        .object({ skuId: z.string().uuid(), locationId: z.string().uuid() })
        .parse(request.query);
      reply.status(200).send(await service.reconcileBalance(skuId, locationId));
    },
  );
};

export default inventoryRoutes;
