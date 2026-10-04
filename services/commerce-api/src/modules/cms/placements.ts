/**
 * Admin Ops Phase 1: where the storefront actually reads CMS content. This
 * is a statement about the storefront code (apps/storefront), kept next to
 * the CMS routes so admin can label each menu and banner placement honestly:
 * "shown on the storefront" or "saved, but the storefront does not read it".
 *
 * Sources: apps/storefront/src/vanya/bridge/editorial.ts (banners),
 * apps/storefront/src/lib/cms-links.ts and app/layout.tsx (footer menus).
 * The main header navigation is part of the approved design and is NOT read
 * from any CMS menu; e2e tests prove the two footer menus reach the page.
 */
export interface MenuPlacement {
  key: string;
  label: string;
  where: string;
  linkRule: string;
}

export interface BannerPlacement {
  key: string;
  label: string;
  where: string;
  /** How many active banners the storefront shows here (first by sort order, or all). */
  uses: 'first' | 'all';
  fields: string[];
}

export const MENU_PLACEMENTS: MenuPlacement[] = [
  { key: 'footer-about', label: 'Footer: About column', where: 'Footer on every storefront page, after the built-in About links', linkRule: 'A page on this site (/pages/our-story) or a full https:// address' },
  { key: 'footer-social', label: 'Footer: social links', where: 'Footer social row. Instagram, YouTube, Pinterest and Facebook addresses show as their short labels', linkRule: 'A full https:// address of the social profile' },
];

/** Menu keys owners may expect but which the storefront does not read. */
export const UNREAD_MENU_KEYS: Record<string, string> = {
  'main-nav': 'The header navigation is part of the approved design and is built into the storefront. Saving this menu does not change the header.',
};

const DEPARTMENTS = [
  ['men', 'Men'],
  ['women', 'Women'],
] as const;

const BANNER_SLOTS: Array<{ key: string; label: string; where: string; uses: 'first' | 'all'; fields: string[] }> = [
  { key: 'gateway', label: 'Entry page photo', where: 'The department half of the entry page', uses: 'first', fields: ['image'] },
  { key: 'home-hero', label: 'Home hero', where: 'Top of the department home page', uses: 'first', fields: ['image'] },
  { key: 'home-feature', label: 'Home feature', where: 'Feature block on the department home page', uses: 'first', fields: ['image'] },
  { key: 'home-category', label: 'Home category tiles', where: 'Shop-by-category tiles', uses: 'all', fields: ['image', 'title', 'link'] },
  { key: 'home-occasion', label: 'Home occasion tiles', where: 'Occasion tiles', uses: 'all', fields: ['image', 'link'] },
  { key: 'home-tastemakers', label: 'Home tastemakers', where: 'Tastemakers row', uses: 'all', fields: ['image', 'title'] },
];

export const BANNER_PLACEMENTS: BannerPlacement[] = DEPARTMENTS.flatMap(([dept, deptLabel]) =>
  BANNER_SLOTS.map((slot) => ({ key: `${slot.key}-${dept}`, label: `${deptLabel}: ${slot.label}`, where: `${deptLabel} - ${slot.where}`, uses: slot.uses, fields: slot.fields })),
);

/** A link the storefront will render: a site path (not //host) or an https URL. */
export function isSafeContentLink(url: string): boolean {
  const value = url.trim();
  if (value.startsWith('/') && !value.startsWith('//')) return !/\s/.test(value);
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}
