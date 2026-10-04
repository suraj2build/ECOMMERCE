import { NextResponse } from 'next/server';
import { indexingEnabled } from '@/lib/seo';

// LR-002: previews and staging are never indexed. The Node.js runtime reads
// SITE_INDEXING per request (not at build), so one build serves a noindexed
// preview and, with SITE_INDEXING=enabled, an indexable production.
export const config = { runtime: 'nodejs', matcher: '/:path*' };

export function middleware() {
  const response = NextResponse.next();
  if (!indexingEnabled()) response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return response;
}
