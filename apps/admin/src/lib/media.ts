import { API_URL } from './staff-auth';

const STOREFRONT_URL = (process.env.NEXT_PUBLIC_STOREFRONT_URL ?? 'http://localhost:3000').replace(/\/$/, '');

/**
 * Where the admin can load an image from. Uploaded photos are recorded as
 * storefront paths (/media/products/<file>, /media/content/<file>) that the
 * storefront proxies to the API; the admin reads them from the API directly.
 * Other site paths (e.g. /placeholders/...) live on the storefront.
 */
export function displayImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith('/media/')) return `${API_URL.replace(/\/$/, '')}/api/v1${url}`;
  if (url.startsWith('/') && !url.startsWith('//')) return `${STOREFRONT_URL}${url}`;
  if (/^https?:\/\//.test(url)) return url;
  return null;
}

export function storefrontUrl(path: string): string {
  return `${STOREFRONT_URL}${path}`;
}

/** Photos the server accepts (it checks the bytes again). */
export const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp';
export const MAX_IMAGE_MB = 10;

/** A quick check before upload; the server is still the authority. */
export function checkImageFile(file: File): string | null {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return `${file.name} is not a JPEG, PNG or WebP photo.`;
  if (file.size > MAX_IMAGE_MB * 1048576) return `${file.name} is larger than ${MAX_IMAGE_MB} MB.`;
  if (file.size === 0) return `${file.name} is empty.`;
  return null;
}
