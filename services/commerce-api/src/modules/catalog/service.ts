import type { FastifyInstance } from 'fastify';
import type { PrismaClient, Price } from '@fcp/db';
import { NotFoundError, ValidationError } from '@fcp/shared';
import { recordAudit } from '../audit/service.js';
import { withUniqueConstraintCheck } from '../../lib/prisma-error-mapping.js';

/** Listing thumbnail: the style-level image if one exists, otherwise the
 * first colour image. Products whose images are all per colour (the
 * normal way to load them) otherwise showed blank cards in listings. */
export const THUMBNAIL_MEDIA = {
  where: { type: 'IMAGE' as const },
  orderBy: [{ colourId: { sort: 'asc' as const, nulls: 'first' as const } }, { sortOrder: 'asc' as const }],
  take: 1,
};

export interface SetPriceInput {
  styleId: string;
  colourId?: string;
  mrp: number;
  sellingPrice: number;
  effectiveFrom?: Date;
  effectiveTo?: Date;
}

/**
 * Catalog / Merchandising / Pricing (M07, specs/07-catalog-merchandising.md).
 *
 * Price is keyed by (styleId, colourId) and never by size/SKU - this is
 * the structural enforcement of CAT-001 ("default price MUST be the same
 * across sizes for the same style-colour"): the data model simply has no
 * per-size price to diverge. Historical order/refund pricing snapshots
 * the price paid at order time (future M11+ concern) and is never
 * recomputed from a later catalog price change.
 *
 * `catalog:publish` gates making a Collection live to the storefront -
 * distinct from `product:publish` (specs/02-product-master.md PROD-003),
 * which gates a Style's own ready_for_qa -> published transition. A
 * markdown/sale price additionally requires `catalog:price:approve` on
 * top of `catalog:price:write` (checked at the route layer) - margin-
 * impacting discounts get an extra sign-off beyond routine base pricing.
 */
export class CatalogService {
  constructor(private readonly fastify: FastifyInstance) {}

  private get prisma(): PrismaClient {
    return this.fastify.prisma;
  }

  private validatePriceInput(input: SetPriceInput) {
    if (input.mrp <= 0) throw new ValidationError('mrp must be positive');
    if (input.sellingPrice <= 0) throw new ValidationError('sellingPrice must be positive');
    if (input.sellingPrice > input.mrp) {
      throw new ValidationError('sellingPrice cannot exceed mrp');
    }
    if (input.effectiveTo && input.effectiveFrom && input.effectiveTo <= input.effectiveFrom) {
      throw new ValidationError('effectiveTo must be after effectiveFrom');
    }
  }

  private async assertStyleAndColour(styleId: string, colourId?: string) {
    const style = await this.prisma.style.findUnique({ where: { id: styleId } });
    if (!style) throw new NotFoundError('Style', styleId);
    if (colourId) {
      const colour = await this.prisma.colour.findUnique({ where: { id: colourId } });
      if (!colour || colour.styleId !== styleId) {
        throw new ValidationError(`Colour '${colourId}' does not belong to style '${styleId}'`);
      }
    }
  }

  async setBasePrice(input: SetPriceInput, actorStaffId: string) {
    this.validatePriceInput(input);
    await this.assertStyleAndColour(input.styleId, input.colourId);

    const price = await this.prisma.price.create({
      data: {
        styleId: input.styleId,
        colourId: input.colourId,
        mrp: input.mrp,
        sellingPrice: input.sellingPrice,
        isMarkdown: false,
        effectiveFrom: input.effectiveFrom ?? new Date(),
        effectiveTo: input.effectiveTo,
      },
    });

    await recordAudit(this.prisma, {
      actorType: 'STAFF',
      actorStaffId,
      action: 'price.set_base',
      entityType: 'Price',
      entityId: price.id,
      newValue: input,
      reference: input.styleId,
    });
    return price;
  }

