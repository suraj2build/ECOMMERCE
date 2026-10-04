import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '../helpers/app.js';
import { resetDatabase, seedRbac, grantPermissions, testPrisma } from '../helpers/db.js';
import { createAuthenticatedStaff } from '../helpers/auth.js';

/**
 * Admin Ops Phase 1: bulk product import (docs/admin/ADMIN_OPS_PHASE1.md).
 * Dry run writes nothing; apply is per product with row-level errors;
 * re-running is safe; blank cells never clear; inventory is never touched.
 */
describe('Admin Ops Phase 1: bulk product import', () => {
  let app: FastifyInstance;
  let owner: string;
  let noPrices: string;
  let readOnly: string;

  const auth = (t: string) => ({ authorization: `Bearer ${t}` });
  const post = (url: string, payload: unknown, t = owner) => app.inject({ method: 'POST', url: `/api/v1${url}`, headers: auth(t), payload: payload as object });

  const shirt = (row: number, colour: string, code: string, size: string, extra: Record<string, string> = {}) => ({
    row,
    style_code: 'IMP-SHIRT',
    name: 'Linen Shirt',
    brand: 'VANYA',
    category: 'formal-shirts',
    season: 'SS26',
    collection: 'Core',
    gender: 'Men',
    fabric: 'Linen',
    colour_name: colour,
    colour_code: code,
    size,
    mrp: '2499',
    selling_price: '1999',
    ...extra,
  });

  async function counts() {
    const [styles, colours, skus, prices, media, balances, txns, reservations] = await Promise.all([
      testPrisma.style.count(),
      testPrisma.colour.count(),
      testPrisma.sku.count(),
      testPrisma.price.count(),
      testPrisma.productMedia.count(),
      testPrisma.inventoryBalance.count(),
      testPrisma.inventoryTransaction.count(),
      testPrisma.inventoryReservation.count(),
    ]);
    return { styles, colours, skus, prices, media, balances, txns, reservations };
  }

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase();
    await seedRbac();
    await grantPermissions('MERCHANDISING', ['product:read', 'product:write', 'catalog:price:write']);
    await grantPermissions('CATALOG', ['product:read', 'product:write']);
    await grantPermissions('ANALYTICS', ['product:read']);
    owner = (await createAuthenticatedStaff(app, ['MERCHANDISING'])).token;
    noPrices = (await createAuthenticatedStaff(app, ['CATALOG'])).token;
    readOnly = (await createAuthenticatedStaff(app, ['ANALYTICS'])).token;
    await testPrisma.brand.create({ data: { code: 'VANYA', name: 'Vanya' } });
    await testPrisma.category.create({ data: { name: 'Formal Shirts', slug: 'formal-shirts' } });
    await testPrisma.category.create({ data: { name: 'Business Casual Shoes', slug: 'business-casual-shoes', productType: 'FOOTWEAR' } });
    for (const [i, label] of ['S', 'M', 'L', 'UK8', 'UK9'].entries()) await testPrisma.size.create({ data: { label, sortOrder: i } });
    await testPrisma.location.create({ data: { code: 'WH1', name: 'Warehouse' } });
  });

  it('dry run explains what would happen and writes nothing at all', async () => {
    const before = await counts();
    const audits = await testPrisma.auditLog.count();
    const res = await post('/products/imports/validate', { rows: [shirt(2, 'White', 'WHT', 'S'), shirt(3, 'White', 'WHT', 'M', { image_url: 'https://cdn.example.com/w.jpg' })] });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.summary).toMatchObject({ rows: 2, create: 2, error: 0 });
    expect(body.results[0].changes).toEqual(expect.arrayContaining(['new product (draft)', 'new colour White', 'new size S', 'new price']));
    expect(await counts()).toEqual(before);
    expect(await testPrisma.auditLog.count()).toBe(audits);
  });

  it('imports a variant catalogue as drafts with prices and images, never touching stock; a second run changes nothing', async () => {
    const before = await counts();
    const rows = [
      shirt(2, 'White', 'WHT', 'S', { barcode: '8900000000011', image_url: 'https://cdn.example.com/white.jpg', image_alt: 'White linen shirt' }),
      shirt(3, 'White', 'WHT', 'M', { barcode: '8900000000012' }),
      shirt(4, 'Sky Blue', 'SKY', 'S'),
      { row: 5, style_code: 'IMP-SHOE', name: 'Derby', brand: 'vanya', category: 'Business Casual Shoes', season: 'SS26', collection: 'Core', colour_name: 'Tan', size: 'UK8', mrp: '4999', selling_price: '3999' },
    ];
    const run = (await post('/products/imports', { fileName: 'catalogue.csv', totalRows: 4, totalBatches: 1 })).json();
    const res = await post(`/products/imports/${run.id}/batches/0`, { rows });
    expect(res.statusCode).toBe(200);
    expect(res.json().summary).toMatchObject({ create: 4, error: 0 });

    const style = await testPrisma.style.findUniqueOrThrow({ where: { styleCode: 'IMP-SHIRT' }, include: { colours: true, skus: true, prices: true, media: true } });
    expect(style.lifecycleState).toBe('DRAFT');
    expect(style.colours.map((c) => c.colourCode).sort()).toEqual(['SKY', 'WHT']);
    expect(style.skus.map((s) => s.skuCode).sort()).toEqual(['IMP-SHIRT-SKY-S', 'IMP-SHIRT-WHT-M', 'IMP-SHIRT-WHT-S']);
    expect(style.prices).toHaveLength(1);
    expect(style.prices[0]).toMatchObject({ colourId: null, isMarkdown: false });
    expect(Number(style.prices[0]!.sellingPrice)).toBe(1999);
    expect(style.media).toEqual([expect.objectContaining({ url: 'https://cdn.example.com/white.jpg', altText: 'White linen shirt' })]);
    const shoe = await testPrisma.style.findUniqueOrThrow({ where: { styleCode: 'IMP-SHOE' }, include: { colours: true } });
    expect(shoe.colours[0]).toMatchObject({ name: 'Tan', colourCode: 'TAN' });

    const after = await counts();
    expect({ balances: after.balances, txns: after.txns, reservations: after.reservations }).toEqual({ balances: before.balances, txns: before.txns, reservations: before.reservations });

    // Same file again: nothing changes, nothing duplicates.
    const again = await post(`/products/imports/${run.id}/batches/0`, { rows });
    expect(again.json().summary).toMatchObject({ unchanged: 4, create: 0, update: 0, error: 0 });
    expect(await counts()).toEqual(after);

    const stored = (await app.inject({ method: 'GET', url: `/api/v1/products/imports/${run.id}`, headers: auth(readOnly) })).json();
    expect(stored).toMatchObject({ fileName: 'catalogue.csv', batchesDone: 1, summary: { rows: 4, unchanged: 4 } });
  });

  it('explains each bad row, imports the good products, and skips only the product with the error', async () => {
    const rows = [
      shirt(2, 'White', 'WHT', 'S'),
      { row: 3, style_code: 'BAD-1', name: 'X', brand: 'Nobody', category: 'formal-shirts', season: 'SS26', collection: 'Core' },
      { row: 4, style_code: 'BAD-2', name: 'Y', brand: 'VANYA', category: 'formal-shirts', season: 'SS26', collection: 'Core', colour_name: 'Red', size: 'XXL' },
      { row: 5, style_code: 'BAD-3', name: 'Z', brand: 'VANYA', category: 'formal-shirts', season: 'SS26', collection: 'Core', colour_name: 'Red', size: 'S', mrp: '100', selling_price: '150' },
      { row: 6, style_code: 'BAD-4', name: 'W', brand: 'VANYA', category: 'formal-shirts', season: 'SS26', collection: 'Core', image_url: 'http://insecure.example.com/a.jpg' },
      { row: 7, style_code: '', name: 'No code' },
      { row: 8, style_code: 'BAD-5', name: 'V', brand: 'VANYA', category: 'formal-shirts', season: 'SS26', collection: 'Core', colour_name: 'Red', size: 'S', barcode: '111111' },
      { row: 9, style_code: 'BAD-5', colour_name: 'Red', size: 'M', barcode: '111111' },
      { row: 10, style_code: 'BAD-6', name: 'A', brand: 'VANYA', category: 'formal-shirts', season: 'SS26', collection: 'Core', colour_name: 'Red', size: 'S' },
      { row: 11, style_code: 'BAD-6', name: 'B' },
    ];
    const res = await post('/products/imports/validate', { rows });
    const byRow = new Map(res.json().results.map((r: { row: number }) => [r.row, r]));
    const msg = (row: number) => (byRow.get(row) as { messages: string[] }).messages.join(' | ');
    expect((byRow.get(2) as { outcome: string }).outcome).toBe('create');
    expect(msg(3)).toMatch(/Brand "Nobody" is not set up/);
    expect(msg(4)).toMatch(/Size "XXL" is not set up/);
    expect(msg(5)).toMatch(/Selling price cannot be above MRP/);
    expect(msg(6)).toMatch(/https/);
    expect(msg(7)).toMatch(/Style code is required/);
    expect(msg(8)).toMatch(/Barcode 111111 is on rows 8, 9/);
    expect(msg(10)).toMatch(/Rows 10 and 11 give different name values/);

    const run = (await post('/products/imports', { fileName: 'mixed.csv', totalRows: rows.length, totalBatches: 1 })).json();
    const applied = (await post(`/products/imports/${run.id}/batches/0`, { rows })).json();
    expect(applied.summary.create).toBe(1);
    expect(await testPrisma.style.findMany({ select: { styleCode: true } })).toEqual([{ styleCode: 'IMP-SHIRT' }]);
  });

  it('retry after a partial import: fixed rows go in, finished rows are left alone', async () => {
    const good = shirt(2, 'White', 'WHT', 'S');
    const broken = { row: 3, style_code: 'IMP-TEE', name: 'Tee', brand: 'VANYA', category: 'formal-shirts', season: 'SS26', collection: 'Core', colour_name: 'Black', size: 'XS' };
    const run = (await post('/products/imports', { fileName: 'retry.csv', totalRows: 2, totalBatches: 1 })).json();
    const first = (await post(`/products/imports/${run.id}/batches/0`, { rows: [good, broken] })).json();
    expect(first.summary).toMatchObject({ create: 1, error: 1 });

    const fixed = { ...broken, size: 'M' };
    const second = (await post(`/products/imports/${run.id}/batches/0`, { rows: [good, fixed] })).json();
    expect(second.summary).toMatchObject({ unchanged: 1, create: 1, error: 0 });
    expect(await testPrisma.style.count()).toBe(2);
    expect(await testPrisma.sku.count()).toBe(2);
    // The retried batch replaced its earlier results.
    const stored = (await app.inject({ method: 'GET', url: `/api/v1/products/imports/${run.id}`, headers: auth(owner) })).json();
    expect(stored.summary).toMatchObject({ rows: 2, error: 0 });
  });

  it('updates only what the file fills in; blank cells never clear a value', async () => {
    await post('/products/imports/' + (await post('/products/imports', { fileName: 'a.csv', totalRows: 1, totalBatches: 1 })).json().id + '/batches/0', {
      rows: [shirt(2, 'White', 'WHT', 'S', { fit: 'Regular', subtitle: 'Breathable linen' })],
    });
    const run = (await post('/products/imports', { fileName: 'b.csv', totalRows: 1, totalBatches: 1 })).json();
    const res = (await post(`/products/imports/${run.id}/batches/0`, { rows: [{ row: 2, style_code: 'IMP-SHIRT', fabric: 'Linen blend', colour_name: 'White', size: 'S' }] })).json();
    expect(res.results[0]).toMatchObject({ outcome: 'update', changes: ['fabric'] });
    const style = await testPrisma.style.findUniqueOrThrow({ where: { styleCode: 'IMP-SHIRT' } });
    expect(style).toMatchObject({ fabric: 'Linen blend', fit: 'Regular', name: 'Linen Shirt', gender: 'Men' });
    expect(style.customAttributes).toEqual({ subtitle: 'Breathable linen' });
    // Price columns left blank: the price is unchanged.
    expect(await testPrisma.price.count()).toBe(1);
  });

  it('sets a price per colour when colours differ, and notes the missing all-colour price', async () => {
    const rows = [shirt(2, 'White', 'WHT', 'S'), shirt(3, 'White', 'WHT', 'M'), shirt(4, 'Black', 'BLK', 'S', { mrp: '2999', selling_price: '2499' })];
    const run = (await post('/products/imports', { fileName: 'c.csv', totalRows: 3, totalBatches: 1 })).json();
    const res = (await post(`/products/imports/${run.id}/batches/0`, { rows })).json();
    expect(res.summary.create).toBe(3);
    expect(res.results[0].messages.join(' ')).toMatch(/no single price for all colours/);
    const prices = await testPrisma.price.findMany({ include: { colour: true } });
    expect(prices.map((p) => `${p.colour?.colourCode}:${Number(p.sellingPrice)}`).sort()).toEqual(['BLK:2499', 'WHT:1999']);
    // Two prices for one colour is an error.
    const bad = (await post('/products/imports/validate', { rows: [shirt(2, 'White', 'WHT', 'S'), shirt(3, 'White', 'WHT', 'M', { selling_price: '1899' }), shirt(4, 'Black', 'BLK', 'S', { selling_price: '1500' })] })).json();
    expect(bad.results[1].messages.join(' ')).toMatch(/Two different prices for colour White/);
  });

  it('price columns need catalog:price:write; everything else still imports for that user', async () => {
    const res = (await post('/products/imports/validate', { rows: [shirt(2, 'White', 'WHT', 'S')] }, noPrices)).json();
    expect(res.results[0].messages.join(' ')).toMatch(/permission to set prices/);
    const ok = (await post('/products/imports/validate', { rows: [{ ...shirt(2, 'White', 'WHT', 'S'), mrp: '', selling_price: '' }] }, noPrices)).json();
    expect(ok.results[0].outcome).toBe('create');
  });

  it('refuses unknown columns (such as stock), oversized batches, out-of-range batches and read-only users', async () => {
    const stock = await post('/products/imports/validate', { rows: [{ ...shirt(2, 'White', 'WHT', 'S'), stock: '10' }] });
    expect(stock.statusCode).toBe(400);
    const big = await post('/products/imports/validate', { rows: Array.from({ length: 501 }, (_, i) => shirt(i + 2, 'White', 'WHT', 'S')) });
    expect(big.statusCode).toBe(400);
    expect((await post('/products/imports/validate', { rows: [shirt(2, 'White', 'WHT', 'S')] }, readOnly)).statusCode).toBe(403);
    const run = (await post('/products/imports', { fileName: 'x.csv', totalRows: 1, totalBatches: 1 })).json();
    expect((await post(`/products/imports/${run.id}/batches/0`, { rows: [shirt(2, 'White', 'WHT', 'S')] }, readOnly)).statusCode).toBe(403);
    const outOfRange = await post(`/products/imports/${run.id}/batches/3`, { rows: [shirt(2, 'White', 'WHT', 'S')] });
    expect(outOfRange.statusCode).toBe(400);
    const missing = await post('/products/imports/00000000-0000-4000-8000-000000000000/batches/0', { rows: [shirt(2, 'White', 'WHT', 'S')] });
    expect(missing.statusCode).toBe(404);
    // The refused batch numbers and the unknown run did no work.
    expect(await testPrisma.style.count()).toBe(0);
  });

  it('does not let import rename a colour or change a SKU code', async () => {
    const run = (await post('/products/imports', { fileName: 'd.csv', totalRows: 1, totalBatches: 1 })).json();
    await post(`/products/imports/${run.id}/batches/0`, { rows: [shirt(2, 'White', 'WHT', 'S')] });
    const res = (await post('/products/imports/validate', { rows: [shirt(2, 'Ivory', 'WHT', 'S', { sku_code: 'NEW-CODE' })] })).json();
    expect(res.results[0].outcome).toBe('error');
    expect(res.results[0].messages.join(' ')).toMatch(/called "White"/);
    expect(res.results[0].messages.join(' ')).toMatch(/cannot be changed by import/);
  });
});
