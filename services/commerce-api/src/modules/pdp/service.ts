import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@fcp/db';
import { NotFoundError } from '@fcp/shared';
import { CatalogService } from '../catalog/service.js';
import { InventoryService } from '../inventory/service.js';
import { ReviewService } from './review-service.js';
import { CrossSellService } from './cross-sell-service.js';
import { loadEnv } from '@fcp/config';
import { resolveStyleReturnPolicy } from '../returns/policy.js';
import { productAttributes, productCopy, resolveProductType } from '../product/copy.js';

/**
 * Public PDP aggregate read (M11, specs/10-pdp.md). Composes Style/
 * Colour/Size/Sku/Price/ProductMedia/SizeChart (source of truth:
 * PostgreSQL, M02/M07) with live inventory availability (M06) and
 * reviews (this milestone) into the single payload the storefront PDP
 * page needs - a read projection only, never a second source of truth
 * (ADR-0017's discipline, same as the M09/M10 public read routes).
 *
 * A style that is not publishable (not PUBLISHED, or has no active
 * price) 404s exactly like an unknown id - the public read path must
 * never let a draft product's existence be distinguished from a
 * genuinely unknown one.
 */
export class PdpService {
  // Share only work already in flight for this public, identity-free read.
  // Settled results are removed immediately: no stale price/stock cache.
  private readonly inFlight = new Map<string, Promise<Awaited<ReturnType<PdpService['readProductDetail']>>>>();
  private readonly catalog: CatalogService;
  private readonly inventory: InventoryService;
  private readonly reviews: ReviewService;
  private readonly crossSell: CrossSellService;

  constructor(private readonly fastify: FastifyInstance) {
    this.catalog = new CatalogService(fastify);
    this.inventory = new InventoryService(fastify);
    this.reviews = new ReviewService(fastify);
    this.crossSell = new CrossSellService(fastify);
  }

  /** Return and shipping terms for this style, from configuration only.
   * Shipping amounts are flagged unconfirmed until the business sets
   * SHIPPING_RATES_CONFIRMED (CHK-003 leaves the values to the business). */
  private async storefrontPolicies(styleId: string, categoryId: string) {
    const env = loadEnv();
    const returns = await resolveStyleReturnPolicy(this.prisma, styleId, categoryId);
    return {
      returns: { returnable: returns.returnable, windowDays: returns.windowDays },
      shipping: {
        flatAmount: env.SHIPPING_DEFAULT_FLAT_AMOUNT,
        freeAboveAmount: env.SHIPPING_DEFAULT_FREE_ABOVE_THRESHOLD,
        currency: 'INR',
        confirmed: env.SHIPPING_RATES_CONFIRMED,
      },
    };
  }

  private get prisma(): PrismaClient {
    return this.fastify.prisma;
  }

  async getProductDetail(styleId: string) {
    const existing = this.inFlight.get(styleId);
    if (existing) return existing;
    const pending = this.readProductDetail(styleId);
    this.inFlight.set(styleId, pending);
    try {
      return await pending;
    } finally {
      this.inFlight.delete(styleId);
    }
  }

