import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@fcp/db';
import { NotFoundError } from '@fcp/shared';
import { CatalogService, THUMBNAIL_MEDIA } from '../catalog/service.js';
import { recordAudit } from '../audit/service.js';
import { productCopy } from '../product/copy.js';

/**
 * The card needs the thumbnail (THUMBNAIL_MEDIA's first image), a second
 * image for hover and one image per colour for its swatches.
 */
const CARD_MEDIA = { ...THUMBNAIL_MEDIA, take: undefined };
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
  /** Shopper-facing subtitle (Style.customAttributes, see product/copy.ts). */
  subtitle: string | null;
  /** Second image of the style, shown when a shopper hovers a product card. */
  hoverImageUrl: string | null;
  /** One entry per colour, in colour order: name, swatch hex and first image. */
  swatches: { name: string; hex: string | null; imageUrl: string | null }[];
  /** Per size label, whether any colour of that size can be sold now. */
  sizeAvailability: { label: string; inStock: boolean }[];
  /** Merchandising badges (MerchandiseBadge), as the PDP lists them. */
  badges: string[];
  /** From PUBLISHED reviews only; null when there are none. */
  ratingAverage: number | null;
  reviewCount: number;
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
/** Attempts before a search that may be truncated is reported unavailable. */
const COMPLETE_SEARCH_ATTEMPTS = 3;

export class SearchIndexService {
  private readonly catalog: CatalogService;
  private paginationUpdate: Promise<void> | undefined;
  private paginationReady = false;
  private paginationCapacity = 0;

  /** Synchronize on index writes/startup, not on every public read. Deep
   * pages also refresh the window, covering restored/bulk-loaded indexes.
   * The window is kept above the document count, so a complete result's
   * totalHits is always below it (see searchComplete).
   * Failed refreshes invalidate readiness so the next read retries safely.
   */
  async ensureCompletePagination(force = false, minimumCapacity = 0): Promise<void> {
    if (this.paginationUpdate) {
      await this.paginationUpdate;
      if (!force && minimumCapacity <= this.paginationCapacity) return;
    }
    if (!force && this.paginationReady && minimumCapacity <= this.paginationCapacity) return;
    this.paginationReady = false;
    const update = (async () => {
      const index = this.index();
      const [stats, pagination] = await Promise.all([index.getStats(), index.getPagination()]);
      const window = pagination.maxTotalHits ?? 1000;
      const capacity = Math.max(window, stats.numberOfDocuments + 1);
      if (window < capacity) {
        await index.updatePagination({ maxTotalHits: capacity }).waitTask();
      }
      this.paginationCapacity = capacity;
      this.paginationReady = true;
    })();
    this.paginationUpdate = update;
    try { await update; } finally { this.paginationUpdate = undefined; }
  }

  /** Runs a search and returns it only when it cannot have been cut off.
   * Meilisearch caps totalHits at the index's live maxTotalHits, and the
   * window is otherwise kept above the document count, so a result is
   * complete exactly when totalHits is below the window in force. The live
   * window is read before and after the search (a change in between - an
   * outside reset, or another request growing it - is caught by taking the
   * lower value). A possibly truncated result forces a resync and reruns;
   * if that keeps failing the search throws rather than return a capped list.
   */
  async searchComplete<T extends { totalHits?: number }>(minimumCapacity: number, run: () => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < COMPLETE_SEARCH_ATTEMPTS; attempt += 1) {
      await this.ensureCompletePagination(attempt > 0, minimumCapacity);
      const before = await this.liveWindow();
      const result = await run();
      const after = await this.liveWindow();
      if ((result.totalHits ?? 0) < Math.min(before, after)) return result;
    }
    throw new Error('Search result window could not be confirmed complete');
  }

  private async liveWindow(): Promise<number> {
    return (await this.index().getPagination()).maxTotalHits ?? 1000;
  }

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
          sortableAttributes: ['sellingPrice', 'publishedAt', 'searchPinned', 'inStock', 'ratingAverage'],
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
      await this.fastify.searchIndex.ensureCompletePagination(true);
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
          skus: { where: { isActive: true }, include: { colour: true, size: true }, orderBy: [{ size: { sortOrder: 'asc' } }] },
          media: CARD_MEDIA,
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
      const availableBySku = new Map(
        balances.map((b) => [b.skuId, Math.max(0, (b._sum.onHand ?? 0) - (b._sum.reserved ?? 0))]),
      );
      const availableQuantity = [...availableBySku.values()].reduce((sum, quantity) => sum + quantity, 0);
      const [badges, rating] = await Promise.all([
        this.catalog.listBadges(styleId),
        this.prisma.review.aggregate({ where: { styleId, status: 'PUBLISHED' }, _avg: { rating: true }, _count: { _all: true } }),
      ]);
      const swatches = new Map<string, StyleSearchDocument['swatches'][number]>();
      for (const sku of style.skus) {
        if (swatches.has(sku.colourId)) continue;
        const image = style.media.find((m) => m.colourId === sku.colourId) ?? style.media.find((m) => m.colourId === null);
        swatches.set(sku.colourId, { name: sku.colour.name, hex: sku.colour.hexSwatch, imageUrl: image?.url ?? null });
      }
      const sizeAvailability = new Map<string, boolean>();
      for (const sku of style.skus) {
        sizeAvailability.set(sku.size.label, (sizeAvailability.get(sku.size.label) ?? false) || (availableBySku.get(sku.id) ?? 0) > 0);
      }

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
        subtitle: productCopy(style.customAttributes).subtitle ?? null,
        hoverImageUrl: style.media.find((m, i) => i > 0 && m.colourId === style.media[0]?.colourId)?.url ?? null,
        swatches: [...swatches.values()],
        sizeAvailability: [...sizeAvailability].map(([label, inStock]) => ({ label, inStock })),
        badges: [...new Set(badges.map((b) => b.badgeType))],
        ratingAverage: rating._avg.rating === null ? null : Math.round(rating._avg.rating * 10) / 10,
        reviewCount: rating._count._all,
      };

      await this.index().addDocuments([document]).waitTask();
      await this.fastify.searchIndex.ensureCompletePagination(true);
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
  async reindexAll(): Promise<{ indexed: number; removed: number }> {
    const publishedStyleIds = await this.prisma.style.findMany({
      where: { lifecycleState: 'PUBLISHED' },
      select: { id: true },
    });
    for (const { id } of publishedStyleIds) {
      await this.indexStyle(id);
    }
    // A rebuild also drops documents whose style no longer exists or is no
    // longer published (e.g. removed while the search engine was down), so
    // listings never link to a product page that answers 404.
    const keep = new Set(publishedStyleIds.map(({ id }) => id));
    const orphans: string[] = [];
    for (let offset = 0; ; offset += 1000) {
      const page = await this.index().getDocuments<{ id: string }>({ fields: ['id'], limit: 1000, offset });
      orphans.push(...page.results.map((doc) => doc.id).filter((id) => !keep.has(id)));
      if (page.results.length < 1000) break;
    }
    if (orphans.length > 0) await this.index().deleteDocuments(orphans).waitTask();
    await this.fastify.searchIndex.ensureCompletePagination(true);
    return { indexed: publishedStyleIds.length, removed: orphans.length };
  }
}
