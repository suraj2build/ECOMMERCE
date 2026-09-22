import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '../helpers/app.js';
import { resetDatabase, seedRbac, testPrisma } from '../helpers/db.js';
import { InventoryService } from '../../src/modules/inventory/service.js';

/**
 * THE non-negotiable acceptance requirement (Phase 1 authorization §M06,
 * acceptance/m06-inventory.md "Concurrency"): simultaneous reservation
 * attempts against the same SKU+location must never be able to allocate
 * more sellable inventory than is actually on hand. This is proven here
 * against a real Postgres instance - not mocked - by firing genuinely
 * concurrent reserve() calls and asserting the sum of what succeeded
 * never exceeds onHand, and that the final ledger reconciles.
 */
describe('Inventory concurrency - overselling prevention (INV-003)', () => {
  let app: FastifyInstance;
  let skuId: string;
  let locationId: string;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase();
    await seedRbac();

    const brand = await testPrisma.brand.create({ data: { code: 'CB', name: 'Concurrency Brand' } });
    const location = await testPrisma.location.create({
      data: { code: 'CONC-WH', name: 'Concurrency Warehouse', type: 'WAREHOUSE' },
    });
    const category = await testPrisma.category.create({ data: { name: 'Conc Cat', slug: 'conc-cat' } });
    const size = await testPrisma.size.create({ data: { label: 'M', sortOrder: 0 } });
    const style = await testPrisma.style.create({
      data: {
        styleCode: 'CONC-001',
        name: 'Concurrency Test Style',
        brandId: brand.id,
        categoryId: category.id,
        season: 'SS26',
        collection: 'Core',
      },
    });
    const colour = await testPrisma.colour.create({
      data: { styleId: style.id, name: 'Black', colourCode: 'BLK' },
    });
    const sku = await testPrisma.sku.create({
      data: { styleId: style.id, colourId: colour.id, sizeId: size.id, skuCode: 'CONC-001-BLK-M' },
    });

    skuId = sku.id;
    locationId = location.id;
  });

  it('never allows concurrent reservations to sell more than onHand stock', async () => {
    const inventory = new InventoryService(app);

    // Seed exactly 50 units on hand via a real RECEIPT ledger transaction.
    await inventory.postReceipt({
      skuId,
      locationId,
      quantity: 50,
      referenceType: 'TEST',
      referenceId: 'seed-receipt',
    });

    // Fire 20 concurrent attempts to reserve 5 units each (100 requested
    // against 50 available) - only 10 of them may succeed.
    const attempts = Array.from({ length: 20 }, (_, i) =>
      inventory
        .reserve({
          skuId,
          locationId,
          quantity: 5,
          idempotencyKey: `concurrent-reserve-${i}`,
        })
        .then(() => ({ ok: true as const }))
        .catch((err: unknown) => ({ ok: false as const, err })),
    );

    const results = await Promise.all(attempts);
    const succeeded = results.filter((r) => r.ok);
    const failed = results.filter((r) => !r.ok);

    expect(succeeded).toHaveLength(10);
    expect(failed).toHaveLength(10);

    const balance = await inventory.getBalance(skuId, locationId);
    expect(balance.onHand).toBe(50);
    expect(balance.reserved).toBe(50);
    expect(balance.available).toBe(0);

    // The ledger (source of truth) must reconcile exactly against the
    // cached balance - proves no lost/duplicated writes under contention.
    const reconciliation = await inventory.reconcileBalance(skuId, locationId);
    expect(reconciliation.matches).toBe(true);
    expect(reconciliation.replayed.onHand).toBe(50);
    expect(reconciliation.replayed.reserved).toBe(50);
  });

  it('never oversells even when concurrent requests exceed available stock by a large margin', async () => {
    const inventory = new InventoryService(app);

    await inventory.postReceipt({
      skuId,
      locationId,
      quantity: 10,
      referenceType: 'TEST',
      referenceId: 'seed-receipt-2',
    });

    // 50 concurrent attempts to reserve 1 unit each against only 10 available.
    const attempts = Array.from({ length: 50 }, (_, i) =>
      inventory
        .reserve({ skuId, locationId, quantity: 1, idempotencyKey: `burst-${i}` })
        .then(() => true)
        .catch(() => false),
    );

    const results = await Promise.all(attempts);
    const succeededCount = results.filter(Boolean).length;

    expect(succeededCount).toBe(10);

    const balance = await inventory.getBalance(skuId, locationId);
    expect(balance.reserved).toBeLessThanOrEqual(balance.onHand);
    expect(balance.available).toBe(0);
  });

  it('idempotency key prevents a retried reservation from double-reserving', async () => {
    const inventory = new InventoryService(app);
    await inventory.postReceipt({
      skuId,
      locationId,
      quantity: 20,
      referenceType: 'TEST',
      referenceId: 'seed-receipt-3',
    });

    const first = await inventory.reserve({ skuId, locationId, quantity: 5, idempotencyKey: 'retry-key' });
    const retried = await inventory.reserve({ skuId, locationId, quantity: 5, idempotencyKey: 'retry-key' });

    expect(retried.id).toBe(first.id);

    const balance = await inventory.getBalance(skuId, locationId);
    expect(balance.reserved).toBe(5); // not 10 - the retry was a safe no-op
  });

  /**
   * Certification-pass addition (independent re-verification, 2026-09-22):
   * mixes concurrent reserve() and releaseReservation() against the same
   * row - proves the row lock serializes writers correctly regardless of
   * operation type, not just same-typed contention, and that the balance
   * never goes negative or drifts from the ledger under mixed traffic.
   */
  it('never corrupts the balance under mixed concurrent reserve + release traffic', async () => {
    const inventory = new InventoryService(app);
    await inventory.postReceipt({
      skuId,
      locationId,
      quantity: 30,
      referenceType: 'TEST',
      referenceId: 'seed-receipt-mixed',
    });

    // Pre-create 10 reservations of 2 units each (20 reserved of 30 on hand).
    const preReservations = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        inventory.reserve({ skuId, locationId, quantity: 2, idempotencyKey: `mixed-pre-${i}` }),
      ),
    );

    // Concurrently: release all 10 existing reservations AND fire 20 new
    // reservation attempts of 3 units each (60 requested) against a
    // balance that is changing underneath them.
    const releases = preReservations.map((r) => inventory.releaseReservation(r.id));
    const newReserves = Array.from({ length: 20 }, (_, i) =>
      inventory
        .reserve({ skuId, locationId, quantity: 3, idempotencyKey: `mixed-new-${i}` })
        .then(() => true)
        .catch(() => false),
    );

    await Promise.all([...releases, ...newReserves]);

    const balance = await inventory.getBalance(skuId, locationId);
    expect(balance.onHand).toBe(30);
    expect(balance.reserved).toBeGreaterThanOrEqual(0);
    expect(balance.reserved).toBeLessThanOrEqual(balance.onHand); // never oversold, never negative
    expect(balance.available).toBe(balance.onHand - balance.reserved);

    const reconciliation = await inventory.reconcileBalance(skuId, locationId);
    expect(reconciliation.matches).toBe(true);
  });

  /** Higher-contention variant: 100 concurrent 1-unit reservation attempts against 15 on hand. */
  it('holds the oversell invariant under 100-way concurrency', async () => {
    const inventory = new InventoryService(app);
    await inventory.postReceipt({
      skuId,
      locationId,
      quantity: 15,
      referenceType: 'TEST',
      referenceId: 'seed-receipt-100way',
    });

    const attempts = Array.from({ length: 100 }, (_, i) =>
      inventory
        .reserve({ skuId, locationId, quantity: 1, idempotencyKey: `hundred-${i}` })
        .then(() => true)
        .catch(() => false),
    );

    const results = await Promise.all(attempts);
    const succeededCount = results.filter(Boolean).length;

    expect(succeededCount).toBe(15);

    const balance = await inventory.getBalance(skuId, locationId);
    expect(balance.reserved).toBe(15);
    expect(balance.available).toBe(0);

    const reconciliation = await inventory.reconcileBalance(skuId, locationId);
    expect(reconciliation.matches).toBe(true);
  });
});
