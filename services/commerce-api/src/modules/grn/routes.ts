import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { GrnService } from './service.js';

const createGrnSchema = z.object({
  poId: z.string().uuid(),
  locationId: z.string().uuid(),
  managerSignoffStaffId: z.string().uuid().optional(),
  lines: z
    .array(
      z.object({
        poLineId: z.string().uuid(),
        skuId: z.string().uuid(),
        receivedQty: z.number().int().nonnegative(),
        acceptedQty: z.number().int().nonnegative(),
        damagedQty: z.number().int().nonnegative(),
        rejectedQty: z.number().int().nonnegative(),
        qcNotes: z.string().optional(),
      }),
    )
    .min(1),
});

const grnRoutes: FastifyPluginAsync = async (fastify) => {
  const service = new GrnService(fastify);
  const createAuth = [fastify.requireStaffAuth, fastify.requirePermission('grn:create')];
  const readAuth = [fastify.requireStaffAuth, fastify.requirePermission('grn:read')];

  fastify.post('/grn', { preHandler: createAuth }, async (request, reply) => {
    const body = createGrnSchema.parse(request.body);
    const result = await service.createGoodsReceipt(body, request.staffUser!.id);
    // M10: accepted stock changes availability for every distinct SKU on the GRN.
    const distinctSkuIds = [...new Set(body.lines.map((line) => line.skuId))];
    for (const skuId of distinctSkuIds) {
      await fastify.searchIndex.indexStyleForSku(skuId);
    }
    reply.status(201).send(result);
  });

  fastify.get('/grn', { preHandler: readAuth }, async (request, reply) => {
    const query = z
      .object({
        poId: z.string().uuid().optional(),
        take: z.coerce.number().int().positive().max(200).optional(),
        skip: z.coerce.number().int().nonnegative().optional(),
      })
      .parse(request.query);
    reply.status(200).send(await service.listGoodsReceipts(query));
  });

  fastify.get('/grn/:id', { preHandler: readAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    reply.status(200).send(await service.getGoodsReceipt(id));
  });
};

export default grnRoutes;
