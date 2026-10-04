import { timingSafeEqual } from 'node:crypto';

/** Constant-time check of commerce-api's `Bearer <STOREFRONT_REVALIDATE_SECRET>`. */
export function revalidateAuthorized(header: string | null, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`);
  const provided = Buffer.from(header ?? '');
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}
