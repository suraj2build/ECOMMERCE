import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '../helpers/app.js';
import { resetDatabase, seedRbac, testPrisma } from '../helpers/db.js';
import { createAuthenticatedStaff } from '../helpers/auth.js';

const FAKE_UUID = '00000000-0000-0000-0000-000000000000';

/**
 * FLOW 19 - Unauthorized Admin Action Blocked
 * (acceptance/e2e-commerce-flows.md, ADM-001). Each of the three named
 * role/out-of-scope-action combinations is attempted via a direct API
 * call (never inferred from what a UI would render) and MUST be
 * rejected server-side with 403, regardless of role. Every denied
 * attempt must also be logged (`authz.denied` in AuditLog) - proven
 * directly against the audit table, not just the HTTP response.
 */
describe('FLOW 19 - Unauthorized Admin Action Blocked (M29)', () => {
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

  it('1. Warehouse Operator cannot approve a Purchase Order (Finance/BusinessAdmin-only action)', async () => {
    const { staffUserId, token } = await createAuthenticatedStaff(app, ['WAREHOUSE_OPERATOR']);
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/procurement/purchase-orders/${FAKE_UUID}/approve`,
      headers: auth(token),
    });
    expect(res.statusCode).toBe(403);

    const denial = await testPrisma.auditLog.findFirst({
      where: { actorStaffId: staffUserId, action: 'authz.denied', entityId: 'po:approve' },
    });
    expect(denial).not.toBeNull();
  });

  it('2. Catalog role cannot issue a refund (Finance-only action)', async () => {
    const { staffUserId, token } = await createAuthenticatedStaff(app, ['CATALOG']);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/refunds',
      headers: auth(token),
      payload: { orderLineId: FAKE_UUID },
    });
    expect(res.statusCode).toBe(403);

    const denial = await testPrisma.auditLog.findFirst({
      where: { actorStaffId: staffUserId, action: 'authz.denied', entityId: 'payment:refund' },
    });
    expect(denial).not.toBeNull();
  });

  it('3. Marketing role cannot perform a manual inventory adjustment unless explicitly granted', async () => {
    const { staffUserId, token } = await createAuthenticatedStaff(app, ['MARKETING']);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/inventory/adjustments',
      headers: auth(token),
      payload: { skuId: FAKE_UUID, locationId: FAKE_UUID, quantityDelta: 5, reason: 'test' },
    });
    expect(res.statusCode).toBe(403);

    const denial = await testPrisma.auditLog.findFirst({
      where: { actorStaffId: staffUserId, action: 'authz.denied', entityId: 'inventory:adjust' },
    });
    expect(denial).not.toBeNull();
  });

  it('the denial is rejected purely server-side, with no dependency on what any UI would or would not render', async () => {
    // Same as case 3, but proves the rejection happens at the permission
    // gate itself (before any handler/business logic ever runs) by
    // supplying a completely malformed body - if the 403 came from later
    // input validation instead of the permission check, this would
    // return 400, not 403.
    const { token } = await createAuthenticatedStaff(app, ['MARKETING']);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/inventory/adjustments',
      headers: auth(token),
      payload: { garbage: true },
    });
    expect(res.statusCode).toBe(403);
  });
});
