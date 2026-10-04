import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { CmsService, type NavMenuItem } from './service.js';
import { purgeCatalogAfter } from '../pdp/storefront-cache.js';
import { BANNER_PLACEMENTS, MENU_PLACEMENTS, UNREAD_MENU_KEYS, isSafeContentLink } from './placements.js';
import { ContentAssetService } from './content-assets.js';
import { loadEnv } from '@fcp/config';
import { ValidationError } from '@fcp/shared';

// Admin Ops Phase 1: a banner link must be one the storefront can safely
// render (a site path or an https address); it becomes the tile's href.
const bannerLink = z.string().refine(isSafeContentLink, 'Link to a page on this site (starting with /) or a full https:// address');
const bannerSchema = z.object({
  title: z.string().min(1).max(200),
  imageUrl: z.string().min(1),
  linkUrl: bannerLink.optional(),
  placement: z.string().min(1).max(100),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

const bannerUpdateSchema = bannerSchema.partial().extend({ linkUrl: bannerLink.nullable().optional() });

const contentBlockSchema = z.object({
  key: z.string().min(1).max(200),
  title: z.string().min(1).max(200),
  content: z.string().min(1),
});

const landingPageSchema = z.object({
  slug: z.string().min(1).max(200),
  title: z.string().min(1).max(200),
  metaDescription: z.string().optional(),
  heroImageUrl: z.string().optional(),
  blockKeys: z.array(z.string()).optional(),
});

const navMenuItemSchema: z.ZodType<{ label: string; url: string; sortOrder?: number; children?: unknown[] }> = z.lazy(() =>
  z.object({
    label: z.string().min(1),
    url: z.string().min(1),
    sortOrder: z.number().int().optional(),
    children: z.array(navMenuItemSchema).optional(),
  }),
);

/**
 * Content Management routes (M29, specs/28-admin.md ADM-002). Staff
 * writes gated by `cms:manage`/`cms:read`; public reads are
 * unauthenticated and published-only, so the storefront can consume
 * live content without a code deployment.
 */
const cmsRoutes: FastifyPluginAsync = async (fastify) => {
  const cms = new CmsService(fastify);
  const manageAuth = [fastify.requireStaffAuth, fastify.requirePermission('cms:manage')];
  const readAuth = [fastify.requireStaffAuth, fastify.requirePermission('cms:read')];
  const afterChange = purgeCatalogAfter(fastify);

  // --- Banners ---
  fastify.post('/cms/banners', { preHandler: manageAuth }, async (request, reply) => {
    const body = bannerSchema.parse(request.body);
    reply.status(201).send(await afterChange(cms.createBanner(body, request.staffUser!.id)));
  });
  fastify.patch('/cms/banners/:id', { preHandler: manageAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = bannerUpdateSchema.parse(request.body);
    reply.status(200).send(await afterChange(cms.updateBanner(id, body, request.staffUser!.id)));
  });
  fastify.get('/cms/banners', { preHandler: readAuth }, async (_request, reply) => {
    reply.status(200).send(await cms.listBanners());
  });

  // --- Content blocks ---
  fastify.post('/cms/content-blocks', { preHandler: manageAuth }, async (request, reply) => {
    const body = contentBlockSchema.parse(request.body);
    reply.status(201).send(await afterChange(cms.createContentBlock(body, request.staffUser!.id)));
  });
  fastify.patch('/cms/content-blocks/:id', { preHandler: manageAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = contentBlockSchema.partial().extend({ isActive: z.boolean().optional() }).parse(request.body);
    reply.status(200).send(await afterChange(cms.updateContentBlock(id, body, request.staffUser!.id)));
  });
  fastify.get('/cms/content-blocks', { preHandler: readAuth }, async (_request, reply) => {
    reply.status(200).send(await cms.listContentBlocks());
  });

  // --- Landing pages ---
  fastify.post('/cms/landing-pages', { preHandler: manageAuth }, async (request, reply) => {
    const body = landingPageSchema.parse(request.body);
    reply.status(201).send(await cms.createLandingPage(body, request.staffUser!.id));
  });
  fastify.patch('/cms/landing-pages/:id', { preHandler: manageAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z
      .object({
        title: z.string().min(1).max(200).optional(),
        metaDescription: z.string().max(300).nullable().optional(),
        heroImageUrl: z.string().max(2000).nullable().optional(),
        blockKeys: z.array(z.string()).max(50).optional(),
      })
      .strict()
      .parse(request.body);
    reply.status(200).send(await afterChange(cms.updateLandingPage(id, body, request.staffUser!.id)));
  });
  fastify.post('/cms/landing-pages/:id/publish', { preHandler: manageAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    reply.status(200).send(await afterChange(cms.publishLandingPage(id, request.staffUser!.id)));
  });
  fastify.post('/cms/landing-pages/:id/unpublish', { preHandler: manageAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    reply.status(200).send(await afterChange(cms.unpublishLandingPage(id, request.staffUser!.id)));
  });
  fastify.get('/cms/landing-pages', { preHandler: readAuth }, async (_request, reply) => {
    reply.status(200).send(await cms.listLandingPages());
  });

  // --- Navigation menus ---
  fastify.put('/cms/navigation-menus/:key', { preHandler: manageAuth }, async (request, reply) => {
    const { key } = z.object({ key: z.string().min(1) }).parse(request.params);
    const { items } = z.object({ items: z.array(navMenuItemSchema) }).parse(request.body);
    reply.status(200).send(await afterChange(cms.upsertNavigationMenu(key, items as NavMenuItem[], request.staffUser!.id)));
  });
  fastify.get('/cms/navigation-menus', { preHandler: readAuth }, async (_request, reply) => {
    reply.status(200).send(await cms.listNavigationMenus());
  });

  // --- Admin Ops Phase 1: which placements the storefront reads, and content images ---
  fastify.get('/cms/placements', { preHandler: readAuth }, async () => ({ menus: MENU_PLACEMENTS, unreadMenus: UNREAD_MENU_KEYS, banners: BANNER_PLACEMENTS }));

  const assets = new ContentAssetService(fastify);
  fastify.post('/cms/assets', { preHandler: manageAuth }, async (request, reply) => {
    const max = loadEnv().PRODUCT_MEDIA_MAX_FILE_SIZE_BYTES;
    let part;
    try {
      part = await request.file({ limits: { fileSize: max, files: 1 } });
    } catch {
      throw new ValidationError('Send the image as a file upload (multipart/form-data)');
    }
    if (!part) throw new ValidationError('Choose an image to upload');
    let buffer: Buffer;
    try {
      buffer = await part.toBuffer();
    } catch {
      throw new ValidationError(`The image is larger than ${Math.round(max / 1048576)} MB`);
    }
    const alt = (part.fields as Record<string, { value?: unknown } | undefined>).altText?.value;
    reply.status(201).send(await assets.upload(buffer, typeof alt === 'string' ? alt : null, request.staffUser!.id));
  });
  fastify.get('/cms/assets', { preHandler: readAuth }, async () => assets.list());
  fastify.get('/media/content/:key', async (request, reply) => {
    const { key } = z.object({ key: z.string().max(80) }).parse(request.params);
    const object = await assets.readPublic(key);
    reply
      .header('Content-Type', object.mimeType)
      .header('Cache-Control', 'public, max-age=3600')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Security-Policy', "default-src 'none'")
      .send(object.buffer);
  });

  // --- Public storefront reads (no auth) ---
  fastify.get('/storefront/cms/banners', async (request, reply) => {
    const { placement } = z.object({ placement: z.string().min(1) }).parse(request.query);
    reply.status(200).send(await cms.listPublicBanners(placement));
  });
  fastify.get('/storefront/cms/content-blocks/:key', async (request, reply) => {
    const { key } = z.object({ key: z.string().min(1) }).parse(request.params);
    reply.status(200).send(await cms.getPublicContentBlock(key));
  });
  fastify.get('/storefront/cms/landing-pages/:slug', async (request, reply) => {
    const { slug } = z.object({ slug: z.string().min(1) }).parse(request.params);
    reply.status(200).send(await cms.getPublicLandingPage(slug));
  });
  fastify.get('/storefront/cms/navigation-menus/:key', async (request, reply) => {
    const { key } = z.object({ key: z.string().min(1) }).parse(request.params);
    reply.status(200).send(await cms.getPublicNavigationMenu(key));
  });
};

export default cmsRoutes;
