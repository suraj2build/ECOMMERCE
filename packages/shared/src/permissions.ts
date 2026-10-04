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
  // LR-009: confirming that a COD order's cash was collected (it is what
  // turns the order into a reported purchase). Finance-owned, next to refunds.
  'payment:cod:collect',
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
  // M21 (specs/20-exchanges.md): mirrors return:*'s own granularity
  // exactly - exchange:initiate is CS-assisted initiation (the
  // customer's own self-service path is ownership-checked, no
  // permission needed); exchange:receive/qc are warehouse-floor actions
  // on the returned original item; qc is WAREHOUSE_MANAGER-only, same
  // manager-signoff precedent as return:qc/grn:qc:manager_signoff.
  'exchange:read',
  'exchange:initiate',
  'exchange:receive',
  'exchange:qc',
  // Independent-review repair (finding 3, 2026-09-26): the explicit
  // staff confirmation that a REPLACEMENT_ALLOCATED exchange's
  // replacement has actually reached the customer - a distinct,
  // manager-gated action from exchange:qc (which is about the ORIGINAL
  // item's condition), never bundled into it. EXC-004 Option 2 repair
  // (2026-09-26): also gates the new "assign this exchange's picked
  // replacement to a fulfilment" action (the manager-level checkpoint
  // before packing/shipping begins) - pick/pack/ship/deliver themselves
  // reuse warehouse:pick/order:fulfil unchanged (see
  // OrderService.assignExchangeToFulfilment/markFulfilment* docblocks).
  'exchange:fulfil',
  // M23 (specs/22-loyalty.md): a customer's own earn/redeem/reverse/
  // expire activity needs no staff permission at all (ownership-checked
  // customer self-service, same pattern as M18 cancellation/M19 return
  // self-service). loyalty:adjust gates only the ONE staff-initiated
  // mutation - a manual ledger ADJUST (goodwill credit/correction) -
  // deliberately separate from any read permission since CS/Finance
  // already see customer order context via order:read/customer_service:manage.
  'loyalty:adjust',
  // M24 (specs/23-promotions.md): managing the promotion/coupon
  // catalog itself (create/update/enable/disable) is a merchandising/
  // marketing action, distinct from a customer applying an existing
  // coupon at checkout (which needs no staff permission - the coupon's
  // own validity rules gate that, not RBAC).
  'promotion:manage',
  'promotion:read',
  // M25 (specs/24-marketing.md): campaign create/schedule/cancel is
  // Marketing-only - deliberately NOT bundled into the existing
  // marketing:manage permission (which predates M25 and covers content/
  // collections) so a future audit can distinguish "content operations"
  // from "customer messaging campaigns" by permission alone.
  'campaign:manage',
  'campaign:read',
  // M26 (specs/25-social-channel-publishing.md, CHAN-001): publishing
  // catalog data to an external channel adapter is a distinct staff
  // action from both product:publish (a Style's own lifecycle gate,
  // PROD-003) and catalog:publish (making a Collection live on the
  // primary website) - deliberately new keys, not reused, following the
  // same "future audit can distinguish by permission alone" precedent
  // M25 established for campaign:manage vs marketing:manage.
  'channel:manage',
  'channel:read',
  // M29 (specs/28-admin.md, ADM-002): CMS content (banners, campaign
  // landing pages, nav/menus, content blocks) is a distinct staff
  // capability from the pre-existing content:manage/content:moderate/
  // content:read keys, which belong to the unrelated M09 Watch & Shop
  // shoppable-media feature - deliberately new keys, not reused, so an
  // audit can tell "shoppable video moderation" apart from "site content
  // publishing" by permission alone.
  'cms:manage',
  'cms:read',
  // M30 (specs/33-store-credit-gift-cards.md): gift-card issuance,
  // disable, and full-ledger inspection are staff-privileged actions
  // distinct from ordinary order/refund handling - deliberately new
  // keys, not folded into an existing permission, so a future audit can
  // tell "who could mint/disable stored monetary value" apart from
  // every other capability by permission alone.
  'giftcard:manage',
  'giftcard:read',
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
