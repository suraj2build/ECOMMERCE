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
