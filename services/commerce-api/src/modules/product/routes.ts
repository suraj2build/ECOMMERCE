import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { loadEnv } from '@fcp/config';
import { ValidationError } from '@fcp/shared';
import { ProductService } from './service.js';
import { ProductReadinessService } from './readiness.js';
import { ProductMediaService } from './media-service.js';
import { IMPORT_COLUMNS, ImportService, summarise, type ImportColumn } from './import-service.js';

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

// Admin Ops Phase 1 - editing. Left out = unchanged; null = clear (optional fields only).
const optionalText = z.string().max(500).nullable().optional();
const updateStyleSchema = z
  .object({
    name: z.string().max(300).optional(),
    season: z.string().max(100).optional(),
    collection: z.string().max(200).optional(),
    brandId: z.string().uuid().optional(),
    categoryId: z.string().uuid().optional(),
    department: optionalText,
    gender: optionalText,
    division: optionalText,
    subcategory: optionalText,
    fabric: optionalText,
    fit: optionalText,
    pattern: optionalText,
    occasion: optionalText,
    sleeve: optionalText,
    neck: optionalText,
    washCare: z.string().max(2000).nullable().optional(),
    countryOfOrigin: optionalText,
    hsnCode: z.string().regex(/^\d{2,8}$/, 'HSN code is digits only (2 to 8)').nullable().optional(),
    customAttributes: z.record(z.unknown()).optional(),
  })
  .strict();
const updateColourSchema = z.object({ name: z.string().max(100).optional(), hexSwatch: z.string().nullable().optional() }).strict();
const updateSkuSchema = z.object({ barcode: z.string().max(64).nullable().optional(), isActive: z.boolean().optional() }).strict();
const updateMediaSchema = z
  .object({ colourId: z.string().uuid().nullable().optional(), altText: z.string().max(300).nullable().optional(), isSwatch: z.boolean().optional() })
  .strict();
const idParam = z.object({ id: z.string().uuid() });

/** Bulk import rows: known columns only (no stock, no unknown fields), bounded batches. */
const IMPORT_BATCH_MAX_ROWS = 500;
const importRowSchema = z
  .object({ row: z.number().int().positive(), ...Object.fromEntries(IMPORT_COLUMNS.map((c) => [c, z.string().max(2000).optional()])) } as unknown as Record<
    'row' | ImportColumn,
    z.ZodTypeAny
  >)
  .strict();
const importRowsSchema = z.object({ rows: z.array(importRowSchema).min(1).max(IMPORT_BATCH_MAX_ROWS) });

