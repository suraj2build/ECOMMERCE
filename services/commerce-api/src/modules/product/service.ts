import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@fcp/db';
import { ConflictError, NotFoundError, ValidationError } from '@fcp/shared';
import { recordAudit } from '../audit/service.js';
import { withUniqueConstraintCheck } from '../../lib/prisma-error-mapping.js';

export interface CreateStyleInput {
  styleCode: string;
  name: string;
  brandId: string;
  categoryId: string;
  season: string;
  collection: string;
  department?: string;
  gender?: string;
  division?: string;
  subcategory?: string;
  fabric?: string;
  fit?: string;
  pattern?: string;
  occasion?: string;
  sleeve?: string;
  neck?: string;
  washCare?: string;
  countryOfOrigin?: string;
  hsnCode?: string;
  customAttributes?: Record<string, unknown>;
}

export interface QaCompletenessResult {
  passed: boolean;
  reasons: string[];
}

/**
 * Product Master (M02, specs/02-product-master.md).
 * STYLE -> COLOUR -> SIZE -> SKU hierarchy (PRODUCT.md §2.A). Season and
 * collection are required (PROD-001). Lifecycle:
 * draft -> ready_for_enrichment -> ready_for_qa -> published -> unpublished
 * -> archived (PROD-003). Publish requires BOTH the automated QA gate AND
 * an explicit merchandiser action (CAT-002) - neither alone is sufficient.
 */
export class ProductService {
  constructor(private readonly fastify: FastifyInstance) {}

  private get prisma() {
    return this.fastify.prisma;
  }

  async createStyle(input: CreateStyleInput, actorStaffId: string) {
    if (!input.season?.trim()) throw new ValidationError('season is required');
    if (!input.collection?.trim()) throw new ValidationError('collection is required');

    const style = await withUniqueConstraintCheck(
      () =>
        this.prisma.style.create({
          data: { ...input, customAttributes: input.customAttributes as Prisma.InputJsonValue | undefined },
        }),
      'Style',
    );
    await recordAudit(this.prisma, {
      actorType: 'STAFF',
      actorStaffId,
      action: 'style.create',
      entityType: 'Style',
      entityId: style.id,
      newValue: input,
    });
    return style;
  }

  async getStyle(id: string) {
    const style = await this.prisma.style.findUnique({
      where: { id },
      include: { colours: true, skus: { include: { colour: true, size: true } }, media: true, brand: true, category: true },
    });
    if (!style) throw new NotFoundError('Style', id);
    return style;
  }

  async listStyles(params: { lifecycleState?: string; brandId?: string; take?: number; skip?: number }) {
    return this.prisma.style.findMany({
      where: {
        lifecycleState: params.lifecycleState as never,
        brandId: params.brandId,
      },
      take: params.take ?? 50,
      skip: params.skip ?? 0,
      orderBy: { createdAt: 'desc' },
    });
  }

  async addColour(styleId: string, input: { name: string; colourCode: string; hexSwatch?: string }, actorStaffId: string) {
    await this.getStyle(styleId);
    const colour = await withUniqueConstraintCheck(
      () => this.prisma.colour.create({ data: { styleId, ...input } }),
      'Colour',
    );
    await recordAudit(this.prisma, {
      actorType: 'STAFF',
      actorStaffId,
      action: 'colour.create',
      entityType: 'Colour',
      entityId: colour.id,
      newValue: input,
      reference: styleId,
    });
    return colour;
  }

  async createSku(
    input: { styleId: string; colourId: string; sizeId: string; skuCode: string; barcode?: string; sizeChartId?: string },
    actorStaffId: string,
  ) {
    // Cross-style contamination guard: a colour is only ever valid for
    // the style it was created under - the FK on Sku.colourId alone
    // cannot express that a colour "belongs to" a specific style, so
    // this must be checked explicitly (certification-pass finding;
    // generateSkuMatrix's own caller is already safe by construction,
    // but createSku is a public method any future caller could misuse).
    const colour = await this.prisma.colour.findUnique({ where: { id: input.colourId } });
    if (!colour || colour.styleId !== input.styleId) {
      throw new ValidationError(`Colour '${input.colourId}' does not belong to style '${input.styleId}'`);
    }

    const existing = await this.prisma.sku.findUnique({
      where: {
        styleId_colourId_sizeId: {
          styleId: input.styleId,
          colourId: input.colourId,
          sizeId: input.sizeId,
        },
      },
    });
    if (existing) throw new ConflictError('A SKU already exists for this style/colour/size combination');

    // The pre-check above only covers the style/colour/size composite -
    // skuCode and barcode are independently unique, so a genuine
    // duplicate there still needs this backstop.
    const sku = await withUniqueConstraintCheck(() => this.prisma.sku.create({ data: input }), 'Sku');
    await recordAudit(this.prisma, {
      actorType: 'STAFF',
      actorStaffId,
      action: 'sku.create',
      entityType: 'Sku',
      entityId: sku.id,
      newValue: input,
      reference: input.styleId,
    });
    return sku;
  }

