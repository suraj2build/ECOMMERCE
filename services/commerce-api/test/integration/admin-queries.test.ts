import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '../helpers/app.js';
import { resetDatabase, seedRbac, grantPermissions, seedBrandAndLocation, testPrisma } from '../helpers/db.js';
import { createAuthenticatedStaff } from '../helpers/auth.js';
import { InventoryService } from '../../src/modules/inventory/service.js';
import { boundedTake } from '../../src/modules/admin-queries/service.js';

/**
 * P1 Commerce Operations Console - read-only query endpoints
 * (modules/admin-queries, docs/admin/P1_QUERY_ENDPOINTS.md), plus the two
 * pre-existing secret exposures the P1 build found and fixed: GET /grn/:id
 * returned the receiving staff member's passwordHash/mfaSecret, and the
 * gift-card staff views returned codeHash.
 *
 * Every endpoint is tested unauthenticated (401), without its permission
 * (403 + authz.denied audit row), and authorized (real data built through
 * the domain APIs, not inserted around them).
 */

const GUEST_HEADER = 'x-guest-session-id';
const SERVICEABLE_PINCODE = '110002';

describe('Admin query endpoints (P1)', () => {
  let app: FastifyInstance;
  let counter = 0;
  let stockOperationCounter = 0;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase();
    await seedRbac();
    counter += 1;
  });

  async function staff(role: string, perms: string[]) {
    await grantPermissions(role, perms);
    return createAuthenticatedStaff(app, [role]);
  }

  const get = (url: string, token?: string) =>
    app.inject({ method: 'GET', url: `/api/v1${url}`, headers: token ? { authorization: `Bearer ${token}` } : {} });

  // ---------------------------------------------------------------- fixtures

  async function seedContext() {
    const { brand, category, size, location } = await seedBrandAndLocation();
    const legalEntity = await testPrisma.legalEntity.create({ data: { legalName: 'Admin Query Test Pvt Ltd', registeredState: 'Delhi' } });
    const registration = await testPrisma.gstRegistration.create({
      data: {
        legalEntityId: legalEntity.id,
        gstin: `DLADMQRY${counter}A1Z${counter % 10}`,
        stateCode: 'DL',
        stateName: 'Delhi',
        status: 'ACTIVE',
        effectiveFrom: new Date(Date.now() - 86_400_000),
      },
    });
    await testPrisma.location.update({ where: { id: location.id }, data: { gstRegistrationId: registration.id } });
    await testPrisma.serviceablePincode.upsert({
      where: { pincode: SERVICEABLE_PINCODE },
      create: { pincode: SERVICEABLE_PINCODE, city: 'New Delhi', state: 'Delhi', isServiceable: true, codAvailable: true },
      update: {},
    });
    return { brandId: brand.id, categoryId: category.id, sizeId: size.id, locationId: location.id };
  }

  /** A published, priced SKU with stock, created through the product/catalog APIs. */
  async function checkoutableSku(ctx: Awaited<ReturnType<typeof seedContext>>, styleCode: string, name = 'Query Test Jacket') {
    const { token } = await staff('MERCHANDISING', ['product:read', 'product:write', 'product:publish', 'catalog:price:write']);
    const h = { authorization: `Bearer ${token}` };
    const hsnCode = '6109';
    if (!(await testPrisma.taxRate.findFirst({ where: { hsnCode } }))) {
      await testPrisma.taxRate.create({ data: { hsnCode, gstRatePercent: 12, effectiveFrom: new Date(Date.now() - 86_400_000) } });
    }
    const style = await app.inject({
      method: 'POST',
      url: '/api/v1/products/styles',
      headers: h,
      payload: { styleCode, name, brandId: ctx.brandId, categoryId: ctx.categoryId, season: 'SS26', collection: 'Core', hsnCode },
    });
    const styleId = style.json().id as string;
    const colour = await app.inject({ method: 'POST', url: `/api/v1/products/styles/${styleId}/colours`, headers: h, payload: { name: 'Black', colourCode: 'BLK' } });
    const skus = await app.inject({ method: 'POST', url: `/api/v1/products/styles/${styleId}/skus/generate`, headers: h, payload: { sizeIds: [ctx.sizeId] } });
    const skuId = skus.json()[0].skuId as string;
    await app.inject({ method: 'POST', url: `/api/v1/products/styles/${styleId}/media`, headers: h, payload: { colourId: colour.json().id, url: 'https://example.com/x.jpg' } });
    await app.inject({ method: 'POST', url: `/api/v1/products/styles/${styleId}/ready-for-enrichment`, headers: h });
    await app.inject({ method: 'POST', url: `/api/v1/products/styles/${styleId}/qa-check`, headers: h });
    await app.inject({ method: 'POST', url: `/api/v1/products/styles/${styleId}/publish`, headers: h });
    await app.inject({ method: 'POST', url: '/api/v1/catalog/prices', headers: h, payload: { styleId, mrp: 1000, sellingPrice: 1000 } });
    return { styleId, skuId, skuCode: (await testPrisma.sku.findUniqueOrThrow({ where: { id: skuId } })).skuCode };
  }

  /** Stock arrives through the ledger (a manual adjustment), never by writing the balance table. */
  async function stock(skuId: string, locationId: string, qty: number) {
    const { token } = await staff('WAREHOUSE_MANAGER', ['inventory:adjust']);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/inventory/adjustments',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        skuId,
        locationId,
        quantityDelta: qty,
        reason: 'P1 test opening stock',
        idempotencyKey: `admin-stock-${counter}-${++stockOperationCounter}`,
      },
    });
    expect(res.statusCode).toBe(201);
  }

  // ------------------------------------------------------ auth boundaries

  const gated: Array<{ url: () => string; permission: string }> = [
    { url: () => '/admin/lookup/skus?q=A', permission: 'product:read' },
    { url: () => '/admin/lookup/styles?q=A', permission: 'product:read' },
    { url: () => '/admin/lookup/suppliers?q=A', permission: 'supplier:read' },
    { url: () => '/admin/products/styles', permission: 'product:read' },
    { url: () => '/admin/purchase-orders', permission: 'po:read' },
    { url: () => '/admin/inventory/stock', permission: 'inventory:read' },
    { url: () => '/admin/inventory/transfers', permission: 'inventory:read' },
    { url: () => '/admin/refunds', permission: 'payment:refund' },
    { url: () => '/admin/gift-cards', permission: 'giftcard:read' },
    { url: () => '/admin/catalog/collections', permission: 'product:read' },
    { url: () => '/admin/lookup/staff?capability=inventory-coapprover', permission: 'inventory:adjust' },
    { url: () => '/admin/lookup/labels?supplierIds=00000000-0000-4000-8000-000000000000', permission: 'supplier:read' },
    { url: () => '/admin/lookup/staff?capability=pick-shortfall-coapprover', permission: 'warehouse:pick' },
    { url: () => '/admin/suppliers', permission: 'supplier:read' },
    { url: () => '/admin/suppliers/00000000-0000-4000-8000-000000000000/sku-links', permission: 'supplier:read' },
    { url: () => '/admin/promotion-types', permission: 'promotion:read' },
    { url: () => '/admin/orders', permission: 'order:read' },
    { url: () => '/admin/fulfilments', permission: 'order:read' },
    { url: () => '/admin/purchase-orders/00000000-0000-4000-8000-000000000000/lines', permission: 'po:read' },
  ];

  it('every query endpoint rejects an unauthenticated request with 401', async () => {
    for (const { url } of [...gated, { url: () => '/admin/dashboard/workload' }]) {
      expect((await get(url())).statusCode, url()).toBe(401);
    }
  });

  it('every gated query endpoint rejects a staff member without the permission (403) and records authz.denied', async () => {
    const { token, staffUserId } = await staff('MARKETING', ['cms:read']);
    for (const { url, permission } of gated) {
      const res = await get(url(), token);
      expect(res.statusCode, url()).toBe(403);
      expect(res.json().error.message).toContain(permission);
    }
    const denials = await testPrisma.auditLog.findMany({ where: { action: 'authz.denied', actorStaffId: staffUserId } });
    expect(denials.length).toBe(gated.length);
  });

  // ---------------------------------------------------------------- lookups

  it('SKU and style lookup find by business identifiers, bounded, with no internal-only fields', async () => {
    const ctx = await seedContext();
    const a = await checkoutableSku(ctx, `LOOKUP-A-${counter}`, 'Linen Overshirt');
    await checkoutableSku(ctx, `LOOKUP-B-${counter}`, 'Denim Jacket');
    const { token } = await staff('CATALOG', ['product:read']);

    const byCode = (await get(`/admin/lookup/skus?q=${encodeURIComponent(a.skuCode.toLowerCase())}`, token)).json();
    expect(byCode).toHaveLength(1);
    expect(byCode[0]).toMatchObject({ id: a.skuId, skuCode: a.skuCode, style: { name: 'Linen Overshirt' }, colour: { name: 'Black' } });

    const byStyleName = (await get('/admin/lookup/skus?q=overshirt', token)).json();
    expect(byStyleName.map((s: { id: string }) => s.id)).toEqual([a.skuId]);

    const styles = (await get('/admin/lookup/styles?q=lookup-', token)).json();
    expect(styles).toHaveLength(2);
    expect(Object.keys(styles[0]).sort()).toEqual(['id', 'lifecycleState', 'name', 'styleCode']);

    expect((await get('/admin/lookup/skus?q=', token)).statusCode).toBe(400);
    expect((await get(`/admin/lookup/skus?q=${'x'.repeat(101)}`, token)).statusCode).toBe(400);
  });

  it('bounds every page size, whatever the client asks for', () => {
    expect(boundedTake(10_000, 100, 25)).toBe(100);
    expect(boundedTake(undefined, 100, 25)).toBe(25);
    expect(boundedTake(0, 25, 10)).toBe(1);
  });

  it('style list returns names and counts with a total, filterable by search and lifecycle state', async () => {
    const ctx = await seedContext();
    await checkoutableSku(ctx, `LIST-PUB-${counter}`, 'Published Tee');
    const { token } = await staff('CATALOG', ['product:read', 'product:write']);
    await app.inject({
      method: 'POST',
      url: '/api/v1/products/styles',
      headers: { authorization: `Bearer ${token}` },
      payload: { styleCode: `LIST-DRAFT-${counter}`, name: 'Draft Tee', brandId: ctx.brandId, categoryId: ctx.categoryId, season: 'SS26', collection: 'Core' },
    });

    const all = (await get('/admin/products/styles?q=LIST-', token)).json();
    expect(all.total).toBe(2);
    const published = (await get('/admin/products/styles?lifecycleState=PUBLISHED', token)).json();
    expect(published.total).toBe(1);
    expect(published.items[0]).toMatchObject({ name: 'Published Tee', brand: { name: expect.any(String) }, _count: { skus: 1, colours: 1, media: 1 } });
  });

  // Independent-review finding: these two filters were typed as free strings and an
  // unknown value reached Prisma as an invalid enum, answering 500 instead of the
  // 400 every other invalid enum gets (api-input-failures.test.ts).
  it('rejects an unknown lifecycle state or PO status filter with 400, not 500', async () => {
    const { token } = await staff('CATALOG', ['product:read', 'po:read']);
    for (const url of ['/admin/products/styles?lifecycleState=BOGUS', '/admin/purchase-orders?status=BOGUS']) {
      const res = await get(url, token);
      expect(res.statusCode, url).toBe(400);
      expect(res.json().error.code, url).toBe('VALIDATION_ERROR');
    }
    expect((await get('/admin/products/styles?lifecycleState=PUBLISHED', token)).statusCode).toBe(200);
    expect((await get('/admin/purchase-orders?status=SUBMITTED', token)).statusCode).toBe(200);
  });

  it('staff lookup lists only active holders of the approving permission, identity only, never the caller', async () => {
    await grantPermissions('FINANCE', ['inventory:adjust:coapprove']);
    const approver = await createAuthenticatedStaff(app, ['FINANCE']);
    const inactive = await createAuthenticatedStaff(app, ['FINANCE']);
    await testPrisma.staffUser.update({ where: { id: inactive.staffUserId }, data: { isActive: false } });
    await createAuthenticatedStaff(app, ['MARKETING']); // no coapprove permission

    const requester = await staff('WAREHOUSE_MANAGER', ['inventory:adjust']);
    const res = await get('/admin/lookup/staff?capability=inventory-coapprover', requester.token);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([{ id: approver.staffUserId, fullName: 'Test Staff' }]);
    expect(JSON.stringify(res.json())).not.toMatch(/passwordHash|mfaSecret|email/);

    expect((await get('/admin/lookup/staff?capability=everyone', requester.token)).statusCode).toBe(400);
  });

  it('label resolution authorizes each id group by the entity it reveals', async () => {
    const ctx = await seedContext();
    const sku = await checkoutableSku(ctx, `LABEL-${counter}`, 'Label Tee');
    const catalog = await staff('CATALOG', ['product:read']);

    const ok = await get(`/admin/lookup/labels?styleIds=${sku.styleId}&skuIds=${sku.skuId}&locationIds=${ctx.locationId}`, catalog.token);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().styles[sku.styleId]).toContain('Label Tee');
    expect(ok.json().skus[sku.skuId]).toBe(sku.skuCode);
    expect(Object.keys(ok.json().locations)).toEqual([ctx.locationId]);

    // product:read does not reveal suppliers or orders.
    expect((await get(`/admin/lookup/labels?supplierIds=${ctx.locationId}`, catalog.token)).statusCode).toBe(403);
    expect((await get(`/admin/lookup/labels?orderIds=${ctx.locationId}`, catalog.token)).statusCode).toBe(403);
    expect((await get('/admin/lookup/labels?styleIds=not-a-uuid', catalog.token)).statusCode).toBe(400);
  });

  // ------------------------------------------------------------ procurement

  it('supplier lookup and PO list show supplier/location names and search by PO number or supplier', async () => {
    const ctx = await seedContext();
    const sku = await checkoutableSku(ctx, `PO-${counter}`);
    const buyer = await staff('BUYING', ['supplier:read', 'supplier:write', 'po:create', 'po:read']);
    const h = { authorization: `Bearer ${buyer.token}` };
    const supplier = await app.inject({ method: 'POST', url: '/api/v1/suppliers', headers: h, payload: { code: `SUP-${counter}`, name: 'Northwind Textiles', type: 'FINISHED_GOODS' } });
    expect(supplier.statusCode).toBe(201);
    const po = await app.inject({
      method: 'POST',
      url: '/api/v1/procurement/purchase-orders',
      headers: h,
      payload: { supplierId: supplier.json().id, locationId: ctx.locationId, lines: [{ skuId: sku.skuId, orderedQty: 4, unitCost: 250 }] },
    });
    expect(po.statusCode).toBe(201);

    expect((await get('/admin/lookup/suppliers?q=northwind', buyer.token)).json()).toEqual([
      { id: supplier.json().id, code: `SUP-${counter}`, name: 'Northwind Textiles', type: 'FINISHED_GOODS', isActive: true },
    ]);

    const byName = (await get('/admin/purchase-orders?q=northwind', buyer.token)).json();
    expect(byName.total).toBe(1);
    expect(byName.items[0]).toMatchObject({
      poNumber: po.json().poNumber,
      status: 'DRAFT',
      totalCost: 1000,
      supplier: { name: 'Northwind Textiles' },
      location: { id: ctx.locationId },
      _count: { lines: 1, goodsReceipts: 0 },
    });
    expect((await get(`/admin/purchase-orders?q=${po.json().poNumber}`, buyer.token)).json().total).toBe(1);
    expect((await get('/admin/purchase-orders?status=APPROVED', buyer.token)).json().total).toBe(0);
  });

  it('supplier list is paginated with link/PO counts, and a supplier\'s SKU cost links are listed with SKU codes', async () => {
    const ctx = await seedContext();
    const sku = await checkoutableSku(ctx, `SL-${counter}`);
    const buyer = await staff('BUYING', ['supplier:read', 'supplier:write']);
    const h = { authorization: `Bearer ${buyer.token}` };
    const a = (await app.inject({ method: 'POST', url: '/api/v1/suppliers', headers: h, payload: { code: `SLA-${counter}`, name: 'Alpha Mills', type: 'FINISHED_GOODS' } })).json();
    const b = (await app.inject({ method: 'POST', url: '/api/v1/suppliers', headers: h, payload: { code: `SLB-${counter}`, name: 'Beta Weaves', type: 'MANUFACTURING' } })).json();
    await app.inject({ method: 'POST', url: `/api/v1/suppliers/${b.id}/deactivate`, headers: h });
    const link = await app.inject({
      method: 'POST',
      url: '/api/v1/suppliers/sku-links',
      headers: h,
      payload: { supplierId: a.id, skuId: sku.skuId, styleId: sku.styleId, cost: 310.5, isPreferred: true },
    });
    expect(link.statusCode).toBe(201);

    const page1 = (await get('/admin/suppliers?take=1', buyer.token)).json();
    expect(page1.total).toBe(2);
    expect(page1.items).toHaveLength(1);
    expect(page1.items[0]).toMatchObject({ name: 'Alpha Mills', _count: { supplierSkus: 1, purchaseOrders: 0 } });
    expect((await get('/admin/suppliers?isActive=false', buyer.token)).json().items.map((s: { id: string }) => s.id)).toEqual([b.id]);
    expect((await get('/admin/suppliers?type=MANUFACTURING', buyer.token)).json().total).toBe(1);
    expect((await get('/admin/suppliers?q=alpha', buyer.token)).json().total).toBe(1);

    const links = (await get(`/admin/suppliers/${a.id}/sku-links`, buyer.token)).json();
    expect(links.total).toBe(1);
    expect(links.items[0]).toMatchObject({ cost: 310.5, isPreferred: true, sku: { id: sku.skuId, skuCode: sku.skuCode }, style: { id: sku.styleId } });
    expect((await get(`/admin/suppliers/${b.id}/sku-links`, buyer.token)).json().total).toBe(0);
  });

  it('promotion types list the seeded reference table that POST /promotions takes a key from', async () => {
    await testPrisma.promotionType.createMany({ data: [{ key: 'PROMOTIONAL', name: 'Promotional coupon' }, { key: 'CAMPAIGN', name: 'Campaign coupon' }] });
    const { token } = await staff('MARKETING', ['promotion:read']);
    const types = (await get('/admin/promotion-types', token)).json();
    expect(types.map((t: { key: string }) => t.key).sort()).toEqual(['CAMPAIGN', 'PROMOTIONAL']);
    expect(Object.keys(types[0]).sort()).toEqual(['id', 'key', 'name']);
  });

  it('GRN detail no longer exposes the receiving staff member\'s password hash or MFA secret', async () => {
    const ctx = await seedContext();
    const sku = await checkoutableSku(ctx, `GRN-${counter}`);
    const buyer = await staff('BUYING', ['supplier:write', 'po:create', 'po:submit', 'po:read']);
    const finance = await staff('FINANCE', ['po:approve', 'po:read']);
    const receiver = await staff('WAREHOUSE_MANAGER', ['grn:create', 'grn:read']);
    await testPrisma.staffUser.update({ where: { id: receiver.staffUserId }, data: { mfaSecret: 'v1:aa:bb:cc', mfaEnabled: true } });
    const hb = { authorization: `Bearer ${buyer.token}` };

    const supplier = await app.inject({ method: 'POST', url: '/api/v1/suppliers', headers: hb, payload: { code: `GRS-${counter}`, name: 'GRN Supplier', type: 'FINISHED_GOODS' } });
    const po = await app.inject({
      method: 'POST',
      url: '/api/v1/procurement/purchase-orders',
      headers: hb,
      payload: { supplierId: supplier.json().id, locationId: ctx.locationId, lines: [{ skuId: sku.skuId, orderedQty: 2, unitCost: 100 }] },
    });
    const poId = po.json().id as string;
    await app.inject({ method: 'POST', url: `/api/v1/procurement/purchase-orders/${poId}/submit`, headers: hb, payload: {} });
    const approved = await app.inject({ method: 'POST', url: `/api/v1/procurement/purchase-orders/${poId}/approve`, headers: { authorization: `Bearer ${finance.token}` }, payload: {} });
    expect(approved.statusCode).toBe(200);
    const grn = await app.inject({
      method: 'POST',
      url: '/api/v1/grn',
      headers: { authorization: `Bearer ${receiver.token}` },
      payload: {
        poId,
        locationId: ctx.locationId,
        lines: [{ poLineId: po.json().lines[0].id, skuId: sku.skuId, receivedQty: 2, acceptedQty: 2, damagedQty: 0, rejectedQty: 0 }],
      },
    });
    expect(grn.statusCode).toBe(201);

    // The PO line view gives the approver (po:read, no product:read) SKU codes, receipt progress and approver names.
    const lines = (await get(`/admin/purchase-orders/${poId}/lines`, finance.token)).json();
    expect(lines.lines).toEqual([
      expect.objectContaining({ skuId: sku.skuId, orderedQty: 2, receivedQty: 2, unitCost: 100, sku: expect.objectContaining({ skuCode: sku.skuCode }) }),
    ]);
    expect(lines.submittedBy).toEqual({ id: buyer.staffUserId, fullName: 'Test Staff' });
    expect(lines.approvedBy).toEqual({ id: finance.staffUserId, fullName: 'Test Staff' });
    expect(lines.approvals.map((a: { action: string }) => a.action)).toEqual(['SUBMITTED', 'APPROVED']);
    expect(JSON.stringify(lines)).not.toMatch(/passwordHash|mfaSecret|email/);
    expect((await get('/admin/purchase-orders/00000000-0000-4000-8000-000000000000/lines', finance.token)).statusCode).toBe(404);

    const detail = await get(`/grn/${grn.json().id}`, receiver.token);
    expect(detail.statusCode).toBe(200);
    expect(detail.json().receivedBy).toEqual({ id: receiver.staffUserId, fullName: 'Test Staff', email: expect.any(String) });
    expect(detail.body).not.toMatch(/passwordHash|mfaSecret|\$2[aby]\$/);
  });

  // -------------------------------------------------------------- inventory

  it('stock list reports the inventory domain\'s own balances and available figure, filterable by search and location', async () => {
    const ctx = await seedContext();
    const sku = await checkoutableSku(ctx, `STK-${counter}`, 'Stock Chino');
    await stock(sku.skuId, ctx.locationId, 7);
    const other = await testPrisma.location.create({ data: { code: `STK-OTHER-${counter}`, name: 'Other Store', type: 'STORE' } });
    await stock(sku.skuId, other.id, 2);
    const reader = await staff('ANALYTICS', ['inventory:read']);

    const all = (await get('/admin/inventory/stock?q=chino', reader.token)).json();
    expect(all.total).toBe(2);
    const expected = await new InventoryService(app).getBalance(sku.skuId, ctx.locationId);
    const row = all.items.find((r: { locationId: string }) => r.locationId === ctx.locationId);
    expect(row).toMatchObject({
      onHand: expected.onHand,
      reserved: expected.reserved,
      available: expected.available,
      sku: { skuCode: sku.skuCode, style: { name: 'Stock Chino' } },
    });

    const atOther = (await get(`/admin/inventory/stock?locationId=${other.id}`, reader.token)).json();
    expect(atOther.items.map((r: { onHand: number }) => r.onHand)).toEqual([2]);
  });

  it('transfer list shows IN_TRANSIT and COMPLETED transfers created through the transfer APIs', async () => {
    const ctx = await seedContext();
    const sku = await checkoutableSku(ctx, `TRF-${counter}`);
    await stock(sku.skuId, ctx.locationId, 5);
    const store = await testPrisma.location.create({ data: { code: `TRF-TO-${counter}`, name: 'Destination Store', type: 'STORE' } });
    const wh = await staff('WAREHOUSE_MANAGER', ['inventory:transfer', 'inventory:read']);
    const h = { authorization: `Bearer ${wh.token}` };
    const out1 = await app.inject({ method: 'POST', url: '/api/v1/inventory/transfers/out', headers: h, payload: { skuId: sku.skuId, fromLocationId: ctx.locationId, toLocationId: store.id, quantity: 2 } });
    const out2 = await app.inject({ method: 'POST', url: '/api/v1/inventory/transfers/out', headers: h, payload: { skuId: sku.skuId, fromLocationId: ctx.locationId, toLocationId: store.id, quantity: 1 } });
    expect(out1.statusCode).toBe(201);
    const received = await app.inject({ method: 'POST', url: `/api/v1/inventory/transfers/${out2.json().id}/in`, headers: h });
    expect(received.statusCode).toBe(200);

    const inTransit = (await get('/admin/inventory/transfers?status=IN_TRANSIT', wh.token)).json();
    expect(inTransit.total).toBe(1);
    expect(inTransit.items[0]).toMatchObject({ id: out1.json().id, quantity: 2, fromLocation: { id: ctx.locationId }, toLocation: { name: 'Destination Store' } });
    expect((await get('/admin/inventory/transfers?status=COMPLETED', wh.token)).json().total).toBe(1);
    expect((await get('/admin/inventory/transfers?status=LOST', wh.token)).statusCode).toBe(400);
  });

  // ----------------------------------------------------------- post-purchase

  it('refund queue lists refunds created by the real return -> QC -> refund path, with numeric amounts', async () => {
    const ctx = await seedContext();
    const sku = await checkoutableSku(ctx, `RFQ-${counter}`);
    await stock(sku.skuId, ctx.locationId, 5);
    const headers = { [GUEST_HEADER]: `guest-admin-q-${counter}` };
    expect((await app.inject({ method: 'POST', url: '/api/v1/storefront/cart/items', headers, payload: { skuId: sku.skuId, quantity: 1 } })).statusCode).toBe(201);
    const address = { line1: '1 Test Street', city: 'New Delhi', state: 'Delhi', stateCode: 'DL', pincode: SERVICEABLE_PINCODE };
    const checkout = await app.inject({
      method: 'POST',
      url: '/api/v1/storefront/checkout',
      headers,
      payload: { contactName: 'Jane Doe', contactMobile: '9876543210', billingAddress: address, shippingAddress: address, paymentMethod: 'COD', idempotencyKey: `admq-${counter}` },
    });
    expect(checkout.statusCode).toBe(201);
    const order = await testPrisma.order.findUniqueOrThrow({ where: { checkoutSessionId: checkout.json().id }, include: { lines: true } });
    const lineId = order.lines[0]!.id;

    const wh = await staff('WAREHOUSE_MANAGER', ['order:read', 'order:fulfil', 'warehouse:read', 'warehouse:pick', 'warehouse:pack', 'return:read', 'return:initiate', 'return:receive', 'return:qc']);
    const hw = { authorization: `Bearer ${wh.token}` };
    const task = await testPrisma.pickTask.findUniqueOrThrow({ where: { orderLineId: lineId } });
    await app.inject({ method: 'POST', url: `/api/v1/warehouse/pick-tasks/${task.id}/pick`, headers: hw, payload: { idempotencyKey: `pick-${lineId}`, outcome: 'FULL', pickedQuantity: 1 } });
    const fulfilmentId = (await app.inject({ method: 'POST', url: `/api/v1/orders/${order.id}/fulfilments`, headers: hw, payload: { lineIds: [lineId] } })).json().id as string;

    // Order search by number and the fulfilment queue, before shipping.
    const found = (await get(`/admin/orders?q=${order.orderNumber.slice(-6)}`, wh.token)).json();
    expect(found.total).toBe(1);
    expect(found.items[0]).toMatchObject({ id: order.id, orderNumber: order.orderNumber, paymentMethod: 'COD', grandTotal: Number(order.grandTotal), _count: { lines: 1 } });
    expect(found.items[0]).not.toHaveProperty('contactMobile');
    expect(found.items[0]).not.toHaveProperty('shippingAddress');
    const pending = (await get('/admin/fulfilments?status=PENDING', wh.token)).json();
    expect(pending.total).toBe(1);
    expect(pending.items[0]).toMatchObject({ id: fulfilmentId, orderId: order.id, exchangeId: null, order: { orderNumber: order.orderNumber }, shipment: null, _count: { lines: 1 } });

    for (const step of ['pack', 'ready-to-ship', 'ship', 'deliver']) {
      const res = await app.inject({ method: 'POST', url: `/api/v1/orders/fulfilments/${fulfilmentId}/${step}`, headers: hw, payload: step === 'ship' ? {} : undefined });
      expect(res.statusCode, step).toBe(200);
    }
    const ret = await app.inject({ method: 'POST', url: '/api/v1/returns', headers: hw, payload: { orderId: order.id, lines: [{ orderLineId: lineId, reason: 'Too big' }], method: 'DROP_OFF', idempotencyKey: `ret-${lineId}` } });
    await app.inject({ method: 'POST', url: `/api/v1/returns/${ret.json().id}/receive`, headers: hw });
    await app.inject({ method: 'POST', url: `/api/v1/returns/${ret.json().id}/lines/${ret.json().lines[0].id}/qc`, headers: hw, payload: { qcResult: 'PASS', disposition: 'RESTOCK_SELLABLE' } });

    expect((await get('/admin/fulfilments?status=PENDING', wh.token)).json().total).toBe(0);
    expect((await get('/admin/fulfilments?status=DELIVERED', wh.token)).json().items[0]).toMatchObject({ id: fulfilmentId });
    expect((await get('/admin/orders?status=DELIVERED', wh.token)).json().total).toBe(1);

    const finance = await staff('FINANCE', ['payment:refund', 'order:read']);
    const refund = await app.inject({ method: 'POST', url: '/api/v1/refunds', headers: { authorization: `Bearer ${finance.token}` }, payload: { orderId: order.id, orderLineId: lineId, idempotencyKey: `rf-${lineId}` } });
    expect(refund.statusCode).toBe(201);

    const queue = (await get('/admin/refunds', finance.token)).json();
    expect(queue.total).toBe(1);
    expect(queue.items[0]).toMatchObject({
      id: refund.json().id,
      orderId: order.id,
      method: 'STORE_CREDIT',
      status: 'COMPLETED',
      amount: Number(order.lines[0]!.lineTotalInclusive),
      order: { orderNumber: order.orderNumber },
    });
    expect((await get('/admin/refunds?status=FAILED', finance.token)).json().total).toBe(0);
  });

  // ------------------------------------------------------------- gift cards

  it('gift-card list and detail never return the code or its hash; list filters by status and last four', async () => {
    const finance = await staff('FINANCE', ['giftcard:manage', 'giftcard:read']);
    const h = { authorization: `Bearer ${finance.token}` };
    const issued = await app.inject({ method: 'POST', url: '/api/v1/gift-cards/issue', headers: h, payload: { initialValue: 750, idempotencyKey: `gc-${counter}` } });
    expect(issued.statusCode).toBe(201);
    const { code } = issued.json();
    const id = issued.json().giftCard.id as string;
    expect(issued.json().giftCard).not.toHaveProperty('codeHash');
    const stored = await testPrisma.giftCard.findUniqueOrThrow({ where: { id } });

    const detail = await get(`/gift-cards/${id}`, finance.token);
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).not.toHaveProperty('codeHash');
    expect(detail.body).not.toContain(stored.codeHash);
    expect(detail.body).not.toContain(code);

    const list = (await get(`/admin/gift-cards?last4=${code.slice(-4)}`, finance.token)).json();
    expect(list.total).toBe(1);
    expect(list.items[0]).toMatchObject({ id, codeLast4: code.slice(-4).toUpperCase(), status: 'ACTIVE', initialValue: 750, balance: 750 });
    expect(JSON.stringify(list)).not.toContain(stored.codeHash);
    expect(JSON.stringify(list)).not.toContain(code);

    const disabled = await app.inject({ method: 'POST', url: `/api/v1/gift-cards/${id}/disable`, headers: h, payload: { reason: 'Reported lost' } });
    expect(disabled.json()).not.toHaveProperty('codeHash');
    expect((await get('/admin/gift-cards?status=ACTIVE', finance.token)).json().total).toBe(0);
    expect((await get('/admin/gift-cards?status=DISABLED', finance.token)).json().total).toBe(1);
  });

  // ---------------------------------------------------------------- catalog

  it('collection list and detail include unpublished collections with their styles', async () => {
    const ctx = await seedContext();
    const sku = await checkoutableSku(ctx, `COL-${counter}`, 'Collection Tee');
    const merch = await staff('MERCHANDISING', ['catalog:collection:manage', 'product:read']);
    const h = { authorization: `Bearer ${merch.token}` };
    const created = await app.inject({ method: 'POST', url: '/api/v1/catalog/collections', headers: h, payload: { name: 'Summer Edit', slug: `summer-edit-${counter}` } });
    expect(created.statusCode).toBe(201);
    await app.inject({ method: 'POST', url: `/api/v1/catalog/collections/${created.json().id}/styles`, headers: h, payload: { styleId: sku.styleId } });

    const list = (await get('/admin/catalog/collections', merch.token)).json();
    expect(list.total).toBe(1);
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ name: 'Summer Edit', _count: { styles: 1 } });
    const detail = (await get(`/admin/catalog/collections/${created.json().id}`, merch.token)).json();
    expect(detail.styles.map((s: { style: { name: string } }) => s.style.name)).toEqual(['Collection Tee']);
    expect((await get('/admin/catalog/collections/00000000-0000-4000-8000-000000000000', merch.token)).statusCode).toBe(404);
  });

  it('pages beyond 200 collections and 500 collection styles without truncation', async () => {
    const ctx = await seedContext();
    const sku = await checkoutableSku(ctx, `BOUND-${counter}`, 'Boundary Tee');
    const merch = await staff('MERCHANDISING', ['product:read']);
    await testPrisma.collection.createMany({ data: Array.from({ length: 205 }, (_, i) => ({ name: `Boundary ${String(i).padStart(3, '0')}`, slug: `boundary-${counter}-${i}` })) });
    const first = (await get('/admin/catalog/collections?take=100', merch.token)).json();
    const last = (await get('/admin/catalog/collections?take=100&skip=200', merch.token)).json();
    expect(first.total).toBe(205);
    expect(first.items).toHaveLength(100);
    expect(last.items).toHaveLength(5);
    expect(last.items[4].name).toBe('Boundary 204');
    const source = await testPrisma.style.findUniqueOrThrow({ where: { id: sku.styleId } });
    await testPrisma.style.createMany({ data: Array.from({ length: 505 }, (_, i) => ({ styleCode: `BOUND-${counter}-${i}`, name: `Style ${i}`, brandId: source.brandId, categoryId: source.categoryId, season: source.season, collection: source.collection })) });
    const styles = await testPrisma.style.findMany({ where: { styleCode: { startsWith: `BOUND-${counter}-` } }, select: { id: true } });
    await testPrisma.collectionStyle.createMany({ data: styles.map((s) => ({ collectionId: first.items[0].id, styleId: s.id })) });
    const detail = (await get(`/admin/catalog/collections/${first.items[0].id}?take=100&skip=500`, merch.token)).json();
    expect(detail._count.styles).toBe(505);
    expect(detail.styles).toHaveLength(5);
  });

  // -------------------------------------------------------------- dashboard

  it('workload computes only the sections the caller may read', async () => {
    const warehouse = await staff('WAREHOUSE_OPERATOR', ['warehouse:read', 'order:read']);
    const res = await get('/admin/dashboard/workload', warehouse.token);
    expect(res.statusCode).toBe(200);
    expect(Object.keys(res.json()).sort()).toEqual(['orders', 'warehouse']);
    expect(res.json().warehouse).toEqual({ pendingPicks: 0, pickExceptions: 0 });

    const none = await staff('MARKETING', ['cms:read']);
    expect((await get('/admin/dashboard/workload', none.token)).json()).toEqual({});
  });
});
