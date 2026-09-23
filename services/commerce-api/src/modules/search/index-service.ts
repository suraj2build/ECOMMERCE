import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@fcp/db';
import { NotFoundError } from '@fcp/shared';
import { CatalogService } from '../catalog/service.js';
import { recordAudit } from '../audit/service.js';

declare module 'fastify' {
  interface FastifyInstance {
    searchIndex: SearchIndexService;
  }
}

export const STYLES_INDEX_UID = 'styles';

export interface StyleSearchDocument {
  id: string;
  styleCode: string;
  name: string;
  brandId: string;
  brandName: string;
  categoryId: string;
  categoryName: string;
  categorySlug: string;
  department: string | null;
  gender: string | null;
  division: string | null;
  subcategory: string | null;
  season: string;
  collection: string;
  fabric: string | null;
  fit: string | null;
  pattern: string | null;
  occasion: string | null;
  colours: string[];
  sizes: string[];
  mrp: number;
  sellingPrice: number;
  currency: string;
  isMarkdown: boolean;
  availableQuantity: number;
  inStock: boolean;
  searchPinned: boolean;
  publishedAt: number;
  thumbnailUrl: string | null;
}

/**
 * Catalog-to-Meilisearch indexing pipeline (M10, specs/09-search-discovery.md,
 * ADR-0006). PostgreSQL remains the source of truth; this service only ever
 * *derives* a search document from it - never the reverse.
 *
 * Every write here is best-effort and swallows its own errors: a
 * Meilisearch outage must degrade search, never break catalog/pricing/
 * inventory writes that happen to trigger a reindex as a side effect
 * (CLAUDE.md §6 - a search-index write is explicitly NOT one of the
 * operations that gets to fail a request). Callers therefore never need
 * their own try/catch around these methods.
 *
 * `indexStyle`/`removeStyle` wait for the Meilisearch task to finish
 * processing (`.waitTask()`) before resolving, rather than just enqueuing
 * it. There is no job queue in this build (ADR-0005 - only Redis for
 * sessions today) and the formal indexing-lag SLA
 * (`blueprint/NON_FUNCTIONAL_REQUIREMENTS.md` "Search indexing") remains
 * `TARGET_REQUIRED`/undecided - so this makes the best-available engineering
 * choice (synchronous, same-request indexing - effectively zero lag) rather
 * than guessing a number, and makes catalog-change-to-index propagation
 * deterministically testable without sleep/retry loops.
 */
export class SearchIndexService {
  private readonly catalog: CatalogService;

  constructor(private readonly fastify: FastifyInstance) {
    this.catalog = new CatalogService(fastify);
  }

  private get prisma(): PrismaClient {
    return this.fastify.prisma;
  }

  private index() {
    return this.fastify.meilisearch.index<StyleSearchDocument>(STYLES_INDEX_UID);
  }

  /**
   * Configures the index's searchable/filterable/sortable attributes and
   * custom ranking rules. Idempotent - safe to call on every server boot.
   * Called from app.ts at startup, fire-and-forget (never blocks readiness).
   */
  async configureIndex(): Promise<void> {
    try {
      await this.fastify.meilisearch.createIndex(STYLES_INDEX_UID, { primaryKey: 'id' }).waitTask();
      await this.index()
        .updateSettings({
          searchableAttributes: ['name', 'styleCode', 'brandName', 'categoryName', 'colours', 'fabric'],
          filterableAttributes: [
            'brandName',
            'categorySlug',
            'department',
            'gender',
            'colours',
            'sizes',
            'isMarkdown',
            'inStock',
            'sellingPrice',
          ],
          sortableAttributes: ['sellingPrice', 'publishedAt', 'searchPinned', 'inStock'],
          // Manual merchandiser pin first (SRCH-001), then standard text
          // relevance, then the customer's explicit sort choice (price/
          // newest) when one is given (the "sort" placeholder is a no-op
          // otherwise), then in-stock items ranked above out-of-stock
          // (never hidden outright), then most-recently-published as the
          // final tiebreak.
          rankingRules: [
            'searchPinned:desc',
            'words',
            'typo',
            'proximity',
            'attribute',
            'sort',
            'exactness',
            'inStock:desc',
            'publishedAt:desc',
          ],
        })
        .waitTask();
    } catch (err) {
      this.fastify.log.warn({ err }, 'Meilisearch index configuration failed - search may be degraded/unavailable');
    }
  }

