import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@fcp/db';
import { NotFoundError, ValidationError } from '@fcp/shared';
import { recordAudit } from '../audit/service.js';
import { CatalogService } from '../catalog/service.js';
import { ProductService, skuCodePart, type CreateStyleInput } from './service.js';

/**
 * Admin Ops Phase 1: bulk product import (docs/admin/ADMIN_OPS_PHASE1.md).
 *
 * One row = one sellable variant (product + colour + size), or a product-only
 * row when colour and size are blank. Rules the owner can rely on:
 *
 * - Matching is by stable identifiers: product by style code; colour by
 *   colour code within the product (or, when the code is blank, by colour
 *   name); size by its label; SKU by product + colour + size. Running the
 *   same file twice changes nothing the second time.
 * - A blank cell means "leave as it is". Import never clears a value.
 * - Import never changes stock (there is no stock column; stock comes from
 *   receiving), never publishes (new products start as drafts) and never
 *   reserves anything.
 * - Validation (dry run) reads only. Apply works product by product: a
 *   product with any row error is skipped whole; other products go ahead.
 *   Each product is saved in one transaction (see apply), so a failure or
 *   crash part-way leaves that product exactly as it was; re-running the
 *   batch saves it. Products already saved come back as "unchanged".
 * - Prices are appended to the price history, never edited or deleted.
 */

export const IMPORT_COLUMNS = [
  'style_code', 'name', 'brand', 'category', 'season', 'collection', 'gender', 'department', 'fabric', 'fit', 'pattern',
  'occasion', 'sleeve', 'neck', 'care', 'country_of_origin', 'hsn_code', 'subtitle', 'colour_name', 'colour_code',
  'colour_hex', 'size', 'sku_code', 'barcode', 'mrp', 'selling_price', 'image_url', 'image_alt',
] as const;
export type ImportColumn = (typeof IMPORT_COLUMNS)[number];
export type ImportRow = { row: number } & Partial<Record<ImportColumn, string>>;

export type RowOutcome = 'create' | 'update' | 'unchanged' | 'error' | 'skipped';
export interface RowResult {
  row: number;
  styleCode: string;
  outcome: RowOutcome;
  changes: string[];
  messages: string[];
}

/** Style column -> Style field, for the plain text attributes. */
const STYLE_TEXT: Array<[ImportColumn, keyof CreateStyleInput]> = [
  ['name', 'name'], ['season', 'season'], ['collection', 'collection'], ['gender', 'gender'], ['department', 'department'],
  ['fabric', 'fabric'], ['fit', 'fit'], ['pattern', 'pattern'], ['occasion', 'occasion'], ['sleeve', 'sleeve'], ['neck', 'neck'],
  ['care', 'washCare'], ['country_of_origin', 'countryOfOrigin'], ['hsn_code', 'hsnCode'],
];
const STYLE_LEVEL: ImportColumn[] = ['name', 'brand', 'category', 'season', 'collection', 'gender', 'department', 'fabric', 'fit', 'pattern', 'occasion', 'sleeve', 'neck', 'care', 'country_of_origin', 'hsn_code', 'subtitle'];
const LABEL: Partial<Record<ImportColumn, string>> = { hsn_code: 'HSN code', care: 'care', country_of_origin: 'country of origin', colour_hex: 'colour hex', sku_code: 'SKU code', selling_price: 'selling price', image_url: 'image URL', image_alt: 'image text' };
const label = (c: ImportColumn) => LABEL[c] ?? c.replace(/_/g, ' ');
const v = (row: ImportRow, c: ImportColumn) => row[c]?.trim() ?? '';
const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

interface Reference {
  brands: Map<string, { id: string; name: string }>;
  categories: Map<string, { id: string; name: string }>;
  sizes: Map<string, { id: string; label: string }>;
}

