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
      payload: { skuId, locationId, quantityDelta: threshold - 1, reason: 'Cycle count correction' },
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
      payload: { skuId, locationId, quantityDelta: threshold, reason: 'Large damage write-off' },
    });
    expect(withoutCoApproval.statusCode).toBe(400);

    const withCoApproval = await app.inject({
      method: 'POST',
      url: '/api/v1/inventory/adjustments',
      headers: auth(token),
      payload: { skuId, locationId, quantityDelta: threshold, reason: 'Large damage write-off', coApproverStaffId: financeStaffId },
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
      payload: { skuId, locationId, quantityDelta: 1 },
    });
    expect(below.statusCode).toBe(400);

    const above = await app.inject({
      method: 'POST',
      url: '/api/v1/inventory/adjustments',
      headers: auth(token),
      payload: { skuId, locationId, quantityDelta: threshold },
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
      payload: { skuId, locationId, quantityDelta: threshold, reason: 'Large write-off', coApproverStaffId: unauthorizedCoApprover },
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
      payload: { skuId, locationId, quantityDelta: threshold, reason: 'Large write-off', coApproverStaffId: staffUserId },
    });
    expect(res.statusCode).toBe(400);
  });
});
