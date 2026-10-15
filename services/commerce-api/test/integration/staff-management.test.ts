import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '../helpers/app.js';
import { resetDatabase, seedRbac, grantPermissions, testPrisma } from '../helpers/db.js';
import { createAuthenticatedStaff } from '../helpers/auth.js';

/**
 * Staff management (AO-D7, Product Owner 2026-10-06): "Build staff
 * management with temporary passwords shown once and mandatory password
 * change before further access. Revoke sessions after password reset,
 * deactivation or role changes. Protect the last Super Admin and
 * configured owner."
 */
describe('Staff management (AO-D7)', () => {
  let app: FastifyInstance;
  let admin: { staffUserId: string; token: string };
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
    await grantPermissions('SUPER_ADMIN', ['rbac:manage', 'order:read']);
    await grantPermissions('WAREHOUSE_MANAGER', ['order:read']);
    admin = await createAuthenticatedStaff(app, ['SUPER_ADMIN']);
  });

  const createStaff = (payload: Record<string, unknown>, t = admin.token) => app.inject({ method: 'POST', url: '/api/v1/staff', headers: auth(t), payload });
  const login = (email: string, password: string) => app.inject({ method: 'POST', url: '/api/v1/auth/staff/login', payload: { email, password } });
  const me = (t: string) => app.inject({ method: 'GET', url: '/api/v1/auth/staff/me', headers: auth(t) });
  const anyRoute = (t: string) => app.inject({ method: 'GET', url: '/api/v1/admin/orders', headers: auth(t) });
  const changePassword = (t: string, currentPassword: string, newPassword: string) =>
    app.inject({ method: 'POST', url: '/api/v1/auth/staff/password', headers: auth(t), payload: { currentPassword, newPassword } });

  async function newPerson(roleKeys = ['WAREHOUSE_MANAGER'], email = `person-${Math.random().toString(36).slice(2, 8)}@example.com`) {
    const res = await createStaff({ email, fullName: 'Ravi Kumar', roleKeys });
    expect(res.statusCode, res.body).toBe(201);
    return { ...(res.json() as { id: string; email: string; temporaryPassword: string }), email };
  }
  async function signedIn(roleKeys = ['WAREHOUSE_MANAGER']) {
    const p = await newPerson(roleKeys);
    const first = (await login(p.email, p.temporaryPassword)).json().token as string;
    const changed = await changePassword(first, p.temporaryPassword, 'Godown2026Secure');
    expect(changed.statusCode, changed.body).toBe(200);
    return { ...p, password: 'Godown2026Secure', token: changed.json().token as string };
  }

  it('adds a person with a temporary password shown once, never stored or audited in plain text', async () => {
    const p = await newPerson(['WAREHOUSE_MANAGER'], 'Ravi@Example.com');
    expect(p.temporaryPassword).toMatch(/^[A-Za-z2-9]{16}$/);
    const row = await testPrisma.staffUser.findUniqueOrThrow({ where: { id: p.id } });
    expect(row).toMatchObject({ email: 'ravi@example.com', mustChangePassword: true, isActive: true });
    expect(row.passwordHash).not.toContain(p.temporaryPassword);
    const audit = await testPrisma.auditLog.findFirstOrThrow({ where: { action: 'staff_user.create', entityId: p.id } });
    expect(JSON.stringify(audit)).not.toContain(p.temporaryPassword);
    expect(audit.actorStaffId).toBe(admin.staffUserId);

    // The list never includes it either, and shows roles, state and owner flag.
    const list = (await app.inject({ method: 'GET', url: '/api/v1/staff', headers: auth(admin.token) })).json();
    expect(JSON.stringify(list)).not.toContain(p.temporaryPassword);
    expect(list).toEqual(expect.arrayContaining([expect.objectContaining({ id: p.id, roles: ['WAREHOUSE_MANAGER'], mustChangePassword: true, isActive: true, isApprovalOwner: false, lastSignInAt: null })]));

    // Duplicate email (any case), unknown role, no role.
    expect((await createStaff({ email: 'RAVI@example.com', fullName: 'X', roleKeys: ['WAREHOUSE_MANAGER'] })).statusCode).toBe(409);
    expect((await createStaff({ email: 'x@example.com', fullName: 'X', roleKeys: ['NOT_A_ROLE'] })).statusCode).toBe(400);
    expect((await createStaff({ email: 'y@example.com', fullName: 'X', roleKeys: [] })).statusCode).toBe(400);
  });

  it('needs rbac:manage for every staff route', async () => {
    const manager = await createAuthenticatedStaff(app, ['WAREHOUSE_MANAGER']);
    const target = await newPerson();
    for (const [method, url, payload] of [
      ['GET', '/api/v1/staff', undefined],
      ['GET', '/api/v1/staff/roles', undefined],
      ['POST', '/api/v1/staff', { email: 'z@example.com', fullName: 'Z', roleKeys: ['WAREHOUSE_MANAGER'] }],
      ['PUT', `/api/v1/staff/${target.id}/roles`, { roleKeys: ['SUPER_ADMIN'] }],
      ['POST', `/api/v1/staff/${target.id}/deactivate`, undefined],
      ['POST', `/api/v1/staff/${target.id}/reset-password`, undefined],
    ] as const) {
      const res = await app.inject({ method, url, headers: auth(manager.token), ...(payload ? { payload } : {}) });
      expect(res.statusCode, `${method} ${url}`).toBe(403);
    }
    expect((await app.inject({ method: 'GET', url: '/api/v1/staff' })).statusCode).toBe(401);
  });

  it('a temporary password allows nothing but choosing a new one; the change ends the old session and issues a new one', async () => {
    const p = await newPerson();
    const res = await login(p.email, p.temporaryPassword);
    expect(res.statusCode).toBe(200);
    expect(res.json().mustChangePassword).toBe(true);
    const temp = res.json().token as string;

    expect((await me(temp)).json()).toMatchObject({ id: p.id, mustChangePassword: true });
    const blocked = await anyRoute(temp);
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe('PASSWORD_CHANGE_REQUIRED');

    // A weak, unchanged or wrongly-confirmed password is refused and changes nothing.
    expect((await changePassword(temp, 'wrong-current-pass', 'Godown2026Secure')).statusCode).toBe(400);
    expect((await changePassword(temp, p.temporaryPassword, 'short1')).statusCode).toBe(400);
    expect((await changePassword(temp, p.temporaryPassword, 'onlyletterslong')).statusCode).toBe(400);
    expect((await changePassword(temp, p.temporaryPassword, p.temporaryPassword)).statusCode).toBe(400);
    expect((await testPrisma.staffUser.findUniqueOrThrow({ where: { id: p.id } })).mustChangePassword).toBe(true);

    const changed = await changePassword(temp, p.temporaryPassword, 'Godown2026Secure');
    expect(changed.statusCode, changed.body).toBe(200);
    const fresh = changed.json().token as string;
    // The temporary session is over; the new one works normally.
    expect((await me(temp)).statusCode).toBe(401);
    expect((await anyRoute(fresh)).statusCode).toBe(200);
    expect((await me(fresh)).json().mustChangePassword).toBe(false);
    // The temporary password no longer signs in; the new one does, with no forced change.
    expect((await login(p.email, p.temporaryPassword)).statusCode).toBe(401);
    expect((await login(p.email, 'Godown2026Secure')).json().mustChangePassword).toBe(false);
    const audit = await testPrisma.auditLog.findFirstOrThrow({ where: { action: 'staff_user.password_change', entityId: p.id } });
    expect(JSON.stringify(audit)).not.toContain('Godown2026Secure');
  });

  it('a password reset shows a new temporary password once, ends every session and requires a change again', async () => {
    const p = await signedIn();
    const otherBrowser = (await login(p.email, p.password)).json().token as string;
    expect((await anyRoute(p.token)).statusCode).toBe(200);

    const reset = await app.inject({ method: 'POST', url: `/api/v1/staff/${p.id}/reset-password`, headers: auth(admin.token) });
    expect(reset.statusCode, reset.body).toBe(200);
    const temp = reset.json().temporaryPassword as string;
    expect(temp).toMatch(/^[A-Za-z2-9]{16}$/);
    for (const t of [p.token, otherBrowser]) expect((await me(t)).statusCode).toBe(401);
    expect((await login(p.email, p.password)).statusCode).toBe(401);
    const again = await login(p.email, temp);
    expect(again.json().mustChangePassword).toBe(true);
    expect((await anyRoute(again.json().token)).statusCode).toBe(403);
    const audit = await testPrisma.auditLog.findFirstOrThrow({ where: { action: 'staff_user.password_reset', entityId: p.id } });
    expect(JSON.stringify(audit)).not.toContain(temp);
    // You do not reset your own password here.
    expect((await app.inject({ method: 'POST', url: `/api/v1/staff/${admin.staffUserId}/reset-password`, headers: auth(admin.token) })).statusCode).toBe(400);
  });

  it('a session survives in Redis but is still refused after a reset (the database cut-off decides)', async () => {
    const p = await signedIn();
    // Simulate a Redis key that could not be deleted.
    const store = app.staffSessionStore;
    const original = store.revokeAllForUser.bind(store);
    store.revokeAllForUser = async () => {
      throw new Error('redis unavailable');
    };
    try {
      expect((await app.inject({ method: 'POST', url: `/api/v1/staff/${p.id}/reset-password`, headers: auth(admin.token) })).statusCode).toBe(200);
    } finally {
      store.revokeAllForUser = original;
    }
    expect(await store.resolve(p.token)).not.toBeNull();
    expect((await me(p.token)).statusCode).toBe(401);
  });

  it('deactivation ends sessions and blocks sign-in; reactivation allows it again', async () => {
    const p = await signedIn();
    const off = await app.inject({ method: 'POST', url: `/api/v1/staff/${p.id}/deactivate`, headers: auth(admin.token) });
    expect(off.statusCode, off.body).toBe(200);
    expect(off.json()).toMatchObject({ isActive: false });
    expect((await me(p.token)).statusCode).toBe(401);
    expect((await login(p.email, p.password)).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: `/api/v1/staff/${p.id}/reset-password`, headers: auth(admin.token) })).statusCode).toBe(400);

    expect((await app.inject({ method: 'POST', url: `/api/v1/staff/${p.id}/reactivate`, headers: auth(admin.token) })).json()).toMatchObject({ isActive: true });
    expect((await login(p.email, p.password)).statusCode).toBe(200);
    expect(await testPrisma.auditLog.count({ where: { entityId: p.id, action: { in: ['staff_user.deactivate', 'staff_user.reactivate'] } } })).toBe(2);
  });

  it('a role change takes effect at once and ends the person\'s sessions', async () => {
    const p = await signedIn();
    expect((await anyRoute(p.token)).statusCode).toBe(200);
    const changed = await app.inject({ method: 'PUT', url: `/api/v1/staff/${p.id}/roles`, headers: auth(admin.token), payload: { roleKeys: ['MARKETING'] } });
    expect(changed.statusCode, changed.body).toBe(200);
    expect(changed.json().roles).toEqual(['MARKETING']);
    expect((await me(p.token)).statusCode).toBe(401);
    const back = (await login(p.email, p.password)).json().token as string;
    expect((await me(back)).json().roles).toEqual(['MARKETING']);
    expect((await anyRoute(back)).statusCode).toBe(403);
    const audit = await testPrisma.auditLog.findFirstOrThrow({ where: { action: 'staff_user.roles', entityId: p.id } });
    expect(audit.oldValue).toMatchObject({ roles: ['WAREHOUSE_MANAGER'] });
    expect(audit.newValue).toMatchObject({ roles: ['MARKETING'] });
    // Nobody changes their own roles.
    expect((await app.inject({ method: 'PUT', url: `/api/v1/staff/${admin.staffUserId}/roles`, headers: auth(admin.token), payload: { roleKeys: ['MARKETING'] } })).statusCode).toBe(400);
  });

  it('the last active Super Admin cannot be deactivated or lose the role; with a second one it can', async () => {
    const second = await signedIn(['SUPER_ADMIN']);
    // Two Super Admins: one may deactivate the other.
    expect((await app.inject({ method: 'POST', url: `/api/v1/staff/${admin.staffUserId}/deactivate`, headers: auth(second.token) })).statusCode).toBe(200);
    // Nobody deactivates themselves.
    expect((await app.inject({ method: 'POST', url: `/api/v1/staff/${second.id}/deactivate`, headers: auth(second.token) })).statusCode).toBe(400);

    // Someone else with rbac:manage cannot remove the last one, either way.
    await grantPermissions('WAREHOUSE_MANAGER', ['rbac:manage']);
    const helper = await createAuthenticatedStaff(app, ['WAREHOUSE_MANAGER']);
    const off = await app.inject({ method: 'POST', url: `/api/v1/staff/${second.id}/deactivate`, headers: auth(helper.token) });
    expect(off.statusCode).toBe(400);
    expect(off.json().error.message).toMatch(/only active Super Admin/);
    const demote = await app.inject({ method: 'PUT', url: `/api/v1/staff/${second.id}/roles`, headers: auth(helper.token), payload: { roleKeys: ['WAREHOUSE_MANAGER'] } });
    expect(demote.statusCode).toBe(400);
    expect(demote.json().error.message).toMatch(/only active Super Admin/);
    expect((await me(second.token)).statusCode).toBe(200);

    // Once another Super Admin is active again, it is allowed.
    expect((await app.inject({ method: 'POST', url: `/api/v1/staff/${admin.staffUserId}/reactivate`, headers: auth(helper.token) })).statusCode).toBe(200);
    expect((await app.inject({ method: 'PUT', url: `/api/v1/staff/${second.id}/roles`, headers: auth(helper.token), payload: { roleKeys: ['WAREHOUSE_MANAGER'] } })).statusCode).toBe(200);
  });

  it('refuses to leave no active Super Admin, even when two administrators act on each other at the same moment', async () => {
    const other = await signedIn(['SUPER_ADMIN']);
    expect(await testPrisma.staffUser.count({ where: { isActive: true, roles: { some: { role: { key: 'SUPER_ADMIN' } } } } })).toBe(2);
    const [a, b] = await Promise.all([
      app.inject({ method: 'POST', url: `/api/v1/staff/${other.id}/deactivate`, headers: auth(admin.token) }),
      app.inject({ method: 'POST', url: `/api/v1/staff/${admin.staffUserId}/deactivate`, headers: auth(other.token) }),
    ]);
    const codes = [a.statusCode, b.statusCode].sort();
    // One wins. The other is refused: either because it is now the last
    // Super Admin, or because its own session ended with the deactivation.
    expect(codes[0]).toBe(200);
    expect([400, 401]).toContain(codes[1]);
    expect(await testPrisma.staffUser.count({ where: { isActive: true, roles: { some: { role: { key: 'SUPER_ADMIN' } } } } })).toBe(1);

  });

  it('a configured approval owner cannot be deactivated or have their roles changed until removed as an owner', async () => {
    const owner = await signedIn(['WAREHOUSE_MANAGER']);
    await testPrisma.approvalOwner.create({ data: { staffUserId: owner.id, addedByStaffId: admin.staffUserId } });
    const list = (await app.inject({ method: 'GET', url: '/api/v1/staff', headers: auth(admin.token) })).json();
    expect(list.find((s: { id: string }) => s.id === owner.id)).toMatchObject({ isApprovalOwner: true });

    const off = await app.inject({ method: 'POST', url: `/api/v1/staff/${owner.id}/deactivate`, headers: auth(admin.token) });
    expect(off.statusCode).toBe(400);
    expect(off.json().error.message).toMatch(/approval owner/);
    const roles = await app.inject({ method: 'PUT', url: `/api/v1/staff/${owner.id}/roles`, headers: auth(admin.token), payload: { roleKeys: ['MARKETING'] } });
    expect(roles.statusCode).toBe(400);
    expect((await testPrisma.staffUser.findUniqueOrThrow({ where: { id: owner.id } })).isActive).toBe(true);
    expect((await me(owner.token)).statusCode).toBe(200);

    await testPrisma.approvalOwner.delete({ where: { staffUserId: owner.id } });
    expect((await app.inject({ method: 'POST', url: `/api/v1/staff/${owner.id}/deactivate`, headers: auth(admin.token) })).statusCode).toBe(200);
  });

  it('the older create-staff route also marks an administrator-chosen password as temporary', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/staff/users',
      headers: auth(admin.token),
      payload: { email: 'legacy@example.com', password: 'ChosenByAdmin123', fullName: 'Legacy', roleKeys: ['WAREHOUSE_MANAGER'] },
    });
    expect(res.statusCode).toBe(201);
    const signIn = await login('legacy@example.com', 'ChosenByAdmin123');
    expect(signIn.json().mustChangePassword).toBe(true);
    expect((await anyRoute(signIn.json().token)).statusCode).toBe(403);
  });
});
