import fp from 'fastify-plugin';
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import fastifyJwt from '@fastify/jwt';
import { loadEnv } from '@fcp/config';
import { UnauthorizedError, ForbiddenError, type PermissionKey, type RoleKey } from '@fcp/shared';
import { StaffSessionStore } from '../modules/auth/staff-session.js';
import { resolveStaffPermissions } from '../modules/auth/rbac.js';

declare module 'fastify' {
  interface FastifyInstance {
    staffSessionStore: StaffSessionStore;
    requireStaffAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requirePermission: (
      permission: PermissionKey,
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireCustomerAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    tryCustomerAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }

  interface FastifyRequest {
    staffUser?: { id: string; roles: RoleKey[]; permissions: Set<PermissionKey> };
    customer?: { id: string; mobile: string };
  }
}

function extractBearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim();
}

/**
 * Registers customer JWT verification (@fastify/jwt) and the staff
 * session / RBAC decorators. Server-side authorization is authoritative
 * everywhere it's used (specs/01-auth-rbac.md) - these preHandlers are
 * the single choke point every protected route must declare, never a
 * frontend-only check.
 */
const authPlugin: FastifyPluginAsync = async (fastify) => {
  const env = loadEnv();

  await fastify.register(fastifyJwt, {
    secret: env.JWT_ACCESS_SECRET,
    sign: { expiresIn: env.JWT_ACCESS_TTL_SECONDS },
  });

  const staffSessionStore = new StaffSessionStore(fastify.redis, fastify.prisma);
  fastify.decorate('staffSessionStore', staffSessionStore);

  fastify.decorate('requireStaffAuth', async (request: FastifyRequest) => {
    const token = extractBearerToken(request);
    if (!token) throw new UnauthorizedError('Missing staff bearer token');

    const session = await staffSessionStore.resolve(token);
    if (!session) throw new UnauthorizedError('Session is invalid, expired, or revoked');

    const { permissions, roles, isActive } = await resolveStaffPermissions(
      fastify.prisma,
      session.staffUserId,
    );
    if (!isActive) throw new UnauthorizedError('Staff account is inactive');

    request.staffUser = { id: session.staffUserId, roles, permissions };
  });

  fastify.decorate('requirePermission', (permission: PermissionKey) => {
    return async (request: FastifyRequest) => {
      if (!request.staffUser) throw new UnauthorizedError();
      if (!request.staffUser.permissions.has(permission)) {
        throw new ForbiddenError(`Missing required permission: ${permission}`);
      }
    };
  });

  fastify.decorate('requireCustomerAuth', async (request: FastifyRequest) => {
    try {
      const payload = await request.jwtVerify<{ sub: string; mobile: string }>();
      request.customer = { id: payload.sub, mobile: payload.mobile };
    } catch {
      throw new UnauthorizedError('Invalid or expired customer token');
    }
  });

  /**
   * For routes that serve both logged-in customers and guests (M12 cart/
   * wishlist, CART-001) - populates request.customer when a valid bearer
   * token is present, but never blocks the request when one isn't; a
   * present-but-invalid/expired token IS still rejected (a guest simply
   * omits the header entirely, so an invalid one is a real client bug,
   * not a legitimate guest request).
   */
  fastify.decorate('tryCustomerAuth', async (request: FastifyRequest) => {
    if (!extractBearerToken(request)) return;
    try {
      const payload = await request.jwtVerify<{ sub: string; mobile: string }>();
      request.customer = { id: payload.sub, mobile: payload.mobile };
    } catch {
      throw new UnauthorizedError('Invalid or expired customer token');
    }
  });
};

export default fp(authPlugin, { name: 'auth', dependencies: ['prisma', 'redis'] });
