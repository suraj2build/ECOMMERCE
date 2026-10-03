import { sitemapFiles, sitemapIndex } from '@/lib/sitemap';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  return new Response(sitemapIndex(await sitemapFiles()), { headers: { 'content-type': 'application/xml; charset=utf-8' } });
}
