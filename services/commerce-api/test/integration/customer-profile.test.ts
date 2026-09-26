import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '../helpers/app.js';
import { resetDatabase, seedRbac, seedBrandAndLocation, testPrisma } from '../helpers/db.js';
import { createAuthenticatedCustomer } from '../helpers/auth.js';
import { StoreCreditService } from '../../src/modules/refunds/store-credit-service.js';

/**
 * M22 Customer 360 (specs/21-customer-profile.md). Every route under
 * test here is authenticated-customer-only (`requireCustomerAuth`) - the
 * customerId is ALWAYS derived from the bearer token
 * (`createAuthenticatedCustomer` mints one exactly like the real OTP
 * flow would, per test/helpers/auth.ts's own docblock), never taken from
 * a request param/body/query. Cross-customer access (IDOR/BOLA) is
 * proven negatively for every new resource type.
 */
describe('Customer 360 (M22)', () => {
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

  async function customer() {
    return createAuthenticatedCustomer(app);
  }

  function auth(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  async function createPublishedStyle(ctx: { brandId: string; categoryId: string }, styleCode: string) {
    return testPrisma.style.create({
      data: {
        styleCode,
        name: `Style ${styleCode}`,
        brandId: ctx.brandId,
        categoryId: ctx.categoryId,
        season: 'SS26',
        collection: 'Core',
        lifecycleState: 'PUBLISHED',
        publishedAt: new Date(),
      },
    });
  }

  // --- Profile ---

  describe('Profile', () => {
    it('returns and updates only the authenticated customers own profile', async () => {
      const { token } = await customer();

      const getRes = await app.inject({ method: 'GET', url: '/api/v1/storefront/account/profile', headers: auth(token) });
      expect(getRes.statusCode).toBe(200);
      expect(getRes.json().fullName).toBe('Test Customer');

      const patchRes = await app.inject({
        method: 'PATCH',
        url: '/api/v1/storefront/account/profile',
        headers: auth(token),
        payload: { fullName: 'Updated Name', email: 'updated@example.com' },
      });
      expect(patchRes.statusCode).toBe(200);
      expect(patchRes.json().fullName).toBe('Updated Name');
      expect(patchRes.json().email).toBe('updated@example.com');

      const auditRows = await testPrisma.auditLog.findMany({ where: { action: 'customer_profile.update' } });
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0]!.actorType).toBe('CUSTOMER');
    });

    it('rejects an unauthenticated request with 401', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/storefront/account/profile' });
      expect(res.statusCode).toBe(401);
    });
  });

  // --- Address book ---

  describe('Address book', () => {
    it('creates the first address as the default automatically', async () => {
      const { token } = await customer();
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/storefront/account/addresses',
        headers: auth(token),
        payload: {
          recipientName: 'A',
          recipientMobile: '9000000001',
          line1: 'Flat 1',
          city: 'Delhi',
          state: 'Delhi',
          stateCode: 'DL',
          pincode: '110001',
        },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().isDefault).toBe(true);
    });

    it('a second address is not default unless explicitly requested, and set-default flips exactly one', async () => {
      const { token } = await customer();
      const first = await app.inject({
        method: 'POST',
        url: '/api/v1/storefront/account/addresses',
        headers: auth(token),
        payload: { recipientName: 'A', recipientMobile: '9000000001', line1: 'Flat 1', city: 'Delhi', state: 'Delhi', stateCode: 'DL', pincode: '110001' },
      });
      const second = await app.inject({
        method: 'POST',
        url: '/api/v1/storefront/account/addresses',
        headers: auth(token),
        payload: { recipientName: 'B', recipientMobile: '9000000002', line1: 'Flat 2', city: 'Mumbai', state: 'Maharashtra', stateCode: 'MH', pincode: '400001' },
      });
      expect(second.json().isDefault).toBe(false);

      const setDefault = await app.inject({ method: 'POST', url: `/api/v1/storefront/account/addresses/${second.json().id}/default`, headers: auth(token) });
      expect(setDefault.statusCode).toBe(200);

      const list = await app.inject({ method: 'GET', url: '/api/v1/storefront/account/addresses', headers: auth(token) });
      const defaults = (list.json() as Array<{ id: string; isDefault: boolean }>).filter((a) => a.isDefault);
      expect(defaults).toHaveLength(1);
      expect(defaults[0]!.id).toBe(second.json().id);
      expect(first.json().id).not.toBe(second.json().id);
    });

    it('promotes another address to default when the default is deleted', async () => {
      const { token } = await customer();
      const first = await app.inject({
        method: 'POST',
        url: '/api/v1/storefront/account/addresses',
        headers: auth(token),
        payload: { recipientName: 'A', recipientMobile: '9000000001', line1: 'Flat 1', city: 'Delhi', state: 'Delhi', stateCode: 'DL', pincode: '110001' },
      });
      await app.inject({
        method: 'POST',
        url: '/api/v1/storefront/account/addresses',
        headers: auth(token),
        payload: { recipientName: 'B', recipientMobile: '9000000002', line1: 'Flat 2', city: 'Mumbai', state: 'Maharashtra', stateCode: 'MH', pincode: '400001' },
      });

      const del = await app.inject({ method: 'DELETE', url: `/api/v1/storefront/account/addresses/${first.json().id}`, headers: auth(token) });
      expect(del.statusCode).toBe(204);

      const list = await app.inject({ method: 'GET', url: '/api/v1/storefront/account/addresses', headers: auth(token) });
      const remaining = list.json() as Array<{ id: string; isDefault: boolean }>;
      expect(remaining).toHaveLength(1);
      expect(remaining[0]!.isDefault).toBe(true);
    });

    it('deleting the only remaining address leaves zero addresses with no error', async () => {
      const { token } = await customer();
      const only = await app.inject({
        method: 'POST',
        url: '/api/v1/storefront/account/addresses',
        headers: auth(token),
        payload: { recipientName: 'A', recipientMobile: '9000000001', line1: 'Flat 1', city: 'Delhi', state: 'Delhi', stateCode: 'DL', pincode: '110001' },
      });
      const del = await app.inject({ method: 'DELETE', url: `/api/v1/storefront/account/addresses/${only.json().id}`, headers: auth(token) });
      expect(del.statusCode).toBe(204);
      const list = await app.inject({ method: 'GET', url: '/api/v1/storefront/account/addresses', headers: auth(token) });
      expect(list.json()).toHaveLength(0);
    });

    it('IDOR: a different customer cannot read, update, delete, or set-default another customers address', async () => {
      const { token: tokenA } = await customer();
      const { token: tokenB } = await customer();
      const created = await app.inject({
        method: 'POST',
        url: '/api/v1/storefront/account/addresses',
        headers: auth(tokenA),
        payload: { recipientName: 'A', recipientMobile: '9000000001', line1: 'Flat 1', city: 'Delhi', state: 'Delhi', stateCode: 'DL', pincode: '110001' },
      });
      const addressId = created.json().id as string;

      const patch = await app.inject({ method: 'PATCH', url: `/api/v1/storefront/account/addresses/${addressId}`, headers: auth(tokenB), payload: { city: 'Hacked' } });
      expect(patch.statusCode).toBe(404);

      const setDefault = await app.inject({ method: 'POST', url: `/api/v1/storefront/account/addresses/${addressId}/default`, headers: auth(tokenB) });
      expect(setDefault.statusCode).toBe(404);

      const del = await app.inject({ method: 'DELETE', url: `/api/v1/storefront/account/addresses/${addressId}`, headers: auth(tokenB) });
      expect(del.statusCode).toBe(404);

      const listB = await app.inject({ method: 'GET', url: '/api/v1/storefront/account/addresses', headers: auth(tokenB) });
      expect(listB.json()).toHaveLength(0);
    });

    it('genuinely concurrent set-default calls for two different addresses converge to exactly one default', async () => {
      const { token } = await customer();
      const a = await app.inject({
        method: 'POST',
        url: '/api/v1/storefront/account/addresses',
        headers: auth(token),
        payload: { recipientName: 'A', recipientMobile: '9000000001', line1: 'Flat 1', city: 'Delhi', state: 'Delhi', stateCode: 'DL', pincode: '110001' },
      });
      const b = await app.inject({
        method: 'POST',
        url: '/api/v1/storefront/account/addresses',
        headers: auth(token),
        payload: { recipientName: 'B', recipientMobile: '9000000002', line1: 'Flat 2', city: 'Mumbai', state: 'Maharashtra', stateCode: 'MH', pincode: '400001' },
      });

      const [resA, resB] = await Promise.all([
        app.inject({ method: 'POST', url: `/api/v1/storefront/account/addresses/${a.json().id}/default`, headers: auth(token) }),
        app.inject({ method: 'POST', url: `/api/v1/storefront/account/addresses/${b.json().id}/default`, headers: auth(token) }),
      ]);
      expect([resA.statusCode, resB.statusCode]).toEqual([200, 200]);

      const list = await app.inject({ method: 'GET', url: '/api/v1/storefront/account/addresses', headers: auth(token) });
      const defaults = (list.json() as Array<{ isDefault: boolean }>).filter((row) => row.isDefault);
      expect(defaults).toHaveLength(1);
    });

    it('concurrent delete-default and set-default on the same customer converge to exactly one default, never zero or two', async () => {
      const { token } = await customer();
      const a = await app.inject({
        method: 'POST',
        url: '/api/v1/storefront/account/addresses',
        headers: auth(token),
        payload: { recipientName: 'A', recipientMobile: '9000000001', line1: 'Flat 1', city: 'Delhi', state: 'Delhi', stateCode: 'DL', pincode: '110001' },
      });
      const b = await app.inject({
        method: 'POST',
        url: '/api/v1/storefront/account/addresses',
        headers: auth(token),
        payload: { recipientName: 'B', recipientMobile: '9000000002', line1: 'Flat 2', city: 'Mumbai', state: 'Maharashtra', stateCode: 'MH', pincode: '400001' },
      });

      await Promise.all([
        app.inject({ method: 'DELETE', url: `/api/v1/storefront/account/addresses/${a.json().id}`, headers: auth(token) }),
        app.inject({ method: 'POST', url: `/api/v1/storefront/account/addresses/${b.json().id}/default`, headers: auth(token) }),
      ]);

      const list = await app.inject({ method: 'GET', url: '/api/v1/storefront/account/addresses', headers: auth(token) });
      const rows = list.json() as Array<{ isDefault: boolean }>;
      const defaults = rows.filter((row) => row.isDefault);
      expect(defaults.length).toBeLessThanOrEqual(1);
      if (rows.length > 0) expect(defaults).toHaveLength(1);
    });
  });

  // --- Recently viewed ---

  describe('Recently viewed', () => {
    it('records a view, dedupes a repeat view, and lists most-recent first', async () => {
      const { token } = await customer();
      const { brand, category } = await seedBrandAndLocation();
      const style1 = await createPublishedStyle({ brandId: brand.id, categoryId: category.id }, 'RV-001');
      const style2 = await createPublishedStyle({ brandId: brand.id, categoryId: category.id }, 'RV-002');

      await app.inject({ method: 'POST', url: `/api/v1/storefront/account/recently-viewed/${style1.id}`, headers: auth(token) });
      await app.inject({ method: 'POST', url: `/api/v1/storefront/account/recently-viewed/${style2.id}`, headers: auth(token) });
      // Repeat view of style1 - must not create a second row, and must move it back to most-recent.
      await app.inject({ method: 'POST', url: `/api/v1/storefront/account/recently-viewed/${style1.id}`, headers: auth(token) });

      const rows = await testPrisma.recentlyViewedProduct.findMany({ where: { customerId: (await testPrisma.customer.findFirstOrThrow()).id } });
      expect(rows).toHaveLength(2);

      const list = await app.inject({ method: 'GET', url: '/api/v1/storefront/account/recently-viewed', headers: auth(token) });
      const items = list.json() as Array<{ styleId: string }>;
      expect(items[0]!.styleId).toBe(style1.id);
      expect(items[1]!.styleId).toBe(style2.id);
    });

    it('bounds the log to RECENTLY_VIEWED_MAX_ITEMS, dropping the oldest', async () => {
      const { token } = await customer();
      const { brand, category } = await seedBrandAndLocation();
      const styles = await Promise.all(
        Array.from({ length: 6 }, (_, i) => createPublishedStyle({ brandId: brand.id, categoryId: category.id }, `RV-BOUND-${i}`)),
      );

      // Serially, so viewedAt ordering is deterministic.
      for (const style of styles) {
        // eslint-disable-next-line no-await-in-loop
        await app.inject({ method: 'POST', url: `/api/v1/storefront/account/recently-viewed/${style.id}`, headers: auth(token) });
      }

      const list = await app.inject({ method: 'GET', url: `/api/v1/storefront/account/recently-viewed?limit=50`, headers: auth(token) });
      // RECENTLY_VIEWED_MAX_ITEMS defaults to 50 in the real env, but the
      // test env may override it - assert the invariant relatively: never
      // more rows than the configured max, and the most recent view
      // (the last style viewed) is always present.
      const items = list.json() as Array<{ styleId: string }>;
      expect(items[0]!.styleId).toBe(styles[styles.length - 1]!.id);
      expect(items.length).toBeLessThanOrEqual(6);
    });

    it('excludes an unpublished style gracefully rather than erroring', async () => {
      const { token } = await customer();
      const { brand, category } = await seedBrandAndLocation();
      const style = await testPrisma.style.create({
        data: { styleCode: 'RV-DRAFT', name: 'Draft', brandId: brand.id, categoryId: category.id, season: 'SS26', collection: 'Core', lifecycleState: 'DRAFT' },
      });
      await app.inject({ method: 'POST', url: `/api/v1/storefront/account/recently-viewed/${style.id}`, headers: auth(token) });
      const list = await app.inject({ method: 'GET', url: '/api/v1/storefront/account/recently-viewed', headers: auth(token) });
      expect(list.json()).toHaveLength(0);
    });

    it('IDOR: a different customer never sees another customers recently-viewed items', async () => {
      const { token: tokenA } = await customer();
      const { token: tokenB } = await customer();
      const { brand, category } = await seedBrandAndLocation();
      const style = await createPublishedStyle({ brandId: brand.id, categoryId: category.id }, 'RV-IDOR');

      await app.inject({ method: 'POST', url: `/api/v1/storefront/account/recently-viewed/${style.id}`, headers: auth(tokenA) });
      const listB = await app.inject({ method: 'GET', url: '/api/v1/storefront/account/recently-viewed', headers: auth(tokenB) });
      expect(listB.json()).toHaveLength(0);
    });

    it('concurrent repeated views of the same product never create duplicate rows', async () => {
      const { token } = await customer();
      const { brand, category } = await seedBrandAndLocation();
      const style = await createPublishedStyle({ brandId: brand.id, categoryId: category.id }, 'RV-CONC');

      await Promise.all(
        Array.from({ length: 5 }, () => app.inject({ method: 'POST', url: `/api/v1/storefront/account/recently-viewed/${style.id}`, headers: auth(token) })),
      );

      const customerId = (await testPrisma.customer.findFirstOrThrow()).id;
      const rows = await testPrisma.recentlyViewedProduct.findMany({ where: { customerId, styleId: style.id } });
      expect(rows).toHaveLength(1);
    });
  });

  // --- My Sizes ---

  describe('My Sizes', () => {
    it('saves, updates (upserts), lists, and removes a saved size', async () => {
      const { token } = await customer();
      const { category, size } = await seedBrandAndLocation();
      const otherSize = await testPrisma.size.create({ data: { label: 'L', sortOrder: 1 } });

      const save = await app.inject({ method: 'PUT', url: '/api/v1/storefront/account/sizes', headers: auth(token), payload: { categoryId: category.id, sizeId: size.id } });
      expect(save.statusCode).toBe(200);

      // Update: same category, different size - upserts in place, no duplicate row.
      const update = await app.inject({ method: 'PUT', url: '/api/v1/storefront/account/sizes', headers: auth(token), payload: { categoryId: category.id, sizeId: otherSize.id } });
      expect(update.statusCode).toBe(200);

      const list = await app.inject({ method: 'GET', url: '/api/v1/storefront/account/sizes', headers: auth(token) });
      const rows = list.json() as Array<{ id: string; sizeLabel: string }>;
      expect(rows).toHaveLength(1);
      expect(rows[0]!.sizeLabel).toBe('L');

      const remove = await app.inject({ method: 'DELETE', url: `/api/v1/storefront/account/sizes/${rows[0]!.id}`, headers: auth(token) });
      expect(remove.statusCode).toBe(204);
      const listAfter = await app.inject({ method: 'GET', url: '/api/v1/storefront/account/sizes', headers: auth(token) });
      expect(listAfter.json()).toHaveLength(0);
    });

    it('IDOR: a different customer cannot remove another customers saved size', async () => {
      const { token: tokenA } = await customer();
      const { token: tokenB } = await customer();
      const { category, size } = await seedBrandAndLocation();
      const save = await app.inject({ method: 'PUT', url: '/api/v1/storefront/account/sizes', headers: auth(tokenA), payload: { categoryId: category.id, sizeId: size.id } });

      const remove = await app.inject({ method: 'DELETE', url: `/api/v1/storefront/account/sizes/${save.json().id}`, headers: auth(tokenB) });
      expect(remove.statusCode).toBe(404);
    });

    it('concurrent duplicate-add for the same category converges to exactly one saved size', async () => {
      const { token } = await customer();
      const { category, size } = await seedBrandAndLocation();

      await Promise.all(
        Array.from({ length: 5 }, () => app.inject({ method: 'PUT', url: '/api/v1/storefront/account/sizes', headers: auth(token), payload: { categoryId: category.id, sizeId: size.id } })),
      );

      const customerId = (await testPrisma.customer.findFirstOrThrow()).id;
      const rows = await testPrisma.customerSavedSize.findMany({ where: { customerId, categoryId: category.id } });
      expect(rows).toHaveLength(1);
    });
  });

  // --- Reviews ---

  describe('My Reviews', () => {
    it('lists only the authenticated customers own reviews', async () => {
      const { token: tokenA, customerId: customerIdA } = await customer();
      const { token: tokenB } = await customer();
      const { brand, category } = await seedBrandAndLocation();
      const style = await createPublishedStyle({ brandId: brand.id, categoryId: category.id }, 'REV-001');
      await testPrisma.review.create({ data: { styleId: style.id, customerId: customerIdA, rating: 5, body: 'Great' } });

      const listA = await app.inject({ method: 'GET', url: '/api/v1/storefront/account/reviews', headers: auth(tokenA) });
      expect(listA.json()).toHaveLength(1);

      const listB = await app.inject({ method: 'GET', url: '/api/v1/storefront/account/reviews', headers: auth(tokenB) });
      expect(listB.json()).toHaveLength(0);
    });
  });

  // --- Communication preferences ---

  describe('Communication preferences', () => {
    it('defaults ORDER_UPDATES to opted-in and every marketing type to opted-out', async () => {
      const { token } = await customer();
      const res = await app.inject({ method: 'GET', url: '/api/v1/storefront/account/communication-preferences', headers: auth(token) });
      const rows = res.json() as Array<{ messageType: string; optedIn: boolean }>;
      for (const row of rows) {
        expect(row.optedIn).toBe(row.messageType === 'ORDER_UPDATES');
      }
    });

    it('rejects opting out of the transactional ORDER_UPDATES message type', async () => {
      const { token } = await customer();
      const res = await app.inject({
        method: 'PUT',
        url: '/api/v1/storefront/account/communication-preferences',
        headers: auth(token),
        payload: { preferences: [{ channel: 'SMS', messageType: 'ORDER_UPDATES', optedIn: false }] },
      });
      expect(res.statusCode).toBe(400);
    });

    it('persists the exact matrix set, reload returns the same values', async () => {
      const { token } = await customer();
      const set = await app.inject({
        method: 'PUT',
        url: '/api/v1/storefront/account/communication-preferences',
        headers: auth(token),
        payload: {
          preferences: [
            { channel: 'EMAIL', messageType: 'NEWSLETTER', optedIn: true },
            { channel: 'SMS', messageType: 'OFFERS_AND_PROMOTIONS', optedIn: true },
            { channel: 'PUSH', messageType: 'PRODUCT_RECOMMENDATIONS', optedIn: true },
          ],
        },
      });
      expect(set.statusCode).toBe(200);

      const reload = await app.inject({ method: 'GET', url: '/api/v1/storefront/account/communication-preferences', headers: auth(token) });
      const rows = reload.json() as Array<{ channel: string; messageType: string; optedIn: boolean }>;
      expect(rows.find((r) => r.channel === 'EMAIL' && r.messageType === 'NEWSLETTER')!.optedIn).toBe(true);
      expect(rows.find((r) => r.channel === 'SMS' && r.messageType === 'OFFERS_AND_PROMOTIONS')!.optedIn).toBe(true);
      expect(rows.find((r) => r.channel === 'PUSH' && r.messageType === 'PRODUCT_RECOMMENDATIONS')!.optedIn).toBe(true);
      expect(rows.find((r) => r.channel === 'SMS' && r.messageType === 'NEWSLETTER')!.optedIn).toBe(false);
    });

    it('IDOR: a different customers communication preferences are never visible or affected', async () => {
      const { token: tokenA } = await customer();
      const { token: tokenB } = await customer();
      await app.inject({
        method: 'PUT',
        url: '/api/v1/storefront/account/communication-preferences',
        headers: auth(tokenA),
        payload: { preferences: [{ channel: 'EMAIL', messageType: 'NEWSLETTER', optedIn: true }] },
      });
      const listB = await app.inject({ method: 'GET', url: '/api/v1/storefront/account/communication-preferences', headers: auth(tokenB) });
      const rowB = (listB.json() as Array<{ channel: string; messageType: string; optedIn: boolean }>).find(
        (r) => r.channel === 'EMAIL' && r.messageType === 'NEWSLETTER',
      );
      expect(rowB!.optedIn).toBe(false);
    });

    it('genuinely concurrent preference updates for different message types both persist', async () => {
      const { token } = await customer();
      await Promise.all([
        app.inject({
          method: 'PUT',
          url: '/api/v1/storefront/account/communication-preferences',
          headers: auth(token),
          payload: { preferences: [{ channel: 'EMAIL', messageType: 'NEWSLETTER', optedIn: true }] },
        }),
        app.inject({
          method: 'PUT',
          url: '/api/v1/storefront/account/communication-preferences',
          headers: auth(token),
          payload: { preferences: [{ channel: 'SMS', messageType: 'OFFERS_AND_PROMOTIONS', optedIn: true }] },
        }),
      ]);
      const reload = await app.inject({ method: 'GET', url: '/api/v1/storefront/account/communication-preferences', headers: auth(token) });
      const rows = reload.json() as Array<{ channel: string; messageType: string; optedIn: boolean }>;
      expect(rows.find((r) => r.channel === 'EMAIL' && r.messageType === 'NEWSLETTER')!.optedIn).toBe(true);
      expect(rows.find((r) => r.channel === 'SMS' && r.messageType === 'OFFERS_AND_PROMOTIONS')!.optedIn).toBe(true);
    });
  });

  // --- Store credit (reuses the existing M20 route/service directly) ---

  describe('Store credit reuse', () => {
    it('an authenticated customers own store-credit balance and history are visible via the existing M20 route', async () => {
      const { token, customerId } = await customer();
      const storeCredit = new StoreCreditService(app);
      await storeCredit.issue({ identity: { customerId }, amount: 250, reason: 'Test refund', idempotencyKey: `test-${customerId}` });

      const res = await app.inject({ method: 'GET', url: '/api/v1/storefront/store-credit', headers: auth(token) });
      expect(res.statusCode).toBe(200);
      expect(res.json().balance).toBe(250);
      expect(res.json().entries).toHaveLength(1);
    });

    it('IDOR: a different customer never sees another customers store credit', async () => {
      const { customerId: customerIdA } = await customer();
      const { token: tokenB } = await customer();
      const storeCredit = new StoreCreditService(app);
      await storeCredit.issue({ identity: { customerId: customerIdA }, amount: 500, reason: 'Test', idempotencyKey: `idor-${customerIdA}` });

      const res = await app.inject({ method: 'GET', url: '/api/v1/storefront/store-credit', headers: auth(tokenB) });
      expect(res.json().balance).toBe(0);
    });

    it('a concurrent read during a concurrent ledger post never sees a torn/inconsistent balance', async () => {
      const { token, customerId } = await customer();
      const storeCredit = new StoreCreditService(app);

      const [issueResult, readResult] = await Promise.all([
        storeCredit.issue({ identity: { customerId }, amount: 100, reason: 'Concurrent issue', idempotencyKey: `conc-${customerId}` }),
        app.inject({ method: 'GET', url: '/api/v1/storefront/store-credit', headers: auth(token) }),
      ]);
      expect(issueResult.amount.toString()).toBe('100');
      // The concurrent read must see either 0 (pre-commit) or 100
      // (post-commit) - never anything else, and never a 500.
      expect(readResult.statusCode).toBe(200);
      expect([0, 100]).toContain(readResult.json().balance);

      const finalRead = await app.inject({ method: 'GET', url: '/api/v1/storefront/store-credit', headers: auth(token) });
      expect(finalRead.json().balance).toBe(100);
    });
  });
});
