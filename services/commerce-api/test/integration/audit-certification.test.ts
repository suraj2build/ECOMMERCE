import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '../helpers/app.js';
import { resetDatabase, seedRbac, grantPermissions, seedBrandAndLocation, testPrisma } from '../helpers/db.js';
import { createAuthenticatedStaff } from '../helpers/auth.js';

/**
 * Certification-pass audit round: every privileged action produces
 * immutable audit evidence with the right actor/action/entity/timestamp/
 * old-new-value shape, and (proven in db-integrity.test.ts's Restrict-FK
 * test) that evidence cannot silently disappear when the staff row it
 * references is deleted.
 */
describe('Audit certification', () => {
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

  function assertAuditShape(entry: { actorType: string; actorStaffId: string | null; action: string; entityType: string; entityId: string; createdAt: Date }) {
    expect(entry.actorType).toBe('STAFF');
    expect(entry.actorStaffId).toBeTruthy();
    expect(entry.action).toBeTruthy();
    expect(entry.entityType).toBeTruthy();
    expect(entry.entityId).toBeTruthy();
    expect(entry.createdAt).toBeInstanceOf(Date);
  }

  it('records full audit evidence across the PO lifecycle (create/submit/approve)', async () => {
    await grantPermissions('BUYING', ['supplier:write', 'po:create', 'po:submit']);
    await grantPermissions('FINANCE', ['po:approve']);
    const buyer = await createAuthenticatedStaff(app, ['BUYING']);
    const approver = await createAuthenticatedStaff(app, ['FINANCE']);
    const { brand, location, category, size } = await seedBrandAndLocation();
    const style = await testPrisma.style.create({
      data: { styleCode: 'AUD-001', name: 'Audit Style', brandId: brand.id, categoryId: category.id, season: 'SS26', collection: 'Core' },
    });
    const colour = await testPrisma.colour.create({ data: { styleId: style.id, name: 'Black', colourCode: 'BLK' } });
    const sku = await testPrisma.sku.create({ data: { styleId: style.id, colourId: colour.id, sizeId: size.id, skuCode: 'AUD-001-BLK-M' } });
    const supplierRes = await app.inject({
      method: 'POST', url: '/api/v1/suppliers', headers: { authorization: `Bearer ${buyer.token}` },
      payload: { code: 'AUD-SUP', name: 'Audit Supplier', type: 'FINISHED_GOODS' },
    });

    const poRes = await app.inject({
      method: 'POST', url: '/api/v1/procurement/purchase-orders', headers: { authorization: `Bearer ${buyer.token}` },
      payload: { supplierId: supplierRes.json().id, locationId: location.id, lines: [{ skuId: sku.id, orderedQty: 10, unitCost: 200 }] },
    });
    const poId = poRes.json().id;
    await app.inject({ method: 'POST', url: `/api/v1/procurement/purchase-orders/${poId}/submit`, headers: { authorization: `Bearer ${buyer.token}` } });
    await app.inject({ method: 'POST', url: `/api/v1/procurement/purchase-orders/${poId}/approve`, headers: { authorization: `Bearer ${approver.token}` }, payload: {} });

    const createEntry = await testPrisma.auditLog.findFirstOrThrow({ where: { action: 'purchase_order.create', entityId: poId } });
    assertAuditShape(createEntry);
    expect(createEntry.actorStaffId).toBe(buyer.staffUserId);

    const submitEntry = await testPrisma.auditLog.findFirstOrThrow({ where: { action: 'purchase_order.submit', entityId: poId } });
    assertAuditShape(submitEntry);
    expect((submitEntry.oldValue as Record<string, unknown>).status).toBe('DRAFT');
    expect((submitEntry.newValue as Record<string, unknown>).status).toBe('SUBMITTED');

    const approveEntry = await testPrisma.auditLog.findFirstOrThrow({ where: { action: 'purchase_order.approve', entityId: poId } });
    assertAuditShape(approveEntry);
    expect(approveEntry.actorStaffId).toBe(approver.staffUserId);
    expect(approveEntry.actorStaffId).not.toBe(buyer.staffUserId); // segregation of duties reflected in the audit trail itself
  });

  it('records audit evidence for GRN creation, linked to the originating PO via reference', async () => {
    await grantPermissions('BUYING', ['supplier:write', 'po:create', 'po:submit']);
    await grantPermissions('FINANCE', ['po:approve']);
    await grantPermissions('WAREHOUSE_MANAGER', ['grn:create']);
    const buyer = await createAuthenticatedStaff(app, ['BUYING']);
    const approver = await createAuthenticatedStaff(app, ['FINANCE']);
    const warehouse = await createAuthenticatedStaff(app, ['WAREHOUSE_MANAGER']);
    const { brand, location, category, size } = await seedBrandAndLocation();
    const style = await testPrisma.style.create({
      data: { styleCode: 'AUD-002', name: 'Audit Style 2', brandId: brand.id, categoryId: category.id, season: 'SS26', collection: 'Core' },
    });
    const colour = await testPrisma.colour.create({ data: { styleId: style.id, name: 'White', colourCode: 'WHT' } });
    const sku = await testPrisma.sku.create({ data: { styleId: style.id, colourId: colour.id, sizeId: size.id, skuCode: 'AUD-002-WHT-M' } });
    const supplierRes = await app.inject({
      method: 'POST', url: '/api/v1/suppliers', headers: { authorization: `Bearer ${buyer.token}` },
      payload: { code: 'AUD-SUP2', name: 'Audit Supplier 2', type: 'FINISHED_GOODS' },
    });
    const poRes = await app.inject({
      method: 'POST', url: '/api/v1/procurement/purchase-orders', headers: { authorization: `Bearer ${buyer.token}` },
      payload: { supplierId: supplierRes.json().id, locationId: location.id, lines: [{ skuId: sku.id, orderedQty: 10, unitCost: 200 }] },
    });
    const poId = poRes.json().id;
    const poLineId = poRes.json().lines[0].id;
    await app.inject({ method: 'POST', url: `/api/v1/procurement/purchase-orders/${poId}/submit`, headers: { authorization: `Bearer ${buyer.token}` } });
    await app.inject({ method: 'POST', url: `/api/v1/procurement/purchase-orders/${poId}/approve`, headers: { authorization: `Bearer ${approver.token}` }, payload: {} });

    const grnRes = await app.inject({
      method: 'POST', url: '/api/v1/grn', headers: { authorization: `Bearer ${warehouse.token}` },
      payload: { poId, locationId: location.id, lines: [{ poLineId, skuId: sku.id, receivedQty: 10, acceptedQty: 10, damagedQty: 0, rejectedQty: 0 }] },
    });

    const grnEntry = await testPrisma.auditLog.findFirstOrThrow({ where: { action: 'grn.create', entityId: grnRes.json().id } });
    assertAuditShape(grnEntry);
    expect(grnEntry.reference).toBe(poId);
    expect(grnEntry.actorStaffId).toBe(warehouse.staffUserId);
  });

  it('records audit evidence for an inventory adjustment, including the co-approver reference', async () => {
    await grantPermissions('WAREHOUSE_MANAGER', ['inventory:adjust', 'inventory:read']);
    await grantPermissions('FINANCE', ['inventory:adjust:coapprove']);
    const warehouse = await createAuthenticatedStaff(app, ['WAREHOUSE_MANAGER']);
    const finance = await createAuthenticatedStaff(app, ['FINANCE']);
    const { brand, location, category, size } = await seedBrandAndLocation();
    const style = await testPrisma.style.create({
      data: { styleCode: 'AUD-003', name: 'Audit Style 3', brandId: brand.id, categoryId: category.id, season: 'SS26', collection: 'Core' },
    });
    const colour = await testPrisma.colour.create({ data: { styleId: style.id, name: 'Grey', colourCode: 'GRY' } });
    const sku = await testPrisma.sku.create({ data: { styleId: style.id, colourId: colour.id, sizeId: size.id, skuCode: 'AUD-003-GRY-M' } });

    const adjustRes = await app.inject({
      method: 'POST', url: '/api/v1/inventory/adjustments', headers: { authorization: `Bearer ${warehouse.token}` },
      payload: { skuId: sku.id, locationId: location.id, quantityDelta: 60, reason: 'audit test large adjustment', coApproverStaffId: finance.staffUserId },
    });
    expect(adjustRes.statusCode).toBe(201);

    const entry = await testPrisma.auditLog.findFirstOrThrow({ where: { action: 'inventory.adjust', entityId: `${sku.id}/${location.id}` } });
    assertAuditShape(entry);
    expect(entry.actorStaffId).toBe(warehouse.staffUserId);
    expect(entry.reference).toBe(finance.staffUserId); // co-approver captured
    expect((entry.newValue as Record<string, unknown>).quantityDelta).toBe(60);
  });

  it('records audit evidence for style publish and unpublish', async () => {
    await grantPermissions('MERCHANDISING', ['product:write', 'product:publish', 'catalog:price:write']);
    const merch = await createAuthenticatedStaff(app, ['MERCHANDISING']);
    const { brand, category, size } = await seedBrandAndLocation();

    const styleRes = await app.inject({
      method: 'POST', url: '/api/v1/products/styles', headers: { authorization: `Bearer ${merch.token}` },
      payload: { styleCode: 'AUD-004', name: 'Audit Style 4', brandId: brand.id, categoryId: category.id, season: 'SS26', collection: 'Core' },
    });
    const styleId = styleRes.json().id;
    const colourRes = await app.inject({
      method: 'POST', url: `/api/v1/products/styles/${styleId}/colours`, headers: { authorization: `Bearer ${merch.token}` },
      payload: { name: 'Blue', colourCode: 'BLU' },
    });
    await app.inject({
      method: 'POST', url: `/api/v1/products/styles/${styleId}/skus/generate`, headers: { authorization: `Bearer ${merch.token}` },
      payload: { sizeIds: [size.id] },
    });
    await app.inject({
      method: 'POST', url: `/api/v1/products/styles/${styleId}/media`, headers: { authorization: `Bearer ${merch.token}` },
      payload: { colourId: colourRes.json().id, url: 'https://example.com/x.jpg' },
    });
    await app.inject({ method: 'POST', url: `/api/v1/products/styles/${styleId}/ready-for-enrichment`, headers: { authorization: `Bearer ${merch.token}` } });
    await app.inject({ method: 'POST', url: `/api/v1/products/styles/${styleId}/qa-check`, headers: { authorization: `Bearer ${merch.token}` } });
    await app.inject({
      method: 'POST', url: '/api/v1/catalog/prices', headers: { authorization: `Bearer ${merch.token}` },
      payload: { styleId, mrp: 999, sellingPrice: 999 },
    });
    await app.inject({ method: 'POST', url: `/api/v1/products/styles/${styleId}/publish`, headers: { authorization: `Bearer ${merch.token}` } });
    await app.inject({ method: 'POST', url: `/api/v1/products/styles/${styleId}/unpublish`, headers: { authorization: `Bearer ${merch.token}` } });

    const publishEntry = await testPrisma.auditLog.findFirstOrThrow({ where: { action: 'style.publish', entityId: styleId } });
    assertAuditShape(publishEntry);
    expect((publishEntry.newValue as Record<string, unknown>).lifecycleState).toBe('PUBLISHED');

    const unpublishEntry = await testPrisma.auditLog.findFirstOrThrow({ where: { action: 'style.transition_to_unpublished', entityId: styleId } });
    assertAuditShape(unpublishEntry);
    expect((unpublishEntry.oldValue as Record<string, unknown>).lifecycleState).toBe('PUBLISHED');
    expect((unpublishEntry.newValue as Record<string, unknown>).lifecycleState).toBe('UNPUBLISHED');
  });

  it('records audit evidence for staff user creation (RBAC/admin change)', async () => {
    await grantPermissions('SUPER_ADMIN', ['rbac:manage']);
    const admin = await createAuthenticatedStaff(app, ['SUPER_ADMIN']);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/staff/users',
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { email: 'new-staff-audit@example.com', password: 'NewStaffPassword123!', fullName: 'New Staff', roleKeys: ['CATALOG'] },
    });
    expect(res.statusCode).toBe(201);

    const entry = await testPrisma.auditLog.findFirstOrThrow({ where: { action: 'staff_user.create', entityId: res.json().id } });
    assertAuditShape(entry);
    expect(entry.actorStaffId).toBe(admin.staffUserId);
    expect((entry.newValue as Record<string, unknown>).email).toBe('new-staff-audit@example.com');
  });
});
