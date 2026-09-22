import { randomBytes, createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@fcp/db';
import { hashPassword, verifyPassword, MFA_REQUIRED_ROLES, type RoleKey } from '@fcp/shared';
import { UnauthorizedError, ConflictError, ValidationError } from '@fcp/shared';
import { loadEnv } from '@fcp/config';
import { generateOtpCode, ConsoleOtpProvider, type OtpProvider } from './otp-provider.js';
import { verifyMfaToken } from './mfa.js';
import { StaffSessionStore } from './staff-session.js';
import { recordAudit } from '../audit/service.js';

function hashOtp(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export class AuthService {
  private readonly otpProvider: OtpProvider;
  private readonly staffSessionStore: StaffSessionStore;

  constructor(private readonly fastify: FastifyInstance) {
    this.otpProvider = new ConsoleOtpProvider(fastify.log);
    this.staffSessionStore = fastify.staffSessionStore;
  }

  private get prisma(): PrismaClient {
    return this.fastify.prisma;
  }

  // ---- Customer: mobile OTP (AUTH-001 - primary customer auth method) ----

  async requestCustomerOtp(mobile: string): Promise<void> {
    const env = loadEnv();
    const code = generateOtpCode(env.OTP_LENGTH);
    await this.prisma.otpCode.create({
      data: {
        mobile,
        codeHash: hashOtp(code),
        expiresAt: new Date(Date.now() + env.OTP_TTL_SECONDS * 1000),
      },
    });
    await this.otpProvider.send(mobile, code);
  }

  async verifyCustomerOtp(
    mobile: string,
    code: string,
  ): Promise<{ accessToken: string; refreshToken: string; customerId: string }> {
    const env = loadEnv();
    const otp = await this.prisma.otpCode.findFirst({
      where: { mobile, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    if (!otp) throw new UnauthorizedError('No pending OTP for this mobile number');
    if (otp.expiresAt < new Date()) throw new UnauthorizedError('OTP has expired');
    if (otp.attempts >= otp.maxAttempts) {
      throw new UnauthorizedError('Maximum OTP attempts exceeded, request a new code');
    }

    if (otp.codeHash !== hashOtp(code)) {
      await this.prisma.otpCode.update({
        where: { id: otp.id },
        data: { attempts: { increment: 1 } },
      });
      throw new UnauthorizedError('Invalid OTP');
    }

    await this.prisma.otpCode.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });

    const customer = await this.prisma.customer.upsert({
      where: { mobile },
      update: { mobileVerifiedAt: new Date() },
      create: { mobile, mobileVerifiedAt: new Date() },
    });

    const accessToken = await this.fastify.jwt.sign({ sub: customer.id, mobile: customer.mobile });

    const refreshToken = randomBytes(32).toString('hex');
    await this.prisma.customerRefreshToken.create({
      data: {
        customerId: customer.id,
        tokenHash: hashRefreshToken(refreshToken),
        expiresAt: new Date(Date.now() + env.JWT_REFRESH_TTL_SECONDS * 1000),
      },
    });

    return { accessToken, refreshToken, customerId: customer.id };
  }

  async refreshCustomerToken(refreshToken: string): Promise<{ accessToken: string }> {
    const tokenHash = hashRefreshToken(refreshToken);
    const record = await this.prisma.customerRefreshToken.findUnique({
      where: { tokenHash },
      include: { customer: true },
    });
    if (!record || record.revokedAt || record.expiresAt < new Date()) {
      throw new UnauthorizedError('Invalid or expired refresh token');
    }
    const accessToken = await this.fastify.jwt.sign({
      sub: record.customer.id,
      mobile: record.customer.mobile,
    });
    return { accessToken };
  }

  /**
   * Certification-pass finding: CustomerRefreshToken.revokedAt was
   * checked on every refresh but never written anywhere - a customer had
   * no way to revoke a leaked/stolen refresh token short of waiting out
   * its full TTL (JWT_REFRESH_TTL_SECONDS, 30 days by default). Mirrors
   * the staff-side session revocation already implemented in
   * StaffSessionStore.revoke().
   */
  async revokeCustomerRefreshToken(refreshToken: string): Promise<void> {
    const tokenHash = hashRefreshToken(refreshToken);
    await this.prisma.customerRefreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  // ---- Staff: password + conditional MFA (AUTH-002) ----

  async staffLogin(
    email: string,
    password: string,
    mfaCode: string | undefined,
    meta: { ipAddress?: string; userAgent?: string },
  ): Promise<{ token: string; expiresAt: Date } | { mfaRequired: true }> {
    const staffUser = await this.prisma.staffUser.findUnique({
      where: { email },
      include: { roles: { include: { role: true } } },
    });

    // Constant-shape response whether the user exists or not, to avoid
    // user-enumeration - always run a bcrypt compare.
    const passwordHash = staffUser?.passwordHash ?? '$2a$12$invalidinvalidinvalidinvalidinvalidinv';
    const passwordValid = await verifyPassword(password, passwordHash);
    if (!staffUser || !staffUser.isActive || !passwordValid) {
      throw new UnauthorizedError('Invalid email or password');
    }

    const roleKeys = staffUser.roles.map((r) => r.role.key as RoleKey);
    const mfaRequired = roleKeys.some((role) => MFA_REQUIRED_ROLES.includes(role));

    // "Cannot bypass" (specs/01-auth-rbac.md AUTH-002) applies once MFA is
    // enrolled and confirmed: a login attempt on a confirmed MFA account
    // MUST supply a valid code. Before enrollment, login must still
    // succeed - MFA enrollment itself is a self-service action gated by
    // requireStaffAuth (an active session), so blocking pre-enrollment
    // login would make an MFA-required role permanently unable to log in.
    if (mfaRequired && staffUser.mfaEnabled && staffUser.mfaSecret) {
      if (!mfaCode) {
        return { mfaRequired: true };
      }
      if (!verifyMfaToken(mfaCode, staffUser.mfaSecret)) {
        throw new UnauthorizedError('Invalid MFA code');
      }
    }

    const session = await this.staffSessionStore.create(staffUser.id, meta);
    await recordAudit(this.prisma, {
      actorType: 'STAFF',
      actorStaffId: staffUser.id,
      action: 'staff.login',
      entityType: 'StaffUser',
      entityId: staffUser.id,
      reference: meta.ipAddress,
    });
    return session;
  }

  async staffLogout(token: string, staffUserId: string): Promise<void> {
    await this.staffSessionStore.revoke(token);
    await recordAudit(this.prisma, {
      actorType: 'STAFF',
      actorStaffId: staffUserId,
      action: 'staff.logout',
      entityType: 'StaffUser',
      entityId: staffUserId,
    });
  }

  async createStaffUser(params: {
    email: string;
    password: string;
    fullName: string;
    roleKeys: string[];
    createdByStaffId: string;
  }): Promise<{ id: string }> {
    const existing = await this.prisma.staffUser.findUnique({ where: { email: params.email } });
    if (existing) throw new ConflictError('A staff user with this email already exists');

    const passwordHash = await hashPassword(params.password);
    const roles = await this.prisma.role.findMany({ where: { key: { in: params.roleKeys } } });
    if (roles.length !== params.roleKeys.length) {
      throw new ValidationError('One or more role keys are invalid');
    }

    const staffUser = await this.prisma.staffUser.create({
      data: {
        email: params.email,
        passwordHash,
        fullName: params.fullName,
        roles: { create: roles.map((role) => ({ roleId: role.id })) },
      },
    });

    await recordAudit(this.prisma, {
      actorType: 'STAFF',
      actorStaffId: params.createdByStaffId,
      action: 'staff_user.create',
      entityType: 'StaffUser',
      entityId: staffUser.id,
      newValue: { email: params.email, roles: params.roleKeys },
    });

    return { id: staffUser.id };
  }
}
