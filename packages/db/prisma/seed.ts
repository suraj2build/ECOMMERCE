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
    'shipping:manage',
    'audit:read',
    'analytics:read',
    'tax:read',
    'invoice:read',
    'content:read',
    'order:read',
    // M26/M29: Business Admin can see (not manage) channel-publishing
    // status and CMS content, same read-only oversight posture as its
    // other read-only rows above.
    'channel:read',
    'cms:read',
  ],
  BUYING: ['supplier:read', 'supplier:write', 'po:create', 'po:submit', 'po:read', 'product:read'],
  MERCHANDISING: [
    'product:read',
    'product:write',
    'product:publish',
    'catalog:price:write',
    'catalog:publish',
    'catalog:collection:manage',
    'catalog:search:pin',
    'search:reindex',
    'catalog:cross_sell:manage',
    'inventory:read',
    // M24: promotion/coupon catalog management is a merchandising action.
    'promotion:manage',
    'promotion:read',
    // M26: merchandising owns which SKUs get published to which channel
    // (the same team that owns catalog:publish for the primary website).
    'channel:manage',
    'channel:read',
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
    'pincode:manage',
    'order:read',
    'order:fulfil',
    'order:exception:manage',
    'warehouse:read',
    'warehouse:pick',
    'warehouse:pack',
    'warehouse:exception:manage',
    // M17: warehouse staff create/manage shipments at the READY_TO_SHIP
    // hand-off they themselves confirm - not restricted to BUSINESS_ADMIN
    // alone (specs/16-shipping-tracking.md).
    'shipping:manage',
    // M19: warehouse receives and QCs returned parcels - qc is
    // manager-only (mirrors grn:qc:manager_signoff).
    'return:read',
    'return:receive',
    'return:qc',
    // M21: mirrors return:receive/qc exactly, for an exchange's original
    // item.
    'exchange:read',
    'exchange:receive',
    'exchange:qc',
    // Independent-review repair (finding 3, 2026-09-26): manager-gated,
    // like exchange:qc - confirming actual replacement fulfilment.
    'exchange:fulfil',
  ],
  WAREHOUSE_OPERATOR: [
    'grn:create',
    'grn:read',
    'inventory:read',
    'po:read',
    'product:read',
    'order:read',
    'order:fulfil',
    'warehouse:read',
    'warehouse:pick',
    'warehouse:pack',
    'shipping:manage',
    // M19: operators receive returned parcels but do not sign off QC.
    'return:read',
    'return:receive',
    // M21: mirrors return:receive - operators receive but do not QC.
    'exchange:read',
    'exchange:receive',
  ],
  CUSTOMER_SERVICE: [
    'customer_service:manage',
    'product:read',
    'inventory:read',
    'review:moderate',
    'order:read',
    'order:cancel',
    'order:exception:manage',
    'order:rto',
    // M19: CS-assisted return initiation.
    'return:read',
    'return:initiate',
    // M21: CS-assisted exchange initiation.
    'exchange:read',
    'exchange:initiate',
    // M23: CS-assisted manual loyalty-point adjustment (goodwill credit/
    // correction) - the customer's own earn/redeem/reverse/expire
    // activity needs no staff permission at all (self-service).
    'loyalty:adjust',
  ],
  MARKETING: [
    'marketing:manage',
    'product:read',
    'catalog:collection:manage',
    'content:manage',
    'content:moderate',
    'content:read',
    'review:moderate',
    // M24: promotions are frequently a marketing-owned lever too (read
    // access to see what's live; MERCHANDISING owns creation/management).
    'promotion:read',
    // M25: campaign create/schedule/cancel is Marketing-only.
    'campaign:manage',
    'campaign:read',
    // M26: Marketing also publishes to social/channel destinations
    // (read-level oversight; MERCHANDISING owns the actual publish action).
    'channel:read',
    // M29: CMS content (banners, campaign landing pages, nav/menus) is a
    // Marketing-owned publishing surface, distinct from content:manage
    // (M09 Watch & Shop moderation, also owned by this role above).
    'cms:manage',
    'cms:read',
  ],
  FINANCE: [
    'po:approve',
    'po:read',
    'inventory:adjust:coapprove',
    'audit:read',
    'analytics:read',
    'tax:manage',
    'tax:read',
    'invoice:read',
    'invoice:create',
    'payment:refund',
    'order:read',
    // M23: Finance may also action a manual loyalty adjustment
    // (mirrors payment:refund's own Finance ownership of value corrections).
    'loyalty:adjust',
  ],
  ANALYTICS: ['analytics:read', 'product:read', 'inventory:read', 'order:read'],
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

  // --- Loyalty tiers (M23, specs/22-loyalty.md, LOY-001) ---
  // Illustrative ENGINEERING-DEFAULT tier thresholds for test/demo
  // purposes only - no repository decision defines real tier economics
  // (LOY-001 explicitly leaves tier thresholds to a future business
  // decision). A DB table, never hard-coded in application logic, so a
  // Product Owner can change names/thresholds/count without a code
  // deployment - see LoyaltyTier's own schema docblock.
  const LOYALTY_TIERS = [
    { name: 'Bronze', minLifetimePoints: 0, sortOrder: 0 },
    { name: 'Silver', minLifetimePoints: 1000, sortOrder: 1 },
    { name: 'Gold', minLifetimePoints: 5000, sortOrder: 2 },
  ];
  for (const tier of LOYALTY_TIERS) {
    await prisma.loyaltyTier.upsert({ where: { name: tier.name }, update: {}, create: tier });
  }

  // --- Promotion types (M24, specs/23-promotions.md, PROMO-001) ---
  // A reference TABLE, not a fixed enum - PROMO-001's own explicit
  // "extensible" requirement. This seed list is illustrative starter
  // data (the exact set PROMO-001 names), never a closed/hard-coded
  // set - staff can add a new type via data alone.
  const PROMOTION_TYPES = [
    { key: 'PROMOTIONAL', name: 'Promotional coupon' },
    { key: 'CAMPAIGN', name: 'Campaign coupon' },
    { key: 'ONBOARDING', name: 'Onboarding coupon' },
    { key: 'CASHBACK', name: 'Cashback-related benefit' },
  ];
  for (const type of PROMOTION_TYPES) {
    await prisma.promotionType.upsert({ where: { key: type.key }, update: {}, create: type });
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
