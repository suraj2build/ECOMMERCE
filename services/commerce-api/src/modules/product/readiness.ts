import type { FastifyInstance } from 'fastify';
import { loadEnv } from '@fcp/config';
import { NotFoundError } from '@fcp/shared';
import { CatalogService } from '../catalog/service.js';
import { InventoryService } from '../inventory/service.js';
import { ProductService } from './service.js';

/** The product workspace steps a requirement can point to. */
export type WorkspaceStep = 'basics' | 'variants' | 'photos' | 'pricing' | 'publish';

export interface ReadinessIssue {
  step: WorkspaceStep;
  message: string;
  /** True when it stops the product being published or bought. */
  blocking: boolean;
}

export interface ChannelReadiness {
  id: string;
  name: string;
  active: boolean;
  /** ALL = every product that can be bought is sent automatically; SELECTED = only SKUs sent by hand. */
  scope: 'ALL' | 'SELECTED';
  sizesListed: number;
  sizesFailed: number;
  sizesNeedingCheck: number;
  notes: string[];
}

export interface ProductReadiness {
  productType: 'APPAREL' | 'FOOTWEAR' | 'BELT' | 'FRAGRANCE';
  lifecycleState: string;
  steps: Record<Exclude<WorkspaceStep, 'publish'>, 'complete' | 'incomplete'>;
  published: boolean;
  purchasable: { ok: boolean; reasons: string[] };
  stock: { availableUnits: number; sizesInStock: number; sizesForSale: number };
  channels: ChannelReadiness[];
  issues: ReadinessIssue[];
  coverMediaId: string | null;
  next: { step: WorkspaceStep; label: string } | null;
}

const PRODUCT_TYPES = ['APPAREL', 'FOOTWEAR', 'BELT', 'FRAGRANCE'] as const;

/**
 * Admin Ops Phase 1: one read-only answer to "what is still missing?" for a
 * product. It keeps four facts separate that the owner often conflates:
 * published (the lifecycle state), purchasable (published + a price + at
 * least one size on sale - the same gate the storefront and channel feed
 * use), in stock (the inventory ledger's available-to-sell, the formula the
 * product page uses) and channel-ready (per channel). It reuses the
 * existing QA gate, catalogue price resolution and inventory formula; it
 * decides nothing and changes nothing.
 */
export class ProductReadinessService {
  private readonly products: ProductService;
  private readonly catalog: CatalogService;
  private readonly inventory: InventoryService;

  constructor(private readonly fastify: FastifyInstance) {
    this.products = new ProductService(fastify);
    this.catalog = new CatalogService(fastify);
    this.inventory = new InventoryService(fastify);
  }

