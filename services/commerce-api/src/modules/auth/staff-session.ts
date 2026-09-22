import { randomBytes, createHash } from 'node:crypto';
import type { Redis } from 'ioredis';
import { loadEnv } from '@fcp/config';
import type { PrismaClient } from '@fcp/db';

/**
 * Staff sessions are server-side and instantly revocable (AUTH-003
 * decision: "server-side, instantly-revocable session (Redis-backed),
 * chosen so an offboarded or compromised staff account can be revoked
 * immediately"). The Redis key's existence IS the session's validity -
 * deleting it revokes access on the very next request. A StaffSession
 * row is also persisted for audit/history (specs/30-audit-compliance.md)
 * but is not itself consulted for the live validity check.
 */
const SESSION_KEY_PREFIX = 'staff-session:';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface StaffSessionPayload {
  staffUserId: string;
}

export class StaffSessionStore {
  constructor(
    private readonly redis: Redis,
    private readonly prisma: PrismaClient,
  ) {}

  async create(
    staffUserId: string,
    meta: { ipAddress?: string; userAgent?: string },
  ): Promise<{ token: string; expiresAt: Date }> {
    const env = loadEnv();
    const token = randomBytes(32).toString('hex');
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + env.STAFF_SESSION_TTL_SECONDS * 1000);

    await this.prisma.staffSession.create({
      data: {
        staffUserId,
        tokenHash,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        expiresAt,
      },
    });

    await this.redis.set(
      `${SESSION_KEY_PREFIX}${tokenHash}`,
      JSON.stringify({ staffUserId } satisfies StaffSessionPayload),
      'EX',
      env.STAFF_SESSION_TTL_SECONDS,
    );

    return { token, expiresAt };
  }

  async resolve(token: string): Promise<StaffSessionPayload | null> {
    const tokenHash = hashToken(token);
    const raw = await this.redis.get(`${SESSION_KEY_PREFIX}${tokenHash}`);
    if (!raw) return null;
    return JSON.parse(raw) as StaffSessionPayload;
  }

  /** Instant revocation: deletes the Redis key immediately. */
  async revoke(token: string): Promise<void> {
    const tokenHash = hashToken(token);
    await this.redis.del(`${SESSION_KEY_PREFIX}${tokenHash}`);
    await this.prisma.staffSession.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Revoke every active session for a staff user - e.g. on offboarding. */
  async revokeAllForUser(staffUserId: string): Promise<void> {
    const sessions = await this.prisma.staffSession.findMany({
      where: { staffUserId, revokedAt: null },
      select: { tokenHash: true },
    });
    if (sessions.length > 0) {
      await this.redis.del(...sessions.map((s) => `${SESSION_KEY_PREFIX}${s.tokenHash}`));
      await this.prisma.staffSession.updateMany({
        where: { staffUserId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
  }
}
