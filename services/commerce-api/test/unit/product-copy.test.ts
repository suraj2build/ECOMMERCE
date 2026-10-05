import { describe, it, expect } from 'vitest';
import { productAttributes, productCopy, resolveProductType } from '../../src/modules/product/copy.js';

describe('productCopy', () => {
  it('publishes only the shopper-facing keys, with the expected types', () => {
    expect(productCopy({
      subtitle: '  Woven handloom silk  ',
      details: ['Wrap front', '', 3, ' Lined '],
      fitNotes: 'True to size',
      costPrice: 1200,
      supplierNote: 'internal',
      styleNotes: 42,
    })).toEqual({ subtitle: 'Woven handloom silk', details: ['Wrap front', 'Lined'], fitNotes: 'True to size' });
  });

  it('returns nothing for a missing or malformed bag', () => {
    expect(productCopy(null)).toEqual({});
    expect(productCopy('text')).toEqual({});
    expect(productCopy(['a'])).toEqual({});
    expect(productCopy({ details: 'not a list' })).toEqual({});
  });
});

describe('product type and attributes (AO-D2)', () => {
  it("uses the style's own valid type, else the category's, else clothing", () => {
    expect(resolveProductType({ productType: 'fragrance' }, 'APPAREL')).toBe('FRAGRANCE');
    expect(resolveProductType({ productType: 'GADGET' }, 'BELT')).toBe('BELT');
    expect(resolveProductType(null, 'FOOTWEAR')).toBe('FOOTWEAR');
    expect(resolveProductType(undefined, undefined)).toBe('APPAREL');
    expect(resolveProductType({}, 'UNKNOWN' as never)).toBe('APPAREL');
  });

  it('lists only the non-empty fields for the type, with their labels', () => {
    expect(productAttributes('APPAREL', { fabric: 'Cotton', customAttributes: { closureType: 'Lace-up' } })).toEqual([]);
    expect(productAttributes('FOOTWEAR', { fabric: ' Leather ', customAttributes: { closureType: 'Lace-up', topNotes: 'x' } })).toEqual([
      { label: 'Material', value: 'Leather' },
      { label: 'Closure', value: 'Lace-up' },
    ]);
    expect(productAttributes('BELT', { fabric: 'ignored', customAttributes: { material: 'Leather', buckleType: '  ' } })).toEqual([{ label: 'Material', value: 'Leather' }]);
    expect(productAttributes('FRAGRANCE', { fabric: null, customAttributes: { concentration: 'Eau de parfum', baseNotes: 'Oud', heartNotes: 42 } })).toEqual([
      { label: 'Concentration', value: 'Eau de parfum' },
      { label: 'Base notes', value: 'Oud' },
    ]);
    expect(productAttributes('UNKNOWN' as never, { fabric: 'x', customAttributes: {} })).toEqual([]);
  });
});
