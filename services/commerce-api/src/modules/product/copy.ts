/**
 * Shopper-facing product copy kept in Style.customAttributes (the PROD-001
 * extensible attribute bag). Only these keys are ever published, and only
 * with the expected types, so an internal attribute can never leak into the
 * storefront by being added to the bag.
 */
export interface ProductCopy {
  subtitle?: string;
  details?: string[];
  fitNotes?: string;
  styleNotes?: string;
  artisanCluster?: string;
  sustainableNote?: string;
}

const TEXT_KEYS = ['subtitle', 'fitNotes', 'styleNotes', 'artisanCluster', 'sustainableNote'] as const;

export function productCopy(customAttributes: unknown): ProductCopy {
  if (!customAttributes || typeof customAttributes !== 'object' || Array.isArray(customAttributes)) return {};
  const source = customAttributes as Record<string, unknown>;
  const copy: ProductCopy = {};
  for (const key of TEXT_KEYS) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) copy[key] = value.trim();
  }
  if (Array.isArray(source.details)) {
    const details = source.details.filter((d): d is string => typeof d === 'string' && d.trim() !== '').map((d) => d.trim());
    if (details.length) copy.details = details;
  }
  return copy;
}

export type ProductType = 'APPAREL' | 'FOOTWEAR' | 'BELT' | 'FRAGRANCE';
const PRODUCT_TYPES: readonly ProductType[] = ['APPAREL', 'FOOTWEAR', 'BELT', 'FRAGRANCE'];

/**
 * The product's type: its own `customAttributes.productType` when valid,
 * otherwise its category's. Same rule as the admin workspace and readiness.
 */
export function resolveProductType(customAttributes: unknown, categoryType: ProductType): ProductType {
  const own = customAttributes && typeof customAttributes === 'object' && !Array.isArray(customAttributes) ? (customAttributes as Record<string, unknown>).productType : undefined;
  return typeof own === 'string' && (PRODUCT_TYPES as readonly string[]).includes(own.toUpperCase()) ? (own.toUpperCase() as ProductType) : categoryType;
}

/**
 * AO-D2 (Product Owner, 2026-10-05): the type-specific attributes shown in
 * the product page's existing "Product Details" section. Only these keys,
 * only non-empty text, labelled as in the admin workspace
 * (apps/admin/src/lib/product-profiles.ts). Clothing keeps its existing
 * fabric/fit/care presentation, so it adds nothing here.
 */
const ATTRIBUTE_FIELDS: Record<Exclude<ProductType, 'APPAREL'>, Array<{ key: string; label: string; column?: 'fabric' }>> = {
  FOOTWEAR: [
    { key: 'fabric', label: 'Material', column: 'fabric' },
    { key: 'closureType', label: 'Closure' },
  ],
  BELT: [
    { key: 'material', label: 'Material' },
    { key: 'buckleType', label: 'Buckle' },
  ],
  FRAGRANCE: [
    { key: 'fragranceName', label: 'Fragrance' },
    { key: 'concentration', label: 'Concentration' },
    { key: 'topNotes', label: 'Top notes' },
    { key: 'heartNotes', label: 'Heart notes' },
    { key: 'baseNotes', label: 'Base notes' },
  ],
};

export function productAttributes(productType: ProductType, style: { fabric: string | null; customAttributes: unknown }): Array<{ label: string; value: string }> {
  if (productType === 'APPAREL') return [];
  const custom = style.customAttributes && typeof style.customAttributes === 'object' && !Array.isArray(style.customAttributes) ? (style.customAttributes as Record<string, unknown>) : {};
  const out: Array<{ label: string; value: string }> = [];
  for (const field of ATTRIBUTE_FIELDS[productType]) {
    const raw = field.column ? style.fabric : custom[field.key];
    if (typeof raw === 'string' && raw.trim()) out.push({ label: field.label, value: raw.trim() });
  }
  return out;
}
