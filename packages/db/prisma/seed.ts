/**
 * Development seed data. Clearly separated from any production data path -
 * this script is never invoked outside local/dev/test environments (see
 * package.json db:seed, which is not wired into any deploy pipeline).
 */
import { PrismaClient } from '../generated/client/index.js';
import { hashPassword, ROLE_KEYS, PERMISSION_KEYS } from '@fcp/shared';

const prisma = new PrismaClient();

// Role display names for the eleven ADM-001 roles. The authoritative key
// list lives in @fcp/shared (ROLE_KEYS) so the seed and the runtime
// authorization checks can never drift.
const ROLE_NAMES: Record<(typeof ROLE_KEYS)[number], string> = {
  SUPER_ADMIN: 'Super Admin',
  BUSINESS_ADMIN: 'Business Admin',
  BUYING: 'Buying',
  MERCHANDISING: 'Merchandising',
  CATALOG: 'Catalog',
  WAREHOUSE_MANAGER: 'Warehouse Manager',
  WAREHOUSE_OPERATOR: 'Warehouse Operator',
  CUSTOMER_SERVICE: 'Customer Service',
  MARKETING: 'Marketing',
  FINANCE: 'Finance',
  ANALYTICS: 'Analytics',
};
const ROLES = ROLE_KEYS.map((key) => ({ key, name: ROLE_NAMES[key] }));
const PERMISSIONS = PERMISSION_KEYS;

// Permission matrix: role key -> permission keys. Derived from
// specs/01-auth-rbac.md, specs/28-admin.md, and blueprint/OPERATING_ROLES.md.
const ROLE_PERMISSIONS: Record<string, string[]> = {
  SUPER_ADMIN: [...PERMISSIONS], // unrestricted within the admin application
  BUSINESS_ADMIN: [
    'org:manage',
    'product:read',
    'po:approve',
    'po:read',
    'catalog:price:approve',
    'catalog:publish',
    'audit:read',
    'analytics:read',
  ],
  BUYING: ['supplier:read', 'supplier:write', 'po:create', 'po:submit', 'po:read', 'product:read'],
  MERCHANDISING: [
    'product:read',
    'product:write',
    'product:publish',
    'catalog:price:write',
    'catalog:publish',
    'catalog:collection:manage',
    'inventory:read',
  ],
  CATALOG: ['product:read', 'product:write', 'product:taxonomy:manage', 'inventory:read'],
  WAREHOUSE_MANAGER: [
    'grn:create',
    'grn:read',
    'grn:qc:manager_signoff',
    'inventory:read',
    'inventory:reserve',
    'inventory:adjust',
    'inventory:transfer',
    'po:read',
    'product:read',
  ],
  WAREHOUSE_OPERATOR: ['grn:create', 'grn:read', 'inventory:read', 'po:read', 'product:read'],
  CUSTOMER_SERVICE: ['customer_service:manage', 'product:read', 'inventory:read'],
  MARKETING: ['marketing:manage', 'product:read', 'catalog:collection:manage'],
  FINANCE: ['po:approve', 'po:read', 'inventory:adjust:coapprove', 'audit:read', 'analytics:read'],
  ANALYTICS: ['analytics:read', 'product:read', 'inventory:read'],
};

async function main() {
  console.warn('Seeding development data...');

  // --- Permissions & Roles (ADM-001) ---
  for (const key of PERMISSIONS) {
    await prisma.permission.upsert({ where: { key }, update: {}, create: { key } });
  }

  for (const role of ROLES) {
    await prisma.role.upsert({
      where: { key: role.key },
      update: { name: role.name },
      create: { key: role.key, name: role.name },
    });
  }

  for (const [roleKey, permKeys] of Object.entries(ROLE_PERMISSIONS)) {
    const role = await prisma.role.findUniqueOrThrow({ where: { key: roleKey } });
    for (const permKey of permKeys) {
      const permission = await prisma.permission.findUniqueOrThrow({ where: { key: permKey } });
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
        update: {},
        create: { roleId: role.id, permissionId: permission.id },
      });
    }
  }

  // --- Organization: single entity, one seed brand, one warehouse (ORG-001/002) ---
  const brand = await prisma.brand.upsert({
    where: { code: 'HOUSE' },
    update: {},
    create: { code: 'HOUSE', name: 'House Label' },
  });

  const warehouse = await prisma.location.upsert({
    where: { code: 'WH-DEL-01' },
    update: {},
    create: {
      code: 'WH-DEL-01',
      name: 'Delhi Main Warehouse',
      type: 'WAREHOUSE',
      city: 'Delhi',
      state: 'Delhi',
      pinCode: '110001',
    },
  });

  // --- Category taxonomy (unified per CAT-003) ---
  const apparel = await prisma.category.upsert({
    where: { slug: 'apparel' },
    update: {},
    create: { name: 'Apparel', slug: 'apparel' },
  });
  await prisma.category.upsert({
    where: { slug: 'tops' },
    update: {},
    create: { name: 'Tops', slug: 'tops', parentId: apparel.id },
  });

  // --- Sizes ---
  const sizeLabels = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
  for (const [i, label] of sizeLabels.entries()) {
    await prisma.size.upsert({
      where: { label },
      update: {},
      create: { label, sortOrder: i },
    });
  }

  // --- Bootstrap Super Admin staff user (dev/test only) ---
  const superAdminEmail = process.env.SEED_SUPER_ADMIN_EMAIL ?? 'admin@example.com';
  const superAdminPassword = process.env.SEED_SUPER_ADMIN_PASSWORD ?? 'ChangeMe123!';
  const passwordHash = await hashPassword(superAdminPassword);

  const superAdmin = await prisma.staffUser.upsert({
    where: { email: superAdminEmail },
    update: {},
    create: {
      email: superAdminEmail,
      passwordHash,
      fullName: 'Seed Super Admin',
      isActive: true,
    },
  });

  const superAdminRole = await prisma.role.findUniqueOrThrow({ where: { key: 'SUPER_ADMIN' } });
  await prisma.staffUserRole.upsert({
    where: { staffUserId_roleId: { staffUserId: superAdmin.id, roleId: superAdminRole.id } },
    update: {},
    create: { staffUserId: superAdmin.id, roleId: superAdminRole.id },
  });

  console.warn('Seed complete:', {
    brand: brand.code,
    warehouse: warehouse.code,
    superAdminEmail,
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
