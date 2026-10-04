import { revalidatePath, revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';
import { CATALOG_CACHE_TAG } from '@/lib/api';
import { revalidateAuthorized } from '@/lib/revalidate-auth';

/**
 * Drops this storefront instance's cached catalogue reads (listings, search,
 * categories, collections, product details, Watch & Shop) and the pages
 * rendered from them, so the next request reads commerce-api again.
 * commerce-api calls it after a publish, unpublish, archive, price, markdown
 * or media change and after a search reindex; the reindex is also the
 * runbook step after a database restore or reseed (DEPLOYMENT.md).
 * Disabled (404) unless STOREFRONT_REVALIDATE_SECRET is set.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const secret = process.env.STOREFRONT_REVALIDATE_SECRET;
  if (!secret) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!revalidateAuthorized(request.headers.get('authorization'), secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  revalidateTag(CATALOG_CACHE_TAG);
  revalidatePath('/', 'layout');
  return NextResponse.json({ revalidated: true });
}
