import { describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { InventoryService } from '../../src/modules/inventory/service.js';

describe('Large SKU availability reports', () => {
  it('includes all 33001 SKUs while bounding SQL parameters and ignoring duplicate ids', async () => {
    const skuIds = Array.from({ length: 33_001 }, (_, i) => `sku-${i}`);
    const groupBy = vi.fn(async ({ where }: { where: { skuId: { in: string[] } } }) => {
      if (where.skuId.in.length > 1000) throw new Error('query parameter budget exceeded');
      return where.skuId.in.map((skuId) => ({ skuId, _sum: { onHand: 5, reserved: 2 } }));
    });
    const inventory = new InventoryService({ prisma: { inventoryBalance: { groupBy } } } as unknown as FastifyInstance);
    const available = await inventory.getAvailableToSellBySku([...skuIds, skuIds[0]!]);
    expect(available.size).toBe(33_001);
    expect(available.get('sku-33000')).toBe(3);
    expect(groupBy).toHaveBeenCalledTimes(34);
  });
});
