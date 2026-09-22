import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '../helpers/app.js';
import { resetDatabase, seedRbac, grantPermissions, seedBrandAndLocation, testPrisma } from '../helpers/db.js';
import { createAuthenticatedStaff } from '../helpers/auth.js';

/**
 * Phase 1 §20 end-to-end proof: Supplier -> PO -> Approval -> GRN -> QC ->
 * Inventory Ledger -> Available Stock -> Product Enrichment -> Price ->
 * Publishable Catalog State, using real persisted state transitions
 * through the actual HTTP surface (app.inject), never mocks or
 * disconnected fixtures. Every assertion below maps to one of the
 * specific §20 requirements.
 */
describe('Phase 1 E2E proof: Supplier -> PO -> GRN/QC -> Inventory -> Catalog', () => {
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

  it('proves the full flow end to end with real persisted state', async () => {
    // --- Role setup: distinct staff members per segregation-of-duties boundary ---
    await grantPermissions('BUYING', ['supplier:write', 'supplier:read', 'po:create', 'po:submit', 'po:read', 'product:read']);
    await grantPermissions('FINANCE', ['po:approve', 'po:read']);
    await grantPermissions('WAREHOUSE_MANAGER', [
      'grn:create',
      'grn:read',
      'grn:qc:manager_signoff',
      'inventory:read',
      'inventory:reserve',
    ]);
    await grantPermissions('MERCHANDISING', [
      'product:read',
      'product:write',
      'product:publish',
      'catalog:price:write',
      'catalog:price:approve',
      'catalog:collection:manage',
    ]);

    const buyer = await createAuthenticatedStaff(app, ['BUYING']);
    const approver = await createAuthenticatedStaff(app, ['FINANCE']);
    const warehouseManager = await createAuthenticatedStaff(app, ['WAREHOUSE_MANAGER']);
    const merchandiser = await createAuthenticatedStaff(app, ['MERCHANDISING']);

    const { brand, location, category, size } = await seedBrandAndLocation();

    // --- Product Master: STYLE -> COLOUR -> SIZE -> SKU, enrichment, QA gate ---
    const styleRes = await app.inject({
      method: 'POST',
      url: '/api/v1/products/styles',
      headers: { authorization: `Bearer ${merchandiser.token}` },
      payload: {
        styleCode: 'E2E-001',
        name: 'E2E Proof Style',
        brandId: brand.id,
        categoryId: category.id,
        season: 'SS26',
        collection: 'Launch',
      },
    });
    expect(styleRes.statusCode).toBe(201);
    const styleId = styleRes.json().id as string;

    const colourRes = await app.inject({
      method: 'POST',
      url: `/api/v1/products/styles/${styleId}/colours`,
      headers: { authorization: `Bearer ${merchandiser.token}` },
      payload: { name: 'Midnight Blue', colourCode: 'MNB' },
    });
    expect(colourRes.statusCode).toBe(201);
    const colourId = colourRes.json().id as string;

    const skuRes = await app.inject({
      method: 'POST',
      url: `/api/v1/products/styles/${styleId}/skus/generate`,
      headers: { authorization: `Bearer ${merchandiser.token}` },
      payload: { sizeIds: [size.id] },
    });
    expect(skuRes.statusCode).toBe(201);
    const skuId = skuRes.json()[0].skuId as string;

    const mediaRes = await app.inject({
      method: 'POST',
      url: `/api/v1/products/styles/${styleId}/media`,
      headers: { authorization: `Bearer ${merchandiser.token}` },
      payload: { colourId, url: 'https://example.com/e2e-proof.jpg', type: 'IMAGE' },
    });
    expect(mediaRes.statusCode).toBe(201);

    await app.inject({
      method: 'POST',
      url: `/api/v1/products/styles/${styleId}/ready-for-enrichment`,
      headers: { authorization: `Bearer ${merchandiser.token}` },
    });

    const qaRes = await app.inject({
      method: 'POST',
      url: `/api/v1/products/styles/${styleId}/qa-check`,
      headers: { authorization: `Bearer ${merchandiser.token}` },
    });
    expect(qaRes.statusCode).toBe(200);
    expect(qaRes.json().passed).toBe(true);

    // --- Supplier ---
    const supplierRes = await app.inject({
      method: 'POST',
      url: '/api/v1/suppliers',
      headers: { authorization: `Bearer ${buyer.token}` },
      payload: { code: 'E2E-SUP', name: 'E2E Proof Supplier', type: 'FINISHED_GOODS' },
    });
    expect(supplierRes.statusCode).toBe(201);
    const supplierId = supplierRes.json().id as string;

    // --- Purchase Order: create -> submit -> approve (different staff) ---
    const poRes = await app.inject({
      method: 'POST',
      url: '/api/v1/procurement/purchase-orders',
      headers: { authorization: `Bearer ${buyer.token}` },
      payload: {
        supplierId,
        locationId: location.id,
        lines: [{ skuId, orderedQty: 100, unitCost: 400 }],
      },
    });
    expect(poRes.statusCode).toBe(201);
    const po = poRes.json();
    expect(po.status).toBe('DRAFT');
    expect(Number(po.totalCost)).toBe(40_000); // cost persisted for margin analytics (PO-002)
    const poId = po.id as string;
    const poLineId = po.lines[0].id as string;

    const submitRes = await app.inject({
      method: 'POST',
      url: `/api/v1/procurement/purchase-orders/${poId}/submit`,
      headers: { authorization: `Bearer ${buyer.token}` },
    });
    expect(submitRes.statusCode).toBe(200);
    expect(submitRes.json().status).toBe('SUBMITTED');

    const approveRes = await app.inject({
      method: 'POST',
      url: `/api/v1/procurement/purchase-orders/${poId}/approve`,
      headers: { authorization: `Bearer ${approver.token}` },
      payload: {},
    });
    expect(approveRes.statusCode).toBe(200);
    expect(approveRes.json().status).toBe('APPROVED');

    // --- GRN / QC: partial receipt first (60 of 100), with damage/rejection ---
    const grn1Res = await app.inject({
      method: 'POST',
      url: '/api/v1/grn',
      headers: { authorization: `Bearer ${warehouseManager.token}` },
      payload: {
        poId,
        locationId: location.id,
        lines: [{ poLineId, skuId, receivedQty: 60, acceptedQty: 55, damagedQty: 3, rejectedQty: 2 }],
      },
    });
    expect(grn1Res.statusCode).toBe(201);

    const poAfterGrn1 = await app.inject({
      method: 'GET',
      url: `/api/v1/procurement/purchase-orders/${poId}`,
      headers: { authorization: `Bearer ${buyer.token}` },
    });
    expect(poAfterGrn1.json().status).toBe('PARTIALLY_RECEIVED'); // partial receipt works (§20)

    let balanceRes = await app.inject({
      method: 'GET',
      url: `/api/v1/inventory/balance?skuId=${skuId}&locationId=${location.id}`,
      headers: { authorization: `Bearer ${warehouseManager.token}` },
    });
    let balance = balanceRes.json();
    expect(balance.onHand).toBe(55); // only QC-accepted units are sellable
    expect(balance.damaged).toBe(5); // damaged+rejected -> damaged bucket, never sellable
    expect(balance.available).toBe(55);

    // --- Second GRN completes the PO ---
    const grn2Res = await app.inject({
      method: 'POST',
      url: '/api/v1/grn',
      headers: { authorization: `Bearer ${warehouseManager.token}` },
      payload: {
        poId,
        locationId: location.id,
        lines: [{ poLineId, skuId, receivedQty: 40, acceptedQty: 40, damagedQty: 0, rejectedQty: 0 }],
      },
    });
    expect(grn2Res.statusCode).toBe(201);

    const poAfterGrn2 = await app.inject({
      method: 'GET',
      url: `/api/v1/procurement/purchase-orders/${poId}`,
      headers: { authorization: `Bearer ${buyer.token}` },
    });
    expect(poAfterGrn2.json().status).toBe('FULLY_RECEIVED');

    balanceRes = await app.inject({
      method: 'GET',
      url: `/api/v1/inventory/balance?skuId=${skuId}&locationId=${location.id}`,
      headers: { authorization: `Bearer ${warehouseManager.token}` },
    });
    balance = balanceRes.json();
    expect(balance.onHand).toBe(95); // 55 + 40 accepted; damaged units never join onHand
    expect(balance.damaged).toBe(5);
    expect(balance.available).toBe(95);

    // --- Ledger reconciles (auditable, balanced) ---
    const reconcileRes = await app.inject({
      method: 'GET',
      url: `/api/v1/inventory/reconcile?skuId=${skuId}&locationId=${location.id}`,
      headers: { authorization: `Bearer ${warehouseManager.token}` },
    });
    expect(reconcileRes.json().matches).toBe(true);

    // --- Reservation reduces available stock correctly, release restores it ---
    const reserveRes = await app.inject({
      method: 'POST',
      url: '/api/v1/inventory/reserve',
      headers: { authorization: `Bearer ${warehouseManager.token}` },
      payload: { skuId, locationId: location.id, quantity: 20, idempotencyKey: 'e2e-reserve-1' },
    });
    expect(reserveRes.statusCode).toBe(201);
    const reservationId = reserveRes.json().id as string;

    balanceRes = await app.inject({
      method: 'GET',
      url: `/api/v1/inventory/balance?skuId=${skuId}&locationId=${location.id}`,
      headers: { authorization: `Bearer ${warehouseManager.token}` },
    });
    expect(balanceRes.json().available).toBe(75);

    await app.inject({
      method: 'POST',
      url: `/api/v1/inventory/reservations/${reservationId}/release`,
      headers: { authorization: `Bearer ${warehouseManager.token}` },
      payload: {},
    });

    balanceRes = await app.inject({
      method: 'GET',
      url: `/api/v1/inventory/balance?skuId=${skuId}&locationId=${location.id}`,
      headers: { authorization: `Bearer ${warehouseManager.token}` },
    });
    expect(balanceRes.json().available).toBe(95);

    // --- Catalog: price, then the explicit Merchandiser publish action
    // (CAT-002/PROD-003 - both the automated QA gate AND this action are
    // required; a style with no active price is not storefront-publishable
    // even once its lifecycle state is PUBLISHED, per getCatalogEntry below) ---
    const priceRes = await app.inject({
      method: 'POST',
      url: '/api/v1/catalog/prices',
      headers: { authorization: `Bearer ${merchandiser.token}` },
      payload: { styleId, mrp: 1999, sellingPrice: 1999 },
    });
    expect(priceRes.statusCode).toBe(201);

    const publishRes = await app.inject({
      method: 'POST',
      url: `/api/v1/products/styles/${styleId}/publish`,
      headers: { authorization: `Bearer ${merchandiser.token}` },
    });
    expect(publishRes.statusCode).toBe(200);
    expect(publishRes.json().lifecycleState).toBe('PUBLISHED');

    const catalogEntryRes = await app.inject({
      method: 'GET',
      url: `/api/v1/catalog/entries/${styleId}`,
      headers: { authorization: `Bearer ${merchandiser.token}` },
    });
    expect(catalogEntryRes.json().isPublishable).toBe(true);

    // --- Audit evidence exists for the key privileged actions ---
    const auditActions = await testPrisma.auditLog.findMany({ select: { action: true } });
    const actionSet = new Set(auditActions.map((a) => a.action));
    expect(actionSet.has('purchase_order.approve')).toBe(true);
    expect(actionSet.has('grn.create')).toBe(true);
    expect(actionSet.has('style.publish')).toBe(true);
  });
});
