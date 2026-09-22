import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '../helpers/app.js';
import { resetDatabase, seedRbac, grantPermissions, seedBrandAndLocation, testPrisma } from '../helpers/db.js';
import { createAuthenticatedStaff } from '../helpers/auth.js';
import { ProductService } from '../../src/modules/product/service.js';

/**
 * Certification-pass Product Master invariants: the STYLE -> COLOUR ->
 * SIZE -> SKU hierarchy under adversarial input, duplicate business
 * identifiers, cross-style contamination, and lifecycle transition
 * guards (including from ARCHIVED).
 */
describe('Product Master invariants certification', () => {
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

  it('rejects a duplicate style code with a clean 409, not an opaque 500', async () => {
    await grantPermissions('MERCHANDISING', ['product:write']);
    const { token } = await createAuthenticatedStaff(app, ['MERCHANDISING']);
    const { brand, category } = await seedBrandAndLocation();
    const payload = { styleCode: 'DUP-001', name: 'First', brandId: brand.id, categoryId: category.id, season: 'SS26', collection: 'Core' };

    const first = await app.inject({ method: 'POST', url: '/api/v1/products/styles', headers: { authorization: `Bearer ${token}` }, payload });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/products/styles',
      headers: { authorization: `Bearer ${token}` },
      payload: { ...payload, name: 'Second' },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('CONFLICT');
  });

  it('rejects a duplicate SKU code across different style/colour/size combinations', async () => {
    const service = new ProductService(app);
    const { brand, category, size } = await seedBrandAndLocation();
    const staffId = (await testPrisma.staffUser.create({ data: { email: 'pi-1@example.com', passwordHash: 'x', fullName: 'PI' } })).id;

    const style1 = await service.createStyle({ styleCode: 'DUP-002', name: 'A', brandId: brand.id, categoryId: category.id, season: 'SS26', collection: 'Core' }, staffId);
    const colour1 = await service.addColour(style1.id, { name: 'Black', colourCode: 'BLK' }, staffId);
    await service.createSku({ styleId: style1.id, colourId: colour1.id, sizeId: size.id, skuCode: 'SHARED-CODE' }, staffId);

    const style2 = await service.createStyle({ styleCode: 'DUP-003', name: 'B', brandId: brand.id, categoryId: category.id, season: 'SS26', collection: 'Core' }, staffId);
    const colour2 = await service.addColour(style2.id, { name: 'White', colourCode: 'WHT' }, staffId);

    await expect(
      service.createSku({ styleId: style2.id, colourId: colour2.id, sizeId: size.id, skuCode: 'SHARED-CODE' }, staffId),
    ).rejects.toThrow(/already exists/i);
  });

  it('rejects a duplicate barcode across different SKUs', async () => {
    const service = new ProductService(app);
    const { brand, category, size } = await seedBrandAndLocation();
    const staffId = (await testPrisma.staffUser.create({ data: { email: 'pi-2@example.com', passwordHash: 'x', fullName: 'PI 2' } })).id;

    const style1 = await service.createStyle({ styleCode: 'DUP-004', name: 'A', brandId: brand.id, categoryId: category.id, season: 'SS26', collection: 'Core' }, staffId);
    const colour1 = await service.addColour(style1.id, { name: 'Black', colourCode: 'BLK' }, staffId);
    await service.createSku({ styleId: style1.id, colourId: colour1.id, sizeId: size.id, skuCode: 'DUP-004-BLK-M', barcode: 'SHARED-BARCODE' }, staffId);

    const style2 = await service.createStyle({ styleCode: 'DUP-005', name: 'B', brandId: brand.id, categoryId: category.id, season: 'SS26', collection: 'Core' }, staffId);
    const colour2 = await service.addColour(style2.id, { name: 'White', colourCode: 'WHT' }, staffId);

    await expect(
      service.createSku({ styleId: style2.id, colourId: colour2.id, sizeId: size.id, skuCode: 'DUP-005-WHT-M', barcode: 'SHARED-BARCODE' }, staffId),
    ).rejects.toThrow(/already exists/i);
  });

  it('rejects a duplicate style/colour/size combination (same colour, twice)', async () => {
    const service = new ProductService(app);
    const { brand, category, size } = await seedBrandAndLocation();
    const staffId = (await testPrisma.staffUser.create({ data: { email: 'pi-3@example.com', passwordHash: 'x', fullName: 'PI 3' } })).id;

    const style = await service.createStyle({ styleCode: 'DUP-006', name: 'A', brandId: brand.id, categoryId: category.id, season: 'SS26', collection: 'Core' }, staffId);
    const colour = await service.addColour(style.id, { name: 'Black', colourCode: 'BLK' }, staffId);
    await service.createSku({ styleId: style.id, colourId: colour.id, sizeId: size.id, skuCode: 'DUP-006-BLK-M-1' }, staffId);

    await expect(
      service.createSku({ styleId: style.id, colourId: colour.id, sizeId: size.id, skuCode: 'DUP-006-BLK-M-2' }, staffId),
    ).rejects.toThrow(/already exists for this style\/colour\/size/i);
  });

  it('rejects creating a SKU whose colour belongs to a different style (cross-style contamination)', async () => {
    const service = new ProductService(app);
    const { brand, category, size } = await seedBrandAndLocation();
    const staffId = (await testPrisma.staffUser.create({ data: { email: 'pi-4@example.com', passwordHash: 'x', fullName: 'PI 4' } })).id;

    const styleA = await service.createStyle({ styleCode: 'CONTAM-A', name: 'A', brandId: brand.id, categoryId: category.id, season: 'SS26', collection: 'Core' }, staffId);
    const colourOfA = await service.addColour(styleA.id, { name: 'Black', colourCode: 'BLK' }, staffId);
    const styleB = await service.createStyle({ styleCode: 'CONTAM-B', name: 'B', brandId: brand.id, categoryId: category.id, season: 'SS26', collection: 'Core' }, staffId);

    await expect(
      service.createSku({ styleId: styleB.id, colourId: colourOfA.id, sizeId: size.id, skuCode: 'CONTAM-B-BLK-M' }, staffId),
    ).rejects.toThrow(/does not belong to style/i);
  });

  it('rejects attaching media with a colourId that belongs to a different style', async () => {
    await grantPermissions('MERCHANDISING', ['product:write']);
    const { token } = await createAuthenticatedStaff(app, ['MERCHANDISING']);
    const { brand, category } = await seedBrandAndLocation();

    const styleARes = await app.inject({
      method: 'POST', url: '/api/v1/products/styles', headers: { authorization: `Bearer ${token}` },
      payload: { styleCode: 'CONTAM-C', name: 'C', brandId: brand.id, categoryId: category.id, season: 'SS26', collection: 'Core' },
    });
    const colourARes = await app.inject({
      method: 'POST', url: `/api/v1/products/styles/${styleARes.json().id}/colours`, headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Black', colourCode: 'BLK' },
    });
    const styleBRes = await app.inject({
      method: 'POST', url: '/api/v1/products/styles', headers: { authorization: `Bearer ${token}` },
      payload: { styleCode: 'CONTAM-D', name: 'D', brandId: brand.id, categoryId: category.id, season: 'SS26', collection: 'Core' },
    });

    const mediaRes = await app.inject({
      method: 'POST',
      url: `/api/v1/products/styles/${styleBRes.json().id}/media`,
      headers: { authorization: `Bearer ${token}` },
      payload: { colourId: colourARes.json().id, url: 'https://example.com/x.jpg' },
    });
    expect(mediaRes.statusCode).toBe(400);
    expect(mediaRes.json().error.message).toMatch(/does not belong to style/i);
  });

  it('rejects duplicate size labels within one size chart', async () => {
    const service = new ProductService(app);
    await expect(
      service.createSizeChart({
        name: 'Bad Chart',
        entries: [
          { sizeLabel: 'M', measurements: { chest: 40 } },
          { sizeLabel: 'M', measurements: { chest: 41 } },
        ],
      }),
    ).rejects.toThrow(/duplicate size labels/i);
  });

  describe('lifecycle transition guards (including from ARCHIVED)', () => {
    async function buildQaPassedStyle(service: ProductService, staffId: string) {
      const { brand, category, size } = await seedBrandAndLocation();
      const style = await service.createStyle({ styleCode: `LC-${Date.now()}`, name: 'Lifecycle Style', brandId: brand.id, categoryId: category.id, season: 'SS26', collection: 'Core' }, staffId);
      const colour = await service.addColour(style.id, { name: 'Black', colourCode: 'BLK' }, staffId);
      await service.createSku({ styleId: style.id, colourId: colour.id, sizeId: size.id, skuCode: `${style.styleCode}-BLK-M` }, staffId);
      await service.addMedia({ styleId: style.id, colourId: colour.id, url: 'https://example.com/x.jpg' }, staffId);
      await service.moveToReadyForEnrichment(style.id, staffId);
      await service.runQaCheck(style.id, staffId);
      return style.id;
    }

    it('rejects publishing an ARCHIVED style', async () => {
      const service = new ProductService(app);
      const staffId = (await testPrisma.staffUser.create({ data: { email: 'pi-5@example.com', passwordHash: 'x', fullName: 'PI 5' } })).id;
      const styleId = await buildQaPassedStyle(service, staffId);
      await service.archive(styleId, staffId);

      await expect(service.publish(styleId, staffId)).rejects.toThrow(/cannot publish from state 'archived'/i);
    });

    it('rejects unpublishing a style that was never published (still ARCHIVED)', async () => {
      const service = new ProductService(app);
      const staffId = (await testPrisma.staffUser.create({ data: { email: 'pi-6@example.com', passwordHash: 'x', fullName: 'PI 6' } })).id;
      const styleId = await buildQaPassedStyle(service, staffId);
      await service.archive(styleId, staffId);

      await expect(service.unpublish(styleId, staffId)).rejects.toThrow(/cannot transition from 'archived'/i);
    });

    it('rejects moving an ARCHIVED style back to ready-for-enrichment', async () => {
      const service = new ProductService(app);
      const staffId = (await testPrisma.staffUser.create({ data: { email: 'pi-7@example.com', passwordHash: 'x', fullName: 'PI 7' } })).id;
      const styleId = await buildQaPassedStyle(service, staffId);
      await service.archive(styleId, staffId);

      await expect(service.moveToReadyForEnrichment(styleId, staffId)).rejects.toThrow(/cannot transition from 'archived'/i);
    });

    it('rejects running the QA check on an ARCHIVED style', async () => {
      const service = new ProductService(app);
      const staffId = (await testPrisma.staffUser.create({ data: { email: 'pi-8@example.com', passwordHash: 'x', fullName: 'PI 8' } })).id;
      const styleId = await buildQaPassedStyle(service, staffId);
      await service.archive(styleId, staffId);

      await expect(service.runQaCheck(styleId, staffId)).rejects.toThrow(/must be in READY_FOR_ENRICHMENT or READY_FOR_QA/i);
    });

    it('publishing a style that legitimately passed QA still succeeds (positive control)', async () => {
      const service = new ProductService(app);
      const staffId = (await testPrisma.staffUser.create({ data: { email: 'pi-9@example.com', passwordHash: 'x', fullName: 'PI 9' } })).id;
      const styleId = await buildQaPassedStyle(service, staffId);

      const published = await service.publish(styleId, staffId);
      expect(published.lifecycleState).toBe('PUBLISHED');
    });
  });
});
