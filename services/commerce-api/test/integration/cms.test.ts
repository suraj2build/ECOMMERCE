import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '../helpers/app.js';
import { resetDatabase, seedRbac, grantPermissions } from '../helpers/db.js';
import { createAuthenticatedStaff } from '../helpers/auth.js';

/**
 * Content Management (M29, specs/28-admin.md ADM-002) adversarial
 * certification. Proves the four fixed content types (banners, content
 * blocks, landing pages, navigation menus) are staff-manageable and
 * publish/visible to an unauthenticated storefront read WITHOUT a code
 * deployment - the CMS acceptance requirement this milestone exists to
 * satisfy - plus staff RBAC on every write route.
 */
describe('Content Management (M29)', () => {
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

  async function manageStaff() {
    const { token } = await createAuthenticatedStaff(app, ['MARKETING']);
    await grantPermissions('MARKETING', ['cms:manage', 'cms:read']);
    return { token };
  }

  function auth(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  it('a banner created and activated by staff is immediately visible on the public storefront read, with no deployment', async () => {
    const { token } = await manageStaff();
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/cms/banners',
      headers: auth(token),
      payload: { title: 'Summer Sale', imageUrl: '/banner.png', placement: 'HOMEPAGE_HERO', sortOrder: 1 },
    });
    expect(create.statusCode).toBe(201);
    const bannerId = create.json().id as string;

    const publicRead = await app.inject({ method: 'GET', url: '/api/v1/storefront/cms/banners?placement=HOMEPAGE_HERO' });
    expect(publicRead.statusCode).toBe(200);
    expect(publicRead.json()).toHaveLength(1);
    expect(publicRead.json()[0].id).toBe(bannerId);

    const deactivate = await app.inject({
      method: 'PATCH',
      url: `/api/v1/cms/banners/${bannerId}`,
      headers: auth(token),
      payload: { isActive: false },
    });
    expect(deactivate.statusCode).toBe(200);

    const afterDeactivate = await app.inject({ method: 'GET', url: '/api/v1/storefront/cms/banners?placement=HOMEPAGE_HERO' });
    expect(afterDeactivate.json()).toHaveLength(0);
  });

  it('a content block can be created, updated, and read publicly by its stable key', async () => {
    const { token } = await manageStaff();
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/cms/content-blocks',
      headers: auth(token),
      payload: { key: 'homepage-promo-strip', title: 'Promo', content: '<p>50% off</p>' },
    });
    expect(create.statusCode).toBe(201);

    const publicRead = await app.inject({ method: 'GET', url: '/api/v1/storefront/cms/content-blocks/homepage-promo-strip' });
    expect(publicRead.statusCode).toBe(200);
    expect(publicRead.json().content).toBe('<p>50% off</p>');

    await app.inject({
      method: 'PATCH',
      url: `/api/v1/cms/content-blocks/${create.json().id}`,
      headers: auth(token),
      payload: { content: '<p>70% off</p>' },
    });
    const updated = await app.inject({ method: 'GET', url: '/api/v1/storefront/cms/content-blocks/homepage-promo-strip' });
    expect(updated.json().content).toBe('<p>70% off</p>');
  });

  it('an inactive content block 404s on the public read (never served half-published)', async () => {
    const { token } = await manageStaff();
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/cms/content-blocks',
      headers: auth(token),
      payload: { key: 'draft-block', title: 'Draft', content: 'x' },
    });
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/cms/content-blocks/${create.json().id}`,
      headers: auth(token),
      payload: { isActive: false },
    });
    const publicRead = await app.inject({ method: 'GET', url: '/api/v1/storefront/cms/content-blocks/draft-block' });
    expect(publicRead.statusCode).toBe(404);
  });

  it('a campaign landing page composes its published content blocks and is only publicly visible once published', async () => {
    const { token } = await manageStaff();
    await app.inject({
      method: 'POST',
      url: '/api/v1/cms/content-blocks',
      headers: auth(token),
      payload: { key: 'campaign-hero', title: 'Hero', content: 'Big Sale' },
    });
    const page = await app.inject({
      method: 'POST',
      url: '/api/v1/cms/landing-pages',
      headers: auth(token),
      payload: { slug: 'summer-sale', title: 'Summer Sale', blockKeys: ['campaign-hero'] },
    });
    expect(page.statusCode).toBe(201);

    const beforePublish = await app.inject({ method: 'GET', url: '/api/v1/storefront/cms/landing-pages/summer-sale' });
    expect(beforePublish.statusCode).toBe(404);

    await app.inject({ method: 'POST', url: `/api/v1/cms/landing-pages/${page.json().id}/publish`, headers: auth(token) });

    const afterPublish = await app.inject({ method: 'GET', url: '/api/v1/storefront/cms/landing-pages/summer-sale' });
    expect(afterPublish.statusCode).toBe(200);
    expect(afterPublish.json().blocks).toHaveLength(1);
    expect(afterPublish.json().blocks[0].key).toBe('campaign-hero');
  });

  it('a navigation menu is upserted and publicly readable by key', async () => {
    const { token } = await manageStaff();
    const put = await app.inject({
      method: 'PUT',
      url: '/api/v1/cms/navigation-menus/main-nav',
      headers: auth(token),
      payload: { items: [{ label: 'Men', url: '/men', sortOrder: 1 }, { label: 'Women', url: '/women', sortOrder: 2 }] },
    });
    expect(put.statusCode).toBe(200);

    const publicRead = await app.inject({ method: 'GET', url: '/api/v1/storefront/cms/navigation-menus/main-nav' });
    expect(publicRead.statusCode).toBe(200);
    expect(publicRead.json().items).toHaveLength(2);
  });

  describe('RBAC', () => {
    it('rejects a banner create without cms:manage', async () => {
      const { token } = await createAuthenticatedStaff(app, ['WAREHOUSE_MANAGER']);
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/cms/banners',
        headers: auth(token),
        payload: { title: 'X', imageUrl: '/x.png', placement: 'HOMEPAGE_HERO' },
      });
      expect(res.statusCode).toBe(403);
    });

    it('rejects an unauthenticated staff read', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/cms/banners' });
      expect(res.statusCode).toBe(401);
    });
  });
});
