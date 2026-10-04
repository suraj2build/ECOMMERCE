import { describe, it, expect } from 'vitest';
import { productCopy } from '../../src/modules/product/copy.js';

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
