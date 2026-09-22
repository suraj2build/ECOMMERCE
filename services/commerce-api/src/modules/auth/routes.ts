import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { AuthService } from './service.js';
import { generateMfaSecret, buildMfaOtpAuthUrl } from './mfa.js';
import { verifyMfaToken } from './mfa.js';
import { UnauthorizedError, ValidationError } from '@fcp/shared';

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

  // --- Customer: mobile OTP ---
  fastify.post('/auth/customer/otp/request', async (request, reply) => {
    const { mobile } = otpRequestSchema.parse(request.body);
    await authService.requestCustomerOtp(mobile);
    reply.status(202).send({ message: 'OTP sent' });
  });

  fastify.post('/auth/customer/otp/verify', async (request, reply) => {
    const { mobile, code } = otpVerifySchema.parse(request.body);
    const result = await authService.verifyCustomerOtp(mobile, code);
    reply.status(200).send(result);
  });

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
  fastify.post('/auth/staff/login', async (request, reply) => {
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
  });

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
        data: { mfaSecret: secret, mfaEnabled: false },
      });
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
      if (!verifyMfaToken(code, staffUser.mfaSecret)) {
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
    });
  });
};

export default authRoutes;
