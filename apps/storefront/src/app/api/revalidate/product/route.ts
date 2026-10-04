import { revalidatePath } from 'next/cache';
import { NextResponse } from 'next/server';
import { revalidateAuthorized } from '@/lib/revalidate-auth';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Drops this storefront instance's cached render of one product page so a
 * publish, unpublish, archive or price change shows on the next request
 * instead of after the page's 30-second revalidation window. commerce-api
 * calls it after those changes (StorefrontCacheService). Disabled (404)
 * unless STOREFRONT_REVALIDATE_SECRET is set.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const secret = process.env.STOREFRONT_REVALIDATE_SECRET;
  if (!secret) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!revalidateAuthorized(request.headers.get('authorization'), secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { styleId?: unknown } | null;
  const styleId = body?.styleId;
  if (typeof styleId !== 'string' || !UUID.test(styleId)) {
    return NextResponse.json({ error: 'styleId must be a UUID' }, { status: 400 });
  }

  revalidatePath(`/product/${styleId}`);
  return NextResponse.json({ revalidated: true });
}