const productRoutes: FastifyPluginAsync = async (fastify) => {
  const service = new ProductService(fastify);
  const writeAuth = [fastify.requireStaffAuth, fastify.requirePermission('product:write')];
  const readAuth = [fastify.requireStaffAuth, fastify.requirePermission('product:read')];
  const publishAuth = [fastify.requireStaffAuth, fastify.requirePermission('product:publish')];
  const taxonomyAuth = [fastify.requireStaffAuth, fastify.requirePermission('product:taxonomy:manage')];

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
    await fastify.storefrontCache.invalidateProduct(id);
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
    await fastify.storefrontCache.invalidateProduct(id);
    reply.status(200).send(result);
  });

  fastify.post('/products/styles/:id/unpublish', { preHandler: publishAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const result = await service.unpublish(id, request.staffUser!.id);
    await fastify.searchIndex.removeStyle(id); // M10: unpublished styles must disappear from search immediately
    await fastify.storefrontCache.invalidateProduct(id);
    reply.status(200).send(result);
  });

  fastify.post('/products/styles/:id/archive', { preHandler: writeAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const result = await service.archive(id, request.staffUser!.id);
    await fastify.searchIndex.removeStyle(id); // M10
    await fastify.storefrontCache.invalidateProduct(id);
    reply.status(200).send(result);
  });
  // --- Admin Ops Phase 1: editing, reference data, readiness ---

  const readiness = new ProductReadinessService(fastify);
  const media = new ProductMediaService(fastify);
  /** Search and storefront caches follow every change to a product. */
  const refresh = async (styleId: string) => {
    await fastify.searchIndex.indexStyle(styleId);
    await fastify.storefrontCache.invalidateProduct(styleId);
  };

  fastify.get('/products/reference', { preHandler: readAuth }, async () => service.getReferenceData());

  fastify.post('/products/sizes', { preHandler: taxonomyAuth }, async (request, reply) => {
    const { label } = z.object({ label: z.string().min(1).max(20) }).parse(request.body);
    reply.status(201).send(await service.createSize(label, request.staffUser!.id));
  });

  fastify.patch('/products/categories/:id', { preHandler: taxonomyAuth }, async (request) => {
    const { id } = idParam.parse(request.params);
    const { productType } = z.object({ productType: z.enum(['APPAREL', 'FOOTWEAR', 'BELT', 'FRAGRANCE']) }).parse(request.body);
    return service.updateCategoryProductType(id, productType, request.staffUser!.id);
  });

  fastify.patch('/products/styles/:id', { preHandler: writeAuth }, async (request) => {
    const { id } = idParam.parse(request.params);
    const result = await service.updateStyle(id, updateStyleSchema.parse(request.body), request.staffUser!.id);
    if (result.changed.length > 0) await refresh(id);
    return result;
  });

  fastify.patch('/products/colours/:id', { preHandler: writeAuth }, async (request) => {
    const { id } = idParam.parse(request.params);
    const colour = await service.updateColour(id, updateColourSchema.parse(request.body), request.staffUser!.id);
    await refresh(colour.styleId);
    return colour;
  });

  fastify.delete('/products/colours/:id', { preHandler: writeAuth }, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const colour = await fastify.prisma.colour.findUnique({ where: { id } });
    await service.deleteColour(id, request.staffUser!.id);
    if (colour) await refresh(colour.styleId);
    reply.status(204).send();
  });

  fastify.patch('/products/skus/:id', { preHandler: writeAuth }, async (request) => {
    const { id } = idParam.parse(request.params);
    const sku = await service.updateSku(id, updateSkuSchema.parse(request.body), request.staffUser!.id);
    await refresh(sku.styleId);
    return sku;
  });

  fastify.post('/products/styles/:id/size-chart', { preHandler: writeAuth }, async (request) => {
    const { id } = idParam.parse(request.params);
    const { sizeChartId } = z.object({ sizeChartId: z.string().uuid().nullable() }).parse(request.body);
    const result = await service.assignSizeChart(id, sizeChartId, request.staffUser!.id);
    await fastify.storefrontCache.invalidateProduct(id);
    return result;
  });

  fastify.get('/products/styles/:id/readiness', { preHandler: readAuth }, async (request) => {
    const { id } = idParam.parse(request.params);
    return readiness.evaluate(id);
  });

  // --- Admin Ops Phase 1: product photos ---

  /** One multipart file (fields before the file), size-limited by PRODUCT_MEDIA_MAX_FILE_SIZE_BYTES. */
  async function readUpload(request: import('fastify').FastifyRequest) {
    const max = loadEnv().PRODUCT_MEDIA_MAX_FILE_SIZE_BYTES;
    let part;
    try {
      part = await request.file({ limits: { fileSize: max, files: 1 } });
    } catch {
      throw new ValidationError('Send the photo as a file upload (multipart/form-data)');
    }
    if (!part) throw new ValidationError('Choose a photo to upload');
    let buffer: Buffer;
    try {
      buffer = await part.toBuffer();
    } catch {
      throw new ValidationError(`The photo is larger than ${Math.round(max / 1048576)} MB`);
    }
    const field = (name: string) => {
      const f = (part.fields as Record<string, unknown>)[name] as { value?: unknown } | undefined;
      return typeof f?.value === 'string' ? f.value : undefined;
    };
    return { file: { buffer, filename: part.filename }, field };
  }

  fastify.post('/products/styles/:id/media/upload', { preHandler: writeAuth }, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const { file, field } = await readUpload(request);
    const colourId = field('colourId') || null;
    if (colourId && !z.string().uuid().safeParse(colourId).success) throw new ValidationError('Choose a colour of this product');
    const created = await media.upload(id, file, { colourId, altText: field('altText') ?? null }, request.staffUser!.id);
    await refresh(id);
    reply.status(201).send(created);
  });

  fastify.put('/products/media/:id/file', { preHandler: writeAuth }, async (request) => {
    const { id } = idParam.parse(request.params);
    const { file } = await readUpload(request);
    const updated = await media.replaceFile(id, file, request.staffUser!.id);
    await refresh(updated.styleId);
    return updated;
  });

  fastify.patch('/products/media/:id', { preHandler: writeAuth }, async (request) => {
    const { id } = idParam.parse(request.params);
    const updated = await media.update(id, updateMediaSchema.parse(request.body), request.staffUser!.id);
    await refresh(updated.styleId);
    return updated;
  });

  fastify.post('/products/media/:id/cover', { preHandler: writeAuth }, async (request) => {
    const { id } = idParam.parse(request.params);
    const updated = await media.setCover(id, request.staffUser!.id);
    await refresh(updated.styleId);
    return updated;
  });

  fastify.post('/products/styles/:id/media/order', { preHandler: writeAuth }, async (request) => {
    const { id } = idParam.parse(request.params);
    const { mediaIds } = z.object({ mediaIds: z.array(z.string().uuid()).min(1).max(200) }).parse(request.body);
    const result = await media.reorder(id, mediaIds, request.staffUser!.id);
    await refresh(id);
    return result;
  });

  fastify.delete('/products/media/:id', { preHandler: writeAuth }, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const existing = await fastify.prisma.productMedia.findUnique({ where: { id } });
    await media.remove(id, request.staffUser!.id);
    if (existing) await refresh(existing.styleId);
    reply.status(204).send();
  });

  // --- Admin Ops Phase 1: bulk product import ---

  const imports = new ImportService(fastify);
  const canWritePrices = (request: import('fastify').FastifyRequest) => request.staffUser!.permissions.has('catalog:price:write');
  type Rows = Parameters<ImportService['validate']>[0];

  /** Dry run: per-row outcome of importing these rows. Reads only. */
  fastify.post('/products/imports/validate', { preHandler: writeAuth }, async (request) => {
    const { rows } = importRowsSchema.parse(request.body);
    const results = await imports.validate(rows as Rows, canWritePrices(request));
    return { summary: summarise(results), results };
  });

  fastify.post('/products/imports', { preHandler: writeAuth }, async (request, reply) => {
    const body = z
      .object({ fileName: z.string().min(1).max(200), totalRows: z.number().int().positive().max(1_000_000), totalBatches: z.number().int().positive().max(10_000) })
      .parse(request.body);
    reply.status(201).send(await imports.createRun(body, request.staffUser!.id));
  });

  fastify.get('/products/imports', { preHandler: readAuth }, async () => imports.listRuns());

  fastify.get('/products/imports/:id', { preHandler: readAuth }, async (request) => {
    const { id } = idParam.parse(request.params);
    return imports.getRun(id);
  });

  /** Applies one batch of an import run. Safe to repeat: rows match by identifiers. */
  fastify.post('/products/imports/:id/batches/:index', { preHandler: writeAuth }, async (request) => {
    const { id, index } = z.object({ id: z.string().uuid(), index: z.coerce.number().int().nonnegative() }).parse(request.params);
    const { rows } = importRowsSchema.parse(request.body);
    // Refuse an unknown run or a batch number outside it before doing any work.
    const run = await imports.getRun(id);
    if (index >= run.totalBatches) throw new ValidationError(`Batch ${index + 1} is outside this import (it has ${run.totalBatches})`);
    const { results, touchedStyleIds } = await imports.apply(rows as Rows, canWritePrices(request), request.staffUser!.id);
    for (const styleId of touchedStyleIds) await fastify.searchIndex.indexStyle(styleId);
    if (touchedStyleIds.length > 0) await fastify.storefrontCache.invalidateCatalog();
    await imports.recordBatch(id, index, results, request.staffUser!.id);
    return { summary: summarise(results), results };
  });

  // Public: the bytes of a product photo a product still uses. The storefront
  // serves these at /media/products/<key> (next.config.mjs rewrite).
  fastify.get('/media/products/:key', async (request, reply) => {
    const { key } = z.object({ key: z.string().max(80) }).parse(request.params);
    const object = await media.readPublic(key);
    reply
      .header('Content-Type', object.mimeType)
      .header('Cache-Control', 'public, max-age=3600')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Security-Policy', "default-src 'none'")
      .send(object.buffer);
  });
};

export default productRoutes;
