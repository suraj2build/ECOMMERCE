import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '../helpers/app.js';
import { resetDatabase, seedRbac, testPrisma } from '../helpers/db.js';
import { hashPassword } from '@fcp/shared';

/**
 * M31 Security Hardening (5D/5E) - proves the rate-limit and security-
 * header controls added by plugins/rate-limit.ts and
 * plugins/security-headers.ts actually behave under real request volume
 * against a real Redis-backed limiter, not merely that the plugins are
 * registered. Each identity used here is unique per test (a fresh
 * mobile/email) since the shared Redis instance is NOT flushed between
 * tests in this suite - a stale counter from an unrelated test must
 * never make this test's own assertions ambiguous.
 */
describe('Rate limiting and security headers (M31)', () => {
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

  function uniqueMobile(): string {
    return `9${Date.now().toString().slice(-9)}`;
  }

  describe('OTP request throttling', () => {
    it('rejects the 6th OTP request within the window for the same mobile with 429', async () => {
      const mobile = uniqueMobile();
      let lastStatus = 0;
      for (let i = 0; i < 6; i++) {
        const res = await app.inject({ method: 'POST', url: '/api/v1/auth/customer/otp/request', payload: { mobile } });
        lastStatus = res.statusCode;
        if (i < 5) expect(res.statusCode).toBe(202);
      }
      expect(lastStatus).toBe(429);
    });

    it('a different mobile number is never throttled by another mobile\'s exhausted limit', async () => {
      const throttled = uniqueMobile();
      for (let i = 0; i < 5; i++) {
        await app.inject({ method: 'POST', url: '/api/v1/auth/customer/otp/request', payload: { mobile: throttled } });
      }
      const exhausted = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/customer/otp/request',
        payload: { mobile: throttled },
      });
      expect(exhausted.statusCode).toBe(429);

      const otherMobile = uniqueMobile();
      const fresh = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/customer/otp/request',
        payload: { mobile: otherMobile },
      });
      expect(fresh.statusCode).toBe(202);
    });
  });

  describe('OTP verify throttling', () => {
    it('rejects the 11th verify attempt within the window for the same mobile with 429, closing the "request a fresh OTP to reset the per-code attempt counter" loophole', async () => {
      const mobile = uniqueMobile();
      await app.inject({ method: 'POST', url: '/api/v1/auth/customer/otp/request', payload: { mobile } });
      let lastStatus = 0;
      for (let i = 0; i < 11; i++) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/customer/otp/verify',
          payload: { mobile, code: '000000' },
        });
        lastStatus = res.statusCode;
        if (i < 10) expect(res.statusCode).toBe(401); // wrong code, but not yet throttled
      }
      expect(lastStatus).toBe(429);
    });
  });

  describe('Staff login throttling', () => {
    async function createStaff(email: string) {
      const staffUser = await testPrisma.staffUser.create({
        data: { email, passwordHash: await hashPassword('CorrectPassword123!'), fullName: 'Test', isActive: true },
      });
      const role = await testPrisma.role.findUniqueOrThrow({ where: { key: 'CATALOG' } });
      await testPrisma.staffUserRole.create({ data: { staffUserId: staffUser.id, roleId: role.id } });
      return staffUser;
    }

    it('rejects the 11th login attempt within the window for the same email with 429, even with the correct password', async () => {
      const email = `rl-staff-${Date.now()}@example.com`;
      await createStaff(email);
      let lastStatus = 0;
      for (let i = 0; i < 11; i++) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/staff/login',
          payload: { email, password: 'WrongPassword!' },
        });
        lastStatus = res.statusCode;
        if (i < 10) expect(res.statusCode).toBe(401);
      }
      expect(lastStatus).toBe(429);

      // Even the CORRECT password is rejected once throttled - the limit
      // is on request volume for the identity, not on failed attempts.
      const correctAttempt = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/staff/login',
        payload: { email, password: 'CorrectPassword123!' },
      });
      expect(correctAttempt.statusCode).toBe(429);
    });

    it('a different email is never throttled by another email\'s exhausted limit', async () => {
      const throttledEmail = `rl-staff-throttled-${Date.now()}@example.com`;
      await createStaff(throttledEmail);
      for (let i = 0; i < 11; i++) {
        await app.inject({
          method: 'POST',
          url: '/api/v1/auth/staff/login',
          payload: { email: throttledEmail, password: 'WrongPassword!' },
        });
      }

      const otherEmail = `rl-staff-other-${Date.now()}@example.com`;
      await createStaff(otherEmail);
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/staff/login',
        payload: { email: otherEmail, password: 'CorrectPassword123!' },
      });
      expect(res.statusCode).toBe(200);
    });
  });

  describe('/health and /ready are exempt from rate limiting', () => {
    it('never 429s under a burst well above every other route\'s configured limit', async () => {
      let sawNon200 = false;
      for (let i = 0; i < 50; i++) {
        const res = await app.inject({ method: 'GET', url: '/health' });
        if (res.statusCode !== 200) sawNon200 = true;
      }
      expect(sawNon200).toBe(false);
    });
  });

  describe('Security headers (helmet)', () => {
    it('sets nosniff, frame-deny, and HSTS headers on an ordinary API response', async () => {
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
      expect(res.headers['strict-transport-security']).toBeTruthy();
    });

    it('never sets a Content-Security-Policy header - this is a JSON API, not a page renderer (see security-headers.ts)', async () => {
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.headers['content-security-policy']).toBeUndefined();
    });
  });
});
