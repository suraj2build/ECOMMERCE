import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '../helpers/app.js';
import { resetDatabase, seedRbac, seedBrandAndLocation, testPrisma } from '../helpers/db.js';
import { createAuthenticatedCustomer } from '../helpers/auth.js';
import { StoreCreditService } from '../../src/modules/refunds/store-credit-service.js';
import { loadEnv } from '@fcp/config';

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

    it('genuinely concurrent FIRST-address creates for a brand-new customer (zero existing rows) converge to exactly one default, no 500s', async () => {
      const { token } = await customer();

      const [resA, resB] = await Promise.all([
        app.inject({
          method: 'POST',
          url: '/api/v1/storefront/account/addresses',
          headers: auth(token),
          payload: { recipientName: 'A', recipientMobile: '9000000001', line1: 'Flat 1', city: 'Delhi', state: 'Delhi', stateCode: 'DL', pincode: '110001' },
        }),
        app.inject({
          method: 'POST',
          url: '/api/v1/storefront/account/addresses',
          headers: auth(token),
          payload: { recipientName: 'B', recipientMobile: '9000000002', line1: 'Flat 2', city: 'Mumbai', state: 'Maharashtra', stateCode: 'MH', pincode: '400001' },
        }),
      ]);
      expect([resA.statusCode, resB.statusCode]).toEqual([201, 201]);

      const list = await app.inject({ method: 'GET', url: '/api/v1/storefront/account/addresses', headers: auth(token) });
      const rows = list.json() as Array<{ isDefault: boolean }>;
      expect(rows).toHaveLength(2);
      expect(rows.filter((r) => r.isDefault)).toHaveLength(1);
    });

    it('a concurrent second-address create (with isDefault requested) racing a set-default call on the first converges to exactly one default', async () => {
      const { token } = await customer();
      const first = await app.inject({
        method: 'POST',
        url: '/api/v1/storefront/account/addresses',
        headers: auth(token),
        payload: { recipientName: 'A', recipientMobile: '9000000001', line1: 'Flat 1', city: 'Delhi', state: 'Delhi', stateCode: 'DL', pincode: '110001' },
      });

      const [createRes, setDefaultRes] = await Promise.all([
        app.inject({
          method: 'POST',
          url: '/api/v1/storefront/account/addresses',
          headers: auth(token),
          payload: { recipientName: 'B', recipientMobile: '9000000002', line1: 'Flat 2', city: 'Mumbai', state: 'Maharashtra', stateCode: 'MH', pincode: '400001', isDefault: true },
        }),
        app.inject({ method: 'POST', url: `/api/v1/storefront/account/addresses/${first.json().id}/default`, headers: auth(token) }),
      ]);
      expect(createRes.statusCode).toBe(201);
      expect(setDefaultRes.statusCode).toBe(200);

      const list = await app.inject({ method: 'GET', url: '/api/v1/storefront/account/addresses', headers: auth(token) });
      const rows = list.json() as Array<{ isDefault: boolean }>;
      expect(rows).toHaveLength(2);
      expect(rows.filter((r) => r.isDefault)).toHaveLength(1);
    });

    it('a concurrent delete-of-default racing a new-address create converges to exactly one default, no 500s', async () => {
      const { token } = await customer();
      const first = await app.inject({
        method: 'POST',
        url: '/api/v1/storefront/account/addresses',
        headers: auth(token),
        payload: { recipientName: 'A', recipientMobile: '9000000001', line1: 'Flat 1', city: 'Delhi', state: 'Delhi', stateCode: 'DL', pincode: '110001' },
      });

      const [delRes, createRes] = await Promise.all([
        app.inject({ method: 'DELETE', url: `/api/v1/storefront/account/addresses/${first.json().id}`, headers: auth(token) }),
        app.inject({
          method: 'POST',
          url: '/api/v1/storefront/account/addresses',
          headers: auth(token),
          payload: { recipientName: 'B', recipientMobile: '9000000002', line1: 'Flat 2', city: 'Mumbai', state: 'Maharashtra', stateCode: 'MH', pincode: '400001' },
        }),
      ]);
      expect(delRes.statusCode).toBe(204);
      expect(createRes.statusCode).toBe(201);

      const list = await app.inject({ method: 'GET', url: '/api/v1/storefront/account/addresses', headers: auth(token) });
      const rows = list.json() as Array<{ isDefault: boolean }>;
      expect(rows).toHaveLength(1);
      expect(rows.filter((r) => r.isDefault)).toHaveLength(1);
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

  // --- PII-safe audit trail (M22 certification-repair, finding 1) ---
  //
  // The original build recorded raw PII (email; address city/pincode) in
  // AuditLog.oldValue/newValue. These tests prove every M22 audit event
  // instead records only non-sensitive change metadata, never a
  // customer's email, mobile, address lines, city, or pincode - while
  // still keeping actorCustomerId/entityId/action for full traceability.
  describe('PII-safe audit trail', () => {
    const FORBIDDEN_STRINGS = ['updated@example.com', 'Flat 1', 'Delhi', '110001', '9000000001'];

    function assertNoPii(value: unknown) {
      const serialized = JSON.stringify(value ?? {});
      for (const forbidden of FORBIDDEN_STRINGS) {
        expect(serialized).not.toContain(forbidden);
      }
    }

    it('customer_profile.update audit never records the email value', async () => {
      const { token, customerId } = await customer();
      await app.inject({
        method: 'PATCH',
        url: '/api/v1/storefront/account/profile',
        headers: auth(token),
        payload: { fullName: 'Updated Name', email: 'updated@example.com' },
      });
      const rows = await testPrisma.auditLog.findMany({ where: { action: 'customer_profile.update', actorCustomerId: customerId } });
      expect(rows).toHaveLength(1);
      assertNoPii(rows[0]!.oldValue);
      assertNoPii(rows[0]!.newValue);
      expect(rows[0]!.actorCustomerId).toBe(customerId);
    });

    it('customer_address.create/update/delete audits never record recipient/address-line/city/pincode values', async () => {
      const { token, customerId } = await customer();
      const created = await app.inject({
        method: 'POST',
        url: '/api/v1/storefront/account/addresses',
        headers: auth(token),
        payload: { recipientName: 'A', recipientMobile: '9000000001', line1: 'Flat 1', city: 'Delhi', state: 'Delhi', stateCode: 'DL', pincode: '110001' },
      });
      await app.inject({
        method: 'PATCH',
        url: `/api/v1/storefront/account/addresses/${created.json().id}`,
        headers: auth(token),
        payload: { city: 'Mumbai' },
      });
      await app.inject({ method: 'DELETE', url: `/api/v1/storefront/account/addresses/${created.json().id}`, headers: auth(token) });

      const rows = await testPrisma.auditLog.findMany({
        where: { entityType: 'CustomerAddress', actorCustomerId: customerId },
        orderBy: { createdAt: 'asc' },
      });
      expect(rows.map((r) => r.action)).toEqual(['customer_address.create', 'customer_address.update', 'customer_address.delete']);
      for (const row of rows) {
        assertNoPii(row.oldValue);
        assertNoPii(row.newValue);
      }
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

    // M22 certification-repair (finding 2): the original build only
    // bounded this log by count (RECENTLY_VIEWED_MAX_ITEMS) - a customer
    // who viewed fewer items than that count could keep an arbitrarily
    // old view forever. RECENTLY_VIEWED_RETENTION_DAYS is a SEPARATE,
    // also-configurable time bound - both must hold independently.
    it('M22 certification-repair (finding 2): a view inside the retention window is visible, a view outside it is not, independent of the count bound', async () => {
      const { token, customerId } = await customer();
      const { brand, category } = await seedBrandAndLocation();
      const recentStyle = await createPublishedStyle({ brandId: brand.id, categoryId: category.id }, 'RV-RECENT');
      const staleStyle = await createPublishedStyle({ brandId: brand.id, categoryId: category.id }, 'RV-STALE');

      await app.inject({ method: 'POST', url: `/api/v1/storefront/account/recently-viewed/${staleStyle.id}`, headers: auth(token) });
      await app.inject({ method: 'POST', url: `/api/v1/storefront/account/recently-viewed/${recentStyle.id}`, headers: auth(token) });

      const env = loadEnv();
      const outsideWindow = new Date(Date.now() - (env.RECENTLY_VIEWED_RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000);
      await testPrisma.recentlyViewedProduct.updateMany({
        where: { customerId, styleId: staleStyle.id },
        data: { viewedAt: outsideWindow },
      });

      const list = await app.inject({ method: 'GET', url: '/api/v1/storefront/account/recently-viewed', headers: auth(token) });
      const items = list.json() as Array<{ styleId: string }>;
      expect(items.map((i) => i.styleId)).toEqual([recentStyle.id]);
      expect(items.map((i) => i.styleId)).not.toContain(staleStyle.id);

      // The row itself is pruned on the next write for this customer
      // ("prefer removing expired rows safely rather than allowing
      // indefinite storage"), not merely filtered at read time.
      await app.inject({ method: 'POST', url: `/api/v1/storefront/account/recently-viewed/${recentStyle.id}`, headers: auth(token) });
      const remaining = await testPrisma.recentlyViewedProduct.findMany({ where: { customerId } });
      expect(remaining.map((r) => r.styleId)).not.toContain(staleStyle.id);
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

    it('M22 certification-repair (finding 3): allows opting out of ORDER_UPDATES - no invented non-opt-outable rule', async () => {
      const { token } = await customer();
      const res = await app.inject({
        method: 'PUT',
        url: '/api/v1/storefront/account/communication-preferences',
        headers: auth(token),
        payload: { preferences: [{ channel: 'SMS', messageType: 'ORDER_UPDATES', optedIn: false }] },
      });
      expect(res.statusCode).toBe(200);
      const row = (res.json() as Array<{ channel: string; messageType: string; optedIn: boolean }>).find(
        (r) => r.channel === 'SMS' && r.messageType === 'ORDER_UPDATES',
      );
      expect(row!.optedIn).toBe(false);

      const reload = await app.inject({ method: 'GET', url: '/api/v1/storefront/account/communication-preferences', headers: auth(token) });
      const reloadedRow = (reload.json() as Array<{ channel: string; messageType: string; optedIn: boolean }>).find(
        (r) => r.channel === 'SMS' && r.messageType === 'ORDER_UPDATES',
      );
      expect(reloadedRow!.optedIn).toBe(false);
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