  /**
   * Generates SKUs for every colour x size combination not already
   * present - the standard fashion-hierarchy expansion (STYLE x COLOUR x
   * SIZE -> SKU).
   */
  async generateSkuMatrix(styleId: string, sizeIds: string[], actorStaffId: string) {
    const style = await this.getStyle(styleId);
    const created: { skuId: string; colourId: string; sizeId: string }[] = [];

    // Certification-pass finding: this previously issued one findUnique
    // per (colour, size) combination - O(colours * sizes) queries for a
    // single request. One findMany + an in-memory Set replaces all of
    // them with a single round trip.
    const existingSkus = await this.prisma.sku.findMany({
      where: { styleId, colourId: { in: style.colours.map((c) => c.id) }, sizeId: { in: sizeIds } },
      select: { colourId: true, sizeId: true },
    });
    const existingKeys = new Set(existingSkus.map((s) => `${s.colourId}:${s.sizeId}`));

    for (const colour of style.colours) {
      for (const sizeId of sizeIds) {
        if (existingKeys.has(`${colour.id}:${sizeId}`)) continue;
        const skuCode = `${style.styleCode}-${colour.colourCode}-${sizeId.slice(0, 4)}`.toUpperCase();
        const sku = await this.createSku({ styleId, colourId: colour.id, sizeId, skuCode }, actorStaffId);
        created.push({ skuId: sku.id, colourId: colour.id, sizeId });
      }
    }
    return created;
  }

  async addMedia(
    input: {
      styleId: string;
      colourId?: string;
      url: string;
      type?: 'IMAGE' | 'VIDEO';
      sortOrder?: number;
      altText?: string;
      isSwatch?: boolean;
    },
    actorStaffId: string,
  ) {
    await this.getStyle(input.styleId);
    if (input.colourId) {
      // Certification-pass finding: media/colour association must not
      // cross product boundaries - this route accepts colourId directly
      // from the request, so without this check any colour id from any
      // style could be attached to this style's media.
      const colour = await this.prisma.colour.findUnique({ where: { id: input.colourId } });
      if (!colour || colour.styleId !== input.styleId) {
        throw new ValidationError(`Colour '${input.colourId}' does not belong to style '${input.styleId}'`);
      }
    }
    const media = await this.prisma.productMedia.create({
      data: { ...input, type: input.type ?? 'IMAGE' },
    });
    await recordAudit(this.prisma, {
      actorType: 'STAFF',
      actorStaffId,
      action: 'product_media.create',
      entityType: 'ProductMedia',
      entityId: media.id,
      reference: input.styleId,
    });
    return media;
  }

  async createSizeChart(input: {
    name: string;
    category?: string;
    gender?: string;
    brandId?: string;
    entries: { sizeLabel: string; measurements: Record<string, unknown> }[];
  }) {
    if (input.entries.length === 0) throw new ValidationError('Size chart must have at least one entry');
    const labels = input.entries.map((e) => e.sizeLabel);
    if (new Set(labels).size !== labels.length) {
      throw new ValidationError('Size chart cannot have duplicate size labels');
    }

    return this.prisma.sizeChart.create({
      data: {
        name: input.name,
        category: input.category,
        gender: input.gender,
        brandId: input.brandId,
        entries: {
          create: input.entries.map((e) => ({
            sizeLabel: e.sizeLabel,
            measurements: e.measurements as Prisma.InputJsonValue,
          })),
        },
      },
      include: { entries: true },
    });
  }

  // --- Lifecycle transitions (PROD-003) ---

  async moveToReadyForEnrichment(styleId: string, actorStaffId: string) {
    return this.transitionLifecycle(styleId, 'DRAFT', 'READY_FOR_ENRICHMENT', actorStaffId);
  }

  async evaluateQaCompleteness(styleId: string): Promise<QaCompletenessResult> {
    const style = await this.getStyle(styleId);
    const reasons: string[] = [];

    if (style.colours.length === 0) reasons.push('Style has no colours');
    if (style.skus.length === 0) reasons.push('Style has no SKUs');
    for (const colour of style.colours) {
      const hasSku = style.skus.some((sku) => sku.colourId === colour.id);
      if (!hasSku) reasons.push(`Colour '${colour.name}' has no SKUs`);
    }
    if (style.media.length === 0) reasons.push('Style has no product media');
    if (!style.season) reasons.push('season is required');
    if (!style.collection) reasons.push('collection is required');

    return { passed: reasons.length === 0, reasons };
  }