  async setMarkdownPrice(input: SetPriceInput, actorStaffId: string) {
    this.validatePriceInput(input);
    if (!input.effectiveFrom || !input.effectiveTo) {
      throw new ValidationError('Markdown pricing requires both effectiveFrom and effectiveTo');
    }
    await this.assertStyleAndColour(input.styleId, input.colourId);

    const price = await this.prisma.price.create({
      data: {
        styleId: input.styleId,
        colourId: input.colourId,
        mrp: input.mrp,
        sellingPrice: input.sellingPrice,
        isMarkdown: true,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo,
      },
    });

    await recordAudit(this.prisma, {
      actorType: 'STAFF',
      actorStaffId,
      action: 'price.set_markdown',
      entityType: 'Price',
      entityId: price.id,
      newValue: input,
      reference: input.styleId,
    });
    return price;
  }

  async listPrices(styleId: string) {
    return this.prisma.price.findMany({ where: { styleId }, orderBy: { effectiveFrom: 'desc' } });
  }

  /**
   * Resolves the single price in effect right now for a style(+colour):
   * an active markdown outranks an active base price; a colour-specific
   * row outranks a style-wide (colourId=null) row.
   */
  async getActivePrice(styleId: string, colourId?: string, atDate: Date = new Date()) {
    const candidates = await this.prisma.price.findMany({
      where: {
        styleId,
        effectiveFrom: { lte: atDate },
        AND: [
          { OR: [{ effectiveTo: null }, { effectiveTo: { gte: atDate } }] },
          colourId ? { OR: [{ colourId }, { colourId: null }] } : { colourId: null },
        ],
      },
    });

    if (candidates.length === 0) return null;

    candidates.sort((a, b) => {
      const specificityDelta = (b.colourId ? 1 : 0) - (a.colourId ? 1 : 0);
      if (specificityDelta !== 0) return specificityDelta;
      const markdownDelta = (b.isMarkdown ? 1 : 0) - (a.isMarkdown ? 1 : 0);
      if (markdownDelta !== 0) return markdownDelta;
      return b.effectiveFrom.getTime() - a.effectiveFrom.getTime();
    });

    return candidates[0]!;
  }

