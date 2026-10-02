import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '../helpers/app.js';
import { resetDatabase, seedRbac, grantPermissions, seedBrandAndLocation, testPrisma } from '../helpers/db.js';
import { createAuthenticatedStaff } from '../helpers/auth.js';
import { loadEnv, __resetEnvCacheForTests } from '@fcp/config';

/**
 * FLOW 20 - Inventory Adjustment Audited (acceptance/e2e-commerce-
 * flows.md, ADM-003). Below-threshold adjustments complete with
 * Warehouse Manager authorization alone; above-threshold adjustments
 * are held pending Finance co-approval and only complete once supplied;
 * both are fully audited (who/what/when/old value/new value/reference);
 * an adjustment without a justification field is rejected in both cases.
 */
describe('FLOW 20 - Inventory Adjustment Audited (M29)', () => {
  let app: FastifyInstance;
  let skuId: string;
  let locationId: string;
  const threshold = loadEnv().INVENTORY_ADJUSTMENT_COAPPROVAL_THRESHOLD_UNITS;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    __resetEnvCacheForTests();
    await resetDatabase();
    await seedRbac();
    const { location, brand, category, size } = await seedBrandAndLocation();
    const style = await testPrisma.style.create({
      data: { styleCode: `FLOW20-${Date.now()}`, name: 'Flow20 Style', brandId: brand.id, categoryId: category.id, season: 'SS26', collection: 'Core' },
    });
    const colour = await testPrisma.colour.create({ data: { styleId: style.id, name: 'Black', colourCode: 'BLK' } });
    const sku = await testPrisma.sku.create({ data: { styleId: style.id, colourId: colour.id, sizeId: size.id, skuCode: `${style.styleCode}-BLK-M` } });
    skuId = sku.id;
    locationId = location.id;
    await grantPermissions('WAREHOUSE_MANAGER', ['inventory:adjust', 'inventory:read']);
    await grantPermissions('FINANCE', ['inventory:adjust:coapprove']);
  });

  function auth(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  it('1. below-threshold: Warehouse Manager authorization alone completes the adjustment, fully audited', async () => {
    const { staffUserId, token } = await createAuthenticatedStaff(app, ['WAREHOUSE_MANAGER']);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/inventory/adjustments',
      headers: auth(token),
      payload: { skuId, locationId, quantityDelta: threshold - 1, reason: 'Cycle count correction', idempotencyKey: 'flow20-below' },
    });
    expect(res.statusCode).toBe(201);

    const audit = await testPrisma.auditLog.findFirst({
      where: { action: 'inventory.adjust', actorStaffId: staffUserId, entityId: `${skuId}/${locationId}` },
    });
    expect(audit).not.toBeNull();
    expect((audit!.newValue as { reason: string }).reason).toBe('Cycle count correction');
  });

  it('2. above-threshold: rejected without Finance co-approval, then completes once a valid co-approver is supplied - both audited', async () => {
    const { staffUserId, token } = await createAuthenticatedStaff(app, ['WAREHOUSE_MANAGER']);
    const { staffUserId: financeStaffId } = await createAuthenticatedStaff(app, ['FINANCE']);

    const withoutCoApproval = await app.inject({
      method: 'POST',
      url: '/api/v1/inventory/adjustments',
      headers: auth(token),
      payload: { skuId, locationId, quantityDelta: threshold, reason: 'Large damage write-off', idempotencyKey: 'flow20-large-no-coapproval' },
    });
    expect(withoutCoApproval.statusCode).toBe(400);

    const withCoApproval = await app.inject({
      method: 'POST',
      url: '/api/v1/inventory/adjustments',
      headers: auth(token),
      payload: { skuId, locationId, quantityDelta: threshold, reason: 'Large damage write-off', coApproverStaffId: financeStaffId, idempotencyKey: 'flow20-large-approved' },
    });
    expect(withCoApproval.statusCode).toBe(201);

    const audit = await testPrisma.auditLog.findFirst({
      where: { action: 'inventory.adjust', actorStaffId: staffUserId, reference: financeStaffId },
    });
    expect(audit).not.toBeNull();
  });

  it('rejects an adjustment with no justification field, both below and above threshold', async () => {
    const { token } = await createAuthenticatedStaff(app, ['WAREHOUSE_MANAGER']);

    const below = await app.inject({
      method: 'POST',
      url: '/api/v1/inventory/adjustments',
      headers: auth(token),
      payload: { skuId, locationId, quantityDelta: 1, idempotencyKey: 'flow20-no-reason-below' },
    });
    expect(below.statusCode).toBe(400);

    const above = await app.inject({
      method: 'POST',
      url: '/api/v1/inventory/adjustments',
      headers: auth(token),
      payload: { skuId, locationId, quantityDelta: threshold, idempotencyKey: 'flow20-no-reason-above' },
    });
    expect(above.statusCode).toBe(400);
  });

  it('rejects a co-approver who does not actually hold inventory:adjust:coapprove', async () => {
    const { token } = await createAuthenticatedStaff(app, ['WAREHOUSE_MANAGER']);
    const { staffUserId: unauthorizedCoApprover } = await createAuthenticatedStaff(app, ['CUSTOMER_SERVICE']);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/inventory/adjustments',
      headers: auth(token),
      payload: { skuId, locationId, quantityDelta: threshold, reason: 'Large write-off', coApproverStaffId: unauthorizedCoApprover, idempotencyKey: 'flow20-bad-coapprover' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects Warehouse Manager (or above) from being their own co-approver', async () => {
    const { token, staffUserId } = await createAuthenticatedStaff(app, ['WAREHOUSE_MANAGER']);
    await grantPermissions('WAREHOUSE_MANAGER', ['inventory:adjust:coapprove']);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/inventory/adjustments',
      headers: auth(token),
      payload: { skuId, locationId, quantityDelta: threshold, reason: 'Large write-off', coApproverStaffId: staffUserId, idempotencyKey: 'flow20-self-coapprover' },
    });
    expect(res.statusCode).toBe(400);
  });
  it('requires an idempotency key at the HTTP boundary', async () => {
    const { token } = await createAuthenticatedStaff(app, ['WAREHOUSE_MANAGER']);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/inventory/adjustments',
      headers: auth(token),
      payload: { skuId, locationId, quantityDelta: 1, reason: 'Missing retry key' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('replaying the same idempotency key and payload applies the adjustment and audit exactly once', async () => {
    const { staffUserId, token } = await createAuthenticatedStaff(app, ['WAREHOUSE_MANAGER']);
    const payload = { skuId, locationId, quantityDelta: 4, reason: 'Retry-safe count', idempotencyKey: 'flow20-exact-retry' };

    const first = await app.inject({ method: 'POST', url: '/api/v1/inventory/adjustments', headers: auth(token), payload });
    const retry = await app.inject({ method: 'POST', url: '/api/v1/inventory/adjustments', headers: auth(token), payload });
    expect(first.statusCode).toBe(201);
    expect(retry.statusCode).toBe(201);
    expect(retry.json().id).toBe(first.json().id);

    const balance = await testPrisma.inventoryBalance.findUniqueOrThrow({ where: { skuId_locationId: { skuId, locationId } } });
    expect(balance.onHand).toBe(4);
    expect(await testPrisma.inventoryTransaction.count({ where: { idempotencyKey: payload.idempotencyKey } })).toBe(1);
    expect(await testPrisma.auditLog.count({
      where: { action: 'inventory.adjust', actorStaffId: staffUserId, entityId: `${skuId}/${locationId}` },
    })).toBe(1);
  });

  it('reusing an adjustment idempotency key for a different payload returns 409 and does not apply it', async () => {
    const { token } = await createAuthenticatedStaff(app, ['WAREHOUSE_MANAGER']);
    const idempotencyKey = 'flow20-conflicting-reuse';
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/inventory/adjustments',
      headers: auth(token),
      payload: { skuId, locationId, quantityDelta: 2, reason: 'Original count', idempotencyKey },
    });
    expect(first.statusCode).toBe(201);

    const conflict = await app.inject({
      method: 'POST',
      url: '/api/v1/inventory/adjustments',
      headers: auth(token),
      payload: { skuId, locationId, quantityDelta: 3, reason: 'Changed count', idempotencyKey },
    });
    expect(conflict.statusCode).toBe(409);

    const balance = await testPrisma.inventoryBalance.findUniqueOrThrow({ where: { skuId_locationId: { skuId, locationId } } });
    expect(balance.onHand).toBe(2);
    expect(await testPrisma.inventoryTransaction.count({ where: { idempotencyKey } })).toBe(1);
  });

  it('concurrent exact retries converge to one ledger row, one audit and one stock effect', async () => {
    const { staffUserId, token } = await createAuthenticatedStaff(app, ['WAREHOUSE_MANAGER']);
    const payload = { skuId, locationId, quantityDelta: 5, reason: 'Concurrent retry count', idempotencyKey: 'flow20-concurrent-retry' };

    const [a, b] = await Promise.all([
      app.inject({ method: 'POST', url: '/api/v1/inventory/adjustments', headers: auth(token), payload }),
      app.inject({ method: 'POST', url: '/api/v1/inventory/adjustments', headers: auth(token), payload }),
    ]);
    expect([a.statusCode, b.statusCode]).toEqual([201, 201]);
    expect(a.json().id).toBe(b.json().id);

    const balance = await testPrisma.inventoryBalance.findUniqueOrThrow({ where: { skuId_locationId: { skuId, locationId } } });
    expect(balance.onHand).toBe(5);
    expect(await testPrisma.inventoryTransaction.count({ where: { idempotencyKey: payload.idempotencyKey } })).toBe(1);
    expect(await testPrisma.auditLog.count({
      where: { action: 'inventory.adjust', actorStaffId: staffUserId, entityId: `${skuId}/${locationId}` },
    })).toBe(1);
  });

});
