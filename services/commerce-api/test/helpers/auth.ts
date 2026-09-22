import type { FastifyInstance } from 'fastify';
import { hashPassword } from '@fcp/shared';
import { testPrisma } from './db.js';

let counter = 0;

/**
 * Creates a staff user with the given role(s) and mints a valid session
 * token directly via the app's staffSessionStore, bypassing the HTTP
 * login/MFA flow entirely - the login/MFA flow itself is exercised by
 * test/integration/auth.test.ts, not re-tested by every other module's
 * fixtures.
 */
export async function createAuthenticatedStaff(
  app: FastifyInstance,
  roleKeys: string[],
): Promise<{ staffUserId: string; token: string }> {
  counter += 1;
  const email = `test-staff-${counter}-${Date.now()}@example.com`;
  const passwordHash = await hashPassword('TestPassword123!');

  const staffUser = await testPrisma.staffUser.create({
    data: { email, passwordHash, fullName: 'Test Staff', isActive: true },
  });

  for (const roleKey of roleKeys) {
    const role = await testPrisma.role.findUniqueOrThrow({ where: { key: roleKey } });
    await testPrisma.staffUserRole.create({ data: { staffUserId: staffUser.id, roleId: role.id } });
  }

  const session = await app.staffSessionStore.create(staffUser.id, {});
  return { staffUserId: staffUser.id, token: session.token };
}
