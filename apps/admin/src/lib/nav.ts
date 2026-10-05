/**
 * Console information architecture: ten groups, each item shown only
 * when the staff session holds at least one of its permissions. Hiding a
 * link is a convenience - every screen's data and actions are still
 * authorized by the API (docs/admin/P1_PERMISSION_MAP.md).
 */
export interface NavItem {
  href: string;
  label: string;
  anyOf: string[];
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    title: 'Dashboard',
    items: [
      { href: '/dashboard', label: 'Overview', anyOf: [] },
      { href: '/dashboard/setup', label: 'Setup & health', anyOf: ['org:manage'] },
      { href: '/dashboard/approvals', label: 'Approvals', anyOf: ['org:manage', 'audit:read'] },
    ],
  },
  {
    title: 'Merchandise',
    items: [
      { href: '/dashboard/products', label: 'Products', anyOf: ['product:read'] },
      { href: '/dashboard/products/import', label: 'Import products', anyOf: ['product:write'] },
      { href: '/dashboard/collections', label: 'Collections', anyOf: ['product:read'] },
    ],
  },
  {
    title: 'Procurement',
    items: [
      { href: '/dashboard/suppliers', label: 'Suppliers', anyOf: ['supplier:read'] },
      { href: '/dashboard/purchase-orders', label: 'Purchase orders', anyOf: ['po:read'] },
      { href: '/dashboard/receiving', label: 'Goods receiving', anyOf: ['grn:read', 'grn:create'] },
    ],
  },
  {
    title: 'Inventory',
    items: [
      { href: '/dashboard/inventory', label: 'Stock', anyOf: ['inventory:read'] },
      { href: '/dashboard/inventory-adjustments', label: 'Adjustments', anyOf: ['inventory:adjust'] },
      { href: '/dashboard/inventory/transfers', label: 'Transfers', anyOf: ['inventory:read', 'inventory:transfer'] },
      { href: '/dashboard/inventory/reconcile', label: 'Reconciliation', anyOf: ['inventory:read'] },
    ],
  },
  {
    title: 'Orders',
    items: [
      { href: '/dashboard/orders', label: 'Orders', anyOf: ['order:read'] },
      { href: '/dashboard/warehouse/picks', label: 'Pick queue', anyOf: ['warehouse:read'] },
      { href: '/dashboard/fulfilments', label: 'Pack & ship', anyOf: ['order:read'] },
    ],
  },
  {
    title: 'Post-purchase',
    items: [
      { href: '/dashboard/returns', label: 'Returns', anyOf: ['return:read'] },
      { href: '/dashboard/exchanges', label: 'Exchanges', anyOf: ['exchange:read'] },
      { href: '/dashboard/refunds', label: 'Refunds', anyOf: ['payment:refund'] },
    ],
  },
  {
    title: 'Commercial',
    items: [
      { href: '/dashboard/promotions', label: 'Promotions', anyOf: ['promotion:read'] },
      { href: '/dashboard/gift-cards', label: 'Gift cards', anyOf: ['giftcard:read'] },
      { href: '/dashboard/channels', label: 'Channels', anyOf: ['channel:read'] },
      { href: '/dashboard/loyalty', label: 'Loyalty tools', anyOf: ['loyalty:adjust'] },
    ],
  },
  { title: 'Customers', items: [{ href: '/dashboard/customer-360', label: 'Customer 360', anyOf: ['customer_service:manage'] }] },
  {
    title: 'Content',
    items: [
      { href: '/dashboard/cms/banners', label: 'Banners', anyOf: ['cms:read'] },
      { href: '/dashboard/cms/content-blocks', label: 'Content blocks', anyOf: ['cms:read'] },
      { href: '/dashboard/cms/landing-pages', label: 'Content pages', anyOf: ['cms:read'] },
      { href: '/dashboard/cms/navigation-menus', label: 'Navigation menus', anyOf: ['cms:read'] },
    ],
  },
  { title: 'Insights', items: [{ href: '/dashboard/analytics', label: 'Analytics', anyOf: ['analytics:read'] }] },
];

export function visibleNav(permissions: string[]): NavGroup[] {
  const held = new Set(permissions);
  return NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => i.anyOf.length === 0 || i.anyOf.some((p) => held.has(p))) })).filter(
    (g) => g.items.length > 0,
  );
}
