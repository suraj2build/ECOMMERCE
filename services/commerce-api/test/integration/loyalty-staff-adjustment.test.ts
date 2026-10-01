import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '../helpers/app.js';
import { resetDatabase, seedRbac, grantPermissions, testPrisma } from '../helpers/db.js';
import { createAuthenticatedStaff, createAuthenticatedCustomer } from '../helpers/auth.js';

/**
 * P1 Product Owner decisions D-1 and D-3 (2026-10-01,
 * docs/admin/P1_DECISIONS.md).
 *
 * D-1: a holder of `loyalty:adjust` (Finance) can find the customer a
 * manual loyalty correction is for, through a lookup restricted to that
 * purpose: exact mobile match, at most one result, identity and loyalty
 * balance only. Customer 360 (`customer_service:manage`) is unchanged.
 *
 * D-3: a manual adjustment that would take the loyalty balance below zero
 * is rejected whole - no cap, no partial deduction, no negative balance -
 * enforced in LoyaltyService.manualAdjust under the account row lock.
 */
describe('Loyalty staff lookup (D-1) and non-negative manual adjustment (D-3)', () => {
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

  async function financeStaff() {
    await grantPermissions('FINANCE', ['loyalty:adjust']);
    return createAuthenticatedStaff(app, ['FINANCE']);
  }

  const lookup = (mobile: string, token?: string) =>
    app.inject({
      method: 'GET',
      url: `/api/v1/loyalty/customers/lookup?mobile=${encodeURIComponent(mobile)}`,
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });

  const adjust = (token: string, customerId: string, pointsDelta: number, idempotencyKey: string) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/loyalty/adjust',
      headers: { authorization: `Bearer ${token}` },
      payload: { customerId, pointsDelta, reason: 'Manual correction', idempotencyKey },
    });

  async function balanceOf(customerId: string) {
    return (await testPrisma.loyaltyAccount.findUnique({ where: { customerId } }))?.balance ?? 0;
  }

  async function customerWithBalance(token: string, points: number) {
    const { customerId } = await createAuthenticatedCustomer(app, { fullName: 'Asha Lookup' });
    if (points > 0) expect((await adjust(token, customerId, points, `seed-${customerId}`)).statusCode).toBe(200);
    const customer = await testPrisma.customer.findUniqueOrThrow({ where: { id: customerId } });
    return { customerId, mobile: customer.mobile };
  }

  // ----------------------------------------------------------------- D-1

  describe('D-1 restricted customer lookup', () => {
    it('rejects an unauthenticated request (401)', async () => {
      expect((await lookup('9100000001')).statusCode).toBe(401);
    });

    it('rejects staff without loyalty:adjust (403) and records authz.denied', async () => {
      await grantPermissions('MARKETING', ['cms:read']);
      const { token, staffUserId } = await createAuthenticatedStaff(app, ['MARKETING']);
      const res = await lookup('9100000001', token);
      expect(res.statusCode).toBe(403);
      expect(res.json().error.message).toContain('loyalty:adjust');
      const denial = await testPrisma.auditLog.findFirst({ where: { action: 'authz.denied', actorStaffId: staffUserId, entityId: 'loyalty:adjust' } });
      expect(denial).not.toBeNull();
    });

    it('customer_service:manage alone does not open it (the lookup is for loyalty adjustment only)', async () => {
      await grantPermissions('CUSTOMER_SERVICE', ['customer_service:manage']);
      const { token } = await createAuthenticatedStaff(app, ['CUSTOMER_SERVICE']);
      expect((await lookup('9100000001', token)).statusCode).toBe(403);
    });

    it('lets Finance find a customer by exact mobile with identity and loyalty balance only', async () => {
      const { token } = await financeStaff();
      const { customerId, mobile } = await customerWithBalance(token, 250);
      await testPrisma.customer.update({ where: { id: customerId }, data: { email: 'asha.private@example.com' } });
      await testPrisma.customerAddress.create({
        data: { customerId, recipientName: 'Asha', recipientMobile: mobile, line1: '12 Secret Lane', city: 'Pune', state: 'Maharashtra', stateCode: 'MH', pincode: '411001', isDefault: true },
      });

      const res = await lookup(mobile, token);
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Object.keys(body).sort()).toEqual(['fullName', 'id', 'loyalty', 'maskedMobile']);
      expect(Object.keys(body.loyalty).sort()).toEqual(['availablePoints', 'pendingPoints', 'tierName']);
      expect(body).toMatchObject({ id: customerId, fullName: 'Asha Lookup', maskedMobile: `${'*'.repeat(mobile.length - 4)}${mobile.slice(-4)}`, loyalty: { availablePoints: 250, pendingPoints: 0 } });

      const serialized = JSON.stringify(body);
      for (const forbidden of [mobile, 'asha.private@example.com', '12 Secret Lane', '411001', 'passwordHash', 'mfaSecret', 'codeHash', 'tokenHash', 'orders', 'addresses']) {
        expect(serialized).not.toContain(forbidden);
      }
    });

    it('returns 404 for an unknown mobile and never lists customers (no partial or wildcard match)', async () => {
      const { token } = await financeStaff();
      const { mobile } = await customerWithBalance(token, 0);
      expect((await lookup('9999999999', token)).statusCode).toBe(404);
      // Exact lookup only: a mobile one digit away from a real one finds nothing.
      expect((await lookup(`${mobile.slice(0, -1)}${mobile.endsWith('0') ? '1' : '0'}`, token)).statusCode).toBe(404);
    });

    it('rejects malformed, partial, wildcard and hostile input with 400 before touching the database', async () => {
      const { token } = await financeStaff();
      for (const bad of ['', '   ', '98', '%', '9%', '_________', "98' OR '1'='1", '<script>', '98765\u000043210', 'x'.repeat(200), '+91-98765-43210']) {
        const res = await lookup(bad, token);
        expect(res.statusCode, JSON.stringify(bad)).toBe(400);
      }
    });

    it('cannot be used to open Customer 360: the 360 route still requires customer_service:manage', async () => {
      const { token } = await financeStaff();
      const { customerId, mobile } = await customerWithBalance(token, 0);
      expect((await lookup(mobile, token)).statusCode).toBe(200);
      const res360 = await app.inject({ method: 'GET', url: `/api/v1/support/customers/${customerId}/360`, headers: { authorization: `Bearer ${token}` } });
      expect(res360.statusCode).toBe(403);
      const supportLookup = await app.inject({ method: 'GET', url: `/api/v1/support/customers/lookup?mobile=${mobile}`, headers: { authorization: `Bearer ${token}` } });
      expect(supportLookup.statusCode).toBe(403);
    });

    it('the seeded FINANCE role holds loyalty:adjust and still does not hold customer_service:manage', () => {
      const seed = readFileSync(fileURLToPath(new URL('../../../../packages/db/prisma/seed.ts', import.meta.url)), 'utf8');
      const finance = /\n\s+FINANCE: \[([\s\S]*?)\n\s+\],/.exec(seed)?.[1];
      expect(finance).toBeDefined();
      expect(finance).toContain("'loyalty:adjust'");
      expect(finance).not.toContain('customer_service:manage');
    });
  });

  // ----------------------------------------------------------------- D-3

  describe('D-3 manual adjustment never takes the balance below zero', () => {
    it('positive adjustments still apply', async () => {
      const { token } = await financeStaff();
      const { customerId } = await customerWithBalance(token, 0);
      expect((await adjust(token, customerId, 40, 'pos-1')).statusCode).toBe(200);
      expect(await balanceOf(customerId)).toBe(40);
    });

    it('a deduction smaller than the balance applies (100 - 80 = 20)', async () => {
      const { token } = await financeStaff();
      const { customerId } = await customerWithBalance(token, 100);
      expect((await adjust(token, customerId, -80, 'd-80')).statusCode).toBe(200);
      expect(await balanceOf(customerId)).toBe(20);
    });

    it('a deduction equal to the balance applies and leaves exactly zero (100 - 100 = 0)', async () => {
      const { token } = await financeStaff();
      const { customerId } = await customerWithBalance(token, 100);
      expect((await adjust(token, customerId, -100, 'd-100')).statusCode).toBe(200);
      expect(await balanceOf(customerId)).toBe(0);
    });

    it('a deduction larger than the balance is rejected whole: 409, balance unchanged, no ledger entry, no success audit', async () => {
      const { token } = await financeStaff();
      const { customerId } = await customerWithBalance(token, 100);
      const account = await testPrisma.loyaltyAccount.findUniqueOrThrow({ where: { customerId } });
      const entriesBefore = await testPrisma.loyaltyLedgerEntry.count({ where: { accountId: account.id } });
      const auditsBefore = await testPrisma.auditLog.count({ where: { action: 'loyalty.adjust', entityId: account.id } });

      const res = await adjust(token, customerId, -101, 'd-101');
      expect(res.statusCode).toBe(409);
      expect(res.json().error.message).toMatch(/below zero/i);

      const after = await testPrisma.loyaltyAccount.findUniqueOrThrow({ where: { customerId } });
      expect(after.balance).toBe(100);
      expect(after.lifetimeEarnedPoints).toBe(account.lifetimeEarnedPoints);
      expect(await testPrisma.loyaltyLedgerEntry.count({ where: { accountId: account.id } })).toBe(entriesBefore);
      expect(await testPrisma.loyaltyLedgerEntry.findUnique({ where: { idempotencyKey: 'd-101' } })).toBeNull();
      expect(await testPrisma.auditLog.count({ where: { action: 'loyalty.adjust', entityId: account.id } })).toBe(auditsBefore);
    });

    it('any deduction from a zero balance, including a customer with no loyalty account yet, is rejected', async () => {
      const { token } = await financeStaff();
      const { customerId } = await customerWithBalance(token, 0);
      const res = await adjust(token, customerId, -1, 'd-zero');
      expect(res.statusCode).toBe(409);
      expect(await balanceOf(customerId)).toBe(0);
      expect(await testPrisma.loyaltyLedgerEntry.count({ where: { idempotencyKey: 'd-zero' } })).toBe(0);
    });

    it('malformed adjustments are rejected with 400 and change nothing', async () => {
      const { token } = await financeStaff();
      const { customerId } = await customerWithBalance(token, 100);
      for (const pointsDelta of [0, 1.5, '10', null]) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/loyalty/adjust',
          headers: { authorization: `Bearer ${token}` },
          payload: { customerId, pointsDelta, reason: 'x', idempotencyKey: `bad-${String(pointsDelta)}` },
        });
        expect(res.statusCode, String(pointsDelta)).toBe(400);
      }
      expect(await balanceOf(customerId)).toBe(100);
    });

    it('a staff member without loyalty:adjust still cannot adjust', async () => {
      const { token } = await financeStaff();
      const { customerId } = await customerWithBalance(token, 100);
      await grantPermissions('CUSTOMER_SERVICE', ['customer_service:manage']);
      const cs = await createAuthenticatedStaff(app, ['CUSTOMER_SERVICE']);
      expect((await adjust(cs.token, customerId, -10, 'cs-1')).statusCode).toBe(403);
      expect(await balanceOf(customerId)).toBe(100);
    });

    it('retrying a successful deduction with the same idempotency key does not apply it twice', async () => {
      const { token } = await financeStaff();
      const { customerId } = await customerWithBalance(token, 100);
      const first = await adjust(token, customerId, -60, 'retry-60');
      const second = await adjust(token, customerId, -60, 'retry-60');
      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      expect(second.json().id).toBe(first.json().id);
      expect(await balanceOf(customerId)).toBe(40);
    });

    it('two concurrent deductions that each fit but together exceed the balance cannot both succeed', async () => {
      const { token } = await financeStaff();
      const { customerId } = await customerWithBalance(token, 100);
      const results = await Promise.all([adjust(token, customerId, -80, 'race-a'), adjust(token, customerId, -80, 'race-b')]);
      const codes = results.map((r) => r.statusCode).sort();
      expect(codes).toEqual([200, 409]);
      expect(await balanceOf(customerId)).toBe(20);
      const account = await testPrisma.loyaltyAccount.findUniqueOrThrow({ where: { customerId } });
      expect(await testPrisma.loyaltyLedgerEntry.count({ where: { accountId: account.id, type: 'ADJUST', pointsDelta: -80 } })).toBe(1);
    });

    it('a burst of concurrent deductions never drives the balance below zero', async () => {
      const { token } = await financeStaff();
      const { customerId } = await customerWithBalance(token, 100);
      const results = await Promise.all(Array.from({ length: 8 }, (_, i) => adjust(token, customerId, -30, `burst-${i}`)));
      const ok = results.filter((r) => r.statusCode === 200).length;
      expect(results.every((r) => r.statusCode === 200 || r.statusCode === 409)).toBe(true);
      expect(ok).toBe(3); // 100 -> 70 -> 40 -> 10; a fourth would go negative
      expect(await balanceOf(customerId)).toBe(10);
    });

    it('the lookup reports the balance the domain enforces, and a rejected deduction leaves it unchanged', async () => {
      const { token } = await financeStaff();
      const { customerId, mobile } = await customerWithBalance(token, 30);
      expect((await adjust(token, customerId, -31, 'over-31')).statusCode).toBe(409);
      expect((await lookup(mobile, token)).json().loyalty.availablePoints).toBe(30);
    });
  });
});