interface PlannedVariant {
  row: ImportRow;
  colour: { key: string; name: string; code: string; hex: string | null; existingId: string | null } | null;
  sizeId: string | null;
  sizeLabel: string | null;
  skuCode: string | null;
  barcode: string | null;
  existingSku: { id: string; skuCode: string; barcode: string | null } | null;
  price: { mrp: number; sellingPrice: number } | null;
  image: { url: string; alt: string | null } | null;
  result: RowResult;
}

type Db = Prisma.TransactionClient;

interface PlannedStyle {
  styleCode: string;
  existing: Awaited<ReturnType<ImportService['loadStyle']>>;
  fields: Partial<CreateStyleInput>;
  subtitle: string | null;
  variants: PlannedVariant[];
  hasError: boolean;
  priceByColourKey: Map<string, { mrp: number; sellingPrice: number }>;
  uniformPrice: { mrp: number; sellingPrice: number } | null;
  /** Price changes the plan needs (scope null = all colours). */
  priceChanges: Array<{ colourKey: string | null; mrp: number; sellingPrice: number }>;
}

export class ImportService {
  constructor(private readonly fastify: FastifyInstance) {}

  private get prisma() {
    return this.fastify.prisma;
  }

  private async loadReference(db: Db): Promise<Reference> {
    const [brands, categories, sizes] = await Promise.all([
      db.brand.findMany({ where: { isActive: true } }),
      db.category.findMany({ where: { isActive: true } }),
      db.size.findMany(),
    ]);
    const ref: Reference = { brands: new Map(), categories: new Map(), sizes: new Map() };
    for (const b of brands) {
      ref.brands.set(norm(b.code), b);
      ref.brands.set(norm(b.name), b);
    }
    for (const c of categories) {
      ref.categories.set(norm(c.slug), c);
      ref.categories.set(norm(c.name), c);
    }
    for (const s of sizes) ref.sizes.set(norm(s.label), s);
    return ref;
  }

  private loadStyle(db: Db, styleCode: string) {
    return db.style.findUnique({
      where: { styleCode },
      include: { colours: true, skus: true, media: { select: { url: true } }, prices: true },
    });
  }

