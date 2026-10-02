import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '../helpers/app.js';
import { resetDatabase, seedBrandAndLocation, testPrisma } from '../helpers/db.js';
import { InventoryService } from '../../src/modules/inventory/service.js';
import { CrossSellService } from '../../src/modules/pdp/cross-sell-service.js';
import { createAppMaintenance } from '../../src/maintenance.js';

describe('Maintenance and PDP load repairs', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await createTestApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await resetDatabase(); });

  it('scheduled replica sweeps release all 205 expired holds once and preserve committed allocations', async () => {
    const { brand, category, size, location } = await seedBrandAndLocation();
    const style = await testPrisma.style.create({ data: { styleCode: 'SWEEP', name: 'Sweep', brandId: brand.id, categoryId: category.id, season: 'SS26', collection: 'Core' } });
    const colour = await testPrisma.colour.create({ data: { styleId: style.id, name: 'Black', colourCode: 'BLK' } });
    const sku = await testPrisma.sku.create({ data: { styleId: style.id, colourId: colour.id, sizeId: size.id, skuCode: 'SWEEP-M' } });
    const inventory = new InventoryService(app);
    await inventory.postReceipt({ skuId: sku.id, locationId: location.id, quantity: 206, referenceType: 'TEST', referenceId: 'sweep' });
    const holds = Array.from({ length: 206 }, (_, i) => ({ id: randomUUID(), skuId: sku.id, locationId: location.id, quantity: 1,
      idempotencyKey: `hold-${i}`, expiresAt: new Date(Date.now() - 60_000), status: i === 205 ? 'CONVERTED' as const : 'ACTIVE' as const }));
    // Bulk fixture faithfully includes the reservation ledger and balance.
    await testPrisma.inventoryReservation.createMany({ data: holds });
    await testPrisma.inventoryTransaction.createMany({ data: holds.map((r) => ({ skuId: sku.id, locationId: location.id, type: 'RESERVATION' as const, quantity: 1, referenceType: 'RESERVATION', referenceId: r.id })) });
    await testPrisma.inventoryBalance.update({ where: { skuId_locationId: { skuId: sku.id, locationId: location.id } }, data: { reserved: 206 } });
    const first = createAppMaintenance(app);
    const second = createAppMaintenance(app);
    await Promise.all([first.start(), second.start()]);
    await Promise.all([first.stop(), second.stop()]);
    expect(await testPrisma.inventoryReservation.count({ where: { status: 'EXPIRED' } })).toBe(205);
    expect(await testPrisma.inventoryReservation.count({ where: { status: 'CONVERTED' } })).toBe(1);
    expect(await testPrisma.inventoryTransaction.count({ where: { type: 'RESERVATION_RELEASE' } })).toBe(205);
    expect((await inventory.getBalance(sku.id, location.id)).reserved).toBe(1);
    expect(await inventory.expireStaleReservations()).toBe(0);
  });

  it('fills cross-sell slots even when the newest 20 published styles have no active price', async () => {
    const { brand, category } = await seedBrandAndLocation();
    const create = (code: string, publishedAt: Date) => testPrisma.style.create({ data: { styleCode: code, name: code, brandId: brand.id, categoryId: category.id, season: 'SS26', collection: 'Core', lifecycleState: 'PUBLISHED', publishedAt } });
    const origin = await create('ORIGIN', new Date());
    for (let i = 0; i < 20; i += 1) await create(`UNPRICED-${i}`, new Date());
    const valid = await create('PRICED', new Date(Date.now() - 60_000));
    await testPrisma.price.create({ data: { styleId: valid.id, mrp: 100, sellingPrice: 80, effectiveFrom: new Date(Date.now() - 60_000) } });
    const picks = await new CrossSellService(app).listCrossSell(origin.id);
    expect(picks.map((p) => p.id)).toEqual([valid.id]);
    expect(picks[0]?.sellingPrice).toBe(80);
  });
});
