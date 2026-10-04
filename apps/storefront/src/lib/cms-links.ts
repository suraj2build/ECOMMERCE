/**
 * Footer links come from CMS navigation menus that staff edit in admin
 * (specs/28-admin.md: navigation menus change without a deployment). The
 * storefront renders only what was entered, and only safe links: a path on
 * this site, or an https URL. Anything else (javascript:, data:, http:,
 * protocol-relative //host) is dropped rather than rendered.
 */
export interface CmsNavItem {
  label: string;
  url: string;
  sortOrder?: number;
}

/** Menu keys the footer reads. An unset menu shows nothing. */
export const FOOTER_MENU_KEYS = { about: 'footer-about', social: 'footer-social' } as const;

export function safeHref(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  const value = url.trim();
  if (value.startsWith('/') && !value.startsWith('//')) return value;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && parsed.hostname ? parsed.toString() : null;
  } catch {
    return null;
  }
}

/** Valid items only, in the order staff set (sortOrder, then entry order). */
export function cleanMenu(items: unknown): CmsNavItem[] {
  if (!Array.isArray(items)) return [];
  return items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item && typeof item === 'object' && typeof (item as CmsNavItem).label === 'string' && (item as CmsNavItem).label.trim() !== '')
    .map(({ item, index }) => {
      const raw = item as CmsNavItem;
      return { label: raw.label.trim(), url: safeHref(raw.url), sortOrder: typeof raw.sortOrder === 'number' ? raw.sortOrder : index, index };
    })
    .filter((item): item is { label: string; url: string; sortOrder: number; index: number } => item.url !== null)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.index - b.index)
    .map(({ label, url, sortOrder }) => ({ label, url, sortOrder }));
}

export type SocialNetwork = 'instagram' | 'youtube' | 'pinterest' | 'facebook';

/** The network a social link points to, by its host; null for anything else. */
export function socialNetwork(url: string): SocialNetwork | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
  if (host === 'instagram.com') return 'instagram';
  if (host === 'youtube.com' || host === 'youtu.be' || host === 'm.youtube.com') return 'youtube';
  if (host === 'pinterest.com' || host === 'in.pinterest.com' || host === 'pin.it') return 'pinterest';
  if (host === 'facebook.com' || host === 'm.facebook.com' || host === 'fb.com') return 'facebook';
  return null;
}
