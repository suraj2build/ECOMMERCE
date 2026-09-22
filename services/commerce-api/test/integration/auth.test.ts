import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { authenticator } from 'otplib';
import { createTestApp } from '../helpers/app.js';
import { resetDatabase, seedRbac, testPrisma } from '../helpers/db.js';
import { hashPassword } from '@fcp/shared';

describe('Staff auth: password + MFA (AUTH-002)', () => {
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

  async function createStaff(roleKey: string, email: string) {
    const staffUser = await testPrisma.staffUser.create({
      data: { email, passwordHash: await hashPassword('CorrectPassword123!'), fullName: 'Test', isActive: true },
    });
    const role = await testPrisma.role.findUniqueOrThrow({ where: { key: roleKey } });
    await testPrisma.staffUserRole.create({ data: { staffUserId: staffUser.id, roleId: role.id } });
    return staffUser;
  }

  it('allows a non-MFA-required role to log in with just a password', async () => {
    await createStaff('CATALOG', 'catalog-user@example.com');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/staff/login',
      payload: { email: 'catalog-user@example.com', password: 'CorrectPassword123!' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().token).toBeTruthy();
  });

  it('allows an MFA-required role to bootstrap: first login succeeds pre-enrollment so it can reach /mfa/enroll', async () => {
    await createStaff('SUPER_ADMIN', 'bootstrap-admin@example.com');
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/staff/login',
      payload: { email: 'bootstrap-admin@example.com', password: 'CorrectPassword123!' },
    });
    expect(loginRes.statusCode).toBe(200);
    const bootstrapToken = loginRes.json().token as string;

    const enrollRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/staff/mfa/enroll',
      headers: { authorization: `Bearer ${bootstrapToken}` },
    });
    expect(enrollRes.statusCode).toBe(200);
    const { otpAuthUrl } = enrollRes.json();
    const secret = new URL(otpAuthUrl.replace('otpauth://totp/', 'http://x/')).searchParams.get('secret')!;

    const confirmRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/staff/mfa/confirm',
      headers: { authorization: `Bearer ${bootstrapToken}` },
      payload: { code: authenticator.generate(secret) },
    });
    expect(confirmRes.statusCode).toBe(200);
    expect(confirmRes.json().mfaEnabled).toBe(true);

    // Once confirmed, MFA cannot be bypassed: password alone is rejected...
    const noMfaLoginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/staff/login',
      payload: { email: 'bootstrap-admin@example.com', password: 'CorrectPassword123!' },
    });
    expect(noMfaLoginRes.statusCode).toBe(401);
    expect(noMfaLoginRes.json().error.code).toBe('MFA_REQUIRED');

    // ...but the correct password + valid TOTP code succeeds.
    const mfaLoginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/staff/login',
      payload: {
        email: 'bootstrap-admin@example.com',
        password: 'CorrectPassword123!',
        mfaCode: authenticator.generate(secret),
      },
    });
    expect(mfaLoginRes.statusCode).toBe(200);
    expect(mfaLoginRes.json().token).toBeTruthy();
  });

  it('rejects login with the wrong password regardless of role', async () => {
    await createStaff('CATALOG', 'wrong-pw@example.com');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/staff/login',
      payload: { email: 'wrong-pw@example.com', password: 'TotallyWrongPassword' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('revokes a session immediately on logout', async () => {
    await createStaff('CATALOG', 'logout-user@example.com');
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/staff/login',
      payload: { email: 'logout-user@example.com', password: 'CorrectPassword123!' },
    });
    const token = loginRes.json().token as string;

    const meBefore = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/staff/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(meBefore.statusCode).toBe(200);

    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/staff/logout',
      headers: { authorization: `Bearer ${token}` },
    });

    const meAfter = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/staff/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(meAfter.statusCode).toBe(401);
  });
});
