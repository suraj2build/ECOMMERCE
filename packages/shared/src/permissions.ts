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
