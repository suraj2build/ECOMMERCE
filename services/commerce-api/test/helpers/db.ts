import { PrismaClient } from '@fcp/db';
import { ROLE_KEYS, PERMISSION_KEYS } from '@fcp/shared';

export const testPrisma = new PrismaClient();

/**
 * Wipes every application table between test files (never touches
 * _prisma_migrations) so each integration test file starts from a known-
 * empty state against the dedicated fcp_test database.
 */
export async function resetDatabase(): Promise<void> {
  const tables = await testPrisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename != '_prisma_migrations'`;

  if (tables.length === 0) return;
  const names = tables.map((t) => `"${t.tablename}"`).join(', ');
  await testPrisma.$executeRawUnsafe(`TRUNCATE TABLE ${names} RESTART IDENTITY CASCADE`);
}

/** Seeds the RBAC permission/role matrix - a prerequisite for any authenticated test. */
export async function seedRbac(): Promise<void> {
  for (const key of PERMISSION_KEYS) {
    await testPrisma.permission.upsert({ where: { key }, update: {}, create: { key } });
  }
  for (const key of ROLE_KEYS) {
    await testPrisma.role.upsert({ where: { key }, update: {}, create: { key, name: key } });
  }
}

/** Grants every permission (except the two MFA-required-role escalation permissions if excluded) to a role - test convenience, not production seed data. */
export async function grantAllPermissions(roleKey: string): Promise<void> {
  const role = await testPrisma.role.findUniqueOrThrow({ where: { key: roleKey } });
  for (const permKey of PERMISSION_KEYS) {
    const permission = await testPrisma.permission.findUniqueOrThrow({ where: { key: permKey } });
    await testPrisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
      update: {},
      create: { roleId: role.id, permissionId: permission.id },
    });
  }
}

export async function grantPermissions(roleKey: string, permKeys: string[]): Promise<void> {
  const role = await testPrisma.role.findUniqueOrThrow({ where: { key: roleKey } });
  for (const permKey of permKeys) {
    const permission = await testPrisma.permission.findUniqueOrThrow({ where: { key: permKey } });
    await testPrisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
      update: {},
      create: { roleId: role.id, permissionId: permission.id },
    });
  }
}

export async function seedBrandAndLocation() {
  const brand = await testPrisma.brand.create({ data: { code: 'TESTBR', name: 'Test Brand' } });
  const location = await testPrisma.location.create({
    data: { code: 'TEST-WH-01', name: 'Test Warehouse', type: 'WAREHOUSE' },
  });
  const category = await testPrisma.category.create({ data: { name: 'Test Category', slug: 'test-category' } });
  const size = await testPrisma.size.create({ data: { label: 'M', sortOrder: 0 } });
  return { brand, location, category, size };
}
