import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AuthService, readMfaSeedOrDeny } from './service.js';
import { generateMfaSecret, buildMfaOtpAuthUrl } from './mfa.js';
import { verifyMfaToken } from './mfa.js';
import { encryptMfaSecret } from './mfa-secret-crypto.js';
import { StaffService } from '../staff/service.js';
import { UnauthorizedError, ValidationError } from '@fcp/shared';
import { loadEnv } from '@fcp/config';

/**
 * M31 Security Hardening (5B/5E) - per-identity + per-IP rate limits for
 * the two endpoints an attacker can brute-force: OTP verification (the
 * per-code `maxAttempts` cap in AuthService.verifyCustomerOtp only
 * bounds ONE OTP code - without this, a fresh OTP request resets that
 * counter, so the actual brute-force surface is otherwise unlimited) and
 * OTP request (resend abuse / SMS-cost exhaustion). Keyed by the
 * identifier in the request body (mobile/email), not just request.ip -
 * an attacker distributing attempts across many source IPs would
 * otherwise defeat a purely IP-keyed limit, and an office/mobile-carrier
 * NAT sharing one IP across many genuine users would otherwise be
 * unfairly throttled as one.
 */
function mobileKey(request: FastifyRequest): string {
  const body = request.body as { mobile?: unknown } | undefined;
  const mobile = typeof body?.mobile === 'string' ? body.mobile : 'unknown';
  return `${request.ip}:${mobile}`;
}

/** Per session: the bearer token's hash, never the token itself (AO-D7 password change). */
function sessionKey(request: FastifyRequest): string {
  const header = request.headers.authorization ?? '';
  return `staff-password:${createHash('sha256').update(header).digest('hex')}`;
}

function emailKey(request: FastifyRequest): string {
  const body = request.body as { email?: unknown } | undefined;
  const email = typeof body?.email === 'string' ? body.email.toLowerCase() : 'unknown';
  return `${request.ip}:${email}`;
}

// M33 fix (2026-09-29): these limits are keyed by IP+identifier, so every
// E2E spec run from the SAME host (this sandbox, and identically a single
// GitHub Actions runner) against the SAME shared seeded identity (one
// super-admin email reused across ~10 independent storefront E2E specs;
// see `SEED_SUPER_ADMIN_EMAIL`) collapses into ONE bucket - a legitimate
// automated-test workload, not an attacker. Discovered when this pass's
// own full Playwright run genuinely 429'd 5 previously-green specs after
// M31 added these limits, undetected until an actual multi-spec E2E run
// exercised them together (no prior pass had run the full suite against a
// live rate limiter). NOT fixed via a NODE_ENV=test check - CI's own
// `rate-limiting.test.ts` (which deliberately proves these exact limits
// ARE enforced) and the E2E step both run under NODE_ENV=test, so that
// dimension can't distinguish "the adversarial test that wants the real
// limit" from "an E2E run that needs headroom." Fixed instead with an
// explicit opt-in override (`AUTH_RATE_LIMIT_E2E_OVERRIDE_MAX`, unset by
// default everywhere, including production and rate-limiting.test.ts's
// own run) set ONLY by the E2E step itself - see packages/config's own
// comment for the full rationale.
//
// Computed lazily (a function, called from inside the plugin body below)
// rather than as a module-top-level constant - this pass's own testing
// caught a genuine bug in an earlier draft that computed this eagerly at
// module-import time: `loadEnv()` caches its result on first call
// (packages/config's own documented, intentional behavior), so an eager
// top-level call here fired the instant this module was FIRST imported -
// which happens transitively (auth/routes.ts -> app.ts -> a test file's
// own `createTestApp()` import) BEFORE that test file's own later
// `process.env.RAZORPAY_KEY_ID = ...`-style module-body statements had a
// chance to run, permanently caching a stale/incomplete environment for
// the rest of that test process. Every other `loadEnv()` call site in
// this codebase is already inside a function for exactly this reason;
// this one now matches that pattern.
function computeAuthRateLimitMax() {
  const override = loadEnv().AUTH_RATE_LIMIT_E2E_OVERRIDE_MAX;
  return {
    otpRequest: override ?? 5,
    otpVerify: override ?? 10,
    staffLogin: override ?? 10,
  };
}

const otpRequestSchema = z.object({ mobile: z.string().min(10).max(15) });
const otpVerifySchema = z.object({ mobile: z.string().min(10).max(15), code: z.string().length(6) });
const refreshSchema = z.object({ refreshToken: z.string().min(1) });
const staffLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  mfaCode: z.string().optional(),
});
const createStaffUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(12, 'Staff passwords must be at least 12 characters'),
  fullName: z.string().min(1),
  roleKeys: z.array(z.string()).min(1),
});

/**
 * Authentication & RBAC routes (M01, specs/01-auth-rbac.md). Guest
 * checkout support means no route in this module blocks a customer from
 * being unauthenticated elsewhere - these endpoints exist for the
 * customer who *chooses* to authenticate.
 */
