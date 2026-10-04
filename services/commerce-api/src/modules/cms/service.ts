import type { FastifyInstance } from 'fastify';
import type { PrismaClient, CmsBanner, CmsContentBlock, CmsLandingPage, CmsNavigationMenu } from '@fcp/db';
import { NotFoundError, ValidationError } from '@fcp/shared';
import { recordAudit } from '../audit/service.js';
import { isSafeContentLink } from './placements.js';
import { withUniqueConstraintCheck } from '../../lib/prisma-error-mapping.js';

export interface NavMenuItem {
  label: string;
  url: string;
  sortOrder?: number;
  children?: NavMenuItem[];
}

/**
 * Content Management (M29, specs/28-admin.md ADM-002). Four FIXED
 * content types only - homepage banners, content blocks, campaign
 * landing pages, navigation/menus - deliberately never a generic page
 * builder. Every write is staff-gated (`cms:manage`) and audited;
 * every read used by the storefront is a separate, unauthenticated,
 * PUBLISHED-only projection (mirroring the exact
 * `CatalogService.listPublicStyles` publish-gating discipline), so
 * merchandising can change content live without a code deployment.
 */
export class CmsService {
  constructor(private readonly fastify: FastifyInstance) {}

  private get prisma(): PrismaClient {
    return this.fastify.prisma;
  }

  // --- Banners ---

  async createBanner(
    input: { title: string; imageUrl: string; linkUrl?: string; placement: string; sortOrder?: number; isActive?: boolean },
    actorStaffId: string,
  ): Promise<CmsBanner> {
    // Admin Ops Phase 1: a banner can be saved as a draft (isActive false)
    // and switched on later; left out, it is live at once as before.
    const banner = await this.prisma.cmsBanner.create({
      data: { ...input, publishedAt: input.isActive === false ? null : new Date(), createdByStaffId: actorStaffId },
    });
    await recordAudit(this.prisma, {
      actorType: 'STAFF',
      actorStaffId,
      action: 'cms.banner.create',
      entityType: 'CmsBanner',
      entityId: banner.id,
      newValue: { title: banner.title, placement: banner.placement },
    });
    return banner;
  }

  async updateBanner(
    id: string,
    input: Partial<{ title: string; imageUrl: string; linkUrl: string | null; placement: string; sortOrder: number; isActive: boolean }>,
    actorStaffId: string,
  ): Promise<CmsBanner> {
    const existing = await this.prisma.cmsBanner.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('CmsBanner', id);
    const banner = await this.prisma.cmsBanner.update({
      where: { id },
      data: { ...input, publishedAt: input.isActive && !existing.publishedAt ? new Date() : undefined },
    });
    await recordAudit(this.prisma, {
      actorType: 'STAFF',
      actorStaffId,
      action: 'cms.banner.update',
      entityType: 'CmsBanner',
      entityId: id,
      newValue: input,
    });
    return banner;
  }

  async listBanners(): Promise<CmsBanner[]> {
    return this.prisma.cmsBanner.findMany({ orderBy: { sortOrder: 'asc' } });
  }

  /** Public: active banners for a given placement, no auth required. */
  async listPublicBanners(placement: string): Promise<CmsBanner[]> {
    return this.prisma.cmsBanner.findMany({
      where: { placement, isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  // --- Content blocks ---

  async createContentBlock(input: { key: string; title: string; content: string }, actorStaffId: string): Promise<CmsContentBlock> {
    const block = await withUniqueConstraintCheck(
      () => this.prisma.cmsContentBlock.create({ data: { ...input, createdByStaffId: actorStaffId } }),
      'CmsContentBlock',
    );
    await recordAudit(this.prisma, {
      actorType: 'STAFF',
      actorStaffId,
      action: 'cms.content_block.create',
      entityType: 'CmsContentBlock',
      entityId: block.id,
      newValue: { key: block.key },
    });
    return block;
  }

  async updateContentBlock(
    id: string,
    input: Partial<{ title: string; content: string; isActive: boolean }>,
    actorStaffId: string,
  ): Promise<CmsContentBlock> {
    const block = await this.prisma.cmsContentBlock.update({ where: { id }, data: input });
    await recordAudit(this.prisma, {
      actorType: 'STAFF',
      actorStaffId,
      action: 'cms.content_block.update',
      entityType: 'CmsContentBlock',
      entityId: id,
      newValue: input,
    });
    return block;
  }

  async listContentBlocks(): Promise<CmsContentBlock[]> {
    return this.prisma.cmsContentBlock.findMany({ orderBy: { key: 'asc' } });
  }

  async getPublicContentBlock(key: string): Promise<CmsContentBlock> {
    const block = await this.prisma.cmsContentBlock.findUnique({ where: { key } });
    if (!block || !block.isActive) throw new NotFoundError('CmsContentBlock', key);
    return block;
  }

  // --- Landing pages ---

  async createLandingPage(
    input: { slug: string; title: string; metaDescription?: string; heroImageUrl?: string; blockKeys?: string[] },
    actorStaffId: string,
  ): Promise<CmsLandingPage> {
    const page = await withUniqueConstraintCheck(
      () =>
        this.prisma.cmsLandingPage.create({
          data: { ...input, blockKeys: (input.blockKeys ?? []) as object, createdByStaffId: actorStaffId },
        }),
      'CmsLandingPage',
    );
    await recordAudit(this.prisma, {
      actorType: 'STAFF',
      actorStaffId,
      action: 'cms.landing_page.create',
      entityType: 'CmsLandingPage',
      entityId: page.id,
      newValue: { slug: page.slug },
    });
    return page;
  }

  /** Admin Ops Phase 1: edit a page. A published page changes on the storefront at once. */
  async updateLandingPage(
    id: string,
    input: Partial<{ title: string; metaDescription: string | null; heroImageUrl: string | null; blockKeys: string[] }>,
    actorStaffId: string,
  ): Promise<CmsLandingPage> {
    const existing = await this.prisma.cmsLandingPage.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('CmsLandingPage', id);
    const page = await this.prisma.cmsLandingPage.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.metaDescription !== undefined ? { metaDescription: input.metaDescription || null } : {}),
        ...(input.heroImageUrl !== undefined ? { heroImageUrl: input.heroImageUrl || null } : {}),
        ...(input.blockKeys !== undefined ? { blockKeys: input.blockKeys as object } : {}),
      },
    });
    await recordAudit(this.prisma, {
      actorType: 'STAFF',
      actorStaffId,
      action: 'cms.landing_page.update',
      entityType: 'CmsLandingPage',
      entityId: id,
      newValue: { changedFields: Object.keys(input), isPublished: page.isPublished },
    });
    return page;
  }