  async evaluate(styleId: string): Promise<ProductReadiness> {
    const prisma = this.fastify.prisma;
    const style = await prisma.style.findUnique({
      where: { id: styleId },
      include: {
        category: true,
        brand: true,
        colours: true,
        skus: { include: { colour: true, size: true } },
        media: { where: { type: 'IMAGE' }, orderBy: [{ isCover: 'desc' }, { colourId: { sort: 'asc', nulls: 'first' } }, { sortOrder: 'asc' }] },
      },
    });
    if (!style) throw new NotFoundError('Style', styleId);

    const issues: ReadinessIssue[] = [];
    const attrType = (style.customAttributes as { productType?: unknown } | null)?.productType;
    const productType =
      typeof attrType === 'string' && (PRODUCT_TYPES as readonly string[]).includes(attrType.toUpperCase())
        ? (attrType.toUpperCase() as ProductReadiness['productType'])
        : style.category.productType;

    // Basics
    if (!style.hsnCode) issues.push({ step: 'basics', message: 'HSN code is missing. Invoices need it (TAX-003).', blocking: false });
    if (!style.gender && !style.department) issues.push({ step: 'basics', message: 'Choose Men or Women so the product appears in the right department.', blocking: false });

    // Variants (reuses the QA completeness gate's own rules, reworded)
    const qa = await this.products.evaluateQaCompleteness(styleId);
    const activeSkus = style.skus.filter((sku) => sku.isActive);
    if (style.colours.length === 0) issues.push({ step: 'variants', message: 'Add at least one colour.', blocking: true });
    if (style.skus.length === 0) issues.push({ step: 'variants', message: 'Add the sizes you sell.', blocking: true });
    for (const colour of style.colours) {
      if (!style.skus.some((sku) => sku.colourId === colour.id)) issues.push({ step: 'variants', message: `${colour.name} has no sizes yet.`, blocking: true });
    }
    if (style.skus.length > 0 && activeSkus.length === 0) issues.push({ step: 'variants', message: 'Every size is turned off, so nothing can be bought.', blocking: true });
    const missingBarcodes = activeSkus.filter((sku) => !sku.barcode).length;
    if (missingBarcodes > 0) issues.push({ step: 'variants', message: `${missingBarcodes} size${missingBarcodes === 1 ? ' has' : 's have'} no barcode. Receiving and packing scan barcodes.`, blocking: false });

    // Photos
    if (style.media.length === 0) issues.push({ step: 'photos', message: 'Add at least one photo.', blocking: true });
    for (const colour of style.colours) {
      const has = style.media.some((m) => m.colourId === colour.id || m.colourId === null);
      if (style.media.length > 0 && !has) issues.push({ step: 'photos', message: `${colour.name} has no photo; shoppers choosing it see none.`, blocking: false });
    }
    if (style.media.some((m) => !m.altText?.trim())) issues.push({ step: 'photos', message: 'Some photos have no description for screen readers.', blocking: false });

    // Pricing: every colour must resolve a price, using the catalogue's own rule.
    for (const colour of style.colours) {
      if (!(await this.catalog.getActivePrice(styleId, colour.id))) issues.push({ step: 'pricing', message: `${colour.name} has no price in effect.`, blocking: true });
    }
    const stylePrice = await this.catalog.getActivePrice(styleId);
    if (style.colours.length === 0 && !stylePrice) issues.push({ step: 'pricing', message: 'Set a price.', blocking: true });

    // Lifecycle / publishing
    const published = style.lifecycleState === 'PUBLISHED';
    if (style.lifecycleState === 'ARCHIVED') issues.push({ step: 'publish', message: 'This product is archived.', blocking: true });
    else if (!published) issues.push({ step: 'publish', message: 'Not published yet: shoppers cannot see it.', blocking: true });

    // Purchasable = the storefront's own gate (published + active style price)
    // plus at least one size on sale.
    const purchasableReasons: string[] = [];
    if (!published) purchasableReasons.push('Not published');
    if (!stylePrice) purchasableReasons.push('No price for all colours in effect (the storefront lists a product by its all-colour price)');
    if (activeSkus.length === 0) purchasableReasons.push('No size is on sale');

    // Stock, from the inventory ledger (never edited here).
    const available = await this.inventory.getAvailableToSellBySku(activeSkus.map((sku) => sku.id));
    let availableUnits = 0;
    let sizesInStock = 0;
    for (const sku of activeSkus) {
      const qty = available.get(sku.id) ?? 0;
      if (qty > 0) {
        availableUnits += qty;
        sizesInStock += 1;
      }
    }

    // Channels: what each channel actually holds for this product.
    const channels = await prisma.channel.findMany({ orderBy: { name: 'asc' } });
    const listings = await prisma.channelListing.findMany({ where: { skuId: { in: style.skus.map((sku) => sku.id) } } });
    const siteConfigured = Boolean(loadEnv().STOREFRONT_PUBLIC_URL);
    const channelReadiness: ChannelReadiness[] = channels.map((channel) => {
      const mine = listings.filter((l) => l.channelId === channel.id);
      const scope = (channel.config as { publishAll?: unknown } | null)?.publishAll === true ? 'ALL' : 'SELECTED';
      const notes: string[] = [];
      if (!channel.isActive) notes.push('Channel is paused.');
      if (!siteConfigured) notes.push('The storefront address is not configured on the server, so product links cannot be sent.');
      if (style.media.length === 0) notes.push('Channels need a photo.');
      if (purchasableReasons.length > 0) notes.push('Only products that can be bought are sent.');
      else if (scope === 'ALL' && channel.isActive && mine.filter((l) => l.status === 'PUBLISHED').length === 0) {
        notes.push('Will be sent on the next channel sync.');
      }
      return {
        id: channel.id,
        name: channel.name,
        active: channel.isActive,
        scope,
        sizesListed: mine.filter((l) => l.status === 'PUBLISHED').length,
        sizesFailed: mine.filter((l) => l.status === 'FAILED').length,
        sizesNeedingCheck: mine.filter((l) => l.status === 'AMBIGUOUS_RECONCILIATION_REQUIRED' || l.status === 'PROCESSING').length,
        notes,
      };
    });

    const stepState = (step: WorkspaceStep) => (issues.some((i) => i.step === step && i.blocking) ? 'incomplete' : 'complete');
    const steps = { basics: stepState('basics'), variants: stepState('variants'), photos: stepState('photos'), pricing: stepState('pricing') } as const;
    const firstBlocking = issues.find((i) => i.blocking);
    const next = firstBlocking
      ? { step: firstBlocking.step, label: firstBlocking.step === 'publish' ? (qa.passed ? 'Review and publish' : 'Finish the missing steps') : `Fix ${firstBlocking.step}` }
      : null;

    return {
      productType,
      lifecycleState: style.lifecycleState,
      steps,
      published,
      purchasable: { ok: purchasableReasons.length === 0, reasons: purchasableReasons },
      stock: { availableUnits, sizesInStock, sizesForSale: activeSkus.length },
      channels: channelReadiness,
      issues,
      coverMediaId: style.media[0]?.id ?? null,
      next,
    };
  }
}
