import type { LucideIcon } from 'lucide-react';
import {
  LayoutDashboard,
  Settings,
  Landmark,
  ShieldCheck,
  UserCog,
  Shirt,
  Upload,
  FolderKanban,
  Building2,
  ClipboardList,
  PackageCheck,
  Boxes,
  SlidersHorizontal,
  ArrowLeftRight,
  Scale,
  ShoppingCart,
  ListChecks,
  Truck,
  Handshake,
  Undo2,
  Repeat,
  Receipt,
  Percent,
  Gift,
  Share2,
  Award,
  CircleUserRound,
  Image,
  LayoutTemplate,
  FileText,
  Menu,
  BarChart3,
  Warehouse,
  Package,
  RotateCcw,
  Tag,
  Users,
  Star,
} from 'lucide-react';

/**
 * Console information architecture: ten groups, each item shown only
 * when the staff session holds at least one of its permissions. Hiding a
 * link is a convenience - every screen's data and actions are still
 * authorized by the API (docs/admin/P1_PERMISSION_MAP.md). Icons are a
 * pure scannability layer added on top of this - group/item order,
 * labels, hrefs and permission gates are unchanged from the original IA.
 */
export interface NavItem {
  href: string;
  label: string;
  anyOf: string[];
  icon: LucideIcon;
}

export interface NavGroup {
  title: string;
  icon: LucideIcon;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    title: 'Dashboard',
    icon: LayoutDashboard,
    items: [
      { href: '/dashboard', label: 'Overview', anyOf: [], icon: LayoutDashboard },
      { href: '/dashboard/setup', label: 'Setup & health', anyOf: ['org:manage'], icon: Settings },
      { href: '/dashboard/business', label: 'Business & warehouse', anyOf: ['org:manage', 'tax:read', 'tax:manage'], icon: Landmark },
      // Anyone who can send or be sent an approval request, plus the log readers.
      {
        href: '/dashboard/approvals',
        label: 'Approvals',
        anyOf: ['org:manage', 'audit:read', 'inventory:adjust', 'inventory:adjust:coapprove', 'grn:create', 'grn:qc:manager_signoff', 'warehouse:pick'],
        icon: ShieldCheck,
      },
      { href: '/dashboard/staff', label: 'Staff', anyOf: ['rbac:manage'], icon: UserCog },
    ],
  },
  {
    title: 'Merchandise',
    icon: Shirt,
    items: [
      { href: '/dashboard/products', label: 'Products', anyOf: ['product:read'], icon: Shirt },
      { href: '/dashboard/products/import', label: 'Import products', anyOf: ['product:write'], icon: Upload },
      { href: '/dashboard/collections', label: 'Collections', anyOf: ['product:read'], icon: FolderKanban },
    ],
  },
  {
    title: 'Procurement',
    icon: Truck,
    items: [
      { href: '/dashboard/suppliers', label: 'Suppliers', anyOf: ['supplier:read'], icon: Building2 },
      { href: '/dashboard/purchase-orders', label: 'Purchase orders', anyOf: ['po:read'], icon: ClipboardList },
      { href: '/dashboard/receiving', label: 'Goods receiving', anyOf: ['grn:read', 'grn:create'], icon: PackageCheck },
    ],
  },
  {
    title: 'Inventory',
    icon: Warehouse,
    items: [
      { href: '/dashboard/inventory', label: 'Stock', anyOf: ['inventory:read'], icon: Boxes },
      { href: '/dashboard/inventory-adjustments', label: 'Adjustments', anyOf: ['inventory:adjust'], icon: SlidersHorizontal },
      { href: '/dashboard/inventory/transfers', label: 'Transfers', anyOf: ['inventory:read', 'inventory:transfer'], icon: ArrowLeftRight },
      { href: '/dashboard/inventory/reconcile', label: 'Reconciliation', anyOf: ['inventory:read'], icon: Scale },
    ],
  },
  {
    title: 'Orders',
    icon: Package,
    items: [
      { href: '/dashboard/orders', label: 'Orders', anyOf: ['order:read'], icon: ShoppingCart },
      { href: '/dashboard/warehouse/picks', label: 'Pick queue', anyOf: ['warehouse:read'], icon: ListChecks },
      { href: '/dashboard/fulfilments', label: 'Pack & ship', anyOf: ['order:read'], icon: Truck },
      { href: '/dashboard/fulfilments/handover', label: 'Courier handover', anyOf: ['shipping:manage'], icon: Handshake },
    ],
  },
  {
    title: 'Post-purchase',
    icon: RotateCcw,
    items: [
      { href: '/dashboard/returns', label: 'Returns', anyOf: ['return:read'], icon: Undo2 },
      { href: '/dashboard/exchanges', label: 'Exchanges', anyOf: ['exchange:read'], icon: Repeat },
      { href: '/dashboard/refunds', label: 'Refunds', anyOf: ['payment:refund'], icon: Receipt },
    ],
  },
  {
    title: 'Commercial',
    icon: Tag,
    items: [
      { href: '/dashboard/promotions', label: 'Promotions', anyOf: ['promotion:read'], icon: Percent },
      { href: '/dashboard/gift-cards', label: 'Gift cards', anyOf: ['giftcard:read'], icon: Gift },
      { href: '/dashboard/channels', label: 'Channels', anyOf: ['channel:read'], icon: Share2 },
      { href: '/dashboard/loyalty', label: 'Loyalty tools', anyOf: ['loyalty:adjust'], icon: Award },
    ],
  },
  {
    title: 'Customers',
    icon: Users,
    items: [{ href: '/dashboard/customer-360', label: 'Customer 360', anyOf: ['customer_service:manage'], icon: CircleUserRound }],
  },
  {
    title: 'Content',
    icon: FileText,
    items: [
      { href: '/dashboard/cms/lookbooks', label: 'Lookbooks', anyOf: ['cms:read'], icon: Image },
      { href: '/dashboard/cms/banners', label: 'Banners', anyOf: ['cms:read'], icon: Image },
      { href: '/dashboard/cms/content-blocks', label: 'Content blocks', anyOf: ['cms:read'], icon: LayoutTemplate },
      { href: '/dashboard/cms/landing-pages', label: 'Landing pages', anyOf: ['cms:read'], icon: FileText },
      { href: '/dashboard/cms/navigation-menus', label: 'Navigation menus', anyOf: ['cms:read'], icon: Menu },
      { href: '/dashboard/reviews', label: 'Photo reviews', anyOf: ['review:moderate'], icon: Star },
    ],
  },
  {
    title: 'Insights',
    icon: BarChart3,
    items: [{ href: '/dashboard/analytics', label: 'Analytics', anyOf: ['analytics:read'], icon: BarChart3 }],
  },
];

export function visibleNav(permissions: string[]): NavGroup[] {
  const held = new Set(permissions);
  return NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => i.anyOf.length === 0 || i.anyOf.some((p) => held.has(p))) })).filter(
    (g) => g.items.length > 0,
  );
}
