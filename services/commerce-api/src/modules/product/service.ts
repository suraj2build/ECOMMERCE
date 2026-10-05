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

const REQUIRED_TEXT_FIELDS = ['name', 'season', 'collection'] as const;
const OPTIONAL_TEXT_FIELDS = [
  'department', 'gender', 'division', 'subcategory', 'fabric', 'fit', 'pattern', 'occasion', 'sleeve', 'neck', 'washCare', 'countryOfOrigin', 'hsnCode',
] as const;
const FIELD_LABELS: Record<(typeof REQUIRED_TEXT_FIELDS)[number], string> = { name: 'Product name', season: 'Season', collection: 'Collection' };

export type UpdateStyleInput = Partial<Record<(typeof REQUIRED_TEXT_FIELDS)[number], string | null>> &
  Partial<Record<(typeof OPTIONAL_TEXT_FIELDS)[number], string | null>> & {
    brandId?: string;
    categoryId?: string;
    customAttributes?: Record<string, unknown>;
  };

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
  /**
   * `db` (optional) runs every read and write on that transaction instead
   * of the shared client - used by the bulk import so one product's style,
   * colours, sizes, prices and images commit or roll back together.
   */
  constructor(
    private readonly fastify: FastifyInstance,
    private readonly db?: Prisma.TransactionClient,
  ) {}

  private get prisma(): Prisma.TransactionClient {
    return this.db ?? this.fastify.prisma;
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

    // Admin Ops Phase 1: SKU codes are built from the size LABEL (readable
    // on labels, pick lists and import files) instead of the first four
    // characters of the size's internal id. Existing SKU codes never change.
    const sizes = await this.prisma.size.findMany({ where: { id: { in: sizeIds } } });
    const sizeById = new Map(sizes.map((size) => [size.id, size]));
    for (const sizeId of sizeIds) if (!sizeById.has(sizeId)) throw new NotFoundError('Size', sizeId);

    for (const colour of style.colours) {
      for (const sizeId of sizeIds) {
        if (existingKeys.has(`${colour.id}:${sizeId}`)) continue;
        const skuCode = await this.uniqueSkuCode(`${style.styleCode}-${colour.colourCode}-${skuCodePart(sizeById.get(sizeId)!.label)}`);
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
    // AO-D1 (Product Owner, 2026-10-05): an UNPUBLISHED product may be
    // republished, but only through this check again; a pass returns it to
    // READY_FOR_QA, from which the normal explicit publish applies.
    // ARCHIVED stays final.
    if (style.lifecycleState !== 'READY_FOR_ENRICHMENT' && style.lifecycleState !== 'READY_FOR_QA' && style.lifecycleState !== 'UNPUBLISHED') {
      throw new ValidationError(
        `Cannot run QA check from state '${style.lifecycleState}' - style must be in READY_FOR_ENRICHMENT, READY_FOR_QA or UNPUBLISHED`,
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

  /**
   * Unpublishing also clears the earlier QA pass, so a republish (AO-D1)
   * must pass the completeness check again rather than reuse an old pass.
   */
  async unpublish(styleId: string, actorStaffId: string) {
    return this.transitionLifecycle(styleId, 'PUBLISHED', 'UNPUBLISHED', actorStaffId, { qaPassedAt: null });
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
    extra: Prisma.StyleUpdateInput = {},
  ) {
    const style = await this.prisma.style.findUnique({ where: { id: styleId } });
    if (!style) throw new NotFoundError('Style', styleId);
    if (style.lifecycleState !== fromState) {
      throw new ValidationError(`Cannot transition from '${style.lifecycleState}' - expected '${fromState}'`);
    }
    const updated = await this.prisma.style.update({
      where: { id: styleId },
      data: { ...extra, lifecycleState: toState },
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

  // --- Editing (Admin Ops Phase 1) ---

  /** A SKU code no existing SKU uses: the base code, else base-2, base-3... */
  async uniqueSkuCode(base: string): Promise<string> {
    const code = base.toUpperCase();
    const taken = new Set(
      (await this.prisma.sku.findMany({ where: { skuCode: { startsWith: code } }, select: { skuCode: true } })).map((s) => s.skuCode),
    );
    if (!taken.has(code)) return code;
    for (let n = 2; ; n += 1) if (!taken.has(`${code}-${n}`)) return `${code}-${n}`;
  }

  /**
   * Edits a style's details. Fields left out are unchanged; an optional
   * field sent as null is cleared; season, collection and name can be
   * changed but never blanked (PROD-001). The style code is the product's
   * stable identifier (imports match on it), so it cannot be edited here.
   * customAttributes is merged key by key, and a key sent as null is
   * removed. Archived styles are read-only.
   */
  async updateStyle(styleId: string, patch: UpdateStyleInput, actorStaffId: string) {
    const style = await this.prisma.style.findUnique({ where: { id: styleId } });
    if (!style) throw new NotFoundError('Style', styleId);
    if (style.lifecycleState === 'ARCHIVED') throw new ConflictError('This product is archived and can no longer be edited');

    const data: Prisma.StyleUncheckedUpdateInput = {};
    const changed: string[] = [];
    for (const key of REQUIRED_TEXT_FIELDS) {
      const value = patch[key];
      if (value === undefined) continue;
      if (value === null || !value.trim()) throw new ValidationError(`${FIELD_LABELS[key]} cannot be blank`);
      if (value.trim() !== style[key]) {
        data[key] = value.trim();
        changed.push(key);
      }
    }
    for (const key of OPTIONAL_TEXT_FIELDS) {
      const value = patch[key];
      if (value === undefined) continue;
      const next = value === null || !value.trim() ? null : value.trim();
      if (next !== style[key]) {
        data[key] = next;
        changed.push(key);
      }
    }
    if (patch.brandId !== undefined && patch.brandId !== style.brandId) {
      const brand = await this.prisma.brand.findUnique({ where: { id: patch.brandId } });
      if (!brand) throw new ValidationError('Choose an existing brand');
      data.brandId = patch.brandId;
      changed.push('brandId');
    }
    if (patch.categoryId !== undefined && patch.categoryId !== style.categoryId) {
      const category = await this.prisma.category.findUnique({ where: { id: patch.categoryId } });
      if (!category) throw new ValidationError('Choose an existing category');
      data.categoryId = patch.categoryId;
      changed.push('categoryId');
    }
    if (patch.customAttributes !== undefined) {
      const current = style.customAttributes && typeof style.customAttributes === 'object' && !Array.isArray(style.customAttributes)
        ? { ...(style.customAttributes as Record<string, unknown>) }
        : {};
      let attributesChanged = false;
      for (const [key, value] of Object.entries(patch.customAttributes)) {
        if (value === null) {
          if (key in current) {
            delete current[key];
            attributesChanged = true;
          }
        } else if (JSON.stringify(current[key]) !== JSON.stringify(value)) {
          current[key] = value;
          attributesChanged = true;
        }
      }
      if (attributesChanged) {
        data.customAttributes = current as Prisma.InputJsonValue;
        changed.push('customAttributes');
      }
    }

    if (changed.length === 0) return { style: await this.getStyle(styleId), changed };
    await this.prisma.style.update({ where: { id: styleId }, data });
    await recordAudit(this.prisma, {
      actorType: 'STAFF',
      actorStaffId,
      action: 'style.update',
      entityType: 'Style',
      entityId: styleId,
      newValue: { changedFields: changed },
    });
    return { style: await this.getStyle(styleId), changed };
  }

  /** Renames a colour or changes its swatch. The colour code stays: SKU codes and imports use it. */
  async updateColour(colourId: string, patch: { name?: string; hexSwatch?: string | null }, actorStaffId: string) {
    const colour = await this.prisma.colour.findUnique({ where: { id: colourId }, include: { style: true } });
    if (!colour) throw new NotFoundError('Colour', colourId);
    if (colour.style.lifecycleState === 'ARCHIVED') throw new ConflictError('This product is archived and can no longer be edited');
    if (patch.name !== undefined && !patch.name.trim()) throw new ValidationError('Colour name cannot be blank');
    if (patch.hexSwatch && !/^#[0-9a-f]{6}$/i.test(patch.hexSwatch)) throw new ValidationError('Swatch must be a colour like #1A2B3C');
    const updated = await this.prisma.colour.update({
      where: { id: colourId },
      data: {
        ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
        ...(patch.hexSwatch !== undefined ? { hexSwatch: patch.hexSwatch || null } : {}),
      },
    });
    await recordAudit(this.prisma, {
      actorType: 'STAFF',
      actorStaffId,
      action: 'colour.update',
      entityType: 'Colour',
      entityId: colourId,
      newValue: { changedFields: Object.keys(patch) },
      reference: colour.styleId,
    });
    return updated;
  }

  /**
   * Removes a colour that was added by mistake. Only a colour with no SKUs,
   * prices or photos can go: anything else may already be in stock, on an
   * order or on the storefront, so it is deactivated SKU by SKU instead.
   */
  async deleteColour(colourId: string, actorStaffId: string) {
    const colour = await this.prisma.colour.findUnique({
      where: { id: colourId },
      include: { _count: { select: { skus: true, prices: true, media: true, shoppableMediaTags: true } } },
    });
    if (!colour) throw new NotFoundError('Colour', colourId);
    const { skus, prices, media, shoppableMediaTags } = colour._count;
    if (skus > 0) throw new ConflictError(`${colour.name} already has sizes (SKUs). Turn off the sizes you do not sell instead of removing the colour.`);
    if (prices > 0) throw new ConflictError(`${colour.name} has its own price history, which is kept. It cannot be removed.`);
    if (media > 0) throw new ConflictError(`${colour.name} has photos. Move or remove its photos first.`);
    if (shoppableMediaTags > 0) throw new ConflictError(`${colour.name} is tagged in Watch & Shop. Remove those tags first.`);
    await this.prisma.colour.delete({ where: { id: colourId } });
    await recordAudit(this.prisma, {
      actorType: 'STAFF',
      actorStaffId,
      action: 'colour.delete',
      entityType: 'Colour',
      entityId: colourId,
      oldValue: { name: colour.name, colourCode: colour.colourCode },
      reference: colour.styleId,
    });
  }

  /** Sets a SKU's barcode (null clears it) or turns the SKU on/off for sale. */
  async updateSku(skuId: string, patch: { barcode?: string | null; isActive?: boolean }, actorStaffId: string) {
    const sku = await this.prisma.sku.findUnique({ where: { id: skuId }, include: { style: true } });
    if (!sku) throw new NotFoundError('Sku', skuId);
    if (sku.style.lifecycleState === 'ARCHIVED') throw new ConflictError('This product is archived and can no longer be edited');
    const barcode = patch.barcode === undefined ? undefined : patch.barcode?.trim() || null;
    if (barcode && !/^[0-9A-Za-z-]{4,64}$/.test(barcode)) throw new ValidationError('A barcode is 4-64 letters, digits or dashes');
    if (barcode) {
      const other = await this.prisma.sku.findUnique({ where: { barcode } });
      if (other && other.id !== skuId) throw new ConflictError(`Barcode ${barcode} is already used by ${other.skuCode}`);
    }
    const updated = await withUniqueConstraintCheck(
      () =>
        this.prisma.sku.update({
          where: { id: skuId },
          data: { ...(barcode !== undefined ? { barcode } : {}), ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}) },
          include: { colour: true, size: true },
        }),
      'Sku',
    );
    await recordAudit(this.prisma, {
      actorType: 'STAFF',
      actorStaffId,
      action: 'sku.update',
      entityType: 'Sku',
      entityId: skuId,
      oldValue: { barcode: sku.barcode, isActive: sku.isActive },
      newValue: { barcode: updated.barcode, isActive: updated.isActive },
      reference: sku.styleId,
    });
    return updated;
  }

  /** Links every SKU of a style to one size chart (its measurements), or unlinks them (null). */
  async assignSizeChart(styleId: string, sizeChartId: string | null, actorStaffId: string) {
    await this.getStyle(styleId);
    if (sizeChartId) {
      const chart = await this.prisma.sizeChart.findUnique({ where: { id: sizeChartId } });
      if (!chart || !chart.isActive) throw new ValidationError('Choose an active size chart');
    }
    const { count } = await this.prisma.sku.updateMany({ where: { styleId }, data: { sizeChartId } });
    await recordAudit(this.prisma, {
      actorType: 'STAFF',
      actorStaffId,
      action: 'style.size_chart',
      entityType: 'Style',
      entityId: styleId,
      newValue: { sizeChartId, skus: count },
    });
    return { updated: count };
  }

  /** Brands, categories (with product type), sizes and size charts for the product workspace. */
  async getReferenceData() {
    const [brands, categories, sizes, sizeCharts] = await Promise.all([
      this.prisma.brand.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, code: true, name: true } }),
      this.prisma.category.findMany({
        where: { isActive: true },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, slug: true, productType: true, parentId: true },
      }),
      this.prisma.size.findMany({ orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }], select: { id: true, label: true, sortOrder: true } }),
      this.prisma.sizeChart.findMany({
        where: { isActive: true },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, gender: true, category: true, entries: { select: { sizeLabel: true, measurements: true } } },
      }),
    ]);
    return { brands, categories, sizes, sizeCharts };
  }

  /** Adds a size label (e.g. "UK 8", "100 ml") to the shared size list. */
  async createSize(label: string, actorStaffId: string) {
    const clean = label.trim().replace(/\s+/g, ' ');
    if (!clean || clean.length > 20) throw new ValidationError('A size label is 1-20 characters');
    const existing = await this.prisma.size.findFirst({ where: { label: { equals: clean, mode: 'insensitive' } } });
    if (existing) throw new ConflictError(`Size ${existing.label} already exists`);
    const last = await this.prisma.size.aggregate({ _max: { sortOrder: true } });
    const size = await withUniqueConstraintCheck(
      () => this.prisma.size.create({ data: { label: clean, sortOrder: (last._max.sortOrder ?? 0) + 1 } }),
      'Size',
    );
    await recordAudit(this.prisma, { actorType: 'STAFF', actorStaffId, action: 'size.create', entityType: 'Size', entityId: size.id, newValue: { label: clean } });
    return size;
  }

  /** Sets which attributes and sizes the workspace offers for a category. */
  async updateCategoryProductType(categoryId: string, productType: 'APPAREL' | 'FOOTWEAR' | 'BELT' | 'FRAGRANCE', actorStaffId: string) {
    const category = await this.prisma.category.findUnique({ where: { id: categoryId } });
    if (!category) throw new NotFoundError('Category', categoryId);
    const updated = await this.prisma.category.update({ where: { id: categoryId }, data: { productType } });
    await recordAudit(this.prisma, {
      actorType: 'STAFF',
      actorStaffId,
      action: 'category.product_type',
      entityType: 'Category',
      entityId: categoryId,
      oldValue: { productType: category.productType },
      newValue: { productType },
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

/** Upper-case letters and digits of a size label, e.g. "UK 8" -> "UK8", "100 ml" -> "100ML". */
export function skuCodePart(label: string): string {
  const part = label.toUpperCase().replace(/[^A-Z0-9]+/g, '');
  return part || 'SIZE';
}