  private async readProductDetail(styleId: string) {
    const style = await this.prisma.style.findUnique({
      where: { id: styleId },
      include: {
        brand: true,
        category: true,
        skus: {
          where: { isActive: true },
          include: { colour: true, size: true, sizeChart: { include: { entries: true } } },
        },
        media: { orderBy: { sortOrder: 'asc' } },
      },
    });
    if (!style) throw new NotFoundError('Style', styleId);

    const activePrice = await this.catalog.getActivePrice(styleId);
    const isPublishable = style.lifecycleState === 'PUBLISHED' && activePrice !== null;
    if (!isPublishable) throw new NotFoundError('Style', styleId);

    const skuIds = style.skus.map((s) => s.id);
    // M26 independent-review certification repair (2026-09-28): this
    // cross-location sellable-quantity computation now lives in
    // InventoryService.getAvailableToSellBySku - the single canonical
    // implementation both PDP and Channel Publishing share. Output is
    // byte-for-byte identical to the formula this method inlined before.
    const [badges, availabilityBySkuId, ratingSummary, reviewsPage, crossSell, policies] = await Promise.all([
      this.catalog.listBadges(styleId),
      this.inventory.getAvailableToSellBySku(skuIds),
      this.reviews.getRatingSummary(styleId),
      this.reviews.listPublishedReviews(styleId, { take: 10 }),
      this.crossSell.listCrossSell(styleId),
      this.storefrontPolicies(style.id, style.categoryId),
    ]);

    const variants = style.skus.map((sku) => {
      const availableQuantity = availabilityBySkuId.get(sku.id) ?? 0;
      return {
        skuId: sku.id,
        skuCode: sku.skuCode,
        colourId: sku.colourId,
        colourName: sku.colour.name,
        colourCode: sku.colour.colourCode,
        hexSwatch: sku.colour.hexSwatch,
        sizeId: sku.sizeId,
        sizeLabel: sku.size.label,
        availableQuantity,
        inStock: availableQuantity > 0,
      };
    });

    // One size chart per style in practice (PROD-004 scopes charts by
    // category/gender/brand, not by individual size) - take the first
    // SKU that references one.
    const sizeChartSku = style.skus.find((s) => s.sizeChart);
    const sizeChart = sizeChartSku?.sizeChart
      ? {
          id: sizeChartSku.sizeChart.id,
          name: sizeChartSku.sizeChart.name,
          version: sizeChartSku.sizeChart.version,
          entries: sizeChartSku.sizeChart.entries.map((e) => ({
            sizeLabel: e.sizeLabel,
            measurements: e.measurements,
          })),
        }
      : null;

    return {
      id: style.id,
      styleCode: style.styleCode,
      name: style.name,
      brandName: style.brand.name,
      categoryName: style.category.name,
      categorySlug: style.category.slug,
      department: style.department,
      gender: style.gender,
      fabric: style.fabric,
      fit: style.fit,
      pattern: style.pattern,
      occasion: style.occasion,
      washCare: style.washCare,
      countryOfOrigin: style.countryOfOrigin,
      copy: productCopy(style.customAttributes),
      productType: resolveProductType(style.customAttributes, style.category.productType),
      attributes: productAttributes(resolveProductType(style.customAttributes, style.category.productType), style),
      mrp: Number(activePrice!.mrp),
      sellingPrice: Number(activePrice!.sellingPrice),
      currency: activePrice!.currency,
      isMarkdown: activePrice!.isMarkdown,
      badges: badges.map((b) => ({ type: b.badgeType })),
      media: style.media.map((m) => ({
        url: m.url,
        type: m.type,
        colourId: m.colourId,
        altText: m.altText,
        isSwatch: m.isSwatch,
        modelInfo: m.modelInfo,
      })),
      variants,
      sizeChart,
      ratingSummary,
      reviews: reviewsPage.reviews.map((r) => ({
        id: r.id,
        rating: r.rating,
        title: r.title,
        body: r.body,
        createdAt: r.createdAt,
        customerName: r.customer.fullName ?? 'Anonymous',
        photoUrl: r.photoKey ? reviewPhotoPath(r.id) : null,
      })),
      reviewsTotal: reviewsPage.total,
      crossSell,
      // LR-002: published as structured data only from real configuration.
      policies,
      publishedAt: style.publishedAt,
    };
  }

  /**
   * specs/36: "What Our Customers Say" homepage carousel. Price is composed
   * here from CatalogService - the single source of price truth - never a
   * cached/stale value on the review or style row.
   */
  async getFeaturedReviews() {
    const reviews = await this.reviews.listFeaturedReviews();
    if (reviews.length === 0) return [];
    const priceByStyleId = await this.catalog.getActivePricesByStyleIds(reviews.map((r) => r.styleId));
    return reviews
      .map((r) => {
        const price = priceByStyleId.get(r.styleId);
        if (!price) return null; // style has no active price right now - never show a stale/guessed one
        return {
          id: r.id,
          rating: r.rating,
          body: r.body,
          photoUrl: reviewPhotoPath(r.id),
          customerFirstName: firstName(r.customer.fullName),
          product: {
            styleId: r.styleId,
            name: r.style.name,
            thumbnailUrl: r.style.media[0]?.url ?? null,
            sellingPrice: Number(price.sellingPrice),
            mrp: Number(price.mrp),
            currency: price.currency,
          },
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
  }
}

// A storefront-relative path - the storefront's own /review-media/[id]
// route proxies this to the real API, mirroring the existing
// /lookbook-media/[id] convention (same-origin <img src>, no CORS).
function reviewPhotoPath(reviewId: string): string {
  return `/review-media/${reviewId}`;
}

function firstName(fullName: string | null): string {
  if (!fullName?.trim()) return 'Anonymous';
  return fullName.trim().split(/\s+/)[0] ?? 'Anonymous';
}
