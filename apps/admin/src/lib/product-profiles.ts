/**
 * Admin Ops Phase 1: what the product workspace asks for, by product type
 * (the category's product type, or the product's own when it differs).
 * Guidance for data entry only - the server accepts any of these fields
 * for any product. Keys match the launch catalogue (scripts/
 * generate-launch-assortment.mjs) so imported and hand-made products agree:
 * footwear material sits in `fabric`, closure in customAttributes.closureType,
 * belt material/buckle and fragrance notes in customAttributes. Fragrance
 * uses Colour for the scent name and Size for the volume.
 */
export type ProductTypeKey = 'APPAREL' | 'FOOTWEAR' | 'BELT' | 'FRAGRANCE';

export interface AttributeField {
  key: string;
  label: string;
  /** column = a Style field; custom = Style.customAttributes[key] */
  storage: 'column' | 'custom';
  hint?: string;
  multiline?: boolean;
}

export interface ProductProfile {
  label: string;
  colourLabel: string;
  colourHint: string;
  sizeLabel: string;
  sizeHint: string;
  /** Size labels offered first (others stay available under "Show all sizes"). */
  suggestSize: (label: string) => boolean;
  attributes: AttributeField[];
  /** Whether a size chart (measurements) applies. */
  measurements: boolean;
}

const care: AttributeField = { key: 'washCare', label: 'Care instructions', storage: 'column', multiline: true };
const occasion: AttributeField = { key: 'occasion', label: 'Occasion', storage: 'column', hint: 'e.g. Daily, Work, Casual, Party' };

export const PRODUCT_PROFILES: Record<ProductTypeKey, ProductProfile> = {
  APPAREL: {
    label: 'Clothing',
    colourLabel: 'Colour',
    colourHint: 'One entry per colour you stock.',
    sizeLabel: 'Size',
    sizeHint: 'Letter sizes (S, M, L) or waist sizes (28, 30, 32) as you label them.',
    suggestSize: (l) => /^(XXS|XS|S|M|L|XL|XXL|XXXL|\d{2})$/i.test(l.trim()),
    attributes: [
      { key: 'fabric', label: 'Fabric', storage: 'column', hint: 'e.g. 100% cotton' },
      { key: 'fit', label: 'Fit', storage: 'column', hint: 'e.g. Slim, Regular, Relaxed' },
      { key: 'pattern', label: 'Pattern', storage: 'column' },
      occasion,
      { key: 'sleeve', label: 'Sleeve', storage: 'column' },
      { key: 'neck', label: 'Neck / collar', storage: 'column' },
      care,
    ],
    measurements: true,
  },
  FOOTWEAR: {
    label: 'Shoes',
    colourLabel: 'Colour',
    colourHint: 'One entry per colour you stock.',
    sizeLabel: 'Shoe size',
    sizeHint: 'UK sizes as you label them, e.g. UK8.',
    suggestSize: (l) => /^UK\s?\d{1,2}(\.5)?$/i.test(l.trim()),
    attributes: [
      { key: 'fabric', label: 'Material', storage: 'column', hint: 'e.g. Genuine leather upper' },
      { key: 'closureType', label: 'Closure', storage: 'custom', hint: 'e.g. Lace-up, Slip-on, Buckle' },
      occasion,
      care,
    ],
    measurements: false,
  },
  BELT: {
    label: 'Belts',
    colourLabel: 'Colour',
    colourHint: 'One entry per colour you stock.',
    sizeLabel: 'Belt size',
    sizeHint: 'Waist size in inches, e.g. 32, 34.',
    suggestSize: (l) => /^\d{2}$/.test(l.trim()),
    attributes: [
      { key: 'material', label: 'Material', storage: 'custom', hint: 'e.g. Genuine leather' },
      { key: 'buckleType', label: 'Buckle', storage: 'custom', hint: 'e.g. Pin buckle, Reversible' },
      occasion,
      care,
    ],
    measurements: false,
  },
  FRAGRANCE: {
    label: 'Perfume',
    colourLabel: 'Fragrance',
    colourHint: 'One entry per scent (shown where other products show a colour).',
    sizeLabel: 'Volume',
    sizeHint: 'Bottle size, e.g. 50ml, 100ml.',
    suggestSize: (l) => /ml$/i.test(l.trim()),
    attributes: [
      { key: 'fragranceName', label: 'Fragrance name', storage: 'custom' },
      { key: 'concentration', label: 'Concentration', storage: 'custom', hint: 'e.g. Eau de Parfum' },
      { key: 'topNotes', label: 'Top notes', storage: 'custom' },
      { key: 'heartNotes', label: 'Heart notes', storage: 'custom' },
      { key: 'baseNotes', label: 'Base notes', storage: 'custom' },
      care,
    ],
    measurements: false,
  },
};

/** Shopper-facing copy the storefront shows for every product type (product/copy.ts). */
export const COPY_FIELDS: AttributeField[] = [
  { key: 'subtitle', label: 'Short description', storage: 'custom', hint: 'One line under the product name.' },
  { key: 'details', label: 'Details (one per line)', storage: 'custom', multiline: true, hint: 'Shown as bullet points on the product page.' },
  { key: 'fitNotes', label: 'Fit notes', storage: 'custom', multiline: true },
  { key: 'styleNotes', label: 'Styling notes', storage: 'custom', multiline: true },
];

/** The approved launch assortment (Product Owner, 2026-10-04): a reminder, never a restriction. */
export const ASSORTMENT_NOTE: Record<'Men' | 'Women', string> = {
  Men: 'Daily wear, premium / formal / casual shirts, business-casual polos, denims, trousers, business-casual shoes, belts and perfume.',
  Women: 'Fashion-led and lively: tops, tees, kurtis, denims, dresses, trousers, shirts, skirts and hotpants across daily, casual, work and party wear - not predominantly office wear.',
};

export function profileFor(type: string | null | undefined): ProductProfile {
  return PRODUCT_PROFILES[(type?.toUpperCase() as ProductTypeKey) ?? 'APPAREL'] ?? PRODUCT_PROFILES.APPAREL;
}
