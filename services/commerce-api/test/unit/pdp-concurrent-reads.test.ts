import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PdpService } from '../../src/modules/pdp/service.js';
import { CatalogService } from '../../src/modules/catalog/service.js';
import { InventoryService } from '../../src/modules/inventory/service.js';
import { ReviewService } from '../../src/modules/pdp/review-service.js';
import { CrossSellService } from '../../src/modules/pdp/cross-sell-service.js';

describe('Public PDP concurrent reads', () => {
  afterEach(() => vi.restoreAllMocks());

  it('coalesces concurrent product reads, then reads fresh price and stock', async () => {
    const style = { id: 'style', styleCode: 'S', name: 'Shirt', lifecycleState: 'PUBLISHED',
      brand: { name: 'Brand' }, category: { name: 'Shirts', slug: 'shirts' }, media: [],
      skus: [{ id: 'sku', skuCode: 'SKU', colourId: 'c', sizeId: 's', colour: { name: 'Blue', colourCode: 'B', hexSwatch: null }, size: { label: 'M' } }],
    };
    const findUnique = vi.fn(async () => style);
    // No style or category return policy row: the platform default applies.
    const returnPolicy = { findUnique: vi.fn(async () => null) };
    const service = new PdpService({ prisma: { style: { findUnique }, returnPolicy } } as unknown as FastifyInstance);
    const price = vi.spyOn(CatalogService.prototype, 'getActivePrice').mockResolvedValue({ mrp: 100, sellingPrice: 90, currency: 'INR', isMarkdown: false } as never);
    vi.spyOn(CatalogService.prototype, 'listBadges').mockResolvedValue([]);
    const stock = vi.spyOn(InventoryService.prototype, 'getAvailableToSellBySku').mockResolvedValue(new Map([['sku', 5]]));
    vi.spyOn(ReviewService.prototype, 'getRatingSummary').mockResolvedValue({ averageRating: null, reviewCount: 0 } as never);
    vi.spyOn(ReviewService.prototype, 'listPublishedReviews').mockResolvedValue({ reviews: [], total: 0 } as never);
    vi.spyOn(CrossSellService.prototype, 'listCrossSell').mockResolvedValue([]);

    const results = await Promise.all(Array.from({ length: 200 }, () => service.getProductDetail('style')));
    expect(findUnique).toHaveBeenCalledTimes(1);
    expect(results.every((r) => r.variants[0]?.availableQuantity === 5)).toBe(true);
    price.mockResolvedValue({ mrp: 100, sellingPrice: 80, currency: 'INR', isMarkdown: true } as never);
    stock.mockResolvedValue(new Map([['sku', 0]]));
    const fresh = await service.getProductDetail('style');
    expect(findUnique).toHaveBeenCalledTimes(2);
    expect(fresh.sellingPrice).toBe(80);
    expect(fresh.variants[0]?.inStock).toBe(false);
    expect(fresh.policies.returns).toEqual({ returnable: true, windowDays: expect.any(Number) });
    expect(fresh.policies.shipping.confirmed).toBe(false);
  });

  it('does not retain failures or share results between different products', async () => {
    const findUnique = vi.fn().mockRejectedValueOnce(new Error('temporary outage')).mockResolvedValue(null);
    const service = new PdpService({ prisma: { style: { findUnique } } } as unknown as FastifyInstance);
    const failures = await Promise.allSettled(Array.from({ length: 100 }, () => service.getProductDetail('one')));
    expect(failures.every((r) => r.status === 'rejected')).toBe(true);
    expect(findUnique).toHaveBeenCalledTimes(1);
    await Promise.allSettled([service.getProductDetail('one'), service.getProductDetail('two')]);
    expect(findUnique).toHaveBeenCalledTimes(3);
  });
});
