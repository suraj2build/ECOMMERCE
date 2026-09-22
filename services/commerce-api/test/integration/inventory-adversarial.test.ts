import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '../helpers/app.js';
import { resetDatabase, seedRbac, seedBrandAndLocation, testPrisma } from '../helpers/db.js';
import { InventoryService } from '../../src/modules/inventory/service.js';

/**
 * Certification-pass expanded inventory adversarial round (beyond the
 * pure-concurrency scenarios in inventory-concurrency.test.ts): boundary
 * conditions, idempotency edge cases, reservation lifecycle edge cases,
 * cross-operation contention, and transaction-rollback atomicity. Every
 * scenario runs against real PostgreSQL.
 */
describe('Inventory adversarial certification', () => {
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
    const { location, brand, category, size } = await seedBrandAndLocation();
    const style = await testPrisma.style.create({
      data: { styleCode: 'ADV-001', name: 'Adversarial Style', brandId: brand.id, categoryId: category.id, season: 'SS26', collection: 'Core' },
    });
    const colour = await testPrisma.colour.create({ data: { styleId: style.id, name: 'Black', colourCode: 'BLK' } });
    const sku = await testPrisma.sku.create({ data: { styleId: style.id, colourId: colour.id, sizeId: size.id, skuCode: 'ADV-001-BLK-M' } });
    skuId = sku.id;
    locationId = location.id;
  });

  it('allows a reservation of exactly the available quantity (boundary)', async () => {
    const inventory = new InventoryService(app);
    await inventory.postReceipt({ skuId, locationId, quantity: 10, referenceType: 'TEST', referenceId: 'r1' });

    const reservation = await inventory.reserve({ skuId, locationId, quantity: 10, idempotencyKey: 'exact-boundary' });
    expect(reservation.quantity).toBe(10);

    const balance = await inventory.getBalance(skuId, locationId);
    expect(balance.available).toBe(0);
  });

  it('rejects a reservation attempt with zero stock on hand', async () => {
    const inventory = new InventoryService(app);
    await expect(
      inventory.reserve({ skuId, locationId, quantity: 1, idempotencyKey: 'zero-stock' }),
    ).rejects.toThrow(/insufficient stock/i);

    const balance = await inventory.getBalance(skuId, locationId);
    expect(balance.onHand).toBe(0);
    expect(balance.reserved).toBe(0);
  });

  it('rejects a reservation exceeding available stock by exactly one unit', async () => {
    const inventory = new InventoryService(app);
    await inventory.postReceipt({ skuId, locationId, quantity: 5, referenceType: 'TEST', referenceId: 'r2' });

    await expect(
      inventory.reserve({ skuId, locationId, quantity: 6, idempotencyKey: 'over-by-one' }),
    ).rejects.toThrow(/insufficient stock/i);

    // The failed attempt must leave no trace - full transaction rollback.
    const balance = await inventory.getBalance(skuId, locationId);
    expect(balance.reserved).toBe(0);
    expect(balance.available).toBe(5);
    const reconciliation = await inventory.reconcileBalance(skuId, locationId);
    expect(reconciliation.matches).toBe(true);
  });

  it('a retried reservation with the exact same payload is a safe no-op', async () => {
    const inventory = new InventoryService(app);
    await inventory.postReceipt({ skuId, locationId, quantity: 10, referenceType: 'TEST', referenceId: 'r3' });

    const first = await inventory.reserve({ skuId, locationId, quantity: 4, idempotencyKey: 'same-key' });
    const retried = await inventory.reserve({ skuId, locationId, quantity: 4, idempotencyKey: 'same-key' });
    expect(retried.id).toBe(first.id);

    const balance = await inventory.getBalance(skuId, locationId);
    expect(balance.reserved).toBe(4); // not 8
  });

  it('rejects reusing an idempotency key with a conflicting payload (different quantity)', async () => {
    const inventory = new InventoryService(app);
    await inventory.postReceipt({ skuId, locationId, quantity: 10, referenceType: 'TEST', referenceId: 'r4' });

    await inventory.reserve({ skuId, locationId, quantity: 3, idempotencyKey: 'conflict-key' });

    await expect(
      inventory.reserve({ skuId, locationId, quantity: 5, idempotencyKey: 'conflict-key' }),
    ).rejects.toThrow(/already used for a different/i);

    // The original reservation must be untouched.
    const balance = await inventory.getBalance(skuId, locationId);
    expect(balance.reserved).toBe(3);
  });

  it('rejects reusing an idempotency key with a conflicting payload (different SKU)', async () => {
    const inventory = new InventoryService(app);
    const brand = await testPrisma.brand.findFirstOrThrow();
    const category = await testPrisma.category.findFirstOrThrow();
    const size = await testPrisma.size.findFirstOrThrow();
    const style2 = await testPrisma.style.create({
      data: { styleCode: 'ADV-002', name: 'Adversarial Style 2', brandId: brand.id, categoryId: category.id, season: 'SS26', collection: 'Core' },
    });
    const colour2 = await testPrisma.colour.create({ data: { styleId: style2.id, name: 'White', colourCode: 'WHT' } });
    const sku2 = await testPrisma.sku.create({ data: { styleId: style2.id, colourId: colour2.id, sizeId: size.id, skuCode: 'ADV-002-WHT-M' } });

    await inventory.postReceipt({ skuId, locationId, quantity: 10, referenceType: 'TEST', referenceId: 'r5' });
    await inventory.postReceipt({ skuId: sku2.id, locationId, quantity: 10, referenceType: 'TEST', referenceId: 'r6' });

    await inventory.reserve({ skuId, locationId, quantity: 2, idempotencyKey: 'cross-sku-key' });

    await expect(
      inventory.reserve({ skuId: sku2.id, locationId, quantity: 2, idempotencyKey: 'cross-sku-key' }),
    ).rejects.toThrow(/already used for a different/i);
  });

  it('releasing an already-released reservation twice is a safe no-op (repeated release)', async () => {
    const inventory = new InventoryService(app);
    await inventory.postReceipt({ skuId, locationId, quantity: 10, referenceType: 'TEST', referenceId: 'r7' });
    const reservation = await inventory.reserve({ skuId, locationId, quantity: 4, idempotencyKey: 'repeat-release' });

    await inventory.releaseReservation(reservation.id);
    const balanceAfterFirst = await inventory.getBalance(skuId, locationId);
    expect(balanceAfterFirst.reserved).toBe(0);

    // Second release of the same (already-released) reservation must not
    // double-decrement or go negative.
    await inventory.releaseReservation(reservation.id);
    const balanceAfterSecond = await inventory.getBalance(skuId, locationId);
    expect(balanceAfterSecond.reserved).toBe(0);
  });

  it('releasing a reservation after it has already expired (via the sweep) is a safe no-op', async () => {
    const inventory = new InventoryService(app);
    await inventory.postReceipt({ skuId, locationId, quantity: 10, referenceType: 'TEST', referenceId: 'r8' });
    const reservation = await inventory.reserve({
      skuId,
      locationId,
      quantity: 4,
      idempotencyKey: 'expiry-release',
      ttlSeconds: -1, // already expired the instant it's created
    });

    const expiredCount = await inventory.expireStaleReservations();
    expect(expiredCount).toBe(1);

    const balanceAfterSweep = await inventory.getBalance(skuId, locationId);
    expect(balanceAfterSweep.reserved).toBe(0);

    // Attempting to release the now-EXPIRED reservation must not
    // re-decrement (would go negative without the status guard).
    await inventory.releaseReservation(reservation.id);
    const balanceAfterRelease = await inventory.getBalance(skuId, locationId);
    expect(balanceAfterRelease.reserved).toBe(0);

    const reconciliation = await inventory.reconcileBalance(skuId, locationId);
    expect(reconciliation.matches).toBe(true);
  });

  it('serializes a manual adjustment against concurrent reservation contention without corrupting the balance', async () => {
    const inventory = new InventoryService(app);
    await inventory.postReceipt({ skuId, locationId, quantity: 20, referenceType: 'TEST', referenceId: 'r9' });
    const staff = await testPrisma.staffUser.create({ data: { email: 'adv-staff@example.com', passwordHash: 'x', fullName: 'Adv Staff' } });

    // 10 concurrent 2-unit reservations (20 requested) racing a -5 manual
    // adjustment, all against the same row.
    const reserves = Array.from({ length: 10 }, (_, i) =>
      inventory
        .reserve({ skuId, locationId, quantity: 2, idempotencyKey: `adj-race-${i}` })
        .then(() => true)
        .catch(() => false),
    );
    const adjustment = inventory
      .postAdjustment({ skuId, locationId, quantityDelta: -5, reason: 'stock count correction', actorStaffId: staff.id })
      .then(() => true)
      .catch(() => false);

    await Promise.all([...reserves, adjustment]);

    const balance = await inventory.getBalance(skuId, locationId);
    expect(balance.onHand).toBeGreaterThanOrEqual(0);
    expect(balance.reserved).toBeLessThanOrEqual(balance.onHand); // oversell invariant holds even under mixed-operation contention
    const reconciliation = await inventory.reconcileBalance(skuId, locationId);
    expect(reconciliation.matches).toBe(true);
  });

  it('serializes a location transfer-out against concurrent reservation contention without corrupting the balance', async () => {
    const inventory = new InventoryService(app);
    await inventory.postReceipt({ skuId, locationId, quantity: 20, referenceType: 'TEST', referenceId: 'r10' });
    const otherLocation = await testPrisma.location.create({
      data: { code: 'ADV-WH-02', name: 'Adversarial Second Warehouse', type: 'WAREHOUSE' },
    });
    const staff = await testPrisma.staffUser.create({ data: { email: 'adv-staff2@example.com', passwordHash: 'x', fullName: 'Adv Staff 2' } });

    const reserves = Array.from({ length: 10 }, (_, i) =>
      inventory
        .reserve({ skuId, locationId, quantity: 2, idempotencyKey: `transfer-race-${i}` })
        .then(() => true)
        .catch(() => false),
    );
    const transfer = inventory
      .transferOut({ skuId, fromLocationId: locationId, toLocationId: otherLocation.id, quantity: 8, actorStaffId: staff.id })
      .then(() => true)
      .catch(() => false);

    await Promise.all([...reserves, transfer]);

    const balance = await inventory.getBalance(skuId, locationId);
    expect(balance.reserved).toBeLessThanOrEqual(balance.onHand);
    expect(balance.onHand).toBeGreaterThanOrEqual(0);
    const reconciliation = await inventory.reconcileBalance(skuId, locationId);
    expect(reconciliation.matches).toBe(true);
  });

  it('a failed reserve() call leaves zero trace - no ledger row, no balance mutation (transaction rollback)', async () => {
    const inventory = new InventoryService(app);
    await inventory.postReceipt({ skuId, locationId, quantity: 3, referenceType: 'TEST', referenceId: 'r11' });

    const txnCountBefore = await testPrisma.inventoryTransaction.count({ where: { skuId, locationId } });

    await expect(
      inventory.reserve({ skuId, locationId, quantity: 100, idempotencyKey: 'rollback-proof' }),
    ).rejects.toThrow(/insufficient stock/i);

    const txnCountAfter = await testPrisma.inventoryTransaction.count({ where: { skuId, locationId } });
    expect(txnCountAfter).toBe(txnCountBefore); // no RESERVATION row was ever written

    const reservationRow = await testPrisma.inventoryReservation.findUnique({
      where: { idempotencyKey: 'rollback-proof' },
    });
    expect(reservationRow).toBeNull(); // no reservation row survives the rollback
  });

  it('rejects a manual adjustment that would drive on-hand negative', async () => {
    const inventory = new InventoryService(app);
    await inventory.postReceipt({ skuId, locationId, quantity: 5, referenceType: 'TEST', referenceId: 'r12' });
    const staff = await testPrisma.staffUser.create({ data: { email: 'adv-staff3@example.com', passwordHash: 'x', fullName: 'Adv Staff 3' } });

    await expect(
      inventory.postAdjustment({ skuId, locationId, quantityDelta: -10, reason: 'test', actorStaffId: staff.id }),
    ).rejects.toThrow(/negative/i);

    const balance = await inventory.getBalance(skuId, locationId);
    expect(balance.onHand).toBe(5); // unchanged
  });
});