  /** Runs the automated QA-completeness gate and records the result (PROD-002/003). */
  async runQaCheck(styleId: string, actorStaffId: string): Promise<QaCompletenessResult> {
    const style = await this.getStyle(styleId);
    if (style.lifecycleState !== 'READY_FOR_ENRICHMENT' && style.lifecycleState !== 'READY_FOR_QA') {
      throw new ValidationError(
        `Cannot run QA check from state '${style.lifecycleState}' - style must be in READY_FOR_ENRICHMENT or READY_FOR_QA`,
      );
    }

    const result = await this.evaluateQaCompleteness(styleId);
    if (result.passed) {
      await this.prisma.style.update({
        where: { id: styleId },
        data: { lifecycleState: 'READY_FOR_QA', qaPassedAt: new Date() },
      });
    }

    await recordAudit(this.prisma, {
      actorType: 'STAFF',
      actorStaffId,
      action: 'style.qa_check',
      entityType: 'Style',
      entityId: styleId,
      newValue: result,
    });
    return result;
  }

  /**
   * Publish requires BOTH the automated QA gate (qaPassedAt set) AND this
   * explicit Merchandiser action (CAT-002). Neither alone is sufficient -
   * this is enforced here, not just documented.
   */
  async publish(styleId: string, actorStaffId: string) {
    const style = await this.prisma.style.findUnique({ where: { id: styleId } });
    if (!style) throw new NotFoundError('Style', styleId);
    if (!style.qaPassedAt) {
      throw new ValidationError('Style cannot be published: automated QA-completeness gate has not passed');
    }
    if (style.lifecycleState !== 'READY_FOR_QA') {
      throw new ValidationError(`Cannot publish from state '${style.lifecycleState}'`);
    }

    const updated = await this.prisma.style.update({
      where: { id: styleId },
      data: { lifecycleState: 'PUBLISHED', publishedAt: new Date(), publishedByStaffId: actorStaffId },
    });

    await recordAudit(this.prisma, {
      actorType: 'STAFF',
      actorStaffId,
      action: 'style.publish',
      entityType: 'Style',
      entityId: styleId,
      oldValue: { lifecycleState: style.lifecycleState },
      newValue: { lifecycleState: 'PUBLISHED' },
    });
    return updated;
  }

  async unpublish(styleId: string, actorStaffId: string) {
    return this.transitionLifecycle(styleId, 'PUBLISHED', 'UNPUBLISHED', actorStaffId);
  }

  async archive(styleId: string, actorStaffId: string) {
    const style = await this.prisma.style.findUnique({ where: { id: styleId } });
    if (!style) throw new NotFoundError('Style', styleId);
    const updated = await this.prisma.style.update({
      where: { id: styleId },
      data: { lifecycleState: 'ARCHIVED' },
    });
    await recordAudit(this.prisma, {
      actorType: 'STAFF',
      actorStaffId,
      action: 'style.archive',
      entityType: 'Style',
      entityId: styleId,
      oldValue: { lifecycleState: style.lifecycleState },
      newValue: { lifecycleState: 'ARCHIVED' },
    });
    return updated;
  }

  private async transitionLifecycle(
    styleId: string,
    fromState: string,
    toState: 'READY_FOR_ENRICHMENT' | 'UNPUBLISHED',
    actorStaffId: string,
  ) {
    const style = await this.prisma.style.findUnique({ where: { id: styleId } });
    if (!style) throw new NotFoundError('Style', styleId);
    if (style.lifecycleState !== fromState) {
      throw new ValidationError(`Cannot transition from '${style.lifecycleState}' - expected '${fromState}'`);
    }
    const updated = await this.prisma.style.update({
      where: { id: styleId },
      data: { lifecycleState: toState },
    });
    await recordAudit(this.prisma, {
      actorType: 'STAFF',
      actorStaffId,
      action: `style.transition_to_${toState.toLowerCase()}`,
      entityType: 'Style',
      entityId: styleId,
      oldValue: { lifecycleState: fromState },
      newValue: { lifecycleState: toState },
    });
    return updated;
  }

  // --- Bulk operations foundation (PROD-006) ---

  async bulkCreateStyles(
    inputs: CreateStyleInput[],
    actorStaffId: string,
  ): Promise<{ succeeded: { index: number; styleId: string }[]; failed: { index: number; error: string }[] }> {
    const succeeded: { index: number; styleId: string }[] = [];
    const failed: { index: number; error: string }[] = [];

    for (const [index, input] of inputs.entries()) {
      try {
        const style = await this.createStyle(input, actorStaffId);
        succeeded.push({ index, styleId: style.id });
      } catch (err) {
        failed.push({ index, error: err instanceof Error ? err.message : 'Unknown error' });
      }
    }

    await recordAudit(this.prisma, {
      actorType: 'STAFF',
      actorStaffId,
      action: 'style.bulk_create',
      entityType: 'Style',
      entityId: 'bulk',
      newValue: { total: inputs.length, succeeded: succeeded.length, failed: failed.length },
    });

    return { succeeded, failed };
  }
}
