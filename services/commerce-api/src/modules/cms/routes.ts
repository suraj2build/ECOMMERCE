import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { CmsService, type NavMenuItem } from './service.js';

const bannerSchema = z.object({
  title: z.string().min(1).max(200),
  imageUrl: z.string().min(1),
  linkUrl: z.string().optional(),
  placement: z.string().min(1).max(100),
  sortOrder: z.number().int().optional(),
});

const bannerUpdateSchema = bannerSchema.partial().extend({ isActive: z.boolean().optional() });

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

  // --- Banners ---
  fastify.post('/cms/banners', { preHandler: manageAuth }, async (request, reply) => {
    const body = bannerSchema.parse(request.body);
    reply.status(201).send(await cms.createBanner(body, request.staffUser!.id));
  });
  fastify.patch('/cms/banners/:id', { preHandler: manageAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = bannerUpdateSchema.parse(request.body);
    reply.status(200).send(await cms.updateBanner(id, body, request.staffUser!.id));
  });
  fastify.get('/cms/banners', { preHandler: readAuth }, async (_request, reply) => {
    reply.status(200).send(await cms.listBanners());
  });

  // --- Content blocks ---
  fastify.post('/cms/content-blocks', { preHandler: manageAuth }, async (request, reply) => {
    const body = contentBlockSchema.parse(request.body);
    reply.status(201).send(await cms.createContentBlock(body, request.staffUser!.id));
  });
  fastify.patch('/cms/content-blocks/:id', { preHandler: manageAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = contentBlockSchema.partial().extend({ isActive: z.boolean().optional() }).parse(request.body);
    reply.status(200).send(await cms.updateContentBlock(id, body, request.staffUser!.id));
  });
  fastify.get('/cms/content-blocks', { preHandler: readAuth }, async (_request, reply) => {
    reply.status(200).send(await cms.listContentBlocks());
  });

  // --- Landing pages ---
  fastify.post('/cms/landing-pages', { preHandler: manageAuth }, async (request, reply) => {
    const body = landingPageSchema.parse(request.body);
    reply.status(201).send(await cms.createLandingPage(body, request.staffUser!.id));
  });
  fastify.post('/cms/landing-pages/:id/publish', { preHandler: manageAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    reply.status(200).send(await cms.publishLandingPage(id, request.staffUser!.id));
  });
  fastify.post('/cms/landing-pages/:id/unpublish', { preHandler: manageAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    reply.status(200).send(await cms.unpublishLandingPage(id, request.staffUser!.id));
  });
  fastify.get('/cms/landing-pages', { preHandler: readAuth }, async (_request, reply) => {
    reply.status(200).send(await cms.listLandingPages());
  });

  // --- Navigation menus ---
  fastify.put('/cms/navigation-menus/:key', { preHandler: manageAuth }, async (request, reply) => {
    const { key } = z.object({ key: z.string().min(1) }).parse(request.params);
    const { items } = z.object({ items: z.array(navMenuItemSchema) }).parse(request.body);
    reply.status(200).send(await cms.upsertNavigationMenu(key, items as NavMenuItem[], request.staffUser!.id));
  });
  fastify.get('/cms/navigation-menus', { preHandler: readAuth }, async (_request, reply) => {
    reply.status(200).send(await cms.listNavigationMenus());
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
