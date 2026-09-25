/**
 * Permission and role key constants shared between the database seed
 * script and the API's authorization middleware, so the two can never
 * drift out of sync (one source of truth for the ADM-001 permission
 * matrix). See blueprint/OPERATING_ROLES.md and specs/28-admin.md.
 */

export const ROLE_KEYS = [
  'SUPER_ADMIN',
  'BUSINESS_ADMIN',
  'BUYING',
  'MERCHANDISING',
  'CATALOG',
  'WAREHOUSE_MANAGER',
  'WAREHOUSE_OPERATOR',
  'CUSTOMER_SERVICE',
  'MARKETING',
  'FINANCE',
  'ANALYTICS',
] as const;

export type RoleKey = (typeof ROLE_KEYS)[number];

export const PERMISSION_KEYS = [
  'org:manage',
  'rbac:manage',
  'product:read',
  'product:write',
  'product:publish',
  'product:taxonomy:manage',
  'supplier:read',
  'supplier:write',
  'po:create',
  'po:submit',
  'po:approve',
  'po:read',
  'grn:create',
  'grn:read',
  'grn:qc:manager_signoff',
  'inventory:read',
  'inventory:reserve',
  'inventory:adjust',
  'inventory:adjust:coapprove',
  'inventory:transfer',
  'catalog:price:write',
  'catalog:price:approve',
  'catalog:publish',
  'catalog:collection:manage',
  'catalog:search:pin',
  'search:reindex',
  'audit:read',
  'analytics:read',
  'marketing:manage',
  'customer_service:manage',
  'tax:manage',
  'tax:read',
  'invoice:read',
  'invoice:create',
  'content:manage',
  'content:moderate',
  'content:read',
  'review:moderate',
  'pincode:manage',
  'catalog:cross_sell:manage',
  'shipping:manage',
  'payment:refund',
  'order:read',
  'order:fulfil',
  'order:cancel',
  'order:exception:manage',
  'order:rto',
  // M16 (specs/15-warehouse-fulfilment.md): granular warehouse-floor
  // permissions, distinct from order:fulfil's already-existing pack/ship/
  // deliver scope. warehouse:read lets a picker see their queue without
  // the broader order:read (customer contact/address) visibility;
  // warehouse:pick/pack gate the two floor actions independently so a
  // future role split (e.g. pickers who cannot also pack) needs no schema
  // change; warehouse:exception:manage is deliberately separate from
  // order:exception:manage (an order-level staff action) since a pick/pack
  // exception is warehouse-floor-triggered, not CS-triggered.
  'warehouse:read',
  'warehouse:pick',
  'warehouse:pack',
  'warehouse:exception:manage',
  // M19 (specs/18-returns.md): return:initiate is CS-assisted initiation
  // (distinct from the customer's own self-service path, which needs no
  // staff permission at all - ownership-checked instead, same pattern as
  // M18 cancellation). return:receive/qc are warehouse-floor actions,
  // deliberately separate permissions (mirrors warehouse:pick/pack's own
  // granularity) so a future role split needs no schema change; qc is
  // WAREHOUSE_MANAGER-only, mirroring grn:qc:manager_signoff's own
  // manager-signoff precedent for GRN QC.
  'return:read',
  'return:initiate',
  'return:receive',
  'return:qc',
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

/**
 * Roles that MUST have MFA enforced (AUTH-002 - "mandatory for every role
 * with elevated/approval authority"). Checked at login and at MFA-gated
 * high-risk actions.
 */
export const MFA_REQUIRED_ROLES: readonly RoleKey[] = [
  'SUPER_ADMIN',
  'BUSINESS_ADMIN',
  'FINANCE',
];
