import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '../helpers/app.js';
import { resetDatabase, seedRbac, grantPermissions, seedBrandAndLocation, testPrisma } from '../helpers/db.js';
import { createAuthenticatedStaff } from '../helpers/auth.js';
import { ChannelService } from '../../src/modules/channels/service.js';

/**
 * Admin Ops Phase 1: storefront configuration (menus, banners, pages,
 * content images), channel scope/pause and the Setup & health view.
 */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

function multipart(fields: Record<string, string>, file: Buffer) {
  const boundary = `----cfg${Math.random().toString(36).slice(2)}`;
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n`), file, Buffer.from(`\r\n--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

describe('Admin Ops Phase 1: storefront configuration, channels and setup', () => {
  let app: FastifyInstance;
  let cms: string;
  let owner: string;
  let ownerId: string;
  let viewer: string;
  const auth = (t: string) => ({ authorization: `Bearer ${t}` });

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase();
    await seedRbac();
    await grantPermissions('MARKETING', ['cms:manage', 'cms:read', 'channel:manage', 'channel:read']);
    await grantPermissions('SUPER_ADMIN', ['org:manage', 'channel:read']);
    await grantPermissions('ANALYTICS', ['cms:read', 'channel:read']);
    cms = (await createAuthenticatedStaff(app, ['MARKETING'])).token;
    const o = await createAuthenticatedStaff(app, ['SUPER_ADMIN']);
    owner = o.token;
    ownerId = o.staffUserId;
    viewer = (await createAuthenticatedStaff(app, ['ANALYTICS'])).token;
  });

  describe('navigation menus', () => {
    it('saves site paths and https links, and names the item whose link the storefront would drop', async () => {
      const ok = await app.inject({
        method: 'PUT',
        url: '/api/v1/cms/navigation-menus/footer-about',
        headers: auth(cms),
        payload: { items: [{ label: 'Our Story', url: '/pages/our-story', sortOrder: 1 }, { label: 'Journal', url: 'https://journal.example.com', sortOrder: 2 }] },
      });
      expect(ok.statusCode).toBe(200);
      for (const url of ['javascript:alert(1)', 'http://insecure.example.com', '//evil.example', 'data:text/html,x', '/has space']) {
        const res = await app.inject({ method: 'PUT', url: '/api/v1/cms/navigation-menus/footer-about', headers: auth(cms), payload: { items: [{ label: 'Bad link', url }] } });
        expect(res.statusCode, url).toBe(400);
        expect(res.json().error.message).toMatch(/"Bad link"/);
      }
      const longLabel = await app.inject({ method: 'PUT', url: '/api/v1/cms/navigation-menus/footer-about', headers: auth(cms), payload: { items: [{ label: 'x'.repeat(61), url: '/a' }] } });
      expect(longLabel.statusCode).toBe(400);
      // The refused saves left the menu as it was.
      const stored = (await app.inject({ method: 'GET', url: '/api/v1/storefront/cms/navigation-menus/footer-about' })).json();
      expect(stored.items.map((i: { label: string }) => i.label)).toEqual(['Our Story', 'Journal']);
      const denied = await app.inject({ method: 'PUT', url: '/api/v1/cms/navigation-menus/footer-about', headers: auth(viewer), payload: { items: [] } });
      expect(denied.statusCode).toBe(403);
    });

    it('lists which menus and banner placements the storefront actually reads', async () => {
      const res = (await app.inject({ method: 'GET', url: '/api/v1/cms/placements', headers: auth(viewer) })).json();
      expect(res.menus.map((m: { key: string }) => m.key)).toEqual(['footer-about', 'footer-social']);
      expect(res.unreadMenus['main-nav']).toMatch(/not change the header/);
      expect(res.banners).toHaveLength(12);
      expect(res.banners.map((b: { key: string }) => b.key)).toEqual(expect.arrayContaining(['home-hero-men', 'gateway-women', 'home-category-women']));
    });
  });

  describe('banners and pages', () => {
    it('saves a banner as a draft that the storefront does not show until it is switched on', async () => {
      const draft = await app.inject({ method: 'POST', url: '/api/v1/cms/banners', headers: auth(cms), payload: { title: 'Monsoon', imageUrl: '/media/content/x.png', placement: 'home-hero-women', isActive: false } });
      expect(draft.statusCode).toBe(201);
      expect(draft.json()).toMatchObject({ isActive: false, publishedAt: null });
      const publicBefore = (await app.inject({ method: 'GET', url: '/api/v1/storefront/cms/banners?placement=home-hero-women' })).json();
      expect(publicBefore).toHaveLength(0);
      await app.inject({ method: 'PATCH', url: `/api/v1/cms/banners/${draft.json().id}`, headers: auth(cms), payload: { isActive: true } });
      const publicAfter = (await app.inject({ method: 'GET', url: '/api/v1/storefront/cms/banners?placement=home-hero-women' })).json();
      expect(publicAfter).toHaveLength(1);
      // A banner link the storefront would render must be safe.
      const bad = await app.inject({ method: 'POST', url: '/api/v1/cms/banners', headers: auth(cms), payload: { title: 'X', imageUrl: '/x.png', placement: 'home-category-men', linkUrl: 'javascript:alert(1)' } });
      expect(bad.statusCode).toBe(400);
      const badUpdate = await app.inject({ method: 'PATCH', url: `/api/v1/cms/banners/${draft.json().id}`, headers: auth(cms), payload: { linkUrl: 'http://x.example' } });
      expect(badUpdate.statusCode).toBe(400);
    });

    it('edits a page; a published page shows the change publicly', async () => {
      const page = (await app.inject({ method: 'POST', url: '/api/v1/cms/landing-pages', headers: auth(cms), payload: { slug: 'our-story', title: 'Our Story' } })).json();
      await app.inject({ method: 'POST', url: `/api/v1/cms/landing-pages/${page.id}/publish`, headers: auth(cms) });
      const edit = await app.inject({ method: 'PATCH', url: `/api/v1/cms/landing-pages/${page.id}`, headers: auth(cms), payload: { title: 'Our Story So Far', metaDescription: null } });
      expect(edit.statusCode).toBe(200);
      const pub = (await app.inject({ method: 'GET', url: '/api/v1/storefront/cms/landing-pages/our-story' })).json();
      expect(pub.title).toBe('Our Story So Far');
      const slugChange = await app.inject({ method: 'PATCH', url: `/api/v1/cms/landing-pages/${page.id}`, headers: auth(cms), payload: { slug: 'other' } });
      expect(slugChange.statusCode).toBe(400);
      expect((await app.inject({ method: 'PATCH', url: `/api/v1/cms/landing-pages/${page.id}`, headers: auth(viewer), payload: { title: 'x' } })).statusCode).toBe(403);
    });

    it('uploads a banner image to the public store and serves it only while its record exists', async () => {
      const body = multipart({ altText: 'Model in linen' }, PNG);
      const res = await app.inject({ method: 'POST', url: '/api/v1/cms/assets', headers: { ...auth(cms), 'content-type': body.contentType }, payload: body.payload });
      expect(res.statusCode).toBe(201);
      const asset = res.json();
      expect(asset.url).toMatch(/^\/media\/content\/[0-9a-f-]{36}\.png$/);
      const served = await app.inject({ method: 'GET', url: `/api/v1${asset.url}` });
      expect(served.statusCode).toBe(200);
      expect(served.headers['content-type']).toBe('image/png');
      expect(served.headers['cross-origin-resource-policy']).toBe('cross-origin');
      // A content key is not a product photo, and the reverse.
      const asProduct = await app.inject({ method: 'GET', url: `/api/v1${asset.url.replace('/content/', '/products/')}` });
      expect(asProduct.statusCode).toBe(404);
      const list = (await app.inject({ method: 'GET', url: '/api/v1/cms/assets', headers: auth(viewer) })).json();
      expect(list[0]).toMatchObject({ url: asset.url, altText: 'Model in linen' });
      const lying = multipart({}, Buffer.from('#!/bin/sh\nrm -rf /'));
      expect((await app.inject({ method: 'POST', url: '/api/v1/cms/assets', headers: { ...auth(cms), 'content-type': lying.contentType }, payload: lying.payload })).statusCode).toBe(400);
      const viewerUpload = multipart({}, PNG);
      expect((await app.inject({ method: 'POST', url: '/api/v1/cms/assets', headers: { ...auth(viewer), 'content-type': viewerUpload.contentType }, payload: viewerUpload.payload })).statusCode).toBe(403);
    });
  });

  describe('channels', () => {
    async function publishableSku() {
      const { brand, category, size } = await seedBrandAndLocation();
      const style = await testPrisma.style.create({ data: { styleCode: 'CH-1', name: 'Tee', brandId: brand.id, categoryId: category.id, season: 'SS26', collection: 'Core', lifecycleState: 'PUBLISHED' } });
      const colour = await testPrisma.colour.create({ data: { styleId: style.id, name: 'Black', colourCode: 'BLK' } });
      const sku = await testPrisma.sku.create({ data: { styleId: style.id, colourId: colour.id, sizeId: size.id, skuCode: 'CH-1-BLK-M' } });
      await testPrisma.price.create({ data: { styleId: style.id, mrp: 999, sellingPrice: 799 } });
      await testPrisma.productMedia.create({ data: { styleId: style.id, url: 'https://cdn.example.com/a.jpg' } });
      return sku;
    }

    it('the owner sets the publishing scope and pauses a channel; a paused channel sends nothing', async () => {
      const service = new ChannelService(app);
      const channel = await service.createChannel({ key: 'g', name: 'Google', providerName: 'MOCK' }, ownerId);
      const sku = await publishableSku();

      const scope = await app.inject({ method: 'PATCH', url: `/api/v1/channels/${channel.id}`, headers: auth(cms), payload: { publishAll: true } });
      expect(scope.statusCode).toBe(200);
      expect(scope.json().config.publishAll).toBe(true);

      const paused = await app.inject({ method: 'PATCH', url: `/api/v1/channels/${channel.id}`, headers: auth(cms), payload: { isActive: false } });
      expect(paused.json()).toMatchObject({ isActive: false, config: { publishAll: true } });
      // The automatic sweep skips a paused channel ...
      const sweep = (await app.inject({ method: 'POST', url: '/api/v1/channels/sweep/resync-stale', headers: auth(cms) })).json();
      expect(sweep.published).toBe(0);
      // ... and a manual send is refused with a reason.
      const manual = await app.inject({ method: 'POST', url: `/api/v1/channels/${channel.id}/skus/${sku.id}/publish`, headers: auth(cms) });
      expect(manual.statusCode).toBe(409);
      expect(manual.json().error.message).toMatch(/paused/);
      expect(await testPrisma.channelListing.count({ where: { status: 'PUBLISHED' } })).toBe(0);

      await app.inject({ method: 'PATCH', url: `/api/v1/channels/${channel.id}`, headers: auth(cms), payload: { isActive: true } });
      const resumed = (await app.inject({ method: 'POST', url: '/api/v1/channels/sweep/resync-stale', headers: auth(cms) })).json();
      expect(resumed.published).toBe(1);

      expect((await app.inject({ method: 'PATCH', url: `/api/v1/channels/${channel.id}`, headers: auth(viewer), payload: { isActive: false } })).statusCode).toBe(403);
      expect((await app.inject({ method: 'PATCH', url: `/api/v1/channels/${channel.id}`, headers: auth(cms), payload: { providerName: 'GOOGLE_MERCHANT' } })).statusCode).toBe(400);
      const audit = await testPrisma.auditLog.findFirst({ where: { entityId: channel.id, action: 'channel.update' }, orderBy: { createdAt: 'desc' } });
      expect(audit?.newValue).toEqual({ isActive: true, publishAll: true });
    });
  });

  describe('setup and health', () => {
    it('reports every area with a status, what is missing and the next step, and never returns secret values', async () => {
      await testPrisma.channel.create({ data: { key: 'g', name: 'Google', providerName: 'MOCK' } });
      const res = await app.inject({ method: 'GET', url: '/api/v1/admin/setup', headers: auth(owner) });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      const keys = body.areas.map((a: { key: string }) => a.key);
      expect(keys).toEqual(['business', 'warehouse', 'reference', 'stock', 'media', 'payments', 'courier', 'messages', 'policies', 'content', 'channels']);
      for (const area of body.areas) {
        expect(['configured', 'incomplete', 'test_failed', 'unavailable']).toContain(area.status);
        expect(['business', 'deployment', 'both']).toContain(area.kind);
        expect(typeof area.impact).toBe('string');
      }
      const byKey = Object.fromEntries(body.areas.map((a: { key: string }) => [a.key, a]));
      expect(byKey.business.status).toBe('incomplete');
      expect(byKey.stock.next.href).toBe('/dashboard/receiving');
      // Payments are never "configured" just because keys may exist: no connection test exists.
      expect(byKey.payments.status).toBe('incomplete');
      expect(byKey.courier.summary).toMatch(/Test courier/);
      const raw = res.body;
      for (const secret of [process.env.JWT_ACCESS_SECRET!, process.env.MFA_SECRET_ENCRYPTION_KEY!]) expect(raw).not.toContain(secret);
    });

    it('runs a real storage test on request', async () => {
      const res = await app.inject({ method: 'POST', url: '/api/v1/admin/setup/media-storage/test', headers: auth(owner) });
      expect(res.json()).toMatchObject({ ok: true, kind: 'local' });
    });

    it('is limited to org:manage', async () => {
      expect((await app.inject({ method: 'GET', url: '/api/v1/admin/setup', headers: auth(viewer) })).statusCode).toBe(403);
      expect((await app.inject({ method: 'POST', url: '/api/v1/admin/setup/media-storage/test', headers: auth(cms) })).statusCode).toBe(403);
      expect((await app.inject({ method: 'GET', url: '/api/v1/admin/setup' })).statusCode).toBe(401);
    });
  });
});
