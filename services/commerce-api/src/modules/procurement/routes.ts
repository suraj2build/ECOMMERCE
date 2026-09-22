import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { ProcurementService } from './service.js';

const createPoSchema = z.object({
  supplierId: z.string().uuid(),
  locationId: z.string().uuid(),
  expectedDate: z.coerce.date().optional(),
  lines: z
    .array(
      z.object({
        skuId: z.string().uuid(),
        orderedQty: z.number().int().positive(),
        unitCost: z.number().positive(),
      }),
    )
    .min(1),
});

const commentSchema = z.object({ comment: z.string().optional() });

const procurementRoutes: FastifyPluginAsync = async (fastify) => {
  const service = new ProcurementService(fastify);
  const createAuth = [fastify.requireStaffAuth, fastify.requirePermission('po:create')];
  const submitAuth = [fastify.requireStaffAuth, fastify.requirePermission('po:submit')];
  const approveAuth = [fastify.requireStaffAuth, fastify.requirePermission('po:approve')];
  const readAuth = [fastify.requireStaffAuth, fastify.requirePermission('po:read')];

  fastify.post('/procurement/purchase-orders', { preHandler: createAuth }, async (request, reply) => {
    const body = createPoSchema.parse(request.body);
    reply.status(201).send(await service.createPurchaseOrder(body, request.staffUser!.id));
  });

  fastify.get('/procurement/purchase-orders', { preHandler: readAuth }, async (request, reply) => {
    const query = z
      .object({
        status: z.string().optional(),
        supplierId: z.string().uuid().optional(),
        take: z.coerce.number().int().positive().max(200).optional(),
        skip: z.coerce.number().int().nonnegative().optional(),
      })
      .parse(request.query);
    reply.status(200).send(await service.listPurchaseOrders(query));
  });

  fastify.get('/procurement/purchase-orders/:id', { preHandler: readAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    reply.status(200).send(await service.getPurchaseOrder(id));
  });

  fastify.post(
    '/procurement/purchase-orders/:id/submit',
    { preHandler: submitAuth },
    async (request, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      reply.status(200).send(await service.submitPurchaseOrder(id, request.staffUser!.id));
    },
  );

  fastify.post(
    '/procurement/purchase-orders/:id/approve',
    { preHandler: approveAuth },
    async (request, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const { comment } = commentSchema.parse(request.body ?? {});
      reply.status(200).send(await service.approvePurchaseOrder(id, request.staffUser!.id, comment));
    },
  );

  fastify.post(
    '/procurement/purchase-orders/:id/reject',
    { preHandler: approveAuth },
    async (request, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const { comment } = commentSchema.parse(request.body ?? {});
      reply.status(200).send(await service.rejectPurchaseOrder(id, request.staffUser!.id, comment));
    },
  );

  fastify.post(
    '/procurement/purchase-orders/:id/cancel',
    { preHandler: createAuth },
    async (request, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      reply.status(200).send(await service.cancelPurchaseOrder(id, request.staffUser!.id));
    },
  );
};

export default procurementRoutes;
