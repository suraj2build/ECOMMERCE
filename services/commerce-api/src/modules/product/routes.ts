import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { ProductService } from './service.js';

const createStyleSchema = z.object({
  styleCode: z.string().min(1),
  name: z.string().min(1),
  brandId: z.string().uuid(),
  categoryId: z.string().uuid(),
  season: z.string().min(1),
  collection: z.string().min(1),
  department: z.string().optional(),
  gender: z.string().optional(),
  division: z.string().optional(),
  subcategory: z.string().optional(),
  fabric: z.string().optional(),
  fit: z.string().optional(),
  pattern: z.string().optional(),
  occasion: z.string().optional(),
  sleeve: z.string().optional(),
  neck: z.string().optional(),
  washCare: z.string().optional(),
  countryOfOrigin: z.string().optional(),
  hsnCode: z.string().optional(),
  customAttributes: z.record(z.unknown()).optional(),
});

const addColourSchema = z.object({
  name: z.string().min(1),
  colourCode: z.string().min(1),
  hexSwatch: z.string().optional(),
});

const generateSkuMatrixSchema = z.object({ sizeIds: z.array(z.string().uuid()).min(1) });

const addMediaSchema = z.object({
  colourId: z.string().uuid().optional(),
  url: z.string().url(),
  type: z.enum(['IMAGE', 'VIDEO']).optional(),
  sortOrder: z.number().int().optional(),
  altText: z.string().optional(),
  isSwatch: z.boolean().optional(),
});

const createSizeChartSchema = z.object({
  name: z.string().min(1),
  category: z.string().optional(),
  gender: z.string().optional(),
  brandId: z.string().uuid().optional(),
  entries: z.array(z.object({ sizeLabel: z.string(), measurements: z.record(z.unknown()) })).min(1),
});

const bulkCreateSchema = z.object({ styles: z.array(createStyleSchema).min(1).max(1000) });

const productRoutes: FastifyPluginAsync = async (fastify) => {
  const service = new ProductService(fastify);
  const writeAuth = [fastify.requireStaffAuth, fastify.requirePermission('product:write')];
  const readAuth = [fastify.requireStaffAuth, fastify.requirePermission('product:read')];
  const publishAuth = [fastify.requireStaffAuth, fastify.requirePermission('product:publish')];

  fastify.post('/products/styles', { preHandler: writeAuth }, async (request, reply) => {
    const body = createStyleSchema.parse(request.body);
    const style = await service.createStyle(body, request.staffUser!.id);
    reply.status(201).send(style);
  });

  fastify.post('/products/styles/bulk', { preHandler: writeAuth }, async (request, reply) => {
    const { styles } = bulkCreateSchema.parse(request.body);
    const result = await service.bulkCreateStyles(styles, request.staffUser!.id);
    reply.status(207).send(result);
  });

  fastify.get('/products/styles', { preHandler: readAuth }, async (request, reply) => {
    const query = z
      .object({
        lifecycleState: z.string().optional(),
        brandId: z.string().uuid().optional(),
        take: z.coerce.number().int().positive().max(200).optional(),
        skip: z.coerce.number().int().nonnegative().optional(),
      })
      .parse(request.query);
    reply.status(200).send(await service.listStyles(query));
  });

  fastify.get('/products/styles/:id', { preHandler: readAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    reply.status(200).send(await service.getStyle(id));
  });

  fastify.post(
    '/products/styles/:id/colours',
    { preHandler: writeAuth },
    async (request, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const body = addColourSchema.parse(request.body);
      const colour = await service.addColour(id, body, request.staffUser!.id);
      reply.status(201).send(colour);
    },
  );

  fastify.post(
    '/products/styles/:id/skus/generate',
    { preHandler: writeAuth },
    async (request, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const { sizeIds } = generateSkuMatrixSchema.parse(request.body);
      const skus = await service.generateSkuMatrix(id, sizeIds, request.staffUser!.id);
      reply.status(201).send(skus);
    },
  );

  fastify.post('/products/styles/:id/media', { preHandler: writeAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = addMediaSchema.parse(request.body);
    const media = await service.addMedia({ styleId: id, ...body }, request.staffUser!.id);
    reply.status(201).send(media);
  });

  fastify.post('/products/size-charts', { preHandler: writeAuth }, async (request, reply) => {
    const body = createSizeChartSchema.parse(request.body);
    reply.status(201).send(await service.createSizeChart(body));
  });

  // --- Lifecycle transitions ---
  fastify.post(
    '/products/styles/:id/ready-for-enrichment',
    { preHandler: writeAuth },
    async (request, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      reply.status(200).send(await service.moveToReadyForEnrichment(id, request.staffUser!.id));
    },
  );

  fastify.post('/products/styles/:id/qa-check', { preHandler: writeAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    reply.status(200).send(await service.runQaCheck(id, request.staffUser!.id));
  });

  fastify.post('/products/styles/:id/publish', { preHandler: publishAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const result = await service.publish(id, request.staffUser!.id);
    await fastify.searchIndex.indexStyle(id); // M10: newly-publishable styles must be searchable immediately
    reply.status(200).send(result);
  });

  fastify.post('/products/styles/:id/unpublish', { preHandler: publishAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const result = await service.unpublish(id, request.staffUser!.id);
    await fastify.searchIndex.removeStyle(id); // M10: unpublished styles must disappear from search immediately
    reply.status(200).send(result);
  });

  fastify.post('/products/styles/:id/archive', { preHandler: writeAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const result = await service.archive(id, request.staffUser!.id);
    await fastify.searchIndex.removeStyle(id); // M10
    reply.status(200).send(result);
  });
};

export default productRoutes;
