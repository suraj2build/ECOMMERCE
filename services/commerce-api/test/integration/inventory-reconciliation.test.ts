import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '../helpers/app.js';
import { resetDatabase, seedRbac, seedBrandAndLocation, testPrisma } from '../helpers/db.js';
import { InventoryService } from '../../src/modules/inventory/service.js';

/**
 * P1 Product Owner decision D-4 (2026-10-01): inventory reconciliation must
 * genuinely replay adjustments.
 *
 * Before the repair, postAdjustment stored an unsigned ADJUSTMENT row and
 * reconcileBalance reported `matches: true` for any balance that had one,
 * so drift after any adjustment was invisible (independent review,
 * docs/admin/P1_DECISIONS.md). New adjustments are ADJUSTMENT_IN /
 * ADJUSTMENT_OUT; legacy ADJUSTMENT rows replay only through an
 * InventoryAdjustmentResolution written by migration
 * 20261001100000_inventory_adjustment_direction, and are otherwise
 * reported UNVERIFIABLE - never as a match.
 */
describe('Inventory reconciliation with adjustments (D-4)', () => {
  let app: FastifyInstance;
  let inventory: InventoryService;
  let skuId: string;
  let locA: string;
  let locB: string;
  let staffId: string;

  beforeAll(async () => {
    app = await createTestApp();
    inventory = new InventoryService(app);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase();
    await seedRbac();
    const { location, brand, category, size } = await seedBrandAndLocation();
    const style = await testPrisma.style.create({ data: { styleCode: 'D4-REC', name: 'D4 Reconcile', brandId: brand.id, categoryId: category.id, season: 'SS26', collection: 'Core' } });
    const colour = await testPrisma.colour.create({ data: { styleId: style.id, name: 'Black', colourCode: 'BLK' } });
    skuId = (await testPrisma.sku.create({ data: { styleId: style.id, colourId: colour.id, sizeId: size.id, skuCode: 'D4-REC-BLK-M' } })).id;
    locA = location.id;
    locB = (await testPrisma.location.create({ data: { code: 'TEST-WH-02', name: 'Second Warehouse', type: 'WAREHOUSE' } })).id;
    staffId = (await testPrisma.staffUser.create({ data: { email: `d4-${Date.now()}@example.com`, passwordHash: 'x', fullName: 'D4 Staff' } })).id;
  });

  const receive = (quantity: number, locationId = locA) => inventory.postReceipt({ skuId, locationId, quantity, referenceType: 'TEST', referenceId: `r-${Math.random()}` });
  const adjust = (quantityDelta: number, locationId = locA) => inventory.postAdjustment({ skuId, locationId, quantityDelta, reason: 'Cycle count', actorStaffId: staffId });
  const reconcile = (locationId = locA) => inventory.reconcileBalance(skuId, locationId);
  const corrupt = (onHand: number, locationId = locA) => testPrisma.inventoryBalance.update({ where: { skuId_locationId: { skuId, locationId } }, data: { onHand } });

  it('A. a receipt alone replays and matches', async () => {
    await receive(10);
    const r = await reconcile();
    expect(r).toMatchObject({ status: 'MATCH', matches: true, unverifiableAdjustments: 0 });
    expect(r.replayed.onHand).toBe(10);
  });

  it('B. receipt 10 + adjustment +5 records an ADJUSTMENT_IN and replays to 15', async () => {
    await receive(10);
    const row = await adjust(5);
    expect(row).toMatchObject({ type: 'ADJUSTMENT_IN', quantity: 5 });
    const r = await reconcile();
    expect(r).toMatchObject({ status: 'MATCH', matches: true });
    expect(r.stored.onHand).toBe(15);
    expect(r.replayed.onHand).toBe(15);
  });

  it('C. receipt 10 + adjustment -3 records an ADJUSTMENT_OUT and replays to 7', async () => {
    await receive(10);
    const row = await adjust(-3);
    expect(row).toMatchObject({ type: 'ADJUSTMENT_OUT', quantity: 3 });
    const r = await reconcile();
    expect(r).toMatchObject({ status: 'MATCH', matches: true });
    expect(r.stored.onHand).toBe(7);
    expect(r.replayed.onHand).toBe(7);
  });

  it('D. several increases and decreases replay exactly', async () => {
    await receive(10);
    for (const d of [5, -3, 2, -4, 1]) await adjust(d);
    const r = await reconcile();
    expect(r.stored.onHand).toBe(11);
    expect(r.replayed.onHand).toBe(11);
    expect(r.status).toBe('MATCH');
    expect(await testPrisma.inventoryTransaction.count({ where: { skuId, type: 'ADJUSTMENT' } })).toBe(0);
  });

  it('E/F. reservation, release and allocation combined with adjustments replay exactly', async () => {
    await receive(10);
    const r1 = await inventory.reserve({ skuId, locationId: locA, quantity: 2, idempotencyKey: 'd4-r1' });
    await inventory.releaseReservation(r1.id, 'test');
    const r2 = await inventory.reserve({ skuId, locationId: locA, quantity: 3, idempotencyKey: 'd4-r2' });
    await inventory.convertReservation(r2.id);
    await adjust(-2);
    await adjust(4);
    const r = await reconcile();
    expect(r.status).toBe('MATCH');
    expect(r.stored).toMatchObject({ onHand: 12, reserved: 3 });
    expect(r.replayed).toMatchObject({ onHand: 12, reserved: 3 });
  });

  it('G/H/I. transfers replay at both ends, also around adjustments', async () => {
    await receive(10);
    await adjust(-1);
    const t = await inventory.transferOut({ skuId, fromLocationId: locA, toLocationId: locB, quantity: 4, actorStaffId: staffId });
    expect((await reconcile(locA)).status).toBe('MATCH');
    await inventory.transferIn(t.id, staffId);
    await adjust(2, locB);
    const a = await reconcile(locA);
    const b = await reconcile(locB);
    expect(a).toMatchObject({ status: 'MATCH' });
    expect(a.replayed.onHand).toBe(5);
    expect(b).toMatchObject({ status: 'MATCH' });
    expect(b.replayed.onHand).toBe(6);
  });

  it('M. corrupting the stored balance is detected with no adjustment history', async () => {
    await receive(10);
    await corrupt(99);
    const r = await reconcile();
    expect(r).toMatchObject({ status: 'MISMATCH', matches: false });
    expect(r.stored.onHand).toBe(99);
    expect(r.replayed.onHand).toBe(10);
  });

  it('N. corruption is still detected when adjustments exist, before and after a later adjustment', async () => {
    await receive(10);
    await adjust(-1); // expected 9
    await corrupt(98);
    const before = await reconcile();
    expect(before).toMatchObject({ status: 'MISMATCH', matches: false });
    expect(before.replayed.onHand).toBe(9);
    expect(before.stored.onHand).toBe(98);

    await adjust(-1); // a later adjustment must not hide it
    const after = await reconcile();
    expect(after).toMatchObject({ status: 'MISMATCH', matches: false });
    expect(after.replayed.onHand).toBe(8);
    expect(after.stored.onHand).toBe(97);
    // Verification only: the corrupted balance is not silently repaired.
    expect((await testPrisma.inventoryBalance.findUniqueOrThrow({ where: { skuId_locationId: { skuId, locationId: locA } } })).onHand).toBe(97);
  });

  it('O. concurrent adjustments keep ledger and balance equal', async () => {
    await receive(50);
    const deltas = [5, -3, 7, -2, 4, -6, 1, -1, 3, -8];
    await Promise.all(deltas.map((d) => adjust(d)));
    const r = await reconcile();
    expect(r.status).toBe('MATCH');
    expect(r.stored.onHand).toBe(50 + deltas.reduce((s, d) => s + d, 0));
    expect(await testPrisma.inventoryTransaction.count({ where: { skuId, type: { in: ['ADJUSTMENT_IN', 'ADJUSTMENT_OUT'] } } })).toBe(deltas.length);
  });

  it('a refused adjustment (below zero on hand) writes no ledger row and the balance still reconciles', async () => {
    await receive(2);
    await expect(adjust(-3)).rejects.toThrow(/negative on-hand/i);
    expect(await testPrisma.inventoryTransaction.count({ where: { skuId, type: { in: ['ADJUSTMENT', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT'] } } })).toBe(0);
    expect((await reconcile()).status).toBe('MATCH');
  });

  // ---------------------------------------------------------------- legacy rows

  /** A legacy row exactly as pre-D-4 code wrote it: unsigned ADJUSTMENT + its inventory.adjust audit row. */
  async function legacyAdjustment(delta: number, opts: { audit?: boolean; reason?: string; locationId?: string } = {}) {
    const locationId = opts.locationId ?? locA;
    const reason = opts.reason ?? 'Legacy cycle count';
    await testPrisma.inventoryBalance.update({ where: { skuId_locationId: { skuId, locationId } }, data: { onHand: { increment: delta } } });
    const row = await testPrisma.inventoryTransaction.create({
      data: { skuId, locationId, type: 'ADJUSTMENT', quantity: Math.abs(delta), reason, actorType: 'STAFF', actorStaffId: staffId },
    });
    if (opts.audit !== false) {
      await testPrisma.auditLog.create({
        data: {
          actorType: 'STAFF',
          actorStaffId: staffId,
          action: 'inventory.adjust',
          entityType: 'InventoryBalance',
          entityId: `${skuId}/${locationId}`,
          newValue: { quantityDelta: delta, reason },
        },
      });
    }
    return row;
  }

  /** The exact resolution statement shipped in the migration (between its BEGIN/END markers). */
  function migrationResolutionSql(): string {
    const sql = readFileSync(
      fileURLToPath(new URL('../../../../packages/db/prisma/migrations/20261001100000_inventory_adjustment_direction/migration.sql', import.meta.url)),
      'utf8',
    );
    const start = sql.indexOf('-- BEGIN D-4 LEGACY ADJUSTMENT RESOLUTION');
    const end = sql.indexOf('-- END D-4 LEGACY ADJUSTMENT RESOLUTION');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    return sql.slice(start, end);
  }

  it('Q. a legacy unsigned ADJUSTMENT with no resolution is reported UNVERIFIABLE, never as a match', async () => {
    await receive(10);
    await legacyAdjustment(5, { audit: false });
    const r = await reconcile();
    expect(r).toMatchObject({ status: 'UNVERIFIABLE', matches: false, unverifiableAdjustments: 1 });
  });

  it('R. the migration resolves legacy rows only where the audit evidence settles the direction, and re-running it changes nothing', async () => {
    await receive(10);
    const up = await legacyAdjustment(5);
    const down = await legacyAdjustment(-3, { reason: 'Legacy shrinkage' });
    // Same SKU/location, actor, quantity and reason, but opposite signs: ambiguous.
    const mixedA = await legacyAdjustment(2, { reason: 'Legacy recount' });
    const mixedB = await legacyAdjustment(-2, { reason: 'Legacy recount' });
    const noAudit = await legacyAdjustment(1, { audit: false, reason: 'Legacy untracked' });

    await testPrisma.$executeRawUnsafe(migrationResolutionSql());
    const resolutions = await testPrisma.inventoryAdjustmentResolution.findMany();
    const byId = new Map(resolutions.map((r) => [r.transactionId, r.direction]));
    expect(byId.get(up.id)).toBe('INCREASE');
    expect(byId.get(down.id)).toBe('DECREASE');
    expect(byId.has(mixedA.id)).toBe(false);
    expect(byId.has(mixedB.id)).toBe(false);
    expect(byId.has(noAudit.id)).toBe(false);
    expect(resolutions).toHaveLength(2);

    // Re-running is a no-op; the ledger rows themselves are never modified.
    await testPrisma.$executeRawUnsafe(migrationResolutionSql());
    expect(await testPrisma.inventoryAdjustmentResolution.count()).toBe(2);
    expect(await testPrisma.inventoryTransaction.count({ where: { skuId, type: 'ADJUSTMENT' } })).toBe(5);

    // Three legacy rows remain unresolved, so the balance cannot be verified.
    expect(await reconcile()).toMatchObject({ status: 'UNVERIFIABLE', matches: false, unverifiableAdjustments: 3 });
  });

  it('resolved legacy rows replay with their recorded direction, and new adjustments add to them', async () => {
    await receive(10);
    await legacyAdjustment(5);
    await legacyAdjustment(-3, { reason: 'Legacy shrinkage' });
    await testPrisma.$executeRawUnsafe(migrationResolutionSql());
    await adjust(-2);
    const r = await reconcile();
    expect(r).toMatchObject({ status: 'MATCH', matches: true, unverifiableAdjustments: 0 });
    expect(r.replayed.onHand).toBe(10);
    expect(r.stored.onHand).toBe(10);

    await corrupt(50);
    expect(await reconcile()).toMatchObject({ status: 'MISMATCH', matches: false });
  });

  it('GET /inventory/reconcile returns the status to staff with inventory:read', async () => {
    await receive(10);
    await adjust(4);
    const { grantPermissions } = await import('../helpers/db.js');
    const { createAuthenticatedStaff } = await import('../helpers/auth.js');
    await grantPermissions('WAREHOUSE_MANAGER', ['inventory:read']);
    const { token } = await createAuthenticatedStaff(app, ['WAREHOUSE_MANAGER']);
    const res = await app.inject({ method: 'GET', url: `/api/v1/inventory/reconcile?skuId=${skuId}&locationId=${locA}`, headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'MATCH', matches: true, unverifiableAdjustments: 0, stored: { onHand: 14 }, replayed: { onHand: 14 } });
  });
});
