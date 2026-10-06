import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '../helpers/app.js';
import { resetDatabase, seedRbac, grantPermissions, seedBrandAndLocation, testPrisma } from '../helpers/db.js';
import { createAuthenticatedStaff } from '../helpers/auth.js';
import { ProductMediaService } from '../../src/modules/product/media-service.js';
import type { ProductMediaStore } from '../../src/modules/product/media-storage.js';
import { animatedWebp, claimedPng, cutShortJpeg, exifHasGps, fakeJpeg, meanPixelDifference, photoWithMetadata, realJpeg, realPng, realWebp, truncatedPng } from '../helpers/images.js';
import sharp from 'sharp';
import fs from 'node:fs/promises';

/**
 * Admin Ops Phase 1 (docs/admin/ADMIN_OPS_PHASE1.md): product editing,
 * category product types, readiness and product photo management. Every
 * test goes through the real HTTP routes, permissions and database.
 */

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
let JPEG: Buffer;

/** Stored photo files (not their `.meta.json` sidecars) under the test storage directory. */
async function filesIn(dir: string): Promise<number> {
  try {
    return (await fs.readdir(dir, { recursive: true, withFileTypes: true })).filter((e) => e.isFile() && !e.name.endsWith('.json')).length;
  } catch {
    return 0;
  }
}