  /**
   * M32 Performance/Scale finding: `listPublicStyles` (the public home/
   * PLP catalog listing - the single highest-traffic route in this
   * application) called `getActivePrice(style.id)` once PER style in
   * the page via `Promise.all` - a genuine N+1 that fires 2x the page
   * size (over-fetch factor) worth of separate price queries on every
   * single home/PLP request. Fixed by batching: ONE query for every
   * style on the page, grouped and sorted in JS using the exact same
   * specificity/markdown/recency tie-break `getActivePrice` already
   * uses. Style-wide prices only (`colourId: null`) - matches
   * `listPublicStyles`'s own call site, which never passes a colourId.
   */
  async getActivePricesByStyleIds(styleIds: string[], atDate: Date = new Date()): Promise<Map<string, Price>> {
    if (styleIds.length === 0) return new Map();
    const candidates = await this.prisma.price.findMany({
      where: {
        styleId: { in: styleIds },
        colourId: null,
        effectiveFrom: { lte: atDate },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: atDate } }],
      },
    });

    const byStyle = new Map<string, Price[]>();
    for (const price of candidates) {
      const list = byStyle.get(price.styleId) ?? [];
      list.push(price);
      byStyle.set(price.styleId, list);
    }

    const result = new Map<string, Price>();
    for (const [styleId, list] of byStyle) {
      list.sort((a, b) => {
        const specificityDelta = (b.colourId ? 1 : 0) - (a.colourId ? 1 : 0);
        if (specificityDelta !== 0) return specificityDelta;
        const markdownDelta = (b.isMarkdown ? 1 : 0) - (a.isMarkdown ? 1 : 0);
        if (markdownDelta !== 0) return markdownDelta;
        return b.effectiveFrom.getTime() - a.effectiveFrom.getTime();
      });
      result.set(styleId, list[0]!);
    }
    return result;
  }

  async createCollection(input: { name: string; slug: string; description?: string }, actorStaffId: string) {
    const collection = await withUniqueConstraintCheck(
      () => this.prisma.collection.create({ data: input }),
      'Collection',
    );
    await recordAudit(this.prisma, {
      actorType: 'STAFF',
      actorStaffId,
      action: 'collection.create',
      entityType: 'Collection',
      entityId: collection.id,
      newValue: input,
    });
    return collection;
  }

  async addStyleToCollection(collectionId: string, styleId: string, actorStaffId: string) {
    const collection = await this.prisma.collection.findUnique({ where: { id: collectionId } });
    if (!collection) throw new NotFoundError('Collection', collectionId);
    const style = await this.prisma.style.findUnique({ where: { id: styleId } });
    if (!style) throw new NotFoundError('Style', styleId);

    const link = await this.prisma.collectionStyle.upsert({
      where: { collectionId_styleId: { collectionId, styleId } },
      update: {},
      create: { collectionId, styleId },
    });
    await recordAudit(this.prisma, {
      actorType: 'STAFF',
      actorStaffId,
      action: 'collection.add_style',
      entityType: 'Collection',
      entityId: collectionId,
      newValue: { styleId },
    });
    return link;
  }

  async removeStyleFromCollection(collectionId: string, styleId: string, actorStaffId: string) {
    await this.prisma.collectionStyle.delete({
      where: { collectionId_styleId: { collectionId, styleId } },
    });
    await recordAudit(this.prisma, {
      actorType: 'STAFF',
      actorStaffId,
      action: 'collection.remove_style',
      entityType: 'Collection',
      entityId: collectionId,
      oldValue: { styleId },
    });
  }

  async setCollectionActive(collectionId: string, isActive: boolean, actorStaffId: string) {
    const collection = await this.prisma.collection.findUnique({ where: { id: collectionId } });
    if (!collection) throw new NotFoundError('Collection', collectionId);

    const updated = await this.prisma.collection.update({ where: { id: collectionId }, data: { isActive } });
    await recordAudit(this.prisma, {
      actorType: 'STAFF',
      actorStaffId,
      action: isActive ? 'collection.publish' : 'collection.unpublish',
      entityType: 'Collection',
      entityId: collectionId,
      oldValue: { isActive: collection.isActive },
      newValue: { isActive },
    });
    return updated;
  }

  async setBadge(
    input: { styleId: string; badgeType: 'NEW_ARRIVAL' | 'BESTSELLER' | 'SALE' | 'MARKDOWN'; source?: 'RULE' | 'MANUAL'; startsAt?: Date; endsAt?: Date },
    actorStaffId: string,
  ) {
    const style = await this.prisma.style.findUnique({ where: { id: input.styleId } });
    if (!style) throw new NotFoundError('Style', input.styleId);

    const badge = await this.prisma.merchandiseBadge.create({
      data: {
        styleId: input.styleId,
        badgeType: input.badgeType,
        source: input.source ?? 'MANUAL',
        startsAt: input.startsAt ?? new Date(),
        endsAt: input.endsAt,
      },
    });
    await recordAudit(this.prisma, {
      actorType: 'STAFF',
      actorStaffId,
      action: 'badge.set',
      entityType: 'MerchandiseBadge',
      entityId: badge.id,
      newValue: input,
      reference: input.styleId,
    });
    return badge;
  }

  async removeBadge(id: string, actorStaffId: string) {
    const badge = await this.prisma.merchandiseBadge.findUnique({ where: { id } });
    if (!badge) throw new NotFoundError('MerchandiseBadge', id);
    await this.prisma.merchandiseBadge.delete({ where: { id } });
    await recordAudit(this.prisma, {
      actorType: 'STAFF',
      actorStaffId,
      action: 'badge.remove',
      entityType: 'MerchandiseBadge',
      entityId: id,
      oldValue: badge,
    });
  }

  async listBadges(styleId: string) {
    return this.prisma.merchandiseBadge.findMany({ where: { styleId }, orderBy: { createdAt: 'desc' } });
  }

  /**
   * Composite read used by the storefront-readiness check and the Phase 1
   * E2E proof: a style is publishable/sellable only when BOTH its
   * lifecycle gate (product:publish, PROD-003) and an active price are
   * present - catalog readiness is never coupled to a single channel.
   */
  async getCatalogEntry(styleId: string) {
    const style = await this.prisma.style.findUnique({ where: { id: styleId } });
    if (!style) throw new NotFoundError('Style', styleId);

    const activePrice = await this.getActivePrice(styleId);
    const badges = await this.listBadges(styleId);
    const isPublishable = style.lifecycleState === 'PUBLISHED' && activePrice !== null;

    return { style, activePrice, badges, isPublishable };
  }

  /**
   * Public (unauthenticated) storefront read: only ever PUBLISHED styles
   * that also have an active price - the same `isPublishable` gate as
   * getCatalogEntry, applied at list scope. This is a read PROJECTION
   * over Style/Price/ProductMedia - CatalogService remains the only
   * writer; nothing here becomes a second source of truth (ADR-0017's
   * read-model discipline).
   *
   * M10 (Search/Discovery) will replace "newest published first" with
   * real search/facet ranking; this exists now only so M09's Home page
   * has genuine (not fabricated) data to render, per the Phase 2
   * instruction's "configuration/seed content is acceptable for now."
   */
  async listPublicStyles(params: { take?: number; skip?: number } = {}) {
    const take = Math.min(params.take ?? 24, 60);
    const skip = params.skip ?? 0;

    const atDate = new Date();
    const candidates = await this.prisma.style.findMany({
      where: {
        lifecycleState: 'PUBLISHED',
        prices: { some: { colourId: null, effectiveFrom: { lte: atDate }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: atDate } }] } },
      },
      orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }],
      take,
      skip,
      include: {
        media: THUMBNAIL_MEDIA,
        brand: true,
      },
    });

    // M32 Performance/Scale finding: previously one getActivePrice() call
    // PER style via Promise.all - a genuine N+1 on this route's own hot
    // path (every home/PLP page load). One batched query instead.
    const priceByStyleId = await this.getActivePricesByStyleIds(candidates.map((s) => s.id), atDate);

    return candidates
      .map((style) => ({ style, activePrice: priceByStyleId.get(style.id) ?? null }))
      .filter((entry) => entry.activePrice !== null)
      .slice(0, take)
      .map(({ style, activePrice }) => ({
        id: style.id,
        styleCode: style.styleCode,
        name: style.name,
        brandName: style.brand.name,
        thumbnailUrl: style.media[0]?.url ?? null,
        mrp: activePrice!.mrp,
        sellingPrice: activePrice!.sellingPrice,
        isMarkdown: activePrice!.isMarkdown,
        publishedAt: style.publishedAt,
      }));
  }

  /** Public collection detail, gated by collection activation, style publication and an active price. */
  async getPublicCollection(slug: string) {
    const collection = await this.prisma.collection.findUnique({
      where: { slug },
      include: {
        styles: {
          include: {
            style: {
              include: {
                brand: true,
                media: THUMBNAIL_MEDIA,
              },
            },
          },
        },
      },
    });
    if (!collection?.isActive) return null;

    const published = collection.styles
      .map((link) => link.style)
      .filter((style) => style.lifecycleState === 'PUBLISHED');
    const priceByStyleId = await this.getActivePricesByStyleIds(published.map((style) => style.id));

    const styles = published
      .map((style) => ({ style, activePrice: priceByStyleId.get(style.id) ?? null }))
      .filter((entry) => entry.activePrice !== null)
      .map(({ style, activePrice }) => ({
        id: style.id,
        styleCode: style.styleCode,
        name: style.name,
        brandName: style.brand.name,
        thumbnailUrl: style.media[0]?.url ?? null,
        mrp: activePrice!.mrp,
        sellingPrice: activePrice!.sellingPrice,
        isMarkdown: activePrice!.isMarkdown,
        publishedAt: style.publishedAt,
      }));

    return {
      id: collection.id,
      name: collection.name,
      slug: collection.slug,
      description: collection.description,
      styleThumbnails: styles
        .map((style) => style.thumbnailUrl)
        .filter((url): url is string => Boolean(url))
        .slice(0, 4),
      styles,
    };
  }

  /** Storefront visibility: published with an active style-wide price now,
   * the same rule listPublicStyles applies. */
  private publicStyleWhere() {
    const atDate = new Date();
    return {
      lifecycleState: 'PUBLISHED' as const,
      prices: { some: { colourId: null, effectiveFrom: { lte: atDate }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: atDate } }] } },
    };
  }

  /** Public: storefront-visible product IDs for sitemap files, in a stable
   * order, plus the total so the sitemap index can list every file. */
  async listPublicStyleIdsForSitemap({ take, skip }: { take: number; skip: number }) {
    const where = this.publicStyleWhere();
    const [total, rows] = await Promise.all([
      this.prisma.style.count({ where }),
      this.prisma.style.findMany({ where, select: { id: true, publishedAt: true, updatedAt: true }, orderBy: { id: 'asc' }, take, skip }),
    ]);
    return { total, items: rows.map((row) => ({ id: row.id, lastModified: row.updatedAt ?? row.publishedAt })) };
  }

  /** Public: one active category by slug, with its count of storefront-visible
   * styles (published with an active price). Null for an unknown or inactive
   * slug, so the storefront can answer a real 404 (LR-002). */
  async getPublicCategory(slug: string) {
    const category = await this.prisma.category.findUnique({ where: { slug } });
    if (!category || !category.isActive) return null;
    const publishedStyleCount = await this.prisma.style.count({ where: { categoryId: category.id, ...this.publicStyleWhere() } });
    return { id: category.id, name: category.name, slug: category.slug, publishedStyleCount };
  }

  /** Public: every active category that has at least one storefront-visible
   * style, for the sitemap. No row cap: the category table is small and
   * every eligible category must be listed. */
  async listPublicCategoriesWithProducts() {
    const categories = await this.prisma.category.findMany({ where: { isActive: true }, orderBy: { slug: 'asc' } });
    const counts = await this.prisma.style.groupBy({ by: ['categoryId'], where: this.publicStyleWhere(), _count: { _all: true }, _max: { publishedAt: true } });
    const byCategory = new Map(counts.map((row) => [row.categoryId, row]));
    return categories
      .filter((category) => byCategory.has(category.id))
      .map((category) => ({
        slug: category.slug,
        name: category.name,
        publishedStyleCount: byCategory.get(category.id)!._count._all,
        lastPublishedAt: byCategory.get(category.id)!._max.publishedAt,
      }));
  }

  /** Public: active collections with publishable, actively-priced style thumbnails for Home. */
  async listPublicCollections({ take = 6, skip = 0 }: { take?: number; skip?: number } = {}) {
    const collections = await this.prisma.collection.findMany({
      where: { isActive: true },
      take,
      skip,
      // id breaks createdAt ties so consecutive pages never skip or repeat a collection.
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      include: {
        styles: {
          include: {
            style: {
              include: {
                media: THUMBNAIL_MEDIA,
              },
            },
          },
        },
      },
    });

    const publishedStyleIds = collections.flatMap((collection) =>
      collection.styles
        .map((link) => link.style)
        .filter((style) => style.lifecycleState === 'PUBLISHED')
        .map((style) => style.id),
    );
    const priceByStyleId = await this.getActivePricesByStyleIds(publishedStyleIds);

    return collections.map((collection) => ({
      id: collection.id,
      name: collection.name,
      slug: collection.slug,
      description: collection.description,
      styleThumbnails: collection.styles
        .map((link) => link.style)
        .filter((style) => style.lifecycleState === 'PUBLISHED' && priceByStyleId.has(style.id))
        .map((style) => style.media[0]?.url)
        .filter((url): url is string => Boolean(url))
        .slice(0, 4),
    }));
  }
}