  /** Recomputes and upserts one style's search document, or removes it if it is no longer publishable. */
  async indexStyle(styleId: string): Promise<void> {
    try {
      const style = await this.prisma.style.findUnique({
        where: { id: styleId },
        include: {
          brand: true,
          category: true,
          skus: { where: { isActive: true }, include: { colour: true, size: true } },
          media: { where: { colourId: null }, orderBy: { sortOrder: 'asc' }, take: 1 },
        },
      });
      if (!style) {
        await this.removeStyle(styleId);
        return;
      }

      const activePrice = await this.catalog.getActivePrice(styleId);
      if (style.lifecycleState !== 'PUBLISHED' || !activePrice) {
        await this.removeStyle(styleId);
        return;
      }

      const skuIds = style.skus.map((sku) => sku.id);
      const balances = skuIds.length
        ? await this.prisma.inventoryBalance.groupBy({
            by: ['skuId'],
            where: { skuId: { in: skuIds } },
            _sum: { onHand: true, reserved: true },
          })
        : [];
      const availableQuantity = balances.reduce(
        (sum, b) => sum + Math.max(0, (b._sum.onHand ?? 0) - (b._sum.reserved ?? 0)),
        0,
      );

      const document: StyleSearchDocument = {
        id: style.id,
        styleCode: style.styleCode,
        name: style.name,
        brandId: style.brandId,
        brandName: style.brand.name,
        categoryId: style.categoryId,
        categoryName: style.category.name,
        categorySlug: style.category.slug,
        department: style.department,
        gender: style.gender,
        division: style.division,
        subcategory: style.subcategory,
        season: style.season,
        collection: style.collection,
        fabric: style.fabric,
        fit: style.fit,
        pattern: style.pattern,
        occasion: style.occasion,
        colours: [...new Set(style.skus.map((sku) => sku.colour.name))],
        sizes: [...new Set(style.skus.map((sku) => sku.size.label))],
        mrp: Number(activePrice.mrp),
        sellingPrice: Number(activePrice.sellingPrice),
        currency: activePrice.currency,
        isMarkdown: activePrice.isMarkdown,
        availableQuantity,
        inStock: availableQuantity > 0,
        searchPinned: style.searchPinned,
        publishedAt: style.publishedAt ? style.publishedAt.getTime() : 0,
        thumbnailUrl: style.media[0]?.url ?? null,
      };

      await this.index().addDocuments([document]).waitTask();
    } catch (err) {
      this.fastify.log.warn({ err, styleId }, 'search index update failed - Meilisearch may be unavailable');
    }
  }

  /** Looks up the owning style of a SKU and reindexes it - used by inventory/GRN change hooks. */
  async indexStyleForSku(skuId: string): Promise<void> {
    try {
      const sku = await this.prisma.sku.findUnique({ where: { id: skuId }, select: { styleId: true } });
      if (!sku) return;
      await this.indexStyle(sku.styleId);
    } catch (err) {
      this.fastify.log.warn({ err, skuId }, 'search index update (by SKU) failed - Meilisearch may be unavailable');
    }
  }

  async removeStyle(styleId: string): Promise<void> {
    try {
      await this.index().deleteDocument(styleId).waitTask();
    } catch (err) {
      this.fastify.log.warn({ err, styleId }, 'search index removal failed - Meilisearch may be unavailable');
    }
  }

  /**
   * Manual merchandiser pin/unpin (SRCH-001). Always an explicit staff
   * action - there is no rule-based or automated path to `searchPinned`.
   */
  async setPinned(styleId: string, pinned: boolean, actorStaffId: string): Promise<void> {
    const style = await this.prisma.style.findUnique({ where: { id: styleId } });
    if (!style) throw new NotFoundError('Style', styleId);

    await this.prisma.style.update({
      where: { id: styleId },
      data: { searchPinned: pinned, searchPinnedAt: pinned ? new Date() : null },
    });

    await recordAudit(this.prisma, {
      actorType: 'STAFF',
      actorStaffId,
      action: pinned ? 'search.pin' : 'search.unpin',
      entityType: 'Style',
      entityId: styleId,
      oldValue: { searchPinned: style.searchPinned },
      newValue: { searchPinned: pinned },
    });

    await this.indexStyle(styleId);
  }

  /** Full rebuild from PostgreSQL - operational recovery tool, never the primary indexing path. */
  async reindexAll(): Promise<{ indexed: number }> {
    const publishedStyleIds = await this.prisma.style.findMany({
      where: { lifecycleState: 'PUBLISHED' },
      select: { id: true },
    });
    for (const { id } of publishedStyleIds) {
      await this.indexStyle(id);
    }
    return { indexed: publishedStyleIds.length };
  }
}
