import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@fcp/db';
import { NotFoundError, ValidationError } from '@fcp/shared';
import { recordAudit } from '../audit/service.js';
import { CatalogService } from '../catalog/service.js';

/**
 * Cross-sell (M11, PDP-002): manual overrides always rank first; any
 * remaining slots are backfilled with a same-category rule, computed
 * live at read time so it can never drift from the current catalog (no
 * cached/materialized recommendation table). Every candidate - manual
 * or rule-based - must independently pass the same publishable gate as
 * any other storefront read (PUBLISHED + an active price): an override
 * pointing at a since-unpublished style is silently dropped, not shown
 * broken.
 */
export class CrossSellService {
  private readonly catalog: CatalogService;

  constructor(private readonly fastify: FastifyInstance) {
    this.catalog = new CatalogService(fastify);
  }

  private get prisma(): PrismaClient {
    return this.fastify.prisma;
  }

  async addOverride(styleId: string, relatedStyleId: string, actorStaffId: string, sortOrder = 0) {
    if (styleId === relatedStyleId) throw new ValidationError('A style cannot cross-sell itself');
    const [style, related] = await Promise.all([
      this.prisma.style.findUnique({ where: { id: styleId } }),
      this.prisma.style.findUnique({ where: { id: relatedStyleId } }),
    ]);
    if (!style) throw new NotFoundError('Style', styleId);
    if (!related) throw new NotFoundError('Style', relatedStyleId);

    const override = await this.prisma.crossSellOverride.upsert({
      where: { styleId_relatedStyleId: { styleId, relatedStyleId } },
      create: { styleId, relatedStyleId, sortOrder, createdByStaffId: actorStaffId },
      update: { sortOrder },
    });
    await recordAudit(this.prisma, {
      actorType: 'STAFF',
      actorStaffId,
      action: 'cross_sell.add',
      entityType: 'CrossSellOverride',
      entityId: override.id,
      newValue: { styleId, relatedStyleId, sortOrder },
    });
    return override;
  }

  async removeOverride(styleId: string, relatedStyleId: string, actorStaffId: string) {
    const override = await this.prisma.crossSellOverride.findUnique({
      where: { styleId_relatedStyleId: { styleId, relatedStyleId } },
    });
    if (!override) throw new NotFoundError('CrossSellOverride', `${styleId}/${relatedStyleId}`);
    await this.prisma.crossSellOverride.delete({ where: { id: override.id } });
    await recordAudit(this.prisma, {
      actorType: 'STAFF',
      actorStaffId,
      action: 'cross_sell.remove',
      entityType: 'CrossSellOverride',
      entityId: override.id,
      oldValue: { styleId, relatedStyleId },
    });
  }

  async listCrossSell(styleId: string, limit = 8) {
    const style = await this.prisma.style.findUnique({ where: { id: styleId } });
    if (!style) throw new NotFoundError('Style', styleId);

    const overrides = await this.prisma.crossSellOverride.findMany({
      where: { styleId },
      orderBy: { sortOrder: 'asc' },
    });

    const picks: { id: string; source: 'MANUAL' | 'RULE' }[] = [];
    const seen = new Set<string>([styleId]);

    for (const o of overrides) {
      if (picks.length >= limit) break;
      if (seen.has(o.relatedStyleId)) continue;
      const entry = await this.catalog.getCatalogEntry(o.relatedStyleId);
      if (!entry.isPublishable) continue;
      picks.push({ id: o.relatedStyleId, source: 'MANUAL' });
      seen.add(o.relatedStyleId);
    }

    if (picks.length < limit) {
      const ruleCandidates = await this.prisma.style.findMany({
        where: { categoryId: style.categoryId, lifecycleState: 'PUBLISHED', id: { notIn: [...seen] } },
        orderBy: { publishedAt: 'desc' },
        take: (limit - picks.length) * 2, // over-fetch since some published styles may lack an active price
      });
      for (const candidate of ruleCandidates) {
        if (picks.length >= limit) break;
        if (seen.has(candidate.id)) continue;
        const activePrice = await this.catalog.getActivePrice(candidate.id);
        if (!activePrice) continue;
        picks.push({ id: candidate.id, source: 'RULE' });
        seen.add(candidate.id);
      }
    }

    if (picks.length === 0) return [];

    const styles = await this.prisma.style.findMany({
      where: { id: { in: picks.map((p) => p.id) } },
      include: { brand: true, media: { where: { colourId: null }, orderBy: { sortOrder: 'asc' }, take: 1 } },
    });
    const byId = new Map(styles.map((s) => [s.id, s]));

    const output = [];
    for (const pick of picks) {
      const s = byId.get(pick.id);
      if (!s) continue;
      const activePrice = await this.catalog.getActivePrice(s.id);
      if (!activePrice) continue;
      output.push({
        id: s.id,
        styleCode: s.styleCode,
        name: s.name,
        brandName: s.brand.name,
        thumbnailUrl: s.media[0]?.url ?? null,
        mrp: Number(activePrice.mrp),
        sellingPrice: Number(activePrice.sellingPrice),
        source: pick.source,
      });
    }
    return output;
  }
}
