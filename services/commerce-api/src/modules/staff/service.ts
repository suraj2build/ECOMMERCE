import { randomInt } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@fcp/db';
import { ConflictError, NotFoundError, UnauthorizedError, ValidationError, hashPassword, verifyPassword } from '@fcp/shared';
import { recordAudit } from '../audit/service.js';

/**
 * Staff management (AO-D7, Product Owner 2026-10-06; docs/admin/STAFF.md).
 *
 * - New accounts and password resets get a random temporary password,
 *   shown to the administrator once and never stored or logged. The person
 *   must choose their own password before anything else is allowed
 *   (`mustChangePassword`, enforced by the auth plugin).
 * - A password reset, deactivation or role change ends every session of
 *   that person (`sessionsRevokedAt`, checked on every request, plus the
 *   Redis keys deleted). Changing your own password ends your other
 *   sessions and issues a new one.
 * - The last active Super Admin and the configured approval owners cannot
 *   be deactivated or lose their roles; nobody changes their own roles or
 *   deactivates themselves. These checks run under one advisory lock, so
 *   two administrators acting on each other at once cannot both pass them.
 */

export const MIN_PASSWORD_LENGTH = 12;
/** No 0/O, 1/l/I: the password is read off a screen and typed by someone else. */
const TEMP_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const TEMP_LENGTH = 16;
const STAFF_ADMIN_LOCK = 72_000_701;

export function temporaryPassword(): string {
  let out = '';
  for (let i = 0; i < TEMP_LENGTH; i++) out += TEMP_ALPHABET[randomInt(TEMP_ALPHABET.length)];
  return out;
}

export function checkNewPassword(password: string) {
  if (password.length < MIN_PASSWORD_LENGTH) throw new ValidationError(`Use at least ${MIN_PASSWORD_LENGTH} characters`);
  if (password.length > 200) throw new ValidationError('Use at most 200 characters');
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) throw new ValidationError('Use letters and at least one number');
}

type Tx = Prisma.TransactionClient;

export class StaffService {
  constructor(private readonly fastify: FastifyInstance) {}

  private get prisma() {
    return this.fastify.prisma;
  }

  async list() {
    const [staff, owners, lastSignIns] = await Promise.all([
      this.prisma.staffUser.findMany({
        orderBy: [{ isActive: 'desc' }, { fullName: 'asc' }],
        select: {
          id: true,
          email: true,
          fullName: true,
          isActive: true,
          mfaEnabled: true,
          mustChangePassword: true,
          createdAt: true,
          roles: { select: { role: { select: { key: true, name: true } } } },
        },
      }),
      this.prisma.approvalOwner.findMany({ select: { staffUserId: true } }),
      this.prisma.staffSession.groupBy({ by: ['staffUserId'], _max: { createdAt: true } }),
    ]);
    const ownerIds = new Set(owners.map((o) => o.staffUserId));
    const lastSignIn = new Map(lastSignIns.map((r) => [r.staffUserId, r._max.createdAt]));
    return staff.map((s) => ({
      id: s.id,
      email: s.email,
      fullName: s.fullName,
      isActive: s.isActive,
      mfaEnabled: s.mfaEnabled,
      mustChangePassword: s.mustChangePassword,
      createdAt: s.createdAt,
      lastSignInAt: lastSignIn.get(s.id) ?? null,
      isApprovalOwner: ownerIds.has(s.id),
      roles: s.roles.map((r) => r.role.key),
    }));
  }

  async roles() {
    return this.prisma.role.findMany({ orderBy: { name: 'asc' }, select: { key: true, name: true, description: true } });
  }

  private async rolesFor(tx: Tx, roleKeys: string[]) {
    const keys = [...new Set(roleKeys)];
    if (keys.length === 0) throw new ValidationError('Give the person at least one role');
    const roles = await tx.role.findMany({ where: { key: { in: keys } } });
    if (roles.length !== keys.length) throw new ValidationError('One or more roles do not exist');
    return roles;
  }

