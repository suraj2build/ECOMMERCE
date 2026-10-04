export type Step = 'basics' | 'variants' | 'photos' | 'pricing' | 'readiness' | 'preview' | 'publish';

export const STEPS: Array<{ key: Step; label: string }> = [
  { key: 'basics', label: 'Basics' },
  { key: 'variants', label: 'Colours & sizes' },
  { key: 'photos', label: 'Photos' },
  { key: 'pricing', label: 'Pricing' },
  { key: 'readiness', label: 'Readiness' },
  { key: 'preview', label: 'Preview' },
  { key: 'publish', label: 'Publish' },
];

export interface StyleDetail {
  id: string;
  styleCode: string;
  name: string;
  season: string;
  collection: string;
  brandId: string;
  categoryId: string;
  department: string | null;
  gender: string | null;
  fabric: string | null;
  fit: string | null;
  pattern: string | null;
  occasion: string | null;
  sleeve: string | null;
  neck: string | null;
  washCare: string | null;
  countryOfOrigin: string | null;
  hsnCode: string | null;
  customAttributes: Record<string, unknown> | null;
  lifecycleState: string;
  qaPassedAt: string | null;
  publishedAt: string | null;
  brand: { name: string; code: string };
  category: { name: string; slug: string; productType: string };
  colours: Array<{ id: string; name: string; colourCode: string; hexSwatch: string | null }>;
  skus: Array<{
    id: string;
    skuCode: string;
    isActive: boolean;
    barcode: string | null;
    colourId: string;
    sizeId: string;
    sizeChartId: string | null;
    colour: { name: string };
    size: { label: string; sortOrder: number };
  }>;
  media: Array<{ id: string; url: string; type: string; altText: string | null; isSwatch: boolean; colourId: string | null; sortOrder: number; isCover: boolean; mimeType: string | null; byteSize: number | null }>;
}

export interface Readiness {
  productType: 'APPAREL' | 'FOOTWEAR' | 'BELT' | 'FRAGRANCE';
  lifecycleState: string;
  steps: Record<'basics' | 'variants' | 'photos' | 'pricing', 'complete' | 'incomplete'>;
  published: boolean;
  purchasable: { ok: boolean; reasons: string[] };
  stock: { availableUnits: number; sizesInStock: number; sizesForSale: number };
  channels: Array<{ id: string; name: string; active: boolean; scope: 'ALL' | 'SELECTED'; sizesListed: number; sizesFailed: number; sizesNeedingCheck: number; notes: string[] }>;
  issues: Array<{ step: 'basics' | 'variants' | 'photos' | 'pricing' | 'publish'; message: string; blocking: boolean }>;
  coverMediaId: string | null;
  next: { step: Step; label: string } | null;
}

export interface ReferenceData {
  brands: Array<{ id: string; code: string; name: string }>;
  categories: Array<{ id: string; name: string; slug: string; productType: string; parentId: string | null }>;
  sizes: Array<{ id: string; label: string; sortOrder: number }>;
  sizeCharts: Array<{ id: string; name: string; gender: string | null; category: string | null; entries: Array<{ sizeLabel: string; measurements: Record<string, unknown> }> }>;
}

export interface StepProps {
  style: StyleDetail;
  readiness: Readiness | undefined;
  reference: ReferenceData;
  /** Reload the product and its readiness after a change. */
  onChanged: () => void;
  goTo: (step: Step) => void;
}
