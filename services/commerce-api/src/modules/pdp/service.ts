import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@fcp/db';
import { NotFoundError } from '@fcp/shared';
import { CatalogService } from '../catalog/service.js';
import { ReviewService } from './review-service.js';
import { CrossSellService } from './cross-sell-service.js';

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
  private readonly catalog: CatalogService;
  private readonly reviews: ReviewService;
  private readonly crossSell: CrossSellService;

  constructor(private readonly fastify: FastifyInstance) {
    this.catalog = new CatalogService(fastify);
    this.reviews = new ReviewService(fastify);
    this.crossSell = new CrossSellService(fastify);
  }

  private get prisma(): PrismaClient {
    return this.fastify.prisma;
  }

  async getProductDetail(styleId: string) {
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

    const badges = await this.catalog.listBadges(styleId);

    const skuIds = style.skus.map((s) => s.id);
    const balances = skuIds.length
      ? await this.prisma.inventoryBalance.groupBy({
          by: ['skuId'],
          where: { skuId: { in: skuIds } },
          _sum: { onHand: true, reserved: true },
        })
      : [];
    const availabilityBySkuId = new Map(
      balances.map((b) => [b.skuId, Math.max(0, (b._sum.onHand ?? 0) - (b._sum.reserved ?? 0))]),
    );

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

    const [ratingSummary, reviewsPage, crossSell] = await Promise.all([
      this.reviews.getRatingSummary(styleId),
      this.reviews.listPublishedReviews(styleId, { take: 10 }),
      this.crossSell.listCrossSell(styleId),
    ]);

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
      })),
      reviewsTotal: reviewsPage.total,
      crossSell,
      publishedAt: style.publishedAt,
    };
  }
}
