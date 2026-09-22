import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@fcp/db';
import { NotFoundError, ValidationError } from '@fcp/shared';
import { recordAudit } from '../audit/service.js';
import { withUniqueConstraintCheck } from '../../lib/prisma-error-mapping.js';

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
}
