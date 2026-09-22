import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { SupplierService } from './service.js';

const createSupplierSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(['FINISHED_GOODS', 'MANUFACTURING']),
  contactName: z.string().optional(),
  contactEmail: z.string().email().optional(),
  contactPhone: z.string().optional(),
  paymentTerms: z.string().optional(),
  leadTimeDays: z.number().int().nonnegative().optional(),
});

const linkSkuSchema = z.object({
  supplierId: z.string().uuid(),
  skuId: z.string().uuid(),
  styleId: z.string().uuid(),
  cost: z.number().positive(),
  currency: z.string().optional(),
  isPreferred: z.boolean().optional(),
});

const supplierRoutes: FastifyPluginAsync = async (fastify) => {
  const service = new SupplierService(fastify);
  const writeAuth = [fastify.requireStaffAuth, fastify.requirePermission('supplier:write')];
  const readAuth = [fastify.requireStaffAuth, fastify.requirePermission('supplier:read')];

  fastify.post('/suppliers', { preHandler: writeAuth }, async (request, reply) => {
    const body = createSupplierSchema.parse(request.body);
    reply.status(201).send(await service.createSupplier(body, request.staffUser!.id));
  });

  fastify.get('/suppliers', { preHandler: readAuth }, async (request, reply) => {
    const query = z
      .object({ type: z.string().optional(), isActive: z.coerce.boolean().optional() })
      .parse(request.query);
    reply.status(200).send(await service.listSuppliers(query));
  });

  fastify.get('/suppliers/:id', { preHandler: readAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    reply.status(200).send(await service.getSupplier(id));
  });

  fastify.post('/suppliers/sku-links', { preHandler: writeAuth }, async (request, reply) => {
    const body = linkSkuSchema.parse(request.body);
    reply.status(201).send(await service.linkSupplierSku(body, request.staffUser!.id));
  });

  fastify.post(
    '/suppliers/:id/deactivate',
    { preHandler: writeAuth },
    async (request, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      reply.status(200).send(await service.deactivateSupplier(id, request.staffUser!.id));
    },
  );
};

export default supplierRoutes;