  /** Serialises every staff-administration change, so the last-administrator checks cannot race. */
  private lock(tx: Tx) {
    return tx.$executeRaw`SELECT pg_advisory_xact_lock(${STAFF_ADMIN_LOCK})`;
  }

  private async target(tx: Tx, id: string) {
    const user = await tx.staffUser.findUnique({ where: { id }, include: { roles: { include: { role: true } } } });
    if (!user) throw new NotFoundError('StaffUser', id);
    return user;
  }

  private async activeSuperAdmins(tx: Tx) {
    return tx.staffUser.count({ where: { isActive: true, roles: { some: { role: { key: 'SUPER_ADMIN' } } } } });
  }

  /** Ends every session of this person: refused from now on even if a Redis key survives. */
  private async endSessions(tx: Tx, staffUserId: string) {
    await tx.staffUser.update({ where: { id: staffUserId }, data: { sessionsRevokedAt: new Date() } });
    await tx.staffSession.updateMany({ where: { staffUserId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  private async dropRedisSessions(staffUserId: string) {
    try {
      await this.fastify.staffSessionStore.revokeAllForUser(staffUserId);
    } catch (err) {
      // The database cut-off already refuses these sessions.
      this.fastify.log.error({ err }, 'staff session key removal failed');
    }
  }

  async create(input: { email: string; fullName: string; roleKeys: string[] }, actorStaffId: string) {
    const email = input.email.trim().toLowerCase();
    const fullName = input.fullName.trim();
    if (!fullName) throw new ValidationError('Enter the person\'s name');
    const password = temporaryPassword();
    const passwordHash = await hashPassword(password);
    const user = await this.prisma.$transaction(async (tx) => {
      await this.lock(tx);
      if (await tx.staffUser.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } })) {
        throw new ConflictError('Someone already has a staff account with this email');
      }
      const roles = await this.rolesFor(tx, input.roleKeys);
      const created = await tx.staffUser.create({
        data: { email, fullName, passwordHash, mustChangePassword: true, roles: { create: roles.map((r) => ({ roleId: r.id })) } },
      });
      await recordAudit(tx, {
        actorType: 'STAFF',
        actorStaffId,
        action: 'staff_user.create',
        entityType: 'StaffUser',
        entityId: created.id,
        newValue: { email, roles: roles.map((r) => r.key), temporaryPassword: true },
      });
      return created;
    });
    return { id: user.id, email: user.email, temporaryPassword: password };
  }

  async setRoles(id: string, roleKeys: string[], actorStaffId: string) {
    if (id === actorStaffId) throw new ValidationError('You cannot change your own roles. Ask another administrator.');
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx);
      const user = await this.target(tx, id);
      const roles = await this.rolesFor(tx, roleKeys);
      const before = user.roles.map((r) => r.role.key).sort();
      const after = roles.map((r) => r.key).sort();
      if (before.join() === after.join()) return;
      if (await tx.approvalOwner.findUnique({ where: { staffUserId: id } })) {
        throw new ValidationError(`${user.fullName} is a configured approval owner. Remove them as an owner in Approvals before changing their roles.`);
      }
      if (user.isActive && before.includes('SUPER_ADMIN') && !after.includes('SUPER_ADMIN') && (await this.activeSuperAdmins(tx)) <= 1) {
        throw new ValidationError(`${user.fullName} is the only active Super Admin. Make someone else a Super Admin first.`);
      }
      await tx.staffUserRole.deleteMany({ where: { staffUserId: id } });
      await tx.staffUserRole.createMany({ data: roles.map((r) => ({ staffUserId: id, roleId: r.id })) });
      await this.endSessions(tx, id);
      await recordAudit(tx, {
        actorType: 'STAFF',
        actorStaffId,
        action: 'staff_user.roles',
        entityType: 'StaffUser',
        entityId: id,
        oldValue: { roles: before },
        newValue: { roles: after, sessionsEnded: true },
      });
    });
    await this.dropRedisSessions(id);
    return (await this.list()).find((s) => s.id === id)!;
  }

  async setActive(id: string, active: boolean, actorStaffId: string) {
    if (id === actorStaffId) throw new ValidationError(active ? 'You are already active.' : 'You cannot deactivate yourself. Ask another administrator.');
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx);
      const user = await this.target(tx, id);
      if (user.isActive === active) return;
      if (!active) {
        if (await tx.approvalOwner.findUnique({ where: { staffUserId: id } })) {
          throw new ValidationError(`${user.fullName} is a configured approval owner. Remove them as an owner in Approvals before deactivating them.`);
        }
        if (user.roles.some((r) => r.role.key === 'SUPER_ADMIN') && (await this.activeSuperAdmins(tx)) <= 1) {
          throw new ValidationError(`${user.fullName} is the only active Super Admin and cannot be deactivated.`);
        }
      }
      await tx.staffUser.update({ where: { id }, data: { isActive: active } });
      if (!active) await this.endSessions(tx, id);
      await recordAudit(tx, {
        actorType: 'STAFF',
        actorStaffId,
        action: active ? 'staff_user.reactivate' : 'staff_user.deactivate',
        entityType: 'StaffUser',
        entityId: id,
        newValue: { isActive: active, ...(active ? {} : { sessionsEnded: true }) },
      });
    });
    if (!active) await this.dropRedisSessions(id);
    return (await this.list()).find((s) => s.id === id)!;
  }

  async resetPassword(id: string, actorStaffId: string) {
    if (id === actorStaffId) throw new ValidationError('Change your own password from "Change password" instead.');
    const password = temporaryPassword();
    const passwordHash = await hashPassword(password);
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx);
      const user = await this.target(tx, id);
      if (!user.isActive) throw new ValidationError(`${user.fullName} is deactivated. Reactivate them first.`);
      await tx.staffUser.update({ where: { id }, data: { passwordHash, mustChangePassword: true } });
      await this.endSessions(tx, id);
      await recordAudit(tx, {
        actorType: 'STAFF',
        actorStaffId,
        action: 'staff_user.password_reset',
        entityType: 'StaffUser',
        entityId: id,
        newValue: { temporaryPassword: true, sessionsEnded: true },
      });
    });
    await this.dropRedisSessions(id);
    return { id, temporaryPassword: password };
  }

  /**
   * The signed-in person chooses a new password (always required after a
   * temporary one). Every session, including this one, is ended and a new
   * one is returned, so other browsers signed in as them are signed out.
   */
  async changeOwnPassword(staffUserId: string, currentPassword: string, newPassword: string, meta: { ipAddress?: string; userAgent?: string }) {
    const user = await this.prisma.staffUser.findUnique({ where: { id: staffUserId } });
    if (!user || !user.isActive) throw new UnauthorizedError('Session is invalid, expired, or revoked');
    if (!(await verifyPassword(currentPassword, user.passwordHash))) throw new ValidationError('Your current password is not correct');
    checkNewPassword(newPassword);
    if (await verifyPassword(newPassword, user.passwordHash)) throw new ValidationError('Choose a password different from the current one');
    const passwordHash = await hashPassword(newPassword);
    await this.prisma.$transaction(async (tx) => {
      await tx.staffUser.update({ where: { id: staffUserId }, data: { passwordHash, mustChangePassword: false, passwordChangedAt: new Date() } });
      await this.endSessions(tx, staffUserId);
      await recordAudit(tx, {
        actorType: 'STAFF',
        actorStaffId: staffUserId,
        action: 'staff_user.password_change',
        entityType: 'StaffUser',
        entityId: staffUserId,
        newValue: { wasTemporary: user.mustChangePassword, sessionsEnded: true },
      });
    });
    await this.dropRedisSessions(staffUserId);
    // Issued after the cut-off, so it stays valid.
    return this.fastify.staffSessionStore.create(staffUserId, meta);
  }
}
