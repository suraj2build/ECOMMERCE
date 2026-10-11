import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '../helpers/app.js';
import { resetDatabase, seedRbac, grantPermissions, testPrisma } from '../helpers/db.js';
import { createAuthenticatedStaff } from '../helpers/auth.js';

describe('Admin-authored lookbook persistence and publication', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(async () => {
    await resetDatabase();
    await seedRbac();
  });
  async function setup() {
    const staff = await createAuthenticatedStaff(app, ['MARKETING']);
    await grantPermissions('MARKETING', ['cms:manage', 'cms:read']);
    const brand = await testPrisma.brand.create({ data: { code: 'TEST', name: 'Test' } });
    const category = await testPrisma.category.create({ data: { name: 'Tops', slug: 'tops' } });
    const style = await testPrisma.style.create({
      data: {
        styleCode: 'EXACT-TOP',
        name: 'Pink top',
        brandId: brand.id,
        categoryId: category.id,
        gender: 'women',
        department: 'women',
        season: 'TEST',
        collection: 'TEST',
        lifecycleState: 'PUBLISHED',
      },
    });
    const colour = await testPrisma.colour.create({
      data: { styleId: style.id, colourCode: 'PINK', name: 'Pink' },
    });
    const size = await testPrisma.size.create({ data: { label: 'S' } });
    await testPrisma.sku.create({
      data: { skuCode: 'EXACT-PINK-S', styleId: style.id, colourId: colour.id, sizeId: size.id },
    });
    const document = {
      slug: 'pink-morning',
      department: 'women',
      title: 'Pink morning',
      intro: 'One morning',
      occasion: 'Everyday',
      model: 'Riya',
      cover: '/cover.webp',
      looks: [
        {
          title: 'Chai',
          caption: 'Morning',
          image: '/image.webp',
          alt: 'Riya in a pink top',
          items: [{ styleId: style.id, colourId: colour.id }],
        },
      ],
    };
    const save = (revision: number, action = 'save', doc = document) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/cms/lookbooks',
        headers: { authorization: 'Bearer ' + staff.token },
        payload: { document: doc, expectedRevision: revision, action },
      });
    return { staff, document, save };
  }
  it('persisted draft edits never leak through public lookbooks or generic CMS reads', async () => {
    const { document, save } = await setup();
    expect((await save(0, 'publish')).statusCode).toBe(200);
    expect((await save(1, 'save', { ...document, intro: 'Secret draft' })).statusCode).toBe(200);
    const publicRead = await app.inject('/api/v1/storefront/lookbooks?department=women');
    expect(publicRead.json().stories[0].intro).toBe('One morning');
    expect(publicRead.body).not.toContain('Secret draft');
    expect(
      (
        await app.inject(
          '/api/v1/storefront/cms/content-blocks/lookbook-document-women-pink-morning',
        )
      ).statusCode,
    ).toBe(400);
    const row = await testPrisma.cmsContentBlock.findUniqueOrThrow({
      where: { key: 'lookbook-document-women-pink-morning' },
    });
    const page = await testPrisma.cmsLandingPage.create({
      data: {
        slug: 'no-draft-leak',
        title: 'Test',
        blockKeys: [row.key],
        isPublished: true,
        createdByStaffId: row.createdByStaffId,
      },
    });
    expect(
      (await app.inject('/api/v1/storefront/cms/landing-pages/' + page.slug)).json().blocks,
    ).toEqual([]);
  });
  it('serializes same-revision publication so exactly one editor wins and one audit row is written', async () => {
    const { document, save } = await setup();
    const result = await Promise.all([
      save(0, 'publish'),
      save(0, 'publish', { ...document, title: 'Other editor' }),
    ]);
    expect(result.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(await testPrisma.auditLog.count({ where: { action: 'cms.lookbook.publish' } })).toBe(1);
    expect(
      await testPrisma.cmsContentBlock.count({
        where: { key: 'lookbook-document-women-pink-morning' },
      }),
    ).toBe(1);
  });
  it('rejects unmapped publication and protects lookbook documents from generic CMS edits', async () => {
    const { document, save, staff } = await setup();
    const doc = { ...document, looks: [{ ...document.looks[0]!, items: [] }] };
    expect((await save(0, 'publish', doc)).statusCode).toBe(400);
    expect((await save(0)).statusCode).toBe(200);
    const row = await testPrisma.cmsContentBlock.findUniqueOrThrow({
      where: { key: 'lookbook-document-women-pink-morning' },
    });
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: '/api/v1/cms/content-blocks/' + row.id,
          headers: { authorization: 'Bearer ' + staff.token },
          payload: { isActive: true },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await app.inject('/api/v1/storefront/lookbooks?department=women')).json().stories,
    ).toEqual([]);
  });
});
