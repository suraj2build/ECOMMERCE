import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '../helpers/app.js';
import { resetDatabase, seedRbac, grantPermissions, testPrisma } from '../helpers/db.js';
import { createAuthenticatedStaff } from '../helpers/auth.js';
import { CatalogService } from '../../src/modules/catalog/service.js';

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
  describe('recovery and concurrency', () => {
    const shoe = (row: number, extra: Record<string, string> = {}) => ({
      row, style_code: 'IMP-SHOE', name: 'Derby', brand: 'VANYA', category: 'business-casual-shoes', season: 'SS26', collection: 'Core', colour_name: 'Tan', size: 'UK8', mrp: '4999', selling_price: '3999', ...extra,
    });
    const newRun = async (totalBatches = 1) => (await post('/products/imports', { fileName: 'run.csv', totalRows: 3, totalBatches })).json() as { id: string };

    /** Every audit row about a product record points at a record that exists: nothing was logged for rolled-back work. */
    async function auditsMatchRecords() {
      const audits = await testPrisma.auditLog.findMany({ where: { entityType: { in: ['Style', 'Colour', 'Sku', 'Price', 'ProductMedia'] } } });
      for (const a of audits) {
        const id = a.entityId!;
        const exists =
          a.entityType === 'Style' ? await testPrisma.style.findUnique({ where: { id } })
          : a.entityType === 'Colour' ? await testPrisma.colour.findUnique({ where: { id } })
          : a.entityType === 'Sku' ? await testPrisma.sku.findUnique({ where: { id } })
          : a.entityType === 'Price' ? await testPrisma.price.findUnique({ where: { id } })
          : await testPrisma.productMedia.findUnique({ where: { id } });
        expect(exists, `${a.action} ${a.entityType} ${id}`).not.toBeNull();
      }
      return audits.length;
    }

    it('a failure part-way through a product saves nothing for that product; other products are saved; a retry completes it', async () => {
      const rows = [shirt(2, 'White', 'WHT', 'S', { image_url: 'https://cdn.example.com/w.jpg' }), shirt(3, 'Black', 'BLK', 'M'), shoe(4)];
      const run = await newRun();
      // Fail the shirt's price write: by then its style, colours and SKUs were already written in the transaction.
      const real = CatalogService.prototype.setBasePrice;
      const spy = vi.spyOn(CatalogService.prototype, 'setBasePrice').mockImplementation(async function (this: CatalogService, input, actor) {
        if (input.mrp === 2499) throw new Error('price service unavailable'); // the shirt's price only
        return real.call(this, input, actor);
      });
      const first = (await post(`/products/imports/${run.id}/batches/0`, { rows })).json();
      spy.mockRestore();

      const byRow = new Map(first.results.map((r: { row: number }) => [r.row, r])) as Map<number, { outcome: string; messages: string[] }>;
      expect(byRow.get(2)!.outcome).toBe('error');
      expect(byRow.get(2)!.messages.join(' ')).toMatch(/Not saved: price service unavailable\. Nothing was changed for IMP-SHIRT/);
      expect(byRow.get(3)!.outcome).toBe('error');
      // Nothing of the shirt exists: no style, colours, SKUs, prices, photos.
      expect(await testPrisma.style.findUnique({ where: { styleCode: 'IMP-SHIRT' } })).toBeNull();
      expect(await testPrisma.sku.count({ where: { skuCode: { startsWith: 'IMP-SHIRT' } } })).toBe(0);
      expect(await testPrisma.productMedia.count({ where: { url: 'https://cdn.example.com/w.jpg' } })).toBe(0);
      // The shoe, in the same batch, was saved.
      expect(byRow.get(4)!.outcome).toBe('create');
      expect(await testPrisma.style.count({ where: { styleCode: 'IMP-SHOE' } })).toBe(1);
      await auditsMatchRecords();

      // Retry the same batch: everything goes in, once.
      const second = (await post(`/products/imports/${run.id}/batches/0`, { rows })).json();
      expect(second.summary).toMatchObject({ create: 2, unchanged: 1, error: 0 });
      const shirtStyle = await testPrisma.style.findUniqueOrThrow({ where: { styleCode: 'IMP-SHIRT' }, include: { colours: true, skus: true, prices: true, media: true } });
      expect(shirtStyle.colours).toHaveLength(2);
      expect(shirtStyle.skus).toHaveLength(2);
      expect(shirtStyle.prices).toHaveLength(1);
      expect(shirtStyle.media).toHaveLength(1);
      expect(await testPrisma.style.count({ where: { styleCode: 'IMP-SHOE' } })).toBe(1);
      await auditsMatchRecords();
      const stored = (await app.inject({ method: 'GET', url: `/api/v1/products/imports/${run.id}`, headers: auth(owner) })).json();
      expect(stored.summary.error).toBe(0);
    });

    it('one product failing does not undo another product in the same batch', async () => {
      // An existing shoe gets a price update; the new shirt fails on its price.
      const setup = await newRun();
      await post(`/products/imports/${setup.id}/batches/0`, { rows: [shoe(2)] });
      const run = await newRun();
      const real = CatalogService.prototype.setBasePrice;
      const spy = vi.spyOn(CatalogService.prototype, 'setBasePrice').mockImplementation(async function (this: CatalogService, input, actor) {
        if (input.mrp === 2499) throw new Error('disk full'); // the shirt's price only
        return real.call(this, input, actor);
      });
      const res = (await post(`/products/imports/${run.id}/batches/0`, { rows: [shirt(2, 'White', 'WHT', 'S'), shoe(3, { selling_price: '3499' })] })).json();
      spy.mockRestore();
      expect(res.results.map((r: { outcome: string }) => r.outcome)).toEqual(['error', 'update']);
      expect(await testPrisma.style.findUnique({ where: { styleCode: 'IMP-SHIRT' } })).toBeNull();
      const shoePrices = await testPrisma.price.findMany({ where: { style: { styleCode: 'IMP-SHOE' } }, orderBy: { effectiveFrom: 'asc' } });
      expect(shoePrices.map((p) => Number(p.sellingPrice))).toEqual([3999, 3499]);
      await auditsMatchRecords();
    });

    it('two imports of the same new product at the same moment create it once', async () => {
      const rows = [shirt(2, 'White', 'WHT', 'S'), shirt(3, 'White', 'WHT', 'M'), shirt(4, 'Black', 'BLK', 'S')];
      const [a, b] = await Promise.all([newRun(), newRun()]);
      const [ra, rb] = await Promise.all([post(`/products/imports/${a.id}/batches/0`, { rows }), post(`/products/imports/${b.id}/batches/0`, { rows })]);
      expect([ra.statusCode, rb.statusCode]).toEqual([200, 200]);
      const summaries = [ra.json().summary, rb.json().summary].sort((x, y) => y.create - x.create);
      expect(summaries[0]).toMatchObject({ create: 3, error: 0 });
      expect(summaries[1]).toMatchObject({ unchanged: 3, create: 0, update: 0, error: 0 });
      expect(await testPrisma.style.count({ where: { styleCode: 'IMP-SHIRT' } })).toBe(1);
      expect(await testPrisma.colour.count()).toBe(2);
      expect(await testPrisma.sku.count()).toBe(3);
      expect(await testPrisma.price.count()).toBe(1);
      await auditsMatchRecords();
    });

    it('simultaneous imports with different prices for one product run one after the other and both prices stay in the history', async () => {
      const setup = await newRun();
      await post(`/products/imports/${setup.id}/batches/0`, { rows: [shoe(2)] });
      const [a, b] = await Promise.all([newRun(), newRun()]);
      const [ra, rb] = await Promise.all([
        post(`/products/imports/${a.id}/batches/0`, { rows: [shoe(2, { selling_price: '3799' })] }),
        post(`/products/imports/${b.id}/batches/0`, { rows: [shoe(2, { selling_price: '3599' })] }),
      ]);
      expect([ra.json().summary.update, rb.json().summary.update]).toEqual([1, 1]);
      const prices = await testPrisma.price.findMany({ where: { style: { styleCode: 'IMP-SHOE' } }, orderBy: { effectiveFrom: 'asc' } });
      expect(prices).toHaveLength(3);
      expect(Number(prices[0]!.sellingPrice)).toBe(3999);
      expect(new Set(prices.slice(1).map((p) => Number(p.sellingPrice)))).toEqual(new Set([3799, 3599]));
      // The price in effect is the one saved last.
      const style = await testPrisma.style.findUniqueOrThrow({ where: { styleCode: 'IMP-SHOE' } });
      const active = await new CatalogService(app).getActivePrice(style.id);
      expect(active!.id).toBe(prices[2]!.id);
    });

    it('a batch interrupted after saving is safe to send again: nothing duplicates and search is refreshed', async () => {
      const rows = [shirt(2, 'White', 'WHT', 'S'), shoe(3)];
      const run = await newRun(2);
      // Simulate a crash after the products were saved but before the batch result and search update were recorded.
      const indexSpy = vi.spyOn(app.searchIndex, 'indexStyle').mockRejectedValueOnce(new Error('connection reset'));
      const interrupted = await post(`/products/imports/${run.id}/batches/0`, { rows });
      indexSpy.mockRestore();
      expect(interrupted.statusCode).toBe(500);
      const afterCrash = await counts();
      expect(afterCrash).toMatchObject({ styles: 2, skus: 2, prices: 2 });
      const crashed = (await app.inject({ method: 'GET', url: `/api/v1/products/imports/${run.id}`, headers: auth(owner) })).json();
      expect(crashed.batchesDone).toBe(0);

      const indexed = vi.spyOn(app.searchIndex, 'indexStyle');
      const retry = await post(`/products/imports/${run.id}/batches/0`, { rows });
      expect(retry.statusCode).toBe(200);
      expect(retry.json().summary).toMatchObject({ unchanged: 2, error: 0 });
      // Unchanged products are still re-indexed, repairing the missed update.
      expect(indexed).toHaveBeenCalledTimes(2);
      indexed.mockRestore();
      expect(await counts()).toEqual(afterCrash);
      const stored = (await app.inject({ method: 'GET', url: `/api/v1/products/imports/${run.id}`, headers: auth(owner) })).json();
      expect(stored).toMatchObject({ batchesDone: 1, summary: { rows: 2, unchanged: 2 } });
    });

    it('price history: the same price adds nothing; a new price is appended and takes effect; one colour changes alone', async () => {
      const run = await newRun();
      await post(`/products/imports/${run.id}/batches/0`, { rows: [shirt(2, 'White', 'WHT', 'S'), shirt(3, 'Black', 'BLK', 'S')] });
      const style = await testPrisma.style.findUniqueOrThrow({ where: { styleCode: 'IMP-SHIRT' }, include: { colours: true } });
      const original = await testPrisma.price.findFirstOrThrow({ where: { styleId: style.id } });

      const same = (await post(`/products/imports/${run.id}/batches/0`, { rows: [shirt(2, 'White', 'WHT', 'S'), shirt(3, 'Black', 'BLK', 'S')] })).json();
      expect(same.summary).toMatchObject({ unchanged: 2 });
      expect(await testPrisma.price.count({ where: { styleId: style.id } })).toBe(1);

      const changed = (await post(`/products/imports/${run.id}/batches/0`, { rows: [shirt(2, 'White', 'WHT', 'S', { selling_price: '1799' }), shirt(3, 'Black', 'BLK', 'S', { selling_price: '1799' })] })).json();
      expect(changed.results[0]).toMatchObject({ outcome: 'update', changes: ['price'] });
      const prices = await testPrisma.price.findMany({ where: { styleId: style.id }, orderBy: { effectiveFrom: 'asc' } });
      expect(prices).toHaveLength(2);
      // The old row is untouched.
      expect(prices[0]).toEqual(original);
      const catalog = new CatalogService(app);
      expect(Number((await catalog.getActivePrice(style.id))!.sellingPrice)).toBe(1799);

      // Black alone changes: a Black-only price is appended; White keeps the all-colour price.
      const black = style.colours.find((c) => c.colourCode === 'BLK')!;
      const white = style.colours.find((c) => c.colourCode === 'WHT')!;
      const perColour = (await post(`/products/imports/${run.id}/batches/0`, { rows: [shirt(2, 'White', 'WHT', 'S', { selling_price: '1799' }), shirt(3, 'Black', 'BLK', 'S', { selling_price: '1599' })] })).json();
      expect(perColour.results[1].changes).toEqual(['price for Black']);
      expect(await testPrisma.price.count({ where: { styleId: style.id } })).toBe(3);
      expect(Number((await catalog.getActivePrice(style.id, black.id))!.sellingPrice)).toBe(1599);
      expect(Number((await catalog.getActivePrice(style.id, white.id))!.sellingPrice)).toBe(1799);
      expect(await testPrisma.price.findUniqueOrThrow({ where: { id: original.id } })).toEqual(original);
    });

    it('notes a running markdown when the base price changes', async () => {
      const run = await newRun();
      await post(`/products/imports/${run.id}/batches/0`, { rows: [shoe(2)] });
      const style = await testPrisma.style.findUniqueOrThrow({ where: { styleCode: 'IMP-SHOE' } });
      await testPrisma.price.create({ data: { styleId: style.id, mrp: 4999, sellingPrice: 2999, isMarkdown: true, effectiveFrom: new Date(Date.now() - 60_000), effectiveTo: new Date('2099-01-31T00:00:00Z') } });
      const res = (await post('/products/imports/validate', { rows: [shoe(2, { selling_price: '3799' })] })).json();
      expect(res.results[0].outcome).toBe('update');
      expect(res.results[0].messages.join(' ')).toMatch(/markdown is running until 2099-01-31/);
    });
  });
});