  async publishLandingPage(id: string, actorStaffId: string): Promise<CmsLandingPage> {
    const page = await this.prisma.cmsLandingPage.update({
      where: { id },
      data: { isPublished: true, publishedAt: new Date() },
    });
    await recordAudit(this.prisma, {
      actorType: 'STAFF',
      actorStaffId,
      action: 'cms.landing_page.publish',
      entityType: 'CmsLandingPage',
      entityId: id,
    });
    return page;
  }

  async unpublishLandingPage(id: string, actorStaffId: string): Promise<CmsLandingPage> {
    const page = await this.prisma.cmsLandingPage.update({ where: { id }, data: { isPublished: false } });
    await recordAudit(this.prisma, {
      actorType: 'STAFF',
      actorStaffId,
      action: 'cms.landing_page.unpublish',
      entityType: 'CmsLandingPage',
      entityId: id,
    });
    return page;
  }

  async listLandingPages(): Promise<CmsLandingPage[]> {
    return this.prisma.cmsLandingPage.findMany({ orderBy: { createdAt: 'desc' } });
  }

  /** Public: a published landing page with its content blocks resolved inline. */
  async getPublicLandingPage(slug: string) {
    const page = await this.prisma.cmsLandingPage.findUnique({ where: { slug } });
    if (!page || !page.isPublished) throw new NotFoundError('CmsLandingPage', slug);
    const keys = Array.isArray(page.blockKeys) ? (page.blockKeys as string[]) : [];
    const blocks = keys.length
      ? await this.prisma.cmsContentBlock.findMany({ where: { key: { in: keys }, isActive: true } })
      : [];
    const blockByKey = new Map(blocks.map((b) => [b.key, b]));
    return {
      ...page,
      blocks: keys.map((key) => blockByKey.get(key)).filter((b): b is CmsContentBlock => !!b),
    };
  }

  // --- Navigation menus ---

  async upsertNavigationMenu(key: string, items: NavMenuItem[], actorStaffId: string): Promise<CmsNavigationMenu> {
    if (!Array.isArray(items)) throw new ValidationError('Navigation menu items must be an array');
    // Admin Ops Phase 1: refuse links the storefront would drop (javascript:,
    // data:, http:, //host) at save time, with the item named, instead of
    // saving them and silently not showing them.
    const check = (list: NavMenuItem[], depth: number) => {
      if (list.length > 50) throw new ValidationError('A menu can have at most 50 items');
      for (const item of list) {
        if (!item.label?.trim() || item.label.trim().length > 60) throw new ValidationError('Every menu item needs a label of up to 60 characters');
        if (!isSafeContentLink(item.url)) {
          throw new ValidationError(`"${item.label.trim()}": use a page on this site (starting with /) or a full https:// address`);
        }
        const children = (item as { children?: NavMenuItem[] }).children;
        if (children?.length) {
          if (depth >= 1) throw new ValidationError('Menus can be at most two levels deep');
          check(children, depth + 1);
        }
      }
    };
    check(items, 0);
    const menu = await this.prisma.cmsNavigationMenu.upsert({
      where: { key },
      update: { items: items as object, updatedByStaffId: actorStaffId },
      create: { key, items: items as object, updatedByStaffId: actorStaffId },
    });
    await recordAudit(this.prisma, {
      actorType: 'STAFF',
      actorStaffId,
      action: 'cms.navigation_menu.upsert',
      entityType: 'CmsNavigationMenu',
      entityId: menu.id,
      newValue: { key, itemCount: items.length },
    });
    return menu;
  }

  async listNavigationMenus(): Promise<CmsNavigationMenu[]> {
    return this.prisma.cmsNavigationMenu.findMany({ orderBy: { key: 'asc' } });
  }

  /** Public: a navigation menu by key, no auth required. */
  async getPublicNavigationMenu(key: string): Promise<CmsNavigationMenu> {
    const menu = await this.prisma.cmsNavigationMenu.findUnique({ where: { key } });
    if (!menu) throw new NotFoundError('CmsNavigationMenu', key);
    return menu;
  }
}