function multipart(fields: Record<string, string>, file: { buffer: Buffer; filename: string; contentType: string } | null) {
  const boundary = `----adminops${Math.random().toString(36).slice(2)}`;
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  if (file) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.filename}"\r\nContent-Type: ${file.contentType}\r\n\r\n`));
    parts.push(file.buffer, Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

describe('Admin Ops Phase 1: product editing, readiness and photos', () => {
  let app: FastifyInstance;
  let token: string;
  let readOnlyToken: string;
  let fixtures: Awaited<ReturnType<typeof seedBrandAndLocation>>;

  const auth = (t = token) => ({ authorization: `Bearer ${t}` });

  async function createStyle(styleCode = `AO-${Math.random().toString(36).slice(2, 8).toUpperCase()}`) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/products/styles',
      headers: auth(),
      payload: { styleCode, name: 'Oxford Shirt', brandId: fixtures.brand.id, categoryId: fixtures.category.id, season: 'SS26', collection: 'Core', fabric: 'Cotton' },
    });
    expect(res.statusCode).toBe(201);
    return res.json() as { id: string; styleCode: string };
  }

  async function addColour(styleId: string, name = 'Black', colourCode = 'BLK') {
    const res = await app.inject({ method: 'POST', url: `/api/v1/products/styles/${styleId}/colours`, headers: auth(), payload: { name, colourCode } });
    expect(res.statusCode).toBe(201);
    return res.json() as { id: string };
  }

  async function upload(styleId: string, file = PNG, fields: Record<string, string> = {}, t = token) {
    const body = multipart(fields, { buffer: file, filename: 'photo.png', contentType: 'image/png' });
    return app.inject({ method: 'POST', url: `/api/v1/products/styles/${styleId}/media/upload`, headers: { ...auth(t), 'content-type': body.contentType }, payload: body.payload });
  }

  beforeAll(async () => {
    app = await createTestApp();
    JPEG = await realJpeg();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase();
    await seedRbac();
    await grantPermissions('MERCHANDISING', ['product:read', 'product:write', 'product:publish', 'catalog:price:write', 'product:taxonomy:manage']);
    await grantPermissions('ANALYTICS', ['product:read']);
    token = (await createAuthenticatedStaff(app, ['MERCHANDISING'])).token;
    readOnlyToken = (await createAuthenticatedStaff(app, ['ANALYTICS'])).token;
    fixtures = await seedBrandAndLocation();
  });

  describe('editing a product', () => {
    it('changes only the fields sent, clears an optional field sent as null, and records the changed field names', async () => {
      const style = await createStyle();
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/products/styles/${style.id}`,
        headers: auth(),
        payload: { name: 'Oxford Shirt - Slim', fabric: null, fit: 'Slim', customAttributes: { productType: 'apparel', subtitle: 'Crisp cotton' } },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().changed.sort()).toEqual(['customAttributes', 'fabric', 'fit', 'name']);
      const saved = await testPrisma.style.findUniqueOrThrow({ where: { id: style.id } });
      expect(saved).toMatchObject({ name: 'Oxford Shirt - Slim', fabric: null, fit: 'Slim', season: 'SS26', collection: 'Core' });
      expect(saved.customAttributes).toEqual({ productType: 'apparel', subtitle: 'Crisp cotton' });

      // A key sent as null is removed; other keys are kept.
      await app.inject({ method: 'PATCH', url: `/api/v1/products/styles/${style.id}`, headers: auth(), payload: { customAttributes: { subtitle: null } } });
      expect((await testPrisma.style.findUniqueOrThrow({ where: { id: style.id } })).customAttributes).toEqual({ productType: 'apparel' });

      const audit = await testPrisma.auditLog.findFirst({ where: { entityId: style.id, action: 'style.update' } });
      expect(audit?.newValue).toEqual({ changedFields: expect.arrayContaining(['name', 'fabric']) });
    });

    it('refuses blank required fields, unknown fields (including the style code), bad HSN codes and unknown brands', async () => {
      const style = await createStyle();
      const patch = (payload: object) => app.inject({ method: 'PATCH', url: `/api/v1/products/styles/${style.id}`, headers: auth(), payload });
      expect((await patch({ season: '  ' })).statusCode).toBe(400);
      expect((await patch({ styleCode: 'NEW-CODE' })).statusCode).toBe(400);
      expect((await patch({ hsnCode: '62-05' })).statusCode).toBe(400);
      expect((await patch({ brandId: '00000000-0000-4000-8000-000000000000' })).statusCode).toBe(400);
      const unchanged = await testPrisma.style.findUniqueOrThrow({ where: { id: style.id } });
      expect(unchanged).toMatchObject({ season: 'SS26', styleCode: style.styleCode, hsnCode: null });
    });

    it('needs product:write and refuses archived products', async () => {
      const style = await createStyle();
      const denied = await app.inject({ method: 'PATCH', url: `/api/v1/products/styles/${style.id}`, headers: auth(readOnlyToken), payload: { name: 'x' } });
      expect(denied.statusCode).toBe(403);
      const anonymous = await app.inject({ method: 'PATCH', url: `/api/v1/products/styles/${style.id}`, payload: { name: 'x' } });
      expect(anonymous.statusCode).toBe(401);

      await app.inject({ method: 'POST', url: `/api/v1/products/styles/${style.id}/archive`, headers: auth() });
      const archived = await app.inject({ method: 'PATCH', url: `/api/v1/products/styles/${style.id}`, headers: auth(), payload: { name: 'x' } });
      expect(archived.statusCode).toBe(409);
    });

    it('builds SKU codes from size labels, edits barcodes and on/off, and refuses a duplicate barcode', async () => {
      const style = await createStyle('AO-SHOE');
      const colour = await addColour(style.id);
      const uk8 = await testPrisma.size.create({ data: { label: 'UK 8', sortOrder: 20 } });
      const gen = await app.inject({ method: 'POST', url: `/api/v1/products/styles/${style.id}/skus/generate`, headers: auth(), payload: { sizeIds: [uk8.id, fixtures.size.id] } });
      expect(gen.statusCode).toBe(201);
      const skus = await testPrisma.sku.findMany({ where: { styleId: style.id }, orderBy: { skuCode: 'asc' } });
      expect(skus.map((s) => s.skuCode)).toEqual(['AO-SHOE-BLK-M', 'AO-SHOE-BLK-UK8']);

      const setBarcode = await app.inject({ method: 'PATCH', url: `/api/v1/products/skus/${skus[0]!.id}`, headers: auth(), payload: { barcode: '8901234567890' } });
      expect(setBarcode.statusCode).toBe(200);
      const dup = await app.inject({ method: 'PATCH', url: `/api/v1/products/skus/${skus[1]!.id}`, headers: auth(), payload: { barcode: '8901234567890' } });
      expect(dup.statusCode).toBe(409);
      expect(dup.json().error.message).toMatch(/already used by AO-SHOE-BLK-M/);
      const bad = await app.inject({ method: 'PATCH', url: `/api/v1/products/skus/${skus[1]!.id}`, headers: auth(), payload: { barcode: 'bad code!' } });
      expect(bad.statusCode).toBe(400);
      const off = await app.inject({ method: 'PATCH', url: `/api/v1/products/skus/${skus[1]!.id}`, headers: auth(), payload: { isActive: false } });
      expect(off.json().isActive).toBe(false);
      void colour;
    });

    it('removes a colour only while it has no sizes, prices or photos', async () => {
      const style = await createStyle();
      const black = await addColour(style.id);
      const navy = await addColour(style.id, 'Navy', 'NVY');
      await app.inject({ method: 'POST', url: `/api/v1/products/styles/${style.id}/skus/generate`, headers: auth(), payload: { sizeIds: [fixtures.size.id] } });
      // Both colours now have a size.
      const refused = await app.inject({ method: 'DELETE', url: `/api/v1/products/colours/${black.id}`, headers: auth() });
      expect(refused.statusCode).toBe(409);

      const extra = await addColour(style.id, 'Olive', 'OLV');
      const removed = await app.inject({ method: 'DELETE', url: `/api/v1/products/colours/${extra.id}`, headers: auth() });
      expect(removed.statusCode).toBe(204);
      expect(await testPrisma.colour.count({ where: { styleId: style.id } })).toBe(2);

      const renamed = await app.inject({ method: 'PATCH', url: `/api/v1/products/colours/${navy.id}`, headers: auth(), payload: { name: 'Midnight Navy', hexSwatch: '#1B2A4A' } });
      expect(renamed.json()).toMatchObject({ name: 'Midnight Navy', hexSwatch: '#1B2A4A', colourCode: 'NVY' });
      const badHex = await app.inject({ method: 'PATCH', url: `/api/v1/products/colours/${navy.id}`, headers: auth(), payload: { hexSwatch: 'navy' } });
      expect(badHex.statusCode).toBe(400);
    });

    it('serves reference data with category product types, adds sizes case-insensitively once, and sets a category product type', async () => {
      const shoes = await testPrisma.category.create({ data: { name: 'Shoes', slug: 'shoes-ao' } });
      const ref = await app.inject({ method: 'GET', url: '/api/v1/products/reference', headers: auth(readOnlyToken) });
      expect(ref.statusCode).toBe(200);
      expect(ref.json().categories.find((c: { id: string }) => c.id === shoes.id).productType).toBe('APPAREL');

      const set = await app.inject({ method: 'PATCH', url: `/api/v1/products/categories/${shoes.id}`, headers: auth(), payload: { productType: 'FOOTWEAR' } });
      expect(set.json().productType).toBe('FOOTWEAR');
      const bad = await app.inject({ method: 'PATCH', url: `/api/v1/products/categories/${shoes.id}`, headers: auth(), payload: { productType: 'HATS' } });
      expect(bad.statusCode).toBe(400);

      const created = await app.inject({ method: 'POST', url: '/api/v1/products/sizes', headers: auth(), payload: { label: '100  ml' } });
      expect(created.statusCode).toBe(201);
      expect(created.json().label).toBe('100 ml');
      const again = await app.inject({ method: 'POST', url: '/api/v1/products/sizes', headers: auth(), payload: { label: '100 ML' } });
      expect(again.statusCode).toBe(409);
      const denied = await app.inject({ method: 'POST', url: '/api/v1/products/sizes', headers: auth(readOnlyToken), payload: { label: 'XXXL' } });
      expect(denied.statusCode).toBe(403);
    });
  });

  describe('readiness', () => {
    it('keeps published, purchasable, in-stock and channel status separate and points each gap at its step', async () => {
      const style = await createStyle();
      let r = (await app.inject({ method: 'GET', url: `/api/v1/products/styles/${style.id}/readiness`, headers: auth(readOnlyToken) })).json();
      expect(r.published).toBe(false);
      expect(r.purchasable.ok).toBe(false);
      expect(r.steps).toMatchObject({ basics: 'complete', variants: 'incomplete', photos: 'incomplete', pricing: 'incomplete' });
      expect(r.issues.map((i: { step: string }) => i.step)).toEqual(expect.arrayContaining(['variants', 'photos', 'pricing', 'publish']));

      const colour = await addColour(style.id);
      await app.inject({ method: 'POST', url: `/api/v1/products/styles/${style.id}/skus/generate`, headers: auth(), payload: { sizeIds: [fixtures.size.id] } });
      expect((await upload(style.id, PNG, { colourId: colour.id, altText: 'Front' })).statusCode).toBe(201);
      await app.inject({ method: 'POST', url: '/api/v1/catalog/prices', headers: auth(), payload: { styleId: style.id, mrp: 1999, sellingPrice: 1499 } });
      await app.inject({ method: 'POST', url: `/api/v1/products/styles/${style.id}/ready-for-enrichment`, headers: auth() });
      expect((await app.inject({ method: 'POST', url: `/api/v1/products/styles/${style.id}/qa-check`, headers: auth() })).json().passed).toBe(true);
      expect((await app.inject({ method: 'POST', url: `/api/v1/products/styles/${style.id}/publish`, headers: auth() })).statusCode).toBe(200);

      r = (await app.inject({ method: 'GET', url: `/api/v1/products/styles/${style.id}/readiness`, headers: auth() })).json();
      expect(r.published).toBe(true);
      expect(r.purchasable).toEqual({ ok: true, reasons: [] });
      // Published and purchasable, but nothing in stock: a separate fact.
      expect(r.stock).toEqual({ availableUnits: 0, sizesInStock: 0, sizesForSale: 1 });

      const sku = await testPrisma.sku.findFirstOrThrow({ where: { styleId: style.id } });
      await testPrisma.inventoryBalance.create({ data: { skuId: sku.id, locationId: fixtures.location.id, onHand: 5, reserved: 2 } });
      r = (await app.inject({ method: 'GET', url: `/api/v1/products/styles/${style.id}/readiness`, headers: auth() })).json();
      expect(r.stock).toEqual({ availableUnits: 3, sizesInStock: 1, sizesForSale: 1 });

      // Turning every size off: still published, no longer purchasable.
      await app.inject({ method: 'PATCH', url: `/api/v1/products/skus/${sku.id}`, headers: auth(), payload: { isActive: false } });
      r = (await app.inject({ method: 'GET', url: `/api/v1/products/styles/${style.id}/readiness`, headers: auth() })).json();
      expect(r.published).toBe(true);
      expect(r.purchasable.ok).toBe(false);
      expect(r.purchasable.reasons).toContain('No size is on sale');
    });

    it('reports each channel by its own scope and pause state', async () => {
      const style = await createStyle();
      await testPrisma.channel.create({ data: { key: 'g', name: 'Google', providerName: 'MOCK', config: { publishAll: true } } });
      await testPrisma.channel.create({ data: { key: 'm', name: 'Meta', providerName: 'MOCK', isActive: false } });
      const r = (await app.inject({ method: 'GET', url: `/api/v1/products/styles/${style.id}/readiness`, headers: auth() })).json();
      const google = r.channels.find((c: { name: string }) => c.name === 'Google');
      const meta = r.channels.find((c: { name: string }) => c.name === 'Meta');
      expect(google).toMatchObject({ scope: 'ALL', active: true, sizesListed: 0 });
      expect(meta).toMatchObject({ scope: 'SELECTED', active: false });
      expect(meta.notes).toContain('Channel is paused.');
    });
  });

  describe('product photos', () => {
    it('uploads a photo from the computer, stores it outside the database and serves it publicly by its own key', async () => {
      const style = await createStyle();
      const colour = await addColour(style.id);
      const res = await upload(style.id, PNG, { colourId: colour.id, altText: 'Front view' });
      expect(res.statusCode).toBe(201);
      const media = res.json();
      expect(media).toMatchObject({ colourId: colour.id, altText: 'Front view', mimeType: 'image/png', type: 'IMAGE' });
      expect(media.url).toMatch(/^\/media\/products\/[0-9a-f-]{36}\.png$/);

      const served = await app.inject({ method: 'GET', url: `/api/v1${media.url}` });
      expect(served.statusCode).toBe(200);
      expect(served.headers['content-type']).toBe('image/png');
      expect(served.headers['x-content-type-options']).toBe('nosniff');
      // The admin shows these from another origin; JSON responses stay same-origin.
      expect(served.headers['cross-origin-resource-policy']).toBe('cross-origin');
      expect((await app.inject({ method: 'GET', url: '/api/v1/products/reference', headers: auth() })).headers['cross-origin-resource-policy']).toBe('same-origin');
      // AO-D6: the stored file is a metadata-free re-encoding; PNG is lossless, so every pixel is the same.
      expect(media.byteSize).toBe(served.rawPayload.length);
      expect(await meanPixelDifference(served.rawPayload, PNG)).toBe(0);
    });

    it('decides the type from the bytes, not the name, and refuses empty, unsupported and foreign-colour uploads', async () => {
      const style = await createStyle();
      const other = await createStyle();
      const otherColour = await addColour(other.id);
      const html = Buffer.from('<html><script>alert(1)</script></html>');
      const lying = multipart({}, { buffer: html, filename: 'photo.png', contentType: 'image/png' });
      const r1 = await app.inject({ method: 'POST', url: `/api/v1/products/styles/${style.id}/media/upload`, headers: { ...auth(), 'content-type': lying.contentType }, payload: lying.payload });
      expect(r1.statusCode).toBe(400);
      expect(r1.json().error.message).toMatch(/JPEG, PNG or WebP/);
      expect((await upload(style.id, Buffer.alloc(0))).statusCode).toBe(400);
      expect((await upload(style.id, PNG, { colourId: otherColour.id })).statusCode).toBe(400);
      const noFile = multipart({ altText: 'x' }, null);
      const r4 = await app.inject({ method: 'POST', url: `/api/v1/products/styles/${style.id}/media/upload`, headers: { ...auth(), 'content-type': noFile.contentType }, payload: noFile.payload });
      expect(r4.statusCode).toBe(400);
      const json = await app.inject({ method: 'POST', url: `/api/v1/products/styles/${style.id}/media/upload`, headers: auth(), payload: { url: 'x' } });
      expect(json.statusCode).toBe(400);
      expect(await testPrisma.productMedia.count({ where: { styleId: style.id } })).toBe(0);
      expect((await upload(style.id, PNG, {}, readOnlyToken)).statusCode).toBe(403);
    });

    it('refuses a photo above the size limit', async () => {
      const style = await createStyle();
      const tooBig = Buffer.concat([PNG, Buffer.alloc(10_485_760)]);
      const res = await upload(style.id, tooBig);
      expect(res.statusCode).toBe(400);
      expect(res.json().error.message).toMatch(/larger than 10 MB/);
      expect(await testPrisma.productMedia.count()).toBe(0);
    });

    it('decodes every photo: damaged, cut-short, fake, animated and oversized files are refused before anything is stored', async () => {
      const style = await createStyle();
      const dir = process.env.PRODUCT_MEDIA_STORAGE_DIR!;
      const filesBefore = await filesIn(dir);
      const DAMAGED = /damaged or is not a complete image/;
      const cases: Array<[string, Buffer, RegExp]> = [
        ['only the JPEG start bytes', fakeJpeg(), DAMAGED],
        ['a JPEG whose image data stops half way', await cutShortJpeg(), DAMAGED],
        ['a PNG cut off part-way', await truncatedPng(), DAMAGED],
        ['an animated WebP', await animatedWebp(), /Animated images are not accepted/],
        ['a PNG claiming 8001 × 4 pixels', claimedPng(8001, 4), /longest side can be at most 8000 pixels/],
        ['a PNG claiming 7000 × 6000 pixels', claimedPng(7000, 6000), /at most 40 million pixels/],
      ];
      for (const [label, file, message] of cases) {
        const res = await upload(style.id, file);
        expect(res.statusCode, label).toBe(400);
        expect(res.json().error.message, label).toMatch(message);
      }
      // A replacement goes through the same check.
      const good = (await upload(style.id, JPEG)).json();
      const bad = multipart({}, { buffer: await cutShortJpeg(), filename: 'new.jpg', contentType: 'image/jpeg' });
      const replaced = await app.inject({ method: 'PUT', url: `/api/v1/products/media/${good.id}/file`, headers: { ...auth(), 'content-type': bad.contentType }, payload: bad.payload });
      expect(replaced.statusCode).toBe(400);
      expect((await testPrisma.productMedia.findUniqueOrThrow({ where: { id: good.id } })).url).toBe(good.url);
      expect(await testPrisma.productMedia.count({ where: { styleId: style.id } })).toBe(1);
      expect(await filesIn(dir)).toBe(filesBefore + 1);
    });

    it('accepts real JPEG, PNG and WebP photos and records their pixel size', async () => {
      const style = await createStyle();
      for (const [file, mimeType, width, height] of [
        [await realJpeg(120, 90), 'image/jpeg', 120, 90],
        [await realPng(40, 60), 'image/png', 40, 60],
        [await realWebp(200, 100), 'image/webp', 200, 100],
      ] as const) {
        const res = await upload(style.id, file);
        expect(res.statusCode).toBe(201);
        expect(res.json()).toMatchObject({ mimeType, width, height });
        // The recorded size is the stored (re-encoded) file's, not the upload's (AO-D6).
        const served = await app.inject({ method: 'GET', url: `/api/v1${res.json().url}` });
        expect(res.json().byteSize).toBe(served.rawPayload.length);
      }
    });

    it('AO-D6: a public photo is stored without camera, GPS or XMP metadata, shown the same way up, with its colour profile and colours kept', async () => {
      const style = await createStyle();
      for (const format of ['jpeg', 'png', 'webp'] as const) {
        const input = await photoWithMetadata(format);
        const before = await sharp(input).metadata();
        // The test photo really carries what must be removed.
        expect(before).toMatchObject({ orientation: 6, width: 40, height: 20 });
        expect(exifHasGps(before.exif)).toBe(true);
        expect(before.xmp).toBeDefined();
        expect(input.toString('latin1')).toContain('TestCam');

        const res = await upload(style.id, input);
        expect(res.statusCode, res.body).toBe(201);
        const media = res.json();
        // Recorded as displayed: 20 wide, 40 tall.
        expect(media).toMatchObject({ width: 20, height: 40 });
        const served = (await app.inject({ method: 'GET', url: `/api/v1${media.url}` })).rawPayload;
        expect(media.byteSize).toBe(served.length);
        const after = await sharp(served).metadata();
        expect(after.format).toBe(before.format);
        expect(after.exif).toBeUndefined();
        expect(after.xmp).toBeUndefined();
        expect(after.iptc).toBeUndefined();
        expect(after.orientation).toBeUndefined();
        expect(served.toString('latin1')).not.toContain('TestCam');
        expect(served.toString('latin1')).not.toContain('Secret Photographer');
        // The pixels are turned upright, so it looks the same with or without EXIF support.
        expect({ width: after.width, height: after.height }).toEqual({ width: 20, height: 40 });
        // Colour: the same ICC profile, and the same colours as the original displayed photo.
        expect(after.icc && Buffer.compare(after.icc, before.icc!)).toBe(0);
        const difference = await meanPixelDifference(served, input);
        if (format === 'png') expect(difference).toBe(0);
        else expect(difference).toBeLessThan(3);
        const { data } = await sharp(served).removeAlpha().raw().toBuffer({ resolveWithObject: true });
        const pixel = (x: number, y: number) => Array.from(data.subarray((y * 20 + x) * 3, (y * 20 + x) * 3 + 3));
        expect(pixel(10, 5)[0]).toBeGreaterThan(pixel(10, 5)[2]!); // top half red
        expect(pixel(10, 35)[2]).toBeGreaterThan(pixel(10, 35)[0]!); // bottom half blue
      }
    });

    it('AO-D6: replacing a photo strips the new file\'s metadata too', async () => {
      const style = await createStyle();
      const first = (await upload(style.id, PNG)).json();
      const body = multipart({}, { buffer: await photoWithMetadata('jpeg'), filename: 'new.jpg', contentType: 'image/jpeg' });
      const res = await app.inject({ method: 'PUT', url: `/api/v1/products/media/${first.id}/file`, headers: { ...auth(), 'content-type': body.contentType }, payload: body.payload });
      expect(res.statusCode, res.body).toBe(200);
      const served = (await app.inject({ method: 'GET', url: `/api/v1${res.json().url}` })).rawPayload;
      const after = await sharp(served).metadata();
      expect(after.exif).toBeUndefined();
      expect(after.xmp).toBeUndefined();
      expect(after.icc).toBeDefined();
      expect(res.json()).toMatchObject({ width: 20, height: 40 });
    });

    it('replaces a photo keeping its colour, order and text; the old file stops being served', async () => {
      const style = await createStyle();
      const colour = await addColour(style.id);
      const first = (await upload(style.id, PNG, { colourId: colour.id, altText: 'Front' })).json();
      const body = multipart({}, { buffer: JPEG, filename: 'new.jpg', contentType: 'image/jpeg' });
      const res = await app.inject({ method: 'PUT', url: `/api/v1/products/media/${first.id}/file`, headers: { ...auth(), 'content-type': body.contentType }, payload: body.payload });
      expect(res.statusCode).toBe(200);
      const replaced = res.json();
      expect(replaced).toMatchObject({ id: first.id, colourId: colour.id, altText: 'Front', sortOrder: first.sortOrder, mimeType: 'image/jpeg' });
      expect(replaced.url).toMatch(/\.jpg$/);
      expect((await app.inject({ method: 'GET', url: `/api/v1${replaced.url}` })).statusCode).toBe(200);
      expect((await app.inject({ method: 'GET', url: `/api/v1${first.url}` })).statusCode).toBe(404);
    });

    it('keeps the current photo when the new file cannot be stored', async () => {
      const style = await createStyle();
      const first = (await upload(style.id)).json();
      const failing: ProductMediaStore = {
        kind: 'local',
        put: async () => {
          throw new Error('disk full');
        },
        get: async () => ({ buffer: PNG, mimeType: 'image/png' }),
        probe: async () => undefined,
      };
      const staff = await testPrisma.staffUser.findFirstOrThrow();
      await expect(new ProductMediaService(app, failing).replaceFile(first.id, { buffer: JPEG }, staff.id)).rejects.toThrow(/could not be saved/);
      const after = await testPrisma.productMedia.findUniqueOrThrow({ where: { id: first.id } });
      expect(after.url).toBe(first.url);
      expect((await app.inject({ method: 'GET', url: `/api/v1${first.url}` })).statusCode).toBe(200);
    });

    it('reorders, sets the listing photo and assigns colours; a stale order is refused', async () => {
      const style = await createStyle();
      const colour = await addColour(style.id);
      const a = (await upload(style.id)).json();
      const b = (await upload(style.id)).json();
      const c = (await upload(style.id, PNG, { colourId: colour.id })).json();

      const stale = await app.inject({ method: 'POST', url: `/api/v1/products/styles/${style.id}/media/order`, headers: auth(), payload: { mediaIds: [b.id, a.id] } });
      expect(stale.statusCode).toBe(400);
      const ok = await app.inject({ method: 'POST', url: `/api/v1/products/styles/${style.id}/media/order`, headers: auth(), payload: { mediaIds: [c.id, b.id, a.id] } });
      expect(ok.json().map((m: { id: string }) => m.id)).toEqual([c.id, b.id, a.id]);

      // Without a chosen cover, listings show all-colour photos first (unchanged behaviour): b.
      let r = (await app.inject({ method: 'GET', url: `/api/v1/products/styles/${style.id}/readiness`, headers: auth() })).json();
      expect(r.coverMediaId).toBe(b.id);
      await app.inject({ method: 'POST', url: `/api/v1/products/media/${c.id}/cover`, headers: auth() });
      await app.inject({ method: 'POST', url: `/api/v1/products/media/${a.id}/cover`, headers: auth() });
      r = (await app.inject({ method: 'GET', url: `/api/v1/products/styles/${style.id}/readiness`, headers: auth() })).json();
      expect(r.coverMediaId).toBe(a.id);
      expect(await testPrisma.productMedia.count({ where: { styleId: style.id, isCover: true } })).toBe(1);

      const reassign = await app.inject({ method: 'PATCH', url: `/api/v1/products/media/${a.id}`, headers: auth(), payload: { colourId: colour.id, altText: 'Back' } });
      expect(reassign.json()).toMatchObject({ colourId: colour.id, altText: 'Back' });
    });

    it('two concurrent "make cover" requests leave exactly one cover', async () => {
      const style = await createStyle();
      const a = (await upload(style.id)).json();
      const b = (await upload(style.id)).json();
      const results = await Promise.all([
        app.inject({ method: 'POST', url: `/api/v1/products/media/${a.id}/cover`, headers: auth() }),
        app.inject({ method: 'POST', url: `/api/v1/products/media/${b.id}/cover`, headers: auth() }),
      ]);
      expect(results.map((r) => r.statusCode)).toEqual([200, 200]);
      expect(await testPrisma.productMedia.count({ where: { styleId: style.id, isCover: true } })).toBe(1);
    });

    it('a chosen cover becomes the storefront listing thumbnail', async () => {
      const style = await createStyle();
      const colour = await addColour(style.id);
      await app.inject({ method: 'POST', url: `/api/v1/products/styles/${style.id}/skus/generate`, headers: auth(), payload: { sizeIds: [fixtures.size.id] } });
      const allColours = (await upload(style.id)).json();
      const coloured = (await upload(style.id, PNG, { colourId: colour.id })).json();
      await app.inject({ method: 'POST', url: '/api/v1/catalog/prices', headers: auth(), payload: { styleId: style.id, mrp: 999, sellingPrice: 799 } });
      await app.inject({ method: 'POST', url: `/api/v1/products/styles/${style.id}/ready-for-enrichment`, headers: auth() });
      await app.inject({ method: 'POST', url: `/api/v1/products/styles/${style.id}/qa-check`, headers: auth() });
      await app.inject({ method: 'POST', url: `/api/v1/products/styles/${style.id}/publish`, headers: auth() });

      const thumb = async () =>
        ((await app.inject({ method: 'GET', url: '/api/v1/storefront/styles' })).json() as { items?: Array<{ id: string; thumbnailUrl: string }> } | Array<{ id: string; thumbnailUrl: string }>);
      const find = (data: Awaited<ReturnType<typeof thumb>>) => (Array.isArray(data) ? data : data.items ?? []).find((s) => s.id === style.id)?.thumbnailUrl;
      expect(find(await thumb())).toBe(allColours.url);
      await app.inject({ method: 'POST', url: `/api/v1/products/media/${coloured.id}/cover`, headers: auth() });
      expect(find(await thumb())).toBe(coloured.url);
    });

    it('a published product keeps at least one photo; a removed photo stops being served', async () => {
      const style = await createStyle();
      const colour = await addColour(style.id);
      await app.inject({ method: 'POST', url: `/api/v1/products/styles/${style.id}/skus/generate`, headers: auth(), payload: { sizeIds: [fixtures.size.id] } });
      const a = (await upload(style.id, PNG, { colourId: colour.id })).json();
      await app.inject({ method: 'POST', url: `/api/v1/products/styles/${style.id}/ready-for-enrichment`, headers: auth() });
      await app.inject({ method: 'POST', url: `/api/v1/products/styles/${style.id}/qa-check`, headers: auth() });
      await app.inject({ method: 'POST', url: `/api/v1/products/styles/${style.id}/publish`, headers: auth() });

      const last = await app.inject({ method: 'DELETE', url: `/api/v1/products/media/${a.id}`, headers: auth() });
      expect(last.statusCode).toBe(409);
      const b = (await upload(style.id)).json();
      expect((await app.inject({ method: 'DELETE', url: `/api/v1/products/media/${a.id}`, headers: auth() })).statusCode).toBe(204);
      expect((await app.inject({ method: 'GET', url: `/api/v1${a.url}` })).statusCode).toBe(404);
      expect((await app.inject({ method: 'GET', url: `/api/v1${b.url}` })).statusCode).toBe(200);
    });

    it('the public photo route serves product photos only: never evidence keys, unknown keys or path tricks', async () => {
      for (const key of ['11111111-1111-4111-8111-111111111111.png', '11111111-1111-4111-8111-111111111111', '..%2F..%2Fpackage.json', 'x.png']) {
        expect((await app.inject({ method: 'GET', url: `/api/v1/media/products/${key}` })).statusCode).toBe(404);
      }
    });
  });

  describe('AO-D1 republish and AO-D2 product-page attributes', () => {
    async function publishedStyle(customAttributes?: Record<string, unknown>, fabric?: string) {
      const style = await createStyle();
      if (customAttributes || fabric) await testPrisma.style.update({ where: { id: style.id }, data: { ...(customAttributes ? { customAttributes } : {}), ...(fabric ? { fabric } : {}) } });
      const colour = await addColour(style.id);
      await app.inject({ method: 'POST', url: `/api/v1/products/styles/${style.id}/skus/generate`, headers: auth(), payload: { sizeIds: [fixtures.size.id] } });
      expect((await upload(style.id, PNG, { colourId: colour.id, altText: 'Front' })).statusCode).toBe(201);
      await app.inject({ method: 'POST', url: '/api/v1/catalog/prices', headers: auth(), payload: { styleId: style.id, mrp: 1999, sellingPrice: 1499 } });
      await app.inject({ method: 'POST', url: `/api/v1/products/styles/${style.id}/ready-for-enrichment`, headers: auth() });
      expect((await app.inject({ method: 'POST', url: `/api/v1/products/styles/${style.id}/qa-check`, headers: auth() })).json().passed).toBe(true);
      expect((await app.inject({ method: 'POST', url: `/api/v1/products/styles/${style.id}/publish`, headers: auth() })).statusCode).toBe(200);
      return style;
    }
    const post = (id: string, step: string) => app.inject({ method: 'POST', url: `/api/v1/products/styles/${id}/${step}`, headers: auth() });

    it('an unpublished product goes live again only through the QA check; archived stays final', async () => {
      const style = await publishedStyle();
      expect((await post(style.id, 'unpublish')).statusCode).toBe(200);
      expect(await testPrisma.style.findUniqueOrThrow({ where: { id: style.id } })).toMatchObject({ lifecycleState: 'UNPUBLISHED', qaPassedAt: null });
      // The old QA pass is gone: publishing straight away is refused.
      expect((await post(style.id, 'publish')).statusCode).toBe(400);

      // A failing check keeps it unpublished.
      await testPrisma.productMedia.deleteMany({ where: { styleId: style.id } });
      const failed = (await post(style.id, 'qa-check')).json();
      expect(failed.passed).toBe(false);
      expect((await testPrisma.style.findUniqueOrThrow({ where: { id: style.id } })).lifecycleState).toBe('UNPUBLISHED');

      expect((await upload(style.id, PNG, { altText: 'Front' })).statusCode).toBe(201);
      expect((await post(style.id, 'qa-check')).json().passed).toBe(true);
      expect((await testPrisma.style.findUniqueOrThrow({ where: { id: style.id } })).lifecycleState).toBe('READY_FOR_QA');
      expect((await post(style.id, 'publish')).statusCode).toBe(200);
      expect((await testPrisma.style.findUniqueOrThrow({ where: { id: style.id } })).lifecycleState).toBe('PUBLISHED');
      expect((await app.inject({ method: 'GET', url: `/api/v1/storefront/products/${style.id}` })).statusCode).toBe(200);

      expect((await post(style.id, 'archive')).statusCode).toBe(200);
      expect((await post(style.id, 'qa-check')).statusCode).toBe(400);
      expect((await post(style.id, 'publish')).statusCode).toBe(400);
    });

    it('shows shoe, belt and perfume attributes in the product details, and nothing extra for clothing', async () => {
      const shoe = await publishedStyle({ productType: 'footwear', closureType: 'Lace-up', internalNote: 'never shown' }, 'Genuine leather upper');
      const belt = await publishedStyle({ productType: 'belt', material: 'Genuine Leather', buckleType: 'Pin Buckle' });
      const perfume = await publishedStyle({ productType: 'fragrance', fragranceName: 'Citrus Woods', concentration: 'Eau de Toilette', topNotes: 'Bergamot, Lemon', heartNotes: ' ', baseNotes: 'Musk' });
      const shirt = await publishedStyle(undefined, '100% cotton');
      const pdp = async (id: string) => (await app.inject({ method: 'GET', url: `/api/v1/storefront/products/${id}` })).json();

      expect(await pdp(shoe.id)).toMatchObject({ productType: 'FOOTWEAR', attributes: [{ label: 'Material', value: 'Genuine leather upper' }, { label: 'Closure', value: 'Lace-up' }] });
      expect((await pdp(belt.id)).attributes).toEqual([{ label: 'Material', value: 'Genuine Leather' }, { label: 'Buckle', value: 'Pin Buckle' }]);
      expect((await pdp(perfume.id)).attributes).toEqual([
        { label: 'Fragrance', value: 'Citrus Woods' },
        { label: 'Concentration', value: 'Eau de Toilette' },
        { label: 'Top notes', value: 'Bergamot, Lemon' },
        { label: 'Base notes', value: 'Musk' },
      ]);
      const shirtPdp = await pdp(shirt.id);
      expect(shirtPdp).toMatchObject({ productType: 'APPAREL', attributes: [], fabric: '100% cotton' });
      expect(JSON.stringify(await pdp(shoe.id))).not.toContain('never shown');
    });
  });
});