  /** Builds the full plan for a batch; reads only (through `db`). */
  private async plan(rows: ImportRow[], canWritePrices: boolean, db: Db = this.prisma): Promise<PlannedStyle[]> {
    if (rows.length === 0) throw new ValidationError('The batch has no rows');
    const ref = await this.loadReference(db);
    const groups = new Map<string, ImportRow[]>();
    const orphanResults: PlannedStyle[] = [];
    for (const row of rows) {
      const code = v(row, 'style_code').toUpperCase();
      if (!code) {
        orphanResults.push({
          styleCode: '', existing: null, fields: {}, subtitle: null, hasError: true, priceByColourKey: new Map(), uniformPrice: null, priceChanges: [],
          variants: [{ row, colour: null, sizeId: null, sizeLabel: null, skuCode: null, barcode: null, existingSku: null, price: null, image: null, result: { row: row.row, styleCode: '', outcome: 'error', changes: [], messages: ['Style code is required on every row'] } }],
        });
        continue;
      }
      if (!/^[A-Z0-9][A-Z0-9_-]{0,63}$/.test(code)) {
        orphanResults.push({
          styleCode: code, existing: null, fields: {}, subtitle: null, hasError: true, priceByColourKey: new Map(), uniformPrice: null, priceChanges: [],
          variants: [{ row, colour: null, sizeId: null, sizeLabel: null, skuCode: null, barcode: null, existingSku: null, price: null, image: null, result: { row: row.row, styleCode: code, outcome: 'error', changes: [], messages: ['Style code may use letters, digits, - and _ only (up to 64)'] } }],
        });
        continue;
      }
      const list = groups.get(code) ?? [];
      list.push(row);
      groups.set(code, list);
    }

    // Barcodes and SKU codes must be unique across the batch.
    const barcodeRows = new Map<string, number[]>();
    const skuCodeRows = new Map<string, number[]>();
    for (const row of rows) {
      const b = v(row, 'barcode');
      if (b) barcodeRows.set(b, [...(barcodeRows.get(b) ?? []), row.row]);
      const s = v(row, 'sku_code').toUpperCase();
      if (s) skuCodeRows.set(s, [...(skuCodeRows.get(s) ?? []), row.row]);
    }

    const planned: PlannedStyle[] = [];
    for (const [styleCode, groupRows] of groups) {
      const existing = await this.loadStyle(db, styleCode);
      const style: PlannedStyle = { styleCode, existing, fields: {}, subtitle: null, variants: [], hasError: false, priceByColourKey: new Map(), uniformPrice: null, priceChanges: [] };
      const styleMessages: string[] = [];

      // Style-level values: the first non-blank value; a different non-blank value elsewhere is a conflict.
      const firstValue = new Map<ImportColumn, { value: string; row: number }>();
      for (const row of groupRows) {
        for (const c of STYLE_LEVEL) {
          const value = v(row, c);
          if (!value) continue;
          const seen = firstValue.get(c);
          if (!seen) firstValue.set(c, { value, row: row.row });
          else if (seen.value !== value) styleMessages.push(`Rows ${seen.row} and ${row.row} give different ${label(c)} values for ${styleCode}`);
        }
      }
      const get = (c: ImportColumn) => firstValue.get(c)?.value;
      if (existing?.lifecycleState === 'ARCHIVED') styleMessages.push(`${styleCode} is archived and cannot be changed by import`);

      // Brand and category references.
      let brandId: string | undefined;
      let categoryId: string | undefined;
      if (get('brand')) {
        const brand = ref.brands.get(norm(get('brand')!));
        if (!brand) styleMessages.push(`Brand "${get('brand')}" is not set up (use a brand code or name from Setup)`);
        else brandId = brand.id;
      }
      if (get('category')) {
        const category = ref.categories.get(norm(get('category')!));
        if (!category) styleMessages.push(`Category "${get('category')}" does not exist (use its name or web address name)`);
        else categoryId = category.id;
      }
      if (!existing) {
        for (const c of ['name', 'brand', 'category', 'season', 'collection'] as ImportColumn[]) {
          if (!get(c)) styleMessages.push(`A new product needs ${label(c)}`);
        }
      }
      if (get('hsn_code') && !/^\d{2,8}$/.test(get('hsn_code')!)) styleMessages.push('HSN code is digits only (2 to 8)');

      // Style field changes (blank = unchanged).
      const changes: string[] = [];
      for (const [column, field] of STYLE_TEXT) {
        const value = get(column);
        if (value === undefined) continue;
        if (!existing || (existing as Record<string, unknown>)[field] !== value) {
          (style.fields as Record<string, unknown>)[field] = value;
          if (existing) changes.push(label(column));
        }
      }
      if (brandId && brandId !== existing?.brandId) {
        style.fields.brandId = brandId;
        if (existing) changes.push('brand');
      }
      if (categoryId && categoryId !== existing?.categoryId) {
        style.fields.categoryId = categoryId;
        if (existing) changes.push('category');
      }
      const currentSubtitle = (existing?.customAttributes as { subtitle?: unknown } | null)?.subtitle;
      if (get('subtitle') && get('subtitle') !== currentSubtitle) {
        style.subtitle = get('subtitle')!;
        if (existing) changes.push('subtitle');
      }

      // Variants.
      const coloursByKey = new Map<string, PlannedVariant['colour']>();
      const seenVariant = new Map<string, number>();
      for (const row of groupRows) {
        const result: RowResult = { row: row.row, styleCode, outcome: 'unchanged', changes: [], messages: [] };
        const variant: PlannedVariant = { row, colour: null, sizeId: null, sizeLabel: null, skuCode: null, barcode: null, existingSku: null, price: null, image: null, result };
        const colourName = v(row, 'colour_name');
        const colourCode = v(row, 'colour_code').toUpperCase();
        const hex = v(row, 'colour_hex');
        const sizeText = v(row, 'size');

        if (colourName || colourCode) {
          let match = existing?.colours.find((c) => (colourCode ? c.colourCode === colourCode : norm(c.name) === norm(colourName))) ?? null;
          const code = colourCode || match?.colourCode || colourName.toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 12);
          if (!code) result.messages.push('Colour code could not be made from the colour name; add a colour code');
          if (colourCode && !/^[A-Z0-9-]{1,16}$/.test(colourCode)) result.messages.push('Colour code may use letters, digits and - only (up to 16)');
          if (hex && !/^#[0-9a-f]{6}$/i.test(hex)) result.messages.push('Colour hex must look like #1A2B3C');
          if (!match && code) match = existing?.colours.find((c) => c.colourCode === code) ?? null;
          if (!match && !colourName) result.messages.push(`Colour code ${code} is new for ${styleCode}; give its colour name too`);
          const key = code;
          const known = coloursByKey.get(key);
          if (known && colourName && norm(known.name) !== norm(colourName)) result.messages.push(`Colour code ${code} is used with two names in this file`);
          const colour = known ?? { key, name: colourName || match?.name || code, code, hex: hex || null, existingId: match?.id ?? null };
          coloursByKey.set(key, colour);
          variant.colour = colour;
          if (!match && !known) result.changes.push(`new colour ${colour.name}`);
          else if (match && colourName && norm(match.name) !== norm(colourName)) result.messages.push(`Colour ${code} is called "${match.name}"; rename it in the product workspace, not by import`);
          else if (match && hex && match.hexSwatch?.toLowerCase() !== hex.toLowerCase() && !known) result.changes.push(`swatch for ${match.name}`);
        }

        if (sizeText) {
          if (!variant.colour) result.messages.push('A size needs a colour on the same row');
          const size = ref.sizes.get(norm(sizeText));
          if (!size) result.messages.push(`Size "${sizeText}" is not set up. Add it in Products → a product → Sizes, or fix the row`);
          else {
            variant.sizeId = size.id;
            variant.sizeLabel = size.label;
          }
        } else if (v(row, 'sku_code') || v(row, 'barcode')) {
          result.messages.push('SKU code and barcode need a size on the same row');
        }

        if (variant.colour && variant.sizeId) {
          const vkey = `${variant.colour.key}:${variant.sizeId}`;
          if (seenVariant.has(vkey)) result.messages.push(`Same colour and size as row ${seenVariant.get(vkey)}`);
          else seenVariant.set(vkey, row.row);
          const sku = variant.colour.existingId ? existing?.skus.find((s) => s.colourId === variant.colour!.existingId && s.sizeId === variant.sizeId) ?? null : null;
          variant.existingSku = sku ? { id: sku.id, skuCode: sku.skuCode, barcode: sku.barcode } : null;
          const wantedCode = v(row, 'sku_code').toUpperCase();
          if (wantedCode && !/^[A-Z0-9][A-Z0-9_-]{0,63}$/.test(wantedCode)) result.messages.push('SKU code may use letters, digits, - and _ only');
          if (wantedCode && (skuCodeRows.get(wantedCode)?.length ?? 0) > 1) result.messages.push(`SKU code ${wantedCode} is on rows ${skuCodeRows.get(wantedCode)!.join(', ')}`);
          if (sku) {
            if (wantedCode && wantedCode !== sku.skuCode) result.messages.push(`This size already has SKU code ${sku.skuCode}; SKU codes cannot be changed by import`);
          } else {
            if (wantedCode) {
              const clash = await db.sku.findUnique({ where: { skuCode: wantedCode } });
              if (clash) result.messages.push(`SKU code ${wantedCode} is already used by another product`);
            }
            variant.skuCode = wantedCode || null;
            result.changes.push(`new size ${variant.sizeLabel}`);
          }
          const barcode = v(row, 'barcode');
          if (barcode) {
            if (!/^[0-9A-Za-z-]{4,64}$/.test(barcode)) result.messages.push('A barcode is 4-64 letters, digits or dashes');
            if ((barcodeRows.get(barcode)?.length ?? 0) > 1) result.messages.push(`Barcode ${barcode} is on rows ${barcodeRows.get(barcode)!.join(', ')}`);
            const owner = await db.sku.findUnique({ where: { barcode } });
            if (owner && owner.id !== sku?.id) result.messages.push(`Barcode ${barcode} is already used by ${owner.skuCode}`);
            if (barcode !== sku?.barcode) {
              variant.barcode = barcode;
              if (sku) result.changes.push('barcode');
            }
          }
        }

        const mrpText = v(row, 'mrp');
        const sellingText = v(row, 'selling_price');
        if (mrpText || sellingText) {
          const mrp = Number(mrpText.replace(/,/g, ''));
          const sellingPrice = Number(sellingText.replace(/,/g, ''));
          if (!mrpText || !sellingText) result.messages.push('Give both MRP and selling price, or neither');
          else if (!Number.isFinite(mrp) || !Number.isFinite(sellingPrice) || mrp <= 0 || sellingPrice <= 0) result.messages.push('Prices must be numbers above zero');
          else if (sellingPrice > mrp) result.messages.push('Selling price cannot be above MRP');
          else if (Math.round(mrp * 100) !== mrp * 100 || Math.round(sellingPrice * 100) !== sellingPrice * 100) result.messages.push('Prices can have at most 2 decimal places');
          else if (!canWritePrices) result.messages.push('You do not have permission to set prices (catalog:price:write); remove the price columns or ask for access');
          else variant.price = { mrp, sellingPrice };
        }

        const imageUrl = v(row, 'image_url');
        if (imageUrl) {
          let ok = false;
          try {
            const url = new URL(imageUrl);
            ok = url.protocol === 'https:' && Boolean(url.hostname);
          } catch {
            ok = false;
          }
          if (!ok) result.messages.push('Image URL must be a full https:// address (upload files in the product workspace instead)');
          else if (!existing?.media.some((m) => m.url === imageUrl) && !style.variants.some((p) => p.image?.url === imageUrl)) {
            variant.image = { url: imageUrl, alt: v(row, 'image_alt') || null };
            result.changes.push('new image');
          }
        }

        style.variants.push(variant);
      }

      // Price scope: one price for all colours when every priced row agrees; otherwise per colour.
      const priced = style.variants.filter((p) => p.price);
      const distinct = new Set(priced.map((p) => `${p.price!.mrp}/${p.price!.sellingPrice}`));
      if (priced.length > 0 && distinct.size === 1) {
        style.uniformPrice = priced[0]!.price;
      } else {
        for (const p of priced) {
          const key = p.colour?.key ?? '';
          const seen = style.priceByColourKey.get(key);
          if (!key) p.result.messages.push('Different prices across colours need a colour on each priced row');
          else if (seen && (seen.mrp !== p.price!.mrp || seen.sellingPrice !== p.price!.sellingPrice)) p.result.messages.push(`Two different prices for colour ${p.colour!.name}; sizes of one colour share a price`);
          else style.priceByColourKey.set(key, p.price!);
        }
      }
      const currentBase = (colourId: string | null) =>
        existing?.prices
          .filter((p) => !p.isMarkdown && (p.colourId ?? null) === colourId && p.effectiveFrom <= new Date() && (!p.effectiveTo || p.effectiveTo >= new Date()))
          .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0] ?? null;
      const same = (p: { mrp: unknown; sellingPrice: unknown } | null, target: { mrp: number; sellingPrice: number }) =>
        p !== null && Number(p.mrp) === target.mrp && Number(p.sellingPrice) === target.sellingPrice;
      if (style.uniformPrice) {
        if (!same(currentBase(null), style.uniformPrice)) {
          style.priceChanges.push({ colourKey: null, ...style.uniformPrice });
          priced[0]!.result.changes.push(existing?.prices.length ? 'price' : 'new price');
          const now = new Date();
          const markdown = existing?.prices.find((p) => p.isMarkdown && p.effectiveFrom <= now && (!p.effectiveTo || p.effectiveTo >= now));
          if (markdown) {
            priced[0]!.result.messages.push(
              `Note: a markdown is running${markdown.effectiveTo ? ` until ${markdown.effectiveTo.toISOString().slice(0, 10)}` : ''}; shoppers see the markdown price until it ends, then this price.`,
            );
          }
        }
      } else {
        for (const [key, price] of style.priceByColourKey) {
          const colour = coloursByKey.get(key)!;
          // Compare with the base price this colour sells at now: its own,
          // else the all-colour price. A colour whose price is not changing
          // gets no new row.
          const effective = (colour.existingId ? currentBase(colour.existingId) : null) ?? currentBase(null);
          if (!same(effective, price)) {
            style.priceChanges.push({ colourKey: key, ...price });
            priced.find((p) => p.colour?.key === key)!.result.changes.push(`price for ${colour.name}`);
          }
        }
        if (style.priceByColourKey.size > 0 && !currentBase(null)) {
          priced[0]!.result.messages.push('Note: with a different price per colour there is no single price for all colours, so the storefront will not list this product until one is set in the product workspace.');
        }
      }

      // Outcomes.
      const firstRow = style.variants[0]!.result;
      firstRow.changes.unshift(...changes);
      if (!existing) firstRow.changes.unshift('new product (draft)');
      for (const message of styleMessages) firstRow.messages.push(message);
      const isError = (m: string) => !m.startsWith('Note:');
      style.hasError = style.variants.some((p) => p.result.messages.some(isError));
      for (const p of style.variants) {
        if (p.result.messages.some(isError)) p.result.outcome = 'error';
        else if (style.hasError) {
          p.result.outcome = 'skipped';
          p.result.messages.push('Not imported: another row of this product has an error');
        } else if (!existing) p.result.outcome = 'create';
        else p.result.outcome = p.result.changes.length > 0 ? 'update' : 'unchanged';
      }
      planned.push(style);
    }
    return [...orphanResults, ...planned];
  }

  /** Dry run: what an import of these rows would do. Writes nothing. */
  async validate(rows: ImportRow[], canWritePrices: boolean): Promise<RowResult[]> {
    const plan = await this.plan(rows, canWritePrices);
    return plan.flatMap((s) => s.variants.map((p) => p.result)).sort((a, b) => a.row - b.row);
  }

  /**
   * Applies one batch and returns per-row outcomes, plus the ids of every
   * existing product in the batch for re-indexing (saved ones and unchanged
   * ones alike, so a retry after an interruption also repairs search).
   *
   * Each product is saved in ONE transaction: its style, colours, sizes,
   * prices, images and their audit entries commit together or not at all,
   * so a failure (or a crash) part-way never leaves a half-built product.
   * The transaction first takes a lock on the product's style code, then
   * re-plans that product against the state now committed. Two imports of
   * the same product therefore run one after the other, and the second
   * sees the first's work (its rows become "unchanged") instead of
   * creating the same colour or price twice. Products in a batch are
   * independent: one failing does not undo the others.
   */
  async apply(rows: ImportRow[], canWritePrices: boolean, actorStaffId: string): Promise<{ results: RowResult[]; touchedStyleIds: string[] }> {
    const plan = await this.plan(rows, canWritePrices);
    const touched = new Set<string>();
    const results = new Map<number, RowResult>();
    for (const style of plan) {
      for (const p of style.variants) results.set(p.row.row, p.result);
      if (style.hasError || !style.styleCode) continue;
      if (!style.variants.some((p) => p.result.outcome === 'create' || p.result.outcome === 'update')) {
        // Nothing to save, but still re-index: if an earlier run saved this
        // product and stopped before updating search, the retry repairs it.
        if (style.existing) touched.add(style.existing.id);
        continue;
      }
      const styleRows = style.variants.map((p) => p.row);
      try {
        const outcome = await this.prisma.$transaction(
          async (tx) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`product-import:${style.styleCode}`}, 0))`;
            const [fresh] = await this.plan(styleRows, canWritePrices, tx);
            if (!fresh || fresh.hasError) return { fresh, styleId: null };
            const styleId = await this.writeStyle(fresh, tx, actorStaffId);
            return { fresh, styleId };
          },
          { maxWait: 10_000, timeout: 60_000 },
        );
        for (const p of outcome.fresh?.variants ?? []) results.set(p.row.row, p.result);
        if (outcome.styleId) touched.add(outcome.styleId);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        for (const p of style.variants) {
          if (p.result.outcome !== 'create' && p.result.outcome !== 'update') continue;
          p.result.outcome = 'error';
          p.result.messages.push(`Not saved: ${message}. Nothing was changed for ${style.styleCode}; fix the problem and run the import again.`);
        }
      }
    }
    return { results: [...results.values()].sort((a, b) => a.row - b.row), touchedStyleIds: [...touched] };
  }

  /** Writes one planned product inside `tx`; returns its style id (null when nothing needed saving). */
  private async writeStyle(style: PlannedStyle, tx: Db, actorStaffId: string): Promise<string | null> {
    const pending = style.variants.filter((p) => p.result.outcome === 'create' || p.result.outcome === 'update');
    if (pending.length === 0) return null;
    const products = new ProductService(this.fastify, tx);
    const catalog = new CatalogService(this.fastify, tx);

    let styleId = style.existing?.id;
    if (!styleId) {
      const created = await products.createStyle(
        {
          ...(style.fields as CreateStyleInput),
          styleCode: style.styleCode,
          ...(style.subtitle ? { customAttributes: { subtitle: style.subtitle } } : {}),
        },
        actorStaffId,
      );
      styleId = created.id;
    } else if (Object.keys(style.fields).length > 0 || style.subtitle) {
      await products.updateStyle(styleId, { ...style.fields, ...(style.subtitle ? { customAttributes: { subtitle: style.subtitle } } : {}) }, actorStaffId);
    }

    const colourIds = new Map<string, string>();
    for (const p of style.variants) {
      if (!p.colour || colourIds.has(p.colour.key)) continue;
      if (p.colour.existingId) {
        colourIds.set(p.colour.key, p.colour.existingId);
        const current = style.existing?.colours.find((c) => c.id === p.colour!.existingId);
        if (p.colour.hex && current?.hexSwatch?.toLowerCase() !== p.colour.hex.toLowerCase()) {
          await products.updateColour(p.colour.existingId, { hexSwatch: p.colour.hex }, actorStaffId);
        }
      } else {
        const colour = await products.addColour(styleId, { name: p.colour.name, colourCode: p.colour.code, ...(p.colour.hex ? { hexSwatch: p.colour.hex } : {}) }, actorStaffId);
        colourIds.set(p.colour.key, colour.id);
      }
    }

    for (const p of style.variants) {
      if (!p.colour || !p.sizeId) continue;
      const colourId = colourIds.get(p.colour.key)!;
      if (p.existingSku) {
        if (p.barcode) await products.updateSku(p.existingSku.id, { barcode: p.barcode }, actorStaffId);
      } else {
        const skuCode = p.skuCode ?? (await products.uniqueSkuCode(`${style.styleCode}-${p.colour.code}-${skuCodePart(p.sizeLabel!)}`));
        await products.createSku({ styleId, colourId, sizeId: p.sizeId, skuCode, ...(p.barcode ? { barcode: p.barcode } : {}) }, actorStaffId);
      }
    }

    // Prices are appended, never edited or deleted: the previous price stays
    // in the history and the newest one in effect is what shoppers see.
    for (const change of style.priceChanges) {
      await catalog.setBasePrice(
        { styleId, ...(change.colourKey ? { colourId: colourIds.get(change.colourKey)! } : {}), mrp: change.mrp, sellingPrice: change.sellingPrice },
        actorStaffId,
      );
    }

    for (const p of style.variants) {
      if (!p.image) continue;
      await products.addMedia(
        { styleId, url: p.image.url, ...(p.colour ? { colourId: colourIds.get(p.colour.key)! } : {}), ...(p.image.alt ? { altText: p.image.alt } : {}) },
        actorStaffId,
      );
    }
    return styleId;
  }

  // --- Import runs (results kept for the owner to come back to) ---

  async createRun(input: { fileName: string; totalRows: number; totalBatches: number }, actorStaffId: string) {
    return this.prisma.productImportRun.create({ data: { ...input, createdByStaffId: actorStaffId } });
  }

  async recordBatch(runId: string, batchIndex: number, results: RowResult[], actorStaffId: string) {
    return this.prisma.$transaction(async (tx) => {
      const run = await tx.$queryRaw<Array<{ batchResults: unknown; totalBatches: number }>>`
        SELECT "batchResults", "totalBatches" FROM product_import_runs WHERE id = ${runId} FOR UPDATE`;
      if (run.length === 0) throw new NotFoundError('ProductImportRun', runId);
      if (batchIndex >= run[0]!.totalBatches) throw new ValidationError(`Batch ${batchIndex + 1} is outside this import (it has ${run[0]!.totalBatches})`);
      const batches = { ...((run[0]!.batchResults as Record<string, RowResult[]>) ?? {}), [String(batchIndex)]: results };
      const updated = await tx.productImportRun.update({ where: { id: runId }, data: { batchResults: batches as unknown as Prisma.InputJsonValue } });
      await recordAudit(tx, {
        actorType: 'STAFF',
        actorStaffId,
        action: 'product.import.batch',
        entityType: 'ProductImportRun',
        entityId: runId,
        newValue: summarise(results) as unknown as Record<string, unknown>,
      });
      return updated;
    });
  }

  async getRun(runId: string) {
    const run = await this.prisma.productImportRun.findUnique({ where: { id: runId }, include: { createdByStaff: { select: { fullName: true } } } });
    if (!run) throw new NotFoundError('ProductImportRun', runId);
    const results = Object.values((run.batchResults as unknown as Record<string, RowResult[]>) ?? {}).flat().sort((a, b) => a.row - b.row);
    return {
      id: run.id,
      fileName: run.fileName,
      totalRows: run.totalRows,
      totalBatches: run.totalBatches,
      batchesDone: Object.keys((run.batchResults as object) ?? {}).length,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      createdBy: run.createdByStaff.fullName,
      summary: summarise(results),
      results,
    };
  }

  async listRuns(take = 20) {
    const runs = await this.prisma.productImportRun.findMany({ orderBy: { createdAt: 'desc' }, take, include: { createdByStaff: { select: { fullName: true } } } });
    return runs.map((run) => {
      const results = Object.values((run.batchResults as unknown as Record<string, RowResult[]>) ?? {}).flat();
      return {
        id: run.id,
        fileName: run.fileName,
        totalRows: run.totalRows,
        totalBatches: run.totalBatches,
        batchesDone: Object.keys((run.batchResults as object) ?? {}).length,
        createdAt: run.createdAt,
        createdBy: run.createdByStaff.fullName,
        summary: summarise(results),
      };
    });
  }
}

export function summarise(results: RowResult[]) {
  const count = (o: RowOutcome) => results.filter((r) => r.outcome === o).length;
  return { rows: results.length, create: count('create'), update: count('update'), unchanged: count('unchanged'), error: count('error'), skipped: count('skipped') };
}
