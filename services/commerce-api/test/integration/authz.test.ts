import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '../helpers/app.js';
import { resetDatabase, seedRbac, grantPermissions, testPrisma } from '../helpers/db.js';
import { createAuthenticatedStaff } from '../helpers/auth.js';

/**
 * Authorization is server-side and authoritative everywhere (specs/01-
 * auth-rbac.md). Proves privileged operations reject a caller who lacks
 * the required permission, and that the inventory-adjustment co-approval
 * and PO segregation-of-duties rules cannot be bypassed by permission
 * grants alone.
 */
describe('Authorization enforcement', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase();
    await seedRbac();
  });

  it('rejects an unauthenticated request to a protected route with 401', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/suppliers' });
    expect(response.statusCode).toBe(401);
  });

  it('rejects a request with a token but missing the required permission with 403', async () => {
    await grantPermissions('BUYING', ['po:create']); // deliberately no po:approve
    const { token } = await createAuthenticatedStaff(app, ['BUYING']);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/procurement/purchase-orders/00000000-0000-0000-0000-000000000000/approve',
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('FORBIDDEN');
  });

  it('rejects a request with an invalid/unknown bearer token with 401', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/suppliers',
      headers: { authorization: 'Bearer not-a-real-token' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('rejects an inventory adjustment above the co-approval threshold without a valid co-approver', async () => {
    await grantPermissions('WAREHOUSE_MANAGER', ['inventory:adjust', 'inventory:read']);
    const { token } = await createAuthenticatedStaff(app, ['WAREHOUSE_MANAGER']);

    const brand = await testPrisma.brand.create({ data: { code: 'AUTHZ', name: 'Authz Brand' } });
    const location = await testPrisma.location.create({
      data: { code: 'AUTHZ-WH', name: 'Authz Warehouse', type: 'WAREHOUSE' },
    });
    const category = await testPrisma.category.create({ data: { name: 'Authz Cat', slug: 'authz-cat' } });
    const size = await testPrisma.size.create({ data: { label: 'M', sortOrder: 0 } });
    const style = await testPrisma.style.create({
      data: {
        styleCode: 'AUTHZ-001',
        name: 'Authz Style',
        brandId: brand.id,
        categoryId: category.id,
        season: 'SS26',
        collection: 'Core',
      },
    });
    const colour = await testPrisma.colour.create({ data: { styleId: style.id, name: 'Red', colourCode: 'RED' } });
    const sku = await testPrisma.sku.create({
      data: { styleId: style.id, colourId: colour.id, sizeId: size.id, skuCode: 'AUTHZ-001-RED-M' },
    });

    // Threshold is 50 units (test env default) - this adjustment (60) requires co-approval.
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/inventory/adjustments',
      headers: { authorization: `Bearer ${token}` },
      payload: { skuId: sku.id, locationId: location.id, quantityDelta: 60, reason: 'stock count correction' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('a purchase order may not be approved by the same staff member who submitted it', async () => {
    await grantPermissions('BUYING', ['po:create', 'po:submit', 'po:approve', 'supplier:write']);
    const { token, staffUserId } = await createAuthenticatedStaff(app, ['BUYING']);

    const supplier = await testPrisma.supplier.create({
      data: { code: 'SOD-SUP', name: 'Segregation Test Supplier', type: 'FINISHED_GOODS' },
    });
    const brand = await testPrisma.brand.create({ data: { code: 'SOD', name: 'SoD Brand' } });
    const location = await testPrisma.location.create({ data: { code: 'SOD-WH', name: 'SoD Warehouse', type: 'WAREHOUSE' } });
    const category = await testPrisma.category.create({ data: { name: 'SoD Cat', slug: 'sod-cat' } });
    const size = await testPrisma.size.create({ data: { label: 'M', sortOrder: 0 } });
    const style = await testPrisma.style.create({
      data: { styleCode: 'SOD-001', name: 'SoD Style', brandId: brand.id, categoryId: category.id, season: 'SS26', collection: 'Core' },
    });
    const colour = await testPrisma.colour.create({ data: { styleId: style.id, name: 'Green', colourCode: 'GRN' } });
    const sku = await testPrisma.sku.create({
      data: { styleId: style.id, colourId: colour.id, sizeId: size.id, skuCode: 'SOD-001-GRN-M' },
    });

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/procurement/purchase-orders',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        supplierId: supplier.id,
        locationId: location.id,
        lines: [{ skuId: sku.id, orderedQty: 10, unitCost: 100 }],
      },
    });
    expect(createRes.statusCode).toBe(201);
    const poId = createRes.json().id as string;

    await app.inject({
      method: 'POST',
      url: `/api/v1/procurement/purchase-orders/${poId}/submit`,
      headers: { authorization: `Bearer ${token}` },
    });

    const approveRes = await app.inject({
      method: 'POST',
      url: `/api/v1/procurement/purchase-orders/${poId}/approve`,
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });

    expect(approveRes.statusCode).toBe(400);
    expect(approveRes.json().error.message).toMatch(/same staff member/i);
    void staffUserId;
  });
});
