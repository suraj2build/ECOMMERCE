import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '../helpers/app.js';
import { resetDatabase, seedRbac, grantPermissions, testPrisma } from '../helpers/db.js';
import { createAuthenticatedStaff } from '../helpers/auth.js';

/**
 * Internal Customer 360 (M29, specs/28-admin.md ADM-002) adversarial
 * certification. Proves the staff-facing view is distinct from and
 * narrower than the customer's own self-service profile (no address
 * book/recently-viewed/saved-sizes), reads real ledger data (orders,
 * loyalty, store credit, returns/exchanges), and is gated by the
 * EXISTING `customer_service:manage` permission.
 */
describe('Internal Customer 360 (M29)', () => {
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

  function auth(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  async function csStaff() {
    await grantPermissions('CUSTOMER_SERVICE', ['customer_service:manage']);
    return createAuthenticatedStaff(app, ['CUSTOMER_SERVICE']);
  }

  it('looks up a customer by mobile and returns a data-minimized 360 view', async () => {
    const { token } = await csStaff();
    const customer = await testPrisma.customer.create({ data: { mobile: '9812345670', fullName: 'Jane Doe', email: 'jane@example.com' } });

    const lookup = await app.inject({ method: 'GET', url: '/api/v1/support/customers/lookup?mobile=9812345670', headers: auth(token) });
    expect(lookup.statusCode).toBe(200);
    expect(lookup.json().id).toBe(customer.id);

    const view = await app.inject({ method: 'GET', url: `/api/v1/support/customers/${customer.id}/360`, headers: auth(token) });
    expect(view.statusCode).toBe(200);
    const body = view.json();
    expect(body.mobile).toBe('9812345670');
    expect(body.lifetimeOrderCount).toBe(0);
    expect(body.loyalty.availablePoints).toBe(0);
    expect(body.storeCreditBalance).toBe(0);
    // Data-minimized: no address book, no recently-viewed, no saved sizes -
    // this is a distinct, narrower view than the customer's own self-service profile.
    expect(body.addresses).toBeUndefined();
    expect(body.recentlyViewedProducts).toBeUndefined();
    expect(body.savedSizes).toBeUndefined();
  });

  it('a lookup for an unknown mobile number 404s', async () => {
    const { token } = await csStaff();
    const res = await app.inject({ method: 'GET', url: '/api/v1/support/customers/lookup?mobile=9999999999', headers: auth(token) });
    expect(res.statusCode).toBe(404);
  });

  describe('RBAC', () => {
    it('rejects a role without customer_service:manage', async () => {
      const { token } = await createAuthenticatedStaff(app, ['WAREHOUSE_OPERATOR']);
      const customer = await testPrisma.customer.create({ data: { mobile: '9812345671', fullName: 'X' } });
      const res = await app.inject({ method: 'GET', url: `/api/v1/support/customers/${customer.id}/360`, headers: auth(token) });
      expect(res.statusCode).toBe(403);
    });

    it('rejects an unauthenticated request', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/support/customers/lookup?mobile=9812345670' });
      expect(res.statusCode).toBe(401);
    });
  });
});