const authRoutes: FastifyPluginAsync = async (fastify) => {
  const authService = new AuthService(fastify);
  const authRateLimitMax = computeAuthRateLimitMax();

  // --- Customer: mobile OTP ---
  fastify.post(
    '/auth/customer/otp/request',
    {
      config: {
        rateLimit: { max: authRateLimitMax.otpRequest, timeWindow: '15 minutes', hook: 'preValidation', keyGenerator: mobileKey },
      },
    },
    async (request, reply) => {
      const { mobile } = otpRequestSchema.parse(request.body);
      await authService.requestCustomerOtp(mobile);
      reply.status(202).send({ message: 'OTP sent' });
    },
  );

  fastify.post(
    '/auth/customer/otp/verify',
    {
      config: {
        rateLimit: { max: authRateLimitMax.otpVerify, timeWindow: '15 minutes', hook: 'preValidation', keyGenerator: mobileKey },
      },
    },
    async (request, reply) => {
      const { mobile, code } = otpVerifySchema.parse(request.body);
      const result = await authService.verifyCustomerOtp(mobile, code);
      reply.status(200).send(result);
    },
  );

  fastify.post('/auth/customer/refresh', async (request, reply) => {
    const { refreshToken } = refreshSchema.parse(request.body);
    const result = await authService.refreshCustomerToken(refreshToken);
    reply.status(200).send(result);
  });

  fastify.post('/auth/customer/logout', async (request, reply) => {
    const { refreshToken } = refreshSchema.parse(request.body);
    await authService.revokeCustomerRefreshToken(refreshToken);
    reply.status(204).send();
  });

  // --- Staff: password + conditional MFA ---
  fastify.post(
    '/auth/staff/login',
    {
      config: {
        rateLimit: { max: authRateLimitMax.staffLogin, timeWindow: '15 minutes', hook: 'preValidation', keyGenerator: emailKey },
      },
    },
    async (request, reply) => {
      const { email, password, mfaCode } = staffLoginSchema.parse(request.body);
      const result = await authService.staffLogin(email, password, mfaCode, {
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });
      if ('mfaRequired' in result) {
        reply.status(401).send({ error: { code: 'MFA_REQUIRED', message: 'MFA code required' } });
        return;
      }
      reply.status(200).send(result);
    },
  );

  fastify.post(
    '/auth/staff/logout',
    { preHandler: fastify.requireStaffAuth },
    async (request, reply) => {
      const token = request.headers.authorization!.slice('Bearer '.length).trim();
      await authService.staffLogout(token, request.staffUser!.id);
      reply.status(204).send();
    },
  );

  // Only Super Admin may create staff users directly via API in Phase 1
  // (a dedicated admin UI for this arrives with the Admin milestone).
  fastify.post(
    '/auth/staff/users',
    { preHandler: [fastify.requireStaffAuth, fastify.requirePermission('rbac:manage')] },
    async (request, reply) => {
      const body = createStaffUserSchema.parse(request.body);
      const result = await authService.createStaffUser({
        ...body,
        createdByStaffId: request.staffUser!.id,
      });
      reply.status(201).send(result);
    },
  );

  // MFA enrollment - self-service for the authenticated staff user.
  fastify.post(
    '/auth/staff/mfa/enroll',
    { preHandler: fastify.requireStaffAuth },
    async (request, reply) => {
      const staffUserId = request.staffUser!.id;
      const staffUser = await fastify.prisma.staffUser.findUniqueOrThrow({
        where: { id: staffUserId },
      });
      const secret = generateMfaSecret();
      await fastify.prisma.staffUser.update({
        where: { id: staffUserId },
        data: { mfaSecret: encryptMfaSecret(secret), mfaEnabled: false },
      });
      // The plaintext secret is only ever held in memory here, for the
      // one response that shows the enrollment QR code - never re-read
      // back out of the database in plaintext again after this.
      reply.status(200).send({ otpAuthUrl: buildMfaOtpAuthUrl(staffUser.email, secret) });
    },
  );

  fastify.post(
    '/auth/staff/mfa/confirm',
    { preHandler: fastify.requireStaffAuth },
    async (request, reply) => {
      const { code } = z.object({ code: z.string().length(6) }).parse(request.body);
      const staffUserId = request.staffUser!.id;
      const staffUser = await fastify.prisma.staffUser.findUniqueOrThrow({
        where: { id: staffUserId },
      });
      if (!staffUser.mfaSecret) {
        throw new ValidationError('No MFA enrollment in progress - call /mfa/enroll first');
      }
      if (!verifyMfaToken(code, await readMfaSeedOrDeny(fastify.prisma, staffUserId, staffUser.mfaSecret))) {
        throw new UnauthorizedError('Invalid MFA code');
      }
      await fastify.prisma.staffUser.update({
        where: { id: staffUserId },
        data: { mfaEnabled: true },
      });
      reply.status(200).send({ mfaEnabled: true });
    },
  );

  // Current identity introspection - used by tests and future admin UI.
  fastify.get('/auth/staff/me', { preHandler: fastify.requireStaffAuth }, async (request, reply) => {
    reply.status(200).send({
      id: request.staffUser!.id,
      roles: request.staffUser!.roles,
      permissions: [...request.staffUser!.permissions],
      mustChangePassword: request.staffUser!.mustChangePassword ?? false,
    });
  });

  // AO-D7: the signed-in person changes their own password (required after
  // a temporary one). Returns a new session; every earlier one is ended.
  fastify.post(
    '/auth/staff/password',
    {
      preHandler: fastify.requireStaffAuth,
      config: { rateLimit: { max: authRateLimitMax.staffLogin, timeWindow: '15 minutes', keyGenerator: sessionKey } },
    },
    async (request, reply) => {
      const body = z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(1).max(200) }).strict().parse(request.body);
      const session = await new StaffService(fastify).changeOwnPassword(request.staffUser!.id, body.currentPassword, body.newPassword, {
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });
      reply.status(200).send(session);
    },
  );
};

export default authRoutes;
