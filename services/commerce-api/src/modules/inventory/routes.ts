import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { InventoryService } from './service.js';
import { ApprovalPolicyService, selfApprovalSchema } from '../approvals/service.js';

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
   * co-approver at/above the threshold; the approval policy (AO-D4,
   * ApprovalPolicyService.decide) checks the named co-approver holds
   * `inventory:adjust:coapprove` and is someone else - or, under owner
   * approval, is the requester confirming with a reason and password.
   */
  fastify.post('/inventory/adjustments', { preHandler: adjustAuth }, async (request, reply) => {
    const { selfApproval, ...body } = adjustSchema.extend({ selfApproval: selfApprovalSchema.optional() }).parse(request.body);
    const approval = body.coApproverStaffId
      ? await approvals.decide({
          kind: 'STOCK_ADJUSTMENT',
          requestedByStaffId: request.staffUser!.id,
          approverStaffId: body.coApproverStaffId,
          permission: 'inventory:adjust:coapprove',
          selfApproval,
        })
      : undefined;

    const result = await service.postAdjustment({ ...body, actorStaffId: request.staffUser!.id, approval });
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
